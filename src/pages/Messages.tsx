import { UserAvatar } from "@/components/UserAvatar";
import { useCan } from "@/hooks/useCan";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { currentUserOrders, updateDb, worksOnClient, type ChatGroup, type Message, type Order, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, CheckCheck, MessageSquarePlus, MoreVertical, Search, Send, Trash2, Users, Volume2, VolumeX, X } from "lucide-react";
import { confirmBox } from "@/lib/confirm";
import { PageHeader } from "@/components/PageHeader";
import { useDataFresh } from "@/hooks/useDataFresh";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  alertTitleOf, convoIdOf, deleteForEveryone, forwardMessage, inConvo, isUnread, leaveGroup, markRead,
  presenceOf, previewOf, sendMessage, setOpenConvo, tickOf,
} from "@/lib/chat";
import { chatSoundOn, playSent, setChatSound } from "@/lib/chatSound";
import { ChatThread, dayLabel } from "@/components/chat/ChatThread";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ImageViewer } from "@/components/chat/ChatBits";
import { ForwardDialog, GroupDialog, OrderPicker, type ConvoChoice } from "@/components/chat/ChatDialogs";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
/** In the list: the time today, else the day. */
const listTime = (iso: string) => (dayLabel(iso) === "Today" ? timeOf(iso) : dayLabel(iso));

/** Whether the laptop layout (list beside thread) is the one on screen. */
function useWide(): boolean {
  const q = "(min-width: 768px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setWide(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return wide;
}

/** A conversation in the list: with a person, or a group. */
interface Convo {
  id: string;
  name: string;
  photo?: string;
  user?: User;
  group?: ChatGroup;
  last?: Message;
  unread: number;
}

