import { useMemo, useState } from "react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { bagNoOf, giveBags, printBagLabels } from "@/lib/diamondBags";
import { companyById, hasCompanies } from "@/lib/companies";
import { toast } from "sonner";
import { deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { toPureGold } from "@/lib/db";
import { lotBalances, lotLabel, sizeOrder } from "@/lib/diamondLots";
import { stockAverageRate } from "@/lib/orderCost";
import { materialUnit, fmtQty, type MaterialKey } from "@/lib/materials";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { Coins, Gem, Layers, Package, Printer, Wallet } from "lucide-react";

/** One line of stock: a gold purity, a loose-diamond lot, or a material's grade. */
interface Row {
  key: string;
  /** Loose diamonds: the bag this lot is kept in ("BAG-0007"). */
  bag?: string;
  shape?: string; size?: string; mm?: string; color?: string; clarity?: string;
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
  const { user } = useAuth();
  const unit = materialUnit(db.settings, material);
  const diamond = material === "diamond";
  const [shape, setShape] = useState(ALL);
  const [mm, setMm] = useState(ALL);
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
        key: l.key, bag: bagNoOf(db, l.key), ...l.spec, qty: l.ct, pcs: l.pcs, ...priced(l.key, l.ct),
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
  }, [db.stockMovements, db.purchases, db.diamondBags, companyId, material]);

  // Each filter offers only what is in stock now.
  const opts = (pick: (r: Row) => string | undefined, none = "Not recorded") => {
    const vals = [...new Set(rows.map(r => pick(r) || ""))].sort(sizeOrder);
    return vals.map(v => ({ value: v || "__none", label: v || none }));
  };
  const match = (want: string, have?: string) => want === ALL || (want === "__none" ? !have : have === want);
  const shown = rows.filter(r => match(shape, r.shape) && match(mm, r.mm) && match(size, r.size) && match(color, r.color) && match(clarity, r.clarity));

  const filters: TableFilter[] = diamond ? [
    { kind: "select", label: "Shape", value: shape, onChange: setShape, options: opts(r => r.shape), allLabel: "All shapes" },
    { kind: "select", label: "MM", value: mm, onChange: setMm, options: opts(r => r.mm), allLabel: "All mm" },
    { kind: "select", label: "Sieve", value: size, onChange: setSize, options: opts(r => r.size), allLabel: "All sieves" },
    { kind: "select", label: "Colour", value: color, onChange: setColor, options: opts(r => r.color), allLabel: "All colours" },
    { kind: "select", label: "Clarity", value: clarity, onChange: setClarity, options: opts(r => r.clarity), allLabel: "All clarities" },
  ] : [];

  const dash = <span className="text-muted-foreground/50">—</span>;
  const columns: DataColumn<Row>[] = diamond ? [
    { key: "bag", header: "Bag", always: true, sortValue: r => r.bag ?? "~", csv: r => r.bag ?? "",
      cell: r => (r.bag ? <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{r.bag}</span> : dash) },
    { key: "lot", header: "Shape", sortValue: r => `${r.shape ?? ""}`, csv: r => lotLabel(r.key),
      cell: r => <CellMain title={r.shape} sub={r.key.includes(" · ") ? undefined : "size not recorded"} /> },
    { key: "mm", header: "MM", sortValue: r => parseFloat(r.mm ?? "") || 0, cell: r => (r.mm ? <CellTag tone="blue">{r.mm}</CellTag> : dash) },
    { key: "size", header: "Sieve", sortValue: r => r.size ?? "", cell: r => (r.size ? <CellTag tone="violet">{r.size}</CellTag> : dash) },
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
  const filtered = shape !== ALL || mm !== ALL || size !== ALL || color !== ALL || clarity !== ALL;
  // In the order a diamond office keeps its bags: shape, then mm, then sieve, then grade.
  const ordered = diamond
    ? [...shown].sort((a, b) => (a.shape ?? "").localeCompare(b.shape ?? "") || (parseFloat(a.mm ?? "") || 0) - (parseFloat(b.mm ?? "") || 0)
        || sizeOrder(a.size, b.size) || (a.color ?? "").localeCompare(b.color ?? "") || (a.clarity ?? "").localeCompare(b.clarity ?? ""))
    : shown;
  const noBag = diamond ? rows.filter(r => !r.bag) : [];
  const isStaff = user?.role === "admin" || user?.role === "employee";
  const coName = hasCompanies(db.settings) && companyId !== "all" ? companyById(db.settings, companyId).name : undefined;
  const print = (list: Row[]) => {
    const withBag = list.filter(r => r.bag);
    if (!withBag.length) { toast.error("These lots have no bag number yet"); return; }
    if (!printBagLabels(withBag.map(r => ({ no: r.bag!, key: r.key, ct: r.qty, pcs: r.pcs })), coName)) toast.error("Allow pop-ups to print the labels");
  };

  return (
    <div className="card-luxe p-3 sm:p-4 space-y-3">
      <SectionTitle className="px-1" title={diamond ? "Bags in stock" : "In stock"}
        sub={selected ? `Showing the history of ${diamond ? (bagNoOf(db, selected) ? `${bagNoOf(db, selected)} · ` : "") + lotLabel(selected) : selected} below` : diamond ? "Shape · mm · sieve · colour · clarity — open a bag for its history" : "Open a line for its history"}
        actions={selected
          ? <button type="button" onClick={() => onSelect(null)} className="text-xs text-primary hover:underline">Show all history</button>
          : diamond && ordered.some(r => r.bag)
            ? <button type="button" onClick={() => print(ordered)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> Print labels{filtered ? " (filtered)" : ""}</button>
            : undefined} />
      {diamond && isStaff && noBag.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2 text-xs">
          <Package className="h-4 w-4 text-primary shrink-0" />
          <span className="text-foreground">{noBag.length} lot{noBag.length === 1 ? "" : "s"} in stock {noBag.length === 1 ? "has" : "have"} no bag number yet.</span>
          <button type="button" className="ml-auto font-semibold text-primary hover:underline"
            onClick={() => { const n = giveBags(noBag.map(r => r.key), user?.id); toast.success(`${n} bag number${n === 1 ? "" : "s"} given`); }}>
            Give bag numbers
          </button>
        </div>
      )}
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
        rows={ordered}
        rowKey={r => r.key}
        rowActions={diamond ? (r => [
          { label: "Print bag label", icon: Printer, disabled: !r.bag, hint: r.bag ? `${r.bag} · ${lotLabel(r.key)}` : "Give this lot a bag number first", onSelect: () => print([r]) },
        ]) : undefined}
        columns={columns}
        filters={filters}
        onClearFilters={() => { setShape(ALL); setMm(ALL); setSize(ALL); setColor(ALL); setClarity(ALL); }}
        searchText={r => [r.bag, r.key, r.mm, r.size, r.color, r.clarity].filter(Boolean).join(" ")}
        searchPlaceholder={diamond ? "Search bags — e.g. BAG-0007, 1.3 mm, G-H, VS" : "Search"}
        defaultSort={diamond ? null : { key: "qty", dir: "desc" }}
        onRowClick={r => onSelect(selected === r.key ? null : r.key)}
        rowClassName={r => (r.key === selected ? "dt-on bg-primary/[0.05]" : "")}
        exportName={`Stock-${diamond ? "Loose-Diamond-Bags" : material}`}
        details={false}
        emptyText={rows.length ? "No lot matches these filters." : "Nothing in stock."}
      />
    </div>
  );
}
