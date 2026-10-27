import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlarmClock, Bell, Check, CircleHelp, Clock, ExternalLink, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { MoreMenu } from "@/components/MoreMenu";
import {
  answerAsk, deleteReminder, newReminderId, reminderDone, saveReminder, snoozeReminder, subscribeMyAsks, subscribeReminders, type Ask, type Reminder,
} from "@/lib/pipelines/client";

export const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep");
const pad = (n: number) => String(n).padStart(2, "0");
/** The local date and time inputs for an instant. */
const toInputs = (iso: string) => { const d = new Date(iso); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const inHours = (h: number) => new Date(Date.now() + h * 36e5).toISOString();
const tomorrowAt = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };

type State = "due" | "upcoming" | "done";
const stateOf = (r: Reminder, now: number): State => (r.done ? "done" : +new Date(r.showAt) <= now ? "due" : "upcoming");

/** A reminder set by hand: for me (an admin may set one for anyone), once or again and again. */
export function ReminderSheet({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Reminder | null }) {
  const addNew = useAddNew();
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const start = editing?.showAt ?? inHours(1);
  const [f, setF] = useState({ title: "", text: "", ...toInputs(start), repeat: "none" as NonNullable<Reminder["repeat"]>, userId: user?.id ?? "", orderId: "" });
  useEffect(() => {
    if (!open) return;
    const at = toInputs(editing?.showAt ?? inHours(1));
    setF({ title: editing?.title ?? "", text: editing?.text ?? "", ...at, repeat: editing?.repeat ?? "none", userId: editing?.userId ?? user?.id ?? "", orderId: editing?.orderId ?? "" });
  }, [open, editing, user?.id]);
  const staff = useMemo(() => db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name)), [db.users]);
  const orders = useMemo(() => [...db.orders].filter(o => !o.deletedAt).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 300), [db.orders]);
  const save = async () => {
    if (!f.title.trim()) { toast.error("Write what to remind"); return; }
    const showAt = new Date(`${f.date}T${f.time || "09:00"}`);
    if (isNaN(+showAt)) { toast.error("Pick a date and time"); return; }
    const o = orders.find(x => x.id === f.orderId);
    const who = staff.find(u => u.id === f.userId);
    const r: Reminder = {
      ...(editing ?? {}),
      id: editing?.id ?? newReminderId(), userId: f.userId || user!.id, authUid: who?.authUid ?? "", title: f.title.trim(), text: f.text.trim(),
      showAt: showAt.toISOString(), done: false, source: editing?.source ?? "manual", repeat: f.repeat,
      orderId: o?.id, orderNumber: o?.orderNumber,
      createdAt: editing?.createdAt ?? new Date().toISOString(), createdBy: editing?.createdBy ?? user!.id, createdByName: editing?.createdByName ?? user!.name,
    };
    await saveReminder(r);
    toast.success(editing ? "Reminder changed" : `I'll remind ${r.userId === user!.id ? "you" : who?.name ?? "them"} ${fmtWhen(r.showAt)}`);
    onClose();
  };
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} title={editing ? "Change reminder" : "Remind me"} description="It pops up on screen at that time" icon={AlarmClock} size="md"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button><AsyncButton onClick={save} className="btn-hero rounded-xl px-6">Save</AsyncButton></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="rm-title" className="text-xs font-semibold">What</Label><Input id="rm-title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Call Givara about the ring" className="rounded-xl h-10" /></div>
        <div className="space-y-1.5"><Label htmlFor="rm-text" className="text-xs font-semibold">Note</Label><Textarea id="rm-text" value={f.text} onChange={e => setF({ ...f, text: e.target.value })} rows={3} className="rounded-xl" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="rm-date" className="text-xs font-semibold">Day</Label><Input id="rm-date" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className="rounded-xl h-10" /></div>
          <div className="space-y-1.5"><Label htmlFor="rm-time" className="text-xs font-semibold">Time</Label><Input id="rm-time" type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} className="rounded-xl h-10" /></div>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
          {[{ l: "In 1 hour", at: inHours(1) }, { l: "Tonight 7 pm", at: (() => { const d = new Date(); d.setHours(19, 0, 0, 0); return d.toISOString(); })() }, { l: "Tomorrow 10 am", at: tomorrowAt(10) }, { l: "In a week", at: inHours(24 * 7) }].map(q => (
            <button key={q.l} type="button" onClick={() => setF({ ...f, ...toInputs(q.at) })} className="h-8 px-3 rounded-full border border-border text-xs hover:border-primary hover:text-primary">{q.l}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs font-semibold">Again</Label>
            <Select value={f.repeat} onValueChange={v => setF({ ...f, repeat: v as typeof f.repeat })}>
              <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Just once</SelectItem><SelectItem value="daily">Every day</SelectItem><SelectItem value="weekly">Every week</SelectItem></SelectContent>
            </Select>
          </div>
          {isAdmin && (
            <div className="space-y-1.5"><Label className="text-xs font-semibold">For</Label>
              <Select value={f.userId} onValueChange={addNew("employee", v => setF(p => ({ ...p, userId: v })))}>
                <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.id === user?.id ? `Me (${u.name})` : u.name}</SelectItem>)}<AddNewItem kind="employee" /></SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="space-y-1.5"><Label className="text-xs font-semibold">About an order (optional)</Label>
          <Select value={f.orderId} onValueChange={v => setF({ ...f, orderId: v })}>
            <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="No order" /></SelectTrigger>
            <SelectContent>{orders.map(o => <SelectItem key={o.id} value={o.id}>{o.orderNumber}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </ActionSheet>
  );
}

/** Every reminder — mine, or (an admin's view) everyone's: Autopilot's and those set by hand. */
export function RemindersManager({ everyone, creating, onCreating }: { everyone?: boolean; creating: boolean; onCreating: (v: boolean) => void }) {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [list, setList] = useState<Reminder[]>([]);
  const [show, setShow] = useState<"open" | "done" | "all">("open");
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => (user ? subscribeReminders(everyone ? null : user.id, setList) : undefined), [everyone, user]);
  const person = (id: string) => db.users.find(u => u.id === id)?.name ?? "—";
  const rows = list.filter(r => show === "all" || (show === "done" ? r.done : !r.done));
  const mayChange = (r: Reminder) => isAdmin || (r.userId === user?.id && r.source === "manual");
  const cols: DataColumn<Reminder>[] = [
    { key: "what", header: "Reminder", always: true, sortValue: r => r.title, cell: r => <CellMain title={<>{r.test && <span className="text-amber-700">[TEST] </span>}{r.title.replace(/^\[TEST\]\s*/, "")}</>} sub={r.text || undefined} /> },
    ...(everyone ? [{ key: "for", header: "For", sortValue: (r: Reminder) => person(r.userId), cell: (r: Reminder) => person(r.userId) }] : []),
    { key: "when", header: "When", kind: "date", sortValue: r => r.showAt, cell: r => <span className={stateOf(r, now) === "due" ? "text-destructive font-medium" : ""}>{fmtWhen(r.showAt)}</span> },
    { key: "order", header: "Order", hideIfEmpty: true, sortValue: r => r.orderNumber ?? "", cell: r => r.orderId ? <Link to={`/orders/${r.orderId}`} className="text-primary hover:underline">{r.orderNumber}</Link> : "" },
    { key: "from", header: "From", sortValue: r => r.source, cell: r => r.source === "autopilot" ? <CellMain title={<CellTag tone="violet">Autopilot</CellTag>} sub={r.pipelineName} /> : <CellMain title="By hand" sub={r.repeat && r.repeat !== "none" ? (r.repeat === "daily" ? "Every day" : "Every week") : undefined} /> },
    { key: "state", header: "Status", sortValue: r => stateOf(r, now), cell: r => { const s = stateOf(r, now); return <CellTag tone={s === "due" ? "amber" : s === "done" ? "green" : "blue"}>{s === "due" ? "Due" : s === "done" ? "Done" : "Coming"}</CellTag>; } },
  ];
  return (
    <>
      <DataTable id={everyone ? "ap-reminders-all" : "ap-reminders"} rows={rows} columns={cols} rowKey={r => r.id} noun="reminder" plural="reminders"
        defaultSort={{ key: "when", dir: show === "done" ? "desc" : "asc" }} resetKey={show}
        searchText={r => `${r.title} ${r.text} ${r.orderNumber ?? ""} ${r.pipelineName ?? ""} ${person(r.userId)}`}
        filters={[{ kind: "select", label: "Show", value: show, onChange: v => setShow(v as typeof show), options: [{ value: "open", label: "Not done" }, { value: "done", label: "Done" }, { value: "all", label: "All" }] }]}
        onClearFilters={() => setShow("open")}
        emptyText={show === "open" ? "Nothing to remind — add one with Remind me" : "None"}
        rowActions={r => [
          { label: r.done ? "Not done" : "Done", icon: r.done ? RotateCcw : Check, onSelect: () => (r.done ? snoozeReminder(r.id, new Date().toISOString()) : reminderDone(r)), show: isAdmin || r.userId === user?.id },
          { label: "Snooze 1 hour", icon: Clock, onSelect: () => snoozeReminder(r.id, inHours(1)), show: !r.done && (isAdmin || r.userId === user?.id) },
          { label: "Change", icon: Pencil, onSelect: () => setEditing(r), show: mayChange(r) },
          { label: "Delete", icon: Trash2, danger: true, show: isAdmin || (r.userId === user?.id && r.source === "manual"),
            onSelect: async () => { if (await confirmBox(`Delete "${r.title}"?`, { danger: true, confirmText: "Delete" })) { await deleteReminder(r.id); toast.success("Deleted"); } } },
        ]} />
      <ReminderSheet open={creating || !!editing} editing={editing} onClose={() => { onCreating(false); setEditing(null); }} />
    </>
  );
}

/**
 * What pops up on a person's screen: a reminder whose time has come, or a
 * question a pipeline is waiting on. Stays until they act — Done, Snooze, Open
 * the order; Yes or No. Shown to our own people only.
 */
export function ReminderHost() {
  const { user } = useAuth();
  const nav = useNavigate();
  const staff = !!user && (user.role === "admin" || user.role === "employee");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => (staff ? subscribeReminders(user!.id, setReminders) : undefined), [staff, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (staff ? subscribeMyAsks(user!.id, setAsks) : undefined), [staff, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t); }, []);

  const due = reminders.filter(r => !r.done && +new Date(r.showAt) <= now && !hidden.has(r.id));
  const open = asks.filter(a => !hidden.has(a.id));
  const items: ({ kind: "ask"; a: Ask } | { kind: "rem"; r: Reminder })[] = [...open.map(a => ({ kind: "ask" as const, a })), ...due.map(r => ({ kind: "rem" as const, r }))];
  if (!staff || !items.length) return null;
  const top = items[0];
  const hide = (id: string) => setHidden(new Set([...hidden, id]));
  const go = (orderId?: string) => { if (orderId) nav(`/orders/${orderId}`); };
  const act = (p: Promise<unknown>, ok?: string) => p.then(() => ok && toast.success(ok)).catch(e => toast.error(e instanceof Error ? e.message : "That didn't work"));

  return (
    <div role="dialog" aria-live="polite" aria-label={top.kind === "ask" ? "A question for you" : "Reminder"}
      className="fixed z-[45] bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:bottom-6 right-3 left-3 sm:left-auto sm:w-[380px] rounded-2xl border border-border bg-white shadow-[0_20px_50px_rgb(15_23_42/0.18)] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <span className={`h-8 w-8 rounded-xl grid place-items-center ${top.kind === "ask" ? "bg-pink-50 text-pink-600" : "bg-violet-50 text-violet-600"}`}>
          {top.kind === "ask" ? <CircleHelp className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </span>
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {top.kind === "ask" ? `Autopilot asks${top.a.test ? " · test" : ""}` : top.r.source === "autopilot" ? "Autopilot reminder" : "Reminder"}
          {items.length > 1 && <span className="ml-1.5 normal-case tracking-normal font-medium">· 1 of {items.length}</span>}
        </p>
        <button type="button" aria-label="Hide for now" onClick={() => hide(top.kind === "ask" ? top.a.id : top.r.id)} className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
      </div>
      {top.kind === "ask" ? (
        <div className="px-4 pb-4 pt-2">
          <p className="text-[15px] font-semibold text-brand-dark leading-snug">{top.a.question}</p>
          <p className="mt-1 text-xs text-muted-foreground">{top.a.pipelineName} · no answer by {fmtWhen(top.a.giveUpAt)} counts as No</p>
          <div className="mt-3 flex gap-2">
            <Button className="btn-hero rounded-xl flex-1 h-10" onClick={() => act(answerAsk(top.a.id, "yes", { id: user!.id, name: user!.name }), "Yes — sent")}>Yes</Button>
            <Button variant="outline" className="rounded-xl flex-1 h-10" onClick={() => act(answerAsk(top.a.id, "no", { id: user!.id, name: user!.name }), "No — sent")}>No</Button>
            {top.a.orderId && <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10" aria-label="Open the order" onClick={() => go(top.a.orderId)}><ExternalLink className="h-4 w-4" /></Button>}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-4 pt-2">
          <p className="text-[15px] font-semibold text-brand-dark leading-snug">{top.r.title}</p>
          {top.r.text && <p className="mt-1 text-[13px] text-brand-dark/75 whitespace-pre-line leading-relaxed line-clamp-5">{top.r.text}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{fmtWhen(top.r.showAt)}{top.r.orderNumber ? ` · ${top.r.orderNumber}` : ""}</p>
          <div className="mt-3 flex gap-2">
            <Button className="btn-hero rounded-xl flex-1 h-10" onClick={() => act(reminderDone(top.r))}><Check className="h-4 w-4" /> Done</Button>
            <MoreMenu button={{ label: "Snooze", icon: Clock }} actions={[
              { label: "1 hour", onSelect: () => act(snoozeReminder(top.r.id, inHours(1)), "Snoozed for an hour") },
              { label: "3 hours", onSelect: () => act(snoozeReminder(top.r.id, inHours(3)), "Snoozed for 3 hours") },
              { label: "Tomorrow 10 am", onSelect: () => act(snoozeReminder(top.r.id, tomorrowAt(10)), "Until tomorrow") },
            ]} />
            {top.r.orderId && <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10" aria-label="Open the order" onClick={() => go(top.r.orderId)}><ExternalLink className="h-4 w-4" /></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
