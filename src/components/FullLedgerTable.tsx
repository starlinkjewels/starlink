import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Search, Download } from "lucide-react";

/** One movement in one material — the shape a ledger line actually has. */
export interface MovementRow {
  id: string;
  date: string;
  ref: string;
  particular: string;
  /** "Gold (g fine)", "Diamond (ct)", "Amount (₹)" … */
  material: string;
  out: number;     // issued to the factory / charged to us
  in: number;      // returned by the factory / paid by us
  balance: number; // running, within this material
  money?: boolean; // format as rupees rather than a weight
}

const w3 = (n: number) => (Math.abs(n) < 0.0005 ? "" : n.toFixed(3));
const rs = (n: number) => (Math.abs(n) < 0.5 ? "" : Math.round(n).toLocaleString("en-IN"));
const cell = (n: number, money?: boolean) => (money ? rs(n) : w3(n));

/**
 * The movement sheet: every issue and return in date order, each with its own
 * running balance in its own material.
 *
 * This used to be drawn as a jeweller's two-sided book — a block of material
 * columns on the left for debit and the same block again on the right for
 * credit. With one material that left a page of white space between two thin
 * columns; with five it ran off the paper. One flowing table with a Material
 * column reads the same way and works at any number of materials.
 */
export function FullLedgerTable({
  rows, title, caption, onExport,
}: {
  rows: MovementRow[];
  title: string;
  caption?: string;
  onExport?: () => void;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mat, setMat] = useState("all");

  const materials = useMemo(() => [...new Set(rows.map(r => r.material))], [rows]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromD = from ? new Date(`${from}T00:00:00`) : null;
    const toD = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter(r => {
      if (mat !== "all" && r.material !== mat) return false;
      if (r.id !== "opening") {
        const d = new Date(r.date);
        if (fromD && d < fromD) return false;
        if (toD && d > toD) return false;
      }
      if (!ql) return true;
      return r.particular.toLowerCase().includes(ql) || r.ref.toLowerCase().includes(ql);
    });
  }, [rows, q, from, to, mat]);

  const { paged, page, setPage, totalPages, start, end } = usePagination(filtered, 15);
  const active = !!q.trim() || !!from || !!to || mat !== "all";

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
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }}
            placeholder="Search particular or order…" className="rounded-xl h-9 pl-9" />
        </div>
        <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} className="rounded-xl h-9 w-auto" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} className="rounded-xl h-9 w-auto" />
        {materials.length > 1 && (
          <div className="inline-flex rounded-lg bg-secondary p-0.5 flex-wrap">
            <button onClick={() => { setMat("all"); setPage(1); }}
              className={`px-3 h-8 rounded-md text-xs font-medium ${mat === "all" ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>All</button>
            {materials.map(m => (
              <button key={m} onClick={() => { setMat(m); setPage(1); }}
                className={`px-3 h-8 rounded-md text-xs font-medium ${mat === m ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>{m}</button>
            ))}
          </div>
        )}
        {active && (
          <button onClick={() => { setQ(""); setFrom(""); setTo(""); setMat("all"); setPage(1); }}
            className="text-xs text-primary hover:underline">Reset</button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Date</th>
              <th className="px-2 py-2 text-left font-semibold">Order / Ref</th>
              <th className="px-2 py-2 text-left font-semibold">Particular</th>
              <th className="px-2 py-2 text-left font-semibold">Material</th>
              <th className="px-2 py-2 text-right font-semibold text-destructive">Out</th>
              <th className="px-2 py-2 text-right font-semibold text-success">In</th>
              <th className="px-4 py-2 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                {active ? "Nothing in that range." : "No movements yet."}
              </td></tr>
            ) : paged.map(r => (
              <tr key={r.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{r.id === "opening" ? "Opening" : fmtDate(r.date)}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-primary whitespace-nowrap">{r.ref}</td>
                <td className="px-2 py-2 min-w-[200px]">{r.particular}</td>
                <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{r.material}</td>
                <td className="px-2 py-2 text-right text-destructive font-medium whitespace-nowrap">{cell(r.out, r.money)}</td>
                <td className="px-2 py-2 text-right text-success font-medium whitespace-nowrap">{cell(r.in, r.money)}</td>
                <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{cell(r.balance, r.money) || "0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5">
        <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
          label={filtered.length ? `Showing ${start + 1}–${end} of ${filtered.length}` : undefined} />
      </div>
    </div>
  );
}
