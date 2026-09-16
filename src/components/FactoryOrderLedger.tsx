import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, toPureGold, pureFromPurity, type MaterialIssuance, type Order, type Factory } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { Input } from "@/components/ui/input";
import { Search, Download } from "lucide-react";

const g3 = (n: number) => (Math.abs(n) < 0.0005 ? "" : n.toFixed(3));
const rs = (n: number) => (Math.abs(n) < 0.5 ? "" : Math.round(n).toLocaleString("en-IN"));
/** An estimate prints with a ~ so it is never mistaken for a real weight. */
const est = (v: string) => (v ? `~${v}` : "");

export interface FactoryOrderRow {
  orderId: string;
  orderNo: string;
  date: string;
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
  /** True when the gold figure is the ESTIMATE taken at order creation rather
   *  than a weight actually issued. An order still in production has no real
   *  weight yet, and showing nothing left the ledger looking broken. */
  goldEstimated?: boolean;
  /** Same, for a diamond figure that came from the order rather than an issue. */
  diaEstimated?: boolean;
  /** Making charge quoted in USD when the factory was assigned, before the piece
   *  exists. Kept apart from the rupee labour so the two currencies never mix. */
  quotedUsd: number;
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
): FactoryOrderRow[] {
  const byOrder = new Map<string, FactoryOrderRow>();
  for (const mi of issuances) {
    const key = mi.orderId || "__pool";
    const order = orders.find(o => o.id === mi.orderId);
    let row = byOrder.get(key);
    if (!row) {
      row = {
        orderId: mi.orderId || "",
        orderNo: order?.orderNumber || (mi.orderId ? "—" : "Bulk / pool"),
        date: mi.issuedAt,
        jewellery: order?.jewelleryType || "",
        goldOut: 0, goldIn: 0, diaOut: 0, diaIn: 0, silverIn: 0, otherIn: 0,
        labour: 0, paid: 0, open: 0, total: 0,
        orderStatus: order?.status || "",
        quotedUsd: 0,
        metalNote: undefined,
      };
      byOrder.set(key, row);
    }
    // Earliest issue date is when this order went to the factory.
    if (+new Date(mi.issuedAt) < +new Date(row.date)) row.date = mi.issuedAt;
    row.total += 1;
    if (mi.status !== "closed") row.open += 1;

    if (mi.material === "gold") {
      if (mi.source !== "factoryPool") row.goldOut += toPureGold(mi.quantityIssued, mi.purityOrQuality);
      if (mi.finishedNetWeight != null) {
        row.goldIn += mi.finishedPurity != null
          ? pureFromPurity(mi.finishedNetWeight, mi.finishedPurity)
          : toPureGold(mi.finishedNetWeight, mi.finishedKarat || "24K");
      }
    }
    if (mi.material === "diamond") {
      row.diaOut += mi.quantityIssued;
      if (mi.status === "closed") {
        // Everything is accounted for once closed: what went into the piece
        // plus whatever came back to stock.
        row.diaIn += mi.quantityIssued;
      }
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
    row.metalNote = [order.productKarats, order.metal].filter(Boolean).join(" ");

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
    if (row.diaOut === 0 && order.diamondWeight > 0) {
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


  return [...byOrder.values()].sort((a, b) => +new Date(a.date) - +new Date(b.date));
}

export function FactoryOrderLedger({
  rows, factoryName, openingFineGold = 0, onExport,
}: {
  rows: FactoryOrderRow[];
  factoryName: string;
  /** Fine gold the factory already held at migration. The Factory Account card
   *  counts it, so this summary has to as well or the two disagree. */
  openingFineGold?: number;
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
      return r.orderNo.toLowerCase().includes(ql) || r.jewellery.toLowerCase().includes(ql);
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

  // Metal and diamond are what a jewellery factory holds, so those columns are
  // always there even at zero — a factory ledger with no metal column tells a
  // Gold, diamond and labour show for EVERY factory, at zero if need be. Hiding
  // a group when it happened to be empty meant one factory had a "Gold still at
  // factory" card and the next did not — two pages that should read the same way
  // looking like different reports.
  const hasGold = true;
  const hasDia = true;
  const hasSilver = rows.some(r => r.silverIn);
  const hasOther = rows.some(r => r.otherIn);
  const hasQuote = rows.some(r => r.quotedUsd > 0);
  const active = !!q.trim() || !!from || !!to || only !== "all";

  const num = "px-2 py-2 text-right whitespace-nowrap";
  const head = "px-2 py-2 text-right font-semibold whitespace-nowrap";

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-brand-dark">Factory Ledger — order by order</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            What went to {factoryName}, what came back, the labour and what is still open
          </p>
        </div>
        {onExport && (
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark shrink-0">
            <Download className="h-4 w-4" /> Export
          </button>
        )}
      </div>

      <div className="px-5 pt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {hasGold && (
          <div className="rounded-xl p-3 text-center bg-amber-500/10 text-amber-700">
            <p className="text-[10px] uppercase tracking-wider opacity-80">Gold still at factory</p>
            <p className="text-base font-semibold mt-0.5">{goldAtFactory.toFixed(3)} g fine</p>
            {openingFineGold > 0 && <p className="text-[10px] opacity-70">includes {openingFineGold.toFixed(3)} g opening</p>}
          </div>
        )}
        {hasDia && (
          <div className="rounded-xl p-3 text-center bg-blue-500/10 text-blue-700">
            <p className="text-[10px] uppercase tracking-wider opacity-80">Diamond not accounted</p>
            <p className="text-base font-semibold mt-0.5">{(T.diaOut - T.diaIn).toFixed(2)} ct</p>
          </div>
        )}
        <div className="rounded-xl p-3 text-center bg-secondary/60 text-brand-dark">
          <p className="text-[10px] uppercase tracking-wider opacity-70">Labour billed</p>
          <p className="text-base font-semibold mt-0.5">{fmtMoneyInr(T.labour)}</p>
        </div>
        <div className={`rounded-xl p-3 text-center ${T.labour - T.paid > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
          <p className="text-[10px] uppercase tracking-wider opacity-80">Labour pending</p>
          <p className="text-base font-semibold mt-0.5">{fmtMoneyInr(Math.max(0, T.labour - T.paid))}</p>
        </div>
      </div>

      <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search order no. or item…" className="rounded-xl h-9 pl-9" />
        </div>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl h-9 w-auto" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-xl h-9 w-auto" />
        <div className="inline-flex rounded-lg bg-secondary p-0.5">
          {(["all", "open", "done"] as const).map(k => (
            <button key={k} onClick={() => setOnly(k)}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${only === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
              {k === "all" ? "All" : k === "open" ? "Still with factory" : "Done"}
            </button>
          ))}
        </div>
        {active && (
          <button onClick={() => { setQ(""); setFrom(""); setTo(""); setOnly("all"); }}
            className="text-xs text-primary hover:underline">Reset</button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary/60 text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold" rowSpan={2}>Order</th>
              <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Date</th>
              <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Item</th>
              {hasGold && <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60" colSpan={3}>Gold (g fine)</th>}
              {hasDia && <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60" colSpan={3}>Diamond (ct)</th>}
              {hasSilver && <th className="px-2 py-2 text-right font-semibold border-l border-border/60" rowSpan={2}>Silver g</th>}
              {hasOther && <th className="px-2 py-2 text-right font-semibold border-l border-border/60" rowSpan={2}>Other g</th>}
              <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60" colSpan={3}>Labour (₹)</th>
              {hasQuote && <th className="px-2 py-2 text-right font-semibold border-l border-border/60" rowSpan={2}>Quoted $</th>}
              <th className="px-3 py-2 text-left font-semibold border-l border-border/60" rowSpan={2}>Status</th>
            </tr>
            <tr className="bg-secondary/40 text-muted-foreground text-[11px]">
              {hasGold && <><th className={`${head} border-l border-border/60`}>Issued</th><th className={head}>Returned</th><th className={head}>With factory</th></>}
              {hasDia && <><th className={`${head} border-l border-border/60`}>Issued</th><th className={head}>Accounted</th><th className={head}>Open</th></>}
              <th className={`${head} border-l border-border/60`}>Billed</th>
              <th className={head}>Paid</th>
              <th className={head}>Pending</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={14} className="px-5 py-10 text-center text-muted-foreground">
                {active ? "No order matches that." : "Nothing issued to this factory yet."}
              </td></tr>
            ) : filtered.map(r => {
              const goldBal = r.goldOut - r.goldIn;
              const diaBal = r.diaOut - r.diaIn;
              const pending = r.labour - r.paid;
              return (
                <tr key={r.orderId || r.orderNo} className="border-t border-border/40 hover:bg-secondary/30">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.orderId
                      ? <Link to={`/orders/${r.orderId}`} className="font-mono text-primary hover:underline">{r.orderNo}</Link>
                      : <span className="text-muted-foreground">{r.orderNo}</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.date)}</td>
                  <td className="px-2 py-2 min-w-[150px]">
                    {r.jewellery || "—"}
                    {r.metalNote && <span className="block text-[10px] text-muted-foreground">{r.metalNote}</span>}
                  </td>
                  {hasGold && (<>
                    <td className={`${num} border-l border-border/60${r.goldEstimated ? " italic text-muted-foreground" : ""}`}>{r.goldEstimated ? est(g3(r.goldOut)) : g3(r.goldOut)}</td>
                    <td className={num}>{g3(r.goldIn)}</td>
                    <td className={`${num} font-semibold ${goldBal > 0.0005 ? "text-amber-700" : "text-success"}`}>{r.goldEstimated ? "—" : (g3(goldBal) || "0")}</td>
                  </>)}
                  {hasDia && (<>
                    <td className={`${num} border-l border-border/60${r.diaEstimated ? " italic text-muted-foreground" : ""}`}>{r.diaOut ? (r.diaEstimated ? est(r.diaOut.toFixed(2)) : r.diaOut.toFixed(2)) : ""}</td>
                    <td className={num}>{r.diaIn ? r.diaIn.toFixed(2) : ""}</td>
                    <td className={`${num} font-semibold ${diaBal > 0.005 ? "text-blue-700" : "text-success"}`}>{r.diaEstimated ? "—" : (diaBal > 0.005 ? diaBal.toFixed(2) : "0")}</td>
                  </>)}
                  {hasSilver && <td className={`${num} border-l border-border/60`}>{g3(r.silverIn)}</td>}
                  {hasOther && <td className={`${num} border-l border-border/60`}>{g3(r.otherIn)}</td>}
                  <td className={`${num} border-l border-border/60`}>{rs(r.labour)}</td>
                  <td className={`${num} text-success`}>{rs(r.paid)}</td>
                  <td className={`${num} font-semibold ${pending > 0.5 ? "text-destructive" : "text-success"}`}>{pending > 0.5 ? rs(pending) : "—"}</td>
                  {hasQuote && <td className={`${num} border-l border-border/60 text-muted-foreground`}>{r.quotedUsd ? `$${Math.round(r.quotedUsd).toLocaleString()}` : ""}</td>}
                  <td className="px-3 py-2 whitespace-nowrap border-l border-border/60">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      r.open > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                      {r.open > 0 ? `${r.open} still with factory` : "Done"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="bg-secondary/60 font-semibold border-t-2 border-border">
                <td className="px-3 py-2" colSpan={3}>Totals{active ? " (filtered)" : ""}</td>
                {hasGold && (<>
                  <td className={`${num} border-l border-border/60`}>{g3(T.goldOut)}</td>
                  <td className={num}>{g3(T.goldIn)}</td>
                  <td className={num}>{g3(goldAtFactory) || "0"}</td>
                </>)}
                {hasDia && (<>
                  <td className={`${num} border-l border-border/60`}>{T.diaOut.toFixed(2)}</td>
                  <td className={num}>{T.diaIn.toFixed(2)}</td>
                  <td className={num}>{(T.diaOut - T.diaIn).toFixed(2)}</td>
                </>)}
                {hasSilver && <td className={`${num} border-l border-border/60`}>{g3(T.silverIn)}</td>}
                {hasOther && <td className={`${num} border-l border-border/60`}>{g3(T.otherIn)}</td>}
                <td className={`${num} border-l border-border/60`}>{rs(T.labour)}</td>
                <td className={num}>{rs(T.paid)}</td>
                <td className={num}>{rs(Math.max(0, T.labour - T.paid))}</td>
                {hasQuote && <td className={`${num} border-l border-border/60`}>${Math.round(filtered.reduce((s, r) => s + r.quotedUsd, 0)).toLocaleString()}</td>}
                <td className="border-l border-border/60" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-5 py-2 text-[11px] text-muted-foreground border-t border-border/40">
        Gold is in fine (24KT) grams so every karat compares. &ldquo;With factory&rdquo; is what they still hold of
        ours; &ldquo;Open&rdquo; diamond is issued but not yet accounted for. A figure written <span className="italic">~like this</span>
        is the estimate from order creation — that order has not reached Final Approval, so no real weight exists yet.
        &ldquo;Quoted&rdquo; is the making charge agreed in USD when the factory was assigned; the rupee labour columns
        are what has actually been billed.
      </p>
    </div>
  );
}