export function MessagesPage() {
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const nav = useNavigate();
  const me = user!.id;
  const wide = useWide();
  const fresh = useDataFresh();
  // Clients are outside roles; an employee sends only if their role allows it.
  const maySend = user!.role !== "employee" || can("messages", "add");
  const staff = user!.role !== "client";

  // Client: only Admin(s) + the employee assigned to their account (if any).
  // Employee: only Admin(s) + the clients within their work (all, when their role reaches every client).
  // Admin: everyone.
  const myClient = user!.role === "client" ? db.clients.find(c => c.id === user!.clientId) : undefined;
  const people = useMemo(() => (user!.role === "admin"
    ? db.users.filter(u => u.id !== me)
    : user!.role === "client"
    ? db.users.filter(u => u.role === "admin" || (u.role === "employee" && u.id === myClient?.accountManagerId))
    : db.users.filter(u => u.role === "admin" || (u.role === "client" && (() => { const c = db.clients.find(x => x.id === u.clientId); return !!c && worksOnClient(db, user!, c); })()))
  ), [db, me, user, myClient?.accountManagerId]);
  const nameOf = (id: string) => (id === me ? "You" : db.users.find(u => u.id === id)?.name ?? "Someone");

  // Every conversation: the people, and the groups this person is in — latest first, as in any chat app.
  const mineToSee = (m: Message) => (m.chatId ? (m.members ?? []).includes(me) || m.fromUserId === me : m.fromUserId === me || m.toUserId === me);
  const convos: Convo[] = useMemo(() => {
    const lastBy = new Map<string, Message>(), unreadBy = new Map<string, number>();
    for (const m of db.messages) {
      if (!mineToSee(m)) continue;
      const id = convoIdOf(m, me);
      const l = lastBy.get(id);
      if (!l || m.createdAt > l.createdAt) lastBy.set(id, m);
      if (isUnread(m, me)) unreadBy.set(id, (unreadBy.get(id) ?? 0) + 1);
    }
    const list: Convo[] = [
      ...people.map(u => ({ id: u.id, name: u.name, photo: u.photo, user: u, last: lastBy.get(u.id), unread: unreadBy.get(u.id) ?? 0 })),
      ...(db.chats ?? []).filter(g => g.memberIds.includes(me)).map(g => ({ id: g.id, name: g.name, group: g, last: lastBy.get(g.id), unread: unreadBy.get(g.id) ?? 0 })),
    ];
    const when = (c: Convo) => c.last?.createdAt ?? c.group?.createdAt ?? "";
    return list.sort((a, b) => when(b).localeCompare(when(a)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.messages, db.chats, people, me]);

  // The open conversation lives in the address (?c=), so the phone's Back returns to the list.
  const [sp, setSp] = useSearchParams();
  const selected = sp.get("c");
  const convo = convos.find(c => c.id === selected);
  const open = (id: string, focus?: string) => setSp(p => { const n = new URLSearchParams(p); n.set("c", id); if (focus) n.set("m", focus); else n.delete("m"); return n; });
  const closeChat = () => setSp(p => { const n = new URLSearchParams(p); n.delete("c"); n.delete("m"); return n; }, { replace: true });
  const focusId = sp.get("m");

  const thread = useMemo(() => (selected ? db.messages.filter(m => inConvo(m, me, selected)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []), [db.messages, selected, me]);
  const threadOnScreen = !!convo && (wide || !!selected);

  // ── Read as it is looked at: an open conversation, on a screen in view,
  //    marks what came in as read — and its "Message from …" alerts with it.
  const [inView, setInView] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const h = () => setInView(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  const unreadHere = thread.filter(m => isUnread(m, me));
  const unreadKey = unreadHere.map(m => m.id).join(",");
  useEffect(() => {
    if (!fresh || !threadOnScreen || !inView || !unreadKey || !convo) return;
    void markRead(unreadHere, me).catch(() => {});
    const title = alertTitleOf(convo.group?.name, convo.name);
    if (db.notifications.some(n => n.userId === me && !n.read && n.type === "message" && n.title === title)) {
      try { updateDb(d => { d.notifications.forEach(n => { if (n.userId === me && !n.read && n.type === "message" && n.title === title) n.read = true; }); }); } catch { /* tried again next time */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, threadOnScreen, inView, unreadKey, convo?.id, me]);

  // The alerts know which conversation is on screen (a quieter tone there, no pop-up).
  useEffect(() => { setOpenConvo(threadOnScreen && selected ? selected : null); return () => setOpenConvo(null); }, [threadOnScreen, selected]);

  // ── Search: conversations by name, and messages by their words ──
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const shownConvos = term ? convos.filter(c => c.name.toLowerCase().includes(term)) : convos;
  const found = useMemo(() => {
    if (term.length < 2) return [];
    const ids = new Set(convos.map(c => c.id));
    return db.messages
      // Only conversations this person is in — staff can read more, but search shows what is theirs.
      .filter(m => !m.deletedAt && mineToSee(m) && String(m.text ?? "").toLowerCase().includes(term) && ids.has(convoIdOf(m, me)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, db.messages, convos, me]);

  // ── Reply / edit / forward / order / photo ──
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<"new" | "edit" | null>(null);
  const [sound, setSound] = useState(chatSoundOn());
  useEffect(() => { setReplyTo(null); setEditing(null); }, [selected]);

  const choices: ConvoChoice[] = convos.map(c => ({ id: c.id, name: c.name, photo: c.photo, group: !!c.group, note: c.group ? `${c.group.memberIds.length} people` : c.user?.role ?? "" }));
  const myOrders = useMemo(() => currentUserOrders(db, user!), [db, user]);
  const clientName = (o: Order) => (staff ? db.clients.find(c => c.id === o.clientId)?.companyName : undefined);

  const removeForAll = async (m: Message) => {
    if (!(await confirmBox(`Delete this message for everyone?\n\n"${previewOf(m).slice(0, 80)}" — it is replaced by "This message was deleted" for everyone in the conversation.`, { confirmText: "Delete for everyone" }))) return;
    try { await deleteForEveryone(m); } catch { toast.error("Couldn't delete it — try again"); }
  };

  // Staff may clear a one-to-one conversation (their own messages, and — staff — everyone's).
  const canClear = (m: { fromUserId: string }) => staff || m.fromUserId === me;
  const clearChat = async () => {
    if (!convo || convo.group) return;
    const mine = thread.filter(canClear).length;
    if (!(await confirmBox(`Delete this conversation?\n\n${mine} message${mine !== 1 ? "s" : ""} with ${convo.name} disappear for both of you${mine < thread.length ? ` (the ${thread.length - mine} they sent stay — only they can delete those)` : ""}. This cannot be undone.`))) return;
    try {
      updateDb(d => { d.messages = d.messages.filter(m => !(inConvo(m, me, convo.id) && canClear(m))); });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete it"); }
  };
  const leave = async () => {
    if (!convo?.group) return;
    if (!(await confirmBox(`Leave "${convo.group.name}"?\n\nYou stop getting its messages. What was sent stays.`, { confirmText: "Leave" }))) return;
    try { leaveGroup(convo.group.id, me); closeChat(); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't leave the group"); }
  };

  // ── The list ──
  const lastLine = (c: Convo) => {
    const m = c.last;
    if (!m) return <span className="capitalize">{c.group ? `${c.group.memberIds.length} people` : c.user?.role}</span>;
    const who = m.fromUserId === me ? null : c.group ? `${nameOf(m.fromUserId).split(" ")[0]}: ` : "";
    return (
      <span className="flex items-center gap-1 min-w-0">
        {m.fromUserId === me && !m.deletedAt && (tickOf(m) === "read" ? <CheckCheck className="h-3.5 w-3.5 text-sky-500 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0" />)}
        <span className={`truncate ${m.deletedAt ? "italic" : ""}`}>{who}{previewOf(m)}</span>
      </span>
    );
  };
  const row = (c: Convo, big: boolean) => {
    const active = wide && selected === c.id;
    const p = c.user ? presenceOf(c.user) : undefined;
    return (
      <button key={c.id} type="button" onClick={() => open(c.id)} aria-current={active ? "true" : undefined}
        className={`w-full flex items-center gap-3 ${big ? "p-3" : "p-2.5"} rounded-xl text-left transition ${active ? "bg-primary/10" : "hover:bg-secondary active:bg-secondary/70"}`}>
        <span className="relative shrink-0">
          {c.group
            ? <span className={`${big ? "h-12 w-12" : "h-10 w-10"} rounded-full bg-primary/10 text-primary grid place-items-center`}><Users className="h-5 w-5" /></span>
            : <UserAvatar photo={c.photo} name={c.name} className={`${big ? "h-12 w-12 text-base font-semibold" : "h-10 w-10 text-sm"} rounded-full`} />}
          {p?.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-background" aria-label="Online" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${c.unread ? "font-semibold text-brand-dark" : "font-medium"}`}>{c.name}</p>
            {c.last && <p className={`text-[10px] shrink-0 ${c.unread ? "text-primary font-semibold" : "text-muted-foreground"}`}>{listTime(c.last.createdAt)}</p>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className={`text-xs min-w-0 flex-1 ${c.unread ? "text-foreground" : "text-muted-foreground"}`}>{lastLine(c)}</div>
            {c.unread > 0 && <span className="h-5 min-w-[20px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center shrink-0">{c.unread}</span>}
          </div>
        </div>
      </button>
    );
  };

  const listPane = (big: boolean) => (
    <div className="card-luxe flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="p-2 flex items-center gap-1.5 border-b border-border/60">
        <div className="relative flex-1 min-w-0">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search chats and messages" className="h-10 rounded-xl pl-9 pr-8" aria-label="Search chats and messages" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear the search" className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {staff && maySend && (
          <button type="button" onClick={() => setGroupOpen("new")} aria-label="New group" title="New group" className="h-10 w-10 rounded-xl grid place-items-center text-muted-foreground hover:bg-secondary shrink-0"><MessageSquarePlus className="h-5 w-5" /></button>
        )}
        <button type="button" onClick={() => { setChatSound(!sound); setSound(!sound); toast.message(sound ? "Message sounds off on this device" : "Message sounds on"); }}
          aria-label={sound ? "Turn message sounds off" : "Turn message sounds on"} title={sound ? "Sounds on" : "Sounds off"}
          className="h-10 w-10 rounded-xl grid place-items-center text-muted-foreground hover:bg-secondary shrink-0">{sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</button>
      </div>
      <div className={`flex-1 overflow-y-auto ${big ? "p-2" : "p-1.5"}`}>
        {shownConvos.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">{term ? "No chat by that name" : "No contacts available."}</p>}
        {shownConvos.map(c => row(c, big))}
        {found.length > 0 && (
          <>
            <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Messages</p>
            {found.map(m => {
              const cid = convoIdOf(m, me);
              const c = convos.find(x => x.id === cid);
              return (
                <button key={m.id} type="button" onClick={() => open(cid, m.id)} className="w-full text-left rounded-xl px-3 py-2 hover:bg-secondary">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{c?.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{listTime(m.createdAt)}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">{m.fromUserId === me ? "You: " : ""}{m.text}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );

  // ── The open conversation ──
  const header = (withBack: boolean) => {
    if (!convo) return null;
    const p = convo.user ? presenceOf(convo.user) : undefined;
    const sub = convo.group
      ? convo.group.memberIds.map(id => (id === me ? "You" : nameOf(id).split(" ")[0])).join(", ")
      : p?.text || (convo.user?.role ?? "");
    const mayEditGroup = !!convo.group && staff;
    return (
      <div className="px-2 sm:px-3 py-2.5 border-b border-border/60 flex items-center gap-2.5 shrink-0">
        {withBack && (
          <button type="button" onClick={closeChat} aria-label="Back to chats" className="h-9 w-9 rounded-xl hover:bg-secondary grid place-items-center shrink-0"><ArrowLeft className="h-4 w-4" /></button>
        )}
        <button type="button" disabled={!mayEditGroup} onClick={() => setGroupOpen("edit")} className="flex items-center gap-2.5 min-w-0 flex-1 text-left disabled:cursor-default">
          {convo.group
            ? <span className="h-9 w-9 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0"><Users className="h-4 w-4" /></span>
            : <UserAvatar photo={convo.photo} name={convo.name} className="h-9 w-9 rounded-full text-sm shrink-0" />}
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">{convo.name}</span>
            <span className={`block text-xs truncate ${p?.online ? "text-emerald-600" : "text-muted-foreground"} ${convo.group ? "" : "first-letter:uppercase"}`}>{sub}</span>
          </span>
        </button>
        {(convo.group ? staff : thread.some(canClear)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More" className="h-9 w-9 rounded-xl grid place-items-center text-muted-foreground hover:bg-secondary shrink-0"><MoreVertical className="h-4 w-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {convo.group ? (
                <>
                  <DropdownMenuItem onSelect={() => setGroupOpen("edit")}><Users className="h-4 w-4 mr-2" />Group name and people</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void leave()} className="text-destructive"><X className="h-4 w-4 mr-2" />Leave the group</DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => void clearChat()} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete the conversation</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  const threadPane = (withBack: boolean) => convo ? (
    <div className="card-luxe flex flex-col overflow-hidden min-h-0 flex-1">
      {header(withBack)}
      <ChatThread key={convo.id} thread={thread} me={user!} group={!!convo.group} nameOf={nameOf}
        orderOf={id => db.orders.find(o => o.id === id)} focusId={focusId}
        onReply={m => { setEditing(null); setReplyTo(m); }} onEdit={m => { setReplyTo(null); setEditing(m); }}
        onForward={setForwarding} onDelete={m => void removeForAll(m)} onOpenImage={setViewing}
        onOpenOrder={id => nav(`/orders/${id}`)} />
      {maySend ? (
        <ChatComposer convoId={convo.id} me={user!} replyTo={replyTo} editing={editing} nameOf={nameOf}
          onDone={() => { setReplyTo(null); setEditing(null); }} onCancel={() => { setReplyTo(null); setEditing(null); }} onPickOrder={() => setPicking(true)} />
      ) : <ReadOnlyNote />}
    </div>
  ) : (
    <div className="card-luxe flex-1 grid place-items-center text-center p-8 text-muted-foreground">
      <div>
        <Send className="h-9 w-9 mx-auto mb-3 opacity-25" />
        <p className="text-sm font-medium text-foreground">{selected ? "This chat is not open to you" : "Choose a chat"}</p>
        <p className="text-xs mt-1">Pick someone on the left to read and reply.</p>
      </div>
    </div>
  );

  return (
    // The page is the height of the screen under the top bar, like any chat
    // app: the list and the thread scroll inside it, the box to type in stays
    // at the bottom. (Phone: the top bar and the bottom tabs; laptop: the top
    // bar and the page's own padding.)
    <div className="max-w-7xl mx-auto flex flex-col gap-4 min-h-[26rem] h-[calc(100dvh-11.5rem-env(safe-area-inset-top))] md:h-[calc(100dvh-7.5rem)]">
      {/* On a phone the open conversation has its own header with the way back. */}
      <div className={selected ? "max-md:hidden" : undefined}>
        <PageHeader title="Messages" />
      </div>

      {wide ? (
        // ── Laptop and tablet: the chats beside the conversation ──
        <div className="grid grid-cols-[minmax(17rem,23rem)_1fr] gap-4 flex-1 min-h-0">
          {listPane(false)}
          {threadPane(false)}
        </div>
      ) : (
        // ── Phone: one pane at a time — the chats, or one conversation ──
        <div className="flex flex-col flex-1 min-h-0">
          {selected ? threadPane(true) : listPane(true)}
        </div>
      )}

      <ImageViewer src={viewing} onClose={() => setViewing(null)} />
      <ForwardDialog message={forwarding} choices={choices} onClose={() => setForwarding(null)}
        onSend={ids => {
          if (!forwarding) return;
          try {
            const n = forwardMessage(forwarding, ids, user!);
            playSent();
            toast.success(`Forwarded to ${n} chat${n !== 1 ? "s" : ""}`);
          } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't forward it"); }
          setForwarding(null);
        }} />
      <OrderPicker open={picking} orders={myOrders} clientName={clientName} onClose={() => setPicking(false)}
        onPick={o => {
          setPicking(false);
          if (!convo) return;
          try {
            sendMessage(convo.id, user!, { text: "", orderCard: { orderId: o.id, orderNumber: o.orderNumber, label: [o.jewelleryType, o.designNumber].filter(Boolean).join(" · ") || undefined } });
            playSent();
          } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't share the order"); }
        }} />
      {groupOpen && (
        <GroupDialog key={groupOpen === "edit" ? convo?.id : "new"} open onClose={() => setGroupOpen(null)}
          people={people} me={user!} group={groupOpen === "edit" ? convo?.group : undefined}
          onCreated={id => open(id)} />
      )}
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <div className="p-3 border-t text-xs text-muted-foreground text-center">
      Your role lets you read messages but not send them.
    </div>
  );
}
