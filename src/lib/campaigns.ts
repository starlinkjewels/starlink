// Email campaigns — the app's side (the server is functions-campaigns/).
//
// A campaign is written here as a DRAFT (its name, subject, design and who it
// goes to) — the only thing a device may write (firestore.rules). Testing it,
// starting it, sending, pausing and the figures are the server's: it alone
// marks a draft tested, freezes the email at Start and sends one at a time
// inside the day's budget. The email itself is drawn by lib/pure/campaignEmail.ts,
// the same file the server sends with — the preview IS the email.
import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db as fsdb, functions } from "./firebase";
import { cleanDesign, designKey, DEFAULT_THEME, type CampaignDesign } from "./pure/campaignEmail";

export type CampaignStatus = "draft" | "starting" | "scheduled" | "sending" | "paused" | "done" | "cancelled";
export type RecipientStatus = "queued" | "sending" | "sent" | "failed" | "skipped" | "unsure";

export interface Audience { allClients?: boolean; clientIds?: string[]; allEmployees?: boolean; userIds?: string[] }

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  preheader?: string;
  design: CampaignDesign;
  audience: Audience;
  status: CampaignStatus;
  testedHash?: string;
  lastTestAt?: string;
  lastTestTo?: string[];
  scheduleAt?: string;
  frozen?: { subject: string; preheader: string; design: CampaignDesign; settings: CampaignSettings };
  counts?: { total: number; queued: number; sent: number; failed: number; skipped: number; unsure: number; unsubscribed?: number; sending?: number };
  skippedList?: { name: string; why: string }[];
  skippedCount?: number;
  pauseReason?: string;
  resumeAt?: string;
  lastSentAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  startedAt?: string;
  startedBy?: string;
  finishedAt?: string;
}

export interface Recipient { id: string; email: string; name?: string | null; company?: string | null; kind: "client" | "employee"; ref: string; status: RecipientStatus; why?: string; sentAt?: string; unsubscribedAt?: string; attempts?: number }
export interface CampaignSettings { fromName?: string; replyTo?: string; address?: string; contact?: string; logoUrl?: string; logoWidth?: number; dailyBudget?: number }
export interface Suppressed { id: string; email: string; reason: "unsubscribed" | "bounced" | "added"; at: string; campaignId?: string }
export interface CampaignVersion { id: string; campaignId: string; at: string; by: string; label: string; subject: string; preheader?: string; design: CampaignDesign }
export interface SendInfo { sender: string; fromName: string; dailyBudget: number; defaultBudget: number; maxBudget: number; sentToday: number; aiToday: number; logoUrl: string; resetsAt: string;
  /** The mailbox said stop (slow down, its daily limit, its password): every campaign waits until then. */
  hold: { until: string; why: string } | null }

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft", starting: "Starting", scheduled: "Scheduled", sending: "Sending", paused: "Paused", done: "Sent", cancelled: "Cancelled",
};
export const STATUS_TONE: Record<CampaignStatus, "neutral" | "blue" | "amber" | "green" | "red"> = {
  draft: "neutral", starting: "blue", scheduled: "blue", sending: "blue", paused: "amber", done: "green", cancelled: "red",
};

