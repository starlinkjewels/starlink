// src/lib/db.ts
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  query,
  where,
  getDoc,
  documentId
} from "firebase/firestore";
function dayOf(iso) {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const p2 = (n2) => String(n2).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function defaultSettings() {
  return {
    companyName: "Starlink Jewels",
    currency: "USD",
    language: "English",
    notifications: true,
    diamondRate: 3500,
    metalRate: 65,
    defaultShippingCharge: 0,
    invoiceAddress1: "55 JOHN ST",
    invoiceAddress2: "EAST RUTHERFORD",
    invoiceAddress3: "NEW JERSEY 07073",
    invoiceTel: "+91 83472 78188",
    invoicePrimary: "+1 201 554 4824",
    invoiceEmail: "Starlinkjewels@gmail.com",
    invoiceTerms: "COD"
  };
}
function emptyDb() {
  return {
    users: [],
    clients: [],
    orders: [],
    tasks: [],
    messages: [],
    notifications: [],
    invoices: [],
    giftCards: [],
    expenses: [],
    catalogFolders: [],
    catalogItems: [],
    catalogFavorites: [],
    productPhotoFolders: [],
    productPhotoItems: [],
    shares: [],
    lockers: [],
    lockerTransactions: [],
    suppliers: [],
    purchases: [],
    supplierReceipts: [],
    supplierPayments: [],
    factoryPayments: [],
    clientReceipts: [],
    factories: [],
    materialIssuances: [],
    stockMovements: [],
    readyStock: [],
    diamondPackets: [],
    diamondSales: [],
    settings: defaultSettings(),
    session: { userId: null }
  };
}
var cache = emptyDb();
var remote = emptyDb();
function orderGrossTotal(order2) {
  return order2.amount + (order2.shippingCharge || 0) + (order2.certificateFee || 0);
}
function orderTotal(order2) {
  return Math.max(0, Math.round((orderGrossTotal(order2) - (order2.giftCardRedeemed || 0)) * 100) / 100);
}
var persistQueue = Promise.resolve();
function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
var ONLINE_THRESHOLD_MS = 2 * 60 * 1e3;

// src/lib/dispatch.ts
function recordShippingCost(d, orderIds, cost, shipment, by, at2) {
  if (!orderIds.length) return 0;
  if (cost.none) {
    recordNoFreight(d, orderIds, "no shipping charge", shipment, by, at2);
    return 1;
  }
  const locker = cost.lockerId ? d.lockers.find((l) => l.id === cost.lockerId) : void 0;
  const currency = locker ? (locker.currency || "INR") === "USD" ? "USD" : "INR" : cost.currency;
  const ref = `${shipment.courierName.trim()} ${shipment.trackingNumber.trim()}`.trim();
  const numbers = orderIds.map((id) => d.orders.find((o) => o.id === id)?.orderNumber).filter(Boolean).join(", ");
  let written = 0;
  for (const [kind, amount] of [["Freight", cost.freight], ["Insurance", cost.insurance]]) {
    if (!(amount > 0)) continue;
    const id = uid("exp_");
    if (!d.expenses) d.expenses = [];
    d.expenses.push({
      id,
      title: `${kind} \u2014 ${ref}`,
      amount: Math.round(amount * 100) / 100,
      category: "Shipping",
      note: `Shipment of ${numbers}`,
      employeeId: by.id,
      currency,
      createdAt: at2,
      lockerId: locker?.id,
      orderIds: [...orderIds],
      shipmentRef: ref
    });
    if (locker) {
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"),
        lockerId: locker.id,
        type: "expense",
        amountInr: Math.round(amount * 100) / 100,
        currency: locker.currency || "INR",
        category: `Expense \u2014 ${kind} \u2014 ${ref}`,
        refType: "expense",
        refId: id,
        recordedBy: by.id,
        createdAt: at2
      });
    }
    written++;
  }
  return written;
}
function isShippingExpense(e) {
  return !!e.orderIds?.length && (e.category === "Shipping" || !!e.shipmentRef);
}
function freightRecorded(d, orderId) {
  return (d.expenses ?? []).some((e) => isShippingExpense(e) && e.orderIds.includes(orderId));
}
function recordNoFreight(d, orderIds, reason, shipment, by, at2) {
  if (!orderIds.length) return;
  if (!d.expenses) d.expenses = [];
  const ref = `${shipment.courierName.trim()} ${shipment.trackingNumber.trim()}`.trim();
  d.expenses.push({
    id: uid("exp_"),
    title: `No freight \u2014 ${reason.trim() || "none charged"}${ref ? ` (${ref})` : ""}`,
    amount: 0,
    category: "Shipping",
    employeeId: by.id,
    currency: "INR",
    createdAt: at2,
    orderIds: [...orderIds],
    shipmentRef: ref || void 0
  });
}
function parcelsWithoutFreight(d) {
  const map = /* @__PURE__ */ new Map();
  for (const o of d.orders) {
    const shipped = (o.status === "Dispatched" || o.status === "Delivered") && !o.forReadyStock;
    if (!shipped || freightRecorded(d, o.id)) continue;
    const tn = (o.trackingNumber ?? "").trim().toUpperCase();
    const key = tn ? `${(o.courierName ?? "").trim().toUpperCase()}|${tn}` : `order:${o.id}`;
    const at2 = o.dispatchedAt ?? o.timeline.find((t) => t.step === "Dispatch" && t.status === "done")?.date ?? o.createdAt;
    const p2 = map.get(key) ?? { key, courierName: o.courierName ?? "", trackingNumber: o.trackingNumber ?? "", orders: [], dispatchedAt: at2 };
    p2.orders.push(o);
    if (at2 < p2.dispatchedAt) p2.dispatchedAt = at2;
    map.set(key, p2);
  }
  return [...map.values()].sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
}
function linkExpenseToShipment(d, expenseId, orderIds, shipmentRef) {
  const e = (d.expenses ?? []).find((x) => x.id === expenseId);
  if (!e) return false;
  e.orderIds = [.../* @__PURE__ */ new Set([...e.orderIds ?? [], ...orderIds])];
  if (!e.shipmentRef) e.shipmentRef = shipmentRef || "courier bill";
  return true;
}

