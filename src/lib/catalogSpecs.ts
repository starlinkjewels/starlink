// Catalogue reading — the app's side (the server is functions-specs/). Each
// picture or Excel sheet put in the Catalog is read on the server (free OCR, no
// paid AI), and every file is filed under its design (catalogDesigns). Here: a
// design and its details, a person's check of a reading, what still needs
// checking, the settings and the whole-catalogue reading's progress.
import { useEffect, useState } from "react";
import { collection, deleteField, doc, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, setDoc, startAfter, updateDoc, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "./firebase";
import { PARSER_VERSION, type Specs, type StoneRow } from "./pure/specParse";
import type { CatalogDesign, ItemSpecs, MediaRules } from "./pure/catalogMedia";

export type { CatalogDesign, ItemSpecs };

/** A design, live (null: none filed under that key yet). */
export function useDesign(key: string | undefined): CatalogDesign | null | undefined {
  const [d, set] = useState<CatalogDesign | null | undefined>(undefined);
  useEffect(() => {
    if (!key) { set(null); return; }
    set(undefined);
    return onSnapshot(doc(fsdb, "catalogDesigns", key), x => set(x.exists() ? (x.data() as CatalogDesign) : null), () => set(null));
  }, [key]);
  return d;
}

/** One file's reading, live — a sheet being read turns from "Reading…" to its details as it happens. */
export function useItemSpecs(id: string | undefined): ItemSpecs | null | undefined {
  const [s, set] = useState<ItemSpecs | null | undefined>(undefined);
  useEffect(() => {
    if (!id) { set(null); return; }
    return onSnapshot(doc(fsdb, "catalogItems", id), x => set((x.get("specs") as ItemSpecs | undefined) ?? null), () => set(null));
  }, [id]);
  return s;
}

/** What a person entered or confirmed for a sheet: kept as the reading, and never read over by the server. */
export async function saveCheckedSpecs(itemId: string, s: Pick<Specs, "stones" | "metal" | "dimsMm"> & Partial<Pick<Specs, "ringSize" | "stoneTotals" | "metalTone" | "subCategory" | "designNo">>, by: string, base?: ItemSpecs | null): Promise<void> {
  const stones: StoneRow[] = s.stones.filter(r => r.pcs > 0 || r.total > 0).map(r => JSON.parse(JSON.stringify(r)));
  const sumPcs = stones.reduce((a, r) => a + r.pcs, 0), sumCt = Math.round(stones.reduce((a, r) => a + r.total, 0) * 1000) / 1000;
  const at = new Date().toISOString();
  const next: ItemSpecs = JSON.parse(JSON.stringify({
    ...(base ?? {}), v: PARSER_VERSION, status: "ok", at, stones, metal: s.metal, dimsMm: s.dimsMm,
    stoneTotals: stones.length ? { pcs: sumPcs, ct: sumCt } : undefined, ringSize: s.ringSize || undefined, metalTone: s.metalTone || undefined,
    subCategory: s.subCategory || undefined, designNo: s.designNo || base?.designNo, reasons: [], checkedBy: by, checkedAt: at, error: undefined,
  }));
  await updateDoc(doc(fsdb, "catalogItems", itemId), { specs: next });
}

/** A person's check taken off: the server reads the file again. */
export async function uncheckSpecs(itemId: string): Promise<void> {
  await updateDoc(doc(fsdb, "catalogItems", itemId), { "specs.checkedBy": deleteField(), "specs.checkedAt": deleteField() });
  await rereadFiles([itemId]);
}

export interface DesignPage { rows: CatalogDesign[]; cursor: QueryDocumentSnapshot<DocumentData> | null; more: boolean }
/** Designs to check, newest change first, a page at a time. */
export async function fetchDesignsToCheck(cursor: QueryDocumentSnapshot<DocumentData> | null, n = 30): Promise<DesignPage> {
  const snap = await getDocs(query(collection(fsdb, "catalogDesigns"), where("status", "==", "review"), orderBy("updatedAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(n)));
  return { rows: snap.docs.map(d => d.data() as CatalogDesign), cursor: snap.docs[snap.docs.length - 1] ?? null, more: snap.size === n };
}

/* ── Settings and the whole-catalogue reading (admins) ── */

export interface SpecsSettings { auto: boolean; readPictures: boolean; readExcel: boolean; rules: MediaRules; updatedAt?: string; updatedBy?: string }
export const DEFAULT_SPECS_SETTINGS: SpecsSettings = { auto: true, readPictures: true, readExcel: true, rules: { designFrom: "auto", prefixes: [], notDesign: [], viewWords: [], minDigits: 3 } };

export function useSpecsSettings(): SpecsSettings | undefined {
  const [s, set] = useState<SpecsSettings | undefined>(undefined);
  useEffect(() => onSnapshot(doc(fsdb, "specsSettings", "main"), d => {
    const x = (d.data() ?? {}) as Partial<SpecsSettings>;
    set({ ...DEFAULT_SPECS_SETTINGS, ...x, rules: { ...DEFAULT_SPECS_SETTINGS.rules, ...(x.rules ?? {}) } });
  }, () => set(DEFAULT_SPECS_SETTINGS)), []);
  return s;
}
export async function saveSpecsSettings(s: SpecsSettings, by: string): Promise<void> {
  await setDoc(doc(fsdb, "specsSettings", "main"), JSON.parse(JSON.stringify({ ...s, updatedAt: new Date().toISOString(), updatedBy: by })));
}

export interface SpecsState { run?: string; running?: boolean; scanned?: number; queued?: number; filed?: number; startedAt?: string; listedAt?: string | null; pausedAt?: string; updatedAt?: string }
export function useSpecsState(on = true): SpecsState | null {
  const [s, set] = useState<SpecsState | null>(null);
  useEffect(() => { if (on) return onSnapshot(doc(fsdb, "specsState", "main"), d => set((d.data() as SpecsState) ?? {}), () => set(null)); }, [on]);
  return s;
}

export interface SpecsCounts { pictures: number; queued: number; ok: number; review: number; noTable: number; error: number; checked: number; doneThisRun: number; designs: number; designsReview: number; designsOk: number }
/** Counted on the server (a count costs one read per thousand files, nothing is loaded). */
export async function specsCounts(run?: string): Promise<SpecsCounts> {
  const items = collection(fsdb, "catalogItems"), designs = collection(fsdb, "catalogDesigns");
  const c = async (q: ReturnType<typeof query>) => (await getCountFromServer(q)).data().count;
  const st = (s: string) => c(query(items, where("specs.status", "==", s)));
  const [pictures, queuedNew, pending, ok, review, noTable, error, checked, doneThisRun, all, dReview, dOk] = await Promise.all([
    c(query(items, where("type", "==", "image"))), st("queued"), c(query(items, where("specs.pending", "==", true))), st("ok"), st("review"), st("noTable"), st("error"),
    c(query(items, where("specs.checkedBy", ">", ""))), run ? c(query(items, where("specs.run", "==", run))) : Promise.resolve(0),
    c(query(designs)), c(query(designs, where("status", "==", "review"))), c(query(designs, where("status", "==", "ok"))),
  ]);
  // Waiting: never read yet, and read before but waiting to be read again.
  return { pictures, queued: queuedNew + pending, ok, review, noTable, error, checked, doneThisRun, designs: all, designsReview: dReview, designsOk: dOk };
}

type Call = { action: "start"; retryErrors?: boolean; force?: boolean } | { action: "pause" } | { action: "reread"; ids: string[] } | { action: "learn"; rules?: MediaRules };
const call = <T,>(d: Call) => httpsCallable<Call, T>(functions, "specsAdmin", { timeout: 300_000 })(d).then(r => r.data);
export const startReading = (o: { retryErrors?: boolean; force?: boolean } = {}) => call<{ run: string }>({ action: "start", ...o });
export const pauseReading = () => call<{ paused: boolean }>({ action: "pause" });
export const rereadFiles = (ids: string[]) => call<{ queued: number; skipped: number }>({ action: "reread", ids });
export interface Learnt { learnt: { prefixes: string[]; counts: Record<string, number> }; preview: { designs: number; folder: number; file: number; group: number; junk: number; files: number; folders: number; loose: string[] } }
export const learnCatalog = (rules?: MediaRules) => call<Learnt>({ action: "learn", ...(rules ? { rules } : {}) });

/* ── Words ── */

export const SPECS_STATUS: Record<ItemSpecs["status"] | "none", { label: string; tone: "green" | "amber" | "blue" | "neutral" | "red" }> = {
  ok: { label: "Details read", tone: "green" },
  review: { label: "Please check", tone: "amber" },
  noTable: { label: "No table", tone: "neutral" },
  queued: { label: "Reading…", tone: "blue" },
  error: { label: "Couldn't read", tone: "red" },
  none: { label: "No details yet", tone: "neutral" },
};
/** "10K", "14K", "PLT", "SILVER" → how a person says it. */
export const metalLabel = (k: string) => (k === "PLT" ? "Platinum" : k === "SILVER" ? "Silver" : `${k} gold`);
export const METAL_ORDER = ["SILVER", "9K", "10K", "14K", "18K", "22K", "24K", "PLT"];
export const sortMetal = (m: Record<string, number> = {}) => Object.entries(m).sort((a, b) => METAL_ORDER.indexOf(a[0]) - METAL_ORDER.indexOf(b[0]));
