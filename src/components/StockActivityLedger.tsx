import { Fragment, useState } from "react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import {
  canEditPurchase, canVoidPurchase, editPurchase, purchaseLabel, voidImpact,
  voidPurchase as voidPurchaseCascade, type PurchaseEdit,
} from "@/lib/purchaseVoid";
import { Pencil, Trash2 } from "lucide-react";
import { canEditIssuance, deleteIssuance, issuanceVoidImpact } from "@/lib/issuanceEdit";
import { canVoidSale, saleVoidImpact, voidDiamondSale } from "@/lib/diamondSaleVoid";
import { toast } from "sonner";
import { fmtDate, type Purchase } from "@/lib/db";
import { fmtMoneyInr, discountLabel } from "@/lib/manufacturing";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { ChevronRight } from "lucide-react";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";

const PAGE = 12;

/** One thing this page did, whichever tab did it. */
interface Row {
  id: string;
  date: string;
  kind: "Purchase" | "Opening stock" | "Assigned to factory" | "Diamond sold";
  party: string;
  material: string;
  qty: number;
  unit: "g" | "ct";
  amountInr?: number;
  remark?: string;
  /** A bill's own lines, when this row is a whole bill. */
  items?: { id: string; material: string; qty: number; unit: "g" | "ct"; amountInr: number; discountPct?: number }[];
  billNo?: string;
  /** Set when the purchase was bought for one order rather than into stock. */
  forOrder?: string;
}

/**
 * What Buy & Assign has actually done, in one list.
 *
 * The four tabs each wrote somewhere different — a purchase, a stock movement,
 * a factory issuance, a diamond sale — so there was nowhere to look afterwards
 * and no way to check a day's entries against the books. This reads all four
 * back and shows them the way the payments tables do: searchable, filterable by
 * date and kind, and downloadable as exactly what is on screen.
 */
