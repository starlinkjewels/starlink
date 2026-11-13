// Import from Excel (Settings → Import from Excel, admins) — clients, suppliers,
// loose diamonds and gems, certified stones and Ready Stock pieces brought in
// from one workbook, the way a business moving onto the app already keeps them.
//
//   • The template (downloadImportTemplate) has one sheet per kind, its columns
//     named as the app's own forms name them, dropdowns from this business's
//     own lists, and a "Read me" sheet.
//   • Reading a file (readImportFile) checks every row before anything is
//     saved: a row that is wrong says why; a row already on record (the same
//     client, supplier, certificate or design #) — or twice in the file — is
//     skipped and listed; nothing is guessed.
//   • Importing (runImport) writes each record exactly as its form does —
//     a client as New client, a supplier as New supplier, stones as Opening
//     stock (no supplier, no dues; the loose ones into their bags, at the rate
//     given), a piece as Add to Ready Stock with its history line — under one
//     import record, so…
import { cleanValue, fieldsFor, writeValues, KIND_LABEL, type CfTarget, type CfValues } from "./customFields";
//   • …Undo (undoImport) removes everything that file brought in, in one step —
//     except a record used since (an order on the client, a bill from the
//     supplier, stones issued, a piece sold or changed), which stays and is
//     listed with the reason.
//
// The import record is admin-only (adminRecords "import"); every save is the
// ordinary save (activity log, year lock, write policy), in parts of 200.
import type { Workbook, Worksheet, CellValue } from "exceljs";
import { toast } from "sonner";
import {
  loadDb, updateDbAs, updateDb, flush, uid, stampFor, nextDiamondStockNumber, writeStockCost, adminStoreReady, fmtMoney,
  type DB, type Client, type Supplier, type DiamondPacket, type ReadyStockItem, type User, type AdminRecord, type StockMovement, type LedgerDir,
} from "./db";
import { increaseStock } from "./stock";
import { lotKey, lotLabel, normalizeMm, type LotSpec } from "./diamondLots";
import { activeMaterials, materialName, type MaterialKey } from "./materials";
import { listOf, type ListKey } from "./optionLists";
import { companiesOf, hasCompanies, MAIN_COMPANY_ID, coField } from "./companies";
import { handlerChoices } from "./clientHandlers";
import { readyStockOffices, officeLabel } from "./offices";
import { metalHasKarats } from "./metals";
import { weightProblem } from "./weights";
import { logItem, whoOf } from "./readyStockHistory";
import { readyStockDeleteBlocker } from "./readyStockGuards";
import { clientDeleteBlocker } from "./clientActions";
import { supplierDeleteGuard } from "./partyGuards";
import { deleteOpeningStock, isOpeningMovement, openingRefusal } from "./openingStock";
import { closedWhy } from "./yearLock";
import { recordsReady, STILL_LOADING } from "./actionHints";
import { getBrand, brandName, brandFilePrefix } from "./brand";

export type ImportKind = "clients" | "suppliers" | "loose" | "certified" | "ready";
export const KIND_NAME: Record<ImportKind, { one: string; many: string }> = {
  clients: { one: "client", many: "clients" },
  suppliers: { one: "supplier", many: "suppliers" },
  loose: { one: "loose stone lot", many: "loose stone lots" },
  certified: { one: "certified stone", many: "certified stones" },
  ready: { one: "Ready Stock piece", many: "Ready Stock pieces" },
};
export const KINDS: ImportKind[] = ["clients", "suppliers", "loose", "certified", "ready"];
/** One file at a time, and not more than this — a bigger list goes in parts. */
export const MAX_ROWS = 3000;
const CHUNK = 200;

/** The record of one import — what it brought in, so Undo can take it out. */
export interface ImportBatch {
  file: string;
  /** The file's fingerprint: the same file twice is refused while the first is in. */
  hash: string;
  at: string;
  by: string;
  byName?: string;
  /** The day the stones went into stock as opening stock. */
  asOf: string;
  status: "running" | "done" | "stopped" | "undone" | "partlyUndone";
  counts: Partial<Record<ImportKind, number>>;
  skipped: number;
  errors: number;
  ids: { clients: string[]; suppliers: string[]; packets: string[]; ready: string[] };
  /** Why it stopped part-way. */
  problem?: string;
  undo?: { at: string; by: string; byName?: string; removed: number; kept: { what: string; why: string }[] };
}
export type ImportRecord = Extract<AdminRecord, { kind: "import" }>;

/* ── The sheets and their columns ─────────────────────────────────────────── */

interface Col {
  key: string;
  header: string;
  req?: boolean;
  help: string;
  example?: string;
  /** A dropdown in the template (any word may still be typed where the app allows it). */
  list?: string[];
  aliases?: string[];
  width?: number;
}
interface SheetDef { kind: ImportKind; name: string; aliases: string[]; intro: string; cols: Col[] }

const companyNames = (db: DB) => companiesOf(db.settings, true).map(c => c.name);
const stoneMaterials = (db: DB) => activeMaterials(db.settings).filter(m => m.kind === "stone");

/** The business's own fields as template columns (lib/customFields.ts) — "cf:<id>". Loose lots get theirs on the bag page. */
const CF_TARGET: Partial<Record<ImportKind, CfTarget>> = { clients: "clients", suppliers: "suppliers", certified: "packets", ready: "readyStock" };
function customCols(db: DB, kind: ImportKind): Col[] {
  const t = CF_TARGET[kind];
  if (!t) return [];
  return fieldsFor(db.settings, t, { role: "admin" }).map(d => ({
    key: `cf:${d.id}`, header: d.label, req: !!d.required,
    help: `${KIND_LABEL[d.kind]}${d.kind === "list" ? ` — one of: ${(d.options ?? []).join(", ")}` : d.kind === "date" ? " — e.g. 2026-04-01" : d.kind === "yesno" ? " — Yes or No" : ""}${d.hint ? ` · ${d.hint}` : ""}`,
    ...(d.kind === "list" ? { list: d.options ?? [] } : d.kind === "yesno" ? { list: ["Yes", "No"] } : {}),
  }));
}

export function sheetDefs(db: DB): SheetDef[] {
  return baseDefs(db).map(s => ({ ...s, cols: [...s.cols, ...customCols(db, s.kind)] }));
}

