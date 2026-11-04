// A catalogue file's place in its design — the rules the server files them by
// (functions-specs) and the product page shows them by, in one file. Every
// business names its catalogue its own way, so nothing here is one business's:
// the design numbers' letters are LEARNT from the business's own folders and
// files (learnRules), and the admin can add to or change them (Settings →
// Catalogue reading). Given those rules:
//
//  - which DESIGN a file belongs to, whatever the folders: the nearest folder
//    named as a design ("SRG0034", "SLR-000944A"), else the file's own name
//    ("SRG0053@.jpg" in "New folder" → SRG0053), else — a folder with no design
//    number anywhere ("1.70 TO 4.00 MM" holding 27.jpg + 27.3dm) — the files of
//    that one folder that share a name ("27"); never a category folder ("Rings",
//    "NEW", "SLR"), never a phone's name ("WhatsApp Image 2025…", "IMG_2034");
//  - what the file IS for the design: its spec SHEET (an image or Excel file with
//    the table), a RENDER or photo, a frame of a 360° SPIN, a VIDEO, a CAD file (.3dm, .stl …, staff
//    only), a document, or system junk (Thumbs.db, Office's "~$" lock files, .3dmbak).
//
// Plain functions; the only import is the design-number reader in specParse.

import { designFromName, type Specs } from "./specParse";

export type MediaRole = "sheet" | "render" | "video" | "cad" | "doc" | "junk";

/** How this business names its designs. Learnt from its catalogue; the admin's own words added on top. */
export interface MediaRules {
  /** "auto": a folder named as a design, else the file name · "folder": folders only · "file": file names only */
  designFrom?: "auto" | "folder" | "file";
  /** The letters its design numbers start with (SRG, SLR …). Empty: any letters followed by 3+ digits. */
  prefixes?: string[];
  /** Letters that are never a design, besides the usual ones (IMG, WhatsApp, SPEC …). */
  notDesign?: string[];
  /** Words after a design number that only say which view it is ("REF", "RENDER") — besides the usual ones. */
  viewWords?: string[];
  /** Fewest digits in a design number (3). */
  minDigits?: number;
}

const CAD = /\.(3dm|stl|obj|glb|gltf|step|stp|igs|iges|3ds|fbx|jcd|ma|mb|blend|dwg|dxf|3mf|ply|rhl)$/i;
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store)$|\.(db|ini|tmp|lnk|bak|3dmbak|rhibak)$|^~\$/i;
const DOC = /\.(pdf|xlsx?|xlsm|csv|docx?|txt|zip|rar|7z)$/i;
/** An Excel file the reader can take the table from (exact text — better than any picture). */
export const isSheetFile = (name: string) => /\.xlsx$/i.test(name) && !/^~\$/.test(name.trim());
export const isJunk = (name: string) => JUNK.test(String(name ?? "").trim());

/** Words a phone, a scanner or a person puts before a number that are not a design's letters. */
const NOT_DESIGN = ["IMAGE", "IMG", "VIDEO", "VID", "DSC", "DSCN", "DCIM", "PXL", "MVI", "WA", "PHOTO", "PIC", "SCAN", "SPEC", "SCREENSHOT",
  "AT", "AM", "PM", "MM", "CM", "US", "UK", "CT", "CTS", "KT", "K", "GM", "GMS", "NO", "SIZE", "FILE", "NEW", "OLD", "COPY", "PART", "OPTION", "FINAL", "RENDER", "REF", "CAD", "DCC", "V", "VER",
  // A folder of a month, an order or a kind of piece: "June 2025", "Order 1234", "Rings 2025".
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUNE", "JUL", "JULY", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC", "YEAR", "WEEK", "DAY",
  "ORDER", "ORD", "PO", "INV", "BILL", "SALE", "SALES", "LOT", "STOCK", "ITEM", "ITEMS", "SET", "SETS", "BOX", "PAGE", "MODEL", "TYPE", "NOTE",
  "RING", "RINGS", "BAND", "BANDS", "CHAIN", "BANGL", "STUD", "STUDS", "DROP", "DROPS", "HOOP", "HOOPS"];
/** "Rings 2025", "June 2025": letters, a space, then a year — a folder of a time, never a design. */
const YEAR_FOLDER = /^\s*[A-Za-z]{1,12}[\s_]+(19|20)\d\d\b/;
const VIEW_WORDS = ["REF", "RENDER", "RENDAR", "DCC", "CASTING", "FILE", "CAD", "FINAL", "COPY", "OPTION"];
const up = (xs: string[] | undefined) => (xs ?? []).map(x => x.trim().toUpperCase()).filter(Boolean);

