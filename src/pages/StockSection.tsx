import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fmtDate, updateDb, DIAMOND_SHAPES, nextDiamondStockNumber, type DiamondPacket } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { stockBucketHistory, deriveStockBalances } from "@/lib/manufacturing";
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

  // Balance derived from the movement ledger, so it always matches the history below.
  const entries = Object.entries(deriveStockBalances(db.stockMovements, material)).filter(([, q]) => q !== 0);
  const unit = material === "gold" ? "g" : "ct";

  const rows = stockBucketHistory(db.stockMovements, material, selectedBucket, {
    purchases: db.purchases, issuances: db.materialIssuances, orders: db.orders, factories: db.factories, suppliers: db.suppliers,
  });
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE_SIZE);

  const materialLabel = material === "gold" ? "Gold Reserve" : "Loose Diamonds";

  const exportCsv = (from: Date | null, to: Date | null) => {
    downloadCsv(
      `Stock-${materialLabel.replace(/\s+/g, "_")}${selectedBucket ? `-${selectedBucket}` : ""}`,
      ["Date", "Particulars", `In (${unit})`, `Out (${unit})`],
      rows.filter(m => inDateRange(m.createdAt, from, to)).map(m => [
        fmtDate(m.createdAt), m.link.label,
        m.type === "purchase_in" ? m.quantity : "",
        m.type === "purchase_in" ? "" : m.quantity,
      ]),
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
        { header: "Date", x: 20 },
        { header: "Particulars", x: 50 },
        { header: "In", x: 150 },
        { header: "Out", x: 170 },
      ],
      rows: filtered.map(m => [
        fmtDate(m.createdAt), m.link.label.slice(0, 40),
        m.type === "purchase_in" ? `${m.quantity}${unit}` : "—",
        m.type === "purchase_in" ? "—" : `${m.quantity}${unit}`,
      ]),
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
            <p className="text-xs text-muted-foreground mt-0.5">{rows.length} movement{rows.length !== 1 ? "s" : ""}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
          <ExportDialog open={showExport} onClose={() => setShowExport(false)} title={`${materialLabel}${selectedBucket ? ` — ${selectedBucket}` : ""}`} options={[
            { label: "Movement History — PDF", sublabel: "Filterable by date range", kind: "pdf", run: exportPdf },
            { label: "Movement History — Excel", sublabel: "Filterable by date range", kind: "excel", run: exportCsv },
          ]} />
        </div>
        <div className="divide-y divide-border/40">
          {paged.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${m.type === "purchase_in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {m.type === "purchase_in" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {m.link.orderId ? (
                    <Link to={`/orders/${m.link.orderId}`} className="hover:underline">{m.link.label}</Link>
                  ) : m.link.factoryId ? (
                    <Link to={`/factories/${m.link.factoryId}`} className="hover:underline">{m.link.label}</Link>
                  ) : m.link.supplierId ? (
                    <Link to={`/suppliers/${m.link.supplierId}`} className="hover:underline">{m.link.label}</Link>
                  ) : (
                    m.link.label
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{fmtDate(m.createdAt)}{m.note ? ` · ${m.note}` : ""}</p>
              </div>
              <p className={`text-sm font-semibold shrink-0 ${m.type === "purchase_in" ? "text-success" : "text-destructive"}`}>
                {m.type === "purchase_in" ? "+" : "−"}{m.quantity} {unit}
              </p>
            </div>
          ))}
          {rows.length === 0 && <div className="px-5 py-12 text-center text-muted-foreground">No movements recorded.</div>}
        </div>
        {totalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={`Showing ${start + 1}–${end} of ${rows.length}`} />
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

  const allInStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock");
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