function baseDefs(db: DB): SheetDef[] {
  const multi = hasCompanies(db.settings);
  const company: Col[] = multi ? [{ key: "company", header: "Our company", help: `Whose it is — blank = ${companiesOf(db.settings)[0].name}`, list: companyNames(db), aliases: ["company"] }] : [];
  const staff = handlerChoices(db).map(u => u.name).filter(Boolean);
  return [
    {
      kind: "clients", name: "Clients", aliases: ["client", "customers", "customer"],
      intro: "One client a row — as New client. No login is made; give one later from the client's page.",
      cols: [
        { key: "companyName", header: "Company name", req: true, help: "The client's business name", example: "Sunrise Jewellers", aliases: ["client name", "name", "client", "business name", "company"], width: 28 },
        { key: "ownerName", header: "Owner name", help: "The person", example: "Ravi Shah", aliases: ["owner", "contact person", "contact"] },
        { key: "email", header: "Email", help: "Their email", example: "ravi@sunrise.com", aliases: ["email id", "mail"], width: 26 },
        { key: "phone", header: "Phone", help: "With the country code if abroad", example: "+1 201 555 0100", aliases: ["mobile", "phone number", "contact number", "whatsapp"] },
        { key: "country", header: "Country", help: "", example: "USA" },
        { key: "zip", header: "ZIP / Postal code", help: "", aliases: ["zip", "postal code", "pin code", "pincode", "zip code"] },
        { key: "gstVat", header: "GST / VAT", help: "Their tax number", aliases: ["gst", "vat", "gstin", "tax id", "gst no"] },
        { key: "address", header: "Billing address", help: "", aliases: ["address"], width: 34 },
        { key: "shippingAddress", header: "Shipping address", help: "Only if different from billing", width: 34 },
        { key: "opening", header: "Opening balance ($)", help: "Owed or prepaid when you started with the app — blank or 0 if none", example: "1500", aliases: ["opening balance", "opening", "balance"] },
        { key: "openingDir", header: "Opening is", help: "They owe us / We owe them — blank = They owe us", list: ["They owe us", "We owe them"], aliases: ["opening direction", "dr cr", "direction"] },
        { key: "openingDate", header: "Opening as of", help: "A date — e.g. 2026-04-01", aliases: ["opening date", "as of"] },
        // Payment terms and credit limit (lib/paymentTerms.ts) — as on New client.
        { key: "terms", header: "Payment terms (days)", help: "30 = Net 30, 0 = due on receipt — blank = the default in Settings", example: "30", aliases: ["terms", "payment terms", "credit days", "credit period", "net days"] },
        { key: "creditLimit", header: "Credit limit ($)", help: "What they may owe in all — blank = no limit", example: "5000", aliases: ["credit limit", "limit"] },
        ...(staff.length ? [{ key: "handledBy", header: "Handled by", help: "A team member's name or email — blank = you", list: staff, aliases: ["account manager", "sales person", "salesperson", "handler"] }] : []),
        ...(multi ? [{ ...company[0], header: "Our company", help: `Who bills them — blank = ${companiesOf(db.settings)[0].name}` }] : []),
      ],
    },
    {
      kind: "suppliers", name: "Suppliers", aliases: ["supplier", "dealers", "dealer", "vendors", "vendor"],
      intro: "One supplier a row — as New supplier.",
      cols: [
        { key: "name", header: "Name", req: true, help: "The supplier's business name", example: "Shah Diamonds", aliases: ["supplier name", "supplier", "company name", "business name"], width: 28 },
        { key: "contactPerson", header: "Contact person", help: "", aliases: ["contact", "owner", "owner name"] },
        { key: "phone", header: "Phone", help: "", aliases: ["mobile", "phone number", "contact number", "whatsapp"] },
        { key: "email", header: "Email", help: "", aliases: ["email id", "mail"], width: 26 },
        { key: "gstin", header: "GSTIN", help: "Their GST number", aliases: ["gst", "gst no", "gst number"] },
        { key: "address", header: "Address", help: "", width: 34 },
        { key: "opening", header: "Opening balance (₹)", help: "Owed when you started with the app — blank or 0 if none", example: "250000", aliases: ["opening balance", "opening", "balance"] },
        { key: "openingDir", header: "Opening is", help: "We owe them / They owe us — blank = We owe them", list: ["We owe them", "They owe us"], aliases: ["opening direction", "dr cr", "direction"] },
        { key: "openingDate", header: "Opening as of", help: "A date — e.g. 2026-04-01", aliases: ["opening date", "as of"] },
      ],
    },
    {
      kind: "loose", name: "Loose stones", aliases: ["loose diamonds", "loose", "diamonds", "gems", "loose stock", "stones"],
      intro: "Loose diamonds and gems you already hold — into stock as opening stock (no supplier, no dues), each lot into its bag.",
      cols: [
        { key: "material", header: "Material", help: `Diamond, or a stone from Settings → Materials${stoneMaterials(db).length ? ` (${stoneMaterials(db).map(m => m.name).join(", ")})` : ""} — blank = Diamond`, list: ["Diamond", ...stoneMaterials(db).map(m => m.name)] },
        { key: "variety", header: "Gem stone", help: "Gems only — which stone: Ruby, Emerald…", list: listOf("gemStones", db.settings), aliases: ["gem", "stone", "variety"] },
        { key: "shape", header: "Shape", help: "blank = Round", example: "Round", list: listOf("diamondShapes", db.settings) },
        { key: "type", header: "Type", help: "Natural, CVD, HPHT…", example: "Natural", list: listOf("diamondTypes", db.settings), aliases: ["diamond type", "stone type"] },
        { key: "size", header: "Sieve size", help: "e.g. +6.5-7", list: listOf("diamondSizes", db.settings), aliases: ["sieve", "size"] },
        { key: "mm", header: "MM size", help: "e.g. 1.3", aliases: ["mm"] },
        { key: "color", header: "Colour", help: "e.g. G-H", list: listOf("diamondColors", db.settings), aliases: ["color"] },
        { key: "clarity", header: "Clarity", help: "e.g. VS — for a gem, its grade", list: listOf("diamondClarities", db.settings), aliases: ["grade", "quality"] },
        { key: "qty", header: "Carats", req: true, help: "How much — carats (a gem counted in another unit: that unit)", example: "12.5", aliases: ["carat", "ct", "cts", "weight", "quantity", "qty"] },
        { key: "pieces", header: "Pieces", help: "Diamonds — how many stones, if counted", example: "250", aliases: ["pcs", "stones", "count"] },
        { key: "rate", header: "Rate per carat (₹)", help: "What it cost — the stock's average cost starts from it. Blank = joins at the current average", example: "45000", aliases: ["rate", "price per carat", "rate per ct", "cost per carat"] },
        ...company,
        { key: "note", header: "Note", help: "", aliases: ["notes", "remarks", "remark"] },
      ],
    },
    {
      kind: "certified", name: "Certified stones", aliases: ["certified", "certified diamonds", "certificates", "solitaires"],
      intro: "One certified stone a row — into stock as opening stock, each with its own DP number.",
      cols: [
        { key: "certNo", header: "Certificate no.", req: true, help: "The report number", example: "IGI 612345678", aliases: ["certificate", "certificate number", "report no", "report number", "cert no", "cert"] },
        { key: "lab", header: "Lab", help: "GIA, IGI…", list: listOf("diamondLabs", db.settings), aliases: ["certificate lab"] },
        { key: "shape", header: "Shape", help: "blank = Round", list: listOf("diamondShapes", db.settings) },
        { key: "carat", header: "Carat", req: true, help: "Its weight", example: "1.02", aliases: ["carats", "ct", "weight"] },
        { key: "type", header: "Type", help: "Natural, CVD, HPHT…", list: listOf("diamondTypes", db.settings), aliases: ["diamond type", "stone type"] },
        { key: "color", header: "Colour", help: "", list: listOf("diamondColors", db.settings), aliases: ["color"] },
        { key: "clarity", header: "Clarity", help: "", list: listOf("diamondClarities", db.settings) },
        { key: "cut", header: "Cut", help: "", list: listOf("diamondFinish", db.settings) },
        { key: "polish", header: "Polish", help: "", list: listOf("diamondFinish", db.settings) },
        { key: "symmetry", header: "Symmetry", help: "", list: listOf("diamondFinish", db.settings), aliases: ["sym"] },
        { key: "fluorescence", header: "Fluorescence", help: "", list: listOf("diamondFluorescence", db.settings), aliases: ["fluor", "flo"] },
        { key: "measurement", header: "Measurements", help: "e.g. 6.45 x 6.47 x 3.98", aliases: ["measurement", "measure", "dimensions"] },
        { key: "rate", header: "Rate per carat (₹)", help: "What it cost a carat", aliases: ["rate", "price per carat", "rate per ct", "cost per carat"] },
        ...company,
        { key: "note", header: "Note", help: "", aliases: ["notes", "remarks", "remark"] },
      ],
    },
    {
      kind: "ready", name: "Ready Stock", aliases: ["ready", "ready stock pieces", "jewellery", "jewelry", "finished goods", "inventory"],
      intro: "Finished pieces on the shelf — as Add to Ready Stock. Add photos later from the piece's page.",
      cols: [
        { key: "name", header: "Name", req: true, help: "What the piece is called", example: "Solitaire ring 1ct", aliases: ["item name", "item", "product", "product name", "description"], width: 28 },
        { key: "sku", header: "Design # / SKU", help: "Your code for it — the same code twice is skipped", aliases: ["design no", "design number", "sku", "code", "style no", "style"] },
        { key: "jewelleryType", header: "Type", help: `blank = ${listOf("jewelleryTypes", db.settings)[0] ?? "Ring"}`, list: listOf("jewelleryTypes", db.settings), aliases: ["jewellery type", "jewelry type", "category"] },
        { key: "metal", header: "Metal", help: `blank = ${listOf("metals", db.settings)[0] ?? "Yellow Gold"}`, list: listOf("metals", db.settings) },
        { key: "karat", header: "Karat", help: "14K, 18K… — blank = 22K (metals with karats)", list: ["9K", "10K", "14K", "18K", "22K", "24K"], aliases: ["kt", "purity"] },
        { key: "gross", header: "Gross weight (g)", help: "", aliases: ["gross weight", "gross wt", "gross", "gw"] },
        { key: "net", header: "Net weight (g)", help: "", aliases: ["net weight", "net wt", "net", "nw"] },
        { key: "dia", header: "Diamond weight (ct)", help: "", aliases: ["diamond weight", "diamond wt", "dia wt", "diamond ct", "diamonds"] },
        { key: "diaType", header: "Diamond type", help: "Natural, Lab Grown…", list: listOf("diamondTypes", db.settings) },
        { key: "price", header: "Price ($)", req: true, help: "Its selling price", example: "2400", aliases: ["price", "selling price", "sale price", "mrp"] },
        { key: "cost", header: "Cost ($)", help: "What it cost us — only admins ever see it", aliases: ["cost", "cost price", "purchase price"] },
        { key: "quantity", header: "Quantity", help: "Identical pieces — blank = 1", example: "1", aliases: ["qty", "pcs", "pieces"] },
        { key: "office", header: "Office", req: true, help: `Where it is kept: ${readyStockOffices(db.settings).join(", ")}`, list: readyStockOffices(db.settings), aliases: ["location", "kept at", "branch"] },
        ...company,
        { key: "notes", header: "Notes", help: "", aliases: ["note", "remarks", "remark"] },
      ],
    },
  ];
}

