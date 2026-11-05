// Public folder sharing — build a self-contained snapshot of one Catalog or
// Product-Photos folder (its media only) and store it as a `shares/{id}` doc
// that anyone can open via /s/:id without logging in. See firestore.rules.
import { doc, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { loadDb, updateDb, uid, type Share, type ShareItem, type ShareFolder, type CatalogFolder, type SharedOrderProduct } from "./db";
import { fetchCatalogItemsPage } from "./catalogItems";

// A Firestore document is capped at 1 MiB and each item is a URL + short name
// (~350 bytes), so a big folder can't live in one doc. Anything past the first
// page is written to shares/{id}/items/{n} — see saveShare().
export const SHARE_PAGE_SIZE = 800;
export const MAX_SHARE_ITEMS = 20000;

// Where an EXPIRED public share link sends visitors (the company's main site).
export const SHARE_MAIN_SITE = "https://starlinkjewels.com";

/** True when a share has an expiry that is already in the past. */
export function shareIsExpired(s: { expiresAt?: string } | null | undefined): boolean {
  return !!s?.expiresAt && Date.now() > Date.parse(s.expiresAt);
}

/** Set (ISO string) or clear ("" / null) a share's expiry — cheap, no re-snapshot. */
export function updateShareExpiry(id: string, expiresAt: string | null): void {
  updateDb(d => {
    const s = (d.shares ?? []).find(x => x.id === id);
    if (s) { s.expiresAt = expiresAt || ""; s.updatedAt = new Date().toISOString(); }
  });
}

function descendantFolderIds(folders: CatalogFolder[], rootId: string): string[] {
  const out = [rootId];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const f of folders) if ((f.parentId ?? null) === cur) { out.push(f.id); stack.push(f.id); }
  }
  return out;
}

/** Folders in the order set in "Arrange folders" (each folder's `order` among the
 *  ones beside it); never-arranged folders after, in the order they came. The
 *  same rule as the Catalog page, so a shared link shows them as we do. */
export function arrangedFolders<F extends { order?: number }>(folders: F[]): F[] {
  return folders.map((f, i) => ({ f, i })).sort((a, b) => (a.f.order ?? Infinity) - (b.f.order ?? Infinity) || a.i - b.i).map(x => x.f);
}

/** The shared subtree as a flat folder list. The shared folder itself becomes
 *  the root (parentId null) so the public page can render breadcrumbs. */
function subtreeFolders(folders: CatalogFolder[], rootId: string): ShareFolder[] {
  const ids = new Set(descendantFolderIds(folders, rootId));
  return arrangedFolders(folders)
    .filter(f => ids.has(f.id) && f.id !== rootId)
    .map(f => ({
      id: f.id,
      name: f.name,
      parentId: (f.parentId ?? null) === rootId ? null : (f.parentId ?? null),
    }));
}

/**
 * Folders re-arranged after a link was made: every Catalog link puts its folders
 * in the new order too (inside an updateDb) — no new snapshot of the photos, so
 * nothing else in the link changes.
 */
export function reorderSharedFolders(d: { shares?: Share[]; catalogFolders?: CatalogFolder[] }): void {
  const rank = new Map(arrangedFolders(d.catalogFolders ?? []).map((f, i) => [f.id, i]));
  for (const s of d.shares ?? []) {
    if (s.kind !== "catalog" || !s.folders?.length) continue;
    const next = s.folders.map((f, i) => ({ f, i })).sort((a, b) => (rank.get(a.f.id) ?? Infinity) - (rank.get(b.f.id) ?? Infinity) || a.i - b.i).map(x => x.f);
    if (next.some((f, i) => f !== s.folders![i])) s.folders = next;
  }
}

export function shareUrl(id: string): string {
  return `${window.location.origin}/s/${id}`;
}

export function findShare(kind: Share["kind"], folderId: string): Share | undefined {
  return (loadDb().shares ?? []).find(s => s.kind === kind && s.sourceFolderId === folderId);
}

export interface ShareSnapshot { items: ShareItem[]; folders: ShareFolder[] }

