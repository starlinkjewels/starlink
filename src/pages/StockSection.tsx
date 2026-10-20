import { useState } from "react";
import { SectionTitle } from "@/components/SectionTitle";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CompanyFilter, CompanyPicker, CompanyBadge, useMultiCo } from "@/components/CompanyFields";
import { companyOf, coField, companyById } from "@/lib/companies";
import { useCan } from "@/hooks/useCan";
import { fmtCcy, rateText } from "@/lib/currency";
import { filled, noteText, recorded, refLink, type Detail } from "@/components/rowDetails";
import { fmtDate, loadDb, updateDb, DIAMOND_SHAPES, nextDiamondStockNumber, type DiamondPacket, type StockMovement, type Purchase } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { stockBucketHistory, deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { recomputeStockFromHistory } from "@/lib/stock";
import { purchaseEditScope, editPurchase, canVoidPurchase, voidPurchase, voidImpact } from "@/lib/purchaseVoid";
import { isOpeningMovement } from "@/lib/openingStock";
import { OpeningStockEditSheet, openingStockActions } from "@/components/OpeningStockEditSheet";
import type { MoreAction } from "@/components/MoreMenu";
import { needsAccess } from "@/lib/actionHints";
import { AsyncButton } from "@/components/AsyncButton";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { inDateRange } from "@/components/ExportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, ExternalLink, Lock, FileText, FileSpreadsheet, BadgeCheck, Gem, Wallet } from "lucide-react";
import { isOtherMaterial, materialDef, materialUnit, purchaseQty, KIND_LABEL, type MaterialKey } from "@/lib/materials";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";
import { PageHeader } from "@/components/PageHeader";
import { lotShape } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { StockLotsTable } from "@/components/StockLotsTable";
import { ListSelect, CertGradeFields } from "@/components/LotFields";
import { StatStrip, type TableFilter } from "@/components/TableToolbar";
import { listOf } from "@/lib/optionLists";

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
  const filteredRows = rows.filter(m => inDateRange(m.createdAt, filterFromDate, filterToDate));

  const materialLabel = material === "gold" ? "Gold Reserve" : material === "diamond" ? "Loose Diamonds" : (def?.name ?? "Material");
  const bucketLabel = material === "gold" ? "Purity" : material === "diamond" ? "Lot" : "Grade"; // purityOrQuality = the lot for loose diamonds (lib/diamondLots.ts), grade for the rest

  // ── One-time cleanup: older order-bought loose diamonds were filed by quality
  // grade ("EF VVS") or "unspecified" instead of shape. Each is part of a
  // net-zero direct-use pair, so re-labelling to the real shape (from the linked
  // purchase) changes NO balance — it just fixes the Shape column. Admin only. ──
  const { user } = useAuth();
  // The standard shapes and any the business added (Settings → Dropdown lists).
  const SHAPE_SET = new Set([...DIAMOND_SHAPES, ...listOf("diamondShapes", db.settings)].map(s => s.toLowerCase()));
  // A lot ("Round · +6.5-7 · G-H · VS") is filed under its shape too — only its first part must be a shape.
  const isBadShape = (v: string) => v !== "Certified" && !SHAPE_SET.has(lotShape(String(v)).toLowerCase());
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
    { key: "bucket", header: material === "diamond" ? "Bag" : bucketLabel, sortValue: m => String(m.purityOrQuality),
      csv: m => [material === "diamond" ? bagNoOf(db, m.purityOrQuality) : undefined, m.purityOrQuality].filter(Boolean).join(" · "),
      cell: m => material === "diamond" && bagNoOf(db, m.purityOrQuality)
        ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="font-mono text-xs font-semibold text-primary">{bagNoOf(db, m.purityOrQuality)}</span><CellTag tone="blue">{m.purityOrQuality}</CellTag></span>
        : <CellTag tone="blue">{m.purityOrQuality}</CellTag> },
    // Loose diamonds: how many stones moved, when counted.
    ...(material === "diamond" ? [{ key: "pcs", header: "Pcs", align: "right" as const, kind: "number" as const, sortValue: (m: Movement) => m.pieces ?? null,
      cell: (m: Movement) => (m.pieces != null ? <span className="tabular-nums">{m.type === "purchase_in" ? "+" : "−"}{m.pieces}</span> : dash) }] : []),
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

  // An opened movement: what kind it was, its note, the bill behind a purchase
  // (and the order it was bought for), the factory an order's issue went to,
  // the company, and who recorded it when.
  const can = useCan();
  const MOVE_KIND: Record<string, string> = { purchase_in: "Into stock", issuance_out: "Issued out", order_direct_use: "Used on an order", adjustment: "Adjustment" };
  const movementDetails = (m: Movement): Detail[] => {
    const p = m.refType === "purchase" && m.refId ? db.purchases.find(x => x.id === m.refId) : undefined;
    const forOrder = p?.orderId ? db.orders.find(o => o.id === p.orderId) : undefined;
    const mi = m.refType === "materialIssuance" && m.refId ? db.materialIssuances.find(x => x.id === m.refId) : undefined;
    return filled([
      { label: "Movement", value: MOVE_KIND[m.type] ?? m.type },
      !!m.note && !m.link.label.includes(m.note) && { label: "Note", value: noteText(m.note) },
      { label: "Bill no.", value: m.link.invoiceNumber },
      !!p?.invoiceDate && { label: "Bill date", value: fmtDate(p.invoiceDate) },
      !!forOrder && m.type === "purchase_in" && { label: "Bought for order", value: refLink(`/orders/${forOrder.id}`, forOrder.orderNumber, can("orders")) },
      !!m.link.orderId && !!m.link.factoryId && { label: "Factory", value: refLink(`/factories/${m.link.factoryId}`, db.factories.find(f => f.id === m.link.factoryId)?.name ?? "Factory", can("factories")) },
      !!mi && { label: "Factory issue", value: mi.status === "closed" ? "Closed — wastage settled" : "Open" },
      multiCo && { label: "Company", value: companyById(db.settings, m.companyId).name },
      { label: "Recorded", value: recorded(db, m.createdAt, m.createdBy) },
    ]);
  };

  // ── What can be done to a movement ──
  // A movement is the trace another record left: a purchase, an issue, a sale.
  // It is corrected there, so each row offers a way to that record and says
  // where Edit and Delete live, greyed out — correcting the trace alone is how
  // the stock and its source fall out of step. Opening stock is the exception:
  // it has nothing behind it, so it is corrected here (lib/openingStock.ts).
  const [editingOpening, setEditingOpening] = useState<StockMovement | null>(null);
  const isAdmin = user?.role === "admin";
  const view = (label: string, hint: string, to: string, allowed: boolean, module: Parameters<typeof needsAccess>[0]): MoreAction => ({
    label, icon: ExternalLink, hint: allowed ? hint : needsAccess(module, "view"), disabled: !allowed, onSelect: () => navigate(to),
  });
  const locked = (why: string): MoreAction[] => [
    { label: "Edit", icon: Lock, disabled: true, hint: why, onSelect: () => {} },
    { label: "Delete", icon: Trash2, danger: true, disabled: true, hint: why, onSelect: () => {} },
  ];
  const movementActions = (m: Movement): MoreAction[] => {
    if (isOpeningMovement(m)) {
      const live = db.stockMovements.find(x => x.id === m.id) ?? m;
      const denied = isAdmin ? undefined : "Only an admin can change stock";
      return openingStockActions(db, live, { onEdit: () => setEditingOpening(live), editDenied: denied, deleteDenied: denied });
    }
    const orderView = (id: string) => view("View order", db.orders.find(o => o.id === id)?.orderNumber ?? "The order", `/orders/${id}`, can("orders"), "orders");
    if (m.refType === "purchase") {
      const p = m.refId ? db.purchases.find(x => x.id === m.refId) : undefined;
      if (!p) return locked("The purchase behind it has been removed — this line is what is left of it");
      return [
        view("View purchase", `On ${db.suppliers.find(x => x.id === p.supplierId)?.name ?? "the supplier"}'s page${p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}`, `/suppliers/${p.supplierId}`, can("suppliers"), "suppliers"),
        ...(p.orderId ? [orderView(p.orderId)] : []),
        ...locked(m.type === "purchase_in"
          ? "Edit the purchase on the supplier's page — this line follows it"
          : "Written when the purchase was corrected or removed — it follows the purchase"),
      ];
    }
    if (m.refType === "materialIssuance") {
      const mi = m.refId ? db.materialIssuances.find(x => x.id === m.refId) : undefined;
      if (!mi) return locked("The issue behind it has been cancelled — this line is what is left of it");
      return mi.orderId
        ? [orderView(mi.orderId), ...locked("Edit the issuance on the order — this line follows it")]
        : [view("View factory", db.factories.find(f => f.id === mi.factoryId)?.name ?? "The factory", `/factories/${mi.factoryId}`, can("factories"), "factories"),
          ...locked("Edit the assignment in Buy & Assign or on the factory's page — this line follows it")];
    }
    if (m.refType === "order" && m.refId) {
      return [orderView(m.refId), ...locked("Bought for this order — edit the purchase on the supplier's page; this line follows it")];
    }
    if (m.refType === "diamondSale") {
      return [view("View in Buy & Assign", "The sale is listed in its ledger", "/buy-assign", can("buyAssign"), "buyAssign"),
        ...locked("Cancel the sale in Buy & Assign — this line follows it")];
    }
    if (m.refType === "transfer") return locked("Moved between companies — move it back from the Stock page");
    // A correction, a return or a cancelled issue wrote it; point at the issue when it is still there.
    const mi = m.refId ? db.materialIssuances.find(x => x.id === m.refId) : undefined;
    const why = "Written by a correction, a return or a cancelled entry — it follows that entry and can't be changed on its own";
    if (mi?.orderId) return [orderView(mi.orderId), ...locked(why)];
    if (mi) return [view("View factory", db.factories.find(f => f.id === mi.factoryId)?.name ?? "The factory", `/factories/${mi.factoryId}`, can("factories"), "factories"), ...locked(why)];
    return locked(why);
  };

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
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
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
      <PageHeader
        back={{ label: "Back to Stock", onClick: () => navigate("/stock") }}
        title={materialLabel}
        subtitle={material === "gold" ? "By purity" : material === "diamond" ? "By bag — shape · mm · sieve · colour · clarity" : `${def ? KIND_LABEL[def.kind] : ""} · by grade, in ${unit}`}
        actions={<CompanyFilter value={co} onChange={pickCo} className="h-10 rounded-xl text-sm bg-white w-full sm:w-52" />}
      />

      {user?.role === "admin" && material === "diamond" && badShapeCount > 0 && (
        <div className="card-luxe p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>{badShapeCount} diamond movement{badShapeCount !== 1 ? "s are" : " is"} filed by quality, not shape. Re-file — balances don't change.</span>
          <AsyncButton onClick={fixDiamondShapes} className="btn-hero rounded-xl shrink-0">Fix shapes</AsyncButton>
        </div>
      )}

      {/* What is in stock, line by line — loose diamonds by lot, with filters;
          a line opens its history below. */}
      <StockLotsTable material={material} companyId={co} selected={selectedBucket} onSelect={setSelectedBucket} />

      <div className="card-luxe overflow-hidden">
        <SectionTitle className="px-5 pt-4" title="Movement History" sub={selectedBucket ?? undefined} />
        {/* Where bought / where went, rate & amount. The date range (in Filters)
            narrows the rows and the downloads; the balances were worked out
            over every movement. */}
        <div className="p-3 sm:p-4">
          <DataTable
            id="stock-movements"
            noun="movement"
            rows={filteredRows}
            filters={[{ kind: "date", from: filterFrom, to: filterTo, onChange: (f, t) => { setFilterFrom(f); setFilterTo(t); } }]}
            onClearFilters={() => { setFilterFrom(""); setFilterTo(""); }}
            exports={[
              { label: "Movement History — PDF", icon: FileText, hint: "For the dates in Filters", onSelect: () => exportPdf(filterFromDate, filterToDate) },
              { label: "Movement History — Excel", icon: FileSpreadsheet, hint: "For the dates in Filters", onSelect: () => exportCsv(filterFromDate, filterToDate) },
            ]}
            resetKey={JSON.stringify([selectedBucket, filterFrom, filterTo])}
            columns={movementColumns}
            rowKey={m => m.id}
            defaultSort={{ key: "date", dir: "desc" }}
            searchText={m => [m.purityOrQuality, m.link.label, m.note].filter(Boolean).join(" ")}
            searchPlaceholder="Search movements"
            details={movementDetails}
            rowActions={movementActions}
            totals={{
              in: list => <span className="text-success">{sumQty(list.filter(m => m.type === "purchase_in")).toLocaleString()}</span>,
              out: list => <span className="text-destructive">{sumQty(list.filter(m => m.type !== "purchase_in")).toLocaleString()}</span>,
            }}
            emptyText={rows.length === 0 ? "No movements yet." : "None in these dates."}
          />
        </div>
      </div>
      <OpeningStockEditSheet movement={editingOpening} onClose={() => setEditingOpening(null)} />
    </div>
  );
}

