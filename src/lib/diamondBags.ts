// Bags (packets) of loose diamonds — one per lot, each with its own number
// ("BAG-0007"), as a diamond office labels the parcels it keeps by shape · mm ·
// colour · clarity.
//
// A bag only NAMES a lot. The stones in it are still counted by the lot's stock
// movements (lib/diamondLots.ts), so nothing about stock, cost or balances
// changes with bags; a lot simply gets a number that stays with it.
//
// A lot gets its bag the first time stones go into it (bought, opening stock,
// returned). Lots already in stock before bags existed get theirs when someone
// on the Stock page asks (giveBags) — never silently.
//
// Each bag's document id comes from its lot, so the same lot can never end up
// with two bags, whoever adds stock to it at the same moment.
import { showPrintPage } from "./printView";
import { updateDb, type DB, type DiamondBag, type Purchase } from "./db";
import { purchaseBucket } from "./materials";
import { LOT_SEP, lotParts, lotLabel, type LotSpec } from "./diamondLots";

/** A loose lot that can have a bag — not certified stones, not "unspecified". */
export function baggable(key: string | undefined | null): key is string {
  return !!key && key !== "Certified" && key !== "unspecified";
}

/** The lot's bag document id: the same lot always gives the same id. */
export function bagId(key: string): string {
  // FNV-1a over the label, twice with different seeds — 64 bits is plenty for a
  // few thousand lots, and it keeps the id short and Firestore-safe.
  let a = 0x811c9dc5, b = 0x01000193 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `bag_${a.toString(36)}${b.toString(36)}`;
}

/** The bag a lot is in, if it has one. */
export function bagOf(db: Pick<DB, "diamondBags">, key: string | undefined | null): DiamondBag | undefined {
  if (!baggable(key)) return undefined;
  const id = bagId(key);
  return (db.diamondBags ?? []).find(b => b.id === id || b.key === key);
}

/** "BAG-0007", or undefined when the lot has no bag yet. */
export function bagNoOf(db: Pick<DB, "diamondBags">, key: string | undefined | null): string | undefined {
  return bagOf(db, key)?.no;
}

/** The next free number, after the highest one given so far. */
function nextBagNo(bags: DiamondBag[]): string {
  const top = bags.reduce((m, b) => Math.max(m, Number(/(\d+)$/.exec(b.no)?.[1] ?? 0)), 0);
  return `BAG-${String(top + 1).padStart(4, "0")}`;
}

/** Inside an updateDb: give these lots a bag each, where they have none. Returns how many were given. */
export function addBags(d: DB, keys: (string | undefined | null)[], userId?: string): number {
  if (!d.diamondBags) d.diamondBags = [];
  let added = 0;
  const now = new Date().toISOString();
  for (const key of [...new Set(keys)]) {
    if (!baggable(key) || bagOf(d, key)) continue;
    d.diamondBags.push({ id: bagId(key), no: nextBagNo(d.diamondBags), key, ...(userId ? { createdBy: userId } : {}), createdAt: now });
    added++;
  }
  return added;
}

/** Stones went into a lot: make sure it has a bag (one save, only when it has none). */
export function ensureBag(key: string | undefined | null, userId?: string): void {
  if (!baggable(key)) return;
  updateDb(d => { addBags(d, [key], userId); });
}

/** The Stock page's "Give bag numbers": every lot in stock that has none. */
export function giveBags(keys: string[], userId?: string): number {
  let n = 0;
  updateDb(d => { n = addBags(d, keys, userId); });
  return n;
}

/** A bag's lot, in parts. */
export function bagSpec(bag: DiamondBag): LotSpec {
  return lotParts(bag.key);
}

/** "BAG-0007 · Round · 1.3 mm · G-H · VS", or just the lot when it has no bag. */
export function lotWithBag(db: Pick<DB, "diamondBags">, key: string): string {
  const no = bagNoOf(db, key);
  return no ? `${no}${LOT_SEP}${lotLabel(key)}` : lotLabel(key);
}

/* ── Labels to stick on the packets ─────────────────────────────────────── */

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * Print small labels, one per bag: the bag number large, then the lot —
 * shape, mm and sieve, colour · clarity — and, when known, what is in it.
 * 50 × 30 mm each, as many to a page as fit.
 */
export function printBagLabels(items: { no: string; key: string; ct?: number; pcs?: number | null }[], company?: string): boolean {
  if (!items.length) return false;
  const cards = items.map(it => {
    const s = lotParts(it.key);
    const size = [s.mm, s.size].filter(Boolean).join(" · ");
    const grade = [s.color, s.clarity].filter(Boolean).join(" · ");
    const holds = [it.ct != null ? `${it.ct} ct` : "", it.pcs != null ? `${it.pcs} pcs` : ""].filter(Boolean).join(" · ");
    return `<div class="lbl"><div class="no">${esc(it.no)}</div><div class="shape">${esc(s.shape)}</div>`
      + `${size ? `<div class="ln">${esc(size)}</div>` : ""}${grade ? `<div class="ln">${esc(grade)}</div>` : ""}`
      + `${holds ? `<div class="holds">${esc(holds)}</div>` : ""}${company ? `<div class="co">${esc(company)}</div>` : ""}</div>`;
  }).join("");
  // Shown over the app with Print and Close (lib/printView.ts) — a new window
  // can't be closed in the installed app.
  const html = (`<!doctype html><html><head><meta charset="utf-8"><title>Bag labels</title><style>
    @page { margin: 8mm; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
    .grid { display: flex; flex-wrap: wrap; gap: 3mm; }
    .lbl { width: 50mm; height: 30mm; box-sizing: border-box; border: 0.3mm dashed #888; border-radius: 2mm; padding: 2mm 2.5mm; overflow: hidden; break-inside: avoid; }
    .no { font-size: 13pt; font-weight: 700; letter-spacing: 0.3pt; }
    .shape { font-size: 10pt; font-weight: 700; margin-top: 0.5mm; }
    .ln { font-size: 9pt; }
    .holds { font-size: 8pt; color: #333; margin-top: 0.5mm; }
    .co { font-size: 7pt; color: #666; }
  </style></head><body><div class="grid">${cards}</div>
  </body></html>`);
  showPrintPage(html, { title: "Bag labels" });
  return true;
}

/** The bag a loose-diamond purchase went into ("BAG-0007"), if it has one. */
export function bagNoOfPurchase(db: Pick<DB, "diamondBags">, p: Pick<Purchase, "material" | "gold" | "diamond" | "other">): string | undefined {
  return p.material === "diamond" && p.diamond?.kind !== "certified" ? bagNoOf(db, purchaseBucket(p)) : undefined;
}
