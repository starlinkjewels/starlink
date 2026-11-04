// Catalogue reading (Catalog; Settings → Catalogue reading).
//
//   specsOnItem    a catalogue file added, renamed, moved, replaced or deleted:
//                  filed under its design (catalogDesigns), and — a picture or an
//                  Excel sheet just added or replaced — put in the reading queue
//   specsOnFolder  a folder renamed or moved: its files filed again (a "New folder"
//                  renamed "SRG0034" makes them that design's)
//   specsRead      the queue (Cloud Tasks, ten at a time): one file read — its
//                  words (ocr.ts, free, on our server), then what they mean
//                  (shared/specParse.ts) — and the reading kept on the file
//   specsJob       the queue's helpers: one page of the whole catalogue looked
//                  through (reading what was never read), or a folder filed again
//   specsAdmin     read the whole catalogue / pause / read these files again /
//                  learn this business's design numbers
//
//   catalogItems/{id}.specs    the reading of that file (status queued → ok / review / noTable / error);
//                              a person's check (checkedBy) is never read over
//   catalogItems/{id}.design   the design it is filed under, and what it is for it (sheet, render, video, CAD …)
//   catalogDesigns/{key}       a design: its files by role, its best sheet's reading, its status
//   specsSettings/main         read uploads by themselves (auto), the design-number rules (admins)
//   specsState/main            the whole-catalogue reading: running, where it got to (server)
//   specsText/{sha}            the words read off a file, by its content — the same picture twice,
//                              or a new parser, never costs a second reading (server)
import { createHash } from "crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getStorage } from "firebase-admin/storage";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { OWNER_EMAILS, REGION } from "./region";
import { OCR_VERSION, readExcel, readPicture, type OcrText } from "./ocr";
import { better, PARSER_VERSION, parseSpecs, sameDesign, type Specs } from "./shared/specParse";
import { arrangeDesign, designOf, isJunk, isSheetFile, learnRules, roleOf, type DesignEntry, type DesignOf, type ItemDesign, type ItemSpecs, type MediaRole, type MediaRules } from "./shared/catalogMedia";

// Local tests run against the emulators only — never the live database.
if (process.env.FUNCTIONS_EMULATOR === "true" && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("functions-specs: run the Firestore emulator too — local runs must never reach the live database");
}
initializeApp();
const db = getFirestore("diamondflow");
db.settings({ ignoreUndefinedProperties: true });

const DATABASE = "diamondflow";
const ITEMS = "catalogItems", FOLDERS = "catalogFolders", DESIGNS = "catalogDesigns";
const now = () => new Date().toISOString();
const MAX_BYTES = 30 * 1024 * 1024;
const PAGE = 300;

/* ─────────────── Shapes ─────────────── */

type Entry = DesignEntry;
interface Item { name: string; type: string; data: string; folderId?: string; mime?: string; specs?: ItemSpecs; design?: ItemDesign | null }
interface Settings { auto: boolean; readPictures: boolean; readExcel: boolean; rules: MediaRules }
interface State { run?: string; running?: boolean; cursor?: string | null; scanned?: number; queued?: number; filed?: number; startedAt?: string; listedAt?: string; by?: string; retryErrors?: boolean; force?: boolean }

/* ─────────────── Settings (read every 30 s at most) ─────────────── */

let settingsCache: { at: number; s: Settings } | null = null;
async function settings(fresh = false): Promise<Settings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 30_000) return settingsCache.s;
  const d = ((await db.collection("specsSettings").doc("main").get()).data() ?? {}) as Partial<Settings>;
  const r = (d.rules ?? {}) as MediaRules;
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9-]{1,12}$/.test(s)).slice(0, 200) : []);
  const s: Settings = {
    auto: d.auto !== false, readPictures: d.readPictures !== false, readExcel: d.readExcel !== false,
    rules: {
      designFrom: r.designFrom === "folder" || r.designFrom === "file" ? r.designFrom : "auto",
      prefixes: list(r.prefixes), notDesign: list(r.notDesign), viewWords: list(r.viewWords),
      minDigits: Math.min(6, Math.max(2, Math.round(Number(r.minDigits) || 3))),
    },
  };
  settingsCache = { at: Date.now(), s };
  return s;
}
/** The rules' fingerprint: a file filed under other rules is filed again. */
const rulesVersion = (r: MediaRules) => createHash("sha1").update(JSON.stringify(r)).digest("hex").slice(0, 10);

