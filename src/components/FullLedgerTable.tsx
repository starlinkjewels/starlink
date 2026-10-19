import { useMemo, useState } from "react";
import { TableBox } from "@/components/TableBox";
import { fmtDate } from "@/lib/db";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { Search, Download, X } from "lucide-react";
import { IfExport } from "@/components/IfExport";
import { ExportMenu, FilterChips, FiltersButton, type TableFilter } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";

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

  // The dates and (with more than one) the material, behind one Filters
  // button; every change starts again from the first page.
  const filters: TableFilter[] = [
    { kind: "date", from, to, onChange: (f, t) => { setFrom(f); setTo(t); setPage(1); } },
  ];
  if (materials.length > 1) filters.push({
    kind: "select", label: "Material", allLabel: "All", value: mat === "all" ? "" : mat,
    onChange: v => { setMat(v || "all"); setPage(1); },
    options: materials.map(m => ({ value: m, label: m })),
  });
  const clearFilters = () => { setFrom(""); setTo(""); setMat("all"); setPage(1); };
  const searchLabel = "Search particular or order…";

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <SectionTitle title={title} sub={caption} />
      </div>

      {/* One toolbar row: search, Filters and the download; what is narrowing
          the rows shows as chips under it. The count is in the pager below. */}
      <div className="px-5 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder={searchLabel} aria-label={searchLabel}
              className="h-9 w-full rounded-xl border border-border bg-white pl-9 pr-8 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40" />
            {q && (
              <button type="button" onClick={() => { setQ(""); setPage(1); }} aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <FiltersButton filters={filters} onClear={clearFilters} count={`${filtered.length} ${filtered.length === 1 ? "line" : "lines"}`} />
          {onExport && (
            <div className="ml-auto">
              <IfExport>
                <ExportMenu scope={title} exports={[{ label: "PDF or Excel", icon: Download, hint: "Pick the dates, then the file", onSelect: onExport }]} />
              </IfExport>
            </div>
          )}
        </div>
        <FilterChips filters={filters} onClear={clearFilters} />
      </div>

      <TableBox className="mx-4 sm:mx-5">
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
      </TableBox>
      <div className="px-5">
        <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
          label={filtered.length ? `Showing ${start + 1}–${end} of ${filtered.length}` : undefined} />
      </div>
    </div>
  );
}
