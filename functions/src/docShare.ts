import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { db } from "./lib/firestoreAdmin";
import { REGION } from "./region";
import { decideOpen, refusalOf, type ShareUpdate } from "./docShareLogic";

/**
 * Open a Documents password link (/d/:id in the app — src/pages/DocShareView.tsx).
 *
 * The visitor is not signed in, and the database rules let nobody outside read
 * docFolders, docItems or docShares. So this one narrow door, with the server's
 * rights:
 *   • the link must exist, be on, not be past its end date, and its document
 *     or folder must still be there (not in the Trash);
 *   • the password is checked against the hash the browser saved when the link
 *     was made (docShareLogic.ts) — never stored, never logged;
 *   • 5 wrong tries in a row lock the link for 15 minutes;
 *   • the right password counts an open, and hands back ONLY what the visitor
 *     needs to see (DocShareOpened in src/lib/documentsModel.ts): names, sizes,
 *     kinds and file addresses — never who made it, the hash, notes or paths.
 * The try is counted inside a transaction, so tries made at the same moment
 * can't slip past the lock.
 */

const DOC_FOLDERS = "docFolders";
const DOC_ITEMS = "docItems";
const DOC_SHARES = "docShares";

/** The most documents one folder link hands back. */
const MAX_ITEMS = 2000;

type DocKind = "pdf" | "image" | "file";
interface OpenedFolder { id: string; name: string; parentId: string | null }
interface OpenedItem { id: string; name: string; kind: DocKind; url: string; size?: number; folderId: string | null; thumb?: string }
interface Opened {
  title: string;
  allowDownload: boolean;
  folders: OpenedFolder[];
  items: OpenedItem[];
  expiresAt?: string | null;
}

interface Req { id?: unknown; password?: unknown }

const ID_RE = /^[\w-]{3,80}$/;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const live = (d: DocumentData | undefined): d is DocumentData => !!d && !d.deletedAt;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** One document, as the visitor sees it. `folderId` is placed by the caller. */
function itemOut(id: string, d: DocumentData, folderId: string | null): OpenedItem | null {
  const url = str(d.url);
  if (!url) return null;
  const kind: DocKind = d.kind === "pdf" || d.kind === "image" ? d.kind : "file";
  const out: OpenedItem = { id, name: str(d.name, "Document"), kind, url, folderId };
  if (typeof d.size === "number" && Number.isFinite(d.size) && d.size >= 0) out.size = d.size;
  if (typeof d.thumb === "string" && d.thumb) out.thumb = d.thumb;
  return out;
}

export const openDocShare = onCall<Req>(
  // No sign-in: anyone holding the link and its password. Few instances, short
  // time — the hash's rounds are the real brake on guessing, with the lock.
  { region: REGION, memory: "256MiB", maxInstances: 5, timeoutSeconds: 20 },
  async req => {
    const id = typeof req.data?.id === "string" ? req.data.id : "";
    const password = typeof req.data?.password === "string" ? req.data.password : "";
    if (!ID_RE.test(id)) throw new HttpsError("not-found", "This link is not available");
    if (password.length < 1 || password.length > 200) throw new HttpsError("invalid-argument", "Type the password");

    const shareRef = db.collection(DOC_SHARES).doc(id);
    const now = new Date();

    // Decide and count the try together.
    const { decision, share } = await db.runTransaction(async tx => {
      const snap = await tx.get(shareRef);
      const share = snap.exists ? snap.data() : undefined;
      // Is what it points at still there? (Read only for a link that is on.)
      let targetAvailable = false;
      const target = share?.target as { kind?: unknown; id?: unknown } | undefined;
      if (share && share.active === true && target && typeof target.id === "string" && ID_RE.test(target.id)
        && (target.kind === "item" || target.kind === "folder")) {
        const t = await tx.get(db.collection(target.kind === "item" ? DOC_ITEMS : DOC_FOLDERS).doc(target.id));
        targetAvailable = live(t.data());
      }
      const decision = decideOpen(share, password, now, targetAvailable);
      if (decision.result === "open" || decision.result === "wrong") tx.update(shareRef, toFirestore(decision.update));
      return { decision, share };
    });

    const refusal = refusalOf(decision);
    if (refusal || !share) throw new HttpsError(refusal?.code ?? "not-found", refusal?.message ?? "This link is not available");

    const target = share.target as { kind: "item" | "folder"; id: string };
    const opened: Opened = {
      title: "",
      allowDownload: share.allowDownload === true,
      folders: [],
      items: [],
      expiresAt: typeof share.expiresAt === "string" ? share.expiresAt : null,
    };

    if (target.kind === "item") {
      const d = (await db.collection(DOC_ITEMS).doc(target.id).get()).data();
      const item = live(d) ? itemOut(target.id, d, null) : null;
      if (!item) throw new HttpsError("not-found", "This link is not available");
      opened.items.push(item);
      opened.title = str(share.title).trim() || item.name;
    } else {
      const rootSnap = await db.collection(DOC_FOLDERS).doc(target.id).get();
      const root = rootSnap.data();
      if (!live(root)) throw new HttpsError("not-found", "This link is not available");
      opened.title = str(share.title).trim() || str(root.name, "Documents");

      // Every folder, once (only the fields the walk needs), then the shared
      // folder's own branch of it. A folder in the Trash hides all below it.
      const all = await db.collection(DOC_FOLDERS).select("name", "parentId", "order", "deletedAt").get();
      const kids = new Map<string, { id: string; name: string; order: number }[]>();
      for (const f of all.docs) {
        const d = f.data();
        if (d.deletedAt || typeof d.parentId !== "string") continue;
        const list = kids.get(d.parentId) ?? [];
        list.push({ id: f.id, name: str(d.name, "Folder"), order: typeof d.order === "number" ? d.order : Number.POSITIVE_INFINITY });
        kids.set(d.parentId, list);
      }
      const inShare = [target.id];
      const seen = new Set(inShare);
      for (let i = 0; i < inShare.length; i++) {
        const parent = inShare[i];
        const list = (kids.get(parent) ?? []).sort((a, b) => (a.order - b.order) || byName(a, b));
        for (const k of list) {
          if (seen.has(k.id)) continue; // a loop in the records — never walk it twice
          seen.add(k.id);
          inShare.push(k.id);
          opened.folders.push({ id: k.id, name: k.name, parentId: parent === target.id ? null : parent });
        }
      }

      // Their documents, 30 folders a query (Firestore's limit for "in").
      for (let i = 0; i < inShare.length && opened.items.length < MAX_ITEMS; i += 30) {
        const ids = inShare.slice(i, i + 30);
        const snap = await db.collection(DOC_ITEMS).where("folderId", "in", ids).get();
        const found: OpenedItem[] = [];
        for (const it of snap.docs) {
          const d = it.data();
          if (!live(d)) continue;
          const item = itemOut(it.id, d, d.folderId === target.id ? null : str(d.folderId));
          if (item) found.push(item);
        }
        found.sort(byName);
        opened.items.push(...found.slice(0, MAX_ITEMS - opened.items.length));
      }
    }

    return opened;
  },
);

/** The update for Firestore: a lock that's over is removed, not set to null. */
function toFirestore(u: ShareUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = { failed: u.failed };
  if (u.opens !== undefined) out.opens = u.opens;
  if (u.lastOpenedAt !== undefined) out.lastOpenedAt = u.lastOpenedAt;
  if (u.lockedUntil === null) out.lockedUntil = FieldValue.delete();
  else if (u.lockedUntil !== undefined) out.lockedUntil = u.lockedUntil;
  return out;
}