/* ─────────────── Folders (each instance remembers them a minute) ─────────────── */

const folderCache = new Map<string, { name: string; parentId: string | null; at: number }>();
async function folderChain(folderId: string | undefined, fresh = false): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let id = folderId || null;
  for (let guard = 0; id && guard < 40; guard++) {
    let f = folderCache.get(id);
    if (!f || fresh || Date.now() - f.at > 60_000) {
      const d = (await db.collection(FOLDERS).doc(id).get()).data();
      if (!d) break;
      f = { name: String(d.name ?? ""), parentId: (d.parentId as string) || null, at: Date.now() };
      folderCache.set(id, f);
    }
    out.push({ id, name: f.name });
    id = f.parentId;
  }
  return out;
}

/* ─────────────── What a file needs ─────────────── */

const readable = (it: Item, s: Settings) =>
  !isJunk(it.name) && ((it.type === "image" && s.readPictures) || (it.type === "file" && s.readExcel && isSheetFile(it.name)));

type ReadOpt = { force?: boolean; retryErrors?: boolean };
/** Read it (again)? Never over a person's check; again when the parser, or the file, is new. */
function needsRead(it: Item, s: Settings, opt: ReadOpt = {}): boolean {
  if (!readable(it, s) || it.specs?.checkedBy) return false;
  const sp = it.specs;
  if (opt.force || !sp || sp.status === "queued" || sp.pending || sp.v !== PARSER_VERSION || sp.src !== it.data) return true;
  return sp.status === "error" && !!opt.retryErrors;
}
const hasTable = (sp?: ItemSpecs) => !!sp && (sp.status === "ok" || sp.status === "review" || !!sp.checkedBy);
const fingerprint = (sp?: ItemSpecs) => sp ? createHash("sha1").update(JSON.stringify([sp.status, sp.stones, sp.metal, sp.stoneTotals, sp.checkedBy, sp.at])).digest("hex").slice(0, 10) : undefined;
/**
 * The "waiting to be read" mark: a file never read is "queued"; one read before keeps
 * its reading — and its design its details — until the new reading lands.
 */
const queuedMark = (sp?: ItemSpecs): ItemSpecs => (!sp || sp.status === "queued" ? { v: 0, status: "queued", at: now() } : { ...sp, pending: true, queuedAt: now() });
const entryOf = (it: Item, role: MediaRole, sp?: ItemSpecs): Entry => ({
  n: it.name, r: role, t: it.type, ...(it.folderId ? { f: it.folderId } : {}),
  ...(role === "sheet" && sp ? { s: sp.status, h: fingerprint(sp), ...(sp.checkedBy ? { c: 1 as const } : {}) } : {}),
});

/* ─────────────── Filing under designs ─────────────── */

/** A design keeps at most this many files: past it, a folder that isn't really one design stops growing (Firestore's 1 MB a document). */
const MAX_PER_DESIGN = 2000;
interface Plan { id: string; item: Item; read?: ReadOpt }

/**
 * Files these items under their designs. Which design is worked out from the
 * folders and the file's name as given; then, inside that design's transaction,
 * everything else from the file AS IT IS NOW — an older event arriving late
 * (they can) never puts an older state back: a file renamed or moved since is
 * left to its own, newer event, one deleted since is taken out. Each design is
 * changed once, its files' `design` (and their "waiting to be read" mark) in the
 * same transaction. One design failing never stops the others. Returns the
 * files to read.
 */