/* ── Reading cells ───────────────────────────────────────────────────────── */

const normHead = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[*:.]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function cellText(v: CellValue | undefined): string {
  if (v == null) return "";
  if (v instanceof Date) return isoDay(v);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map(t => t.text ?? "").join("").trim();
    if ("result" in o) return cellText(o.result as CellValue);
    if ("text" in o) return typeof o.text === "object" ? cellText(o.text as CellValue) : String(o.text ?? "").trim();
    return "";
  }
  return String(v).trim();
}

const pad = (n: number) => String(n).padStart(2, "0");
/** An Excel date is the day at midnight UTC. */
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const realDay = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
/** "2026-04-01", "01/04/2026" (day first, as written in India), "1 Apr 2026", or Excel's day number. */
export function parseDay(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return realDay(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return realDay(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[\s-]([a-z]{3,9})[\s,-]+(\d{4})$/i);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); return mo < 0 ? null : realDay(+m[3], mo + 1, +m[1]); }
  if (/^\d{5}(\.\d+)?$/.test(t)) { const n = Math.floor(Number(t)); if (n > 20000 && n < 80000) return isoDay(new Date(Date.UTC(1899, 11, 30) + n * 86_400_000)); }
  return null;
}

/** "1,23,456.50", "₹ 5,000", "$2,400" → the number; "" → undefined; anything else → NaN. */
export function parseNum(s: string): number | undefined {
  const t = s.replace(/[,\s₹$]|rs\.?|inr|usd/gi, "");
  if (!t) return undefined;
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

/** Their spelling, matched to the list's own when it is one of them (any case). */
const canon = (v: string, list: string[]) => list.find(x => x.toLowerCase() === v.trim().toLowerCase()) ?? v.trim();

/** A business name to compare: case, punctuation and "Pvt Ltd"-style endings left out. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\s+(pvt|private|ltd|limited|llp|llc|inc|co|corp|company)(\s+(pvt|private|ltd|limited|llp|llc|inc|co|corp|company))*$/, "").trim();
}
const phoneKey = (s?: string) => { const d = (s ?? "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-10) : ""; };
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const certKey = (s?: string) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const skuKey = (s?: string) => (s ?? "").trim().toLowerCase();
const karatOf = (s: string) => { const m = s.trim().match(/^(\d{1,2})\s*(k|kt|karat|carat)?$/i); return m ? `${m[1]}K` : s.trim(); };

/* ── What a row becomes ─────────────────────────────────────────────────── */

type ClientRec = { kind: "clients"; v: Omit<Client, "id" | "createdAt" | "username" | "status">; cf?: CfValues };
type SupplierRec = { kind: "suppliers"; v: Omit<Supplier, "id" | "createdAt" | "active">; cf?: CfValues };
type LooseRec = { kind: "loose"; material: MaterialKey; bucket: string; lot: LotSpec; qty: number; pieces?: number; valueInr?: number; companyId: string; note?: string };
type CertRec = { kind: "certified"; v: Omit<DiamondPacket, "id" | "stockNumber" | "createdBy" | "createdAt" | "status">; cf?: CfValues };
type ReadyRec = { kind: "ready"; v: Omit<ReadyStockItem, "id" | "createdBy" | "createdAt" | "images">; cost?: number; cf?: CfValues };
export type ImportRec = ClientRec | SupplierRec | LooseRec | CertRec | ReadyRec;

export interface PlanRow {
  kind: ImportKind;
  /** The row in the sheet, as Excel numbers it. */
  row: number;
  status: "ok" | "skip" | "error";
  label: string;
  why?: string;
  rec?: ImportRec;
}
export interface ImportPlan {
  file: string;
  hash: string;
  rows: PlanRow[];
  /** Sheets read, and what was found in each. */
  sheets: { kind: ImportKind; name: string; ignored: string[] }[];
  /** Sheets the file has that are not one of ours. */
  unknownSheets: string[];
  /** A reason nothing can be imported from this file. */
  blocked?: string;
}

async function excel(): Promise<typeof import("exceljs")> {
  const m = await import("exceljs");
  return ((m as unknown as { default?: typeof import("exceljs") }).default ?? m) as typeof import("exceljs");
}

async function sha(buf: ArrayBuffer): Promise<string> {
  try {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return `${buf.byteLength}`; }
}

/** An import of this very file that is still in. */
export function sameFileIn(db: DB, hash: string): ImportBatch | undefined {
  return importRecords(db).map(r => r.batch).find(b => b.hash === hash && b.status !== "undone");
}

export function importRecords(db: DB): ImportRecord[] {
  return ((db.adminRecords ?? []).filter(r => r.kind === "import") as ImportRecord[]).sort((a, b) => b.batch.at.localeCompare(a.batch.at));
}

/** Where a sheet's headings are (one of the first rows), and which column is which. */
function findHeader(ws: Worksheet, def: SheetDef): { at: number; map: Map<string, number>; ignored: string[] } | null {
  const want = new Map<string, string>();
  for (const c of def.cols) {
    want.set(normHead(c.header), c.key);
    for (const a of c.aliases ?? []) if (!want.has(normHead(a))) want.set(normHead(a), c.key);
  }
  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const map = new Map<string, number>(), ignored: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const t = cellText(cell.value);
      if (!t) return;
      const key = want.get(normHead(t));
      if (key && !map.has(key)) map.set(key, col); else ignored.push(t);
    });
    if (map.size >= 2 || (map.size === 1 && def.cols.some(c => c.req && map.has(c.key)))) return { at: r, map, ignored };
  }
  return null;
}

/** Read a file and check every row against the records already here. Nothing is saved. */
export async function readImportFile(file: File, db: DB, asOf: string): Promise<ImportPlan> {
  const buf = await file.arrayBuffer();
  const hash = await sha(buf);
  const ExcelJS = await excel();
  const wb: Workbook = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { return { file: file.name, hash, rows: [], sheets: [], unknownSheets: [], blocked: "This isn't an Excel workbook (.xlsx) — open it in Excel and Save As .xlsx" }; }
  const defs = sheetDefs(db);
  const plan: ImportPlan = { file: file.name, hash, rows: [], sheets: [], unknownSheets: [] };
  const prev = sameFileIn(db, hash);
  if (prev) plan.blocked = `This same file was imported on ${new Date(prev.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} — undo that import first, or import a changed file`;

  const seen = new Set<ImportKind>();
  const ctx = makeContext(db);
  for (const ws of wb.worksheets) {
    const n = normHead(ws.name);
    if (n === "read me" || n === "lists" || n === "readme") continue;
    const def = defs.find(d => normHead(d.name) === n || d.aliases.some(a => normHead(a) === n));
    if (!def || seen.has(def.kind)) { if (ws.actualRowCount > 1) plan.unknownSheets.push(ws.name); continue; }
    const head = findHeader(ws, def);
    if (!head) { if (ws.actualRowCount > 1) plan.unknownSheets.push(ws.name); continue; }
    seen.add(def.kind);
    plan.sheets.push({ kind: def.kind, name: ws.name, ignored: head.ignored });
    const missing = def.cols.filter(c => c.req && !head.map.has(c.key)).map(c => c.header);
    for (let r = head.at + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const val: Record<string, string> = {};
      let any = false;
      for (const [key, col] of head.map) { const t = cellText(row.getCell(col).value); val[key] = t; if (t) any = true; }
      if (!any) continue;
      if (plan.rows.length >= MAX_ROWS) { plan.blocked = `More than ${MAX_ROWS.toLocaleString("en-IN")} rows — import it in parts`; break; }
      if (missing.length) { plan.rows.push({ kind: def.kind, row: r, status: "error", label: Object.values(val).find(Boolean) ?? "", why: `The sheet has no ${missing.join(" / ")} column` }); continue; }
      plan.rows.push(withCustom(checkRow(def.kind, r, val, ctx, asOf), val, db));
    }
  }
  if (!plan.sheets.length && !plan.blocked) plan.blocked = `No sheet here is one of: ${defs.map(d => d.name).join(", ")} — start from the template`;
  else if (!plan.rows.length && !plan.blocked) plan.blocked = "The sheets are empty";
  return plan;
}

