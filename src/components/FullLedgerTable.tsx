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
        <table className="w-full text-xs min-w-[1040px]">
          <thead>
            <tr className="bg-secondary/60 text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold" rowSpan={2}>Date</th>
              <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Ref</th>
              <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Particular</th>
              <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60 text-destructive" colSpan={5}>Issued / Owed (Debit)</th>
              <th className="px-2 py-1.5 text-center font-semibold border-l border-border/60 text-success" colSpan={5}>Received / Paid (Credit)</th>
            </tr>
            <tr className="bg-secondary/40 text-muted-foreground text-[11px]">
              <th className={`${th} border-l border-border/60`}>Gold g</th>
              <th className={th}>Silver g</th>
              <th className={th}>Diamond ct</th>
              <th className={th}>Other g</th>
              <th className={th}>Amount ₹</th>
              <th className={`${th} border-l border-border/60`}>Gold g</th>
              <th className={th}>Silver g</th>
              <th className={th}>Diamond ct</th>
              <th className={th}>Other g</th>
              <th className={th}>Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={13} className="px-5 py-10 text-center text-muted-foreground">
                {active ? "Nothing in that range." : "No entries yet."}
              </td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.id === "opening" ? "—" : fmtDate(r.date)}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-primary whitespace-nowrap">{r.ref}</td>
                <td className="px-2 py-2 max-w-[260px] truncate" title={r.particular}>
                  {r.particular}{r.otherLabel ? ` (${r.otherLabel})` : ""}
                </td>
                <td className={`${th} border-l border-border/60 text-destructive`}>{n3(r.drGold)}</td>
                <td className={`${th} text-destructive`}>{n3(r.drSilver)}</td>
                <td className={`${th} text-destructive`}>{n3(r.drDia)}</td>
                <td className={`${th} text-destructive`}>{n3(r.drOther)}</td>
                <td className={`${th} text-destructive`}>{n2(r.drAmount)}</td>
                <td className={`${th} border-l border-border/60 text-success`}>{n3(r.crGold)}</td>
                <td className={`${th} text-success`}>{n3(r.crSilver)}</td>
                <td className={`${th} text-success`}>{n3(r.crDia)}</td>
                <td className={`${th} text-success`}>{n3(r.crOther)}</td>
                <td className={`${th} text-success`}>{n2(r.crAmount)}</td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="bg-secondary/60 font-semibold border-t-2 border-border">
                <td className="px-3 py-2" colSpan={3}>Totals{active ? " (filtered)" : ""}</td>
                <td className={`${th} border-l border-border/60`}>{n3(T.drGold)}</td>
                <td className={th}>{n3(T.drSilver)}</td>
                <td className={th}>{n3(T.drDia)}</td>
                <td className={th}>{n3(T.drOther)}</td>
                <td className={th}>{n2(T.drAmount)}</td>
                <td className={`${th} border-l border-border/60`}>{n3(T.crGold)}</td>
                <td className={th}>{n3(T.crSilver)}</td>
                <td className={th}>{n3(T.crDia)}</td>
                <td className={th}>{n3(T.crOther)}</td>
                <td className={th}>{n2(T.crAmount)}</td>
              </tr>
              <tr className="bg-white text-[11px] text-muted-foreground">
                <td className="px-3 py-2" colSpan={3}>Closing position (debit − credit)</td>
                <td className={`${th} border-l border-border/60 text-brand-dark`}>{n3(T.drGold - T.crGold)}</td>
                <td className={`${th} text-brand-dark`}>{n3(T.drSilver - T.crSilver)}</td>
                <td className={`${th} text-brand-dark`}>{n3(T.drDia - T.crDia)}</td>
                <td className={`${th} text-brand-dark`}>{n3(T.drOther - T.crOther)}</td>
                <td className={`${th} text-brand-dark`} colSpan={6}>
                  {T.crAmount - T.drAmount > 0
                    ? `₹${Math.round(T.crAmount - T.drAmount).toLocaleString("en-IN")} payable to the factory`
                    : T.crAmount - T.drAmount < 0
                      ? `₹${Math.round(T.drAmount - T.crAmount).toLocaleString("en-IN")} overpaid`
                      : "Charges cleared"}
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
