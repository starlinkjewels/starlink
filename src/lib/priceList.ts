// The selling price list — what we ask for a loose lot (per carat) and a certified stone (per
// carat), in ₹ or $. Set by an admin (Stock → Price list); a suggestion where none is set:
// the average cost + the markup % in Settings. Sell a diamond starts from it. Sent to a buyer
// as a PDF or on WhatsApp — the price only, never the cost.
import type { DB, DiamondPacket, PriceListEntry } from "./db";
import { updateDb } from "./db";
import { lotBalances, lotLabel } from "./diamondLots";
import { stockAverageRate } from "./orderCost";
import { fmtCcy } from "./currency";
import { downloadLedgerPdf } from "./ledgerExport";
import { companyById, companyOf } from "./companies";
import { keptForOrder } from "./orderStock";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function priceOf(db: Pick<DB, "settings">, kind: "lot" | "packet", ref: string): PriceListEntry | undefined {
  return (db.settings.priceList ?? []).find(p => p.kind === kind && p.ref === ref);
}
/** Set (rate > 0) or clear a price. */
export function setPrice(kind: "lot" | "packet", ref: string, rate: number | null, currency: "INR" | "USD"): void {
  if (rate != null && (!Number.isFinite(rate) || rate < 0)) throw new Error("The price: 0 or more");
  updateDb(d => {
    const rest = (d.settings.priceList ?? []).filter(p => !(p.kind === kind && p.ref === ref));
    d.settings.priceList = rate && rate > 0 ? [...rest, { kind, ref, rate: r2(rate), currency, at: new Date().toISOString() }] : rest;
    if (!d.settings.priceList.length) delete d.settings.priceList;
  });
}
export function setMarkup(pct: number | null): void {
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 500)) throw new Error("Markup: 0 to 500 %");
  updateDb(d => { if (pct && pct > 0) d.settings.priceListMarkupPct = pct; else delete d.settings.priceListMarkupPct; });
}

export interface PriceRow {
  kind: "lot" | "packet"; ref: string; name: string; detail: string; ct: number; pcs?: number | null;
  price?: PriceListEntry;
  /** ₹ a carat it cost us (staff with costs only), and the price the markup suggests from it. */
  costInr: number | null; suggestInr: number | null;
}
/** What is in stock to sell — loose lots and certified stones (not one kept for an order), with their prices. */
export function priceRows(db: DB, companyId?: string): PriceRow[] {
  const co = companyId && companyId !== "all" ? companyId : undefined;
  const now = new Date().toISOString();
  const mk = db.settings.priceListMarkupPct;
  const suggest = (cost: number | null) => (cost != null && mk ? r2(cost * (1 + mk / 100)) : null);
  const lots: PriceRow[] = lotBalances(db.stockMovements ?? [], co ?? "all").filter(l => l.ct > 0.0005).map(l => {
    const cost = stockAverageRate(db, "diamond", l.key, now, co);
    return { kind: "lot", ref: l.key, name: lotLabel(l.key), detail: "Loose", ct: l.ct, pcs: l.pcs, price: priceOf(db, "lot", l.key), costInr: cost, suggestInr: suggest(cost) };
  });
  const stones: PriceRow[] = (db.diamondPackets ?? [])
    .filter((p: DiamondPacket) => p.status === "in_stock" && !keptForOrder(p) && (!co || companyOf(p) === co))
    .map(p => ({
      kind: "packet" as const, ref: p.id, name: `${p.stockNumber ? `${p.stockNumber} · ` : ""}${p.shape} ${p.carat}ct`,
      detail: [p.color, p.clarity, p.certificateLab && p.certificateNumber ? `${p.certificateLab} ${p.certificateNumber}` : p.certificateNumber].filter(Boolean).join(" · ") || "Certified",
      ct: p.carat, price: priceOf(db, "packet", p.id), costInr: p.ratePerCaratInr ?? null, suggestInr: suggest(p.ratePerCaratInr ?? null),
    }));
  return [...lots, ...stones];
}

const line = (r: PriceRow) => `${r.name}${r.detail && r.kind === "packet" ? ` (${r.detail})` : ""} — ${r.ct}ct${r.price ? ` @ ${fmtCcy(r.price.rate, r.price.currency)}/ct${r.kind === "packet" ? ` = ${fmtCcy(r2(r.price.rate * r.ct), r.price.currency)}` : ""}` : ""}`;
/** The list as a WhatsApp message to a buyer — priced lines only, never the cost. */
export function priceListText(db: Pick<DB, "settings">, rows: PriceRow[], companyId?: string): string {
  const from = companyById(db.settings, companyId && companyId !== "all" ? companyId : "main").name;
  const priced = rows.filter(r => r.price);
  return [`Price list — ${from}`, `${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`, "",
    ...priced.map(r => `• ${line(r)}`), "", "Subject to availability. Reply to order."].join("\n");
}
/** The list as a PDF — priced lines only, never the cost. */
export function downloadPriceListPdf(db: Pick<DB, "settings">, rows: PriceRow[], companyId?: string): void {
  const priced = rows.filter(r => r.price);
  downloadLedgerPdf({
    title: "Price list",
    company: companyById(db.settings, companyId && companyId !== "all" ? companyId : "main").name,
    subjectLines: [`${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} · subject to availability`],
    summary: [{ label: "Items", value: String(priced.length) }],
    columns: [{ header: "Item", x: 14 }, { header: "Details", x: 92 }, { header: "Carat", x: 150 }, { header: "Price / ct", x: 176 }, { header: "Total", x: 196 }],
    align: ["left", "left", "right", "right", "right"],
    rows: priced.map(r => [r.name, r.detail, `${r.ct}`, fmtCcy(r.price!.rate, r.price!.currency), r.kind === "packet" ? fmtCcy(r2(r.price!.rate * r.ct), r.price!.currency) : "per ct"]),
    filename: "Price-list",
  });
}
