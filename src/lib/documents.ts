// Documents — reading and writing the folders, files and share links of the
// Documents page (the shapes are in lib/documentsModel.ts).
//
// Written straight to Firestore, NOT through the app's synced store (db.ts):
// that engine mirrors whole collections and would treat anything it hasn't
// loaded as deleted. These three collections are small (a business's own
// papers, not thousands of photos), so each is watched whole and filtered in
// memory — the same direct way lib/catalogItems.ts handles catalog items.
//
// Storage only ever GAINS files here. A file goes to documents/<itemId>/<name>
// (a photo's small preview beside it, in documents/<itemId>/thumbs/); "Move to
// Trash" only marks the record, and "Delete forever" removes the RECORD — the
// file itself is never removed from Storage (the owner's rule).
import { useEffect, useState } from "react";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, writeBatch, deleteField,
  type DocumentReference,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db as fsdb, storage } from "./firebase";
import { uid, logEvent } from "./db";
import { makePreview } from "./photoPreview";
import { uploadDataUrl } from "./storage";
import { ensureFileClaims } from "./fileClaims";
import {
  DOC_FOLDERS, DOC_ITEMS, DOC_SHARES, hashSharePassword, SHARE_PASSWORD_MIN,
  type DocFolder, type DocItem, type DocKind, type DocShare,
} from "./documentsModel";

const now = () => new Date().toISOString();

/** Firestore refuses a whole document over one `undefined` field — leave the empty ones out. */
function clean<T extends object>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Who may use the Documents page: an admin, or an employee an admin has let in
 *  (User.documentsAccess — the same rule the database applies, canDocs()). */
export function canUseDocuments(user: { role: string; documentsAccess?: boolean } | null | undefined): boolean {
  return !!user && (user.role === "admin" || (user.role === "employee" && user.documentsAccess === true));
}

/* ─────────────── Watching ─────────────── */

export interface Live<T> {
  rows: T[];
  loading: boolean;
  /** Why it couldn't be read ("permission-denied"…), when it couldn't. */
  error: string | null;
}

/** One whole collection, kept up to date while the page is open. */
function useLive<T extends { id: string }>(col: string): Live<T> {
  const [state, setState] = useState<Live<T>>({ rows: [], loading: true, error: null });
  useEffect(() => {
    const stop = onSnapshot(
      collection(fsdb, col),
      snap => setState({ rows: snap.docs.map(d => ({ ...(d.data() as T), id: d.id })), loading: false, error: null }),
      err => {
        console.warn(`[documents] ${col}:`, err.code || err.message);
        setState(s => ({ ...s, loading: false, error: err.code || err.message }));
      },
    );
    return stop;
  }, [col]);
  return state;
}

/** Every folder, Trash included (each says whether it is in the Trash). */
export const useDocFolders = () => useLive<DocFolder>(DOC_FOLDERS);
/** Every document, Trash included. */
export const useDocItems = () => useLive<DocItem>(DOC_ITEMS);
/** Every share link. */
export const useDocShares = () => useLive<DocShare>(DOC_SHARES);

/* ─────────────── Folders ─────────────── */

/** A folder and every folder under it, by id. */
export function folderAndBelow(folders: DocFolder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** The folders from the top down to this one (this one last). */
export function folderTrail(folders: DocFolder[], id: string | null): DocFolder[] {
  const by = new Map(folders.map(f => [f.id, f]));
  const out: DocFolder[] = [];
  const seen = new Set<string>();
  let cur = id ? by.get(id) : undefined;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = cur.parentId ? by.get(cur.parentId) : undefined; }
  return out;
}

/** "Agreements › 2026" — a folder's full place, for pickers. */
export function folderLabel(folders: DocFolder[], id: string | null): string {
  return id ? folderTrail(folders, id).map(f => f.name).join(" › ") || "Documents" : "Documents";
}

/** In the Trash itself, or inside a folder that is. */
export function folderTrashed(folders: DocFolder[], id: string | null): boolean {
  return folderTrail(folders, id).some(f => !!f.deletedAt);
}
export function itemTrashed(folders: DocFolder[], item: DocItem): boolean {
  return !!item.deletedAt || folderTrashed(folders, item.folderId);
}

