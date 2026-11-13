/**
 * Backups — the file format, shared by the backup (backup/run.ts) and the
 * restore (backup/restore.ts).
 *
 * One file per backup, gzip-compressed, one JSON line per record — written and
 * read as a stream, so a backup of any size never has to sit in memory:
 *   {"t":"head","v":1,"at":…,"kind":…,"db":"diamondflow"}
 *   {"t":"doc","c":"orders","id":"o1","d":{…}}          ← every record
 *   {"t":"doc","c":"campaigns/x/recipients","id":…}     ← sub-collections by path
 *   {"t":"end","counts":{…},"hashes":{…},"records":N}   ← what the file holds
 * Firestore's own types (a timestamp, a reference…) are kept as tagged values
 * ({"__fs":"ts",…}) so a restore writes back exactly what was there.
 */
import { createHash } from "node:crypto";
import { DocumentReference, GeoPoint, Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/firestoreAdmin";

export const FOLDER = "backups/server/";
export type BackupKind = "auto" | "manual" | "before-restore";
export interface Head { t: "head"; v: 1; at: string; kind: BackupKind; db: string; by?: string }
export interface DocLine { t: "doc"; c: string; id: string; d: Record<string, unknown> }
export interface End { t: "end"; counts: Record<string, number>; hashes: Record<string, string>; records: number }

type Tagged = { __fs: "ts"; s: number; n: number } | { __fs: "geo"; lat: number; lng: number } | { __fs: "ref"; path: string } | { __fs: "bytes"; b64: string };

/** A Firestore value as plain JSON. */
export function enc(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Timestamp) return { __fs: "ts", s: v.seconds, n: v.nanoseconds } satisfies Tagged;
  if (v instanceof GeoPoint) return { __fs: "geo", lat: v.latitude, lng: v.longitude } satisfies Tagged;
  if (v instanceof DocumentReference) return { __fs: "ref", path: v.path } satisfies Tagged;
  if (v instanceof Uint8Array) return { __fs: "bytes", b64: Buffer.from(v).toString("base64") } satisfies Tagged;
  if (Array.isArray(v)) return v.map(enc);
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = enc(x);
  return o;
}

/** …and back. */
export function dec(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(dec);
  const o = v as Record<string, unknown>;
  if (typeof o.__fs === "string") {
    const t = o as Tagged;
    if (t.__fs === "ts") return new Timestamp(t.s, t.n);
    if (t.__fs === "geo") return new GeoPoint(t.lat, t.lng);
    if (t.__fs === "ref") return db.doc(t.path);
    if (t.__fs === "bytes") return Buffer.from(t.b64, "base64");
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = dec(x);
  return out;
}

/** Order-independent text of a value — two equal texts: the same record. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

/** A running fingerprint per collection. */
export class Hashes {
  private h = new Map<string, ReturnType<typeof createHash>>();
  add(col: string, line: string): void {
    let x = this.h.get(col);
    if (!x) { x = createHash("sha256"); this.h.set(col, x); }
    x.update(line);
  }
  done(): Record<string, string> {
    return Object.fromEntries([...this.h].map(([k, x]) => [k, x.digest("hex").slice(0, 24)]));
  }
}

/** "2026-11-13T06-00-00Z-auto.ndjson.gz" ↔ its moment and kind. */
export const fileName = (at: string, kind: BackupKind) => `${FOLDER}${at.replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z")}-${kind}.ndjson.gz`;
export function parseName(path: string): { at: string; kind: BackupKind } | null {
  const m = path.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-(auto|manual|before-restore)\.ndjson\.gz$/);
  return m ? { at: `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`, kind: m[5] as BackupKind } : null;
}
