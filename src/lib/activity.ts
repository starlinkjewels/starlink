import {
  collection, doc, getDocs, limit, orderBy, query, startAfter, updateDoc, where,
  type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";
import { db as fsdb, auth } from "./firebase";
import { loadDb, updateDbAs, collectionLoaded, invoiceOrderIds, type DB, type Invoice } from "./db";
import { companyIdOfInvoice } from "./companies";
import { stable, type ActivityEntry, type LoggedChange } from "./activityFormat";
import { designerDeleteWhy, designerPayments } from "./designers";

/**
 * Reading the activity log, and undoing what it records.
 *
 * Undo is safe-only. An entry is put back only if every record it touched is
 * still exactly as that action left it. If anyone has changed one of them
 * since, putting the old copy back would silently wipe out their later work —
 * so it refuses and says which record moved. The undo is itself an entry, and
 * the one it reversed is marked as undone, by whom and when.
 */

export const ACTIVITY_PAGE = 50;

export async function fetchActivity(opts: {
  from?: string; to?: string; cursor?: QueryDocumentSnapshot<DocumentData> | null;
}): Promise<{ entries: ActivityEntry[]; cursor: QueryDocumentSnapshot<DocumentData> | null }> {
  const parts = [];
  if (opts.from) parts.push(where("at", ">=", opts.from));
  if (opts.to) parts.push(where("at", "<=", opts.to));
  parts.push(orderBy("at", "desc"));
  if (opts.cursor) parts.push(startAfter(opts.cursor));
  parts.push(limit(ACTIVITY_PAGE));
  const snap = await getDocs(query(collection(fsdb, "activityLog"), ...parts));
  return {
    entries: snap.docs.map(d => d.data() as ActivityEntry),
    cursor: snap.docs.length === ACTIVITY_PAGE ? snap.docs[snap.docs.length - 1] : null,
  };
}

/** The record as it stands right now, from the live data. */
function current(d: DB, c: LoggedChange): Record<string, unknown> | null {
  if (c.col === "meta") return d.settings as unknown as Record<string, unknown>;
  const list = (d as unknown as Record<string, Record<string, unknown>[] | undefined>)[c.col] ?? [];
  return list.find(x => x.id === c.id) ?? null;
}

export type UndoCheck = { ok: true } | { ok: false; reason: string; moved?: string[] };

/**
 * Putting an invoice back — undoing its delete, or a change to its number or
 * its orders — must not leave the book with two bills of one number, or an
 * order billed twice. Its records can be untouched and still clash: the
 * number may since have gone to another bill (a renumber, or a number handed
 * back by a delete in Settings), or its orders may be on a new invoice. So it
 * is worked out on the book as the undo would leave it.
 *
 * Not in activityFormat's undoBlocker: that is decided once, when the save is
 * logged, and cannot know what is billed or numbered later.
 */
function invoiceClashes(changes: LoggedChange[], d: DB): string[] {
  const touched = changes.filter(c => c.col === "invoices");
  if (!touched.length) return [];
  const after = new Map((d.invoices ?? []).map(i => [i.id, i] as const));
  for (const c of touched) {
    if (c.op === "add") after.delete(c.id);
    else if (c.before) after.set(c.id, c.before as unknown as Invoice);
  }
  const book = [...after.values()];
  const out = new Set<string>();
  for (const c of touched) {
    const inv = after.get(c.id);
    if (!inv) continue;
    const co = companyIdOfInvoice(inv);
    if (book.some(o => o.id !== inv.id && o.number === inv.number && companyIdOfInvoice(o) === co)) {
      out.add(`Invoice number ${inv.number} has since gone to another bill — putting this back would make two invoices ${inv.number}`);
    }
    const mine = new Set(invoiceOrderIds(inv));
    const other = book.find(o => o.id !== inv.id && invoiceOrderIds(o).some(x => mine.has(x)));
    if (other) out.add(`Its orders are on invoice ${other.number} now — putting this back would bill them twice`);
  }
  return [...out];
}

/** Whether this entry can be put back right now, and if not, exactly why. */
export function undoCheck(e: ActivityEntry, d: DB = loadDb()): UndoCheck {
  if (e.undoneAt) return { ok: false, reason: `Already undone by ${e.undoneByName ?? "someone"}.` };
  if (!e.undoable || !e.changes?.length) return { ok: false, reason: e.undoBlocker ?? "This kind of action cannot be undone." };
  // Every collection must have arrived, or "not there" might only mean "not loaded yet".
  const cols = [...new Set(e.changes.map(c => c.col))];
  if (!cols.every(c => c === "meta" || collectionLoaded(c))) {
    return { ok: false, reason: "Still loading — try again in a moment." };
  }
  const moved: string[] = [];
  for (const c of e.changes) {
    const now = current(d, c);
    if (c.op === "delete") {
      if (now) moved.push(`${c.label} exists again`);
    } else if (!now) {
      moved.push(`${c.label} has since been deleted`);
    } else if (stable(now) !== stable(c.after)) {
      moved.push(`${c.label} has been changed since`);
    }
  }
  if (moved.length) {
    return { ok: false, reason: "Can't undo safely — something has changed since, and undoing would erase it.", moved };
  }
  const clashes = invoiceClashes(e.changes, d);
  if (clashes.length) {
    return { ok: false, reason: "Can't undo safely — the invoice would clash with the book as it is now.", moved: clashes };
  }
  // Designers and their designs: giving work or paying never touches the
  // designer's own record, so "unchanged since" doesn't cover these.
  for (const c of e.changes) {
    if (c.col === "designers" && c.op === "add") {
      const x = (d.designers ?? []).find(y => y.id === c.id);
      const why = x ? designerDeleteWhy(d, x) : undefined;
      if (why) return { ok: false, reason: `Can't undo — ${why}.` };
    }
    if (c.col === "cadJobs") {
      const now = (d.cadJobs ?? []).find(j => j.id === c.id);
      const was = (c.before as { status?: string } | null | undefined)?.status;
      if (now?.status === "approved" && was !== "approved" && designerPayments(d, now.designerId).some(t => t.cadJobId === now.id)) {
        return { ok: false, reason: "Can't undo — a payment was made against this design. Move or cancel that payment in the Locker first." };
      }
    }
  }
  return { ok: true };
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Put every record back as it was, as one save, and mark the entry undone. */
export async function undoEntry(e: ActivityEntry): Promise<void> {
  const check = undoCheck(e);
  if (!check.ok) throw new Error(check.reason);
  updateDbAs({ kind: "undo", undoOf: e.id, summary: `Undid: ${e.summary}` }, d => {
    for (const c of e.changes!) {
      if (c.col === "meta") { d.settings = copy(c.before) as unknown as DB["settings"]; continue; }
      const list = (d as unknown as Record<string, Record<string, unknown>[]>)[c.col];
      if (!list) continue;
      const i = list.findIndex(x => x.id === c.id);
      if (c.op === "add") { if (i >= 0) list.splice(i, 1); }
      else if (c.op === "edit") { if (i >= 0) list[i] = copy(c.before!); }
      else if (c.op === "delete") { if (i < 0) list.push(copy(c.before!)); }
    }
  });
  const fb = auth.currentUser;
  const me = loadDb().users.find(u => u.authUid === fb?.uid);
  await updateDoc(doc(fsdb, "activityLog", e.id), {
    undoneAt: new Date().toISOString(),
    undoneBy: me?.id ?? fb?.uid ?? "",
    undoneByName: me?.name ?? fb?.email ?? "Admin",
  });
}
