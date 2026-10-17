// Renaming a catalog item, or moving it to another folder. Catalog items are
// read and written straight to Firestore, a page at a time — never through the
// shared sync (see catalogItems.ts for why) — so the change goes the same way:
// one field on one document, nothing else touched.
import { doc, updateDoc } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import type { CatalogItem } from "./db";

export async function updateCatalogItem(id: string, patch: Partial<Pick<CatalogItem, "name" | "folderId">>): Promise<void> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(clean).length) return;
  await updateDoc(doc(fsdb, "catalogItems", id), clean);
}

/** "Rings / Bands / 2026" — a folder named by where it sits, for a picker. */
export function folderPath(folders: { id: string; name: string; parentId?: string | null }[], id: string): string {
  const names: string[] = [];
  let cur: string | null | undefined = id;
  for (let guard = 0; cur && guard < 50; guard++) {
    const f = folders.find(x => x.id === cur);
    if (!f) break;
    names.unshift(f.name);
    cur = f.parentId;
  }
  return names.join(" / ");
}
