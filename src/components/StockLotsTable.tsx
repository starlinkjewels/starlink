import { useMemo, useState } from "react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { bagNoOf, giveBags, printBagLabels } from "@/lib/diamondBags";
import { companyById, hasCompanies } from "@/lib/companies";
import { toast } from "sonner";
import { deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { toPureGold } from "@/lib/db";
import { knowStoneTypes, lotBalances, lotLabel, sizeOrder, LOT_SEP } from "@/lib/diamondLots";
import { listOf } from "@/lib/optionLists";
import { stockAverageRate } from "@/lib/orderCost";
import { materialDef, materialUnit, fmtQty, type MaterialKey } from "@/lib/materials";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { Coins, Gem, Layers, Package, Printer, Wallet, X } from "lucide-react";

/** One line of stock: a gold purity, a loose-diamond lot, or a material's grade —
 *  or, seen together, every lot of one size (every purity of one karat). */
interface Row {
  key: string;
  /** Loose diamonds: the bag this lot is kept in ("BAG-0007"). */
  bag?: string;
  shape?: string; type?: string; size?: string; mm?: string; color?: string; clarity?: string;
  qty: number;
  pcs: number | null;
  /** Fine (24K) grams, for gold. */
  fine?: number;
  /** Average cost per unit, from what was paid (purchases with their brokerage, opening values). */
  avg: number | null;
  value: number | null;
  /** Seen together: the lots (or purities) this line adds up, and what it is called. */
  members?: Row[];
  label?: string;
}

/** Together: one line per size (per karat for gold). Each: one line per bag (per purity). */
export type StockView = "together" | "each";

const ALL = "";
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The karat a gold purity is: "24K", "22 KT", "995", "999.9", "916" → "24K" / "22K"… */
export function goldKarat(purity: string): string {
  const s = String(purity).trim();
  const k = s.match(/(\d{1,2})\s*(?:k|kt|carat|karat)\b/i);
  if (k) return `${parseInt(k[1], 10)}K`;
  const n = parseFloat(s);
  if (isFinite(n) && n >= 100) {
    const pm = n > 1000 ? n / 10 : n; // 999.9 → per mille
    return pm >= 990 ? "24K" : pm >= 900 ? "22K" : pm >= 820 ? "20K" : pm >= 740 ? "18K" : pm >= 570 ? "14K" : pm >= 410 ? "10K" : pm >= 370 ? "9K" : s;
  }
  if (isFinite(n) && n > 0 && n <= 24) return `${Math.round(n)}K`;
  return s || "Purity not recorded";
}

/** Several words as one cell: "D-E, F+" — a lot without one shows as "—" among them. */
const joinParts = (list: (string | undefined)[]) => {
  const words = [...new Set(list.filter(Boolean) as string[])].sort(sizeOrder);
  const blank = list.some(v => !v);
  return words.length ? [...words, ...(blank && words.length ? ["—"] : [])].join(", ") : undefined;
};

/**
 * What is in stock, line by line — the same table for every material: gold by
 * purity, loose diamonds by LOT (shape · size · colour · clarity, with pieces),
 * any other material by grade. Each line shows what it holds, its average cost
 * per unit and its value; loose diamonds filter by each part of the lot.
 *
 * Seen together (the start): stock of one size is one line — the opening bag
 * and every bag bought since add up (8.63 ct, not 1.52 + 7.11 on two lines),
 * with their pieces, value and average ₹/ct; gold is one line per karat. A line
 * opens the history of everything in it below, and names its bags, each of
 * which opens on its own. "Each bag" shows the bags one by one, as before.
 */
export function StockLotsTable({ material, companyId, selected, onSelect }: {
  material: MaterialKey; companyId: string; selected: string[] | null; onSelect: (keys: string[] | null, label?: string) => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const unit = materialUnit(db.settings, material);
  const diamond = material === "diamond";
  const gold = material === "gold";
  knowStoneTypes([...listOf("diamondTypes", db.settings), ...listOf("gemTypes", db.settings)]);
  // Gems (an other material that is a stone) are kept as diamond lots are: shape · type · mm · sieve · colour · grade.
  const gem = materialDef(db.settings, material)?.kind === "stone";
  const lotLike = diamond || gem;
  const groupable = lotLike || gold;
  const VIEW_KEY = `stock-view-${material}`;
  const [view, setViewState] = useState<StockView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === "each" ? "each" : "together"; } catch { return "together"; }
  });
  const together = groupable && view === "together";
  const setView = (v: StockView) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ }
    onSelect(null);
  };
  const [shape, setShape] = useState(ALL);
  const [type, setType] = useState(ALL);
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
    // A gem's parts as its movements keep them; an older line kept only a grade.
    const kept = new Map<string, NonNullable<(typeof db.stockMovements)[number]["lot"]>>();
    if (gem) for (const m of db.stockMovements ?? []) if (m.material === material && m.lot?.shape) kept.set(m.purityOrQuality, m.lot);
    return Object.entries(deriveStockBalances(db.stockMovements, material, companyId))
      .filter(([, q]) => q > 0.0005)
      .map(([key, q]) => ({
        key, qty: q, pcs: null,
        ...(gem ? (kept.get(key) ?? { clarity: key === "—" ? undefined : key }) : {}),
        fine: gold ? r2(toPureGold(q, key)) : undefined,
        ...priced(key, q),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.stockMovements, db.purchases, db.diamondBags, db.settings, companyId, material]);

  // Each filter offers only what is in stock now.
  const opts = (pick: (r: Row) => string | undefined, none = "Not recorded") => {
    const vals = [...new Set(rows.map(r => pick(r) || ""))].sort(sizeOrder);
    return vals.map(v => ({ value: v || "__none", label: v || none }));
  };
  const match = (want: string, have?: string) => want === ALL || (want === "__none" ? !have : have === want);
  const shown = rows.filter(r => match(shape, r.shape) && match(type, r.type) && match(mm, r.mm) && match(size, r.size) && match(color, r.color) && match(clarity, r.clarity));

  const filters: TableFilter[] = lotLike ? [
    { kind: "select", label: "Shape", value: shape, onChange: setShape, options: opts(r => r.shape), allLabel: "All shapes" },
    { kind: "select", label: "Type", value: type, onChange: setType, options: opts(r => r.type), allLabel: "All types" },
    { kind: "select", label: "MM", value: mm, onChange: setMm, options: opts(r => r.mm), allLabel: "All mm" },
    { kind: "select", label: "Sieve", value: size, onChange: setSize, options: opts(r => r.size), allLabel: "All sieves" },
    { kind: "select", label: "Colour", value: color, onChange: setColor, options: opts(r => r.color), allLabel: "All colours" },
    { kind: "select", label: gem ? "Grade" : "Clarity", value: clarity, onChange: setClarity, options: opts(r => r.clarity), allLabel: gem ? "All grades" : "All clarities" },
  ] : [];

  // In the order a diamond office keeps its bags: shape, then mm, then sieve, then grade.
  const byBag = (a: Row, b: Row) => (a.shape ?? "").localeCompare(b.shape ?? "") || (parseFloat(a.mm ?? "") || 0) - (parseFloat(b.mm ?? "") || 0)
    || sizeOrder(a.size, b.size) || (a.type ?? "").localeCompare(b.type ?? "") || (a.color ?? "").localeCompare(b.color ?? "") || (a.clarity ?? "").localeCompare(b.clarity ?? "");
  const ordered = lotLike ? [...shown].sort(byBag) : shown;

  // Together: every lot of one size (shape · mm · sieve) adds up — whatever its
  // type, colour or clarity, opening or bought — and gold every purity of one karat.
  const grouped: Row[] = useMemo(() => {
    if (!together) return [];
    const by = new Map<string, Row[]>();
    for (const r of ordered) {
      const k = gold ? goldKarat(r.key) : [r.shape, r.mm, r.size].filter(Boolean).join(LOT_SEP);
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()].map(([k, members]) => {
      const qty = r3(members.reduce((s, m) => s + m.qty, 0));
      const pcsKnown = members.filter(m => m.pcs != null);
      const priced = members.filter(m => m.value != null);
      const value = priced.length ? r2(priced.reduce((s, m) => s + (m.value ?? 0), 0)) : null;
      const pricedQty = priced.reduce((s, m) => s + m.qty, 0);
      const first = members[0];
      return {
        key: `together:${k}`, label: k, members,
        shape: first.shape, mm: first.mm, size: first.size,
        type: joinParts(members.map(m => m.type)), color: joinParts(members.map(m => m.color)), clarity: joinParts(members.map(m => m.clarity)),
        qty, pcs: pcsKnown.length ? pcsKnown.reduce((s, m) => s + (m.pcs ?? 0), 0) : null,
        fine: gold ? r2(members.reduce((s, m) => s + (m.fine ?? 0), 0)) : undefined,
        // The average of what was paid, weighed by how much of each is held.
        avg: value != null && pricedQty > 0 ? r2(value / pricedQty) : null,
        value,
      };
    }).sort(gold ? ((a, b) => (parseInt(b.label ?? "", 10) || 0) - (parseInt(a.label ?? "", 10) || 0)) : byBag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [together, ordered]);
  const tableRows = together ? grouped : ordered;

  const keysOf = (r: Row) => (r.members ? r.members.map(m => m.key) : [r.key]);
  const sameKeys = (r: Row) => !!selected && keysOf(r).length === selected.length && keysOf(r).every(k => selected.includes(k));
  const holdsSelection = (r: Row) => !!selected && selected.every(k => keysOf(r).includes(k));
  const nameOf = (r: Row) => (r.members ? r.label ?? r.key : diamond ? `${r.bag ? `${r.bag} · ` : ""}${lotLabel(r.key)}` : r.key);
  const open = together ? grouped.find(holdsSelection) : undefined;

  const dash = <span className="text-muted-foreground/50">—</span>;
  const bagsCell = (r: Row) => {
    if (!r.members) return r.bag ? <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{r.bag}</span> : dash;
    const bags = r.members.map(m => m.bag).filter(Boolean) as string[];
    return (
      <span className="block min-w-0">
        <span className="text-xs font-semibold text-brand-dark whitespace-nowrap">{r.members.length} {r.members.length === 1 ? "bag" : "bags"}</span>
        {bags.length > 0 && <span className="block font-mono text-[10px] text-primary truncate max-w-[9rem]" title={bags.join(", ")}>{bags.join(", ")}</span>}
      </span>
    );
  };
  const columns: DataColumn<Row>[] = lotLike ? [
    ...(diamond ? [{ key: "bag", header: together ? "Bags" : "Bag", always: true, sortValue: (r: Row) => (r.members ? r.members.length : r.bag ?? "~"),
      csv: (r: Row) => (r.members ? r.members.map(m => m.bag).filter(Boolean).join(", ") : r.bag ?? ""), cell: bagsCell }] : []),
    { key: "lot", header: "Shape", always: gem, sortValue: r => `${r.shape ?? ""}`, csv: r => (r.members ? r.label ?? "" : diamond ? lotLabel(r.key) : r.key),
      cell: r => (r.shape ? <CellMain title={r.shape} sub={diamond && !r.members && !r.key.includes(LOT_SEP) ? "size not recorded" : !diamond && r.members ? `${r.members.length} ${r.members.length === 1 ? "line" : "lines"}` : undefined} /> : dash) },
    { key: "type", header: "Type", sortValue: r => r.type ?? "", cell: r => (r.type ? <CellTag tone="amber">{r.type}</CellTag> : dash) },
    { key: "mm", header: "MM", sortValue: r => parseFloat(r.mm ?? "") || 0, cell: r => (r.mm ? <CellTag tone="blue">{r.mm}</CellTag> : dash) },
    { key: "size", header: "Sieve", sortValue: r => r.size ?? "", cell: r => (r.size ? <CellTag tone="violet">{r.size}</CellTag> : dash) },
    { key: "color", header: "Colour", sortValue: r => r.color ?? "", cell: r => r.color ?? dash },
    { key: "clarity", header: gem ? "Grade" : "Clarity", sortValue: r => r.clarity ?? "", cell: r => r.clarity ?? dash },
    ...(diamond ? [{ key: "pcs", header: "Pcs", align: "right" as const, kind: "number" as const, sortValue: (r: Row) => r.pcs,
      cell: (r: Row) => (r.pcs != null ? <span className="tabular-nums">{r.pcs.toLocaleString()}</span> : dash) }] : []),
    { key: "qty", header: diamond ? "Carats" : `In stock (${unit})`, align: "right", kind: "number", sortValue: r => r.qty,
      cell: r => <span className="tabular-nums font-semibold text-brand-dark whitespace-nowrap">{fmtQty(r.qty, unit)}</span> },
    { key: "avg", header: `Avg ₹/${unit}`, align: "right", kind: "number", sortValue: r => r.avg,
      cell: r => (r.avg != null ? <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(r.avg)}</span> : dash) },
    { key: "value", header: "Value", align: "right", kind: "number", sortValue: r => r.value,
      cell: r => (r.value != null ? <CellAmount>{fmtMoneyInr(r.value)}</CellAmount> : dash) },
  ] : [
    { key: "lot", header: gold ? (together ? "Karat" : "Purity") : "Grade", always: true, sortValue: r => r.label ?? r.key, csv: r => r.label ?? r.key,
      cell: r => <CellMain title={r.label ?? r.key} sub={r.members ? (r.members.length > 1 ? r.members.map(m => m.key).join(" · ") : r.members[0].key !== r.label ? r.members[0].key : undefined) : undefined} /> },
    { key: "qty", header: `In stock (${unit})`, align: "right", kind: "number", sortValue: r => r.qty,
      cell: r => <span className="tabular-nums font-semibold text-brand-dark whitespace-nowrap">{fmtQty(r.qty, unit)}</span> },
    ...(gold ? [{ key: "fine", header: "Fine (24K)", align: "right" as const, kind: "number" as const, sortValue: (r: Row) => r.fine,
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
  const filtered = shape !== ALL || type !== ALL || mm !== ALL || size !== ALL || color !== ALL || clarity !== ALL;
  const noBag = diamond ? rows.filter(r => !r.bag) : [];
  const isStaff = user?.role === "admin" || user?.role === "employee";
  const coName = hasCompanies(db.settings) && companyId !== "all" ? companyById(db.settings, companyId).name : undefined;
  const print = (list: Row[]) => {
    const withBag = list.flatMap(r => r.members ?? [r]).filter(r => r.bag);
    if (!withBag.length) { toast.error("These lots have no bag number yet"); return; }
    if (!printBagLabels(withBag.map(r => ({ no: r.bag!, key: r.key, ct: r.qty, pcs: r.pcs })), coName)) toast.error("Allow pop-ups to print the labels");
  };
  const lines = (n: number) => (diamond ? (n === 1 ? "lot" : "lots") : n === 1 ? "line" : "lines");
  const groupWord = gold ? (grouped.length === 1 ? "karat" : "karats") : grouped.length === 1 ? "size" : "sizes";

  return (
    <div className="card-luxe p-3 sm:p-4 space-y-3">
      <SectionTitle className="px-1" title={diamond ? (together ? "In stock by size" : "Bags in stock") : together && gold ? "In stock by karat" : together ? "In stock by size" : "In stock"}
        sub={selected
          ? `Showing the history of ${open && selected.length > 1 ? `${open.label} — all ${open.members!.length} ${diamond ? "bags" : "lines"}` : (() => { const r = rows.find(x => x.key === selected[0]); return r ? nameOf(r) : selected[0]; })()} below`
          : together
            ? (gold ? "Every purity of one karat on one line — open a line for its history" : "Every bag of one size on one line — opening and bought, added up. Open a line to see its bags and history")
            : diamond ? "Shape · type · mm · sieve · colour · clarity — open a bag for its history" : gem ? "Shape · type · mm · sieve · colour · grade — open a line for its history" : "Open a line for its history"}
        actions={
          <span className="inline-flex items-center gap-3">
            {groupable && (
              <span className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60" role="group" aria-label="How stock is listed">
                {([["together", gold ? "By karat" : "By size"], ["each", gold ? "Each purity" : diamond ? "Each bag" : "Each line"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                    className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${view === v ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
                ))}
              </span>
            )}
            {selected
              ? <button type="button" onClick={() => onSelect(null)} className="text-xs text-primary hover:underline">Show all history</button>
              : diamond && ordered.some(r => r.bag)
                ? <button type="button" onClick={() => print(ordered)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> Print labels{filtered ? " (filtered)" : ""}</button>
                : null}
          </span>
        } />
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
        { label: filtered ? "In stock · filtered" : "In stock", value: fmtQty(totalQty, unit), icon: diamond ? Gem : gold ? Coins : Layers,
          sub: together ? `${grouped.length} ${groupWord} · ${shown.length} ${lines(shown.length)}` : `${shown.length} ${lines(shown.length)}` },
        ...(diamond ? [{ label: "Pieces", value: pcsKnown.length ? totalPcs.toLocaleString() : "—", icon: Layers,
          sub: pcsKnown.length < shown.length ? `${shown.length - pcsKnown.length} lot${shown.length - pcsKnown.length === 1 ? "" : "s"} without a count` : "Counted on every lot" }] : []),
        ...(gold ? [{ label: "Fine gold (24K)", value: fmtQty(r2(shown.reduce((s, r) => s + (r.fine ?? 0), 0)), "g"), icon: Coins }] : []),
        { label: "Value at cost", value: fmtMoneyInr(totalValue), icon: Wallet,
          sub: unpriced ? `${unpriced} without a price yet` : "Average cost × quantity" },
      ]} />
      <DataTable
        id={`stock-lots-${diamond ? "diamond" : gold ? "gold" : "material"}${together ? "-together" : ""}`}
        noun={together ? (gold ? "karat" : "size") : diamond ? "lot" : "line"}
        rows={tableRows}
        rowKey={r => r.key}
        rowActions={diamond ? (r => [
          r.members
            ? { label: `Print ${r.members.length === 1 ? "its bag label" : `its ${r.members.length} bag labels`}`, icon: Printer, disabled: !r.members.some(m => m.bag), hint: r.members.map(m => m.bag).filter(Boolean).join(", ") || "Give these lots bag numbers first", onSelect: () => print([r]) }
            : { label: "Print bag label", icon: Printer, disabled: !r.bag, hint: r.bag ? `${r.bag} · ${lotLabel(r.key)}` : "Give this lot a bag number first", onSelect: () => print([r]) },
        ]) : undefined}
        columns={columns}
        filters={filters}
        onClearFilters={() => { setShape(ALL); setType(ALL); setMm(ALL); setSize(ALL); setColor(ALL); setClarity(ALL); }}
        searchText={r => (r.members ?? [r]).flatMap(m => [m.bag, m.key, m.type, m.mm, m.size, m.color, m.clarity]).concat(r.label).filter(Boolean).join(" ")}
        searchPlaceholder={diamond ? "Search bags — e.g. BAG-0007, 1.3 mm, G-H, VS" : "Search"}
        defaultSort={lotLike || together ? null : { key: "qty", dir: "desc" }}
        onRowClick={r => (sameKeys(r) ? onSelect(null) : onSelect(keysOf(r), nameOf(r)))}
        rowClassName={r => (sameKeys(r) || (r.members && holdsSelection(r)) || (!r.members && selected?.length === 1 && selected[0] === r.key) ? "dt-on bg-primary/[0.05]" : "")}
        exportName={`Stock-${diamond ? (together ? "Loose-Diamonds-by-Size" : "Loose-Diamond-Bags") : gold && together ? "Gold-by-Karat" : material}`}
        details={false}
        emptyText={rows.length ? "No lot matches these filters." : "Nothing in stock."}
      />
      {/* An opened line: what it is made of — each bag (purity) opens on its own. */}
      {open && open.members!.length > 1 && (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.03] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-brand-dark">
              {open.label} · {fmtQty(open.qty, unit)} in {open.members!.length} {diamond ? "bags" : "lines"}
            </p>
            <button type="button" onClick={() => onSelect(null)} className="h-6 w-6 rounded-md grid place-items-center text-muted-foreground hover:bg-secondary" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onSelect(keysOf(open), nameOf(open))} aria-pressed={sameKeys(open)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${sameKeys(open) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white hover:bg-secondary"}`}>
              All together
            </button>
            {open.members!.map(m => {
              const on = selected?.length === 1 && selected[0] === m.key;
              const parts = gold ? m.key : [m.type, m.color, m.clarity].filter(Boolean).join(" · ") || "grade not recorded";
              return (
                <button key={m.key} type="button" onClick={() => onSelect([m.key], nameOf(m))} aria-pressed={on} title={lotLike ? lotLabel(m.key) : m.key}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-xs ${on ? "border-primary bg-primary/[0.08] ring-1 ring-primary/30" : "border-border bg-white hover:bg-secondary"}`}>
                  {m.bag && <span className="font-mono font-semibold text-primary mr-1.5">{m.bag}</span>}
                  <span className="text-foreground">{parts}</span>
                  <span className="ml-1.5 tabular-nums font-semibold text-brand-dark">{fmtQty(m.qty, unit)}</span>
                  {m.pcs != null && <span className="ml-1 text-muted-foreground">· {m.pcs.toLocaleString()} pcs</span>}
                  {m.avg != null && <span className="ml-1 text-muted-foreground">· {fmtMoneyInr(m.avg)}/{unit}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