/** The folders beside each other, in their arranged order (then by name). */
export function sortFolders(list: DocFolder[]): DocFolder[] {
  return [...list].sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER, bo = b.order ?? Number.MAX_SAFE_INTEGER;
    return ao !== bo ? ao - bo : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export async function createFolder(name: string, parentId: string | null, by: string): Promise<string> {
  const id = uid("df_");
  const f: DocFolder = { id, name: name.trim(), parentId, createdBy: by, createdAt: now() };
  await setDoc(doc(fsdb, DOC_FOLDERS, id), clean(f));
  return id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await updateDoc(doc(fsdb, DOC_FOLDERS, id), { name: name.trim(), updatedAt: now() });
}

/** Into another folder (or the top). Never into itself or a folder under it. */
export async function moveFolder(folders: DocFolder[], id: string, parentId: string | null): Promise<void> {
  if (parentId && folderAndBelow(folders, id).has(parentId)) throw new Error("A folder can't go inside itself");
  // At the end of its new place, not wherever its old position number lands it.
  await updateDoc(doc(fsdb, DOC_FOLDERS, id), { parentId, order: deleteField(), updatedAt: now() });
}

/** The folders beside each other, in this order. */
export async function reorderFolders(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 450) {
    const b = writeBatch(fsdb);
    ids.slice(i, i + 450).forEach((id, j) => b.update(doc(fsdb, DOC_FOLDERS, id), { order: i + j }));
    await b.commit();
  }
}

/** To the Trash — with everything in it; restorable. */
export async function trashFolder(id: string): Promise<void> {
  await updateDoc(doc(fsdb, DOC_FOLDERS, id), { deletedAt: now() });
}

/** Back from the Trash. If the folder it was in is gone or in the Trash too, it comes back at the top. */
export async function restoreFolder(folders: DocFolder[], id: string): Promise<void> {
  const f = folders.find(x => x.id === id);
  const parentOk = !f?.parentId || (folders.some(x => x.id === f.parentId) && !folderTrashed(folders, f.parentId));
  await updateDoc(doc(fsdb, DOC_FOLDERS, id), {
    deletedAt: deleteField(), updatedAt: now(),
    ...(parentOk ? {} : { parentId: null, order: deleteField() }),
  });
}

/** Records written in batches of at most 450 (Firestore takes 500 at most). */
async function deleteRecords(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 450) {
    const b = writeBatch(fsdb);
    refs.slice(i, i + 450).forEach(r => b.delete(r));
    await b.commit();
  }
}

/**
 * Gone for good: the folder's record, the records of the folders and
 * documents inside it, and the links that shared any of them. The FILES stay
 * in Storage — nothing is ever removed there. Returns how many documents went.
 */
export async function deleteFolderForever(folders: DocFolder[], items: DocItem[], shares: DocShare[], id: string): Promise<number> {
  const fids = folderAndBelow(folders, id);
  const its = items.filter(i => i.folderId && fids.has(i.folderId));
  const iids = new Set(its.map(i => i.id));
  const links = shares.filter(s => (s.target.kind === "folder" ? fids.has(s.target.id) : iids.has(s.target.id)));
  await deleteRecords([
    ...links.map(s => doc(fsdb, DOC_SHARES, s.id)),
    ...its.map(i => doc(fsdb, DOC_ITEMS, i.id)),
    ...[...fids].map(f => doc(fsdb, DOC_FOLDERS, f)),
  ]);
  return its.length;
}

/* ─────────────── Documents ─────────────── */

/** What a file is, by its type (or its name when the browser gives no type). */
export function kindOf(mime: string | undefined, name: string): DocKind {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (m.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(name)) return "image";
  return "file";
}

/** A file name safe as a Storage path part: no slashes or odd characters, not too long, keeps its extension. */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() : "";
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "file";
  return ext ? `${stem}.${ext}` : stem;
}

