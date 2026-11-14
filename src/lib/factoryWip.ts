// What is at a factory right now — orders it is making that are not back yet (Final Approval not
// done) — and the job card printed for one: what to make, with the pictures, the stones and the
// material given, never the client's name or a price.
import JsBarcode from "jsbarcode";
import { showPrintPage } from "./printView";
import { fmtDate, orderImage, type DB, type MaterialIssuance, type Order } from "./db";
import { currentStageIndex, stageLabel } from "./stages";
import { pieceLine } from "./orderText";

const DAY = 86_400_000;

export interface AtFactory {
  order: Order;
  /** The stage it is at now (its label). */
  stage: string;
  /** Since when the factory has it: the first issue to it for this order, else when the order was placed. */
  since: string;
  days: number;
  /** Past its delivery date by this many days (0 = not late). */
  late: number;
  /** What was given for it and is still open there: "12.5 g gold · 0.42 ct diamond". */
  material: string;
  issues: MaterialIssuance[];
}

const finalDone = (o: Order) => {
  const fa = o.timeline.findIndex(t => t.step === "Final Approval");
  if (fa >= 0) return o.timeline[fa].status === "done";
  return ["Ready", "Dispatched", "Delivered"].includes(o.status);
};

/** The orders a factory is making now, longest there first. */
export function atFactoryNow(db: Pick<DB, "orders" | "materialIssuances" | "settings">, factoryId: string, now = Date.now()): AtFactory[] {
  const issuesBy = new Map<string, MaterialIssuance[]>();
  for (const i of db.materialIssuances ?? []) {
    if (i.factoryId !== factoryId || !i.orderId) continue;
    issuesBy.set(i.orderId, [...(issuesBy.get(i.orderId) ?? []), i]);
  }
  const out: AtFactory[] = [];
  for (const o of db.orders) {
    if (o.deletedAt || o.status === "Rejected" || o.melted || o.materialSourcing === "readyStock") continue;
    const issues = issuesBy.get(o.id) ?? [];
    if (o.assignedFactoryId !== factoryId && !issues.some(i => i.status === "open")) continue;
    if (finalDone(o)) continue;
    const since = issues.map(i => i.issuedAt).sort()[0] ?? o.createdAt;
    const idx = currentStageIndex(o);
    const stage = idx < o.timeline.length ? stageLabel(o.timeline[idx].step, db.settings) : o.status;
    const dueEnd = o.expectedDelivery ? +new Date(`${o.expectedDelivery.slice(0, 10)}T23:59:59`) : 0;
    const open = issues.filter(i => i.status === "open");
    const sum = (m: string) => open.filter(i => i.material === m).reduce((t, i) => t + (i.quantityIssued || 0), 0);
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const material = [sum("gold") ? `${r3(sum("gold"))} g gold` : "", sum("diamond") ? `${r3(sum("diamond"))} ct diamond` : "",
      open.some(i => i.material !== "gold" && i.material !== "diamond") ? "other material" : ""].filter(Boolean).join(" · ");
    out.push({
      order: o, stage, since, issues,
      days: Math.max(0, Math.floor((now - +new Date(since)) / DAY)),
      late: dueEnd && now > dueEnd ? Math.ceil((now - dueEnd) / DAY) : 0,
      material,
    });
  }
  return out.sort((a, b) => b.days - a.days);
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function barcode(value: string): string {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 48, background: "#ffffff", lineColor: "#000000" });
    return canvas.toDataURL("image/png");
  } catch { return ""; }
}

/**
 * The job card for an order at a factory, shown over the app with Print (lib/printView.ts).
 * What the factory needs to make it — never the client or any price.
 */