async function fileMany(list: Plan[], s: Settings, fresh = false): Promise<{ filed: number; toRead: string[]; failed: number }> {
  const rv = rulesVersion(s.rules);
  const adds = new Map<string, { d: DesignOf; plans: Plan[] }>();
  const dels = new Map<string, string[]>();
  const junk: Plan[] = [];
  for (const p of list) {
    const old = p.item.design?.key;
    let key: string | undefined;
    if (isJunk(p.item.name)) junk.push(p);
    else {
      const d = designOf(p.item.name, await folderChain(p.item.folderId, fresh), s.rules);
      const a = adds.get(d.key) ?? { d, plans: [] };
      a.plans.push(p); adds.set(d.key, a);
      key = d.key;
    }
    if (old && old !== key) (dels.get(old) ?? dels.set(old, []).get(old)!).push(p.id);
  }
  let filed = 0, failed = 0;
  const toRead: string[] = [];
  const each = async <T,>(xs: T[], f: (x: T) => Promise<void>) => { for (let i = 0; i < xs.length; i += 8) await Promise.all(xs.slice(i, i + 8).map(f)); };
  await each([...adds.entries()], async ([k, a]) => {
    try { const r = await addToDesign(k, a.d, a.plans, s, rv); filed += r.filed; toRead.push(...r.toRead); }
    catch (e) { failed++; console.error("[specs] filing under", k, (e as Error)?.message); }
  });
  // System files keep no design; then out of their old designs — after the new one
  // is written, so a file is never in neither.
  for (const p of junk) if (p.item.design) await db.collection(ITEMS).doc(p.id).update({ design: FieldValue.delete() }).catch(() => undefined);
  await each([...dels.entries()], async ([k, ids]) => {
    try { await removeFromDesign(k, ids); } catch (e) { failed++; console.error("[specs] taking out of", k, (e as Error)?.message); }
  });
  return { filed, toRead, failed };
}

async function addToDesign(key: string, d: DesignOf, plans: Plan[], s: Settings, rv: string): Promise<{ filed: number; toRead: string[] }> {
  const ref = db.collection(DESIGNS).doc(key);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const docs = await tx.getAll(...plans.map(p => db.collection(ITEMS).doc(p.id)));
    const cur = (snap.data() ?? {}) as { designNo?: string; from?: DesignOf["from"]; items?: Record<string, Entry>; full?: boolean };
    const items = { ...(cur.items ?? {}) };
    let changed = false, full = !!cur.full;
    const writes: { ref: DocumentReference; patch: Record<string, unknown> }[] = [];
    const toRead: string[] = [];
    docs.forEach((x, i) => {
      const p = plans[i];
      if (!x.exists) { if (items[x.id]) { delete items[x.id]; changed = true; } return; }
      const it = x.data() as Item;
      // Renamed or moved since: its own newer event files it.
      if (it.name !== p.item.name || (it.folderId ?? null) !== (p.item.folderId ?? null)) return;
      let sp = it.specs;
      const read = !!p.read && needsRead(it, s, p.read);
      if (read && !(sp?.status === "queued" || sp?.pending)) sp = queuedMark(sp);
      const role = roleOf(it, hasTable(sp));
      const e = entryOf(it, role, sp);
      if (!items[x.id] && Object.keys(items).length >= MAX_PER_DESIGN) full = true;
      else if (JSON.stringify(items[x.id]) !== JSON.stringify(e)) { items[x.id] = e; changed = true; }
      const next: ItemDesign = { key, no: d.designNo, from: d.from, role, rv };
      const patch: Record<string, unknown> = {};
      if (JSON.stringify(it.design ?? null) !== JSON.stringify(next)) patch.design = next;
      if (sp !== it.specs) patch.specs = sp;
      if (Object.keys(patch).length) writes.push({ ref: x.ref, patch });
      if (read) toRead.push(x.id);
    });
    // The design's name: a folder's spelling over a file's ("SLR-000944A", not "SLR000944A.jpg").
    let designNo = cur.designNo, from = cur.from;
    if (!designNo || (from !== "folder" && d.from === "folder")) {
      if (designNo !== d.designNo || from !== d.from) changed = true;
      designNo = d.designNo; from = d.from;
    }
    if (full !== !!cur.full) changed = true;
    if (changed) {
      if (!Object.keys(items).length) { if (snap.exists) tx.delete(ref); }
      else tx.set(ref, { key, designNo, from, items, ...(await derive(tx, key, designNo ?? key, items)), ...(full ? { full: true } : {}), updatedAt: now() });
    }
    for (const w of writes) tx.update(w.ref, w.patch);
    return { filed: writes.length, toRead };
  }, { maxAttempts: 15 });
}