/** One file to Storage at documents/<itemId>/<name>, sent in chunks with progress. */
async function putFile(itemId: string, file: Blob, name: string, onProgress?: (pct: number) => void): Promise<{ url: string; path: string }> {
  const path = `documents/${itemId}/${safeFileName(name)}`;
  await ensureFileClaims(); // the file rules read who they are from it (lib/fileClaims.ts)
  const r = ref(storage, path);
  const task = uploadBytesResumable(r, file, { contentType: file.type || undefined });
  await new Promise<void>((resolve, reject) => {
    task.on("state_changed",
      s => { if (onProgress && s.totalBytes) onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)); },
      reject,
      () => resolve());
  });
  return { url: await getDownloadURL(r), path };
}

/** A name to show: the file's own name, its extension kept. */
const shownName = (name: string) => name.trim() || "Untitled";

/**
 * Upload one file as a new document in a folder (null = the top). A photo gets
 * a small preview for the grid; a preview that can't be made never stops the upload.
 */
export async function uploadDocument(file: File, folderId: string | null, by: string, onProgress?: (pct: number) => void): Promise<DocItem> {
  const id = uid("doc_");
  const { url, path } = await putFile(id, file, file.name, onProgress);
  const kind = kindOf(file.type, file.name);
  const thumb = kind === "image" ? await makePreview(file, `documents/${id}`) : undefined;
  const item: DocItem = {
    id, folderId, name: shownName(file.name), kind, mime: file.type || undefined, size: file.size,
    url, path, thumb, source: "upload", createdBy: by, createdAt: now(),
  };
  await setDoc(doc(fsdb, DOC_ITEMS, id), clean(item));
  return item;
}

/** Several files, one after another. What went in, and the names of any that didn't. */
export async function uploadDocuments(
  files: File[], folderId: string | null, by: string,
  onProgress?: (p: { done: number; total: number; pct: number; name: string }) => void,
): Promise<{ added: DocItem[]; failed: string[] }> {
  const added: DocItem[] = [], failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.({ done: i, total: files.length, pct: 0, name: f.name });
    try {
      added.push(await uploadDocument(f, folderId, by, pct => onProgress?.({ done: i, total: files.length, pct, name: f.name })));
    } catch (e) {
      console.warn("[documents] upload failed:", f.name, e);
      failed.push(f.name);
    }
  }
  return { added, failed };
}

/** A scan: the finished PDF and its first page's small picture (a JPEG data URL). */
export async function saveScan(pdf: Blob, name: string, pages: number, firstPage: string | undefined, folderId: string | null, by: string, onProgress?: (pct: number) => void): Promise<DocItem> {
  const id = uid("doc_");
  const fileName = /\.pdf$/i.test(name.trim()) ? name.trim() : `${name.trim() || "Scan"}.pdf`;
  const { url, path } = await putFile(id, pdf, fileName, onProgress);
  let thumb: string | undefined;
  if (firstPage) {
    try { thumb = await uploadDataUrl(firstPage, `documents/${id}/thumbs`); } catch (e) { console.warn("[documents] scan preview not saved:", e); }
  }
  const item: DocItem = {
    id, folderId, name: fileName, kind: "pdf", mime: "application/pdf", size: pdf.size,
    url, path, thumb, pages, source: "scan", createdBy: by, createdAt: now(),
  };
  await setDoc(doc(fsdb, DOC_ITEMS, id), clean(item));
  return item;
}

export async function renameItem(id: string, name: string): Promise<void> {
  await updateDoc(doc(fsdb, DOC_ITEMS, id), { name: shownName(name), updatedAt: now() });
}

export async function moveItems(ids: string[], folderId: string | null): Promise<void> {
  for (let i = 0; i < ids.length; i += 450) {
    const b = writeBatch(fsdb);
    ids.slice(i, i + 450).forEach(id => b.update(doc(fsdb, DOC_ITEMS, id), { folderId, updatedAt: now() }));
    await b.commit();
  }
}

export async function setItemNotes(id: string, notes: string): Promise<void> {
  await updateDoc(doc(fsdb, DOC_ITEMS, id), { notes: notes.trim() ? notes.trim() : deleteField(), updatedAt: now() });
}

export async function trashItem(id: string): Promise<void> {
  await updateDoc(doc(fsdb, DOC_ITEMS, id), { deletedAt: now() });
}