// src/lib/orderCost.ts
var fmtRate = (n2, unit) => `\u20B9${n2.toLocaleString("en-IN", { maximumFractionDigits: 2 })}/${unit}`;
function saleDate(o) {
  if (o.dispatchedAt) return o.dispatchedAt;
  const step = (o.timeline ?? []).find((t) => t.step === "Dispatch" && t.status === "done");
  return step?.date ?? o.createdAt;
}
function recognisedSale(o) {
  return !o.forReadyStock && o.status !== "Rejected" && o.amount > 0 && (o.status === "Dispatched" || o.status === "Delivered");
}
function rateOn(db2, iso) {
  const table = [...db2.settings.fxRates ?? []].filter((r) => r.rate > 0 && !!r.from).sort((a, b) => a.from.localeCompare(b.from));
  if (table.length) {
    const day = dayOf(iso);
    let pick = null;
    for (const r of table) if (r.from <= day) pick = r;
    return pick ? { rate: pick.rate, basis: "dated", from: pick.from } : { rate: table[0].rate, basis: "earliest", from: table[0].from };
  }
  const single = db2.settings.usdToInr ?? 0;
  return single > 0 ? { rate: single, basis: "single" } : null;
}
var r2 = (n2) => Math.round(n2 * 100) / 100;
var qtyOf = (p2) => p2.material === "gold" ? p2.gold?.weightGrams ?? 0 : p2.diamond?.carat ?? 0;
function stockAverageRate(db2, material, bucket, at2) {
  const purchases = new Map((db2.purchases ?? []).map((p2) => [p2.id, p2]));
  const cutoff = +new Date(at2);
  const moves = (db2.stockMovements ?? []).filter((m) => m.material === material && m.purityOrQuality === bucket && +new Date(m.createdAt) <= cutoff).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  let bal = 0;
  let avg = null;
  for (const m of moves) {
    const q = Math.abs(m.quantity);
    if (m.type === "order_direct_use") continue;
    const incoming = m.type === "purchase_in" || m.type === "adjustment" && m.quantity > 0;
    if (!incoming) {
      bal = Math.max(0, bal - q);
      continue;
    }
    let rate = null;
    if (m.refType === "purchase" && m.refId) {
      const p2 = purchases.get(m.refId);
      if (p2?.orderId) continue;
      const pq = p2 ? qtyOf(p2) : 0;
      if (p2 && pq > 0) rate = p2.totalInr / pq;
    } else if (m.refType === "opening" && m.valueInr != null && q > 0) {
      rate = m.valueInr / q;
    }
    if (rate === null) {
      bal += q;
      continue;
    }
    avg = avg === null || bal <= 0 ? rate : (avg * bal + rate * q) / (bal + q);
    bal += q;
  }
  return avg === null ? null : r2(avg);
}
function orderCost(db2, order2, depth = 0) {
  const out = { gold: [], diamond: [], labour: [], other: [], totalInr: 0, missing: [], complete: true };
  const issuances = (db2.materialIssuances ?? []).filter((i) => i.orderId === order2.id);
  const purchases = db2.purchases ?? [];
  const counted = /* @__PURE__ */ new Set();
  for (const mi2 of issuances) {
    const unit = mi2.material === "gold" ? "g" : "ct";
    const bucket = mi2.material === "gold" ? out.gold : out.diamond;
    if (mi2.material === "diamond" && mi2.diamondKind === "certified") {
      for (const pid of mi2.diamondPacketIds ?? []) {
        const pk = (db2.diamondPackets ?? []).find((x) => x.id === pid);
        if (!pk) continue;
        if (pk.purchaseId) counted.add(pk.purchaseId);
        if (mi2.finishDisposition === "returned") continue;
        if (!pk.ratePerCaratInr) {
          out.missing.push({ label: `${pk.shape} ${pk.carat}ct (${pk.certificateNumber})`, reason: "no purchase rate recorded on the stone" });
          continue;
        }
        bucket.push({ label: `${pk.shape} ${pk.carat}ct certified \xB7 ${pk.certificateNumber}`, amountInr: r2(pk.ratePerCaratInr * pk.carat) });
      }
      if (mi2.sourcePurchaseId) counted.add(mi2.sourcePurchaseId);
      continue;
    }
    const returned = mi2.material === "diamond" ? mi2.finishReturnedCt ?? 0 : 0;
    const used = Math.max(0, r2(mi2.quantityIssued - returned));
    if (used <= 0) continue;
    if (mi2.source === "purchase" && mi2.sourcePurchaseId) {
      const p2 = purchases.find((x) => x.id === mi2.sourcePurchaseId);
      counted.add(mi2.sourcePurchaseId);
      const bought = p2 ? qtyOf(p2) : 0;
      if (!p2 || bought <= 0) {
        out.missing.push({ label: `${used}${unit} ${mi2.purityOrQuality}`, reason: "the purchase it came from is no longer on file" });
        continue;
      }
      bucket.push({
        label: `${used}${unit} ${mi2.purityOrQuality} \xB7 bought for this order${p2.invoiceNumber ? ` (bill ${p2.invoiceNumber})` : ""}`,
        amountInr: r2(p2.totalInr / bought * used)
      });
      continue;
    }
    const avg = stockAverageRate(db2, mi2.material, mi2.purityOrQuality, mi2.issuedAt) ?? stockAverageRate(db2, mi2.material, mi2.purityOrQuality, (/* @__PURE__ */ new Date()).toISOString());
    const where2 = mi2.source === "factoryPool" ? "from gold held at the factory" : "from stock";
    if (avg === null) {
      out.missing.push({
        label: `${used}${unit} ${mi2.purityOrQuality}`,
        reason: `${where2} \u2014 no ${mi2.purityOrQuality} has ever been bought with a price to value it by`
      });
      continue;
    }
    bucket.push({
      label: `${used}${unit} ${mi2.purityOrQuality} \xB7 ${where2}, at average cost ${fmtRate(avg, unit)}`,
      amountInr: r2(avg * used)
    });
  }
  for (const p2 of purchases) {
    if (p2.orderId !== order2.id || counted.has(p2.id)) continue;
    counted.add(p2.id);
    const q = qtyOf(p2);
    const unit = p2.material === "gold" ? "g" : "ct";
    const what = p2.material === "gold" ? p2.gold?.purity ?? "" : p2.diamond?.shape ?? "";
    (p2.material === "gold" ? out.gold : out.diamond).push({
      label: `${q}${unit} ${what} \xB7 bought for this order${p2.invoiceNumber ? ` (bill ${p2.invoiceNumber})` : ""}`,
      amountInr: r2(p2.totalInr)
    });
  }
  if (order2.materialSourcing === "readyStock" && order2.readyStockItemId && depth === 0) {
    const item = (db2.readyStock ?? []).find((i) => i.id === order2.readyStockItemId);
    const sold2 = order2.quantity || 1;
    const name = item ? item.sku ? `${item.sku} ${item.name}` : item.name : "the stock piece";
    const build = item && db2.orders.find((o) => o.readyStockCreatedId === item.id && o.id !== order2.id);
    const bc = build ? orderCost(db2, build, depth + 1) : null;
    const rate = rateOn(db2, saleDate(order2))?.rate ?? 0;
    if (build && bc && bc.totalInr > 0) {
      const pieces = build.quantity || 1;
      out.other.push({
        label: `${name} \u2014 made on ${build.orderNumber}${pieces > 1 ? `, ${sold2} of ${pieces} pieces` : ""}`,
        amountInr: r2(bc.totalInr / pieces * sold2)
      });
      for (const m of bc.missing) out.missing.push({ label: m.label, reason: `on ${build.orderNumber}: ${m.reason}` });
    } else if (item?.cost != null && item.cost > 0) {
      if (rate > 0) {
        out.other.push({ label: `${name} \u2014 cost entered on the stock item ($${item.cost}${sold2 > 1 ? ` \xD7 ${sold2}` : ""})`, amountInr: r2(item.cost * sold2 * rate) });
      } else {
        out.missing.push({ label: name, reason: "its cost is entered in dollars \u2014 set the exchange rate to count it" });
      }
    } else {
      out.missing.push({ label: name, reason: "sold from ready stock, and the piece has no cost recorded on its build or on the stock item" });
    }
  }
  for (const e of db2.expenses ?? []) {
    if (!e.orderIds?.includes(order2.id)) continue;
    const peers = e.orderIds.map((id) => db2.orders.find((o) => o.id === id)).filter((o) => !!o);
    const value = (o) => Math.max(0, orderTotal(o));
    const pool = peers.reduce((s, o) => s + value(o), 0);
    const share = pool > 0 ? value(order2) / pool : 1 / Math.max(peers.length, 1);
    let inr = e.amount;
    if (e.currency === "USD") {
      const fx2 = rateOn(db2, e.createdAt);
      inr = fx2 ? e.amount * fx2.rate : null;
    }
    if (inr === null) {
      out.missing.push({ label: e.title, reason: "paid in dollars \u2014 set the exchange rate to count it" });
      continue;
    }
    out.other.push({
      label: peers.length > 1 ? `${e.title} \u2014 ${Math.round(share * 100)}% of a ${peers.length}-order parcel` : e.title,
      amountInr: r2(inr * share)
    });
  }
  if (depth === 0 && recognisedSale(order2) && !freightRecorded(db2, order2.id)) {
    out.missing.push({ label: "Freight & insurance", reason: "not recorded for this shipment \u2014 enter it, or mark the parcel as having none" });
  }
  for (const mi2 of issuances) {
    const charge = mi2.makingCharges?.amountInr ?? 0;
    if (charge <= 0) continue;
    const f = db2.factories.find((x) => x.id === mi2.factoryId);
    out.labour.push({ label: `${f?.name ?? "Factory"} \u2014 making & labour`, amountInr: r2(charge) });
  }
  const all = [...out.gold, ...out.diamond, ...out.labour, ...out.other];
  out.totalInr = r2(all.reduce((s, l) => s + l.amountInr, 0));
  out.complete = out.missing.length === 0;
  return out;
}
function orderProfit(db2, order2) {
  const cost = orderCost(db2, order2);
  const sellingUsd = r2(orderTotal(order2));
  const fx2 = rateOn(db2, saleDate(order2));
  if (!fx2) return { cost, fx: fx2, sellingUsd, costUsd: null, profitUsd: null, marginPct: null };
  const costUsd = r2(cost.totalInr / fx2.rate);
  const profitUsd = r2(sellingUsd - costUsd);
  const marginPct = sellingUsd > 0 ? Math.round(profitUsd / sellingUsd * 1e3) / 10 : null;
  return { cost, fx: fx2, sellingUsd, costUsd, profitUsd, marginPct };
}
function inProfitReport(o) {
  return !o.forReadyStock && o.status !== "Rejected" && o.amount > 0 && (o.status === "Ready" || o.status === "Dispatched" || o.status === "Delivered");
}
function summarise(key, rows) {
  const sellingUsd = r2(rows.reduce((s, r) => s + r.sellingUsd, 0));
  const costInr = r2(rows.reduce((s, r) => s + r.costInr, 0));
  const costUsd = rows.length && rows.every((r) => r.costUsd !== null) ? r2(rows.reduce((s, r) => s + r.costUsd, 0)) : null;
  const profitUsd = costUsd === null ? null : r2(sellingUsd - costUsd);
  const marginPct = profitUsd === null || sellingUsd <= 0 ? null : Math.round(profitUsd / sellingUsd * 1e3) / 10;
  return { key, count: rows.length, sellingUsd, costInr, costUsd, profitUsd, marginPct, incomplete: rows.filter((r) => !r.complete).length };
}
function groupBy(rows, keyOf) {
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return [...map.entries()].map(([k, rs]) => summarise(k, rs));
}
function profitReport(db2, orders) {
  const rows = orders.map((o) => {
    const p2 = orderProfit(db2, o);
    return {
      order: o,
      sellingUsd: p2.sellingUsd,
      costInr: p2.cost.totalInr,
      costUsd: p2.costUsd,
      profitUsd: p2.profitUsd,
      marginPct: p2.marginPct,
      complete: p2.cost.complete,
      missing: p2.cost.missing,
      fx: p2.fx
    };
  });
  const clientName = (id) => db2.clients.find((c2) => c2.id === id)?.companyName ?? "Unknown";
  const monthOf = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const bySelling = (a, b) => b.sellingUsd - a.sellingUsd;
  return {
    /** Any order converted at a stand-in rate rather than its own day's. */
    approximateRates: rows.filter((r) => r.fx && r.fx.basis !== "dated").length,
    unconverted: rows.filter((r) => !r.fx).length,
    rows: [...rows].sort((a, b) => +new Date(saleDate(b.order)) - +new Date(saleDate(a.order))),
    totals: summarise("All", rows),
    byClient: groupBy(rows, (r) => clientName(r.order.clientId)).sort(bySelling),
    // Newest month first, the way every other ledger in the app reads.
    byMonth: groupBy(rows, (r) => monthOf(saleDate(r.order))).sort((a, b) => b.key.localeCompare(a.key)),
    byType: groupBy(rows, (r) => r.order.jewelleryType).sort(bySelling),
    /** Sold for less than they cost — the ones worth looking at first. */
    losses: rows.filter((r) => r.profitUsd !== null && r.profitUsd < 0).sort((a, b) => a.profitUsd - b.profitUsd)
  };
}
function operatingExpenses(db2, inPeriod) {
  const rows = (db2.expenses ?? []).filter((e) => !(e.orderIds && e.orderIds.length) && inPeriod(e.createdAt));
  let usd = 0;
  let inr = 0;
  let convertible = true;
  const byCategory = /* @__PURE__ */ new Map();
  for (const e of rows) {
    let asUsd;
    if (e.currency === "USD") {
      asUsd = e.amount;
      const fx2 = rateOn(db2, e.createdAt);
      inr += fx2 ? e.amount * fx2.rate : 0;
    } else {
      inr += e.amount;
      const fx2 = rateOn(db2, e.createdAt);
      asUsd = fx2 ? e.amount / fx2.rate : null;
    }
    if (asUsd === null) {
      convertible = false;
      continue;
    }
    usd += asUsd;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + asUsd);
  }
  return {
    count: rows.length,
    totalInr: r2(inr),
    totalUsd: convertible ? r2(usd) : null,
    byCategory: [...byCategory.entries()].map(([k, v]) => ({ category: k, usd: r2(v) })).sort((a, b) => b.usd - a.usd)
  };
}
function realisedRate(db2, a) {
  if (a.fromCredit) return null;
  if (a.receiptId) {
    const r = (db2.clientReceipts ?? []).find((x) => x.id === a.receiptId);
    if (r) {
      const cur = r.lockerCurrency ?? (r.lockerId ? db2.lockers.find((l) => l.id === r.lockerId)?.currency : void 0) ?? "INR";
      if (cur === "USD") return "held";
      if (r.exchangeRate && r.exchangeRate > 0) return r.exchangeRate;
      if (r.lockerAmount && r.amountUsd > 0) return r.lockerAmount / r.amountUsd;
      return null;
    }
  }
  if (a.lockerId) {
    const cur = db2.lockers.find((l) => l.id === a.lockerId)?.currency ?? "INR";
    if (cur === "USD") return "held";
    if (a.lockerAmount && a.amount > 0) return a.lockerAmount / a.amount;
  }
  return null;
}
function exchangeDifference(db2, order2) {
  if (!recognisedSale(order2)) return null;
  const booked = rateOn(db2, saleDate(order2));
  const out = { inr: 0, usd: null, convertedUsd: 0, heldUsd: 0, unknownUsd: 0 };
  for (const a of order2.advances ?? []) {
    if (!(a.amount > 0)) continue;
    const rate = realisedRate(db2, a);
    if (rate === "held") {
      out.heldUsd += a.amount;
      continue;
    }
    if (rate === null || !booked) {
      out.unknownUsd += a.amount;
      continue;
    }
    out.convertedUsd += a.amount;
    out.inr += a.amount * (rate - booked.rate);
  }
  out.inr = r2(out.inr);
  out.convertedUsd = r2(out.convertedUsd);
  out.heldUsd = r2(out.heldUsd);
  out.unknownUsd = r2(out.unknownUsd);
  out.usd = booked ? r2(out.inr / booked.rate) : null;
  return out;
}
function exchangeDifferenceTotal(db2, orders) {
  let inr = 0, usd = 0, convertedUsd = 0, heldUsd = 0, unknownUsd = 0;
  let convertible = true;
  for (const o of orders) {
    const x = exchangeDifference(db2, o);
    if (!x) continue;
    inr += x.inr;
    if (x.usd === null) convertible = false;
    else usd += x.usd;
    convertedUsd += x.convertedUsd;
    heldUsd += x.heldUsd;
    unknownUsd += x.unknownUsd;
  }
  return { inr: r2(inr), usd: convertible ? r2(usd) : null, convertedUsd: r2(convertedUsd), heldUsd: r2(heldUsd), unknownUsd: r2(unknownUsd) };
}

