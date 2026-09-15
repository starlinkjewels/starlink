// Public folder sharing — build a self-contained snapshot of one Catalog or
// Product-Photos folder (its media only) and store it as a `shares/{id}` doc
// that anyone can open via /s/:id without logging in. See firestore.rules.
import { doc, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { loadDb, updateDb, uid, type Share, type ShareItem, type ShareFolder, type CatalogFolder } from "./db";
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

/** The shared subtree as a flat folder list. The shared folder itself becomes
 *  the root (parentId null) so the public page can render breadcrumbs. */
function subtreeFolders(folders: CatalogFolder[], rootId: string): ShareFolder[] {
  const ids = new Set(descendantFolderIds(folders, rootId));
  return folders
    .filter(f => ids.has(f.id) && f.id !== rootId)
    .map(f => ({
      id: f.id,
      name: f.name,
      parentId: (f.parentId ?? null) === rootId ? null : (f.parentId ?? null),
    }));
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
  const out = [...(share.items ?? [])];
  for (let n = 0; n < (share.pageCount ?? 0); n++) {
    const snap = await getDoc(pageRef(share.id, n));
    if (snap.exists()) out.push(...((snap.data() as { items?: ShareItem[] }).items ?? []));
  }
  return out;
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
    await setDoc(pageRef(id, n), { items: rest[n] });
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

export async function deleteShare(id: string, pageCount = 0): Promise<void> {
  for (let n = 0; n < pageCount; n++) await deleteDoc(pageRef(id, n)).catch(() => {});
  updateDb(d => { d.shares = (d.shares ?? []).filter(s => s.id !== id); });
}