/** Snapshot a Product-Photos folder (and everything nested inside it). Sync. */
export function buildProductPhotoItems(folderId: string): ShareSnapshot {
  const db = loadDb();
  const all = db.productPhotoFolders ?? [];
  const ids = descendantFolderIds(all, folderId);
  const nameById = new Map(all.map(f => [f.id, f.name]));
  const items = (db.productPhotoItems ?? [])
    .filter(i => ids.includes(i.folderId))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, MAX_SHARE_ITEMS)
    .map(i => ({
      type: i.type,
      url: i.url,
      ...(i.thumb ? { thumb: i.thumb } : {}), // the small copy for the grid (lib/photoPreview.ts)
      name: i.name,
      folder: nameById.get(i.folderId),
      folderId: i.folderId === folderId ? undefined : i.folderId,
    }));
  return { items, folders: subtreeFolders(all, folderId) };
}

/** Snapshot a Catalog folder (and everything nested). Async — catalog items
 *  live in their own paginated Firestore collection. */
export async function buildCatalogItems(folderId: string): Promise<ShareSnapshot> {
  const folders = loadDb().catalogFolders ?? [];
  const ids = descendantFolderIds(folders, folderId);
  const nameById = new Map(folders.map(f => [f.id, f.name]));
  const out: ShareItem[] = [];
  for (const fid of ids) {
    let cursor: Awaited<ReturnType<typeof fetchCatalogItemsPage>>["cursor"] = null;
    do {
      const page = await fetchCatalogItemsPage(fid, cursor);
      for (const it of page.items) {
        out.push({
          type: it.type,
          url: it.data,
          ...(it.thumb ? { thumb: it.thumb } : {}), // the small copy for the grid (lib/photoPreview.ts)
          name: it.name,
          folder: nameById.get(fid),
          folderId: fid === folderId ? undefined : fid,
        });
        if (out.length >= MAX_SHARE_ITEMS) return { items: out, folders: subtreeFolders(folders, folderId) };
      }
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);
  }
  return { items: out, folders: subtreeFolders(folders, folderId) };
}

const pageRef = (shareId: string, n: number) => doc(fsdb, "shares", shareId, "items", String(n));

/** Read every item of a share, following its extra pages. Used by the public
 *  viewer, which has no login and only its own share doc to go on. */
export async function loadShareItems(share: Share): Promise<ShareItem[]> {
  // All the pages asked for together (they used to come one after another), kept in order.
  const pages = await Promise.all(Array.from({ length: share.pageCount ?? 0 }, (_, n) => getDoc(pageRef(share.id, n))));
  return [...(share.items ?? []), ...pages.flatMap(snap => (snap.exists() ? (snap.data() as { items?: ShareItem[] }).items ?? [] : []))];
}

/**
 * Create a share for this folder, or refresh the existing one.
 *
 * The first page of items rides along inside the share doc; the rest go to
 * shares/{id}/items/{n}. A folder of several thousand photos blows straight
 * past Firestore's 1 MiB document limit otherwise — and because `shares` is
 * synced by the db engine, one oversized share doc would fail the whole batch
 * it travels in.
 */
export async function saveShare(args: {
  kind: Share["kind"];
  sourceFolderId: string;
  title: string;
  items: ShareItem[];
  folders: ShareFolder[];
  createdBy: string;
}): Promise<Share> {
  const now = new Date().toISOString();
  const existing = findShare(args.kind, args.sourceFolderId);
  const id = existing?.id ?? uid("shr_");

  const inline = args.items.slice(0, SHARE_PAGE_SIZE);
  const rest: ShareItem[][] = [];
  for (let i = SHARE_PAGE_SIZE; i < args.items.length; i += SHARE_PAGE_SIZE) {
    rest.push(args.items.slice(i, i + SHARE_PAGE_SIZE));
  }

  // Pages first: if one of these fails, the share doc still points at the
  // snapshot it had before rather than at pages that were never written.
  for (let n = 0; n < rest.length; n++) {
    // Without its empty fields (an item of the shared folder itself has folderId
    // undefined) — Firestore refuses a page that carries one.
    await setDoc(pageRef(id, n), { items: JSON.parse(JSON.stringify(rest[n])) as ShareItem[] });
  }
  // A refresh that shrank the folder leaves orphan pages behind — drop them, or
  // the viewer would keep showing deleted media.
  for (let n = rest.length; n < (existing?.pageCount ?? 0); n++) {
    await deleteDoc(pageRef(id, n)).catch(() => {});
  }

  let result!: Share;
  updateDb(d => {
    if (!d.shares) d.shares = [];
    const cur = d.shares.find(s => s.id === id);
    if (cur) {
      cur.title = args.title;
      cur.items = inline;
      cur.folders = args.folders;
      cur.pageCount = rest.length;
      cur.count = args.items.length;
      cur.updatedAt = now;
      result = cur;
    } else {
      const share: Share = {
        id, kind: args.kind, sourceFolderId: args.sourceFolderId,
        title: args.title, items: inline, folders: args.folders,
        pageCount: rest.length, count: args.items.length,
        createdBy: args.createdBy, createdAt: now, updatedAt: now,
      };
      d.shares.push(share);
      result = share;
    }
  });
  return result;
}

