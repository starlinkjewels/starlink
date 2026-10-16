import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CompanyFilter, CompanyPicker, CompanyBadge, useMultiCo } from "@/components/CompanyFields";
import { companyOf, coField } from "@/lib/companies";
import { fmtDate, loadDb, updateDb, DIAMOND_SHAPES, nextDiamondStockNumber, type DiamondPacket } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { stockBucketHistory, deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { recomputeStockFromHistory } from "@/lib/stock";
import { purchaseEditScope, editPurchase } from "@/lib/purchaseVoid";
import { AsyncButton } from "@/components/AsyncButton";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Gem, Coins, BadgeCheck, Pencil, Trash2, Download, Layers } from "lucide-react";
import { isOtherMaterial, materialDef, materialUnit, purchaseQty, KIND_LABEL, type MaterialKey } from "@/lib/materials";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";

export function StockSectionPage() {
  const { section } = useParams<{ section: string }>();
  const db = useDb();
  if (section === "certified") return <CertifiedSection />;
  if (section === "gold" || section === "diamond") return <MaterialSection material={section} />;
  // Any other material (Settings → Materials), by its id.
  if (isOtherMaterial(section) && materialDef(db.settings, section)) return <MaterialSection material={section} />;
  return (
    <div className="text-center py-20 text-muted-foreground">
      Unknown stock section. <Link to="/stock" className="text-primary underline">Back to Stock</Link>
    </div>
  );
}

/* ── Gold / Loose Diamonds — bucket tiles + full resolved movement history ── */