/** Files out of a design: those deleted, or since filed under another (their `design` says so). */
async function removeFromDesign(key: string, ids: string[]): Promise<void> {
  const ref = db.collection(DESIGNS).doc(key);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const docs = await tx.getAll(...ids.map(id => db.collection(ITEMS).doc(id)));
    const cur = snap.data() as { designNo?: string; items?: Record<string, Entry> };
    const items = { ...(cur.items ?? {}) };
    let changed = false;
    for (const x of docs) {
      if (!items[x.id]) continue;
      if (x.exists && (x.get("design.key") as string | undefined) === key) continue;
      delete items[x.id]; changed = true;
    }
    if (!changed) return;
    if (!Object.keys(items).length) tx.delete(ref);
    else tx.set(ref, { ...cur, items, ...(await derive(tx, key, cur.designNo ?? key, items)), updatedAt: now() });
  }, { maxAttempts: 15 });
}

/**
 * What a design's files add up to: its pictures in order (main, renders, 360°
 * spin), and its details from the best of its sheets — a person's check first,
 * then a clean reading, an Excel file over a picture, one whose printed number
 * is the design's own. Two clean sheets that disagree: for a person to check.
 */
async function derive(tx: Transaction, key: string, designNo: string, items: Record<string, Entry>) {
  const list = Object.entries(items).map(([id, e]) => ({ id, name: e.n, role: e.r }));
  const media = arrangeDesign(list);
  const sheetRefs = media.sheets.slice(0, 20).map(id => db.collection(ITEMS).doc(id));
  const sheets = sheetRefs.length ? (await tx.getAll(...sheetRefs)).filter(x => x.exists).map(x => ({ id: x.id, name: String(x.get("name") ?? ""), sp: x.get("specs") as ItemSpecs | undefined })).filter(x => hasTable(x.sp)) : [];
  const score = (x: { sp?: ItemSpecs }) => {
    const sp = x.sp!;
    return (sp.checkedBy ? 1000 : 0) + (sp.status === "ok" ? 100 : 40) + (sp.via === "excel" ? 20 : 0) + (sp.designNoPrinted ? 0 : 5) - (sp.reasons?.length ?? 0) * 2 + (sp.stones?.length ?? 0) * 0.1;
  };
  sheets.sort((a, b) => score(b) - score(a) || String(b.sp!.at).localeCompare(String(a.sp!.at)));
  const best = sheets[0];
  const reasons: string[] = [];
  const sum = (sp: ItemSpecs) => JSON.stringify([sp.stoneTotals ? Math.round(sp.stoneTotals.ct * 100) / 100 : null, Object.entries(sp.metal ?? {}).sort()]);
  if (best) {
    const clean = sheets.filter(x => x.sp!.checkedBy || x.sp!.status === "ok");
    const odd = clean.filter(x => x.id !== best.id && sum(x.sp!) !== sum(best.sp!));
    if (odd.length && !best.sp!.checkedBy) reasons.push(`Its sheets don't agree: ${[best, ...odd].map(x => x.name).slice(0, 4).join(", ")}`);
    if (best.sp!.designNoPrinted && !sameDesign(best.sp!.designNoPrinted, designNo)) reasons.push(`The sheet says ${best.sp!.designNoPrinted}, not ${designNo}`);
  }
  const bs = best?.sp;
  const status = !bs ? "none" : bs.checkedBy ? "ok" : bs.status === "ok" && !reasons.length ? "ok" : "review";
  const specs = bs ? (({ src: _s, sha: _h, run: _r, ...rest }) => rest)(bs) : null;
  const folderIds = [...new Set(Object.values(items).map(e => e.f).filter(Boolean))].slice(0, 50);
  void key;
  return {
    media, folderIds, status, reasons: [...reasons, ...(bs && !bs.checkedBy ? bs.reasons ?? [] : [])].slice(0, 12), sheetId: best?.id ?? null, specs,
    counts: { pictures: media.renders.length + media.spin.length, sheets: media.sheets.length, spin: media.spin.length, videos: media.videos.length, cad: media.cad.length, docs: media.docs.length, files: list.length },
  };
}