/* ── Checking a row ─────────────────────────────────────────────────────── */

interface Ctx {
  db: DB;
  clientName: Map<string, string>; clientEmail: Map<string, string>; clientPhone: Map<string, string>;
  supName: Map<string, string>; supGst: Map<string, string>; supPhone: Map<string, string>;
  cert: Map<string, string>; sku: Map<string, string>;
  companies: { id: string; name: string }[];
  staff: User[];
  offices: string[];
}

function makeContext(db: DB): Ctx {
  const ctx: Ctx = {
    db, clientName: new Map(), clientEmail: new Map(), clientPhone: new Map(),
    supName: new Map(), supGst: new Map(), supPhone: new Map(), cert: new Map(), sku: new Map(),
    companies: companiesOf(db.settings, true).map(c => ({ id: c.id, name: c.name })),
    staff: handlerChoices(db), offices: readyStockOffices(db.settings),
  };
  for (const c of db.clients) {
    const why = `Already a client — ${c.companyName}${c.status === "active" ? "" : " (inactive)"}`;
    if (nameKey(c.companyName)) ctx.clientName.set(nameKey(c.companyName), why);
    if (c.email?.trim()) ctx.clientEmail.set(c.email.trim().toLowerCase(), `${why}, same email`);
    if (phoneKey(c.phone)) ctx.clientPhone.set(phoneKey(c.phone), `${why}, same phone`);
  }
  for (const s of db.suppliers) {
    const why = `Already a supplier — ${s.name}${s.active === false ? " (inactive)" : ""}`;
    if (nameKey(s.name)) ctx.supName.set(nameKey(s.name), why);
    if (certKey(s.gstin).length >= 10) ctx.supGst.set(certKey(s.gstin), `${why}, same GSTIN`);
    if (phoneKey(s.phone)) ctx.supPhone.set(phoneKey(s.phone), `${why}, same phone`);
  }
  for (const p of db.diamondPackets ?? []) {
    if (certKey(p.certificateNumber)) ctx.cert.set(certKey(p.certificateNumber), `Already on record — ${p.stockNumber ?? "a certified stone"}${p.status === "in_stock" ? " in stock" : ` (${p.status})`}`);
  }
  for (const it of db.readyStock ?? []) if (skuKey(it.sku)) ctx.sku.set(skuKey(it.sku), `Already in Ready Stock — ${it.name} (${it.sku})`);
  return ctx;
}

function companyOfRow(ctx: Ctx, v: string): { id: string } | { error: string } {
  if (!v.trim()) return { id: MAIN_COMPANY_ID };
  const c = ctx.companies.find(x => x.name.toLowerCase() === v.trim().toLowerCase());
  return c ? { id: c.id } : { error: `No company called “${v}” — one of: ${ctx.companies.map(x => x.name).join(", ")}` };
}

