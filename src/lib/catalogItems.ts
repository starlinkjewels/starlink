// Direct Firestore access for catalog items — deliberately NOT part of the
// shared db.ts sync engine (see subscribeAll/persist). That engine diffs a
// full in-memory mirror of each collection against Firestore and deletes
// anything missing from memory; a folder can hold thousands of items, so
// only ever loading one page at a time here would make persist() think every
// item outside the loaded page had been deleted, and wipe them from
// Firestore on the next sync. Catalog items are paginated on purpose, so
// they get their own direct reads/writes instead.
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  documentId,
  getCountFromServer,
  type QueryDocumentSnapshot,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { db as fsdb } from "./firebase";
import type { CatalogItem } from "./db";

const COL = "catalogItems";
export const CATALOG_PAGE_SIZE = 60;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function deleteRefsInBatches(refs: DocumentReference[]): Promise<void> {
  for (const c of chunk(refs, 400)) {
    // writeBatch caps at 500 ops
    const batch = writeBatch(fsdb);
    c.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export interface CatalogPage {
  items: CatalogItem[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/** One page of a folder's items, newest first. Pass the previous page's cursor to get the next page. */
export async function fetchCatalogItemsPage(
  folderId: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<CatalogPage> {
  const q = query(
    collection(fsdb, COL),
    where("folderId", "==", folderId),
    orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(CATALOG_PAGE_SIZE),
  );
  const snap = await getDocs(q);
  return {
    items: snap.docs.map((d) => d.data() as CatalogItem),
    cursor: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === CATALOG_PAGE_SIZE,
  };
}

/** Exact item count across one or more folder ids (e.g. a folder + its descendants) — cheap at any scale. */
export async function countCatalogItems(folderIds: string[]): Promise<number> {
  if (!folderIds.length) return 0;
  let total = 0;
  for (const c of chunk(folderIds, 30)) {
    const snap = await getCountFromServer(query(collection(fsdb, COL), where("folderId", "in", c)));
    total += snap.data().count;
  }
  return total;
}

/** First image-type item found across the given folder ids, for a folder-card thumbnail. */
export async function findFolderThumbnail(folderIds: string[]): Promise<CatalogItem | null> {
  for (const c of chunk(folderIds, 30)) {
    const snap = await getDocs(
      query(
        collection(fsdb, COL),
        where("folderId", "in", c),
        where("type", "==", "image"),
        limit(1),
      ),
    );
    if (!snap.empty) return snap.docs[0].data() as CatalogItem;
  }
  return null;
}

/** Batch-fetch items by id (for the Favourites view). */
export async function fetchCatalogItemsByIds(ids: string[]): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  for (const c of chunk(ids, 30)) {
    if (!c.length) continue;
    const snap = await getDocs(query(collection(fsdb, COL), where(documentId(), "in", c)));
    out.push(...snap.docs.map((d) => d.data() as CatalogItem));
  }
  return out;
}

export async function createCatalogItem(item: CatalogItem): Promise<void> {
  await setDoc(doc(fsdb, COL, item.id), item);
}

export async function deleteCatalogItem(id: string): Promise<void> {
  await deleteDoc(doc(fsdb, COL, id));
}

/** Cascade-delete every item in the given folder ids (used when a folder is deleted). Returns the deleted item ids, so the caller can clean up any favourites pointing at them. */
export async function deleteCatalogItemsInFolders(folderIds: string[]): Promise<string[]> {
  if (!folderIds.length) return [];
  const deletedIds: string[] = [];
  for (const c of chunk(folderIds, 30)) {
    const snap = await getDocs(query(collection(fsdb, COL), where("folderId", "in", c)));
    deletedIds.push(...snap.docs.map((d) => d.id));
    await deleteRefsInBatches(snap.docs.map((d) => d.ref));
  }
  return deletedIds;
}

/** Full wipe — used only by the admin "reset database" action in Settings. */
export async function deleteAllCatalogItems(): Promise<void> {
  const snap = await getDocs(collection(fsdb, COL));
  await deleteRefsInBatches(snap.docs.map((d) => d.ref));
}