/** A name that IS a design number under these rules (not "Rings", "New folder", "2024", "SLR-01", "WhatsApp Image 2025…"). */
export function isDesignName(name: string | undefined, rules: MediaRules = {}): boolean {
  const d = designFromName(name);
  if (!d) return false;
  const m = /^([A-Z]{1,5})-?(\d+)([A-Z]{0,3})$/.exec(d);
  // "SRG 2025" stays a design only for a business whose designs start SRG.
  if (m && YEAR_FOLDER.test(String(name)) && !up(rules.prefixes).includes(m[1])) return false;
  if (!m || m[2].length < (rules.minDigits ?? 3) || m[2].length > 7) return false;
  if (NOT_DESIGN.includes(m[1]) || up(rules.notDesign).includes(m[1])) return false;
  const pre = up(rules.prefixes);
  return !pre.length || pre.includes(m[1]);
}

/** One key per design, whatever its spelling: "SLR-000944A" = "slr-944a", "SRG400" = "SRG0400". */
export function designKey(designNo: string): string {
  const s = designNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^([A-Z]+)0*(\d+)([A-Z]*)$/.exec(s);
  return m ? `${m[1]}${m[2]}${m[3]}` : s;
}

/** What is left of a file's name once the extension and the view words are gone: "33-REF.jpg" → "33", "GR-01 option2.3dm" → "GR-01". */
export function nameStem(name: string, rules: MediaRules = {}): string {
  let s = String(name ?? "").trim().toUpperCase().replace(/(\.[A-Z0-9]{2,6})+$/, "").replace(/[@()[\]]/g, " ").split(/[\s.]+/).filter(Boolean)[0] ?? "";
  const words = [...VIEW_WORDS, ...up(rules.viewWords)].map(w => w.replace(/[^A-Z0-9]/g, "")).filter(Boolean);
  const tail = new RegExp(`[-_](${words.join("|")})\\d*$`);
  for (let g = 0; g < 4; g++) s = s.replace(tail, "");
  return s;
}
const PHONE = /^(WHATSAPP|IMG|IMAGE|VID|VIDEO|DSC|DSCN|PXL|MVI|PHOTO|SCREENSHOT|SCAN|CAMSCANNER)/;

export interface DesignOf {
  designNo: string;
  key: string;
  /** folder: a folder named as the design · file: the file's own name · group: same-named files of a folder with no design number */
  from: "folder" | "file" | "group";
  folderId?: string;
}

/**
 * The design a file belongs to. `folders` are the file's folder and its parents,
 * nearest first ([] for a file at the top). Always an answer: a file nothing
 * names is grouped with its namesakes in its own folder.
 */
export function designOf(fileName: string, folders: { id: string; name: string }[], rules: MediaRules = {}): DesignOf {
  const from = rules.designFrom ?? "auto";
  if (from !== "file") for (const f of folders) if (isDesignName(f.name, rules)) { const no = designFromName(f.name)!; return { designNo: no, key: designKey(no), from: "folder", folderId: f.id }; }
  if (from !== "folder" && isDesignName(fileName, rules)) { const no = designFromName(fileName)!; return { designNo: no, key: designKey(no), from: "file" }; }
  const here = folders[0];
  const stem = nameStem(fileName, rules);
  // A phone's name says nothing: the folder is the piece ("Daniel" — the client's photos and videos).
  const byFolder = !stem || PHONE.test(stem);
  const label = byFolder ? (here?.name ?? "Loose files") : /^\d+$/.test(stem) && here && nameStem(here.name, rules) !== stem ? `${here.name} · ${stem}` : stem;
  const id = (here?.id ?? "top").replace(/[^A-Za-z0-9_-]/g, "");
  return { designNo: label.trim(), key: `~${id}~${byFolder ? "" : stem.replace(/[^A-Z0-9-]/g, "")}`, from: "group", folderId: here?.id };
}

/**
 * The business's own design letters, learnt from its folder and file names: a
 * prefix counts when at least `min` different design numbers use it (so "SRG"
 * from SRG0001 … SRG0600; never "IMAGE" from one WhatsApp file). Most used first.
 */
export function learnRules(names: string[], min = 3): { prefixes: string[]; counts: Record<string, number> } {
  const seen = new Map<string, Set<string>>();
  for (const n of names) {
    const d = designFromName(n);
    const m = d && /^([A-Z]{1,5})-?(\d{3,7})[A-Z]{0,3}$/.exec(d);
    if (!m || NOT_DESIGN.includes(m[1])) continue;
    (seen.get(m[1]) ?? seen.set(m[1], new Set()).get(m[1])!).add(String(Number(m[2])));
  }
  const counts = Object.fromEntries([...seen].map(([p, s]) => [p, s.size]).filter(([, c]) => (c as number) >= min).sort((a, b) => (b[1] as number) - (a[1] as number)));
  return { prefixes: Object.keys(counts), counts: counts as Record<string, number> };
}