/**
 * One catalogue design's product page as a link (Catalog → a design → Share):
 * its pictures kept with the link (the preview and the first view), its details,
 * options and — when shared with one — its price worked out on the server each
 * time it is opened (functions-specs specsShare), never the costs behind it.
 * One link per design: sharing it again updates it.
 */
export function saveDesignShare(args: { designKey: string; title: string; items: ShareItem[]; showPrice: boolean; priceFor?: string; ccy: "INR" | "USD"; note?: string; createdBy: string }): Share {
  const now = new Date().toISOString();
  let result!: Share;
  updateDb(d => {
    if (!d.shares) d.shares = [];
    const cur = d.shares.find(s => s.kind === "design" && s.designKey === args.designKey);
    const fields = {
      title: args.title, items: args.items.slice(0, SHARE_PAGE_SIZE), count: args.items.length, showPrice: args.showPrice, ccy: args.ccy,
      ...(args.priceFor ? { priceFor: args.priceFor } : {}), ...(args.note ? { note: args.note } : {}), updatedAt: now,
    };
    if (cur) {
      Object.assign(cur, fields);
      if (!args.priceFor) delete cur.priceFor;
      if (!args.note) delete cur.note;
      result = cur;
    } else {
      const share: Share = { id: uid("shr_"), kind: "design", sourceFolderId: "", designKey: args.designKey, folders: [], pageCount: 0, createdBy: args.createdBy, createdAt: now, ...fields };
      d.shares.push(share);
      result = share;
    }
  });
  return result;
}
export const findDesignShare = (designKey: string) => (loadDb().shares ?? []).find(s => s.kind === "design" && s.designKey === designKey);

/**
 * A piece made on orders (Design Studio → By Order → a design), or every piece of a
 * category, as a link: the same product page as a catalogue design's — the piece's
 * details (its metal's grams, its stones) kept on the link and priced on the server
 * each time it is opened (functions-specs specsShare). Nothing of its orders, client,
 * labour or costs is on it. One link per piece and per category: sharing again updates it.
 */
export function saveOrderShare(args: {
  kind: "orderDesign" | "orderCategory"; key: string; title: string; items: ShareItem[];
  product?: SharedOrderProduct; products?: SharedOrderProduct[];
  showPrice: boolean; priceFor?: string; ccy: "INR" | "USD"; note?: string; createdBy: string;
}): Share {
  const now = new Date().toISOString();
  // Plain data only (no undefined) — as it is written.
  const clean = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  let result!: Share;
  updateDb(d => {
    if (!d.shares) d.shares = [];
    const cur = d.shares.find(s => s.kind === args.kind && s.designKey === args.key);
    const fields = {
      title: args.title, items: clean(args.items.slice(0, SHARE_PAGE_SIZE)), count: args.items.length, showPrice: args.showPrice, ccy: args.ccy,
      ...(args.product ? { product: clean(args.product) } : {}), ...(args.products ? { products: clean(args.products) } : {}),
      ...(args.priceFor ? { priceFor: args.priceFor } : {}), ...(args.note ? { note: args.note } : {}), updatedAt: now,
    };
    if (cur) {
      Object.assign(cur, fields);
      if (!args.priceFor) delete cur.priceFor;
      if (!args.note) delete cur.note;
      result = cur;
    } else {
      const share: Share = { id: uid("shr_"), kind: args.kind, sourceFolderId: "", designKey: args.key, folders: [], pageCount: 0, createdBy: args.createdBy, createdAt: now, ...fields };
      d.shares.push(share);
      result = share;
    }
  });
  return result;
}
export const findOrderShare = (kind: "orderDesign" | "orderCategory", key: string) => (loadDb().shares ?? []).find(s => s.kind === kind && s.designKey === key);

export async function deleteShare(id: string, pageCount = 0): Promise<void> {
  for (let n = 0; n < pageCount; n++) await deleteDoc(pageRef(id, n)).catch(() => {});
  updateDb(d => { d.shares = (d.shares ?? []).filter(s => s.id !== id); });
}
