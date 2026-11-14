// Stock → ⋯ Price list: what is in stock to sell (loose lots, certified stones) and what we ask
// for it (lib/priceList.ts). An admin sets the prices and the markup; the list goes to a buyer
// as a PDF or on WhatsApp — prices only, never the cost.
import { useState } from "react";
import { toast } from "sonner";
import { FileText, MessageCircle, Pencil, Tags } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useHas } from "@/hooks/useCan";
import { useAuth } from "@/lib/auth";
import { fmtCcy } from "@/lib/currency";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { downloadPriceListPdf, priceListText, priceRows, setMarkup, setPrice, type PriceRow } from "@/lib/priceList";
import { openWhatsApp } from "@/lib/whatsapp";
import { ActionSheet } from "@/components/ActionSheet";
import { DataTable, type DataColumn } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PriceListSheet({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const showCosts = useHas()("fig.costs");
  const rows = priceRows(db, companyId);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [rate, setRate] = useState("");
  const [ccy, setCcy] = useState<"INR" | "USD">("USD");
  const [mk, setMk] = useState(db.settings.priceListMarkupPct ? String(db.settings.priceListMarkupPct) : "");
  const priced = rows.filter(r => r.price).length;

  const openEdit = (r: PriceRow) => {
    setEditing(r);
    setRate(r.price ? String(r.price.rate) : r.suggestInr != null ? String(r.suggestInr) : "");
    setCcy(r.price?.currency ?? (r.suggestInr != null ? "INR" : "USD"));
  };
  const saveEdit = (clear = false) => {
    if (!editing) return;
    try { setPrice(editing.kind, editing.ref, clear || rate.trim() === "" ? null : Number(rate), ccy); toast.success(clear ? "Price taken off" : `Price set — ${editing.name}`); setEditing(null); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
  };
  const saveMk = () => {
    try { setMarkup(mk.trim() === "" ? null : Number(mk)); toast.success(mk.trim() ? `Suggested prices: cost + ${mk}%` : "No suggested prices"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
  };

  const columns: DataColumn<PriceRow>[] = [
    { key: "item", header: "Item", always: true, sortValue: r => r.name, cell: r => <span className="font-medium text-brand-dark">{r.name}</span> },
    { key: "detail", header: "Details", sortValue: r => r.detail, cell: r => <span className="text-muted-foreground">{r.detail}</span> },
    { key: "ct", header: "Carat", align: "right", kind: "number", sortValue: r => r.ct, cell: r => <span className="tabular-nums">{r.ct}{r.pcs ? <span className="text-muted-foreground"> · {r.pcs} pcs</span> : null}</span> },
    { key: "price", header: "Price / ct", align: "right", kind: "number", sortValue: r => r.price?.rate ?? -1,
      cell: r => (r.price ? <span className="tabular-nums font-semibold">{fmtCcy(r.price.rate, r.price.currency)}</span>
        : r.suggestInr != null ? <span className="tabular-nums text-muted-foreground" title="Cost + markup — not set yet">≈ {fmtMoneyInr(r.suggestInr)}</span>
          : <span className="text-muted-foreground">—</span>) },
    ...(showCosts ? [{ key: "cost", header: "Cost / ct", align: "right" as const, kind: "number" as const, sortValue: (r: PriceRow) => r.costInr ?? -1,
      cell: (r: PriceRow) => (r.costInr != null ? <span className="tabular-nums text-muted-foreground">{fmtMoneyInr(r.costInr)}</span> : <span className="text-muted-foreground">—</span>) }] : []),
  ];

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="xl" icon={Tags} title="Price list"
      description="What is in stock to sell, and what we ask for it — loose lots and certified stones. Sent to a buyer, it shows the price only, never the cost."
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!priced} onClick={() => downloadPriceListPdf(db, rows, companyId)} className="rounded-xl h-10 gap-1.5"><FileText className="h-4 w-4" /> PDF</Button>
        <Button disabled={!priced} onClick={() => openWhatsApp(undefined, priceListText(db, rows, companyId))} className="btn-hero rounded-xl h-10 gap-1.5"><MessageCircle className="h-4 w-4" /> Send on WhatsApp</Button>
      </div>}>
      <div className="space-y-3">
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 p-3">
            <div>
              <p className="text-xs font-medium mb-1">Suggested price = cost + markup</p>
              <Input type="number" inputMode="decimal" min={0} step="0.5" value={mk} onChange={e => setMk(e.target.value)} className="rounded-xl h-9 w-28" aria-label="Markup %" placeholder="%" />
            </div>
            <Button variant="outline" onClick={saveMk} className="rounded-xl h-9">Save markup</Button>
            <p className="text-[11px] text-muted-foreground flex-1 min-w-[12rem]">{priced} of {rows.length} priced. Unpriced lines show the suggestion (≈) — it is never sent.</p>
          </div>
        )}
        <DataTable id="price-list" noun="item" rows={rows} columns={columns} rowKey={r => `${r.kind}:${r.ref}`} details={false}
          defaultSort={{ key: "item", dir: "asc" }} searchText={r => `${r.name} ${r.detail}`} searchPlaceholder="Search lot, stone or report"
          rowActions={isAdmin ? (r => [{ label: r.price ? "Change price" : "Set price", icon: Pencil, onSelect: () => openEdit(r) }]) : undefined}
          onRowClick={isAdmin ? openEdit : undefined} emptyText="Nothing in stock to sell." exportName="Price-list" />
        {editing && (
          <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3 space-y-2">
            <p className="text-sm font-medium">{editing.name} <span className="text-muted-foreground font-normal">· {editing.detail}{showCosts && editing.costInr != null ? ` · cost ${fmtMoneyInr(editing.costInr)}/ct` : ""}</span></p>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className="rounded-xl h-9 w-36" aria-label="Price per carat" />
              <Select value={ccy} onValueChange={v => setCcy(v as "INR" | "USD")}>
                <SelectTrigger className="h-9 rounded-xl w-24" aria-label="Currency"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">$ / ct</SelectItem><SelectItem value="INR">₹ / ct</SelectItem></SelectContent>
              </Select>
              <Button onClick={() => saveEdit()} className="btn-hero rounded-xl h-9 px-5">Save</Button>
              {editing.price && <Button variant="outline" onClick={() => saveEdit(true)} className="rounded-xl h-9">Take off</Button>}
              <Button variant="ghost" onClick={() => setEditing(null)} className="rounded-xl h-9">Cancel</Button>
            </div>
            {editing.kind === "packet" && Number(rate) > 0 && <p className="text-xs text-muted-foreground">The stone: {fmtCcy(Math.round(Number(rate) * editing.ct * 100) / 100, ccy)}</p>}
          </div>
        )}
      </div>
    </ActionSheet>
  );
}