function checkRow(kind: ImportKind, row: number, v: Record<string, string>, ctx: Ctx, asOf: string): PlanRow {
  const g = (k: string) => (v[k] ?? "").trim();
  const err = (label: string, why: string): PlanRow => ({ kind, row, status: "error", label, why });
  const skip = (label: string, why: string): PlanRow => ({ kind, row, status: "skip", label, why });
  const s = ctx.db.settings;
  const numOf = (k: string, label: string, opts: { min?: number; int?: boolean } = {}): number | undefined | string => {
    const n = parseNum(g(k));
    if (n === undefined) return undefined;
    if (!isFinite(n)) return `${label}: “${g(k)}” is not a number`;
    if (n < (opts.min ?? 0)) return `${label} can't be below ${opts.min ?? 0}`;
    if (opts.int && !Number.isInteger(n)) return `${label} must be a whole number`;
    return n;
  };
  const opening = (dirWord: string, debitWords: RegExp, label: string): { bal?: number; dir?: LedgerDir; date?: string } | string => {
    const bal = numOf("opening", "Opening balance");
    if (typeof bal === "string") return bal;
    if (!bal) return {};
    const w = g("openingDir").toLowerCase();
    const dir: LedgerDir = !w ? (dirWord === "debit" ? "debit" : "credit") : debitWords.test(w) ? "debit" : "credit";
    const day = g("openingDate") ? parseDay(g("openingDate")) : undefined;
    if (g("openingDate") && !day) return `Opening as of: “${g("openingDate")}” is not a date — write it 2026-04-01`;
    if (day) { const c = closedWhy(day, s); if (c) return `${label}: ${c}`; }
    return { bal: Math.round(bal * 100) / 100, dir, ...(day ? { date: day } : {}) };
  };

  if (kind === "clients") {
    const name = g("companyName");
    if (!name) return err(g("ownerName") || g("email") || "(no name)", "No company name");
    const email = g("email").toLowerCase();
    if (email && !emailOk(email)) return err(name, `Email “${email}” doesn't look right`);
    const dup = ctx.clientName.get(nameKey(name)) ?? (email ? ctx.clientEmail.get(email) : undefined) ?? (phoneKey(g("phone")) ? ctx.clientPhone.get(phoneKey(g("phone"))) : undefined);
    if (dup) {
      // A later row matching this one (its other name, email or phone) is the same client again.
      const again = `Same client as row ${row} above`;
      if (!ctx.clientName.has(nameKey(name))) ctx.clientName.set(nameKey(name), again);
      if (email && !ctx.clientEmail.has(email)) ctx.clientEmail.set(email, again);
      if (phoneKey(g("phone")) && !ctx.clientPhone.has(phoneKey(g("phone")))) ctx.clientPhone.set(phoneKey(g("phone")), again);
      return skip(name, dup);
    }
    const op = opening("debit", /owe us|debit|dr|receivable|they owe/, "Opening");
    if (typeof op === "string") return err(name, op);
    const terms = numOf("terms", "Payment terms", { int: true });
    if (typeof terms === "string") return err(name, terms);
    if (terms != null && terms > 365) return err(name, "Payment terms: 365 days at most");
    const limit = numOf("creditLimit", "Credit limit");
    if (typeof limit === "string") return err(name, limit);
    let manager: string | undefined;
    if (g("handledBy")) {
      const w = g("handledBy").toLowerCase();
      const u = ctx.staff.find(x => x.name?.toLowerCase() === w || (x.email ?? "").toLowerCase() === w || x.username?.toLowerCase() === w);
      if (!u) return err(name, `Handled by: nobody called “${g("handledBy")}” in the team`);
      manager = u.id;
    }
    const co = companyOfRow(ctx, g("company"));
    if ("error" in co) return err(name, co.error);
    // Taken: later rows with the same name, email or phone are duplicates of this one.
    const mine = `Same client as row ${row} above`;
    ctx.clientName.set(nameKey(name), mine);
    if (email) ctx.clientEmail.set(email, mine);
    if (phoneKey(g("phone"))) ctx.clientPhone.set(phoneKey(g("phone")), mine);
    return {
      kind, row, status: "ok", label: name, rec: {
        kind: "clients", v: {
          companyName: name, ownerName: g("ownerName"), email, phone: g("phone"), country: g("country"), zip: g("zip"),
          gstVat: g("gstVat"), address: g("address"), shippingAddress: g("shippingAddress"),
          ...(manager ? { accountManagerId: manager } : {}),
          ...(op.bal ? { openingBalance: op.bal, openingDir: op.dir, ...(op.date ? { openingDate: op.date } : {}) } : {}),
          ...(terms != null ? { paymentTermsDays: terms } : {}),
          ...(limit ? { creditLimitUsd: Math.round(limit * 100) / 100 } : {}),
          ...(co.id !== MAIN_COMPANY_ID ? { companyId: co.id } : {}),
        } as ClientRec["v"],
      },
    };
  }

  if (kind === "suppliers") {
    const name = g("name");
    if (!name) return err(g("contactPerson") || g("phone") || "(no name)", "No name");
    const email = g("email").toLowerCase();
    if (email && !emailOk(email)) return err(name, `Email “${email}” doesn't look right`);
    const gst = certKey(g("gstin"));
    const dup = ctx.supName.get(nameKey(name)) ?? (gst.length >= 10 ? ctx.supGst.get(gst) : undefined) ?? (phoneKey(g("phone")) ? ctx.supPhone.get(phoneKey(g("phone"))) : undefined);
    if (dup) {
      const again = `Same supplier as row ${row} above`;
      if (!ctx.supName.has(nameKey(name))) ctx.supName.set(nameKey(name), again);
      if (gst.length >= 10 && !ctx.supGst.has(gst)) ctx.supGst.set(gst, again);
      if (phoneKey(g("phone")) && !ctx.supPhone.has(phoneKey(g("phone")))) ctx.supPhone.set(phoneKey(g("phone")), again);
      return skip(name, dup);
    }
    const op = opening("credit", /owe us|debit|dr|receivable|they owe/, "Opening");
    if (typeof op === "string") return err(name, op);
    const mine = `Same supplier as row ${row} above`;
    ctx.supName.set(nameKey(name), mine);
    if (gst.length >= 10) ctx.supGst.set(gst, mine);
    if (phoneKey(g("phone"))) ctx.supPhone.set(phoneKey(g("phone")), mine);
    return {
      kind, row, status: "ok", label: name, rec: {
        kind: "suppliers", v: {
          name, contactPerson: g("contactPerson"), phone: g("phone"), email, gstin: g("gstin").toUpperCase(), address: g("address"),
          ...(op.bal ? { openingBalance: op.bal, openingDir: op.dir, ...(op.date ? { openingDate: op.date } : {}) } : {}),
        },
      },
    };
  }

  if (kind === "loose") {
    const word = g("material");
    let material: MaterialKey = "diamond";
    let variety = g("variety");
    if (word && !/^diamonds?$/i.test(word)) {
      const stones = stoneMaterials(ctx.db);
      const m = stones.find(x => x.name.toLowerCase() === word.toLowerCase());
      if (m) material = m.id;
      // "Ruby" with one gem material: that material, the stone named.
      else if (stones.length === 1 && listOf("gemStones", s).some(x => x.toLowerCase() === word.toLowerCase())) { material = stones[0].id; variety = variety || word; }
      else {
        const any = activeMaterials(s).find(x => x.name.toLowerCase() === word.toLowerCase());
        return err(word, any ? `${any.name} is not a stone — add metals and findings from Stock → Opening stock` : `No stone called “${word}” in Settings → Materials${stones.length ? ` — one of: Diamond, ${stones.map(x => x.name).join(", ")}` : " — add it there first"}`);
      }
    }
    const gem = material !== "diamond";
    const lot: LotSpec = {
      shape: canon(g("shape") || "Round", listOf("diamondShapes", s)),
      ...(gem && variety ? { variety: canon(variety, listOf("gemStones", s)) } : {}),
      ...(g("type") ? { type: canon(g("type"), listOf(gem ? "gemTypes" : "diamondTypes", s).concat(listOf("diamondTypes", s))) } : {}),
      ...(g("size") ? { size: canon(g("size"), listOf("diamondSizes", s)) } : {}),
      ...(g("mm") ? { mm: normalizeMm(g("mm")) } : {}),
      ...(g("color") ? { color: canon(g("color"), listOf(gem ? "gemColors" : "diamondColors", s).concat(listOf("diamondColors", s))) } : {}),
      ...(g("clarity") ? { clarity: canon(g("clarity"), listOf(gem ? "gemQualities" : "diamondClarities", s).concat(listOf("diamondClarities", s))) } : {}),
    };
    const bucket = lotKey(lot);
    const label = `${gem ? `${materialName(s, material)} · ` : ""}${lotLabel(bucket)}`;
    const qty = numOf("qty", "Carats");
    if (typeof qty === "string") return err(label, qty);
    if (!qty) return err(label, "No carats");
    const pcs = numOf("pieces", "Pieces", { int: true });
    if (typeof pcs === "string") return err(label, pcs);
    const rate = numOf("rate", "Rate");
    if (typeof rate === "string") return err(label, rate);
    const co = companyOfRow(ctx, g("company"));
    if ("error" in co) return err(label, co.error);
    const c = closedWhy(asOf, s);
    if (c) return err(label, c);
    const value = rate ? Math.round(qty * rate) : 0;
    return {
      kind, row, status: "ok", label: `${label} — ${Math.round(qty * 1000) / 1000} ct${pcs && !gem ? ` · ${pcs} pcs` : ""}`,
      rec: { kind: "loose", material, bucket, lot, qty, ...(pcs && !gem ? { pieces: Math.round(pcs) } : {}), ...(value > 0 ? { valueInr: value } : {}), companyId: co.id, ...(g("note") ? { note: g("note") } : {}) },
    };
  }

  if (kind === "certified") {
    const cert = g("certNo");
    const shape = canon(g("shape") || "Round", listOf("diamondShapes", s));
    const label = `${shape} ${g("carat") || "?"}ct${cert ? ` · ${cert}` : ""}`;
    if (!cert) return err(label, "No certificate number");
    const dup = ctx.cert.get(certKey(cert));
    if (dup) return skip(label, dup);
    const carat = numOf("carat", "Carat");
    if (typeof carat === "string") return err(label, carat);
    if (!carat) return err(label, "No carat weight");
    const rate = numOf("rate", "Rate");
    if (typeof rate === "string") return err(label, rate);
    const co = companyOfRow(ctx, g("company"));
    if ("error" in co) return err(label, co.error);
    const c = closedWhy(asOf, s);
    if (c) return err(label, c);
    ctx.cert.set(certKey(cert), `Same certificate as row ${row} above`);
    const opt = (k: string, list?: ListKey) => (g(k) ? canon(g(k), list ? listOf(list, s) : []) : undefined);
    return {
      kind, row, status: "ok", label, rec: {
        kind: "certified", v: {
          shape, carat, certificateNumber: cert, ...coField(co.id),
          type: opt("type", "diamondTypes"), color: opt("color", "diamondColors"), clarity: opt("clarity", "diamondClarities"),
          cut: opt("cut", "diamondFinish"), polish: opt("polish", "diamondFinish"), symmetry: opt("symmetry", "diamondFinish"),
          fluorescence: opt("fluorescence", "diamondFluorescence"), measurement: opt("measurement"), certificateLab: opt("lab", "diamondLabs"),
          ratePerCaratInr: rate && rate > 0 ? Math.round(rate * 100) / 100 : undefined, note: g("note") || undefined,
        },
      },
    };
  }

  // Ready Stock
  const name = g("name");
  if (!name) return err(g("sku") || "(no name)", "No name");
  const label = `${name}${g("sku") ? ` · ${g("sku")}` : ""}`;
  if (g("sku")) { const dup = ctx.sku.get(skuKey(g("sku"))); if (dup) return skip(label, dup); }
  const price = numOf("price", "Price");
  if (typeof price === "string") return err(label, price);
  if (!price) return err(label, "No price");
  const cost = numOf("cost", "Cost");
  if (typeof cost === "string") return err(label, cost);
  const qty = numOf("quantity", "Quantity", { int: true });
  if (typeof qty === "string") return err(label, qty);
  const w: Record<string, number | undefined> = {};
  for (const [k, l] of [["gross", "Gross weight"], ["net", "Net weight"], ["dia", "Diamond weight"]] as const) {
    const n = numOf(k, l);
    if (typeof n === "string") return err(label, n);
    w[k] = n || undefined;
  }
  const wp = weightProblem({ gross: w.gross ?? NaN, net: w.net ?? NaN, diamondCt: w.dia ?? NaN });
  if (wp) return err(label, wp);
  if (!g("office")) return err(label, `No office — one of: ${ctx.offices.join(", ")}`);
  const office = ctx.offices.find(o => o.toLowerCase() === g("office").toLowerCase());
  if (!office) return err(label, `No office called “${g("office")}” — one of: ${ctx.offices.join(", ")}`);
  const co = companyOfRow(ctx, g("company"));
  if ("error" in co) return err(label, co.error);
  if (g("sku")) ctx.sku.set(skuKey(g("sku")), `Same design # as row ${row} above`);
  const metal = g("metal") ? canon(g("metal"), listOf("metals", s)) : (listOf("metals", s)[0] ?? "Yellow Gold");
  return {
    kind, row, status: "ok", label, rec: {
      kind: "ready", ...(cost && cost > 0 ? { cost } : {}), v: {
        name, jewelleryType: g("jewelleryType") ? canon(g("jewelleryType"), listOf("jewelleryTypes", s)) : (listOf("jewelleryTypes", s)[0] ?? "Ring"),
        metal, productKarats: metalHasKarats(metal, s) ? (g("karat") ? karatOf(g("karat")) : "22K") : undefined,
        grossWeight: w.gross, netWeight: w.net, diamondWeight: w.dia,
        diamondType: (w.dia ?? 0) > 0 ? (g("diaType") ? canon(g("diaType"), listOf("diamondTypes", s)) : (listOf("diamondTypes", s)[0] ?? "Natural")) : undefined,
        price, quantity: qty == null ? 1 : Math.max(0, Math.round(qty)),
        sku: g("sku") || undefined, location: office, notes: g("notes") || undefined, ...coField(co.id),
      },
    },
  };
}