/** Exactly what an email says, as the server hashes it — so the page knows whether the last test is of THIS email. */
export async function designHash(subject: string, preheader: string | undefined, design: unknown): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(designKey(subject, preheader ?? "", design)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/* ─────────────── Watching ─────────────── */

function useCol<T>(make: () => ReturnType<typeof query> | null, deps: unknown[]): { rows: T[]; loading: boolean; error: string | null } {
  const [s, set] = useState<{ rows: T[]; loading: boolean; error: string | null }>({ rows: [], loading: true, error: null });
  useEffect(() => {
    const q = make();
    if (!q) { set({ rows: [], loading: false, error: null }); return; }
    return onSnapshot(q, snap => set({ rows: snap.docs.map(d => ({ ...(d.data() as T), id: d.id })), loading: false, error: null }),
      err => set(x => ({ ...x, loading: false, error: err.code || err.message })));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

export const useCampaigns = () => useCol<Campaign>(() => query(collection(fsdb, "campaigns")), []);
export const useRecipients = (id?: string, on = true) => useCol<Recipient>(() => (id && on ? query(collection(fsdb, "campaigns", id, "recipients")) : null), [id, on]);
export const useSuppressed = (on = true) => useCol<Suppressed>(() => (on ? query(collection(fsdb, "campaignSuppress")) : null), [on]);
export const useVersions = (id?: string) => useCol<CampaignVersion>(() => (id ? query(collection(fsdb, "campaignVersions"), where("campaignId", "==", id), orderBy("at", "desc"), limit(30)) : null), [id]);

export function useCampaign(id?: string): Campaign | null | undefined {
  const [c, set] = useState<Campaign | null | undefined>(undefined);
  useEffect(() => {
    if (!id) { set(null); return; }
    return onSnapshot(doc(fsdb, "campaigns", id), d => set(d.exists() ? ({ ...(d.data() as Campaign), id: d.id }) : null), () => set(null));
  }, [id]);
  return c;
}

export function useCampaignSettings(): CampaignSettings | undefined {
  const [s, set] = useState<CampaignSettings | undefined>(undefined);
  useEffect(() => onSnapshot(doc(fsdb, "campaignSettings", "main"), d => set((d.data() as CampaignSettings) ?? {}), () => set({})), []);
  return s;
}

export function useSendInfo(tick = 0): SendInfo | null {
  const [s, set] = useState<SendInfo | null>(null);
  useEffect(() => { httpsCallable<Record<string, never>, SendInfo>(functions, "campaignInfo")({}).then(r => set(r.data), () => set(null)); }, [tick]);
  return s;
}

/* ─────────────── Drafts (the device's own writes) ─────────────── */

const newId = () => `cmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function blankDesign(brandColor?: string): CampaignDesign {
  return cleanDesign({ theme: { ...DEFAULT_THEME, ...(brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? { brand: brandColor } : {}) }, blocks: [] });
}

export async function createDraft(by: string, from?: Partial<Pick<Campaign, "name" | "subject" | "preheader" | "design" | "audience">>, brandColor?: string): Promise<string> {
  const id = newId();
  await setDoc(doc(fsdb, "campaigns", id), {
    id, name: (from?.name ?? "").trim() || "Untitled campaign", subject: from?.subject ?? "", preheader: from?.preheader ?? "",
    design: from?.design ? cleanDesign(from.design) : blankDesign(brandColor), audience: from?.audience ?? {},
    status: "draft", createdAt: new Date().toISOString(), createdBy: by,
  });
  return id;
}

export async function saveDraft(id: string, patch: Partial<Pick<Campaign, "name" | "subject" | "preheader" | "design" | "audience">>): Promise<void> {
  const clean: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) clean.name = patch.name.slice(0, 120);
  if (patch.subject !== undefined) clean.subject = patch.subject.slice(0, 200);
  if (patch.preheader !== undefined) clean.preheader = patch.preheader.slice(0, 200);
  if (patch.design !== undefined) clean.design = cleanDesign(patch.design);
  if (patch.audience !== undefined) clean.audience = {
    allClients: !!patch.audience.allClients, clientIds: [...new Set(patch.audience.clientIds ?? [])].slice(0, 10000),
    allEmployees: !!patch.audience.allEmployees, userIds: [...new Set(patch.audience.userIds ?? [])].slice(0, 2000),
  };
  await updateDoc(doc(fsdb, "campaigns", id), clean);
}

/** Kept as a version to go back to (the last 30 of each campaign). */
export async function saveVersion(c: Pick<Campaign, "id" | "subject" | "preheader" | "design">, by: string, label: string): Promise<void> {
  await addDoc(collection(fsdb, "campaignVersions"), {
    campaignId: c.id, at: new Date().toISOString(), by, label: label.slice(0, 80), subject: c.subject ?? "", preheader: c.preheader ?? "", design: cleanDesign(c.design),
  });
  const old = await getDocs(query(collection(fsdb, "campaignVersions"), where("campaignId", "==", c.id), orderBy("at", "desc")));
  for (const d of old.docs.slice(30)) await deleteDoc(d.ref).catch(() => undefined);
}

export async function saveCampaignSettings(s: CampaignSettings): Promise<void> {
  await setDoc(doc(fsdb, "campaignSettings", "main"), { ...s, updatedAt: new Date().toISOString() }, { merge: true });
}

/* ─────────────── Asking the server ─────────────── */

const callErr = (e: unknown) => new Error((e as { message?: string })?.message?.replace(/^(FirebaseError: )?/, "") || "The server didn't answer — try again");
async function call<I, O>(name: string, data: I, timeout = 120_000): Promise<O> {
  try { return (await httpsCallable<I, O>(functions, name, { timeout })(data)).data; }
  catch (e) { throw callErr(e); }
}

export interface AiPiece { title: string; sub?: string; src?: string; href?: string }
export interface AiRequest { mode: "write" | "change"; brief: string; tone?: string; language?: string; audience?: "clients" | "employees" | "both"; pieces?: AiPiece[]; current?: { subject?: string; preheader?: string; design?: CampaignDesign }; brandColor?: string }
export const aiWrite = (r: AiRequest) => call<AiRequest, { subjects: string[]; preheader: string; design: CampaignDesign }>("campaignAi", r, 150_000);
export const sendTest = (campaignId: string, to: string[], asRef?: string) => call<object, { sent: string[]; failed: string[] }>("campaignTest", { campaignId, to, asRef });
export const startCampaign = (campaignId: string, scheduleAt?: string) => call<object, { queued: number; skipped: number; scheduled: boolean }>("campaignStart", { campaignId, scheduleAt }, 300_000);
export const runNow = () => call<object, { sent: number; why?: string }>("campaignRunNow", {}, 70_000);
export type ControlAction = "pause" | "resume" | "cancel" | "retryFailed" | "retryUnsure" | "delete" | "unsubscribe" | "resubscribe" | "recount" | "bounced" | "clearHold";
export const control = (action: ControlAction, campaignId?: string, email?: string) => call<object, { ok: boolean; count?: number }>("campaignControl", { action, campaignId, email }, 300_000);

export const AI_LANGUAGES = ["English", "Hindi", "Gujarati", "Marathi", "Tamil", "Telugu", "Bengali", "Kannada", "Malayalam", "Punjabi", "Arabic", "French", "Spanish"];
export const AI_TONES = ["Warm and professional", "Luxurious and elegant", "Short and direct", "Festive", "Formal"];
