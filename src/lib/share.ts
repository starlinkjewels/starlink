// Public folder sharing — build a self-contained snapshot of one Catalog or
// Product-Photos folder (its media only) and store it as a `shares/{id}` doc
// that anyone can open via /s/:id without logging in. See firestore.rules.
import { loadDb, updateDb, uid, type Share, type ShareItem, type CatalogFolder } from "./db";
import { fetchCatalogItemsPage } from "./catalogItems";

// Keep the snapshot doc comfortably under Firestore's 1 MB limit (each item is
// just a URL + short name ≈ 300 bytes, so 1500 ≈ ~0.5 MB).
export const MAX_SHARE_ITEMS = 1500;

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

export function shareUrl(id: string): string {
  return `${window.location.origin}/s/${id}`;
}

export function findShare(kind: Share["kind"], folderId: string): Share | undefined {
  return (loadDb().shares ?? []).find(s => s.kind === kind && s.sourceFolderId === folderId);
}

/** Snapshot a Product-Photos folder (and everything nested inside it). Sync. */
export function buildProductPhotoItems(folderId: string): ShareItem[] {
  const db = loadDb();
  const ids = descendantFolderIds(db.productPhotoFolders ?? [], folderId);
  const nameById = new Map((db.productPhotoFolders ?? []).map(f => [f.id, f.name]));
  return (db.productPhotoItems ?? [])
    .filter(i => ids.includes(i.folderId))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, MAX_SHARE_ITEMS)
    .map(i => ({ type: i.type, url: i.url, name: i.name, folder: nameById.get(i.folderId) }));
}

/** Snapshot a Catalog folder (and everything nested). Async — catalog items
 *  live in their own paginated Firestore collection. */
export async function buildCatalogItems(folderId: string): Promise<ShareItem[]> {
  const folders = loadDb().catalogFolders ?? [];
  const ids = descendantFolderIds(folders, folderId);
  const nameById = new Map(folders.map(f => [f.id, f.name]));
  const out: ShareItem[] = [];
  for (const fid of ids) {
    let cursor: Awaited<ReturnType<typeof fetchCatalogItemsPage>>["cursor"] = null;
    do {
      const page = await fetchCatalogItemsPage(fid, cursor);
      for (const it of page.items) {
        out.push({ type: it.type, url: it.data, name: it.name, folder: nameById.get(fid) });
        if (out.length >= MAX_SHARE_ITEMS) return out;
      }
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);
  }
  return out;
}

/** Create a share for this folder, or refresh the existing one. Returns the share. */
export function saveShare(args: {
  kind: Share["kind"];
  sourceFolderId: string;
  title: string;
  items: ShareItem[];
  createdBy: string;
}): Share {
  let result!: Share;
  updateDb(d => {
    if (!d.shares) d.shares = [];
    const now = new Date().toISOString();
    const existing = d.shares.find(s => s.kind === args.kind && s.sourceFolderId === args.sourceFolderId);
    if (existing) {
      existing.title = args.title;
      existing.items = args.items;
      existing.count = args.items.length;
      existing.updatedAt = now;
      result = existing;
    } else {
      const share: Share = {
        id: uid("shr_"), kind: args.kind, sourceFolderId: args.sourceFolderId,
        title: args.title, items: args.items, count: args.items.length,
        createdBy: args.createdBy, createdAt: now, updatedAt: now,
      };
      d.shares.push(share);
      result = share;
    }
  });
  return result;
}

export function deleteShare(id: string): void {
  updateDb(d => { d.shares = (d.shares ?? []).filter(s => s.id !== id); });
}
