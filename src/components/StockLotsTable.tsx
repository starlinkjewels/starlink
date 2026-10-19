import { useMemo, useState } from "react";
import { useDb } from "@/hooks/useDb";
import { deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { toPureGold } from "@/lib/db";
import { lotBalances, lotLabel } from "@/lib/diamondLots";
import { stockAverageRate } from "@/lib/orderCost";
import { materialUnit, fmtQty, type MaterialKey } from "@/lib/materials";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { Coins, Gem, Layers, Wallet } from "lucide-react";

/** One line of stock: a gold purity, a loose-diamond lot, or a material's grade. */
interface Row {
  key: string;
  shape?: string; size?: string; color?: string; clarity?: string;
  qty: number;
  pcs: number | null;
  /** Fine (24K) grams, for gold. */
  fine?: number;
  /** Average cost per unit, from what was paid (purchases with their brokerage, opening values). */
  avg: number | null;
  value: number | null;
}

const ALL = "";
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What is in stock, line by line — the same table for every material: gold by
 * purity, loose diamonds by LOT (shape · size · colour · clarity, with pieces),
 * any other material by grade. Each line shows what it holds, its average cost
 * per unit and its value; loose diamonds filter by each part of the lot. A row
 * opens its movement history below (`onSelect`).
 */
export function StockLotsTable({ material, companyId, selected, onSelect }: {
  material: MaterialKey; companyId: string; selected: string | null; onSelect: (key: string | null) => void;
}) {
  const db = useDb();
  const unit = materialUnit(db.settings, material);
  const diamond = material === "diamond";
  const [shape, setShape] = useState(ALL);
  const [size, setSize] = useState(ALL);
  const [color, setColor] = useState(ALL);
  const [clarity, setClarity] = useState(ALL);

  const rows: Row[] = useMemo(() => {
    const now = new Date().toISOString();
    const co = companyId === "all" ? undefined : companyId;
    const priced = (key: string, qty: number) => {
      const avg = stockAverageRate(db, material, key, now, co);
      return { avg, value: avg != null ? r2(avg * qty) : null };
    };
    if (diamond) {
      return lotBalances(db.stockMovements ?? [], companyId).filter(l => l.ct > 0).map(l => ({
        key: l.key, ...l.spec, qty: l.ct, pcs: l.pcs, ...priced(l.key, l.ct),
      }));
    }
    return Object.entries(deriveStockBalances(db.stockMovements, material, companyId))
      .filter(([, q]) => q > 0.0005)
      .map(([key, q]) => ({
        key, qty: q, pcs: null,
        fine: material === "gold" ? r2(toPureGold(q, key)) : undefined,
        ...priced(key, q),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.stockMovements, db.purchases, companyId, material]);

  // Each filter offers only what is in stock now.
  const opts = (pick: (r: Row) => string | undefined, none = "Not recorded") => {
    const vals = [...new Set(rows.map(r => pick(r) || ""))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return vals.map(v => ({ value: v || "__none", label: v || none }));
  };
  const match = (want: string, have?: string) => want === ALL || (want === "__none" ? !have : have === want);
  const shown = rows.filter(r => match(shape, r.shape) && match(size, r.size) && match(color, r.color) && match(clarity, r.clarity));

  const filters: TableFilter[] = diamond ? [
    { kind: "select", label: "Shape", value: shape, onChange: setShape, options: opts(r => r.shape), allLabel: "All shapes" },
    { kind: "select", label: "Size", value: size, onChange: setSize, options: opts(r => r.size), allLabel: "All sizes" },
    { kind: "select", label: "Colour", value: color, onChange: setColor, options: opts(r => r.color), allLabel: "All colours" },
    { kind: "select", label: "Clarity", value: clarity, onChange: setClarity, options: opts(r => r.clarity), allLabel: "All clarities" },
  ] : [];

  const dash = <span className="text-muted-foreground/50">—</span>;
  const columns: DataColumn<Row>[] = diamond ? [
    { key: "lot", header: "Lot", always: true, sortValue: r => r.key, csv: r => lotLabel(r.key),
      cell: r => <CellMain title={r.shape} sub={r.key.includes(" · ") ? undefined : "size not recorded"} /> },
    { key: "size", header: "Size", sortValue: r => r.size ?? "", cell: r => (r.size ? <CellTag tone="blue">{r.size}</CellTag> : dash) },
    { key: "color", header: "Colour", sortValue: r => r.color ?? "", cell: r => r.color ?? dash },
    { key: "clarity", header: "Clarity", sortValue: r => r.clarity ?? "", cell: r => r.clarity ?? dash },
    { key: "pcs", header: "Pcs", align: "right", kind: "number", sortValue: r => r.pcs,
      cell: r => (r.pcs != null ? <span className="tabular-nums">{r.pcs.toLocaleString()}</span> : dash) },
    { key: "qty", header: "Carats", align: "right", kind: "number", sortValue: r => r.qty,
      cell: r => <span className="tabular-nums font-semibold text-brand-dark whitespace-nowrap">{fmtQty(r.qty, unit)}</span> },
    { key: "avg", header: "Avg ₹/ct", align: "right", kind: "number", sortValue: r => r.avg,
      cell: r => (r.avg != null ? <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(r.avg)}</span> : dash) },
    { key: "value", header: "Value", align: "right", kind: "number", sortValue: r => r.value,
      cell: r => (r.value != null ? <CellAmount>{fmtMoneyInr(r.value)}</CellAmount> : dash) },
  ] : [
    { key: "lot", header: material === "gold" ? "Purity" : "Grade", always: true, sortValue: r => r.key,
      cell: r => <CellMain title={r.key} /> },
    { key: "qty", header: `In stock (${unit})`, align: "right", kind: "number", sortValue: r => r.qty,
      cell: r => <span className="tabular-nums font-semibold text-brand-dark whitespace-nowrap">{fmtQty(r.qty, unit)}</span> },
    ...(material === "gold" ? [{ key: "fine", header: "Fine (24K)", align: "right" as const, kind: "number" as const, sortValue: (r: Row) => r.fine,
      cell: (r: Row) => <span className="tabular-nums whitespace-nowrap">{fmtQty(r.fine ?? 0, "g")}</span> }] : []),
    { key: "avg", header: `Avg ₹/${unit}`, align: "right", kind: "number", sortValue: r => r.avg,
      cell: r => (r.avg != null ? <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(r.avg)}</span> : dash) },
    { key: "value", header: "Value", align: "right", kind: "number", sortValue: r => r.value,
      cell: r => (r.value != null ? <CellAmount>{fmtMoneyInr(r.value)}</CellAmount> : dash) },
  ];

  const totalQty = r2(shown.reduce((s, r) => s + r.qty, 0));
  const pcsKnown = shown.filter(r => r.pcs != null);
  const totalPcs = pcsKnown.reduce((s, r) => s + (r.pcs ?? 0), 0);
  const totalValue = shown.reduce((s, r) => s + (r.value ?? 0), 0);
  const unpriced = shown.filter(r => r.value == null).length;
  const filtered = shape !== ALL || size !== ALL || color !== ALL || clarity !== ALL;

  return (
    <div className="card-luxe p-3 sm:p-4 space-y-3">
      <SectionTitle className="px-1" title={diamond ? "Lots in stock" : "In stock"}
        sub={selected ? `Showing the history of ${diamond ? lotLabel(selected) : selected} below` : diamond ? "Shape · size · colour · clarity — open a lot for its history" : "Open a line for its history"}
        actions={selected ? <button type="button" onClick={() => onSelect(null)} className="text-xs text-primary hover:underline">Show all history</button> : undefined} />
      <StatStrip items={[
        { label: filtered ? "In stock · filtered" : "In stock", value: fmtQty(totalQty, unit), icon: diamond ? Gem : material === "gold" ? Coins : Layers,
          sub: `${shown.length} ${diamond ? (shown.length === 1 ? "lot" : "lots") : (shown.length === 1 ? "line" : "lines")}` },
        ...(diamond ? [{ label: "Pieces", value: pcsKnown.length ? totalPcs.toLocaleString() : "—", icon: Layers,
          sub: pcsKnown.length < shown.length ? `${shown.length - pcsKnown.length} lot${shown.length - pcsKnown.length === 1 ? "" : "s"} without a count` : "Counted on every lot" }] : []),
        ...(material === "gold" ? [{ label: "Fine gold (24K)", value: fmtQty(r2(shown.reduce((s, r) => s + (r.fine ?? 0), 0)), "g"), icon: Coins }] : []),
        { label: "Value at cost", value: fmtMoneyInr(totalValue), icon: Wallet,
          sub: unpriced ? `${unpriced} without a price yet` : "Average cost × quantity" },
      ]} />
      <DataTable
        id={`stock-lots-${diamond ? "diamond" : material === "gold" ? "gold" : "material"}`}
        noun={diamond ? "lot" : "line"}
        rows={shown}
        rowKey={r => r.key}
        columns={columns}
        filters={filters}
        onClearFilters={() => { setShape(ALL); setSize(ALL); setColor(ALL); setClarity(ALL); }}
        searchText={r => [r.key, r.size, r.color, r.clarity].filter(Boolean).join(" ")}
        searchPlaceholder={diamond ? "Search lots — e.g. +6.5-7, G-H, VS" : "Search"}
        defaultSort={{ key: "qty", dir: "desc" }}
        onRowClick={r => onSelect(selected === r.key ? null : r.key)}
        rowClassName={r => (r.key === selected ? "dt-on bg-primary/[0.05]" : "")}
        exportName={`Stock-${diamond ? "Loose-Diamond-Lots" : material}`}
        details={false}
        emptyText={rows.length ? "No lot matches these filters." : "Nothing in stock."}
      />
    </div>
  );
}
