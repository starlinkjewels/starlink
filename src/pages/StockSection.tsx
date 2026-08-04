import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fmtDate, updateDb, DIAMOND_SHAPES, nextDiamondStockNumber, type DiamondPacket } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { stockBucketHistory, deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { ExportDialog, inDateRange } from "@/components/ExportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Gem, Coins, BadgeCheck, ArrowDownCircle, ArrowUpCircle, Pencil, Trash2, Download } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 15;

export function StockSectionPage() {
  const { section } = useParams<{ section: string }>();
  if (section === "certified") return <CertifiedSection />;
  if (section === "gold" || section === "diamond") return <MaterialSection material={section} />;
  return (
    <div className="text-center py-20 text-muted-foreground">
      Unknown stock section. <Link to="/stock" className="text-primary underline">Back to Stock</Link>
    </div>
  );
}

/* ── Gold / Loose Diamonds — bucket tiles + full resolved movement history ── */

function MaterialSection({ material }: { material: "gold" | "diamond" }) {
  const navigate = useNavigate();
  const db = useDb();
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Balance derived from the FULL (unfiltered) movement ledger, so it always
  // reflects the true current total — the date filter below only narrows which
  // history rows are shown, same as Locker's ledger filter.
  const entries = Object.entries(deriveStockBalances(db.stockMovements, material)).filter(([, q]) => q !== 0);
  const unit = material === "gold" ? "g" : "ct";

  const rows = stockBucketHistory(db.stockMovements, material, selectedBucket, {
    purchases: db.purchases, issuances: db.materialIssuances, orders: db.orders, factories: db.factories, suppliers: db.suppliers,
    diamondSales: db.diamondSales, clients: db.clients,
  });

  // Running balance (of the selected bucket, or all buckets) after each movement —
  // computed oldest-first, shown against the newest-first table for a proper ledger.
  const balanceById = new Map<string, number>();
  {
    let bal = 0;
    for (const m of [...rows].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) {
      const sign = m.type === "purchase_in" ? 1 : m.type === "adjustment" ? Math.sign(m.quantity || 1) : -1;
      bal = Math.round((bal + sign * Math.abs(m.quantity)) * 1000) / 1000;
      balanceById.set(m.id, bal);
    }
  }

  const filterFromDate = filterFrom ? new Date(filterFrom + "T00:00:00") : null;
  const filterToDate = filterTo ? new Date(filterTo + "T23:59:59.999") : null;
  const filtersActive = !!filterFrom || !!filterTo;
  const filteredRows = rows.filter(m => inDateRange(m.createdAt, filterFromDate, filterToDate));

  const { paged, page, setPage, totalPages, start, end } = usePagination(filteredRows, PAGE_SIZE);

  const materialLabel = material === "gold" ? "Gold Reserve" : "Loose Diamonds";

  // For a purchase movement, resolve the effective INR rate (₹/unit) and this
  // movement's cost from the linked Purchase — so the history shows where it was
  // bought AND at what price, like the Certified section. Out-movements have none.
  const inrRateAmount = (m: (typeof rows)[number]): { rate: number; amount: number } | null => {
    if (m.type !== "purchase_in" || m.refType !== "purchase" || !m.refId) return null;
    const p = db.purchases.find(x => x.id === m.refId);
    if (!p) return null;
    const pQty = material === "gold" ? (p.gold?.weightGrams || 0) : (p.diamond?.carat || 0);
    const rate = pQty > 0 ? p.totalInr / pQty : 0;
    return { rate, amount: rate * m.quantity };
  };

  const particulars = (m: (typeof rows)[number]) =>
    m.link.orderId ? <Link to={`/orders/${m.link.orderId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : m.link.factoryId ? <Link to={`/factories/${m.link.factoryId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : m.link.supplierId ? <Link to={`/suppliers/${m.link.supplierId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : m.link.clientId ? <Link to={`/clients/${m.link.clientId}`} className="text-primary hover:underline">{m.link.label}</Link>
    : <span>{m.link.label}</span>;

  const exportCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      `Stock-${materialLabel.replace(/\s+/g, "_")}${selectedBucket ? `-${selectedBucket}` : ""}`,
      ["Date", "Particulars", `In (${unit})`, `Out (${unit})`, `Balance (${unit})`, "Rate (Rs)", "Amount (Rs)"],
      rows.filter(m => inDateRange(m.createdAt, from, to)).map(m => {
        const ra = inrRateAmount(m);
        return [
          fmtDate(m.createdAt), m.link.label,
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
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: entries.map(([key, qty]) => ({ label: key, value: `${qty.toLocaleString()} ${unit}` })),
      columns: [
        { header: "Date", x: 14 },
        { header: "Particulars", x: 38 },
        { header: "In", x: 108 },
        { header: "Out", x: 124 },
        { header: "Balance", x: 142 },
        { header: "Rate", x: 166 },
        { header: "Amount", x: 184 },
      ],
      align: ["left", "left", "right", "right", "right", "right", "right"],
      rows: filtered.map(m => {
        const ra = inrRateAmount(m);
        return [
          fmtDate(m.createdAt), m.link.label.slice(0, 30),
          m.type === "purchase_in" ? `${m.quantity}${unit}` : "—",
          m.type === "purchase_in" ? "—" : `${m.quantity}${unit}`,
          `${(balanceById.get(m.id) ?? 0).toLocaleString()}${unit}`,
          ra ? fmtMoneyInr(ra.rate) : "—",
          ra ? fmtMoneyInr(ra.amount) : "—",
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
        <div className={`h-12 w-12 rounded-2xl grid place-items-center shrink-0 ${material === "gold" ? "bg-amber-500/15" : "bg-cyan-500/15"}`}>
          {material === "gold" ? <Coins className="h-5 w-5 text-amber-600" /> : <Gem className="h-5 w-5 text-cyan-600" />}
        </div>
        <div>
          <h1 className="font-display text-2xl text-brand-dark leading-tight">{material === "gold" ? "Gold Reserve" : "Loose Diamonds"}</h1>
          <p className="text-sm text-muted-foreground">{material === "gold" ? "By purity" : "Pooled by shape"} · full movement history</p>
        </div>
      </div>

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
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
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
        {filteredRows.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted-foreground">
            {rows.length === 0 ? "No movements recorded." : "No movements match this date range."}
          </div>
        ) : (
          <>
            {/* Desktop table — where bought / where went, rate & amount */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Date</th>
                    <th className="px-5 py-2.5 font-semibold">Particulars</th>
                    <th className="px-5 py-2.5 font-semibold text-right whitespace-nowrap">In ({unit})</th>
                    <th className="px-5 py-2.5 font-semibold text-right whitespace-nowrap">Out ({unit})</th>
                    <th className="px-5 py-2.5 font-semibold text-right whitespace-nowrap">Balance</th>
                    <th className="px-5 py-2.5 font-semibold text-right whitespace-nowrap">Rate</th>
                    <th className="px-5 py-2.5 font-semibold text-right whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {paged.map(m => {
                    const ra = inrRateAmount(m);
                    const isIn = m.type === "purchase_in";
                    return (
                      <tr key={m.id} className="hover:bg-secondary/30">
                        <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</td>
                        <td className="px-5 py-2.5">{particulars(m)}{m.note ? <span className="text-xs text-muted-foreground"> · {m.note}</span> : null}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-success whitespace-nowrap">{isIn ? m.quantity.toLocaleString() : "—"}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-destructive whitespace-nowrap">{isIn ? "—" : m.quantity.toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-right font-medium text-brand-dark whitespace-nowrap">{(balanceById.get(m.id) ?? 0).toLocaleString()} {unit}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">{ra ? `${fmtMoneyInr(ra.rate)}/${unit}` : "—"}</td>
                        <td className="px-5 py-2.5 text-right font-medium whitespace-nowrap">{ra ? fmtMoneyInr(ra.amount) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border/40">
              {paged.map(m => {
                const ra = inrRateAmount(m);
                return (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${m.type === "purchase_in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                      {m.type === "purchase_in" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{particulars(m)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(m.createdAt)} · bal {(balanceById.get(m.id) ?? 0).toLocaleString()} {unit}{ra ? ` · ${fmtMoneyInr(ra.rate)}/${unit}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${m.type === "purchase_in" ? "text-success" : "text-destructive"}`}>{m.type === "purchase_in" ? "+" : "−"}{m.quantity} {unit}</p>
                      {ra && <p className="text-[11px] text-muted-foreground">{fmtMoneyInr(ra.amount)}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {totalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={`Showing ${start + 1}–${end} of ${filteredRows.length}`} />
          </div>
        )}
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
  const [search, setSearch] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [showExport, setShowExport] = useState(false);

  const allInStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock");

  // ── Full certified-diamond history — every packet ever bought: from which
  // supplier, at what rate, and where it went (still in stock / issued / used
  // in an order / sold). This is what "where to buy / which supplier" needs. ──
  const supplierName = (id?: string) => (id ? db.suppliers.find(s => s.id === id)?.name : undefined);
  const purchaseOf = (id?: string) => (id ? db.purchases.find(p => p.id === id) : undefined);
  const orderNoOf = (id?: string) => (id ? db.orders.find(o => o.id === id)?.orderNumber : undefined);
  const boughtDate = (p: DiamondPacket) => purchaseOf(p.purchaseId)?.invoiceDate || purchaseOf(p.purchaseId)?.createdAt || p.createdAt;
  const STATUS_LABEL: Record<DiamondPacket["status"], string> = { in_stock: "In stock", issued: "Issued", used: "Used in order", sold: "Sold" };
  const STATUS_CLASS: Record<DiamondPacket["status"], string> = {
    in_stock: "bg-success/10 text-success", issued: "bg-blue-500/10 text-blue-700",
    used: "bg-secondary text-muted-foreground", sold: "bg-violet-500/10 text-violet-700",
  };

  const allPackets = [...(db.diamondPackets ?? [])].sort((a, b) => +new Date(boughtDate(b)) - +new Date(boughtDate(a)));
  const histFromDate = histFrom ? new Date(histFrom + "T00:00:00") : null;
  const histToDate = histTo ? new Date(histTo + "T23:59:59.999") : null;
  const histActive = !!histFrom || !!histTo;
  const histRows = allPackets.filter(p => inDateRange(boughtDate(p), histFromDate, histToDate));

  const exportCertCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      "Stock-Certified_Diamonds-History",
      ["Bought", "Stock #", "Shape", "Carat", "Certificate", "Lab", "Supplier", "Rate/ct (INR)", "Cost (INR)", "Status", "Order"],
      allPackets.filter(p => inDateRange(boughtDate(p), from, to)).map(p => [
        fmtDate(boughtDate(p)), p.stockNumber ?? "", p.shape, p.carat, p.certificateNumber, p.certificateLab ?? "",
        supplierName(p.supplierId) ?? "", p.ratePerCaratInr ?? "",
        p.ratePerCaratInr ? Math.round(p.ratePerCaratInr * p.carat) : "", STATUS_LABEL[p.status], orderNoOf(p.orderId) ?? "",
      ]),
    );
  };
  const exportCertPdf = (from: Date | null, to: Date | null) => {
    const filtered = allPackets.filter(p => inDateRange(boughtDate(p), from, to));
    downloadLedgerPdf({
      title: "Certified Diamonds — Full History",
      subjectLines: [
        `${filtered.length} packet${filtered.length !== 1 ? "s" : ""}${from || to ? " (filtered)" : " (all time)"}`,
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "In stock", value: String(filtered.filter(p => p.status === "in_stock").length) },
        { label: "Issued / used", value: String(filtered.filter(p => p.status === "issued" || p.status === "used").length) },
        { label: "Sold", value: String(filtered.filter(p => p.status === "sold").length) },
      ],
      columns: [
        { header: "Bought", x: 14 }, { header: "Shape/ct", x: 40 }, { header: "Cert", x: 74 },
        { header: "Supplier", x: 104 }, { header: "Rate/ct", x: 150 }, { header: "Status", x: 174 },
      ],
      rows: filtered.map(p => [
        fmtDate(boughtDate(p)), `${p.shape} ${p.carat}ct`, String(p.certificateNumber).slice(0, 14),
        (supplierName(p.supplierId) ?? "—").slice(0, 22),
        p.ratePerCaratInr ? fmtMoneyInr(p.ratePerCaratInr) : "—",
        STATUS_LABEL[p.status] + (p.orderId ? ` (${orderNoOf(p.orderId) ?? ""})` : ""),
      ]),
      filename: "Stock-Certified_Diamonds-History",
    });
  };
  const inStockPackets = allInStockPackets.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.stockNumber, p.shape, p.certificateNumber].some(v => v?.toLowerCase().includes(q));
  });
  const unnumberedCount = (db.diamondPackets ?? []).filter(p => !p.stockNumber).length;

  const assignMissingStockNumbers = () => {
    updateDb(d => {
      for (const p of d.diamondPackets ?? []) {
        if (!p.stockNumber) p.stockNumber = nextDiamondStockNumber(d);
      }
    });
    toast.success("Stock numbers assigned");
  };

  const savePacketEdit = () => {
    if (!editPacket) return;
    const p = editPacket;
    if (!p.shape) { toast.error("Choose a shape"); return; }
    if (!p.carat || p.carat <= 0) { toast.error("Enter a valid carat weight"); return; }
    if (!p.certificateNumber.trim()) { toast.error("Report number is required"); return; }
    updateDb(d => {
      const idx = (d.diamondPackets ?? []).findIndex(x => x.id === p.id);
      if (idx >= 0) {
        const clean = <T,>(v: T) => (typeof v === "string" && v.trim() === "" ? undefined : v);
        d.diamondPackets[idx] = {
          ...d.diamondPackets[idx],
          shape: p.shape,
          carat: p.carat,
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
    toast.success("Certificate details updated");
    setEditPacket(null);
  };

  const deletePacket = (p: DiamondPacket) => {
    if (p.status !== "in_stock") {
      toast.error("This packet is already issued or used — cancel it from the order instead.");
      return;
    }
    if (!confirm(`Delete this ${p.shape} ${p.carat}ct packet (Report ${p.certificateNumber})? This can't be undone.`)) return;
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
      </div>

      {user?.role === "admin" && unnumberedCount > 0 && (
        <div className="card-luxe p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>{unnumberedCount} diamond{unnumberedCount !== 1 ? "s" : ""} {unnumberedCount !== 1 ? "don't" : "doesn't"} have a stock number yet (from before this feature existed).</span>
          <Button size="sm" onClick={assignMissingStockNumbers} className="btn-hero rounded-xl shrink-0">Assign stock numbers</Button>
        </div>
      )}

      {allInStockPackets.length > 3 && (
        <Input value={search} onChange={e => setSearch(e.target.value)} className="rounded-xl h-10" placeholder="Search stock #, shape, or certificate…" />
      )}

      <div className="card-luxe p-5">
        {allInStockPackets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No certified diamonds in stock.</p>
        ) : inStockPackets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches for "{search}".</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {inStockPackets.map(p => {
              const grade = [p.color, p.clarity, [p.cut, p.polish, p.symmetry].filter(Boolean).join("/"), p.fluorescence]
                .filter(Boolean).join(" · ");
              return (
                <div key={p.id} className="p-3 rounded-xl bg-secondary border border-border/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {p.stockNumber && <span className="font-mono text-xs font-semibold text-primary mr-1.5">{p.stockNumber}</span>}
                      {p.shape}
                    </span>
                    <span className="text-sm font-semibold text-cyan-700">{p.carat} ct</span>
                  </div>
                  {grade && <p className="text-xs text-foreground/70 mt-0.5 truncate">{grade}</p>}
                  {p.measurement && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.measurement}</p>}
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">Report {p.certificateNumber}{p.certificateLab ? ` · ${p.certificateLab}` : ""}</p>
                  {(() => {
                    const sup = p.supplierId ? db.suppliers.find(s => s.id === p.supplierId) : undefined;
                    const pur = p.purchaseId ? db.purchases.find(x => x.id === p.purchaseId) : undefined;
                    const bought = pur?.invoiceDate || pur?.createdAt || p.createdAt;
                    return (
                      <p className="text-[11px] mt-1 pt-1 border-t border-border/30 truncate">
                        {sup
                          ? <Link to={`/suppliers/${sup.id}`} className="text-primary hover:underline font-medium">{sup.name}</Link>
                          : <span className="text-muted-foreground">Supplier —</span>}
                        <span className="text-muted-foreground">
                          {p.ratePerCaratInr ? ` · ${fmtMoneyInr(p.ratePerCaratInr)}/ct` : ""}
                          {bought ? ` · ${fmtDate(bought)}` : ""}
                        </span>
                      </p>
                    );
                  })()}
                  {user?.role === "admin" && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                      <button onClick={() => setEditPacket({ ...p })} className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button onClick={() => deletePacket(p)} className="text-[11px] text-destructive inline-flex items-center gap-1 hover:underline">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full history — every certified diamond bought: supplier, rate & where it went */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-brand-dark">Purchase &amp; Movement History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{histRows.length} packet{histRows.length !== 1 ? "s" : ""} · bought from which supplier &amp; where each went</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
          <ExportDialog open={showExport} onClose={() => setShowExport(false)} title="Certified Diamonds — History" options={[
            { label: "Full History — PDF", sublabel: "Filterable by date range", kind: "pdf", run: exportCertPdf },
            { label: "Full History — Excel", sublabel: "Supplier, rate, cost, status, order", kind: "excel", run: exportCertCsv },
          ]} />
        </div>
        <div className="px-5 py-3 border-b border-border/60 bg-secondary/20 flex items-center gap-2 flex-wrap">
          <Input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
          {histActive && <button onClick={() => { setHistFrom(""); setHistTo(""); }} className="text-xs text-primary hover:underline">Reset</button>}
        </div>

        {histRows.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted-foreground">{allPackets.length === 0 ? "No certified diamonds purchased yet." : "None match this date range."}</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    {["Bought", "Stock #", "Diamond", "Certificate", "Supplier", "Rate/ct", "Cost", "Status / Order"].map(h => <th key={h} className="px-5 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {histRows.map(p => (
                    <tr key={p.id} className="hover:bg-secondary/30">
                      <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(boughtDate(p))}</td>
                      <td className="px-5 py-2.5 font-mono text-xs text-primary whitespace-nowrap">{p.stockNumber ?? "—"}</td>
                      <td className="px-5 py-2.5 whitespace-nowrap">{p.shape} · <span className="font-semibold text-cyan-700">{p.carat} ct</span></td>
                      <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{p.certificateNumber}{p.certificateLab ? ` · ${p.certificateLab}` : ""}</td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        {p.supplierId ? <Link to={`/suppliers/${p.supplierId}`} className="text-primary hover:underline">{supplierName(p.supplierId)}</Link> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">{p.ratePerCaratInr ? fmtMoneyInr(p.ratePerCaratInr) : "—"}</td>
                      <td className="px-5 py-2.5 font-medium whitespace-nowrap">{p.ratePerCaratInr ? fmtMoneyInr(p.ratePerCaratInr * p.carat) : "—"}</td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                        {p.orderId && <Link to={`/orders/${p.orderId}`} className="ml-1.5 text-xs text-primary hover:underline">{orderNoOf(p.orderId)}</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border/40">
              {histRows.map(p => (
                <div key={p.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{p.stockNumber && <span className="font-mono text-xs text-primary mr-1.5">{p.stockNumber}</span>}{p.shape} · {p.carat} ct</span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Report {p.certificateNumber}{p.certificateLab ? ` · ${p.certificateLab}` : ""}</p>
                  <div className="flex items-center justify-between gap-2 mt-1 text-xs">
                    <span>
                      {p.supplierId ? <Link to={`/suppliers/${p.supplierId}`} className="text-primary hover:underline font-medium">{supplierName(p.supplierId)}</Link> : <span className="text-muted-foreground">Supplier —</span>}
                      <span className="text-muted-foreground"> · {fmtDate(boughtDate(p))}</span>
                    </span>
                    {p.ratePerCaratInr && <span className="font-medium shrink-0">{fmtMoneyInr(p.ratePerCaratInr * p.carat)}</span>}
                  </div>
                  {p.orderId && <p className="text-[11px] mt-0.5">→ <Link to={`/orders/${p.orderId}`} className="text-primary hover:underline">Order {orderNoOf(p.orderId)}</Link></p>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Edit certified packet (admin) — fix a mistyped certificate/grade */}
      {editPacket && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditPacket(null)}>
          <div className="card-luxe w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-lg text-brand-dark mb-1">Edit Certified Diamond</h3>
            <p className="text-xs text-muted-foreground mb-4">Correct the certificate or grading details for this packet.</p>
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
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditPacket(null)} className="flex-1 rounded-xl border border-border py-2 text-sm">Cancel</button>
              <button onClick={savePacketEdit} className="btn-hero flex-1 rounded-xl py-2 text-sm">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