function MaterialSection({ material }: { material: MaterialKey }) {
  const navigate = useNavigate();
  const db = useDb();
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Balance derived from the FULL (unfiltered) movement ledger, so it always
  // reflects the true current total — the date filter below only narrows which
  // history rows are shown, same as Locker's ledger filter.
  // One company's stock (from the Stock page's choice), or every company's together.
  const [sp, setSp] = useSearchParams();
  const multiCo = useMultiCo();
  const co = multiCo ? (sp.get("co") || "all") : "all";
  const pickCo = (v: string) => setSp(prev => { const n = new URLSearchParams(prev); if (v === "all") n.delete("co"); else n.set("co", v); return n; });
  const entries = Object.entries(deriveStockBalances(db.stockMovements, material, co)).filter(([, q]) => q !== 0);
  const unit = materialUnit(db.settings, material);
  const def = materialDef(db.settings, material);

  const rawRows = stockBucketHistory(db.stockMovements, material, selectedBucket, {
    purchases: db.purchases, issuances: db.materialIssuances, orders: db.orders, factories: db.factories, suppliers: db.suppliers,
    diamondSales: db.diamondSales, clients: db.clients,
  }, co);

  // Deterministic chronological order so the running balance is stable AND its
  // newest row always equals the Balances total. A direct-order purchase writes
  // an IN + OUT pair with the SAME timestamp (see logOrderDirectPurchase); apply
  // the IN before the OUT at a tie, then break further ties by id, so the ledger
  // never depends on unstable sort order.
  const inRank = (m: typeof rawRows[number]) => (m.type === "purchase_in" || (m.type === "adjustment" && m.quantity > 0) ? 0 : 1);
  const chronoAsc = [...rawRows].sort((a, b) =>
    (+new Date(a.createdAt) - +new Date(b.createdAt)) || (inRank(a) - inRank(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const balanceById = new Map<string, number>();
  {
    let bal = 0;
    for (const m of chronoAsc) {
      const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity || 1) : -1;
      bal = Math.round((bal + sign * Math.abs(m.quantity)) * 1000) / 1000;
      balanceById.set(m.id, bal);
    }
  }
  const rows = [...chronoAsc].reverse(); // newest-first for display, same total order

  const filterFromDate = filterFrom ? new Date(filterFrom + "T00:00:00") : null;
  const filterToDate = filterTo ? new Date(filterTo + "T23:59:59.999") : null;
  const filtersActive = !!filterFrom || !!filterTo;
  const filteredRows = rows.filter(m => inDateRange(m.createdAt, filterFromDate, filterToDate));

  const materialLabel = material === "gold" ? "Gold Reserve" : material === "diamond" ? "Loose Diamonds" : (def?.name ?? "Material");
  const bucketLabel = material === "gold" ? "Purity" : material === "diamond" ? "Shape" : "Grade"; // purityOrQuality = shape for diamonds, grade for the rest

  // ── One-time cleanup: older order-bought loose diamonds were filed by quality
  // grade ("EF VVS") or "unspecified" instead of shape. Each is part of a
  // net-zero direct-use pair, so re-labelling to the real shape (from the linked
  // purchase) changes NO balance — it just fixes the Shape column. Admin only. ──
  const { user } = useAuth();
  const SHAPE_SET = new Set(DIAMOND_SHAPES.map(s => s.toLowerCase()));
  const isBadShape = (v: string) => v !== "Certified" && !SHAPE_SET.has(String(v).toLowerCase());
  const badShapeCount = material === "diamond"
    ? db.stockMovements.filter(m => m.material === "diamond" && isBadShape(m.purityOrQuality)).length
    : 0;

  const fixDiamondShapes = async () => {
    const d0 = loadDb();
    const purchaseShape = new Map<string, string>();
    for (const p of d0.purchases) if (p.material === "diamond" && p.diamond?.kind !== "certified" && p.diamond?.shape) purchaseShape.set(p.id, p.diamond.shape);
    const purchaseIns = d0.stockMovements.filter(m => m.material === "diamond" && m.type === "purchase_in" && m.refType === "purchase" && !!m.refId);
    const newShape = new Map<string, string>();
    for (const m of d0.stockMovements) {
      if (m.material !== "diamond" || !isBadShape(m.purityOrQuality)) continue;
      let shape: string | undefined;
      if (m.type === "purchase_in" && m.refId) shape = purchaseShape.get(m.refId);
      else { // order_direct_use — match its paired purchase_in (same time, qty, old bucket)
        const pair = purchaseIns.find(pi => pi.createdAt === m.createdAt && pi.quantity === m.quantity && pi.purityOrQuality === m.purityOrQuality);
        shape = pair?.refId ? purchaseShape.get(pair.refId) : undefined;
      }
      if (shape) newShape.set(m.id, shape);
    }
    if (newShape.size === 0) { toast.error("Couldn't resolve shapes from the linked purchases."); return; }
    updateDb(d => {
      for (const m of d.stockMovements) { const ns = newShape.get(m.id); if (ns) m.purityOrQuality = ns; }
      for (const mi of d.materialIssuances) {
        if (mi.material === "diamond" && mi.source === "purchase" && mi.sourcePurchaseId && isBadShape(mi.purityOrQuality)) {
          const shape = purchaseShape.get(mi.sourcePurchaseId);
          if (shape) mi.purityOrQuality = shape;
        }
      }
    });
    try { await recomputeStockFromHistory(loadDb().stockMovements); } catch { /* self-heals on next view */ }
    toast.success(`Re-filed ${newShape.size} movement${newShape.size !== 1 ? "s" : ""} under their shape`);
  };

  // For a purchase movement, resolve the effective INR rate (₹/unit) and this
  // movement's cost from the linked Purchase — so the history shows where it was
  // bought AND at what price, like the Certified section. Out-movements have none.
  const inrRateAmount = (m: (typeof rows)[number]): { rate: number; amount: number } | null => {
    // Opening stock carries its own valuation (no supplier purchase behind it).
    if (m.refType === "opening" && m.valueInr != null) {
      return { rate: m.quantity > 0 ? m.valueInr / m.quantity : 0, amount: m.valueInr };
    }
    if (m.type !== "purchase_in" || m.refType !== "purchase" || !m.refId) return null;
    const p = db.purchases.find(x => x.id === m.refId);
    if (!p) return null;
    const pQty = purchaseQty(p);
    const rate = pQty > 0 ? p.totalInr / pQty : 0;
    return { rate, amount: rate * m.quantity };
  };

  const particulars = (m: (typeof rows)[number]) =>
    m.link.orderId ? <Link to={`/orders/${m.link.orderId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : m.link.factoryId ? <Link to={`/factories/${m.link.factoryId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : m.link.supplierId ? <Link to={`/suppliers/${m.link.supplierId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : m.link.clientId ? <Link to={`/clients/${m.link.clientId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : <span>{m.link.label}</span>;

  type Movement = (typeof rows)[number];
  const sumQty = (list: Movement[]) => Math.round(list.reduce((s, m) => s + m.quantity, 0) * 1000) / 1000;
  const dash = <span className="text-muted-foreground/50">—</span>;
  // In and Out split exactly as before: a purchase is In, everything else Out.
  const movementColumns: DataColumn<Movement>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: m => +new Date(m.createdAt),
      cell: m => <CellDate>{fmtDate(m.createdAt)}</CellDate> },
    { key: "bucket", header: bucketLabel, sortValue: m => String(m.purityOrQuality),
      cell: m => <CellTag tone="blue">{m.purityOrQuality}</CellTag> },
    { key: "particulars", header: "Particulars", sortValue: m => m.link.label,
      cell: m => <span>{particulars(m)}{m.note ? <span className="text-xs text-muted-foreground"> · {m.note}</span> : null}</span> },
    { key: "in", header: `In (${unit})`, align: "right", kind: "number", sortValue: m => (m.type === "purchase_in" ? m.quantity : null),
      cell: m => (m.type === "purchase_in" ? <CellAmount tone="in">{m.quantity.toLocaleString()}</CellAmount> : dash) },
    { key: "out", header: `Out (${unit})`, align: "right", kind: "number", sortValue: m => (m.type === "purchase_in" ? null : m.quantity),
      cell: m => (m.type === "purchase_in" ? dash : <CellAmount tone="out">{m.quantity.toLocaleString()}</CellAmount>) },
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: m => balanceById.get(m.id) ?? 0,
      cell: m => <span className="tabular-nums whitespace-nowrap font-medium text-brand-dark">{(balanceById.get(m.id) ?? 0).toLocaleString()} {unit}</span> },
    { key: "rate", header: "Rate", align: "right", kind: "number", sortValue: m => inrRateAmount(m)?.rate,
      cell: m => { const ra = inrRateAmount(m); return ra ? <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(ra.rate)}/{unit}</span> : dash; } },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: m => inrRateAmount(m)?.amount,
      cell: m => { const ra = inrRateAmount(m); return ra ? <CellAmount>{fmtMoneyInr(ra.amount)}</CellAmount> : dash; } },
  ];

  const exportCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      `Stock-${materialLabel.replace(/\s+/g, "_")}${selectedBucket ? `-${selectedBucket}` : ""}`,
      ["Date", bucketLabel, "Particulars", `In (${unit})`, `Out (${unit})`, `Balance (${unit})`, "Rate (Rs)", "Amount (Rs)"],
      rows.filter(m => inDateRange(m.createdAt, from, to)).map(m => {
        const ra = inrRateAmount(m);
        return [
          fmtDate(m.createdAt), m.purityOrQuality, m.link.label,
          m.type === "purchase_in" ? m.quantity : "",
          m.type === "purchase_in" ? "" : m.quantity,
          balanceById.get(m.id) ?? 0,
          ra ? Math.round(ra.rate) : "",
          ra ? Math.round(ra.amount) : "",
        ];
      }),
    );
  };

  const exportPdf = (from: Date | null, to: Date | null) => {
    const filtered = rows.filter(m => inDateRange(m.createdAt, from, to));
    downloadLedgerPdf({
      title: `${materialLabel} — Movement History`,
      subjectLines: [
        selectedBucket ? `Bucket: ${selectedBucket}` : "All purities/shapes",
        "Rate & Amount in Rs (INR)",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: entries.map(([key, qty]) => ({ label: key, value: `${qty.toLocaleString()} ${unit}` })),
      landscape: true,
      columns: [
        { header: "Date", x: 14 },
        { header: bucketLabel, x: 42 },
        { header: "Particulars", x: 70 },
        { header: "In", x: 172 },
        { header: "Out", x: 196 },
        { header: "Balance", x: 220 },
        { header: "Rate", x: 242 },
        { header: "Amount", x: 262 },
      ],
      align: ["left", "left", "left", "right", "right", "right", "right", "right"],
      rows: filtered.map(m => {
        const ra = inrRateAmount(m);
        const rs = (n: number) => Math.round(n).toLocaleString("en-IN");
        return [
          fmtDate(m.createdAt), String(m.purityOrQuality), m.link.label,
          m.type === "purchase_in" ? `${m.quantity}${unit}` : "—",
          m.type === "purchase_in" ? "—" : `${m.quantity}${unit}`,
          `${(balanceById.get(m.id) ?? 0).toLocaleString()}${unit}`,
          ra ? rs(ra.rate) : "—",
          ra ? rs(ra.amount) : "—",
        ];
      }),
      filename: `Stock-${materialLabel.replace(/\s+/g, "_")}${selectedBucket ? `-${selectedBucket}` : ""}`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <button onClick={() => navigate("/stock")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Stock
      </button>

      <div className="flex items-center gap-3">
        <div className={`h-12 w-12 rounded-2xl grid place-items-center shrink-0 ${material === "gold" ? "bg-amber-500/15" : material === "diamond" ? "bg-cyan-500/15" : "bg-emerald-500/15"}`}>
          {material === "gold" ? <Coins className="h-5 w-5 text-amber-600" /> : material === "diamond" ? <Gem className="h-5 w-5 text-cyan-600" /> : <Layers className="h-5 w-5 text-emerald-600" />}
        </div>
        <div>
          <h1 className="font-display text-2xl text-brand-dark leading-tight">{materialLabel}</h1>
          <p className="text-sm text-muted-foreground">{material === "gold" ? "By purity" : material === "diamond" ? "Pooled by shape" : `${def ? KIND_LABEL[def.kind] : ""} · by grade, in ${unit}`} · full movement history</p>
        </div>
        <div className="ml-auto"><CompanyFilter value={co} onChange={pickCo} /></div>
      </div>

      {user?.role === "admin" && material === "diamond" && badShapeCount > 0 && (
        <div className="card-luxe p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>{badShapeCount} diamond movement{badShapeCount !== 1 ? "s are" : " is"} filed by quality / "unspecified" instead of shape (bought before the shape fix). Re-file them under their real shape — balances are unaffected.</span>
          <AsyncButton onClick={fixDiamondShapes} className="btn-hero rounded-xl shrink-0">Fix shapes</AsyncButton>
        </div>
      )}

      <div className="card-luxe p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="font-display text-base text-brand-dark">Balances</h3>
          {selectedBucket && (
            <button onClick={() => setSelectedBucket(null)} className="text-xs text-primary hover:underline">Show all</button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in stock.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {entries.map(([key, qty]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedBucket(v => (v === key ? null : key))}
                className={`flex items-center justify-between p-2.5 rounded-xl text-left transition-colors ${
                  selectedBucket === key ? "bg-primary/10 ring-1 ring-primary/30" : "bg-secondary hover:bg-secondary/70"
                }`}
              >
                <span className="text-sm font-medium">{key}</span>
                <span className="text-sm font-semibold">{qty.toLocaleString()} {unit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-brand-dark">Movement History{selectedBucket ? ` — ${selectedBucket}` : ""}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{filteredRows.length} movement{filteredRows.length !== 1 ? "s" : ""}</p>
          </div>
          <IfExport>
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
          </IfExport>
          <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${materialLabel}${selectedBucket ? ` — ${selectedBucket}` : ""}`} options={[
            { label: "Movement History — PDF", sublabel: "Filterable by date range", kind: "pdf", run: exportPdf },
            { label: "Movement History — Excel", sublabel: "Filterable by date range", kind: "excel", run: exportCsv },
          ]} />
        </div>
        <div className="px-5 py-3 border-b border-border/60 bg-secondary/20 flex items-center gap-2 flex-wrap">
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
          {filtersActive && (
            <button onClick={() => { setFilterFrom(""); setFilterTo(""); }} className="text-xs text-primary hover:underline">
              Reset
            </button>
          )}
        </div>
        {/* Where bought / where went, rate & amount. The date range above
            narrows the rows; the balances were worked out over every movement. */}
        <div className="p-3 sm:p-4">
          <DataTable
            id="stock-movements"
            noun="movement"
            rows={filteredRows}
            columns={movementColumns}
            rowKey={m => m.id}
            defaultSort={{ key: "date", dir: "desc" }}
            searchText={m => [m.purityOrQuality, m.link.label, m.note].filter(Boolean).join(" ")}
            searchPlaceholder="Search movements"
            totals={{
              in: list => <span className="text-success">{sumQty(list.filter(m => m.type === "purchase_in")).toLocaleString()}</span>,
              out: list => <span className="text-destructive">{sumQty(list.filter(m => m.type !== "purchase_in")).toLocaleString()}</span>,
            }}
            emptyText={rows.length === 0 ? "No movements recorded." : "No movements match this date range."}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Certified Diamonds — packet grid, edit, delete ── */

function CertifiedSection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = useDb();
  const [editPacket, setEditPacket] = useState<DiamondPacket | null>(null);
  // Rate is edited as free text so a half-typed number does not snap to 0.
  const [editRate, setEditRate] = useState("");
  const [savingPacket, setSavingPacket] = useState(false);
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [showExport, setShowExport] = useState(false);

  const [sp, setSp] = useSearchParams();
  const multiCo = useMultiCo();
  const co = multiCo ? (sp.get("co") || "all") : "all";
  const pickCo = (v: string) => setSp(prev => { const n = new URLSearchParams(prev); if (v === "all") n.delete("co"); else n.set("co", v); return n; });
  const inCo = (p: DiamondPacket) => co === "all" || companyOf(p) === co;
  const allInStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && inCo(p));

  // ── Full certified-diamond history — every packet ever bought: from which
  // supplier, at what rate, and where it went (still in stock / issued / used
  // in an order / sold). This is what "where to buy / which supplier" needs. ──
  const supplierName = (id?: string) => (id ? db.suppliers.find(s => s.id === id)?.name : undefined);
  const purchaseOf = (id?: string) => (id ? db.purchases.find(p => p.id === id) : undefined);
  const orderNoOf = (id?: string) => (id ? db.orders.find(o => o.id === id)?.orderNumber : undefined);
  const boughtDate = (p: DiamondPacket) => purchaseOf(p.purchaseId)?.invoiceDate || purchaseOf(p.purchaseId)?.createdAt || p.createdAt;
  const STATUS_LABEL: Record<DiamondPacket["status"], string> = { in_stock: "In stock", issued: "Issued", used: "Used in order", sold: "Sold" };

  const allPackets = [...(db.diamondPackets ?? [])].filter(inCo).sort((a, b) => +new Date(boughtDate(b)) - +new Date(boughtDate(a)));
  const histFromDate = histFrom ? new Date(histFrom + "T00:00:00") : null;
  const histToDate = histTo ? new Date(histTo + "T23:59:59.999") : null;
  const histActive = !!histFrom || !!histTo;
  const histRows = allPackets.filter(p => inDateRange(boughtDate(p), histFromDate, histToDate));

  /**
   * What a certified stone cost, in the currency it was actually bought in.
   *
   * A certified line is one stone and one purchase, so the bill’s own figures
   * belong to this packet exactly — no dividing a shared total. A stone bought
   * in dollars carries the dollar amount and the rate it was converted at, both
   * as entered; a rupee purchase simply has no dollar side, and inventing one
   * at today’s rate would misstate what was paid.
   */
  const costOf = (p: DiamondPacket) => {
    const pu = purchaseOf(p.purchaseId);
    const inr = p.ratePerCaratInr ? Math.round(p.ratePerCaratInr * p.carat) : (pu?.totalInr ?? undefined);
    const usd = pu?.currency === "USD" ? pu.totalUsd : undefined;
    return {
      currency: pu?.currency ?? "",
      rateInr: p.ratePerCaratInr,
      totalInr: inr,
      rateUsd: usd != null && p.carat > 0 ? Math.round((usd / p.carat) * 100) / 100 : undefined,
      totalUsd: usd,
      exchangeRate: pu?.currency === "USD" ? pu.exchangeRate : undefined,
    };
  };

  const exportCertCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      "Stock-Certified_Diamonds-History",
      [
        "Bought", "Stock #", "Shape", "Carat", "Measurement (mm)",
        "Color", "Clarity", "Cut", "Polish", "Symmetry", "Fluorescence", "Quality",
        "Report Number", "Lab", "Supplier",
        "Currency", "Rate/ct ($)", "Total ($)", "Exchange Rate",
        "Rate/ct (INR)", "Total (INR)", "Status", "Order",
      ],
      allPackets.filter(p => inDateRange(boughtDate(p), from, to)).map(p => {
        const c = costOf(p);
        return [
          fmtDate(boughtDate(p)), p.stockNumber ?? "", p.shape, p.carat, p.measurement ?? "",
          p.color ?? "", p.clarity ?? "", p.cut ?? "", p.polish ?? "", p.symmetry ?? "",
          p.fluorescence ?? "", p.quality ?? "",
          p.certificateNumber, p.certificateLab ?? "", supplierName(p.supplierId) ?? "",
          c.currency, c.rateUsd ?? "", c.totalUsd ?? "", c.exchangeRate ?? "",
          c.rateInr ?? "", c.totalInr ?? "",
          STATUS_LABEL[p.status], orderNoOf(p.orderId) ?? "",
        ];
      }),
    );
  };
  const exportCertPdf = (from: Date | null, to: Date | null) => {
    const filtered = allPackets.filter(p => inDateRange(boughtDate(p), from, to));
    downloadLedgerPdf({
      title: "Certified Diamonds — Full History",
      subjectLines: [
        `${filtered.length} packet${filtered.length !== 1 ? "s" : ""}${from || to ? " (filtered)" : " (all time)"}`,
        "Totals in Rs (INR); the $ column is what a dollar purchase was billed at",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Carats", value: String(Math.round(filtered.reduce((s, p) => s + p.carat, 0) * 100) / 100) },
        { label: "In stock", value: String(filtered.filter(p => p.status === "in_stock").length) },
        { label: "Issued / used", value: String(filtered.filter(p => p.status === "issued" || p.status === "used").length) },
        { label: "Sold", value: String(filtered.filter(p => p.status === "sold").length) },
      ],
      landscape: true,
      columns: [
        { header: "Bought", x: 14 }, { header: "Stock #", x: 37 }, { header: "Shape", x: 54 },
        { header: "Ct", x: 82 }, { header: "Color", x: 86 }, { header: "Clarity", x: 99 },
        { header: "Report", x: 115 }, { header: "Supplier", x: 149 },
        { header: "Rate/ct", x: 196 }, { header: "Total Rs", x: 221 }, { header: "Total $", x: 242 },
        { header: "Status", x: 246 },
      ],
      align: ["left", "left", "left", "right", "left", "left", "left", "left", "right", "right", "right", "left"],
      rows: filtered.map(p => {
        const c = costOf(p);
        return [
          fmtDate(boughtDate(p)), p.stockNumber ?? "—", p.shape.slice(0, 12), String(p.carat),
          (p.color ?? "—").slice(0, 6), (p.clarity ?? "—").slice(0, 7),
          String(p.certificateNumber).slice(0, 20),
          (supplierName(p.supplierId) ?? "—").slice(0, 28),
          c.rateInr ? Math.round(c.rateInr).toLocaleString("en-IN") : "—",
          c.totalInr ? Math.round(c.totalInr).toLocaleString("en-IN") : "—",
          c.totalUsd != null ? c.totalUsd.toLocaleString("en-US") : "—",
          (STATUS_LABEL[p.status] + (p.orderId ? ` (${orderNoOf(p.orderId) ?? ""})` : "")).slice(0, 26),
        ];
      }),
      filename: "Stock-Certified_Diamonds-History",
    });
  };
  // ── The two packet tables ──
  const gradeOf = (p: DiamondPacket) => [p.color, p.clarity, [p.cut, p.polish, p.symmetry].filter(Boolean).join("/"), p.fluorescence]
    .filter(Boolean).join(" · ");
  const sumCarat = (list: DiamondPacket[]) => Math.round(list.reduce((s, p) => s + p.carat, 0) * 100) / 100;
  const packetSearch = (p: DiamondPacket) =>
    [p.stockNumber, p.shape, p.certificateNumber, p.certificateLab, p.color, p.clarity, supplierName(p.supplierId)].filter(Boolean).join(" ");
  const dash = <span className="text-muted-foreground/50">—</span>;
  const STATUS_TONE: Record<DiamondPacket["status"], "green" | "blue" | "neutral" | "violet"> = { in_stock: "green", issued: "blue", used: "neutral", sold: "violet" };
  const packetCols = {
    stock: { key: "stock", header: "Stock #", sortValue: p => p.stockNumber, csv: p => p.stockNumber ?? "",
      cell: p => (p.stockNumber ? <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{p.stockNumber}</span> : dash) },
    diamond: { key: "diamond", header: "Diamond", always: true, kind: "number", sortValue: p => p.carat, csv: p => `${p.shape} ${p.carat} ct`,
      cell: p => <CellMain title={<>{p.shape} · <span className="text-cyan-700">{p.carat} ct</span></>} sub={gradeOf(p) || undefined} /> },
    certificate: { key: "certificate", header: "Certificate", sortValue: p => p.certificateNumber, csv: p => `${p.certificateNumber}${p.certificateLab ? ` ${p.certificateLab}` : ""}`,
      cell: p => <span className="text-xs text-muted-foreground whitespace-nowrap">{p.certificateNumber}{p.certificateLab ? ` · ${p.certificateLab}` : ""}</span> },
    supplier: { key: "supplier", header: "Supplier", sortValue: p => supplierName(p.supplierId), csv: p => supplierName(p.supplierId) ?? "",
      cell: p => (p.supplierId ? <Link to={`/suppliers/${p.supplierId}`} className="text-primary hover:underline font-medium whitespace-nowrap">{supplierName(p.supplierId)}</Link> : dash) },
    rate: { key: "rate", header: "Rate/ct", align: "right", kind: "number", sortValue: p => p.ratePerCaratInr,
      cell: p => (p.ratePerCaratInr ? <span className="tabular-nums whitespace-nowrap">{fmtMoneyInr(p.ratePerCaratInr)}</span> : dash) },
    bought: { key: "bought", header: "Bought", kind: "date", sortValue: p => +new Date(boughtDate(p)), csv: p => fmtDate(boughtDate(p)),
      cell: p => <CellDate>{fmtDate(boughtDate(p))}</CellDate> },
  } satisfies Record<string, DataColumn<DiamondPacket>>;
  // In stock: what each stone is — stock number first, as on the old cards.
  const inStockColumns: DataColumn<DiamondPacket>[] = [
    { ...packetCols.stock, always: true },
    packetCols.diamond,
    { key: "measurement", header: "Measurement", sortValue: p => p.measurement, csv: p => p.measurement ?? "",
      cell: p => (p.measurement ? <span className="text-xs text-muted-foreground whitespace-nowrap">{p.measurement}</span> : dash) },
    packetCols.certificate,
    packetCols.supplier,
    packetCols.rate,
    packetCols.bought,
  ];
  // History: when it was bought, what it cost and where it went.
  const historyColumns: DataColumn<DiamondPacket>[] = [
    { ...packetCols.bought, always: true },
    packetCols.stock,
    packetCols.diamond,
    packetCols.certificate,
    packetCols.supplier,
    packetCols.rate,
    { key: "cost", header: "Cost", align: "right", kind: "number", sortValue: p => (p.ratePerCaratInr ? p.ratePerCaratInr * p.carat : null),
      cell: p => (p.ratePerCaratInr ? <CellAmount>{fmtMoneyInr(p.ratePerCaratInr * p.carat)}</CellAmount> : dash) },
    { key: "status", header: "Status", sortValue: p => STATUS_LABEL[p.status],
      cell: p => <CellTag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</CellTag> },
    { key: "order", header: "Order", sortValue: p => orderNoOf(p.orderId),
      cell: p => (p.orderId ? <Link to={`/orders/${p.orderId}`} className="text-xs text-primary hover:underline whitespace-nowrap">{orderNoOf(p.orderId) ?? "Order"}</Link> : dash) },
  ];
  const unnumberedCount = (db.diamondPackets ?? []).filter(p => !p.stockNumber).length;

  const assignMissingStockNumbers = () => {
    updateDb(d => {
      for (const p of d.diamondPackets ?? []) {
        if (!p.stockNumber) p.stockNumber = nextDiamondStockNumber(d);
      }
    });
    toast.success("Stock numbers assigned");
  };

  /**
   * Save the packet. Grading details are the packet's own, but CARAT and the
   * RATE belong to the purchase that brought the stone in — change either here
   * and the supplier's bill, the order's cost log and the stock trail have to
   * move with it, or the stone's value and what we owe for it stop agreeing.
   * So those two go through editPurchase()'s cascade whenever the stone came
   * from a recorded purchase.
   */
  const savePacketEdit = async () => {
    if (!editPacket) return;
    const p = editPacket;
    if (!p.shape) { toast.error("Choose a shape"); return; }
    if (!p.carat || p.carat <= 0) { toast.error("Enter a valid carat weight"); return; }
    if (!p.certificateNumber.trim()) { toast.error("Report number is required"); return; }
    const rateInr = editRate.trim() === "" ? undefined : Number(editRate);
    if (rateInr !== undefined && (!isFinite(rateInr) || rateInr < 0)) { toast.error("Enter a valid rate per carat"); return; }

    const live = loadDb();
    const before = (live.diamondPackets ?? []).find(x => x.id === p.id);
    const purchase = p.purchaseId ? (live.purchases ?? []).find(x => x.id === p.purchaseId) : undefined;
    const moneyChanged =
      Math.abs((before?.carat ?? 0) - p.carat) > 0.0001 ||
      Math.round((before?.ratePerCaratInr ?? 0) * 100) !== Math.round((rateInr ?? 0) * 100);

    let billNote = "";
    if (moneyChanged && purchase) {
      const scope = purchaseEditScope(live, purchase);
      // A stone already set into a finished piece keeps its weight; only its
      // price can still be corrected.
      const caratChanged = Math.abs((before?.carat ?? 0) - p.carat) > 0.0001;
      if (caratChanged && !scope.quantity) {
        toast.error(scope.reason ?? "This stone’s weight can no longer be changed.");
        return;
      }
      if (scope.money) {
        // The rate on a packet is its NET cost per carat. Convert it back into
        // the purchase's own billing currency, keeping any recorded discount so
        // qty x rate less discount still lands on the same rupee figure.
        const disc = Math.min(Math.max(purchase.discountPct ?? 0, 0), 99.99);
        const netInr = (rateInr ?? 0) * p.carat;
        const isUsd = purchase.currency === "USD";
        const fx = purchase.exchangeRate ?? 0;
        const netBilling = isUsd && fx > 0 ? netInr / fx : netInr;
        const grossRate = p.carat > 0 ? netBilling / p.carat / (1 - disc / 100) : 0;
        setSavingPacket(true);
        try {
          await editPurchase(live, purchase, {
            quantity: p.carat,
            ratePerUnit: Math.round(grossRate * 100) / 100,
            discountPct: disc,
            totalInr: Math.round(netInr),
            totalUsd: isUsd ? Math.round(netBilling * 100) / 100 : undefined,
            exchangeRate: isUsd ? fx : undefined,
            invoiceNumber: purchase.invoiceNumber,
            notes: purchase.notes,
            quality: p.quality,
            certificateNumber: p.certificateNumber,
            certificateLab: p.certificateLab,
          }, user!.id);
          billNote = " — the supplier's bill was corrected too";
        } catch {
          toast.error("Couldn't update the supplier's bill — nothing was changed");
          setSavingPacket(false);
          return;
        } finally { setSavingPacket(false); }
      } else {
        // Paid for, or already used in a piece. Re-valuing the stone is still
        // allowed, but the supplier's settled bill must not move underneath it.
        billNote = ` — the supplier’s bill was left alone (${scope.reason ?? "it is already settled"})`;
      }
    }

    updateDb(d => {
      const idx = (d.diamondPackets ?? []).findIndex(x => x.id === p.id);
      if (idx >= 0) {
        const clean = <T,>(v: T) => (typeof v === "string" && v.trim() === "" ? undefined : v);
        // A stone still in stock may move to another of our companies; one already
        // issued or used stays with the company whose order took it.
        const companyMove = d.diamondPackets[idx].status === "in_stock" ? (companyOf(p) !== companyOf(d.diamondPackets[idx]) ? coField(companyOf(p)) : null) : null;
        if (companyMove) { delete d.diamondPackets[idx].companyId; Object.assign(d.diamondPackets[idx], companyMove); }
        d.diamondPackets[idx] = {
          ...d.diamondPackets[idx],
          shape: p.shape,
          carat: p.carat,
          ratePerCaratInr: rateInr && rateInr > 0 ? Math.round(rateInr * 100) / 100 : undefined,
          color: clean(p.color?.trim()),
          clarity: clean(p.clarity?.trim()),
          cut: clean(p.cut?.trim()),
          polish: clean(p.polish?.trim()),
          symmetry: clean(p.symmetry?.trim()),
          fluorescence: clean(p.fluorescence?.trim()),
          measurement: clean(p.measurement?.trim()),
          certificateNumber: p.certificateNumber.trim(),
          certificateLab: clean(p.certificateLab?.trim()),
        };
      }
    });
    toast.success(`Certified diamond updated${billNote}`);
    setEditPacket(null);
  };

  const deletePacket = async (p: DiamondPacket) => {
    if (p.status !== "in_stock") {
      toast.error("This packet is already issued or used — cancel it from the order instead.");
      return;
    }
    if (!(await confirmBox(`Delete this ${p.shape} ${p.carat}ct packet (Report ${p.certificateNumber})? This can't be undone.`))) return;
    updateDb(d => {
      d.diamondPackets = (d.diamondPackets ?? []).filter(x => x.id !== p.id);
    });
    toast.success("Packet deleted");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <button onClick={() => navigate("/stock")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Stock
      </button>

      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-violet-500/15 grid place-items-center shrink-0"><BadgeCheck className="h-5 w-5 text-violet-600" /></div>
        <div>
          <h1 className="font-display text-2xl text-brand-dark leading-tight">Certified Diamonds</h1>
          <p className="text-sm text-muted-foreground">{allInStockPackets.length} packet{allInStockPackets.length !== 1 ? "s" : ""} in stock · each with its own certificate</p>
        </div>
        <div className="ml-auto"><CompanyFilter value={co} onChange={pickCo} /></div>
      </div>

      {user?.role === "admin" && unnumberedCount > 0 && (
        <div className="card-luxe p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>{unnumberedCount} diamond{unnumberedCount !== 1 ? "s" : ""} {unnumberedCount !== 1 ? "don't" : "doesn't"} have a stock number yet (from before this feature existed).</span>
          <Button size="sm" onClick={assignMissingStockNumbers} className="btn-hero rounded-xl shrink-0">Assign stock numbers</Button>
        </div>
      )}

      <div className="card-luxe p-3 sm:p-4">
        <DataTable
          id="stock-certified-in-stock"
          noun="packet"
          rows={allInStockPackets}
          columns={inStockColumns}
          rowKey={p => p.id}
          defaultSort={{ key: "bought", dir: "desc" }}
          searchText={packetSearch}
          searchPlaceholder="Search stock #, shape, or certificate…"
          exportName="Stock-Certified_Diamonds-In_Stock"
          totals={{ diamond: list => `${sumCarat(list)} ct` }}
          rowActions={p => [
            { label: "Edit", icon: Pencil, onSelect: () => { setEditPacket({ ...p }); setEditRate(p.ratePerCaratInr ? String(p.ratePerCaratInr) : ""); }, show: user?.role === "admin" },
            { label: "Delete", icon: Trash2, danger: true, onSelect: () => deletePacket(p), show: user?.role === "admin" },
          ]}
          emptyText="No certified diamonds in stock."
        />
      </div>

      {/* Full history — every certified diamond bought: supplier, rate & where it went */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-brand-dark">Purchase &amp; Movement History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{histRows.length} packet{histRows.length !== 1 ? "s" : ""} · bought from which supplier &amp; where each went</p>
          </div>
          <IfExport>
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
          </IfExport>
          <ExportDialog open={showExport} onClose={() => setShowExport(false)} title="Certified Diamonds — History" options={[
            { label: "Full History — PDF", sublabel: "Filterable by date range", kind: "pdf", run: exportCertPdf },
            { label: "Full History — Excel", sublabel: "Shape, size, colour, clarity, report no., $ + rate, INR, supplier, status", kind: "excel", run: exportCertCsv },
          ]} />
        </div>
        <div className="px-5 py-3 border-b border-border/60 bg-secondary/20 flex items-center gap-2 flex-wrap">
          <Input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
          {histActive && <button onClick={() => { setHistFrom(""); setHistTo(""); }} className="text-xs text-primary hover:underline">Reset</button>}
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            id="stock-certified-history"
            noun="packet"
            rows={histRows}
            columns={historyColumns}
            rowKey={p => p.id}
            defaultSort={{ key: "bought", dir: "desc" }}
            searchText={p => [packetSearch(p), STATUS_LABEL[p.status], orderNoOf(p.orderId)].filter(Boolean).join(" ")}
            searchPlaceholder="Search stock #, certificate, supplier…"
            totals={{
              diamond: list => `${sumCarat(list)} ct`,
              cost: list => fmtMoneyInr(list.reduce((s, p) => s + (p.ratePerCaratInr ? p.ratePerCaratInr * p.carat : 0), 0)),
            }}
            emptyText={allPackets.length === 0 ? "No certified diamonds purchased yet." : "None match this date range."}
          />
        </div>
      </div>

      {/* Edit certified packet (admin) — fix a mistyped certificate/grade */}
      {editPacket && (
        <Dialog open onOpenChange={v => { if (!v) setEditPacket(null); }}>
          <DialogContent className="max-w-3xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-display text-xl text-brand-dark">Edit Certified Diamond</DialogTitle>
              <DialogDescription className="text-xs">Correct the certificate, grading details or cost for this packet.</DialogDescription>
            </DialogHeader>
            {multiCo && editPacket.status === "in_stock" && (
              <CompanyPicker value={companyOf(editPacket)} onChange={v => setEditPacket({ ...editPacket, companyId: v === "main" ? undefined : v })}
                label="Company — whose stock it is" hint="Moving it hands the stone to that company's stock." />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Shape</Label>
                <Select value={editPacket.shape} onValueChange={v => setEditPacket({ ...editPacket, shape: v })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Shape" /></SelectTrigger>
                  <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Carat</Label>
                <Input type="number" step="0.01" min={0} value={editPacket.carat} onChange={e => setEditPacket({ ...editPacket, carat: Number(e.target.value) })} className="rounded-xl mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Rate / ct (INR)</Label>
                <Input type="number" step="0.01" min={0} value={editRate} onChange={e => setEditRate(e.target.value)} className="rounded-xl mt-1" placeholder="Cost per carat" />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Stone value {editPacket.carat > 0 && Number(editRate) > 0 ? fmtMoneyInr(Math.round(Number(editRate) * editPacket.carat)) : "—"}.
                  {editPacket.purchaseId ? " Changing the carat or rate corrects the supplier’s bill for this stone too." : ""}
                </p>
              </div>
              <div>
                <Label className="text-xs">Color</Label>
                <Input value={editPacket.color ?? ""} onChange={e => setEditPacket({ ...editPacket, color: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Clarity</Label>
                <Input value={editPacket.clarity ?? ""} onChange={e => setEditPacket({ ...editPacket, clarity: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Cut</Label>
                <Input value={editPacket.cut ?? ""} onChange={e => setEditPacket({ ...editPacket, cut: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Polish</Label>
                <Input value={editPacket.polish ?? ""} onChange={e => setEditPacket({ ...editPacket, polish: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Symmetry</Label>
                <Input value={editPacket.symmetry ?? ""} onChange={e => setEditPacket({ ...editPacket, symmetry: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Fluorescence</Label>
                <Input value={editPacket.fluorescence ?? ""} onChange={e => setEditPacket({ ...editPacket, fluorescence: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Measurement</Label>
                <Input value={editPacket.measurement ?? ""} onChange={e => setEditPacket({ ...editPacket, measurement: e.target.value })} className="rounded-xl mt-1" placeholder="6.5 x 6.5 x 4.0 mm" />
              </div>
              <div>
                <Label className="text-xs">Report Number</Label>
                <Input value={editPacket.certificateNumber} onChange={e => setEditPacket({ ...editPacket, certificateNumber: e.target.value })} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label className="text-xs">Lab</Label>
                <Input value={editPacket.certificateLab ?? ""} onChange={e => setEditPacket({ ...editPacket, certificateLab: e.target.value })} className="rounded-xl mt-1" placeholder="GIA / IGI" />
              </div>
            </div>
            <DialogFooter>
              <button onClick={() => setEditPacket(null)} className="h-10 px-4 rounded-xl border border-border bg-card text-sm font-medium hover:bg-secondary">Cancel</button>
              <AsyncButton onClick={savePacketEdit} disabled={savingPacket} className="btn-hero rounded-xl px-5">{savingPacket ? "Saving…" : "Save Changes"}</AsyncButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