/** The row's custom-field values (columns "cf:<id>"), checked by kind — a required one empty, or a wrong value, is a row to fix. */
function withCustom(row: PlanRow, val: Record<string, string>, db: DB): PlanRow {
  if (row.status !== "ok" || !row.rec || row.rec.kind === "loose") return row;
  const t = CF_TARGET[row.kind];
  if (!t) return row;
  const cf: CfValues = {};
  for (const d of fieldsFor(db.settings, t, { role: "admin" })) {
    const raw = (val[`cf:${d.id}`] ?? "").trim();
    if (!raw) { if (d.required) return { ...row, status: "error", why: `No ${d.label}` }; continue; }
    if (d.kind === "number") { const n = parseNum(raw); if (n === undefined || !isFinite(n)) return { ...row, status: "error", why: `${d.label}: “${raw}” is not a number` }; cf[d.id] = n; }
    else if (d.kind === "date") { const day = parseDay(raw); if (!day) return { ...row, status: "error", why: `${d.label}: “${raw}” is not a date — write it 2026-04-01` }; cf[d.id] = day; }
    else if (d.kind === "yesno") { const y = cleanValue(d, raw); if (y === undefined) return { ...row, status: "error", why: `${d.label}: write Yes or No` }; cf[d.id] = y; }
    else if (d.kind === "list") { const o = (d.options ?? []).find(x => x.toLowerCase() === raw.toLowerCase()); if (!o) return { ...row, status: "error", why: `${d.label}: “${raw}” is not one of ${(d.options ?? []).join(", ")}` }; cf[d.id] = o; }
    else cf[d.id] = raw;
  }
  return Object.keys(cf).length ? { ...row, rec: { ...row.rec, cf } as ImportRec } : row;
}

/* ── The template ───────────────────────────────────────────────────────── */

