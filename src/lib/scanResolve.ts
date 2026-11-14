// What a scanned (or typed) code is — a tag, a bag, a stone, an order, a memo, a PO, a bill —
// and where it is, with the next things to do with it (components/ScanModal). Read-only.
// A code several records share (a design number on many lots) gives each, to pick from.
import type { DB } from "./db";
import { lotLabel } from "./diamondLots";
import { keptForOrder } from "./orderStock";

export interface ScanAction { label: string; to: string }
export interface ScanHit { kind: "order" | "piece" | "bag" | "stone" | "memo" | "po" | "bill"; id: string; title: string; sub?: string; actions: ScanAction[] }

const norm = (s: string) => s.trim().toLowerCase().replace(/^id\s+/, "");

export function resolveCode(db: Partial<Pick<DB, "orders" | "readyStock" | "diamondBags" | "diamondPackets" | "memos" | "purchaseOrders" | "purchases" | "suppliers">>, raw: string): ScanHit[] {
  const t = norm(raw);
  if (!t) return [];
  const out: ScanHit[] = [];
  for (const o of db.orders ?? []) if (!o.deletedAt && o.orderNumber.toLowerCase() === t)
    out.push({ kind: "order", id: o.id, title: o.orderNumber, sub: `${o.jewelleryType} · ${o.status}`, actions: [{ label: "Open the order", to: `/orders/${o.id}` }] });
  // A Ready Stock lot: its tag number, its SKU (many lots may share it), its id, or the end of its id as its card shows it.
  for (const i of db.readyStock ?? []) {
    const hit = (i.tagNo && i.tagNo.toLowerCase() === t) || (i.sku && i.sku.toLowerCase() === t) || i.id.toLowerCase() === t
      || (t.length === 6 && i.id.slice(-6).toLowerCase() === t);
    if (!hit) continue;
    out.push({ kind: "piece", id: i.id, title: i.name, sub: [i.tagNo, i.sku ? `#${i.sku}` : "", `${i.quantity} in stock`, i.location].filter(Boolean).join(" · "),
      actions: [{ label: "Open the piece", to: `/ready-stock/${i.id}` },
        ...(i.quantity > 0 ? [{ label: "Sell it", to: `/orders/new?readyStock=${encodeURIComponent(i.id)}` }] : [])] });
  }
  for (const b of db.diamondBags ?? []) if (b.no.toLowerCase() === t)
    out.push({ kind: "bag", id: b.id, title: b.no, sub: lotLabel(b.key), actions: [
      { label: "Open the bag", to: `/stock/diamond?q=${encodeURIComponent(b.no)}&open=bag` },
      { label: "Sell from it", to: `/buy-assign?sell=lot&lot=${encodeURIComponent(b.key)}` },
      { label: "Send on memo", to: `/memo?out=lot&lot=${encodeURIComponent(b.key)}` }] });
  for (const p of db.diamondPackets ?? []) {
    if (!((p.stockNumber && p.stockNumber.toLowerCase() === t) || (p.certificateNumber && p.certificateNumber.toLowerCase() === t))) continue;
    const q = encodeURIComponent(p.stockNumber || p.certificateNumber || "");
    const free = p.status === "in_stock" && !keptForOrder(p);
    out.push({ kind: "stone", id: p.id, title: `${p.stockNumber ? `${p.stockNumber} · ` : ""}${p.shape} ${p.carat}ct`,
      sub: [p.certificateLab, p.certificateNumber, p.status === "in_stock" ? (keptForOrder(p) ? "kept for an order" : "in stock") : p.status].filter(Boolean).join(" · "),
      actions: [{ label: "Open the stone", to: `/stock/certified?q=${q}` }, ...(free ? [
        { label: "Sell it", to: `/buy-assign?sell=packet&id=${encodeURIComponent(p.id)}` },
        { label: "Send on memo", to: `/memo?out=packet&id=${encodeURIComponent(p.id)}` }] : [])] });
  }
  for (const m of db.memos ?? []) if (m.no.toLowerCase() === t)
    out.push({ kind: "memo", id: m.id, title: `Memo ${m.no}`, sub: m.dir === "in" ? "In — theirs with us" : "Out — ours with them", actions: [{ label: "Open Memo", to: "/memo" }] });
  for (const po of db.purchaseOrders ?? []) if (po.no.toLowerCase() === t)
    out.push({ kind: "po", id: po.id, title: `Purchase order ${po.no}`, sub: db.suppliers?.find(s => s.id === po.supplierId)?.name, actions: [{ label: "Open the supplier", to: `/suppliers/${po.supplierId}` }] });
  const bills = new Set<string>();
  for (const p of db.purchases ?? []) {
    if (!p.invoiceNumber || p.invoiceNumber.toLowerCase() !== t || bills.has(p.supplierId)) continue;
    bills.add(p.supplierId);
    out.push({ kind: "bill", id: p.id, title: `Bill ${p.invoiceNumber}`, sub: db.suppliers?.find(s => s.id === p.supplierId)?.name, actions: [{ label: "Open the supplier", to: `/suppliers/${p.supplierId}` }] });
  }
  return out;
}