/* ── Certified Diamonds — packet grid, edit, delete ── */

function CertifiedSection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const db = useDb();
  const [editPacket, setEditPacket] = useState<DiamondPacket | null>(null);
  // Rate is edited as free text so a half-typed number does not snap to 0.
  const [editRate, setEditRate] = useState("");
  const [savingPacket, setSavingPacket] = useState(false);
  // Filters on the stones in stock — by what a buyer asks for.
  const [fShape, setFShape] = useState("");
  const [fColor, setFColor] = useState("");
  const [fClarity, setFClarity] = useState("");
  const [fLab, setFLab] = useState("");
  const [fSize, setFSize] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");

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
        `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
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
  // An opened stone: each grade on its own line, its bill (and what a dollar
  // bill came to), where it went — the factory it was issued to, who bought it
  // — the company, and who added it when. Each table adds what its columns lack.
  const can = useCan();
  const packetDetails = (p: DiamondPacket, table: "stock" | "history"): Detail[] => {
    const pu = purchaseOf(p.purchaseId);
    const c = costOf(p);
    const issue = p.status !== "in_stock" ? (db.materialIssuances ?? []).find(mi => mi.diamondPacketIds?.includes(p.id)) : undefined;
    const sale = p.status === "sold" ? (db.diamondSales ?? []).find(s => s.packetId === p.id) : undefined;
    const buyer = sale?.clientId ? db.clients.find(x => x.id === sale.clientId) : undefined;
    return filled([
      { label: "Color", value: p.color },
      { label: "Clarity", value: p.clarity },
      { label: "Cut", value: p.cut },
      { label: "Polish", value: p.polish },
      { label: "Symmetry", value: p.symmetry },
      { label: "Fluorescence", value: p.fluorescence },
      { label: "Quality", value: p.quality },
      table === "history" && { label: "Measurement", value: p.measurement },
      table === "stock" && !!p.ratePerCaratInr && { label: "Cost", value: fmtMoneyInr(p.ratePerCaratInr * p.carat) },
      c.totalUsd != null && { label: "Billed", value: `${fmtCcy(c.totalUsd, "USD")}${c.exchangeRate ? ` at ${rateText("USD", "INR", c.exchangeRate)}` : ""}` },
      { label: "Bill no.", value: pu?.invoiceNumber },
      !!issue && { label: "Issued to", value: <>{refLink(`/factories/${issue.factoryId}`, db.factories.find(f => f.id === issue.factoryId)?.name ?? "Factory", can("factories"))} · {fmtDate(issue.issuedAt)}</> },
      !!sale && { label: "Sold to", value: buyer ? refLink(`/clients/${buyer.id}`, buyer.companyName, can("clients")) : sale.buyerName || "Buyer" },
      !!sale && { label: "Sold on", value: fmtDate(sale.createdAt) },
      multiCo && { label: "Company", value: companyById(db.settings, p.companyId).name },
      { label: "Added", value: recorded(db, p.createdAt, p.createdBy) },
    ]);
  };
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

  // A stone that left stock is undone where it went — never deleted here.
  const STATUS_REASON: Record<Exclude<DiamondPacket["status"], "in_stock">, string> = {
    issued: "Issued to an order — cancel the issue on the order instead",
    used: "Used in a finished piece — it can't be changed here",
    sold: "Sold — cancel the sale in Buy & Assign instead",
  };
  /**
   * Whether a stone can be deleted, and through what. One bought from a
   * supplier IS that purchase — a certified line is one stone — so deleting
   * the stone alone left the supplier's bill (and anything it created) behind
   * for a stone that no longer existed. It goes through the purchase's own
   * removal instead, with that removal's rules: nothing paid against it yet.
   */
  const packetDeletion = (p: DiamondPacket): { ok: boolean; reason?: string; purchase?: Purchase } => {
    if (p.status !== "in_stock") return { ok: false, reason: STATUS_REASON[p.status] };
    const purchase = purchaseOf(p.purchaseId);
    if (!purchase) return { ok: true };
    const check = canVoidPurchase(db, purchase);
    return check.ok ? { ok: true, purchase } : { ok: false, reason: check.reason, purchase };
  };

  const deletePacket = async (p: DiamondPacket) => {
    const del = packetDeletion(p);
    if (!del.ok) { toast.error(del.reason!); return; }
    const purchase = del.purchase;
    if (purchase) {
      if (!(await confirmBox([
        `Delete this ${p.shape} ${p.carat}ct stone (Report ${p.certificateNumber})?`,
        "",
        `It was bought from ${supplierName(purchase.supplierId) ?? "a supplier"}${purchase.invoiceNumber ? ` on bill ${purchase.invoiceNumber}` : ""}, so that purchase is removed with it:`,
        ...voidImpact(db, purchase),
        "",
        "This cannot be undone.",
      ].join("\n")))) return;
      try {
        await voidPurchase(db, purchase, user!.id);
        toast.success("Stone deleted — its purchase was removed and the supplier's due reversed");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't remove its purchase — nothing was changed.");
      }
      return;
    }
    // Opening stock or a stone whose purchase is already gone: only the stone.
    if (!(await confirmBox(`Delete this ${p.shape} ${p.carat}ct packet (Report ${p.certificateNumber})?\n\nNo purchase is on file for it, so only the stone is removed. This can't be undone.`))) return;
    updateDb(d => {
      d.diamondPackets = (d.diamondPackets ?? []).filter(x => x.id !== p.id);
    });
    toast.success("Packet deleted");
  };

  // ── The ⋯ on a stone, in stock or in the history ──
  const ADMIN_ONLY = "Only an admin can change stock";
  const packetActions = (p: DiamondPacket): MoreAction[] => {
    const del = packetDeletion(p);
    const sale = p.status === "sold" ? (db.diamondSales ?? []).find(s => s.packetId === p.id) : undefined;
    const inStock = p.status === "in_stock";
    return [
      { label: "View order", icon: ExternalLink, show: !!p.orderId, disabled: !can("orders"),
        hint: can("orders") ? `${inStock ? "Reserved for" : p.status === "used" ? "Used in" : "Issued to"} ${orderNoOf(p.orderId) ?? "the order"}` : needsAccess("orders", "view"),
        onSelect: () => navigate(`/orders/${p.orderId}`) },
      { label: "View sale", icon: ExternalLink, show: p.status === "sold", disabled: !can("buyAssign"),
        hint: can("buyAssign") ? `In Buy & Assign${sale ? ` · ${fmtDate(sale.createdAt)}` : ""}` : needsAccess("buyAssign", "view"),
        onSelect: () => navigate("/buy-assign") },
      { label: "View purchase", icon: ExternalLink, show: !!p.supplierId, disabled: !can("suppliers"),
        hint: can("suppliers") ? `On ${supplierName(p.supplierId) ?? "the supplier"}'s page` : needsAccess("suppliers", "view"),
        onSelect: () => navigate(`/suppliers/${p.supplierId}`) },
      { label: "Edit", icon: Pencil, disabled: !isAdmin || !inStock,
        hint: !isAdmin ? ADMIN_ONLY : !inStock ? STATUS_REASON[p.status as Exclude<DiamondPacket["status"], "in_stock">] : "Certificate, grading and cost",
        onSelect: () => { setEditPacket({ ...p }); setEditRate(p.ratePerCaratInr ? String(p.ratePerCaratInr) : ""); } },
      { label: "Delete", icon: Trash2, danger: true, disabled: !isAdmin || !del.ok, onSelect: () => deletePacket(p),
        hint: !isAdmin ? ADMIN_ONLY : !del.ok ? del.reason : del.purchase ? "Removes the purchase it came from too" : "Only the stone — no purchase is on file for it" },
    ];
  };

  // ── Filters: shape, colour, clarity, lab, and size bands by carat ──
  const SIZE_BANDS: { key: string; label: string; min: number; max: number }[] = [
    { key: "a", label: "Under 0.30 ct", min: 0, max: 0.3 }, { key: "b", label: "0.30 – 0.49 ct", min: 0.3, max: 0.5 },
    { key: "c", label: "0.50 – 0.69 ct", min: 0.5, max: 0.7 }, { key: "d", label: "0.70 – 0.99 ct", min: 0.7, max: 1 },
    { key: "e", label: "1.00 – 1.49 ct", min: 1, max: 1.5 }, { key: "f", label: "1.50 – 1.99 ct", min: 1.5, max: 2 },
    { key: "g", label: "2.00 – 2.99 ct", min: 2, max: 3 }, { key: "h", label: "3.00 ct and over", min: 3, max: Infinity },
  ];
  const certOpts = (pick: (p: DiamondPacket) => string | undefined) =>
    [...new Set(allInStockPackets.map(p => (pick(p) || "").trim()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(v => ({ value: v || "__none", label: v || "Not recorded" }));
  const want = (w: string, have?: string) => !w || (w === "__none" ? !(have || "").trim() : (have || "").trim() === w);
  const band = SIZE_BANDS.find(b => b.key === fSize);
  const certShown = allInStockPackets.filter(p => want(fShape, p.shape) && want(fColor, p.color) && want(fClarity, p.clarity)
    && want(fLab, p.certificateLab) && (!band || (p.carat >= band.min && p.carat < band.max)));
  const certFiltered = !!(fShape || fColor || fClarity || fLab || fSize);
  const certFilters: TableFilter[] = [
    { kind: "select", label: "Shape", value: fShape, onChange: setFShape, options: certOpts(p => p.shape), allLabel: "All shapes" },
    { kind: "select", label: "Size", value: fSize, onChange: setFSize, allLabel: "All sizes",
      options: SIZE_BANDS.filter(b => allInStockPackets.some(p => p.carat >= b.min && p.carat < b.max)).map(b => ({ value: b.key, label: b.label })) },
    { kind: "select", label: "Colour", value: fColor, onChange: setFColor, options: certOpts(p => p.color), allLabel: "All colours" },
    { kind: "select", label: "Clarity", value: fClarity, onChange: setFClarity, options: certOpts(p => p.clarity), allLabel: "All clarities" },
    { kind: "select", label: "Lab", value: fLab, onChange: setFLab, options: certOpts(p => p.certificateLab), allLabel: "All labs" },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        back={{ label: "Back to Stock", onClick: () => navigate("/stock") }}
        title="Certified Diamonds"
        subtitle={`${allInStockPackets.length} packet${allInStockPackets.length !== 1 ? "s" : ""} in stock`}
        actions={<CompanyFilter value={co} onChange={pickCo} className="h-10 rounded-xl text-sm bg-white w-full sm:w-52" />}
      />

      {user?.role === "admin" && unnumberedCount > 0 && (
        <div className="card-luxe p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>{unnumberedCount} diamond{unnumberedCount !== 1 ? "s have" : " has"} no stock number yet.</span>
          <Button size="sm" onClick={assignMissingStockNumbers} className="btn-hero rounded-xl shrink-0">Assign stock numbers</Button>
        </div>
      )}

      <div className="card-luxe p-3 sm:p-4 space-y-3">
        {(() => {
          // The stones the filters leave — and what they come to.
          const r2 = (n: number) => Math.round(n * 100) / 100;
          const value = certShown.reduce((t, p) => t + (p.ratePerCaratInr ? p.ratePerCaratInr * p.carat : 0), 0);
          const unpriced = certShown.filter(p => !p.ratePerCaratInr).length;
          return (
            <StatStrip items={[
              { label: certFiltered ? "In stock · filtered" : "In stock", value: `${certShown.length} stone${certShown.length === 1 ? "" : "s"}`, icon: BadgeCheck },
              { label: "Carats", value: `${r2(certShown.reduce((t, p) => t + (p.carat || 0), 0))} ct`, icon: Gem },
              { label: "Value at cost", value: fmtMoneyInr(value), icon: Wallet, sub: unpriced ? `${unpriced} without a rate` : "Rate/ct × carats" },
            ]} />
          );
        })()}
        <DataTable
          id="stock-certified-in-stock"
          noun="packet"
          rows={certShown}
          filters={certFilters}
          onClearFilters={() => { setFShape(""); setFColor(""); setFClarity(""); setFLab(""); setFSize(""); }}
          columns={inStockColumns}
          rowKey={p => p.id}
          defaultSort={{ key: "bought", dir: "desc" }}
          searchText={packetSearch}
          searchPlaceholder="Search stock #, shape, or certificate…"
          exportName="Stock-Certified_Diamonds-In_Stock"
          totals={{ diamond: list => `${sumCarat(list)} ct` }}
          details={p => packetDetails(p, "stock")}
          rowActions={packetActions}
          emptyText="No certified diamonds in stock."
        />
      </div>

      {/* Full history — every certified diamond bought: supplier, rate & where it went */}
      <div className="card-luxe overflow-hidden">
        <SectionTitle className="px-5 pt-4" title="Purchase & Movement History" />

        {/* The date bought (in Filters) narrows the rows and the downloads. */}
        <div className="p-3 sm:p-4">
          <DataTable
            id="stock-certified-history"
            noun="packet"
            rows={histRows}
            filters={[{ kind: "date", label: "Bought", from: histFrom, to: histTo, onChange: (f, t) => { setHistFrom(f); setHistTo(t); } }]}
            onClearFilters={() => { setHistFrom(""); setHistTo(""); }}
            exports={[
              { label: "Full History — PDF", icon: FileText, hint: "For the dates in Filters", onSelect: () => exportCertPdf(histFromDate, histToDate) },
              { label: "Full History — Excel", icon: FileSpreadsheet, hint: "Grading, report no., cost, supplier", onSelect: () => exportCertCsv(histFromDate, histToDate) },
            ]}
            resetKey={JSON.stringify([histFrom, histTo])}
            columns={historyColumns}
            rowKey={p => p.id}
            defaultSort={{ key: "bought", dir: "desc" }}
            searchText={p => [packetSearch(p), STATUS_LABEL[p.status], orderNoOf(p.orderId)].filter(Boolean).join(" ")}
            searchPlaceholder="Search stock #, certificate, supplier…"
            details={p => packetDetails(p, "history")}
            rowActions={packetActions}
            totals={{
              diamond: list => `${sumCarat(list)} ct`,
              cost: list => fmtMoneyInr(list.reduce((s, p) => s + (p.ratePerCaratInr ? p.ratePerCaratInr * p.carat : 0), 0)),
            }}
            emptyText={allPackets.length === 0 ? "None bought yet." : "None in these dates."}
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
                <ListSelect list="diamondShapes" value={editPacket.shape} onChange={v => setEditPacket({ ...editPacket, shape: v || "Round" })} optional={false} className="rounded-xl mt-1" />
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
              {/* Its report — the same fields as when it was bought. */}
              <div className="col-span-2">
                <CertGradeFields idPrefix="edit-pk"
                  value={{ color: editPacket.color ?? "", clarity: editPacket.clarity ?? "", cut: editPacket.cut ?? "", polish: editPacket.polish ?? "",
                    symmetry: editPacket.symmetry ?? "", fluorescence: editPacket.fluorescence ?? "", measurement: editPacket.measurement ?? "",
                    lab: editPacket.certificateLab ?? "", certNo: editPacket.certificateNumber }}
                  onChange={p => setEditPacket({
                    ...editPacket,
                    ...(p.color !== undefined ? { color: p.color || undefined } : {}), ...(p.clarity !== undefined ? { clarity: p.clarity || undefined } : {}),
                    ...(p.cut !== undefined ? { cut: p.cut } : {}), ...(p.polish !== undefined ? { polish: p.polish } : {}),
                    ...(p.symmetry !== undefined ? { symmetry: p.symmetry } : {}), ...(p.fluorescence !== undefined ? { fluorescence: p.fluorescence } : {}),
                    ...(p.measurement !== undefined ? { measurement: p.measurement } : {}), ...(p.lab !== undefined ? { certificateLab: p.lab } : {}),
                    ...(p.certNo !== undefined ? { certificateNumber: p.certNo } : {}),
                  })} />
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