/* ─────────────── The queue ─────────────── */

const queue = (fn: "specsRead" | "specsJob") => getFunctions().taskQueue(`locations/${REGION}/functions/${fn}`);
async function enqueueReads(ids: string[], extra: { run?: string; force?: boolean } = {}): Promise<void> {
  const q = queue("specsRead");
  for (let i = 0; i < ids.length; i += 50) {
    await Promise.all(ids.slice(i, i + 50).map(id => q.enqueue({ id, ...extra }, { dispatchDeadlineSeconds: 600 })));
  }
}

/* ─────────────── Triggers ─────────────── */

const sig = (it: Item | null) => it ? JSON.stringify([it.name, it.folderId ?? null, it.type, it.data, it.specs ?? null]) : "";

export const specsOnItem = onDocumentWritten({ document: `${ITEMS}/{id}`, database: DATABASE, region: REGION, memory: "256MiB", maxInstances: 20, timeoutSeconds: 120, retry: false }, async ev => {
  const id = ev.params.id;
  const before = ev.data?.before.exists ? (ev.data.before.data() as Item) : null;
  const after = ev.data?.after.exists ? (ev.data.after.data() as Item) : null;
  try {
    if (!after) { if (before?.design?.key) await removeFromDesign(before.design.key, [id]); return; }
    // Only its name, folder, kind, file or reading matter here — not its preview, nor the design we wrote on it.
    if (before && sig(before) === sig(after)) return;
    const s = await settings();
    const fresh = !before || before.data !== after.data;
    // Folders read as they are now: a folder renamed a moment ago is never filed by its old name.
    const r = await fileMany([{ id, item: after, ...(fresh && s.auto ? { read: {} } : {}) }], s, true);
    if (r.failed) throw new Error("not filed");
    if (r.toRead.length) await enqueueReads(r.toRead);
  } catch (e) {
    // Never lost: done again on the queue, with its own tries.
    console.error("[specsOnItem]", id, (e as Error)?.message);
    await queue("specsJob").enqueue(after ? { kind: "file", id, read: !before || before.data !== after.data } : { kind: "unfile", id, key: before?.design?.key }, { scheduleDelaySeconds: 20 });
  }
});

export const specsOnFolder = onDocumentWritten({ document: `${FOLDERS}/{id}`, database: DATABASE, region: REGION, memory: "256MiB", maxInstances: 5, retry: false }, async ev => {
  const b = ev.data?.before.data(), a = ev.data?.after.data();
  if (!b || !a || (b.name === a.name && (b.parentId ?? null) === (a.parentId ?? null))) return;
  folderCache.delete(ev.params.id);
  // Now, and once more after a minute — past any server that still remembers the old name (its cache lasts a minute).
  await queue("specsJob").enqueue({ kind: "refile", folderId: ev.params.id });
  await queue("specsJob").enqueue({ kind: "refile", folderId: ev.params.id }, { scheduleDelaySeconds: 75 });
});

/* ─────────────── Reading one file ─────────────── */

/**
 * The file itself, straight from this app's own storage — only a catalogue file
 * (catalog/…) in our own bucket, whatever address an item carries: the server
 * never fetches an address from the internet for anyone.
 */
