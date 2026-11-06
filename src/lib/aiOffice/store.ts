// The AI Office's own records (Firestore aiOffice/{id}, admins only): the
// day's brief — one a day, shared by every admin — and the tasks the AI
// proposed, each waiting for a person: approved (it becomes a Task given to
// someone, who is told), or dismissed. Nothing here is done by the AI.
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db as fsdb } from "@/lib/firebase";
import { loadDb, uid, updateDb, type DB } from "@/lib/db";
import { notifyUsers } from "@/lib/notify";
import type { ProposedAction } from "./tools";

const COL = "aiOffice";

export interface Brief { id: string; kind: "brief"; date: string; text: string; at: string; by: string; tokens?: number; language?: string; proof?: { checked: number; matched: number; unmatched: string[] } }
/** What the owner has taught the agent about the business — sent with every question. */
export interface MemoryNote { id: string; text: string; at: string; by: string }
export interface OfficeAction extends ProposedAction {
  id: string; kind: "action";
  status: "proposed" | "approved" | "dismissed";
  source: "brief" | "ask";
  createdAt: string; createdBy: string;
  orderId?: string; clientId?: string;
  /** Who it went to, and the task it became. */
  assignedTo?: string; taskId?: string; decidedAt?: string; decidedBy?: string;
}

export const todayKey = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The brief and every action, live. */
export function useOffice(on: boolean): { briefs: Brief[]; actions: OfficeAction[]; memory: MemoryNote[]; ready: boolean } {
  const [s, set] = useState<{ briefs: Brief[]; actions: OfficeAction[]; memory: MemoryNote[]; ready: boolean }>({ briefs: [], actions: [], memory: [], ready: false });
  useEffect(() => {
    if (!on) return;
    return onSnapshot(collection(fsdb, COL), snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as (Brief | OfficeAction)[];
      const mem = snap.docs.find(d => d.id === "memory")?.data() as { notes?: MemoryNote[] } | undefined;
      set({
        memory: mem?.notes ?? [],
        briefs: (all.filter(x => x.kind === "brief") as Brief[]).sort((a, b) => b.date.localeCompare(a.date)),
        actions: (all.filter(x => x.kind === "action") as OfficeAction[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ready: true,
      });
    }, () => set(x => ({ ...x, ready: true })));
  }, [on]);
  return s;
}

/** The owner's notes, as a whole (a handful — at most 30). */
export async function saveMemory(notes: MemoryNote[]): Promise<void> {
  await setDoc(doc(fsdb, COL, "memory"), JSON.parse(JSON.stringify({ kind: "memory", notes: notes.slice(0, 30), at: new Date().toISOString() })));
}

export async function saveBrief(b: Omit<Brief, "id" | "kind">): Promise<void> {
  await setDoc(doc(fsdb, COL, `brief_${b.date}`), JSON.parse(JSON.stringify({ ...b, kind: "brief" })));
}

/** The order or client an action is about, found by what the AI named. */
function linkOf(d: DB, a: ProposedAction): { orderId?: string; clientId?: string } {
  const o = a.orderNumber ? d.orders.find(x => x.orderNumber.toLowerCase() === a.orderNumber!.trim().toLowerCase()) : undefined;
  const name = (a.clientName ?? "").trim().toLowerCase();
  const c = o ? d.clients.find(x => x.id === o.clientId) : name ? d.clients.find(x => (x.companyName || x.ownerName || "").toLowerCase().includes(name)) : undefined;
  return { ...(o ? { orderId: o.id } : {}), ...(c ? { clientId: c.id } : {}) };
}

/** Who should do it: the person the AI named (by name), else the order's or the client's handler. */
export function suggestAssignee(d: DB, a: Pick<OfficeAction, "assignee" | "orderId" | "clientId">): string | undefined {
  const staff = d.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive");
  const said = (a.assignee ?? "").trim().toLowerCase();
  const named = said ? staff.find(u => u.name.toLowerCase() === said) ?? staff.find(u => said.includes(u.name.toLowerCase()) || u.name.toLowerCase().split(/\s+/)[0] === said.split(/\s+/)[0]) : undefined;
  if (named) return named.id;
  const o = a.orderId ? d.orders.find(x => x.id === a.orderId) : undefined;
  const handler = o?.assignedEmployeeId || d.clients.find(c => c.id === (a.clientId ?? o?.clientId))?.accountManagerId;
  return staff.some(u => u.id === handler) ? handler : undefined;
}

/** The AI's proposals, kept — the same title twice on a day is kept once. */
export async function keepActions(list: ProposedAction[], source: OfficeAction["source"], by: string, existing: OfficeAction[]): Promise<number> {
  const d = loadDb();
  const day = todayKey();
  let n = 0;
  for (const a of list) {
    const same = existing.find(x => x.title.trim().toLowerCase() === a.title.trim().toLowerCase() && x.createdAt.slice(0, 10) === day);
    if (same) continue;
    const id = uid("act_");
    await setDoc(doc(fsdb, COL, id), JSON.parse(JSON.stringify({ ...a, ...linkOf(d, a), id, kind: "action", status: "proposed", source, createdAt: new Date().toISOString(), createdBy: by })));
    n++;
  }
  return n;
}

/** Approved: a task for that person, who is told — with why, and a link to the order or client. */
export async function approveAction(a: OfficeAction, assignedTo: string, by: { id: string; name: string }): Promise<void> {
  const taskId = uid("task_");
  const link = a.orderId ? `/orders/${a.orderId}` : a.clientId ? `/clients/${a.clientId}` : undefined;
  const due = a.dueInDays ? new Date(Date.now() + a.dueInDays * 86_400_000).toISOString().slice(0, 10) : undefined;
  updateDb(d => {
    if (!d.tasks) d.tasks = [];
    d.tasks.push({
      id: taskId, title: a.title, assignedTo, assignedBy: by.id, ...(assignedTo !== by.id ? { tellWhenDone: true } : {}),
      completed: false, createdAt: new Date().toISOString(),
      note: a.why, ...(link ? { link } : {}), ...(due ? { due } : {}), ...(a.priority ? { priority: a.priority } : {}), fromAi: true,
    });
    notifyUsers(d, [assignedTo], { title: "New task for you", body: `${a.title} — from ${by.name}`, type: "info" }, by.id);
  });
  await updateDoc(doc(fsdb, COL, a.id), { status: "approved", assignedTo, taskId, decidedAt: new Date().toISOString(), decidedBy: by.id });
}

export async function dismissAction(a: OfficeAction, by: string): Promise<void> {
  await updateDoc(doc(fsdb, COL, a.id), { status: "dismissed", decidedAt: new Date().toISOString(), decidedBy: by });
}