/** What a file is, from its kind, its name, and (for an image or Excel file) whether the reader found a spec table in it. */
export function roleOf(item: { name: string; type: string }, hasTable?: boolean): MediaRole {
  const n = String(item.name ?? "").trim();
  if (JUNK.test(n)) return "junk";
  if (item.type === "video") return "video";
  if (item.type === "file") {
    if (CAD.test(n)) return "cad";
    if (/\.(mp4|mov|webm|m4v)$/i.test(n)) return "video";
    if (DOC.test(n)) return hasTable && isSheetFile(n) ? "sheet" : "doc";
    return "junk";
  }
  return hasTable ? "sheet" : "render";
}

/** A frame of a 360° spin: "…_012", "… (7)", "-03", "360_5", "0004" — the frame's number, or undefined. */
export function spinFrame(name: string): number | undefined {
  const base = String(name ?? "").trim().replace(/(\.[a-z0-9]{2,6})+$/i, "");
  if (/^\d{1,5}$/.test(base)) return Number(base);
  if (/360|spin|turn|rotat|frame/i.test(base)) { const m = /(\d{1,5})\D*$/.exec(base); return m ? Number(m[1]) : undefined; }
  const m = /[_\-\s(](\d{2,5})\)?$/.exec(base);
  return m ? Number(m[1]) : undefined;
}

export interface Arranged { main?: string; sheets: string[]; renders: string[]; spin: string[]; videos: string[]; cad: string[]; docs: string[] }

/**
 * A design's files by role, each list in name order, with its 360° spin worked
 * out: eight or more pictures whose names are frame numbers of one run (…_001 …
 * _036, no frame twice, few gaps) are its spin, in frame order; anything less
 * stays ordinary renders. The main picture is the first render ("SRG0034.jpg"
 * before "SRG0034 B.jpg"), never the sheet unless it is the only picture there is.
 */
export function arrangeDesign(items: { id: string; name: string; role: MediaRole }[]): Arranged {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const pick = (r: MediaRole) => items.filter(i => i.role === r).sort(byName);
  const imgs = pick("render");
  const framed = imgs.map(i => ({ id: i.id, f: spinFrame(i.name) })).filter((x): x is { id: string; f: number } => x.f !== undefined).sort((a, b) => a.f - b.f);
  const frames = framed.map(x => x.f);
  const isRun = framed.length >= 8 && new Set(frames).size === frames.length && frames[frames.length - 1] - frames[0] + 1 <= Math.ceil(frames.length * 1.25);
  const spin = isRun ? framed.map(x => x.id) : [];
  const renders = imgs.filter(i => !spin.includes(i.id)).map(i => i.id);
  const sheets = pick("sheet").map(i => i.id);
  const ids = (r: MediaRole) => pick(r).map(i => i.id);
  return { main: renders[0] ?? spin[0] ?? sheets[0], sheets, renders, spin, videos: ids("video"), cad: ids("cad"), docs: ids("doc") };
}

/* ── What the server keeps (functions-specs), as the app reads it ── */

/** A file's reading: queued → ok / review / noTable, or error; a person's check (checkedBy) is never read over. */
export type ItemSpecs = Omit<Partial<Specs>, "status"> & {
  v: number;
  status: Specs["status"] | "queued" | "error";
  at: string;
  /** The file's address when it was read: replaced → read again. */
  src?: string; sha?: string; via?: "picture" | "excel"; ms?: number; run?: string; error?: string;
  checkedBy?: string; checkedAt?: string;
  /** Read before and waiting to be read again: the old reading stays in use until the new one lands. */
  pending?: boolean; queuedAt?: string;
  /** Reading it again failed — the reading before is kept. */
  lastError?: string;
};
/** The design a file is filed under, and what it is for it. rv: the rules it was filed by. */
export interface ItemDesign { key: string; no: string; from: DesignOf["from"]; role: MediaRole; rv: string }
/** A file as its design keeps it: name, role, kind, folder; a sheet's status, checked, and a fingerprint of its reading. */
export interface DesignEntry { n: string; r: MediaRole; t: string; f?: string; s?: ItemSpecs["status"]; c?: 1; h?: string }
export interface CatalogDesign {
  key: string;
  designNo: string;
  from: DesignOf["from"];
  items: Record<string, DesignEntry>;
  media: Arranged;
  folderIds: string[];
  /** none: no sheet read yet · ok: its details are clean or checked · review: for a person to check */
  status: "ok" | "review" | "none";
  reasons: string[];
  sheetId: string | null;
  specs: ItemSpecs | null;
  counts: { pictures: number; sheets: number; spin: number; videos: number; cad: number; docs: number; files: number };
  /** More files than one design keeps (a folder that isn't really one design): the rest are not listed. */
  full?: boolean;
  updatedAt: string;
}