async function download(url: string): Promise<Buffer> {
  const m = /\/b\/([^/]+)\/o\/([^?#]+)/.exec(url);
  const bucket = getStorage().bucket();
  const path = m ? decodeURIComponent(m[2]) : "";
  if (!m || decodeURIComponent(m[1]) !== bucket.name || !path.startsWith("catalog/") || path.includes("..")) throw new Error("not a catalogue file of this app");
  const f = bucket.file(path);
  const [meta] = await f.getMetadata();
  if (Number(meta.size ?? 0) > MAX_BYTES) throw new Error("bigger than 30 MB");
  return (await f.download())[0];
}

/** The words on a file — from the store when this very content was read before. */
async function wordsOf(buf: Buffer, kind: "picture" | "excel"): Promise<{ text: OcrText; sha: string }> {
  const sha = createHash("sha256").update(buf).digest("hex");
  const ref = db.collection("specsText").doc(sha);
  const got = (await ref.get()).data() as (OcrText & { ocr: number }) | undefined;
  if (got && got.ocr === OCR_VERSION) return { text: got, sha };
  const text = kind === "excel" ? await readExcel(buf) : await readPicture(buf);
  const keep = { ...text, page: text.page.slice(0, 200_000), table: text.table?.slice(0, 100_000) };
  await ref.set({ ...keep, ocr: OCR_VERSION, kind, at: now() });
  return { text: keep, sha };
}

function meaning(t: OcrText, ctx: { folderName?: string; fileName?: string }): Specs {
  const a = parseSpecs(t.page, ctx);
  if (!t.table) return a;
  const pick = better(a, parseSpecs(t.table, ctx));
  // The page's sizes and ring size stay from the whole page; the table from whichever read it better.
  return { ...pick, dimsMm: a.dimsMm.length ? a.dimsMm : pick.dimsMm, ...(a.ringSize ?? pick.ringSize ? { ringSize: a.ringSize ?? pick.ringSize } : {}) };
}

/** A reading kept on its file — in a transaction: not if the file was replaced, deleted or checked by a person meanwhile. */
async function keep(ref: DocumentReference, src: string, make: (prev?: ItemSpecs) => ItemSpecs): Promise<void> {
  await db.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data() as Item | undefined;
    if (!cur || cur.data !== src || cur.specs?.checkedBy) return;
    tx.update(ref, { specs: make(cur.specs) });
  });
}

let stateCache: { at: number; st: State } | null = null;
async function state(fresh = false): Promise<State> {
  if (!fresh && stateCache && Date.now() - stateCache.at < 10_000) return stateCache.st;
  const st = ((await db.collection("specsState").doc("main").get()).data() ?? {}) as State;
  stateCache = { at: Date.now(), st };
  return st;
}

export const specsRead = onTaskDispatched<{ id: string; force?: boolean; run?: string }>({
  region: REGION, memory: "2GiB", cpu: 1, concurrency: 1, timeoutSeconds: 300, maxInstances: 10,
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 30, maxBackoffSeconds: 300 },
  rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 5 },
}, async req => {
  const { id, force, run } = req.data ?? ({} as { id: string });
  if (!id) return;
  // A whole-catalogue reading paused or started again: this one waits (still "queued") for the next.
  if (run) {
    let st = await state();
    // A run just started (or paused) is newer than what this server remembers: ask again before passing it by.
    if (!st.running || st.run !== run) st = await state(true);
    if (!st.running || st.run !== run) return;
  }
  const ref = db.collection(ITEMS).doc(id);
  const item = (await ref.get()).data() as Item | undefined;
  if (!item) return;
  const s = await settings();
  if (!needsRead(item, s, { force, retryErrors: true })) return;
  const t0 = Date.now();
  const d = designOf(item.name, await folderChain(item.folderId), s.rules);
  try {
    const kind = item.type === "image" ? "picture" : "excel";
    const { text, sha } = await wordsOf(await download(item.data), kind);
    const sp = meaning(text, { folderName: d.from === "group" ? undefined : d.designNo, fileName: item.name });
    await keep(ref, item.data, () => ({ ...sp, src: item.data, sha, via: kind, ms: Date.now() - t0, at: now(), ...(run ? { run } : {}) }));
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[specsRead]", id, msg);
    // Tried again by the queue; the last time, kept as a reading that failed (Read again tries
    // once more) — or, read before, the earlier reading kept with the failure noted.
    if ((req.retryCount ?? 0) < 2 && !/not a catalogue file|bigger than/.test(msg)) throw e;
    await keep(ref, item.data, prev => {
      if (prev && hasTable(prev)) { const { pending: _p, queuedAt: _q, ...was } = prev; return { ...was, lastError: msg.slice(0, 200), ...(run ? { run } : {}) }; }
      return { v: PARSER_VERSION, status: "error", error: msg.slice(0, 200), src: item.data, at: now(), ...(run ? { run } : {}) };
    }).catch(() => undefined);
  }
});