// ../../AppData/Local/Temp/claude/c--Users-STAFF1-Downloads-starlink/c5bbb088-23fd-4b5c-9f41-00ce64803fec/scratchpad/cost.ts
var r2t = (n2) => Math.round(n2 * 100) / 100;
var pass = 0;
var fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) + "\n       want " + JSON.stringify(want));
  }
}
var order = (id, amount, extra = {}) => ({
  id,
  orderNumber: "SLJ-" + id,
  clientId: "c1",
  amount,
  shippingCharge: 0,
  advances: [],
  timeline: [],
  ...extra
});
var base = () => ({
  orders: [],
  purchases: [],
  materialIssuances: [],
  diamondPackets: [],
  factories: [{ id: "f1", name: "Shreeji" }],
  clients: [],
  settings: { usdToInr: 84 }
});
var mi = (o) => ({
  factoryId: "f1",
  issuedAt: "",
  issuedBy: "",
  status: "open",
  finishedPieces: [],
  makingCharges: { amountInr: 0, payments: [] },
  ...o
});
console.log("\n\u2014 a purchase bought for the order AND issued from is counted once \u2014");
var db = base();
db.orders = [order("A", 1e3)];
db.purchases = [{ id: "p1", orderId: "A", material: "gold", gold: { weightGrams: 4, purity: "14K", ratePerGram: 6e3 }, totalInr: 24e3, invoiceNumber: "B-11" }];
db.materialIssuances = [mi({ id: "i1", orderId: "A", material: "gold", purityOrQuality: "14K", quantityIssued: 4, source: "purchase", sourcePurchaseId: "p1", makingCharges: { amountInr: 5e3, payments: [] } })];
var c = orderCost(db, db.orders[0]);
check("gold counted once", c.gold.map((l) => l.amountInr), [24e3]);
check("factory charge counted", c.labour.map((l) => l.amountInr), [5e3]);
check("total", c.totalInr, 29e3);
check("complete", c.complete, true);
console.log("\n\u2014 a bill for more than the piece used is apportioned \u2014");
db = base();
db.orders = [order("A", 1e3)];
db.purchases = [{ id: "p1", orderId: "A", material: "gold", gold: { weightGrams: 10, purity: "14K", ratePerGram: 6e3 }, totalInr: 6e4 }];
db.materialIssuances = [mi({ id: "i1", orderId: "A", material: "gold", purityOrQuality: "14K", quantityIssued: 4, source: "purchase", sourcePurchaseId: "p1" })];
c = orderCost(db, db.orders[0]);
check("only the 4g used, at the bill's rate", c.gold.map((l) => l.amountInr), [24e3]);
console.log("\n\u2014 loose stones sent back are not this order's cost \u2014");
db = base();
db.orders = [order("A", 1e3)];
db.purchases = [{ id: "p2", orderId: "A", material: "diamond", diamond: { carat: 2, shape: "Round", ratePerCarat: 5e4 }, totalInr: 1e5 }];
db.materialIssuances = [mi({ id: "i2", orderId: "A", material: "diamond", diamondKind: "loose", purityOrQuality: "Round", quantityIssued: 2, finishReturnedCt: 0.5, source: "purchase", sourcePurchaseId: "p2" })];
c = orderCost(db, db.orders[0]);
check("1.5ct used of 2ct", c.diamond.map((l) => l.amountInr), [75e3]);
console.log("\n\u2014 certified stones: kept ones valued, returned ones not \u2014");
db = base();
db.orders = [order("A", 5e3), order("B", 5e3)];
db.diamondPackets = [
  { id: "dp1", shape: "Oval", carat: 1.2, certificateNumber: "C1", ratePerCaratInr: 1e5, purchaseId: "p3" },
  { id: "dp2", shape: "Pear", carat: 0.8, certificateNumber: "C2", ratePerCaratInr: 9e4, purchaseId: "p4" }
];
db.purchases = [
  { id: "p3", orderId: "A", material: "diamond", diamond: { carat: 1.2, kind: "certified" }, totalInr: 12e4 },
  { id: "p4", orderId: "B", material: "diamond", diamond: { carat: 0.8, kind: "certified" }, totalInr: 72e3 }
];
db.materialIssuances = [
  mi({ id: "i3", orderId: "A", material: "diamond", diamondKind: "certified", diamondPacketIds: ["dp1"], purityOrQuality: "Oval", quantityIssued: 1.2, source: "purchase", sourcePurchaseId: "p3", finishDisposition: "used" }),
  mi({ id: "i4", orderId: "B", material: "diamond", diamondKind: "certified", diamondPacketIds: ["dp2"], purityOrQuality: "Pear", quantityIssued: 0.8, source: "purchase", sourcePurchaseId: "p4", finishDisposition: "returned" })
];
c = orderCost(db, db.orders[0]);
check("A: stone valued once, at its own rate", c.diamond.map((l) => l.amountInr), [12e4]);
check("A: its purchase is not added again", c.totalInr, 12e4);
var cB = orderCost(db, db.orders[1]);
check("B: returned stone costs nothing", cB.totalInr, 0);
check("B: and its bill is not counted either", cB.diamond.length, 0);
console.log("\n\u2014 stock-issued material is reported missing, not zero \u2014");
db = base();
db.orders = [order("A", 1e3)];
db.materialIssuances = [mi({ id: "i5", orderId: "A", material: "gold", purityOrQuality: "18K", quantityIssued: 3.2, source: "stock", makingCharges: { amountInr: 4e3, payments: [] } })];
c = orderCost(db, db.orders[0]);
check("not complete", c.complete, false);
check("the missing piece is named", c.missing.map((m) => m.label), ["3.2g 18K"]);
check("only what is known is totalled", c.totalInr, 4e3);
console.log("\n\u2014 a purchase for the order not yet issued still counts \u2014");
db = base();
db.orders = [order("A", 1e3)];
db.purchases = [{ id: "p6", orderId: "A", material: "gold", gold: { weightGrams: 5, purity: "14K", ratePerGram: 6e3 }, totalInr: 3e4 }];
c = orderCost(db, db.orders[0]);
check("bought, not yet issued", c.totalInr, 3e4);
console.log("\n\u2014 another order's purchases never leak in \u2014");
db = base();
db.orders = [order("A", 1e3), order("Z", 1e3)];
db.purchases = [{ id: "p7", orderId: "Z", material: "gold", gold: { weightGrams: 5, purity: "14K", ratePerGram: 6e3 }, totalInr: 3e4 }];
check("A's cost ignores Z's bill", orderCost(db, db.orders[0]).totalInr, 0);
console.log("\n\u2014 profit \u2014");
db = base();
db.orders = [order("A", 1e3, { shippingCharge: 50 })];
db.purchases = [{ id: "p8", orderId: "A", material: "gold", gold: { weightGrams: 4, purity: "14K", ratePerGram: 6e3 }, totalInr: 42e3 }];
var p = orderProfit(db, db.orders[0]);
check("selling includes shipping", p.sellingUsd, 1050);
check("cost converted at the rate", p.costUsd, 500);
check("profit", p.profitUsd, 550);
check("margin", p.marginPct, 52.4);
db.settings.usdToInr = void 0;
p = orderProfit(db, db.orders[0]);
check("no rate, no profit stated", [p.costUsd, p.profitUsd, p.marginPct], [null, null, null]);
check("cost in rupees still shown", p.cost.totalInr, 42e3);
console.log("\n\u2014 stock is valued at its running weighted average \u2014");
var mv = (id, type, q, day, extra = {}) => ({ id, material: "gold", type, purityOrQuality: "14K", quantity: q, createdBy: "", createdAt: new Date(2026, 0, day).toISOString(), ...extra });
db = base();
db.purchases = [
  { id: "s1", material: "gold", gold: { weightGrams: 10, purity: "14K" }, totalInr: 6e4 },
  { id: "s2", material: "gold", gold: { weightGrams: 10, purity: "14K" }, totalInr: 7e4 },
  { id: "s3", material: "gold", gold: { weightGrams: 5, purity: "14K" }, totalInr: 4e4, orderId: "Q" }
];
db.stockMovements = [
  mv("m1", "purchase_in", 10, 1, { refType: "purchase", refId: "s1" }),
  mv("m2", "purchase_in", 10, 5, { refType: "purchase", refId: "s2" }),
  mv("m3", "purchase_in", 5, 6, { refType: "purchase", refId: "s3" }),
  mv("m4", "order_direct_use", 5, 6, { refType: "order", refId: "Q" })
];
check("first lot only", stockAverageRate(db, "gold", "14K", new Date(2026, 0, 2).toISOString()), 6e3);
check("two lots, equal weight; an order's own purchase ignored", stockAverageRate(db, "gold", "14K", new Date(2026, 0, 10).toISOString()), 6500);
db.stockMovements = [
  mv("n1", "purchase_in", 10, 1, { refType: "purchase", refId: "s1" }),
  mv("n2", "issuance_out", 8, 2),
  mv("n3", "purchase_in", 10, 3, { refType: "purchase", refId: "s2" })
];
check("issues out do not move it; what is left does", stockAverageRate(db, "gold", "14K", new Date(2026, 0, 4).toISOString()), 6833.33);
db.stockMovements = [mv("o1", "purchase_in", 20, 1, { refType: "opening", valueInr: 11e4 })];
check("opening stock at its entered value", stockAverageRate(db, "gold", "14K", new Date(2026, 0, 2).toISOString()), 5500);
db.stockMovements = [
  mv("t1", "purchase_in", 10, 1, { refType: "purchase", refId: "s1" }),
  mv("t2", "purchase_in", 10, 2, { refType: "manual" })
];
check("unpriced top-up leaves the average alone", stockAverageRate(db, "gold", "14K", new Date(2026, 0, 3).toISOString()), 6e3);
console.log("\n\u2014 a stock-issued order is now costed, not missing \u2014");
db = base();
db.orders = [order("A", 1e3)];
db.purchases = [{ id: "s1", material: "gold", gold: { weightGrams: 10, purity: "14K" }, totalInr: 6e4 }];
db.stockMovements = [mv("m1", "purchase_in", 10, 1, { refType: "purchase", refId: "s1" })];
db.materialIssuances = [mi({ id: "i9", orderId: "A", material: "gold", purityOrQuality: "14K", quantityIssued: 3.5, source: "stock", issuedAt: new Date(2026, 0, 3).toISOString(), makingCharges: { amountInr: 4e3, payments: [] } })];
c = orderCost(db, db.orders[0]);
check("valued at the pool average", c.gold.map((l) => l.amountInr), [21e3]);
check("complete now", c.complete, true);
check("total includes labour", c.totalInr, 25e3);
db.materialIssuances = [mi({ id: "i10", orderId: "A", material: "gold", purityOrQuality: "14K", quantityIssued: 2, source: "factoryPool", issuedAt: new Date(2026, 0, 3).toISOString() })];
c = orderCost(db, db.orders[0]);
check("factory-held gold valued at the same average", c.gold.map((l) => l.amountInr), [12e3]);
db.stockMovements = [mv("u1", "purchase_in", 10, 1, { refType: "manual" })];
db.purchases = [];
c = orderCost(db, db.orders[0]);
check("never priced: still reported, not guessed", c.complete, false);
console.log("\n\u2014 which orders the report covers \u2014");
var st = (status, extra = {}) => order("x", 1e3, { status, ...extra });
check("finished work counts", ["Ready", "Dispatched", "Delivered"].map((s) => inProfitReport(st(s))), [true, true, true]);
check("work still being made does not", ["Waiting", "Approved", "In Production"].map((s) => inProfitReport(st(s))), [false, false, false]);
check("rejected does not", inProfitReport(st("Rejected")), false);
check("stock build does not", inProfitReport(st("Ready", { forReadyStock: true })), false);
check("unpriced does not", inProfitReport(order("y", 0, { status: "Delivered" })), false);
console.log("\n\u2014 the report totals and groups \u2014");
db = base();
db.settings.usdToInr = 80;
db.clients = [{ id: "c1", companyName: "GIVARA" }, { id: "c2", companyName: "AMATI" }];
db.orders = [
  order("R1", 1e3, { clientId: "c1", jewelleryType: "Ring", createdAt: new Date(2026, 8, 5).toISOString() }),
  order("R2", 500, { clientId: "c1", jewelleryType: "Pendant", createdAt: new Date(2026, 9, 2).toISOString() }),
  order("R3", 400, { clientId: "c2", jewelleryType: "Ring", createdAt: new Date(2026, 9, 9).toISOString() })
];
db.purchases = [
  { id: "q1", orderId: "R1", material: "gold", gold: { weightGrams: 4, purity: "14K" }, totalInr: 4e4 },
  // $500
  { id: "q2", orderId: "R2", material: "gold", gold: { weightGrams: 2, purity: "14K" }, totalInr: 24e3 },
  // $300
  { id: "q3", orderId: "R3", material: "gold", gold: { weightGrams: 4, purity: "14K" }, totalInr: 4e4 }
  // $500 — a loss
];
db.stockMovements = [];
db.materialIssuances = [];
var rep = profitReport(db, db.orders);
check("sales", rep.totals.sellingUsd, 1900);
check("cost converted once from the rupee total", rep.totals.costUsd, 1300);
check("profit", rep.totals.profitUsd, 600);
check("margin", rep.totals.marginPct, 31.6);
check("by client, biggest first", rep.byClient.map((g) => [g.key, g.count, g.profitUsd]), [["GIVARA", 2, 700], ["AMATI", 1, -100]]);
check("by month, newest first", rep.byMonth.map((g) => g.key), ["2026-10", "2026-09"]);
check("by item", rep.byType.map((g) => [g.key, g.count]), [["Ring", 2], ["Pendant", 1]]);
check("loss-makers picked out", rep.losses.map((r) => [r.order.id, r.profitUsd]), [["R3", -100]]);
check("groups add back up to the total", Math.round(rep.byClient.reduce((s, g) => s + (g.profitUsd ?? 0), 0) * 100) / 100, rep.totals.profitUsd);
console.log("\n\u2014 an incomplete order is counted, and flagged \u2014");
db.materialIssuances = [mi({ id: "z1", orderId: "R2", material: "gold", purityOrQuality: "22K", quantityIssued: 1, source: "stock", issuedAt: new Date(2026, 9, 3).toISOString() })];
var rep2 = profitReport(db, db.orders);
check("incomplete count", rep2.totals.incomplete, 1);
check("and against the right client", rep2.byClient.find((g) => g.key === "GIVARA").incomplete, 1);
console.log("\n\u2014 no rate: rupees only, no profit claimed \u2014");
db.settings.usdToInr = void 0;
var rep3 = profitReport(db, db.orders);
check("cost in rupees still totalled", rep3.totals.costInr, 104e3);
check("nothing converted", [rep3.totals.costUsd, rep3.totals.profitUsd, rep3.totals.marginPct], [null, null, null]);
check("and no loss is claimed either", rep3.losses.length, 0);
console.log("\n\u2014 sold from ready stock: the cost comes from the piece's build \u2014");
db = base();
db.settings.usdToInr = 80;
db.readyStock = [{ id: "rs1", name: "Bezel Band", sku: "RS-0043", cost: 300 }];
db.orders = [
  order("BUILD", 0, { forReadyStock: true, quantity: 2, readyStockCreatedId: "rs1", status: "Ready" }),
  order("SALE", 607, { materialSourcing: "readyStock", readyStockItemId: "rs1", quantity: 1, status: "Delivered" })
];
db.purchases = [{ id: "b1", orderId: "BUILD", material: "gold", gold: { weightGrams: 6, purity: "10K" }, totalInr: 3e4 }];
db.materialIssuances = [mi({ id: "bi", orderId: "BUILD", material: "gold", purityOrQuality: "10K", quantityIssued: 6, source: "purchase", sourcePurchaseId: "b1", makingCharges: { amountInr: 6e3, payments: [] } })];
db.stockMovements = [];
c = orderCost(db, db.orders[1]);
check("half the build, since it made two pieces", c.totalInr, 18e3);
check("and says where it came from", c.other.map((l) => l.label), ["RS-0043 Bezel Band \u2014 made on SLJ-BUILD, 1 of 2 pieces"]);
check("no longer a 100% profit", orderProfit(db, db.orders[1]).profitUsd, 382);
db.orders[1] = order("SALE", 1214, { materialSourcing: "readyStock", readyStockItemId: "rs1", quantity: 2, status: "Delivered" });
check("selling both pieces carries the whole build", orderCost(db, db.orders[1]).totalInr, 36e3);
db.orders = [order("SALE", 607, { materialSourcing: "readyStock", readyStockItemId: "rs1", quantity: 1, status: "Delivered" })];
c = orderCost(db, db.orders[0]);
check("stock item's own cost, converted", c.totalInr, 24e3);
db.settings.usdToInr = void 0;
check("in dollars with no rate: reported, not guessed", orderCost(db, db.orders[0]).complete, false);
db.readyStock = [{ id: "rs1", name: "Bezel Band" }];
c = orderCost(db, db.orders[0]);
check("nothing recorded anywhere: reported", [c.complete, c.totalInr], [false, 0]);
db.settings.usdToInr = 80;
db.readyStock = [{ id: "rs1", name: "Bezel Band", sku: "RS-0043" }];
db.orders = [
  order("BUILD", 0, { forReadyStock: true, quantity: 1, readyStockCreatedId: "rs1", status: "Ready" }),
  order("SALE", 607, { materialSourcing: "readyStock", readyStockItemId: "rs1", quantity: 1, status: "Delivered" })
];
var rpt = profitReport(db, db.orders.filter(inProfitReport));
check("report holds the sale, not the build", rpt.rows.map((r) => r.order.id), ["SALE"]);
check("with the build's full cost", rpt.totals.costInr, 36e3);
console.log("\n\u2014 the rate on the day: each holds from its date until the next \u2014");
db = base();
db.settings.usdToInr = 99;
db.settings.fxRates = [{ from: "2026-03-01", rate: 83 }, { from: "2026-08-01", rate: 85.5 }];
var at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
check("inside the first period", rateOn(db, at(2026, 5, 10)), { rate: 83, basis: "dated", from: "2026-03-01" });
check("on the day a rate starts", rateOn(db, at(2026, 8, 1))?.rate, 85.5);
check("before any rate: earliest stands in, and says so", rateOn(db, at(2026, 1, 5)), { rate: 83, basis: "earliest", from: "2026-03-01" });
check("dated rates outrank the old flat rate", rateOn(db, at(2026, 9, 1))?.rate, 85.5);
db.settings.fxRates = [];
check("no dated rates: the flat rate, labelled as such", rateOn(db, at(2026, 9, 1)), { rate: 99, basis: "single" });
db.settings.usdToInr = void 0;
check("no rate at all", rateOn(db, at(2026, 9, 1)), null);
console.log("\n\u2014 a sale is the day it left, and only shipped work is revenue \u2014");
check("dispatchedAt first", saleDate(order("s", 1, { dispatchedAt: "2026-05-02T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z" })), "2026-05-02T10:00:00.000Z");
check("then the closed Dispatch stage", saleDate(order("s", 1, { timeline: [{ step: "Dispatch", status: "done", date: "2026-04-04T10:00:00.000Z" }], createdAt: "2026-01-01T10:00:00.000Z" })), "2026-04-04T10:00:00.000Z");
check("Ready is finished but not sold", recognisedSale(order("s", 1e3, { status: "Ready" })), false);
check("Dispatched and Delivered are", ["Dispatched", "Delivered"].map((s) => recognisedSale(order("s", 1e3, { status: s }))), [true, true]);
console.log("\n\u2014 each sale converted at its own day's rate \u2014");
db = base();
db.settings.fxRates = [{ from: "2026-03-01", rate: 80 }, { from: "2026-08-01", rate: 100 }];
db.orders = [
  order("MAR", 1e3, { status: "Delivered", dispatchedAt: at(2026, 4, 1) }),
  order("SEP", 1e3, { status: "Delivered", dispatchedAt: at(2026, 9, 1) })
];
db.purchases = [
  { id: "f1", orderId: "MAR", material: "gold", gold: { weightGrams: 5, purity: "14K" }, totalInr: 4e4 },
  { id: "f2", orderId: "SEP", material: "gold", gold: { weightGrams: 5, purity: "14K" }, totalInr: 4e4 }
];
check("same rupee cost, April rate", orderProfit(db, db.orders[0]).costUsd, 500);
check("same rupee cost, September rate", orderProfit(db, db.orders[1]).costUsd, 400);
var twoRates = profitReport(db, db.orders);
check("the report adds the dollars as booked, not reconverted", twoRates.totals.costUsd, 900);
check("nothing flagged as approximate", twoRates.approximateRates, 0);
console.log("\n\u2014 freight on a shared parcel is split by value \u2014");
db = base();
db.orders = [order("BIG", 3e3, { status: "Dispatched" }), order("SMALL", 1e3, { status: "Dispatched" })];
db.expenses = [
  { id: "e1", title: "Freight \u2014 FedEx 77", amount: 4e3, currency: "INR", category: "Shipping", orderIds: ["BIG", "SMALL"], createdAt: at(2026, 9, 1) },
  { id: "e2", title: "Insurance \u2014 FedEx 77", amount: 50, currency: "USD", category: "Shipping", orderIds: ["BIG", "SMALL"], createdAt: at(2026, 9, 1) }
];
db.settings.fxRates = [{ from: "2026-01-01", rate: 80 }];
var big = orderCost(db, db.orders[0]);
var small = orderCost(db, db.orders[1]);
check("the $3,000 ring carries three quarters", big.other.map((l) => l.amountInr), [3e3, 3e3]);
check("the $1,000 band carries a quarter", small.other.map((l) => l.amountInr), [1e3, 1e3]);
check("dollar insurance converted on the day paid", big.other[1].amountInr, 50 * 80 * 0.75);
check("shares add back to the bill", r2t(big.totalInr + small.totalInr), 4e3 + 50 * 80);
check("and say it was shared", big.other[0].label, "Freight \u2014 FedEx 77 \u2014 75% of a 2-order parcel");
console.log("\n\u2014 overheads: running costs only, never the freight already in cost \u2014");
db.expenses = [
  ...db.expenses,
  { id: "o1", title: "Salary", amount: 8e4, currency: "INR", category: "Salary", createdAt: at(2026, 9, 5) },
  { id: "o2", title: "Rent", amount: 4e4, currency: "INR", category: "Office", createdAt: at(2026, 9, 6) },
  { id: "o3", title: "Old rent", amount: 4e4, currency: "INR", category: "Office", createdAt: at(2025, 9, 6) }
];
var inSep = (iso) => new Date(iso) >= new Date(2026, 8, 1) && new Date(iso) < new Date(2026, 9, 1);
var ox = operatingExpenses(db, inSep);
check("order-linked freight left out", ox.count, 2);
check("rupees converted at the day's rate", ox.totalUsd, (8e4 + 4e4) / 80);
check("by category", ox.byCategory.map((c2) => c2.category), ["Salary", "Office"]);
db.settings.fxRates = [];
check("flat rate is still a rate", operatingExpenses(db, inSep).totalUsd, 1428.57);
db.settings.usdToInr = void 0;
check("no rate: rupee total kept, no dollar figure claimed", [operatingExpenses(db, inSep).totalInr, operatingExpenses(db, inSep).totalUsd], [12e4, null]);
console.log("\n\u2014 recording a parcel's shipping cost \u2014");
db = base();
db.orders = [order("P1", 600), order("P2", 400)];
db.expenses = [];
db.lockerTransactions = [];
db.lockers = [{ id: "L1", name: "HDFC", currency: "INR", active: true }, { id: "L2", name: "USD A/c", currency: "USD", active: true }];
var n = recordShippingCost(db, ["P1", "P2"], { freight: 2500, insurance: 300, currency: "USD", lockerId: "L1" }, { courierName: "DHL", trackingNumber: "JD01" }, { id: "u1" }, at(2026, 9, 9));
check("two expenses written", n, 2);
check("in the paying account's currency, whatever was ticked", db.expenses.map((e) => e.currency), ["INR", "INR"]);
check("tied to both orders", db.expenses[0].orderIds, ["P1", "P2"]);
check("posted to the account's book", db.lockerTransactions.map((t) => t.type), ["expense", "expense"]);
db.expenses = [];
db.lockerTransactions = [];
n = recordShippingCost(db, ["P1"], { freight: 40, insurance: 0, currency: "USD" }, { courierName: "FedEx", trackingNumber: "9" }, { id: "u1" }, at(2026, 9, 9));
check("unpaid: one expense, no cash moved", [n, db.lockerTransactions.length], [1, 0]);
check("in the currency chosen", db.expenses[0].currency, "USD");
db.expenses = [];
check("nothing entered, nothing written", recordShippingCost(db, ["P1"], { freight: 0, insurance: 0, currency: "INR" }, { courierName: "x", trackingNumber: "y" }, { id: "u1" }, at(2026, 9, 9)), 0);
console.log("\n\u2014 (2) exchange difference: rupees received against rupees booked \u2014");
db = base();
db.settings.fxRates = [{ from: "2026-01-01", rate: 84 }];
db.lockers = [{ id: "INR1", name: "HDFC", currency: "INR", active: true }, { id: "USD1", name: "USD A/c", currency: "USD", active: true }];
db.clientReceipts = [
  { id: "r1", amountUsd: 600, lockerId: "INR1", lockerCurrency: "INR", exchangeRate: 85, date: at(2026, 9, 20) },
  { id: "r2", amountUsd: 300, lockerId: "USD1", lockerCurrency: "USD", date: at(2026, 9, 21) }
];
var sold = order("FX", 1e3, {
  status: "Delivered",
  dispatchedAt: at(2026, 9, 10),
  advances: [
    { id: "a1", amount: 600, receiptId: "r1", createdAt: at(2026, 9, 20) },
    // converted at 85, booked at 84
    { id: "a2", amount: 300, receiptId: "r2", createdAt: at(2026, 9, 21) },
    // still in dollars
    { id: "a3", amount: 100, fromCredit: true, createdAt: at(2026, 9, 22) }
    // credit: rate not on record
  ]
});
db.orders = [sold];
var fx = exchangeDifference(db, sold);
check("gain = 600 \xD7 (85 \u2212 84)", fx.inr, 600);
check("in dollars at the booking rate", fx.usd, r2t(600 / 84));
check("dollars still in a dollar account are not yet realised", fx.heldUsd, 300);
check("credit carried across is left out, not guessed", fx.unknownUsd, 100);
check("only the converted dollars carry a difference", fx.convertedUsd, 600);
check("a loss when the rupee came in weaker", exchangeDifference(db, { ...sold, advances: [{ id: "a", amount: 500, lockerId: "INR1", lockerAmount: 41500, createdAt: at(2026, 9, 25) }] }).inr, 500 * (83 - 84));
check("an order not yet sold has nothing to measure against", exchangeDifference(db, order("NS", 1e3, { status: "Ready", advances: [{ id: "x", amount: 500, receiptId: "r1" }] })), null);
check("totals across sales", exchangeDifferenceTotal(db, [sold]).inr, 600);
console.log("\n\u2014 (4) a shipped order with no freight on record is not free to send \u2014");
db = base();
db.orders = [order("SH", 1e3, { status: "Dispatched", courierName: "DHL", trackingNumber: "JD01", dispatchedAt: at(2026, 9, 1) })];
db.expenses = [];
c = orderCost(db, db.orders[0]);
check("flagged as missing", c.missing.map((m) => m.label), ["Freight & insurance"]);
check("so the cost is incomplete", c.complete, false);
check("an unshipped order is not flagged", orderCost(db, order("WIP", 1e3, { status: "In Production" })).missing.length, 0);
recordNoFreight(db, ["SH"], "collected in person", { courierName: "", trackingNumber: "" }, { id: "u" }, at(2026, 9, 1));
check("marked as no charge: complete", orderCost(db, db.orders[0]).complete, true);
check("and it leaves a trail, at nothing", db.expenses.map((e) => [e.amount, e.title]), [[0, "No freight \u2014 collected in person"]]);
console.log("\n\u2014 (4) the backlog: shipments grouped the way they went out \u2014");
db = base();
db.orders = [
  order("A1", 900, { status: "Dispatched", courierName: "DHL", trackingNumber: "jd01", dispatchedAt: at(2026, 9, 1) }),
  order("A2", 300, { status: "Delivered", courierName: "DHL", trackingNumber: "JD01 ", dispatchedAt: at(2026, 9, 1) }),
  order("B1", 500, { status: "Dispatched", courierName: "FedEx", trackingNumber: "77", dispatchedAt: at(2026, 9, 5) }),
  order("C1", 400, { status: "Delivered", dispatchedAt: at(2026, 8, 3) }),
  // no tracking at all
  order("D1", 400, { status: "In Production" })
  // not shipped
];
db.expenses = [{ id: "done", title: "Freight", amount: 1e3, category: "Shipping", orderIds: ["B1"], createdAt: at(2026, 9, 5) }];
var parcels = parcelsWithoutFreight(db);
check("same tracking number, one parcel \u2014 whatever the case or spacing", parcels.find((p2) => p2.orders.length === 2)?.orders.map((o) => o.id), ["A1", "A2"]);
check("a shipment with freight on record is not listed", parcels.some((p2) => p2.orders.some((o) => o.id === "B1")), false);
check("no tracking number: its own parcel", parcels.some((p2) => p2.key === "order:C1"), true);
check("unshipped work never appears", parcels.some((p2) => p2.orders.some((o) => o.id === "D1")), false);
check("newest shipment first", parcels.map((p2) => p2.orders[0].id), ["A1", "C1"]);
console.log("\n\u2014 (4) attaching a bill already in Expenses moves it, never copies it \u2014");
db.expenses = [
  { id: "bill", title: "DHL September bill", amount: 2400, currency: "INR", category: "Other", createdAt: at(2026, 9, 30) },
  { id: "rent", title: "Rent", amount: 3e4, currency: "INR", category: "Office", createdAt: at(2026, 9, 2) }
];
db.settings.fxRates = [{ from: "2026-01-01", rate: 80 }];
var sepAll = (iso) => new Date(iso) >= new Date(2026, 8, 1) && new Date(iso) < new Date(2026, 9, 1);
check("before: the bill is an overhead", operatingExpenses(db, sepAll).totalInr, 32400);
linkExpenseToShipment(db, "bill", ["A1", "A2"], "DHL JD01");
check("after: out of overheads", operatingExpenses(db, sepAll).totalInr, 3e4);
check("and into the parcel's cost, split by value", [orderCost(db, db.orders[0]).other[0].amountInr, orderCost(db, db.orders[1]).other[0].amountInr], [1800, 600]);
check("and the parcel's freight now counts as recorded", parcelsWithoutFreight(db).some((p2) => p2.orders.some((o) => o.id === "A1")), false);
check("the bill still exists once", db.expenses.length, 2);
console.log(`
${pass} passed, ${fail} failed
`);
if (fail) process.exit(1);
