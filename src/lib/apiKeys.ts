// Ready Stock API keys — made, changed, paused and deleted by an admin, and the
// API's own counts read back for the health board (shapes: lib/apiKeysModel.ts).
//
// Written straight to Firestore, NOT through the app's synced store: the API
// writes to a key too (when it blocks one), and the store rewrites whole
// documents — so every change here names only the fields it changes.
import { useEffect, useState } from "react";
import {
  addDoc, collection, deleteField, doc, getDocs, limit as qLimit, onSnapshot, orderBy, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { uid } from "./db";
import {
  API_CALLS, API_EVENTS, API_KEYS, API_QUOTA, API_STATS, DEFAULT_PER_DAY, DEFAULT_PER_MINUTE, hashSecret, MAX_PER_DAY,
  MAX_PER_MINUTE, newSecret,
  type ApiCallDoc, type ApiEventDoc, type ApiKeyDoc, type ApiKeyScope, type ApiQuotaDoc, type ApiStatsDoc,
} from "./apiKeysModel";

const now = () => new Date().toISOString();

/** Where clients call the API: this app's own address + /api/v1 (Vercel / Firebase Hosting send it on). */
export function apiBaseUrl(): string {
  // Local test mode (lib/firebase.ts — never in a built app).
  if (import.meta.env?.DEV && import.meta.env?.VITE_EMULATORS === "1") return "http://127.0.0.1:5001/demo-starlink/us-central1/stockApi/v1";
  return `${window.location.origin}/api/v1`;
}

/* ─────────────── Watching ─────────────── */

export interface Live<T> { rows: T[]; loading: boolean; error: string | null }

function useLiveQuery<T extends { id: string }>(make: () => ReturnType<typeof query> | ReturnType<typeof collection>, key: string): Live<T> {
  const [state, setState] = useState<Live<T>>({ rows: [], loading: true, error: null });
  useEffect(() => {
    const stop = onSnapshot(make(),
      snap => setState({ rows: snap.docs.map(d => ({ ...(d.data() as T), id: d.id })), loading: false, error: null }),
      err => { console.warn(`[api] ${key}:`, err.code || err.message); setState(s => ({ ...s, loading: false, error: err.code || err.message })); });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** A key as read, with every part there — a record missing one still shows (and the API uses the same defaults). */
function whole(k: ApiKeyDoc): ApiKeyDoc {
  return {
    ...k, name: k.name || "Unnamed key", prefix: k.prefix || "rsk_live_", last4: k.last4 || "····", status: k.status === "paused" ? "paused" : "active",
    scope: k.scope ?? {}, price: { show: k.price?.show !== false, markupPct: Number(k.price?.markupPct) || 0 },
    limits: { perMinute: Number(k.limits?.perMinute) || DEFAULT_PER_MINUTE, perDay: Number(k.limits?.perDay) || DEFAULT_PER_DAY },
    origins: Array.isArray(k.origins) ? k.origins : [], createdAt: k.createdAt || "", share3d: k.share3d === true,
  };
}

/** Every key, deleted ones too (each says so). */
export function useApiKeys(): Live<ApiKeyDoc> {
  const live = useLiveQuery<ApiKeyDoc>(() => collection(fsdb, API_KEYS), API_KEYS);
  return { ...live, rows: live.rows.map(whole) };
}
/** Each key's calls this minute and today, and its last call — one small record per key. */
export const useApiQuotas = () => useLiveQuery<ApiQuotaDoc & { id: string }>(() => collection(fsdb, API_QUOTA), API_QUOTA);
/** The latest blocks, pauses and admin changes. */
export const useApiEvents = (n = 60) =>
  useLiveQuery<ApiEventDoc>(() => query(collection(fsdb, API_EVENTS), orderBy("at", "desc"), qLimit(n)), `${API_EVENTS}:${n}`);

/** The hourly counts since an hour ("2026-11-03T00") — every key's, or one key's. */
export async function fetchStats(fromHour: string, keyId?: string): Promise<ApiStatsDoc[]> {
  const c = collection(fsdb, API_STATS);
  const q = keyId ? query(c, where("keyId", "==", keyId), where("hour", ">=", fromHour)) : query(c, where("hour", ">=", fromHour));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...(d.data() as ApiStatsDoc), id: d.id }));
}

/** The latest calls — every key's, or one key's (kept 30 days). */
export async function fetchCalls(keyId?: string, n = 50): Promise<ApiCallDoc[]> {
  const c = collection(fsdb, API_CALLS);
  const q = keyId ? query(c, where("keyId", "==", keyId), orderBy("at", "desc"), qLimit(n)) : query(c, orderBy("at", "desc"), qLimit(n));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...(d.data() as ApiCallDoc), id: d.id }));
}

/* ─────────────── Changing keys ─────────────── */

export interface Who { id: string; name: string }

export interface KeyInput {
  name: string;
  clientId?: string;
  clientName?: string;
  note?: string;
  scope: ApiKeyScope;
  price: { show: boolean; markupPct: number };
  share3d: boolean;
  limits: { perMinute: number; perDay: number };
  origins: string[];
}