/* ─────────────── The whole catalogue, a page at a time ─────────────── */

async function pageJob(run: string): Promise<void> {
  const st = await state(true);
  if (!st.running || st.run !== run) return;
  const s = await settings(true);
  const rv = rulesVersion(s.rules);
  let q = db.collection(ITEMS).orderBy(FieldPath.documentId()).limit(PAGE);
  if (st.cursor) q = q.startAfter(st.cursor);
  const snap = await q.get();
  const list = snap.docs.map(d => ({ id: d.id, item: d.data() as Item }));
  const opt: ReadOpt = { force: st.force, retryErrors: st.retryErrors };
  // Filed again only where the rules changed or it was never filed; marked "waiting" where it will be read.
  const toFile = list.filter(x => needsRead(x.item, s, opt) || (!isJunk(x.item.name) && x.item.design?.rv !== rv) || (isJunk(x.item.name) && x.item.design));
  // A design that fails here is filed again by the next run — the page goes on.
  const r = await fileMany(toFile.map(x => ({ ...x, read: opt })), s);
  await enqueueReads(r.toRead, { run, ...(st.force ? { force: true } : {}) });
  const last = snap.docs[snap.docs.length - 1]?.id ?? st.cursor ?? null;
  const more = snap.size === PAGE;
  await db.collection("specsState").doc("main").update({
    cursor: last, scanned: FieldValue.increment(list.length), queued: FieldValue.increment(r.toRead.length), filed: FieldValue.increment(r.filed),
    ...(more ? {} : { listedAt: now() }), updatedAt: now(),
  });
  if (more) await queue("specsJob").enqueue({ kind: "page", run });
}

async function refileFolder(folderId: string): Promise<void> {
  const s = await settings(true);
  const ids = [folderId];
  for (let i = 0; i < ids.length && ids.length < 5000; i++) {
    const kids = await db.collection(FOLDERS).where("parentId", "==", ids[i]).select().get();
    for (const k of kids.docs) ids.push(k.id);
  }
  // These folders read once afresh, then remembered for the rest of this job (not once per file).
  for (const f of ids) folderCache.delete(f);
  for (const f of ids) {
    let cursor: string | null = null;
    for (;;) {
      let q = db.collection(ITEMS).where("folderId", "==", f).orderBy(FieldPath.documentId()).limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      const r = await fileMany(snap.docs.map(d => ({ id: d.id, item: d.data() as Item })), s);
      if (r.failed) throw new Error(`${r.failed} designs not filed`);
      if (snap.size < PAGE) break;
      cursor = snap.docs[snap.docs.length - 1].id;
    }
  }
}

export const specsJob = onTaskDispatched<{ kind: "page" | "refile" | "file" | "unfile"; run?: string; folderId?: string; id?: string; read?: boolean; key?: string }>({
  region: REGION, memory: "512MiB", concurrency: 1, timeoutSeconds: 540, maxInstances: 2,
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 20 },
  rateLimits: { maxConcurrentDispatches: 2 },
}, async req => {
  const d = req.data;
  if (d?.kind === "page" && d.run) await pageJob(d.run);
  else if (d?.kind === "refile" && d.folderId) await refileFolder(d.folderId);
  else if (d?.kind === "unfile" && d.id && d.key) await removeFromDesign(d.key, [d.id]);
  else if (d?.kind === "file" && d.id) {
    // A file whose filing failed on its own event: again, from what it is now.
    const item = (await db.collection(ITEMS).doc(d.id).get()).data() as Item | undefined;
    if (!item) return;
    const s = await settings(true);
    const r = await fileMany([{ id: d.id, item, ...(d.read && s.auto ? { read: {} } : {}) }], s, true);
    if (r.failed) throw new Error("not filed");
    if (r.toRead.length) await enqueueReads(r.toRead);
  }
});

/* ─────────────── An admin's tools ─────────────── */

