import { useMemo, useState, type ReactNode } from "react";
import { metalLabel } from "@/lib/metals";
import { Link } from "react-router-dom";
import { fmtDate, toPureGold, pureFromPurity, type MaterialIssuance, type Order, type Factory, type Settings } from "@/lib/db";
import { fmtMoneyInr, diamondFlow, otherFlow } from "@/lib/manufacturing";
import { isOtherMaterial, materialName, materialUnit } from "@/lib/materials";
import { Download, Coins, Gem, Hammer } from "lucide-react";
import { type TableFilter, StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { SectionTitle } from "@/components/SectionTitle";

// A zero prints as a dash, never as an empty cell. A blank reads as missing
// data; "—" says plainly that nothing moved.
const g3 = (n: number) => (Math.abs(n) < 0.0005 ? "—" : n.toFixed(3));
const rs = (n: number) => (Math.abs(n) < 0.5 ? "—" : Math.round(n).toLocaleString("en-IN"));
/** An estimate prints with a ~ so it is never mistaken for a real weight. */
const est = (v: string) => (v ? `~${v}` : "");

export interface FactoryOrderRow {
  /** The row's own key: the order, or the bulk delivery's own issue. */
  rowId?: string;
  orderId: string;
  orderNo: string;
  date: string;
  /** When the finished piece came back and its real weights were recorded.
   *  The order date alone said when the job started, never when it landed. */
  receivedDate?: string;
  /** The factory's own bill number for this piece. Several pieces share one,
   *  which is what lets a bill be totalled and checked as the factory sent it. */
  factoryBillNo?: string;
  /** True when the gold in the piece was drawn from the gold already sitting
   *  with this factory, rather than issued for this order. Such an order owes
   *  nothing on its own — the draw shows against the delivery that supplied it. */
  goldFromPool?: boolean;
  jewellery: string;
  goldOut: number;   // fine 24KT grams issued to the factory
  goldIn: number;    // fine 24KT grams back in the finished piece
  diaOut: number;    // carats issued
  diaIn: number;     // carats accounted for (used in the piece + returned)
  silverIn: number;  // second metal the factory put into the piece
  otherIn: number;
  labour: number;    // making charges billed
  paid: number;      // paid against those charges
  open: number;      // issuances still open
  total: number;     // issuances on this order
  orderStatus: string;
  /** "14K White Gold" — what the piece is made of, for the Item column. */
  metalNote?: string;
  /** The finished piece's net weight in grams, as recorded at Final Approval;
   *  before that, the order's estimate (netEstimated). 0 = none. */
  netWeight: number;
  netEstimated?: boolean;
  /** The order's design number, shown under the net weight. */
  designNo?: string;
  /** True when the gold figure is the ESTIMATE taken at order creation rather
   *  than a weight actually issued. An order still in production has no real
   *  weight yet, and showing nothing left the ledger looking broken. */
  goldEstimated?: boolean;
  /** Same, for a diamond figure that came from the order rather than an issue. */
  diaEstimated?: boolean;
  /** Making charge quoted in USD when the factory was assigned, before the piece
   *  exists. Kept apart from the rupee labour so the two currencies never mix. */
  quotedUsd: number;
  /** The entries behind the row: every gold and diamond movement and every
   *  labour payment, so this one table can be opened up rather than sending
   *  anyone to a second ledger to find out when something was paid. */
  entries: { id: string; date: string; text: string; qty?: string; amount?: number; kind: "out" | "in" | "pay" }[];
  /** Other materials on the job (Settings → Materials), each in its own unit: given and accounted for. */
  materials?: Record<string, { out: number; in: number }>;
}

/**
 * The factory account ORDER BY ORDER — what went out, what came back, what the
 * labour was, what is still owed and whether the job is finished.
 *
 * A movement-by-movement log ("Diamond issued", then "Diamond used in piece")
 * cannot answer the questions anyone actually has about a factory: how much
 * gold is still with them, which orders are done, how much labour is pending.
 * That detail is still there underneath; this is the summary it was missing.
 */
export function buildFactoryOrderRows(
  issuances: MaterialIssuance[],
  orders: Order[],
  /** For naming any other material on a job. */
  settings?: Pick<Settings, "materials">,
): FactoryOrderRow[] {
  const byOrder = new Map<string, FactoryOrderRow>();
  /** Rows with a real diamond issue — only the others may show the order's estimate. */
  const hasDiaIssue = new Set<string>();
  /** Net weight the factory issues recorded for each row's finished piece. */
  const issueNet = new Map<string, number>();
  for (const mi of issuances) {
    // Material handed over in BULK has no order. Each delivery is its own row —
    // lumping them into a single "pool" line hid when each one was given and how
    // much, which is the whole point of a ledger.
    const key = mi.orderId || mi.id;
    const order = orders.find(o => o.id === mi.orderId);
    let row = byOrder.get(key);
    if (!row) {
      row = {
        rowId: key,
        orderId: mi.orderId || "",
        orderNo: order?.orderNumber || (mi.orderId ? "—" : mi.source === "rework"
          ? `Repair${orders.find(o => o.id === mi.rework?.orderId)?.orderNumber ? ` ${orders.find(o => o.id === mi.rework?.orderId)!.orderNumber}` : ""}${mi.rework?.billNo ? ` · ${mi.rework.billNo}` : ""}`
          : "Bulk delivery"),
        date: mi.issuedAt,
        jewellery: order?.jewelleryType || `${materialName(settings, mi.material)} ${mi.purityOrQuality}`,
        goldOut: 0, goldIn: 0, diaOut: 0, diaIn: 0, silverIn: 0, otherIn: 0,
        labour: 0, paid: 0, open: 0, total: 0,
        orderStatus: order?.status || "",
        factoryBillNo: order?.factoryBillNo || undefined,
        quotedUsd: 0, entries: [],
        metalNote: undefined,
        netWeight: 0,
        receivedDate: undefined,
      };
      byOrder.set(key, row);
    }
    // Earliest issue date is when this order went to the factory.
    if (+new Date(mi.issuedAt) < +new Date(row.date)) row.date = mi.issuedAt;
    row.total += 1;
    if (mi.status !== "closed") row.open += 1;

    // The latest moment a finished piece was recorded against this order.
    for (const fp of mi.finishedPieces ?? []) {
      if (!row.receivedDate || +new Date(fp.recordedAt) > +new Date(row.receivedDate)) row.receivedDate = fp.recordedAt;
    }
    if (mi.material === "gold") {
      if (mi.source === "factoryPool") row.goldFromPool = true;
      if (mi.source !== "factoryPool") row.goldOut += toPureGold(mi.quantityIssued, mi.purityOrQuality);
      if (mi.finishedNetWeight != null) {
        issueNet.set(key, (issueNet.get(key) ?? 0) + mi.finishedNetWeight);
        row.goldIn += mi.finishedPurity != null
          ? pureFromPurity(mi.finishedNetWeight, mi.finishedPurity)
          : toPureGold(mi.finishedNetWeight, mi.finishedKarat || "24K");
      }
    }
    if (mi.material === "diamond") {
      // The same rule as the Factory Account card (diamondFlow): a pool draw is
      // not new stones, and a received piece's stones are accounted for before
      // the issue is closed. Counting either differently made the two disagree.
      const f = diamondFlow(mi);
      row.diaOut += f.out;
      row.diaIn += f.in;
      hasDiaIssue.add(key);
    }
    // Keep the entries behind the figures so the row can be opened up.
    if (mi.material === "gold") {
      if (mi.source !== "factoryPool" && !(mi.source === "melt" && mi.quantityIssued === 0)) {
        row.entries.push({
          id: mi.id + "-gin", date: mi.issuedAt, kind: "out",
          text: mi.source === "melt"
            ? `Melted piece back to the factory — ${mi.quantityIssued}g ${mi.purityOrQuality}`
            : mi.source === "rework" ? `Taken out of the piece in a repair — kept by the factory — ${mi.quantityIssued}g ${mi.purityOrQuality}`
            : `Gold given${mi.orderId ? "" : " (bulk delivery)"} — ${mi.quantityIssued}g ${mi.purityOrQuality}`,
          qty: `${toPureGold(mi.quantityIssued, mi.purityOrQuality).toFixed(3)} g fine`,
        });
      }
      if (mi.finishedNetWeight != null) {
        const fine = mi.finishedPurity != null
          ? pureFromPurity(mi.finishedNetWeight, mi.finishedPurity)
          : toPureGold(mi.finishedNetWeight, mi.finishedKarat || "24K");
        row.entries.push({
          id: mi.id + "-gout", date: mi.issuedAt, kind: "in",
          text: `Finished piece — net ${mi.finishedNetWeight}g${mi.finishedPurity ? ` @ ${mi.finishedPurity}‰` : ""}`,
          qty: `${fine.toFixed(3)} g fine`,
        });
      }
    }
    if (mi.material === "diamond") {
      row.entries.push({
        id: mi.id + "-din", date: mi.issuedAt, kind: "out",
        text: mi.source === "factoryPool"
          ? `Diamond taken from the factory's pool — ${mi.purityOrQuality} (already counted when the pool was delivered)`
          : `Diamond given${mi.orderId ? "" : " (bulk delivery)"} — ${mi.diamondKind === "certified" ? "certified" : mi.purityOrQuality}`,
        qty: `${mi.quantityIssued} ct`,
      });
      if (mi.status === "closed") {
        const ret = mi.diamondKind === "certified"
          ? (mi.finishDisposition === "returned" ? mi.quantityIssued : 0)
          : (mi.finishReturnedCt || 0);
        const used = Math.round((mi.quantityIssued - ret) * 1000) / 1000;
        if (used > 0) row.entries.push({ id: mi.id + "-du", date: mi.issuedAt, kind: "in", text: "Used in the piece", qty: `${used} ct` });
        if (ret > 0) row.entries.push({ id: mi.id + "-dr", date: mi.issuedAt, kind: "in", text: "Returned to stock", qty: `${ret} ct` });
      }
    }
    if (isOtherMaterial(mi.material)) {
      // In its own unit and under its own name — never added to the gold or diamond columns.
      const f = otherFlow(mi);
      const name = materialName(settings, mi.material), u = materialUnit(settings, mi.material);
      const m = (row.materials ??= {})[mi.material] ??= { out: 0, in: 0 };
      m.out += f.out; m.in += f.in;
      row.entries.push({ id: mi.id + "-xin", date: mi.issuedAt, kind: "out", text: `${name} given${mi.orderId ? "" : " (bulk delivery)"} — ${mi.purityOrQuality}`, qty: `${mi.quantityIssued} ${u}` });
      const ret = Math.min(mi.finishReturnedQty || 0, f.in);
      const used = Math.round((f.in - ret) * 1000) / 1000;
      if (used > 0) row.entries.push({ id: mi.id + "-xu", date: mi.issuedAt, kind: "in", text: `${name} used in the piece`, qty: `${used} ${u}` });
      if (ret > 0) row.entries.push({ id: mi.id + "-xr", date: mi.issuedAt, kind: "in", text: `${name} returned to stock`, qty: `${ret} ${u}` });
    }
    if (mi.makingCharges?.amountInr) {
      row.entries.push({ id: mi.id + "-chg", date: mi.issuedAt, kind: "out", text: "Labour billed", amount: mi.makingCharges.amountInr });
    }
    for (const pay of mi.makingCharges?.payments || []) {
      row.entries.push({
        id: pay.id, date: pay.createdAt, kind: "pay",
        text: `Labour paid${pay.note ? ` — ${pay.note}` : ""}`, amount: pay.amountInr,
      });
    }

    row.labour += mi.makingCharges?.amountInr || 0;
    row.paid += (mi.makingCharges?.payments || []).reduce((s, p) => s + p.amountInr, 0);
  }

  // What the ORDER knows, for anything the issuances do not. Before Final
  // Approval there is no real weight at all, so a ledger built only from
  // issuances showed blank rows for every job still in production. The estimate
  // taken at order creation goes in instead, flagged so it can never be read as
  // an actual figure.
  for (const row of byOrder.values()) {
    const order = orders.find(o => o.id === row.orderId);
    if (!order) continue;
    row.quotedUsd = order.estimatedMakingCharges || 0;
    row.metalNote = [order.productKarats, metalLabel(order.metal)].filter(Boolean).join(" ");
    // Any other material on the job, named in the item column: "14K Gold + 2.5 g Platinum".
    const extra = Object.entries(row.materials ?? {}).map(([k, v]) => `${Math.round(v.out * 1000) / 1000} ${materialUnit(settings, k)} ${materialName(settings, k)}`);
    if (extra.length) row.metalNote = [row.metalNote, ...extra].filter(Boolean).join(" + ");
    row.designNo = order.designNumber?.trim() || undefined;
    // The piece's net weight: the real one once it is recorded — on the order
    // at Final Approval, or (one older path) only on the factory issue — and the
    // order's estimate before that (marked, and kept out of the total).
    if (/gold|platinum|silver/i.test(order.metal)) {
      const recorded = order.actualNetWeight || issueNet.get(row.orderId || "") || 0;
      if (recorded) row.netWeight = Math.round(recorded * 1000) / 1000;
      else if (order.estimatedNetWeight) { row.netWeight = order.estimatedNetWeight; row.netEstimated = true; }
    }

    // Gold figures the ISSUANCES do not have. The Factory Account card is
    // computed from issuances alone, so anything read off the order is marked
    // and kept out of every total — otherwise this ledger and that card would
    // quote two different "gold at factory" figures for the same factory.
    const isMetal = /gold|platinum/i.test(order.metal);
    if (row.goldOut === 0 && row.goldIn === 0 && isMetal) {
      const w = order.actualNetWeight || order.estimatedNetWeight || order.metalWeight || 0;
      if (w > 0) {
        row.goldOut = order.productKarats ? toPureGold(w, order.productKarats) : w;
        row.goldEstimated = true;
      }
    }
    if (!hasDiaIssue.has(row.orderId) && row.diaOut === 0 && order.diamondWeight > 0) {
      row.diaOut = order.diamondWeight;
      row.diaEstimated = true;
    }

    if (order.metal === "Silver" && order.actualNetWeight && row.silverIn === 0) {
      row.silverIn = order.actualNetWeight;
    }
    const om = (order.otherMetal || "").trim();
    const w = order.otherMetalWeight || 0;
    if (om && w > 0) {
      if (/silver/i.test(om)) row.silverIn += w; else row.otherIn += w;
    }
  }


  for (const row of byOrder.values()) {
    row.entries.sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }

  // Newest order first. The latest job is the one being looked up; the oldest
  // was reached only by paging to the end.
  return [...byOrder.values()].sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export function FactoryOrderLedger({
  rows, factoryName, openingFineGold = 0, onExport, account,
}: {
  rows: FactoryOrderRow[];
  factoryName: string;
  /** Fine gold the factory already held at migration. The Factory Account card
   *  counts it, so this summary has to as well or the two disagree. */
  openingFineGold?: number;
  /** The factory's whole account. Unfiltered, the labour still owed is this
   *  figure — it counts the opening balance and advances that settle no one
   *  order, which a sum of order rows cannot see. */
  account?: { chargesPending: number; chargesOverpaid: number };
  onExport?: () => void;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [only, setOnly] = useState<"all" | "open" | "done">("all");

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromD = from ? new Date(`${from}T00:00:00`) : null;
    const toD = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter(r => {
      if (only === "open" && r.open === 0) return false;
      if (only === "done" && r.open > 0) return false;
      const d = new Date(r.date);
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      if (!ql) return true;
      // Searching the factory's bill number pulls up every piece on that bill,
      // and the totals row then adds up exactly what the bill should say.
      return r.orderNo.toLowerCase().includes(ql)
        || r.jewellery.toLowerCase().includes(ql)
        || (r.factoryBillNo ?? "").toLowerCase().includes(ql);
    });
  }, [rows, q, from, to, only]);

  // Estimates are for reading, never for totalling: a figure taken from an order
  // that has not been finally approved is not material the factory holds, and
  // adding it made "Diamond not accounted" disagree with the Factory Account card
  // above. Only real issues and returns are summed, plus the opening gold.
  const T = filtered.reduce((t, r) => ({
    goldOut: t.goldOut + (r.goldEstimated ? 0 : r.goldOut),
    goldIn: t.goldIn + (r.goldEstimated ? 0 : r.goldIn),
    diaOut: t.diaOut + (r.diaEstimated ? 0 : r.diaOut),
    diaIn: t.diaIn + r.diaIn,
    silverIn: t.silverIn + r.silverIn, otherIn: t.otherIn + r.otherIn,
    labour: t.labour + r.labour, paid: t.paid + r.paid,
  }), { goldOut: 0, goldIn: 0, diaOut: 0, diaIn: 0, silverIn: 0, otherIn: 0, labour: 0, paid: 0 });
  const goldAtFactory = openingFineGold + T.goldOut - T.goldIn;

  // Gold, diamond and labour show for EVERY factory, at zero if need be — two
  // factory pages read the same way. Silver, other metal and the USD quote only
  // when a factory has them.
  const hasSilver = rows.some(r => r.silverIn);
  const hasOther = rows.some(r => r.otherIn);
  const hasQuote = rows.some(r => r.quotedUsd > 0);
  const active = !!q.trim() || !!from || !!to || only !== "all";

  const filters: TableFilter[] = [
    { kind: "date", from, to, onChange: (f, t) => { setFrom(f); setTo(t); } },
    { kind: "select", label: "Status", allLabel: "All", value: only === "all" ? "" : only,
      onChange: v => setOnly((v || "all") as typeof only),
      options: [{ value: "open", label: "Still with factory" }, { value: "done", label: "Done" }] },
  ];
  const clearFilters = () => { setFrom(""); setTo(""); setOnly("all"); };
  const searchLabel = "Search order no., item, or factory bill no…";

  const n = (s: ReactNode, cls = "") => <span className={`tabular-nums whitespace-nowrap ${cls}`}>{s}</span>;
  const columns: DataColumn<FactoryOrderRow>[] = [
    { key: "order", header: "Order", always: true, sortValue: r => r.orderNo, csv: r => r.orderNo,
      cell: r => (r.orderId
        ? <Link to={`/orders/${r.orderId}`} className="font-mono text-primary hover:underline whitespace-nowrap">{r.orderNo}</Link>
        : <span className="font-medium text-amber-700 whitespace-nowrap">{r.orderNo}</span>) },
    { key: "bill", header: "Factory bill", sortValue: r => r.factoryBillNo ?? "", csv: r => r.factoryBillNo ?? "",
      cell: r => (r.factoryBillNo
        ? <button type="button" data-no-row onClick={e => { e.stopPropagation(); setQ(r.factoryBillNo!); }}
            title="Show every piece on this bill" className="font-mono text-[11px] text-primary hover:underline">{r.factoryBillNo}</button>
        : <span className="text-muted-foreground">—</span>) },
    { key: "date", header: "Date", kind: "date", sortValue: r => r.date, csv: r => fmtDate(r.date),
      cell: r => (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {fmtDate(r.date)}
          {r.receivedDate && <span className="block text-[10px] text-success" title="When the finished piece came back and its actual details were recorded">rcv {fmtDate(r.receivedDate)}</span>}
        </span>
      ) },
    { key: "item", header: "Item", sortValue: r => r.jewellery, csv: r => [r.jewellery, r.metalNote].filter(Boolean).join(" · "),
      cell: r => <CellMain title={<span className="font-normal">{r.jewellery || "—"}</span>} sub={r.metalNote} /> },
    { key: "net", header: "Net wt (g)", align: "right", kind: "number", sortValue: r => r.netWeight, csv: r => (r.netWeight ? r.netWeight.toFixed(3) : ""),
      cell: r => (
        <span className="text-right whitespace-nowrap tabular-nums">
          <span className={r.netEstimated ? "italic text-muted-foreground" : "font-medium"} title={r.netEstimated ? "Estimate — not yet finally approved" : undefined}>
            {r.netWeight ? `${r.netEstimated ? "~" : ""}${r.netWeight.toFixed(3)}` : "—"}
          </span>
          {r.designNo && <span className="block text-[10px] text-muted-foreground">#{r.designNo}</span>}
        </span>
      ) },
    { key: "goldOut", header: "Gold given (g fine)", align: "right", kind: "number", sortValue: r => r.goldOut, csv: r => g3(r.goldOut),
      cell: r => n(r.goldEstimated ? est(g3(r.goldOut)) : g3(r.goldOut), r.goldEstimated ? "italic text-muted-foreground" : "") },
    { key: "goldIn", header: "Gold in piece (g fine)", align: "right", kind: "number", sortValue: r => r.goldIn, csv: r => g3(r.goldIn),
      cell: r => n(g3(r.goldIn)) },
    { key: "goldBal", header: "Gold balance (g fine)", align: "right", kind: "number", sortValue: r => r.goldOut - r.goldIn, csv: r => g3(r.goldOut - r.goldIn),
      cell: r => {
        const bal = r.goldOut - r.goldIn;
        // A piece made from gold already sitting with this factory owes nothing on
        // its own — the draw belongs to the delivery that supplied it.
        const pool = !!r.goldFromPool && r.goldOut < 0.0005 && r.goldIn > 0.0005;
        return (
          <span title={pool ? "Made from the gold already with this factory — counted against the delivery that supplied it"
            : bal < 0 ? "The factory supplied this gold — we owe it back" : bal > 0 ? "Our gold still with the factory" : ""}>
            {n(r.goldEstimated || pool ? "—" : g3(bal), `font-semibold ${pool ? "text-muted-foreground" : bal > 0.0005 ? "text-amber-700" : bal < -0.0005 ? "text-destructive" : "text-muted-foreground"}`)}
          </span>
        );
      } },
    { key: "diaOut", header: "Diamond given (ct)", align: "right", kind: "number", sortValue: r => r.diaOut, csv: r => (r.diaOut ? r.diaOut.toFixed(2) : ""),
      cell: r => n(r.diaOut ? (r.diaEstimated ? est(r.diaOut.toFixed(2)) : r.diaOut.toFixed(2)) : "", r.diaEstimated ? "italic text-muted-foreground" : "") },
    { key: "diaIn", header: "Diamond used (ct)", align: "right", kind: "number", sortValue: r => r.diaIn, csv: r => (r.diaIn ? r.diaIn.toFixed(2) : ""),
      cell: r => n(r.diaIn ? r.diaIn.toFixed(2) : "") },
    { key: "diaBal", header: "Diamond balance (ct)", align: "right", kind: "number", sortValue: r => r.diaOut - r.diaIn, csv: r => (r.diaOut - r.diaIn).toFixed(2),
      cell: r => { const bal = r.diaOut - r.diaIn; return n(r.diaEstimated ? "—" : bal > 0.005 ? bal.toFixed(2) : "0", `font-semibold ${bal > 0.005 ? "text-blue-700" : "text-muted-foreground"}`); } },
    ...(hasSilver ? [{ key: "silver", header: "Silver (g)", align: "right" as const, kind: "number" as const, sortValue: (r: FactoryOrderRow) => r.silverIn, csv: (r: FactoryOrderRow) => g3(r.silverIn),
      cell: (r: FactoryOrderRow) => n(g3(r.silverIn)) }] : []),
    ...(hasOther ? [{ key: "other", header: "Other (g)", align: "right" as const, kind: "number" as const, sortValue: (r: FactoryOrderRow) => r.otherIn, csv: (r: FactoryOrderRow) => g3(r.otherIn),
      cell: (r: FactoryOrderRow) => n(g3(r.otherIn)) }] : []),
    { key: "labour", header: "Labour billed (₹)", align: "right", kind: "number", sortValue: r => r.labour, csv: r => Math.round(r.labour),
      cell: r => n(rs(r.labour)) },
    // Paid by us, not money received: plain. Nothing pending: grey.
    { key: "paid", header: "Labour paid (₹)", align: "right", kind: "number", sortValue: r => r.paid, csv: r => Math.round(r.paid),
      cell: r => n(rs(r.paid)) },
    { key: "pending", header: "Labour pending (₹)", align: "right", kind: "number", sortValue: r => r.labour - r.paid, csv: r => Math.max(0, Math.round(r.labour - r.paid)),
      cell: r => { const p = r.labour - r.paid; return n(p > 0.5 ? rs(p) : "—", p > 0.5 ? "font-semibold text-destructive" : "text-muted-foreground"); } },
    ...(hasQuote ? [{ key: "quoted", header: "Quoted $", align: "right" as const, kind: "number" as const, sortValue: (r: FactoryOrderRow) => r.quotedUsd, csv: (r: FactoryOrderRow) => r.quotedUsd || "",
      cell: (r: FactoryOrderRow) => n(r.quotedUsd ? `$${Math.round(r.quotedUsd).toLocaleString()}` : "", "text-muted-foreground") }] : []),
    { key: "status", header: "Status", sortValue: r => r.open, csv: r => (r.open > 0 ? `${r.open} still with factory` : "Done"),
      cell: r => <CellTag tone={r.open > 0 ? "amber" : "green"}>{r.open > 0 ? `${r.open} still with factory` : "Done"}</CellTag> },
  ];

  // The entries behind a row, when it is opened.
  type Entry = FactoryOrderRow["entries"][number];
  const entryCols: DataColumn<Entry>[] = [
    { key: "date", header: "Date", always: true, cell: en => <span className="text-muted-foreground whitespace-nowrap tabular-nums">{fmtDate(en.date)}</span> },
    { key: "text", header: "Entry", cell: en => <span className={en.kind === "pay" ? "text-success" : "text-foreground"}>{en.text}</span> },
    { key: "qty", header: "Quantity / amount", align: "right", cell: en => n(en.qty ?? (en.amount != null ? fmtMoneyInr(en.amount) : "")) },
  ];

  // The whole factory's figures are the account card's above, so they show here
  // only for a narrowed view — what the rows shown hold and owe — or where this
  // ledger stands without that card.
  const strip = (active || !account) ? (() => {
    const whole = !active && account;
    const pending = whole ? account.chargesPending : Math.max(0, T.labour - T.paid);
    const credit = whole && account.chargesPending === 0 ? account.chargesOverpaid : 0;
    return (
      <StatStrip items={[
        { label: goldAtFactory < 0 ? "Gold we owe the factory" : "Gold still at factory", value: `${Math.abs(goldAtFactory).toFixed(3)} g fine`, icon: Coins },
        { label: "Diamond not accounted", value: `${(T.diaOut - T.diaIn).toFixed(2)} ct`, icon: Gem },
        { label: "Labour billed", value: fmtMoneyInr(T.labour), icon: Hammer },
        { label: credit > 0 ? "Paid in advance" : whole ? "Labour pending" : "Pending on these rows", value: fmtMoneyInr(credit > 0 ? credit : pending), tone: pending > 0 ? "out" as const : undefined },
      ]} note={active ? "For the rows shown" : openingFineGold > 0 ? `Gold includes ${openingFineGold.toFixed(3)} g opening` : undefined} />
    );
  })() : undefined;

  return (
    <div className="card-luxe overflow-hidden">
      {/* The reading guide that used to sit under the table lives behind the ⓘ. */}
      <div className="px-5 py-4 border-b border-border/60">
        <SectionTitle title="Factory Ledger" sub={factoryName} info={<>
          Open a row for every entry behind it. Gold is in fine (24K) grams; a negative gold balance means the
          factory supplied it and is owed that much back. <span className="italic">~Like this</span> is an estimate
          from order creation. A <span className="font-medium text-amber-700">Bulk delivery</span> is material given
          without an order. &ldquo;Quoted&rdquo; is the USD making charge agreed at assignment; the ₹ labour columns
          are what was billed. A dash means nothing moved.
        </>} />
      </div>
      {/* The app's one table — the same toolbar (search, Filters, the count, the arrows,
          View, Export), table or cards, as every other list; a row opens into its entries. */}
      <div className="px-5 py-4">
        <DataTable
          id="factory-order-ledger"
          noun="order"
          rows={filtered}
          columns={columns}
          rowKey={r => r.rowId ?? (r.orderId || r.orderNo)}
          search={{ value: q, onChange: setQ, placeholder: searchLabel, ariaLabel: searchLabel }}
          filters={filters}
          onClearFilters={clearFilters}
          exports={onExport ? [{ label: "PDF or Excel", icon: Download, hint: "Pick dates or one order", onSelect: onExport }] : undefined}
          exportScope={`${factoryName} — the factory ledger or the movement sheet`}
          details={false}
          expand={{
            render: r => (r.entries.length
              ? <DataTable id="factory-ledger-entries" controls="none" noun="entry" plural="entries" rows={r.entries} columns={entryCols} rowKey={en => en.id} details={false} />
              : <p className="text-xs text-muted-foreground">Nothing issued or paid yet — the figures are estimates.</p>),
          }}
          totalsLabel={`Totals${active ? " (filtered)" : ""}`}
          totals={{
            net: rs2 => n((() => { const t = rs2.reduce((s, r) => s + (r.netEstimated ? 0 : r.netWeight), 0); return t ? t.toFixed(3) : "—"; })()),
            goldOut: () => n(g3(T.goldOut)),
            goldIn: () => n(g3(T.goldIn)),
            goldBal: () => n(g3(goldAtFactory) || "0"),
            diaOut: () => n(T.diaOut.toFixed(2)),
            diaIn: () => n(T.diaIn.toFixed(2)),
            diaBal: () => n((T.diaOut - T.diaIn).toFixed(2)),
            silver: () => n(g3(T.silverIn)),
            other: () => n(g3(T.otherIn)),
            labour: () => n(rs(T.labour)),
            paid: () => n(rs(T.paid)),
            pending: () => n(rs(Math.max(0, T.labour - T.paid))),
            quoted: rs2 => n(`$${Math.round(rs2.reduce((s, r) => s + r.quotedUsd, 0)).toLocaleString()}`),
          }}
          emptyText={active ? "No order matches that." : "Nothing issued to this factory yet."}
          summary={strip}
        />
      </div>
    </div>
  );
}
