// Firebase Storage helpers.
//
// All images/videos are stored in Firebase Storage (NOT inline in Firestore —
// base64 blobs would blow the 1 MB/doc limit). Docs keep only the download URL.
import { ref, uploadString, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "./firebase";

/** Non-random unique-ish suffix (Math.random is fine for storage paths). */
function key() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Upload a base64 / data-URL string to Storage and return its download URL.
 * If the value is already an https URL (already uploaded), it is returned as-is
 * — this makes callers idempotent and safe to re-run.
 */
export async function uploadDataUrl(dataUrl: string, folder: string): Promise<string> {
  if (!dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(dataUrl)) return dataUrl; // already a Storage/remote URL
  // Derive extension from the data-URL mime, default jpg.
  const mimeMatch = /^data:([^;]+);/.exec(dataUrl);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const ext = mime.split("/")[1]?.split("+")[0] || "jpg";
  const path = `${folder}/${key()}.${ext}`;
  const r = ref(storage, path);
  await uploadString(r, dataUrl, "data_url");
  return getDownloadURL(r);
}

/** Upload a raw File (e.g. video) and return its download URL. */
export async function uploadFile(file: File, folder: string): Promise<string> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${folder}/${key()}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

/** Best-effort delete of a Storage object by its download URL. Never throws. */
export async function deleteByUrl(url?: string): Promise<void> {
  if (!url || !/^https?:\/\//i.test(url)) return;
  try {
    await deleteObject(ref(storage, url));
  } catch {
    // ignore — object may already be gone or be an external URL
  }
}