async function who(auth: { uid: string; token: { email?: string } } | undefined): Promise<{ uid: string; admin: boolean; staff: boolean }> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (OWNER_EMAILS.includes(String(auth.token?.email ?? "").toLowerCase())) return { uid: auth.uid, admin: true, staff: true };
  const idx = (await db.collection("userByAuth").doc(auth.uid).get()).data() as { role?: string; status?: string } | undefined;
  const active = idx?.status === "active";
  return { uid: auth.uid, admin: active && idx?.role === "admin", staff: active && (idx?.role === "admin" || idx?.role === "employee") };
}

type AdminCall =
  | { action: "start"; retryErrors?: boolean; force?: boolean }
  | { action: "pause" }
  | { action: "reread"; ids: string[] }
  | { action: "learn"; rules?: MediaRules };

export const specsAdmin = onCall<AdminCall>({ region: REGION, memory: "512MiB", maxInstances: 3, timeoutSeconds: 300 }, async req => {
  const me = await who(req.auth as never);
  const d = req.data;
  if (d?.action === "reread") {
    // Staff may have a few files read again (a sheet replaced, a reading that failed).
    if (!me.staff) throw new HttpsError("permission-denied", "Only staff can do this.");
    const ids = [...new Set((d.ids ?? []).map(String))].slice(0, 500);
    const s = await settings(true);
    const snaps = ids.length ? await db.getAll(...ids.map(id => db.collection(ITEMS).doc(id))) : [];
    const list = snaps.filter(x => x.exists).map(x => ({ id: x.id, item: x.data() as Item })).filter(x => readable(x.item, s) && !x.item.specs?.checkedBy);
    const r = await fileMany(list.map(x => ({ ...x, read: { force: true } })), s, true);
    await enqueueReads(r.toRead, { force: true });
    return { queued: r.toRead.length, skipped: ids.length - r.toRead.length };
  }
  if (!me.admin) throw new HttpsError("permission-denied", "Only an admin can do this.");
  const ref = db.collection("specsState").doc("main");
  if (d?.action === "start") {
    const run = `r${Date.now().toString(36)}`;
    await ref.set({ run, running: true, cursor: null, scanned: 0, queued: 0, filed: 0, startedAt: now(), listedAt: null, by: me.uid, retryErrors: d.retryErrors !== false, force: !!d.force, updatedAt: now() });
    stateCache = null;
    await queue("specsJob").enqueue({ kind: "page", run });
    return { run };
  }
  if (d?.action === "pause") {
    await ref.set({ running: false, pausedAt: now(), updatedAt: now() }, { merge: true });
    stateCache = null;
    return { paused: true };
  }
  if (d?.action === "learn") {
    // Every folder and file name (names only): the design numbers' letters, and how the files would be grouped.
    const [fs, its] = await Promise.all([db.collection(FOLDERS).select("name", "parentId").get(), db.collection(ITEMS).select("name", "folderId").get()]);
    const folders = new Map(fs.docs.map(x => [x.id, { name: String(x.get("name") ?? ""), parentId: (x.get("parentId") as string) || null }]));
    const names = [...fs.docs.map(x => String(x.get("name") ?? "")), ...its.docs.map(x => String(x.get("name") ?? ""))];
    const learnt = learnRules(names);
    const rules = d.rules ?? (await settings(true)).rules;
    const chain = (id: string | null) => { const out: { id: string; name: string }[] = []; for (let g = 0; id && g < 40; g++) { const f = folders.get(id); if (!f) break; out.push({ id, name: f.name }); id = f.parentId; } return out; };
    const from = { folder: 0, file: 0, group: 0 }; const keys = new Set<string>(); const loose: string[] = [];
    let junk = 0;
    for (const x of its.docs) {
      const name = String(x.get("name") ?? "");
      if (isJunk(name)) { junk++; continue; }
      const ch = chain((x.get("folderId") as string) || null);
      const g = designOf(name, ch, rules);
      from[g.from]++; keys.add(g.key);
      if (g.from === "group" && loose.length < 30) loose.push(`${ch.map(f => f.name).reverse().join(" / ") || "(top)"} / ${name}`);
    }
    return { learnt, preview: { designs: keys.size, ...from, junk, files: its.size, folders: fs.size, loose } };
  }
  throw new HttpsError("invalid-argument", "Unknown action.");
});
