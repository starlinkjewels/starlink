// Documents — the business's own papers (agreements, licences, bills, KYC,
// scans), in folders, for admins and the people an admin allows
// (User.documentsAccess). Shared outside only by a link WITH a password,
// checked on the server (functions/src/docShare.ts), optionally until a date.
//
// Stored in their own Firestore collections, written directly (not through the
// app's synced store): docFolders, docItems, docShares. The database rules let
// only an admin or an allowed person read or write them (canDocs() in
// firestore.rules — the "docs" flag on the person's security index, which only
// an admin can set). Files live in Storage under documents/<itemId>/.

export const DOC_FOLDERS = "docFolders";
export const DOC_ITEMS = "docItems";
export const DOC_SHARES = "docShares";

export interface DocFolder {
  id: string;
  name: string;
  /** null = at the top. */
  parentId: string | null;
  /** Its place among the folders beside it (0 first); unset = after them, by name. */
  order?: number;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  /** In the Trash since — restorable; nothing is ever removed from Storage. */
  deletedAt?: string;
}

export type DocKind = "pdf" | "image" | "file";

export interface DocItem {
  id: string;
  /** null = at the top. */
  folderId: string | null;
  name: string;
  kind: DocKind;
  mime?: string;
  /** Bytes. */
  size?: number;
  /** Storage download address, and its path (documents/<itemId>/<file>). */
  url: string;
  path: string;
  /** A small picture of it (a photo's or a scan's first page), when one was made. */
  thumb?: string;
  /** A scan or a PDF: its pages, when known. */
  pages?: number;
  source?: "upload" | "scan";
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  /** In the Trash since — restorable. */
  deletedAt?: string;
}

/** A link to one document or one folder (with what is inside it), opened with a password. */
export interface DocShare {
  id: string;
  target: { kind: "item" | "folder"; id: string };
  /** What the visitor sees as the link's title. */
  title: string;
  /** PBKDF2-SHA256 of the password (hex), its salt (hex) and rounds — never the password itself. */
  hash: string;
  salt: string;
  iterations: number;
  /** ISO day-end; null/absent = no end. */
  expiresAt?: string | null;
  allowDownload: boolean;
  /** Turned off by hand: the link stops at once. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  /** Written by the server each time it is opened with the right password. */
  opens?: number;
  lastOpenedAt?: string;
  /** Wrong passwords in a row, and the time it is locked until (server). */
  failed?: number;
  lockedUntil?: string;
}

/** What the server hands a visitor who gave the right password. */
export interface DocShareOpened {
  title: string;
  allowDownload: boolean;
  /** The shared folder's own sub-folders (a folder link); the shared folder is the root (parentId null). */
  folders: { id: string; name: string; parentId: string | null }[];
  items: { id: string; name: string; kind: DocKind; url: string; size?: number; folderId: string | null; thumb?: string }[];
  expiresAt?: string | null;
}

export const SHARE_ITERATIONS = 120_000;

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

/** A password's hash for a new link — PBKDF2-SHA256, a fresh random salt (browser WebCrypto). */
export async function hashSharePassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: SHARE_ITERATIONS }, key, 256);
  return { hash: hex(bits), salt: hex(salt), iterations: SHARE_ITERATIONS };
}

/** A password easy to read out on the phone: three short words' worth of letters and digits, no look-alikes. */
export function suggestSharePassword(): string {
  const A = "abcdefghjkmnpqrstuvwxyz", D = "23456789";
  const r = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const part = () => Array.from({ length: 4 }, () => r(A)).join("");
  return `${part()}-${part()}-${r(D)}${r(D)}`;
}

/** The shortest a password may be. */
export const SHARE_PASSWORD_MIN = 6;