export function StockActivityLedger() {
  const db = useDb();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("");
  const [material, setMaterial] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [billFilter, setBillFilter] = useState("");
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  /**
   * Correcting a purchase from the ledger.
   *
   * This is where someone comes looking for a purchase, so this is where it has
   * to be fixable. Both actions go through the same guarded helpers the order
   * page uses — they carry the change through the supplier's due, the factory
   * issue, the stock trail and any certified packet, and refuse outright when
   * it can no longer be unwound cleanly.
   */
  const openEdit = (id: string) => {
    const p = (db.purchases ?? []).find(x => x.id === id);
    if (!p) return;
    const check = canEditPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    setEditing(p);
  };

  const saveEdit = async (edit: PurchaseEdit) => {
    if (!editing) return;
    try {
      await editPurchase(db, editing, edit, user!.id);
      toast.success("Purchase corrected — supplier due, factory issue and stock updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the correction.");
    }
  };

  /** Gold handed to a factory in bulk. It draws down real stock, so entering it
   *  twice or for the wrong factory leaves the stock short until it is undone. */
  const removeAssignment = async (id: string) => {
    const mi = (db.materialIssuances ?? []).find(x => x.id === id);
    if (!mi) return;
    const check = canEditIssuance(db, mi);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!confirm([
      `Cancel this assignment of ${mi.quantityIssued}${mi.material === "gold" ? "g" : "ct"} ${mi.purityOrQuality}?`,
      "",
      ...issuanceVoidImpact(db, mi),
      "",
      "This cannot be undone.",
    ].join("\n"))) return;
    setRemovingId(id);
    try {
      await deleteIssuance(db, mi, user!.id);
      toast.success("Assignment cancelled — material returned to stock");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this.");
    } finally { setRemovingId(null); }
  };

  /** A diamond sold straight out of stock — wrong buyer, wrong rate, or simply
   *  entered twice. Reverses the stone, the sale and the money together. */
  const removeSale = async (id: string) => {
    const sale = (db.diamondSales ?? []).find(x => x.id === id);
    if (!sale) return;
    const check = canVoidSale(db, sale);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!confirm([
      `Cancel this sale of ${sale.carat}ct ${sale.shape}?`,
      "",
      ...saleVoidImpact(db, sale),
      "",
      "This cannot be undone.",
    ].join("\n"))) return;
    setRemovingId(id);
    try {
      await voidDiamondSale(db, sale, user!.id);
      toast.success("Sale cancelled — stone, sale and money all reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this sale.");
    } finally { setRemovingId(null); }
  };

  const remove = async (id: string) => {
    const p = (db.purchases ?? []).find(x => x.id === id);
    if (!p) return;
    const check = canVoidPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!confirm([
      `Remove this purchase of ${purchaseLabel(p)} (${fmtMoneyInr(p.totalInr)})?`,
      "",
      "What changes:",
      ...voidImpact(db, p),
      "",
      "This cannot be undone.",
    ].join("\n"))) return;
    setRemovingId(id);
    try {
      await voidPurchaseCascade(db, p, user!.id);
      toast.success("Purchase removed — supplier due, factory issue and stock all reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove this purchase.");
    } finally { setRemovingId(null); }
  };

  const all: Row[] = [];

  // EVERY material purchase, wherever it was entered — bought into stock here,
  // recorded on a supplier's page, or bought for one order. A purchase book is
  // checked bill by bill against all of them, so splitting them by the screen
  // they happened to be typed on made that impossible.
  //
  // A supplier's chitthi is ONE bill with a line per size, checked against its
  // own total, so lines saved together are shown as that bill rather than as
  // strangers. They stay separate purchases underneath: stock is per size.
  const bills = new Map<string, Row>();
  for (const p of db.purchases ?? []) {
    const isGold = p.material === "gold";
    const label = isGold
      ? `Gold ${p.gold?.purity ?? ""}`.trim()
      : `${p.diamond?.shape ?? "Diamond"}${p.diamond?.kind === "certified" ? " (certified)" : ""}`;
    const qty = isGold ? (p.gold?.weightGrams ?? 0) : (p.diamond?.carat ?? 0);
    const unit: "g" | "ct" = isGold ? "g" : "ct";
    // A bill number groups a bill outright; without one, the lines written in
    // the same save share a supplier and the exact moment they were saved.
    const key = p.invoiceNumber?.trim()
      ? `${p.supplierId}|no:${p.invoiceNumber.trim()}`
      : `${p.supplierId}|at:${p.createdAt}`;
    const existing = bills.get(key);
    if (existing) {
      existing.items!.push({ id: p.id, material: label, qty, unit, amountInr: p.totalInr, discountPct: p.discountPct });
      existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
      existing.amountInr = (existing.amountInr ?? 0) + p.totalInr;
      if (existing.unit !== unit) existing.unit = unit; // mixed bill — the count is shown per line
      continue;
    }
    const forOrder = p.orderId ? db.orders.find(o => o.id === p.orderId)?.orderNumber : undefined;
    bills.set(key, {
      id: p.id, date: p.createdAt, kind: "Purchase",
      forOrder,
      party: db.suppliers.find(s => s.id === p.supplierId)?.name ?? "Supplier",
      material: label, qty, unit, amountInr: p.totalInr,
      billNo: p.invoiceNumber?.trim() || undefined,
      remark: p.notes || undefined,
      items: [{ id: p.id, material: label, qty, unit, amountInr: p.totalInr, discountPct: p.discountPct }],
    });
  }
  for (const b of bills.values()) {
    if (b.items && b.items.length > 1) b.material = `${b.items.length} items`;
    all.push(b);
  }

  // Stock already owned, seeded at migration — the Opening Stock tab.
  for (const m of db.stockMovements ?? []) {
    if (m.refType !== "opening") continue;
    all.push({
      id: m.id, date: m.createdAt, kind: "Opening stock", party: "—",
      material: `${m.material === "gold" ? "Gold" : "Diamond"} ${m.purityOrQuality}`.trim(),
      qty: m.quantity, unit: m.material === "gold" ? "g" : "ct",
      amountInr: m.valueInr, remark: m.note,
    });
  }

  // Gold handed to a factory with no order behind it — the Assign Gold tab.
  for (const i of db.materialIssuances ?? []) {
    if (i.orderId || i.source !== "stock") continue;
    all.push({
      id: i.id, date: i.issuedAt, kind: "Assigned to factory",
      party: db.factories.find(f => f.id === i.factoryId)?.name ?? "Factory",
      material: `${i.material === "gold" ? "Gold" : "Diamond"} ${i.purityOrQuality}`.trim(),
      qty: i.quantityIssued, unit: i.material === "gold" ? "g" : "ct",
      remark: i.notes,
    });
  }

  // Sold straight out of stock — the Sell Diamond tab.
  for (const s of db.diamondSales ?? []) {
    all.push({
      id: s.id, date: s.createdAt, kind: "Diamond sold",
      party: s.clientId ? (db.clients.find(c => c.id === s.clientId)?.companyName ?? "Client") : (s.buyerName ?? "Buyer"),
      material: `${s.shape}${s.kind === "certified" ? " (certified)" : ""}`,
      qty: s.carat, unit: "ct", amountInr: s.totalInr, remark: s.notes,
    });
  }

  const ql = q.trim().toLowerCase();
  const rows = all
    .filter(r => {
      if (!inDateRange(r.date, from, to)) return false;
      if (kind && r.kind !== kind) return false;
      if (material && !r.material.toLowerCase().startsWith(material.toLowerCase())) return false;
      // Purchases entered before the bill number was required — the ones that
      // still need tying back to a chitthi.
      if (billFilter === "none" && r.billNo) return false;
      return !ql || r.party.toLowerCase().includes(ql)
        || r.material.toLowerCase().includes(ql)
        || (r.billNo ?? "").toLowerCase().includes(ql)
        || (r.items ?? []).some(it => it.material.toLowerCase().includes(ql))
        || (r.remark ?? "").toLowerCase().includes(ql);
    })
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));

  const filtered = !!(ql || from || to || kind || material || billFilter);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setKind(""); setMaterial(""); setBillFilter(""); setPage(1); };
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE, "act");

  const totalIn = rows.filter(r => r.kind === "Purchase" || r.kind === "Opening stock").reduce((s, r) => s + (r.amountInr ?? 0), 0);
  const totalOut = rows.filter(r => r.kind === "Diamond sold").reduce((s, r) => s + (r.amountInr ?? 0), 0);

  const HEAD = ["Sr", "Date", "Entry", "Bill no.", "Party", "Material", "Quantity", "Unit", "Amount (INR)", "Remark"];
  const body: (string | number)[][] = [];
  rows.forEach((r, i) => {
    body.push([i + 1, fmtDate(r.date), r.kind, r.billNo ?? "", r.party, r.material, r.qty, r.unit, r.amountInr ?? "", r.remark ?? ""]);
    // A bill's own lines follow it, so a download can be checked against the
    // chitthi a line at a time and not only on the total.
    if (r.items && r.items.length > 1) {
      for (const it of r.items) {
        body.push(["", "", "  item", "", "", it.material, it.qty, it.unit, it.amountInr, it.discountPct ? discountLabel(it.discountPct) : ""]);
      }
    }
  });

  const exportCsv = () => downloadCsv("Stock-Activity", HEAD, body);

  const exportPdf = () => downloadLedgerPdf({
    title: "Buy & Assign — Activity",
    subjectLines: [
      `${rows.length} entr${rows.length !== 1 ? "ies" : "y"} · ${rangeLabel(from, to)}`,
      [kind && `Entry: ${kind}`, material && `Material: ${material}`, ql && `Search: "${q.trim()}"`]
        .filter(Boolean).join(" · ") || "All entries",
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Bought in", value: fmtMoneyInr(totalIn) },
      { label: "Sold", value: fmtMoneyInr(totalOut) },
    ],
    landscape: true,
    columns: [
      { header: "Sr", x: 14 }, { header: "Date", x: 26 }, { header: "Entry", x: 56 },
      { header: "Bill no.", x: 100 }, { header: "Party", x: 128 }, { header: "Material", x: 172 },
      { header: "Qty", x: 218 }, { header: "Amount", x: 242 }, { header: "Remark", x: 268 },
    ],
    align: ["left", "left", "left", "left", "left", "left", "right", "right", "left"],
    rows: rows.map((r, i) => [
      String(i + 1), fmtDate(r.date), r.kind, (r.billNo ?? "").slice(0, 16),
      r.party.slice(0, 26), r.material.slice(0, 26),
      `${r.qty}${r.unit}`, r.amountInr != null ? fmtMoneyInr(r.amountInr) : "",
      (r.remark ?? "").slice(0, 16),
    ]),
    filename: "Stock-Activity",
  });

  return (
    <div className="card-luxe p-5">
      <div className="mb-3">
        <p className="font-display text-lg text-brand-dark leading-tight">Purchase &amp; Stock Ledger</p>
        <p className="text-xs text-muted-foreground">
          {rows.length} entr{rows.length !== 1 ? "ies" : "y"}{filtered ? ` of ${all.length}` : ""}
          {totalIn > 0 && <> · bought in {fmtMoneyInr(totalIn)}</>}
          {totalOut > 0 && <> · sold {fmtMoneyInr(totalOut)}</>}
          {(from || to) && <> · {rangeLabel(from, to)}</>}
        </p>
      </div>

      <LedgerFilters
        q={q} onQ={v => { setQ(v); setPage(1); }}
        placeholder="Search bill no., party, material, remark…"
        from={from} to={to}
        onFrom={v => { setFrom(v); setPage(1); }} onTo={v => { setTo(v); setPage(1); }}
        selects={[
          { label: "Entries", value: kind, onChange: v => { setKind(v); setPage(1); },
            options: ["Purchase", "Opening stock", "Assigned to factory", "Diamond sold"].map(k => ({ value: k, label: k })) },
          { label: "Materials", value: material, onChange: v => { setMaterial(v); setPage(1); },
            options: [{ value: "Gold", label: "Gold" }, { value: "Diamond", label: "Diamond" }] },
          { label: "Bills", value: billFilter, onChange: v => { setBillFilter(v); setPage(1); },
            options: [{ value: "none", label: "No bill number" }] },
        ]}
        active={filtered} onReset={reset}
        onPdf={exportPdf} onCsv={exportCsv}
      />

      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm min-w-[840px]">
          <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5">Sr</th>
              <th className="text-left px-3 py-2.5">Date</th>
              <th className="text-left px-3 py-2.5">Entry</th>
              <th className="text-left px-3 py-2.5">Bill no.</th>
              <th className="text-left px-3 py-2.5">Party</th>
              <th className="text-left px-3 py-2.5">Material</th>
              <th className="text-right px-3 py-2.5">Quantity</th>
              <th className="text-right px-3 py-2.5">Amount</th>
              <th className="text-left px-3 py-2.5">Remark</th>
              <th className="text-right px-5 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-muted-foreground">
                {filtered ? "Nothing matches these filters." : "Nothing bought, assigned or sold yet."}
              </td></tr>
            ) : paged.map((r, i) => {
              // A bill of several sizes opens to show its own lines, so the
              // chitthi can be checked a line at a time as well as on the total.
              const multi = (r.items?.length ?? 0) > 1;
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={`border-t border-border/40 hover:bg-secondary/30 ${multi ? "cursor-pointer" : ""}`}
                    onClick={multi ? () => setOpen(isOpen ? null : r.id) : undefined}>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">{(page - 1) * PAGE + i + 1}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.kind}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.billNo
                        ? <button type="button" onClick={e => { e.stopPropagation(); setQ(r.billNo!); setPage(1); }}
                            title="Show everything on this bill" className="font-mono text-[11px] text-primary hover:underline">
                            {r.billNo}
                          </button>
                        : <span className="font-mono text-[11px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-medium max-w-[160px] truncate" title={r.party}>
                      {r.party}
                      {r.forOrder && <span className="block text-[10px] text-muted-foreground">for {r.forOrder}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.material}>
                      {multi && <ChevronRight className={`inline h-3 w-3 mr-1 transition-transform ${isOpen ? "rotate-90" : ""}`} />}
                      {r.material}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{r.qty}{r.unit}</td>
                    <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{r.amountInr != null ? fmtMoneyInr(r.amountInr) : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.remark ?? ""}>{r.remark ?? "—"}</td>
                    {/* A bill of several lines is corrected line by line, since
                        each line is its own purchase with its own supplier due
                        and factory issue — so its actions sit on the lines, which
                        open below. Only the other three kinds of entry have
                        nothing to offer: a diamond sale, an opening balance and
                        a factory assignment are each undone where they were
                        made, not here. */}
                    <td className="px-5 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {r.kind === "Assigned to factory" ? (
                        <button onClick={() => removeAssignment(r.id)} disabled={removingId === r.id}
                          title="Cancel this assignment — the material goes back into stock"
                          className="h-7 w-7 rounded-lg grid place-items-center text-destructive hover:bg-destructive/10 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : r.kind === "Diamond sold" ? (
                        <button onClick={() => removeSale(r.id)} disabled={removingId === r.id}
                          title="Cancel this sale — reverses the stone, the sale and the money"
                          className="h-7 w-7 rounded-lg grid place-items-center text-destructive hover:bg-destructive/10 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : r.kind !== "Purchase" ? (
                        // An opening balance is a starting figure, not an event;
                        // it is corrected on the Stock page where it was set.
                        <span className="text-[11px] text-muted-foreground">—</span>
                      ) : multi ? (
                        <span className="text-[11px] text-muted-foreground">{isOpen ? "per item ↓" : "open to edit"}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <button onClick={() => openEdit(r.items![0].id)} title="Correct this purchase"
                            className="h-7 w-7 rounded-lg grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(r.items![0].id)} disabled={removingId === r.items![0].id}
                            title="Remove this purchase — reverses the supplier due, stock and factory issue"
                            className="h-7 w-7 rounded-lg grid place-items-center text-destructive hover:bg-destructive/10 disabled:opacity-50">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {multi && isOpen && r.items!.map((it, n) => (
                    <tr key={`${r.id}-${n}`} className="bg-secondary/30 text-xs">
                      <td className="px-5 py-1.5" />
                      <td className="px-3 py-1.5" colSpan={5}>
                        <span className="text-muted-foreground">{it.material}</span>
                        {it.discountPct ? <span className="text-muted-foreground"> · {discountLabel(it.discountPct)}</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-right">{it.qty}{it.unit}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{fmtMoneyInr(it.amountInr)}</td>
                      <td className="px-3 py-1.5" />
                      <td className="px-5 py-1.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <button onClick={() => openEdit(it.id)} title="Correct this item"
                            className="h-7 w-7 rounded-lg grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(it.id)} disabled={removingId === it.id}
                            title="Remove this item — reverses the supplier due, stock and factory issue"
                            className="h-7 w-7 rounded-lg grid place-items-center text-destructive hover:bg-destructive/10 disabled:opacity-50">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
        label={rows.length ? `Showing ${start + 1}–${end} of ${rows.length}` : undefined} />

      <EditPurchaseDialog
        purchase={editing}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
      />
    </div>
  );
}