export function printJobCard(db: Pick<DB, "orders" | "materialIssuances" | "factories" | "settings">, order: Order, factoryId?: string): void {
  const factory = db.factories.find(f => f.id === (factoryId ?? order.assignedFactoryId));
  const issues = (db.materialIssuances ?? []).filter(i => i.orderId === order.id && (!factory || i.factoryId === factory.id));
  const pics = [order.cadImage, ...(order.images ?? [])].filter((s): s is string => !!s).slice(0, 3);
  if (!pics.length) { const img = orderImage(order); if (img) pics.push(img); }
  const rows: [string, string][] = [
    ["Item", pieceLine(order)],
    ["Quantity", String(order.quantity || 1)],
    ...(order.estimatedGrossWeight ? [["Gross (est.)", `${order.estimatedGrossWeight} g`] as [string, string]] : []),
    ...(order.estimatedNetWeight ? [["Net (est.)", `${order.estimatedNetWeight} g`] as [string, string]] : []),
    ...(order.diamondWeight ? [["Diamonds (est.)", `${order.diamondWeight} ct${order.diamondShape ? ` · ${order.diamondShape}` : ""}${order.diamondType ? ` · ${order.diamondType}` : ""}`] as [string, string]] : []),
    ...(order.engraving?.text ? [["Engraving", `${order.engraving.text} (${order.engraving.font})`] as [string, string]] : []),
    ["Due", order.expectedDelivery ? fmtDate(order.expectedDelivery) : "—"],
  ];
  const given = issues.map(i => {
    const what = i.material === "gold" ? `Gold ${i.purityOrQuality ?? ""}` : i.material === "diamond" ? `Diamond ${i.purityOrQuality ?? ""}` : `${i.material} ${i.purityOrQuality ?? ""}`;
    const unit = i.material === "gold" ? "g" : i.material === "diamond" ? "ct" : "";
    return `<tr><td>${esc(fmtDate(i.issuedAt))}</td><td>${esc(what.trim())}</td><td class="r">${esc(`${i.quantityIssued}${unit ? ` ${unit}` : ""}${i.piecesIssued ? ` · ${i.piecesIssued} pcs` : ""}`)}</td><td>${i.status === "open" ? "Open" : "Closed"}</td></tr>`;
  }).join("");
  const steps = order.timeline.map(t => `<td class="${t.status === "done" ? "done" : ""}">${esc(stageLabel(t.step, db.settings))}</td>`).join("");
  const code = barcode(order.orderNumber);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Job card ${esc(order.orderNumber)}</title><style>
    @page { margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 10.5pt; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 0.4mm solid #111; padding-bottom: 3mm; }
    .no { font-size: 20pt; font-weight: 700; letter-spacing: 0.5pt; }
    .sub { color: #444; margin-top: 1mm; }
    .bc img { height: 14mm; }
    .grid { display: flex; gap: 6mm; margin-top: 4mm; }
    .pics { display: flex; flex-direction: column; gap: 3mm; width: 62mm; }
    .pics img { width: 62mm; max-height: 62mm; object-fit: contain; border: 0.3mm solid #ccc; border-radius: 2mm; }
    table { border-collapse: collapse; width: 100%; }
    .spec td { padding: 1.4mm 2mm; border-bottom: 0.2mm solid #ddd; vertical-align: top; }
    .spec td:first-child { color: #555; width: 32mm; }
    h3 { font-size: 10.5pt; margin: 5mm 0 1.5mm; text-transform: uppercase; letter-spacing: 0.6pt; color: #333; }
    .given td, .given th { border: 0.2mm solid #ccc; padding: 1.2mm 2mm; font-size: 9.5pt; text-align: left; }
    .r { text-align: right !important; }
    .steps td { border: 0.2mm solid #999; padding: 2mm; font-size: 8.5pt; text-align: center; height: 12mm; vertical-align: top; }
    .steps td.done { background: #eee; }
    .note { white-space: pre-line; border: 0.2mm solid #ccc; border-radius: 1.5mm; padding: 2mm; min-height: 14mm; }
  </style></head><body>
    <div class="top">
      <div><div class="no">${esc(order.orderNumber)}</div><div class="sub">Job card${factory ? ` · ${esc(factory.name)}` : ""} · printed ${esc(fmtDate(new Date().toISOString()))}</div></div>
      ${code ? `<div class="bc"><img src="${code}" alt="${esc(order.orderNumber)}"></div>` : ""}
    </div>
    <div class="grid">
      ${pics.length ? `<div class="pics">${pics.map(p => `<img src="${esc(p)}">`).join("")}</div>` : ""}
      <div style="flex:1;min-width:0">
        <table class="spec">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>
        <h3>Instructions</h3><div class="note">${esc(order.instructions || "—")}</div>
        ${given ? `<h3>Material given</h3><table class="given"><tr><th>Date</th><th>What</th><th class="r">Qty</th><th>Status</th></tr>${given}</table>` : ""}
      </div>
    </div>
    <h3>Stages — tick as done</h3>
    <table class="steps"><tr>${steps}</tr></table>
  </body></html>`;
  showPrintPage(html, { title: `Job card ${order.orderNumber}` });
}