/** What is wrong with a key as entered — or null. */
export function keyProblem(k: KeyInput): string | null {
  if (!k.name.trim()) return "Give the key a name — who it is for";
  if (!(k.limits.perMinute >= 1 && k.limits.perMinute <= MAX_PER_MINUTE)) return `Calls a minute: 1 to ${MAX_PER_MINUTE}`;
  if (!(k.limits.perDay >= k.limits.perMinute && k.limits.perDay <= MAX_PER_DAY)) return `Calls a day: from the minute's limit to ${MAX_PER_DAY.toLocaleString("en-IN")}`;
  if (!(k.price.markupPct >= -90 && k.price.markupPct <= 1000)) return "Markup: −90% to +1000%";
  return null;
}

export const blankKey = (): KeyInput => ({
  name: "", scope: {}, price: { show: true, markupPct: 0 }, share3d: false,
  limits: { perMinute: DEFAULT_PER_MINUTE, perDay: DEFAULT_PER_DAY }, origins: [],
});

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const scopeOf = (s: ApiKeyScope): ApiKeyScope => clean({
  types: s.types?.length ? s.types : undefined, metals: s.metals?.length ? s.metals : undefined,
  offices: s.offices?.length ? s.offices : undefined, companies: s.companies?.length ? s.companies : undefined,
}) as ApiKeyScope;

async function event(k: { id: string; name: string }, kind: ApiEventDoc["kind"], text: string, who: Who): Promise<void> {
  await addDoc(collection(fsdb, API_EVENTS), { at: now(), keyId: k.id, keyName: k.name, kind, text, by: who.id, byName: who.name })
    .catch(e => console.warn("[api] event not written:", e?.code ?? e));
}

/** A new key — the key itself is returned once, here, and never kept. */
export async function createKey(input: KeyInput, who: Who): Promise<{ id: string; secret: string }> {
  const problem = keyProblem(input);
  if (problem) throw new Error(problem);
  const secret = newSecret();
  const id = uid("ak_");
  const k: ApiKeyDoc = {
    id, name: input.name.trim(), hash: await hashSecret(secret), prefix: secret.slice(0, 13), last4: secret.slice(-4),
    status: "active", scope: scopeOf(input.scope), price: { show: input.price.show, markupPct: Number(input.price.markupPct) || 0 }, share3d: input.share3d === true,
    limits: { perMinute: Math.round(input.limits.perMinute), perDay: Math.round(input.limits.perDay) }, origins: input.origins,
    createdAt: now(), createdBy: who.id, createdByName: who.name,
    ...(input.clientId ? { clientId: input.clientId, clientName: input.clientName } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  await setDoc(doc(fsdb, API_KEYS, id), clean(k as unknown as Record<string, unknown>));
  await event(k, "created", `Key "${k.name}" made`, who);
  return { id, secret };
}

/** What it shows, its price, limits, websites, name — never the key itself. */
export async function updateKey(k: ApiKeyDoc, input: KeyInput, who: Who): Promise<void> {
  const problem = keyProblem(input);
  if (problem) throw new Error(problem);
  await updateDoc(doc(fsdb, API_KEYS, k.id), {
    name: input.name.trim(), scope: scopeOf(input.scope),
    price: { show: input.price.show, markupPct: Number(input.price.markupPct) || 0 },
    share3d: input.share3d === true,
    limits: { perMinute: Math.round(input.limits.perMinute), perDay: Math.round(input.limits.perDay) },
    origins: input.origins,
    clientId: input.clientId || deleteField(), clientName: input.clientId ? input.clientName ?? "" : deleteField(),
    note: input.note?.trim() || deleteField(),
    updatedAt: now(),
  });
  await event({ id: k.id, name: input.name.trim() }, "edited", `Key "${input.name.trim()}" changed`, who);
}

export async function pauseKey(k: ApiKeyDoc, who: Who): Promise<void> {
  await updateDoc(doc(fsdb, API_KEYS, k.id), { status: "paused", pausedBy: "admin", pausedAt: now(), pausedReason: `Paused by ${who.name}` });
  await event(k, "paused", `Key "${k.name}" paused by ${who.name}`, who);
}

/** On again — and its blocks forgiven (an admin chose to trust it). */
export async function resumeKey(k: ApiKeyDoc, who: Who): Promise<void> {
  await updateDoc(doc(fsdb, API_KEYS, k.id), {
    status: "active", pausedBy: deleteField(), pausedAt: deleteField(), pausedReason: deleteField(),
    blockedUntil: deleteField(), blocks: deleteField(),
  });
  await event(k, "resumed", `Key "${k.name}" turned back on by ${who.name}`, who);
}

export async function unblockKey(k: ApiKeyDoc, who: Who): Promise<void> {
  await updateDoc(doc(fsdb, API_KEYS, k.id), { blockedUntil: deleteField() });
  await event(k, "unblocked", `Key "${k.name}" unblocked by ${who.name}`, who);
}

/** A new key in place of the old one — the old one stops working within a minute. Returned once. */
export async function regenerateKey(k: ApiKeyDoc, who: Who): Promise<string> {
  const secret = newSecret();
  await updateDoc(doc(fsdb, API_KEYS, k.id), { hash: await hashSecret(secret), prefix: secret.slice(0, 13), last4: secret.slice(-4), rotatedAt: now() });
  await event(k, "regenerated", `Key "${k.name}" replaced by a new one — the old one no longer works`, who);
  return secret;
}

/** Stops working at once and leaves the list; its counts stay on the health board. */
export async function deleteKey(k: ApiKeyDoc, who: Who): Promise<void> {
  await updateDoc(doc(fsdb, API_KEYS, k.id), { deletedAt: now(), deletedBy: who.id });
  await event(k, "deleted", `Key "${k.name}" deleted by ${who.name}`, who);
}
