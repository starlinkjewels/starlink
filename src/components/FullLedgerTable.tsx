import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Search, Download } from "lucide-react";

export interface FullLedgerRow {
  id: string;
  date: string;
  ref: string;
  particular: string;
  drGold: number; drSilver: number; drDia: number; drOther: number; drAmount: number;
  crGold: number; crSilver: number; crDia: number; crOther: number; crAmount: number;
  otherLabel?: string;
}

const n3 = (n: number) => (n ? n.toFixed(3) : "");
const n2 = (n: number) => (n ? Math.round(n).toLocaleString("en-IN") : "");

/**
 * The whole factory account on one sheet — gold, silver, diamond, other metal
 * and money, issued on the left and received on the right, exactly how a
 * jeweller's ledger book reads.
 *
 * Splitting it into a gold ledger, a diamond ledger and a charges statement
 * meant three screens and three downloads for one relationship, and no single
 * place to see whether a factory was square with us.
 */
export function FullLedgerTable({
  rows, title, caption, onExport,
}: {
  rows: FullLedgerRow[];
  title: string;
  caption?: string;
  onExport?: () => void;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromD = from ? new Date(`${from}T00:00:00`) : null;
    const toD = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter(r => {
      if (r.id === "opening") return true;
      const d = new Date(r.date);
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      if (!ql) return true;
      return r.particular.toLowerCase().includes(ql) || r.ref.toLowerCase().includes(ql);
    });
  }, [rows, q, from, to]);

  // Only show what this factory actually deals in. A diamond-only factory was
  // printing eight permanently blank columns — Gold, Silver, Other Metal and
  // Amount on both sides — which made a real ledger look broken and squeezed
  // the particulars into nothing.
  const used = rows.reduce((u, r) => ({
    gold: u.gold || !!r.drGold || !!r.crGold,
    silver: u.silver || !!r.drSilver || !!r.crSilver,
    dia: u.dia || !!r.drDia || !!r.crDia,
    other: u.other || !!r.drOther || !!r.crOther,
    amount: u.amount || !!r.drAmount || !!r.crAmount,
  }), { gold: false, silver: false, dia: false, other: false, amount: false });
  const cols: { key: keyof typeof used; label: string }[] = [
    { key: "gold", label: "Gold g" },
    { key: "silver", label: "Silver g" },
    { key: "dia", label: "Diamond ct" },
    { key: "other", label: "Other g" },
    { key: "amount", label: "Amount ₹" },
  ].filter(c => used[c.key as keyof typeof used]) as { key: keyof typeof used; label: string }[];
  const span = Math.max(1, cols.length);
  const valOf = (r: FullLedgerRow, side: "dr" | "cr", key: string) => {
    const v = (r as unknown as Record<string, number>)[`${side}${key[0].toUpperCase()}${key.slice(1)}`] ?? 0;
    return key === "amount" ? n2(v) : n3(v);
  };


  const T = filtered.reduce((t, r) => ({
    drGold: t.drGold + r.drGold, drSilver: t.drSilver + r.drSilver, drDia: t.drDia + r.drDia,
    drOther: t.drOther + r.drOther, drAmount: t.drAmount + r.drAmount,
    crGold: t.crGold + r.crGold, crSilver: t.crSilver + r.crSilver, crDia: t.crDia + r.crDia,
    crOther: t.crOther + r.crOther, crAmount: t.crAmount + r.crAmount,
  }), { drGold: 0, drSilver: 0, drDia: 0, drOther: 0, drAmount: 0, crGold: 0, crSilver: 0, crDia: 0, crOther: 0, crAmount: 0 });

  const active = !!q.trim() || !!from || !!to;
  const th = "px-2 py-2 text-right font-semibold whitespace-nowrap";

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-brand-dark">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>
        </div>
        {onExport && (
          <button onClick={onExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white hover:bg-secondary text-xs font-medium text-brand-dark shrink-0">
            <Download className="h-4 w-4" /> Export
          </button>
        )}
      </div>

      <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search particular or order…" className="rounded-xl h-9 pl-9" />
        </div>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl h-9 w-auto" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-xl h-9 w-auto" />
        {active && (
          <button onClick={() => { setQ(""); setFrom(""); setTo(""); }} className="text-xs text-primary hover:underline">Reset</button>
        )}
      </div>

      <div className="overflow-x-auto">
        {/* Width follows the columns actually shown, so a diamond-only factory
            fits without a horizontal scroll. */}
        <table className="w-full text-xs" style={{ minWidth: 420 + span * 2 * 92 }}>
          <thead>
            <tr className="bg-secondary/60 text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold" rowSpan={2}>Date</th>
              <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Ref</th>
              <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Particular</th>
              <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60 text-destructive" colSpan={span}>Issued / Owed (Debit)</th>
              <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60 text-success" colSpan={span}>Received / Paid (Credit)</th>
            </tr>
            <tr className="bg-secondary/40 text-muted-foreground text-[11px]">
              {cols.map((c, i) => (
                <th key={`dr-${c.key}`} className={`${th}${i === 0 ? " border-l border-border/60" : ""}`}>{c.label}</th>
              ))}
              {cols.map((c, i) => (
                <th key={`cr-${c.key}`} className={`${th}${i === 0 ? " border-l border-border/60" : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={3 + span * 2} className="px-5 py-10 text-center text-muted-foreground">
                {active ? "Nothing in that range." : "No entries yet."}
              </td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.id === "opening" ? "—" : fmtDate(r.date)}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-primary whitespace-nowrap">{r.ref}</td>
                <td className="px-2 py-2 min-w-[220px]" title={r.particular}>
                  {r.particular}{r.otherLabel ? ` (${r.otherLabel})` : ""}
                </td>
                {cols.map((c, i) => (
                  <td key={`dr-${c.key}`} className={`${th} text-destructive${i === 0 ? " border-l border-border/60" : ""}`}>{valOf(r, "dr", c.key)}</td>
                ))}
                {cols.map((c, i) => (
                  <td key={`cr-${c.key}`} className={`${th} text-success${i === 0 ? " border-l border-border/60" : ""}`}>{valOf(r, "cr", c.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="bg-secondary/60 font-semibold border-t-2 border-border">
                <td className="px-3 py-2" colSpan={3}>Totals{active ? " (filtered)" : ""}</td>
                {cols.map((c, i) => (
                  <td key={`tdr-${c.key}`} className={`${th}${i === 0 ? " border-l border-border/60" : ""}`}>
                    {c.key === "amount" ? n2(T.drAmount) : n3(T[`dr${c.key[0].toUpperCase()}${c.key.slice(1)}` as keyof typeof T])}
                  </td>
                ))}
                {cols.map((c, i) => (
                  <td key={`tcr-${c.key}`} className={`${th}${i === 0 ? " border-l border-border/60" : ""}`}>
                    {c.key === "amount" ? n2(T.crAmount) : n3(T[`cr${c.key[0].toUpperCase()}${c.key.slice(1)}` as keyof typeof T])}
                  </td>
                ))}
              </tr>
              <tr className="bg-white text-[11px] text-muted-foreground">
                <td className="px-3 py-2" colSpan={3}>Closing position (debit − credit)</td>
                {cols.filter(c => c.key !== "amount").map((c, i) => {
                  const key = `${c.key[0].toUpperCase()}${c.key.slice(1)}`;
                  const net = (T[`dr${key}` as keyof typeof T] as number) - (T[`cr${key}` as keyof typeof T] as number);
                  return (
                    <td key={`net-${c.key}`} className={`${th} text-brand-dark${i === 0 ? " border-l border-border/60" : ""}`}>{n3(net)}</td>
                  );
                })}
                <td className={`${th} text-brand-dark`} colSpan={span * 2 - (cols.filter(c => c.key !== "amount").length)}>
                  {used.amount
                    ? (T.crAmount - T.drAmount > 0
                        ? `₹${Math.round(T.crAmount - T.drAmount).toLocaleString("en-IN")} payable to the factory`
                        : T.crAmount - T.drAmount < 0
                          ? `₹${Math.round(T.drAmount - T.crAmount).toLocaleString("en-IN")} overpaid`
                          : "Charges cleared")
                    : ""}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-5 py-2 text-[11px] text-muted-foreground border-t border-border/40">
        Gold is in fine (24KT) grams, so every karat is comparable. A positive closing figure is what the factory
        still holds of ours; money runs the other way — a positive amount is what we still owe them.
      </p>
    </div>
  );
}