/** Back from the Trash. If its folder is gone or in the Trash, it comes back at the top. */
export async function restoreItem(folders: DocFolder[], item: DocItem): Promise<void> {
  const folderOk = !item.folderId || (folders.some(f => f.id === item.folderId) && !folderTrashed(folders, item.folderId));
  await updateDoc(doc(fsdb, DOC_ITEMS, item.id), {
    deletedAt: deleteField(), updatedAt: now(),
    ...(folderOk ? {} : { folderId: null }),
  });
}

/** Gone for good: the RECORD and the links that shared it — the file stays in Storage. */
export async function deleteItemForever(shares: DocShare[], id: string): Promise<void> {
  const links = shares.filter(s => s.target.kind === "item" && s.target.id === id);
  await deleteRecords([...links.map(s => doc(fsdb, DOC_SHARES, s.id)), doc(fsdb, DOC_ITEMS, id)]);
}

/** "2.4 MB". */
export function fileSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The name to save a document under, with an extension. */
export function downloadNameOf(item: DocItem): string {
  const name = (item.name || "document").replace(/[\\/:*?"<>|]+/g, "-").trim() || "document";
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const fromPath = item.path.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return fromPath ? `${name}.${fromPath}` : item.kind === "pdf" ? `${name}.pdf` : name;
}

/**
 * Save a document to this device under its own name. Not lib/zipDownload's
 * downloadFile: that asks the person's role for "export" on the page's
 * section, and Documents is no section — its own access (an admin's, or
 * Documents access) already covers downloads. A file the browser can't fetch
 * (a storage that lets no other site read it) opens in its own tab instead.
 */
export async function saveDocument(item: DocItem): Promise<void> {
  const name = downloadNameOf(item);
  try {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(String(res.status));
    const obj = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 10_000);
    logEvent("export", `Downloaded ${name} (Documents)`, { file: name, files: 1 });
  } catch {
    window.open(item.url, "_blank", "noopener");
  }
}

/* ─────────────── Share links ─────────────── */

/** A link's id: long and random, so links can't be guessed one from another. */
function linkId(): string {
  const A = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(20)), n => A[n % A.length]).join("");
}

/** The address a link opens at. */
export function shareUrl(id: string): string {
  return `${window.location.origin}/d/${id}`;
}

/** The end of a day (this device's time), as the link keeps it. "2026-11-30" → that day's last moment. */
export function dayEnd(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).toISOString();
}

/** The end of the day `n` days from today. */
export function daysFromToday(n: number): string {
  const t = new Date();
  t.setDate(t.getDate() + n);
  t.setHours(23, 59, 59, 999);
  return t.toISOString();
}

export function shareExpired(s: DocShare): boolean {
  return !!s.expiresAt && new Date(s.expiresAt).getTime() < Date.now();
}

/**
 * A new link to one document or a folder. The password is turned into a hash
 * here and only the hash is kept — never the password itself.
 */
export async function createShare(o: {
  target: DocShare["target"]; title: string; password: string;
  expiresAt: string | null; allowDownload: boolean; by: string;
}): Promise<DocShare> {
  if (o.password.length < SHARE_PASSWORD_MIN) throw new Error(`The password needs at least ${SHARE_PASSWORD_MIN} characters`);
  const { hash, salt, iterations } = await hashSharePassword(o.password);
  const id = linkId();
  const s: DocShare = {
    id, target: o.target, title: o.title.trim() || "Shared document",
    hash, salt, iterations, expiresAt: o.expiresAt, allowDownload: o.allowDownload,
    // No `opens` here: the server writes that, the first time it is opened.
    active: true, createdBy: o.by, createdAt: now(),
  };
  await setDoc(doc(fsdb, DOC_SHARES, id), clean(s));
  return s;
}

export async function setShareActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(fsdb, DOC_SHARES, id), { active });
}

export async function setShareExpiry(id: string, expiresAt: string | null): Promise<void> {
  await updateDoc(doc(fsdb, DOC_SHARES, id), { expiresAt });
}

export async function setShareDownload(id: string, allowDownload: boolean): Promise<void> {
  await updateDoc(doc(fsdb, DOC_SHARES, id), { allowDownload });
}

export async function deleteShare(id: string): Promise<void> {
  await deleteRecords([doc(fsdb, DOC_SHARES, id)]);
}