export async function downloadImportTemplate(db: DB): Promise<void> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = brandName();
  const defs = sheetDefs(db);
  const brand = (() => { const c = getBrand().color; return c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#1E3A6E"; })();
  const argb = `FF${brand.replace("#", "").toUpperCase()}`;

  // Read me: what goes where.
  const rm = wb.addWorksheet("Read me", { properties: { tabColor: { argb } } });
  rm.columns = [{ width: 26 }, { width: 11 }, { width: 70 }, { width: 24 }];
  let r = 1;
  const put = (vals: (string | undefined)[], opts: { bold?: boolean; size?: number; color?: string; fill?: string } = {}) => {
    const row = rm.getRow(r++);
    vals.forEach((v, i) => { const c = row.getCell(i + 1); c.value = v ?? ""; c.alignment = { wrapText: true, vertical: "top" };
      c.font = { bold: opts.bold, size: opts.size, color: opts.color ? { argb: opts.color } : undefined };
      if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } }; });
  };
  put(["Import from Excel"], { bold: true, size: 16 });
  put(["Fill the sheets you need — leave the others empty. One record a row, under the headings in row 1. Keep the headings as they are."]);
  put(["Then: Settings → Import from Excel → choose this file. Every row is checked and shown before anything is saved."]);
  put(["A record already in the app (the same name, email or phone; the same certificate or design #) is skipped and listed — never added twice."]);
  put(["Stones go in as opening stock: no supplier and no dues. Undo takes the whole import out again, except what has been used since."]);
  r++;
  for (const d of defs) {
    put([d.name], { bold: true, size: 12, color: argb });
    put([d.intro]);
    put(["Column", "Needed", "What to write", "Example"], { bold: true, fill: "FFF1F5F9" });
    for (const c of d.cols) put([c.header, c.req ? "Yes" : "", c.help, c.example]);
    r++;
  }

  // The lists behind the dropdowns, on a hidden sheet.
  const ls = wb.addWorksheet("Lists", { state: "hidden" });
  let listCol = 0;
  const listRange = new Map<string, string>();
  const rangeFor = (list: string[]) => {
    const key = list.join("\u0001");
    if (listRange.has(key)) return listRange.get(key)!;
    listCol++;
    list.forEach((v, i) => { ls.getCell(i + 1, listCol).value = v; });
    const L = ls.getColumn(listCol).letter;
    const ref = `Lists!$${L}$1:$${L}$${Math.max(1, list.length)}`;
    listRange.set(key, ref);
    return ref;
  };

  for (const d of defs) {
    const ws = wb.addWorksheet(d.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = d.cols.map(c => ({ header: c.header + (c.req ? " *" : ""), key: c.key, width: c.width ?? Math.max(14, c.header.length + 4) }));
    const head = ws.getRow(1);
    head.height = 22;
    head.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      cell.alignment = { vertical: "middle" };
    });
    d.cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      if (c.help) cell.note = c.help;
      if (!c.list?.length) return;
      const ref = rangeFor(c.list);
      const L = ws.getColumn(i + 1).letter;
      for (let row = 2; row <= 1001; row++) {
        ws.getCell(`${L}${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [ref], showErrorMessage: true, errorStyle: "warning", errorTitle: c.header, error: "Not one of the list — keep it?" };
      }
    });
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 1, visibility: "visible" }];
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${brandFilePrefix()}-Import-template.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ── Importing ──────────────────────────────────────────────────────────── */

const plural = (n: number, k: ImportKind) => `${n} ${n === 1 ? KIND_NAME[k].one : KIND_NAME[k].many}`;
export const countsText = (c: Partial<Record<ImportKind, number>>) => KINDS.filter(k => (c[k] ?? 0) > 0).map(k => plural(c[k]!, k)).join(", ") || "nothing";

function findRec(d: DB, id: string): ImportRecord | undefined {
  return (d.adminRecords ?? []).find(r => r.id === id && r.kind === "import") as ImportRecord | undefined;
}

export interface ImportResult { batchId: string; counts: Partial<Record<ImportKind, number>>; skippedNow: number; problem?: string }

/**
 * Save the rows that passed — clients and suppliers, certified stones and
 * pieces in parts of 200 (each part one ordinary save, its records and the
 * import record together); loose stones one opening-stock entry each, as the
 * Opening stock form saves them. Stops at the first failure and says how far it got.
 */
export async function runImport(plan: ImportPlan, asOf: string, user: User, progress: (done: number, total: number) => void): Promise<ImportResult> {
  if (plan.blocked) throw new Error(plan.blocked);
  if (user.role !== "admin") throw new Error("Only an admin can import");
  if (!adminStoreReady()) throw new Error("The admin's private records aren't reachable yet — reload and try again");
  const closed = closedWhy(asOf, loadDb().settings);
  if (closed) throw new Error(`Stock as of ${asOf}: ${closed}`);
  const again = sameFileIn(loadDb(), plan.hash);
  if (again) throw new Error("This same file was just imported — undo that import first");
  const ok = plan.rows.filter(r => r.status === "ok" && r.rec);
  if (!ok.length) throw new Error("Nothing to import");

  const batchId = uid("imp_");
  const at = new Date().toISOString();
  const createdAt = stampFor(asOf);
  const batch: ImportBatch = {
    file: plan.file, hash: plan.hash, at, by: user.id, ...(user.name ? { byName: user.name } : {}), asOf, status: "running", counts: {},
    skipped: plan.rows.filter(r => r.status === "skip").length, errors: plan.rows.filter(r => r.status === "error").length,
    ids: { clients: [], suppliers: [], packets: [], ready: [] },
  };
  updateDbAs({ summary: `Import from Excel started — ${plan.file}` }, d => {
    if (!d.adminRecords) d.adminRecords = [];
    d.adminRecords.push({ id: batchId, kind: "import", batch });
  });
  await flush();
  if (!findRec(loadDb(), batchId)) throw new Error("The import couldn't start — the save was refused");

  const counts: Partial<Record<ImportKind, number>> = {};
  let done = 0, skippedNow = 0;
  const total = ok.length;
  const mark = (patch: Partial<ImportBatch>, summary?: string) => {
    const fn = (d: DB) => { const rec = findRec(d, batchId); if (rec) rec.batch = { ...rec.batch, ...patch, counts: { ...counts } }; };
    if (summary) updateDbAs({ summary }, fn); else updateDb(fn);
  };

  try {
    // ── Records: in parts of 200, each part one save with the import record. ──
    const records = ok.filter(r => r.rec!.kind !== "loose");
    for (let i = 0; i < records.length; i += CHUNK) {
      const part = records.slice(i, i + CHUNK);
      const made: { kind: ImportKind; id: string }[] = [];
      const what: Partial<Record<ImportKind, number>> = {};
      updateDbAs({ summary: `Import from Excel — ${plan.file}` }, d => {
        // Checked again on the live records: someone may have added one meanwhile.
        const live = makeContext(d);
        const rec = findRec(d, batchId);
        if (!rec) return;
        for (const row of part) {
          const r = row.rec!;
          if (r.kind === "clients") {
            const v = r.v;
            if (live.clientName.has(nameKey(v.companyName)) || (v.email && live.clientEmail.has(v.email)) || (phoneKey(v.phone) && live.clientPhone.has(phoneKey(v.phone)))) { skippedNow++; continue; }
            const id = uid("c_");
            d.clients.unshift({ ...v, id, accountManagerId: v.accountManagerId ?? user.id, username: "", status: "active", createdAt: new Date().toISOString() } as Client);
            writeValues(d, "clients", id, r.cf, user, user.id, { only: true });
            live.clientName.set(nameKey(v.companyName), "x");
            made.push({ kind: "clients", id });
          } else if (r.kind === "suppliers") {
            const v = r.v;
            if (live.supName.has(nameKey(v.name)) || (certKey(v.gstin).length >= 10 && live.supGst.has(certKey(v.gstin)))) { skippedNow++; continue; }
            const id = uid("sup_");
            d.suppliers.unshift({ ...v, id, active: true, createdAt: new Date().toISOString() });
            writeValues(d, "suppliers", id, r.cf, user, user.id, { only: true });
            live.supName.set(nameKey(v.name), "x");
            made.push({ kind: "suppliers", id });
          } else if (r.kind === "certified") {
            if (live.cert.has(certKey(r.v.certificateNumber))) { skippedNow++; continue; }
            if (!d.diamondPackets) d.diamondPackets = [];
            const id = uid("dp_");
            const clean = Object.fromEntries(Object.entries(r.v).filter(([, x]) => x !== undefined)) as CertRec["v"];
            d.diamondPackets.unshift({ ...clean, id, stockNumber: nextDiamondStockNumber(d), status: "in_stock", createdBy: user.id, createdAt } as DiamondPacket);
            writeValues(d, "packets", id, r.cf, user, user.id, { only: true });
            live.cert.set(certKey(r.v.certificateNumber), "x");
            made.push({ kind: "certified", id });
          } else if (r.kind === "ready") {
            if (r.v.sku && live.sku.has(skuKey(r.v.sku))) { skippedNow++; continue; }
            if (!d.readyStock) d.readyStock = [];
            const id = uid("rs_");
            const now = new Date().toISOString();
            const item = { ...r.v, id, images: [], createdBy: user.id, createdAt: now } as ReadyStockItem;
            for (const k of Object.keys(item) as (keyof ReadyStockItem)[]) if (item[k] === undefined) delete item[k];
            logItem(item, { ...whoOf(user), at: now, kind: "added", text: `Added to Ready Stock at the ${officeLabel(item.location)} — ${item.quantity} piece${item.quantity !== 1 ? "s" : ""} at ${fmtMoney(item.price)} · imported from Excel` });
            d.readyStock.unshift(item);
            if (r.cost) writeStockCost(d, id, r.cost);
            writeValues(d, "readyStock", id, r.cf, user, user.id, { only: true });
            if (r.v.sku) live.sku.set(skuKey(r.v.sku), "x");
            made.push({ kind: "ready", id });
          }
        }
        for (const m of made) what[m.kind] = (what[m.kind] ?? 0) + 1;
        const ids = { ...rec.batch.ids };
        for (const m of made) {
          const key = m.kind === "certified" ? "packets" : m.kind === "ready" ? "ready" : m.kind;
          ids[key as keyof ImportBatch["ids"]] = [...ids[key as keyof ImportBatch["ids"]], m.id];
        }
        const c = { ...rec.batch.counts };
        for (const k of Object.keys(what) as ImportKind[]) c[k] = (c[k] ?? 0) + what[k]!;
        rec.batch = { ...rec.batch, ids, counts: c };
      });
      await flush();
      // The save may have been refused as a whole (the rules, a closed year): then nothing of it is here.
      const live = loadDb();
      const there = made.filter(m => m.kind === "clients" ? live.clients.some(x => x.id === m.id)
        : m.kind === "suppliers" ? live.suppliers.some(x => x.id === m.id)
        : m.kind === "certified" ? (live.diamondPackets ?? []).some(x => x.id === m.id)
        : (live.readyStock ?? []).some(x => x.id === m.id));
      if (there.length < made.length) throw new Error("A save was refused — the records before it are in");
      for (const k of Object.keys(what) as ImportKind[]) counts[k] = (counts[k] ?? 0) + what[k]!;
      done += part.length;
      progress(done, total);
    }

    // ── Loose stones: one opening-stock entry each, into its bag — as the Opening stock form. ──
    const loose = ok.filter(r => r.rec!.kind === "loose");
    for (const row of loose) {
      const r = row.rec as LooseRec;
      await increaseStock({
        material: r.material, companyId: r.companyId, purityOrQuality: r.bucket, quantity: r.qty, refType: "opening", refId: batchId,
        valueInr: r.valueInr, lot: r.lot, pieces: r.pieces, createdBy: user.id, createdAt,
        note: r.note ? `${r.note} · imported from Excel` : `Imported from Excel — ${plan.file}`,
      });
      counts.loose = (counts.loose ?? 0) + 1;
      done++;
      progress(done, total);
      if (counts.loose % 50 === 0) mark({});
    }
    mark({ status: "done" }, `Import from Excel — ${plan.file}: ${countsText(counts)}`);
    await flush();
    return { batchId, counts, skippedNow };
  } catch (e) {
    const problem = e instanceof Error ? e.message : String(e);
    mark({ status: "stopped", problem }, `Import from Excel stopped — ${plan.file}`);
    await flush();
    return { batchId, counts, skippedNow, problem };
  }
}

/* ── Undo ───────────────────────────────────────────────────────────────── */

/** What an undo reads to know whether a record has been used since. */
const UNDO_COLS = ["invoices", "giftCards", "expenses", "clientReceipts", "lockerTransactions", "purchases", "supplierReceipts", "supplierPayments", "supplierSales", "stockMovements", "diamondPackets", "memos", "diamondSales"];

export interface UndoPlan {
  remove: { kind: ImportKind; id: string; label: string }[];
  keep: { what: string; why: string }[];
  moves: StockMovement[];
}

/** The movements an import put into stock. */
const importMoves = (db: DB, batchId: string) => (db.stockMovements ?? []).filter(m => m.refId === batchId && isOpeningMovement(m));

export function planUndo(db: DB, batchId: string): UndoPlan {
  const rec = findRec(db, batchId);
  const out: UndoPlan = { remove: [], keep: [], moves: [] };
  if (!rec) return out;
  const ids = rec.batch.ids;
  for (const id of ids.clients) {
    const c = db.clients.find(x => x.id === id);
    if (!c) continue;
    // The opening balance came with the import — it goes with it.
    // Only what the check reads — never a copy of the whole store (that would read every collection).
    const bare = {
      clients: db.clients.map(x => (x.id === id ? { ...x, openingBalance: undefined } : x)),
      orders: db.orders, memos: db.memos, invoices: db.invoices, clientReceipts: db.clientReceipts,
      giftCards: db.giftCards, expenses: db.expenses, lockerTransactions: db.lockerTransactions,
    } as unknown as DB;
    const why = db.users.some(u => u.clientId === id) ? "Has a login now — deactivate instead" : clientDeleteBlocker(bare, id);
    if (why) out.keep.push({ what: `Client ${c.companyName}`, why }); else out.remove.push({ kind: "clients", id, label: c.companyName });
  }
  for (const id of ids.suppliers) {
    const s = db.suppliers.find(x => x.id === id);
    if (!s) continue;
    const g = supplierDeleteGuard(db, s);
    const broker = (db.brokers ?? []).find(b => (b.supplierIds ?? []).includes(id));
    const why = !g.ok ? g.reason : broker ? `Linked to broker ${broker.name} — take the link off first` : undefined;
    if (why) out.keep.push({ what: `Supplier ${s.name}`, why }); else out.remove.push({ kind: "suppliers", id, label: s.name });
  }
  for (const id of ids.packets) {
    const p = (db.diamondPackets ?? []).find(x => x.id === id);
    if (!p) continue;
    const named = (db.memos ?? []).some(m => m.lines.some(l => l.packetId === id)) || (db.supplierSales ?? []).some(x => x.lines.some(l => l.packetId === id));
    const why = p.status !== "in_stock" ? `Not in stock any more (${p.status})` : named ? "Has been on a memo or a sale since" : closedWhy(p.createdAt, db.settings) ?? undefined;
    const what = `${p.stockNumber ?? "Stone"} · ${p.certificateNumber ?? ""}`;
    if (why) out.keep.push({ what, why }); else out.remove.push({ kind: "certified", id, label: what });
  }
  for (const id of ids.ready) {
    const it = (db.readyStock ?? []).find(x => x.id === id);
    if (!it) continue;
    const named = (db.memos ?? []).some(m => m.lines.some(l => l.readyStockItemId === id)) || (db.supplierSales ?? []).some(x => x.lines.some(l => l.readyStockItemId === id))
      || (db.readyStock ?? []).some(x => x.splitFrom === id);
    const changed = (it.history ?? []).length > 1 ? `Changed since — ${it.history![it.history!.length - 1].text}` : undefined;
    const why = readyStockDeleteBlocker(db, it) ?? (named ? "Has been on a memo, a sale or moved since" : changed);
    if (why) out.keep.push({ what: it.name, why }); else out.remove.push({ kind: "ready", id, label: it.name });
  }
  for (const m of importMoves(db, batchId)) {
    const why = openingRefusal(db, m, null);
    if (why) out.keep.push({ what: `${lotLabel(m.purityOrQuality)} ${m.quantity} ct`, why });
    else out.moves.push(m);
  }
  return out;
}

/** Load what the check reads, then plan. Null (with a message) while records are still loading. */
export async function prepareUndo(batchId: string): Promise<UndoPlan | null> {
  if (!(await recordsReady(UNDO_COLS))) { toast.error(STILL_LOADING); return null; }
  return planUndo(loadDb(), batchId);
}

/** Take an import out: what is unused goes; anything used since stays, listed. */
export async function undoImport(batchId: string, user: User, progress?: (done: number, total: number) => void): Promise<{ removed: number; kept: { what: string; why: string }[] }> {
  if (!(await recordsReady(UNDO_COLS))) throw new Error(STILL_LOADING);
  const first = planUndo(loadDb(), batchId);
  const rec0 = findRec(loadDb(), batchId);
  if (!rec0) throw new Error("That import is no longer on record");
  const kept = [...first.keep];
  let removed = 0;
  const total = first.remove.length + first.moves.length;
  updateDbAs({ summary: `Undo import from Excel — ${rec0.batch.file}` }, d => {
    // Checked again on the live records.
    const again = planUndo(d, batchId);
    const go = new Set(again.remove.map(x => x.id));
    for (const x of first.remove) if (!go.has(x.id)) kept.push({ what: x.label, why: "Used meanwhile" });
    d.clients = d.clients.filter(x => !go.has(x.id));
    d.suppliers = d.suppliers.filter(x => !go.has(x.id));
    d.diamondPackets = (d.diamondPackets ?? []).filter(x => !go.has(x.id));
    d.readyStock = (d.readyStock ?? []).filter(x => !go.has(x.id));
    // A piece's cost, kept apart for the admin, goes with it — and every record's custom fields.
    d.adminRecords = (d.adminRecords ?? []).filter(r => !(r.kind === "stockCost" && go.has(r.itemId)) && !(r.kind === "customValues" && go.has(r.recId)));
    d.customValues = (d.customValues ?? []).filter(x => !go.has(x.recId));
    removed = go.size;
  });
  await flush();
  // Refused as a whole (the rules, a closed year): whatever is still here was not removed.
  {
    const live = loadDb();
    const left = first.remove.filter(x => [live.clients, live.suppliers, live.diamondPackets ?? [], live.readyStock ?? []].some(list => list.some(y => y.id === x.id)));
    const wasKept = new Set(kept.map(k => k.what));
    for (const x of left) if (!wasKept.has(x.label)) { kept.push({ what: x.label, why: "The save was refused — try again" }); removed--; }
  }
  progress?.(removed, total);
  for (const m of first.moves) {
    try { await deleteOpeningStock(loadDb(), m); removed++; }
    catch (e) { kept.push({ what: `${lotLabel(m.purityOrQuality)} ${m.quantity} ct`, why: e instanceof Error ? e.message : String(e) }); }
    progress?.(removed, total);
  }
  updateDbAs({ summary: `Undo import from Excel — ${rec0.batch.file}: ${removed} removed${kept.length ? `, ${kept.length} kept` : ""}` }, d => {
    const rec = findRec(d, batchId);
    if (!rec) return;
    const left = (ids: string[], live: { id: string }[]) => ids.filter(id => live.some(x => x.id === id));
    rec.batch = {
      ...rec.batch, status: kept.length ? "partlyUndone" : "undone",
      ids: { clients: left(rec.batch.ids.clients, d.clients), suppliers: left(rec.batch.ids.suppliers, d.suppliers), packets: left(rec.batch.ids.packets, d.diamondPackets ?? []), ready: left(rec.batch.ids.ready, d.readyStock ?? []) },
      undo: { at: new Date().toISOString(), by: user.id, ...(user.name ? { byName: user.name } : {}), removed: (rec.batch.undo?.removed ?? 0) + removed, kept: kept.slice(0, 200) },
    };
  });
  await flush();
  return { removed, kept };
}

/** "Saving…" only while it can still be running — a tab closed part-way leaves it stopped. */
export function shownStatus(b: ImportBatch): ImportBatch["status"] {
  return b.status === "running" && Date.now() - new Date(b.at).getTime() > 30 * 60_000 ? "stopped" : b.status;
}

/** What is still in from an import, for its row in the list. */
export function stillIn(db: DB, r: ImportRecord): number {
  const b = r.batch;
  return b.ids.clients.filter(id => db.clients.some(x => x.id === id)).length
    + b.ids.suppliers.filter(id => db.suppliers.some(x => x.id === id)).length
    + b.ids.packets.filter(id => (db.diamondPackets ?? []).some(x => x.id === id)).length
    + b.ids.ready.filter(id => (db.readyStock ?? []).some(x => x.id === id)).length
    + importMoves(db, r.id).length;
}
