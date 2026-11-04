// Live gold and $ rates — the app's side (the server is functions-rates/, every
// minute). The rates are read straight from rates/current (every signed-in
// person may); the settings are the admin's (rateSettings/main); the rules for
// reading, checking and per-karat rates are lib/pure/liveRates.ts — the same file
// the server uses.
import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "./firebase";
import { cleanSettings, type Field, type Judged, type PriceBase, type RateSettings, type Reading, type SourceId } from "./pure/liveRates";

export interface RatesDoc {
  status: Judged["status"];
  reasons?: string[];
  held?: Judged["held"];
  live?: Partial<Record<Field, { value: number; source: SourceId; why?: string }>>;
  price?: PriceBase;
  fx?: Record<string, number>;
  sources?: Partial<Record<SourceId, { ok: boolean; at: string; ms: number; error?: string; reading?: Reading }>>;
  marketOpen?: boolean;
  asOf?: string;
  lastGoodAt?: string;
}
export interface RateEvent { id: string; kind: string; text: string; at: string; status: string }
type Ohlc = { o: number; h: number; l: number; c: number };
export type RateDay = { day: string } & Partial<Record<Field, Ohlc>>;

/** The rates as they are now (null until the server has written them once). */
export function useRates(): RatesDoc | null | undefined {
  const [r, set] = useState<RatesDoc | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(fsdb, "rates", "current"), d => set(d.exists() ? (d.data() as RatesDoc) : null), () => set(null)), []);
  return r;
}
export function useRateSettings(): RateSettings | undefined {
  const [s, set] = useState<RateSettings | undefined>(undefined);
  useEffect(() => onSnapshot(doc(fsdb, "rateSettings", "main"), d => set(cleanSettings(d.data())), () => set(cleanSettings({}))), []);
  return s;
}
export function useRateEvents(on = true): RateEvent[] {
  const [rows, set] = useState<RateEvent[]>([]);
  useEffect(() => {
    if (!on) return;
    return onSnapshot(query(collection(fsdb, "rateEvents"), orderBy("at", "desc"), limit(30)), s => set(s.docs.map(d => ({ ...(d.data() as RateEvent), id: d.id }))), () => set([]));
  }, [on]);
  return rows;
}
export function useRateDay(day: string, on = true): RateDay | null {
  const [d, set] = useState<RateDay | null>(null);
  useEffect(() => {
    if (!on) return;
    return onSnapshot(doc(fsdb, "rateHistory", day), x => set(x.exists() ? (x.data() as RateDay) : null), () => set(null));
  }, [day, on]);
  return d;
}

/** Saved as the admin set it — the server checks it again (cleanSettings) before using it. */
export async function saveRateSettings(s: RateSettings, by: string): Promise<void> {
  const clean = cleanSettings(s);
  if (clean.override) clean.override.by = by;
  await setDoc(doc(fsdb, "rateSettings", "main"), JSON.parse(JSON.stringify({ ...clean, updatedAt: new Date().toISOString(), updatedBy: by })));
}

type Run = { ok: boolean; at: string; ms: number; error?: string; reading?: Reading } | null;
export const checkSources = async () => (await httpsCallable<{ action: string }, Record<"ronak" | "goldapi" | "fxdaily" | "ibja", Run> & { at: string }>(functions, "ratesAdmin", { timeout: 60_000 })({ action: "check" })).data;
export const refreshRates = async () => (await httpsCallable<{ action: string }, { status: string; repriced: boolean }>(functions, "ratesAdmin", { timeout: 60_000 })({ action: "refresh" })).data;

export const STATUS_TEXT: Record<Judged["status"], { label: string; tone: "green" | "amber" | "blue" | "neutral" | "red" }> = {
  live: { label: "Live", tone: "green" },
  fallback: { label: "On backup sources", tone: "amber" },
  manual: { label: "Set by hand", tone: "blue" },
  closed: { label: "Market closed", tone: "neutral" },
  stale: { label: "No source answering", tone: "red" },
};
