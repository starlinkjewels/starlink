import { UserAvatar } from "@/components/UserAvatar";
import { useCan } from "@/hooks/useCan";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, uid, worksOnClient, type Message, type User } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { AsyncButton } from "@/components/AsyncButton";
import { Send, ArrowLeft, Trash2, Check, CheckCheck } from "lucide-react";
import { confirmBox } from "@/lib/confirm";
import { notifyUsers } from "@/lib/notify";
import { PageHeader } from "@/components/PageHeader";

/** How many messages a conversation opens with; scrolling up brings this many more. */
const PAGE = 20;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
/** "Today", "Yesterday", or the date — the line between days in a conversation. */
function dayLabel(iso: string): string {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
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

export function MessagesPage() {
  const { user } = useAuth();
  const can = useCan();
  // Clients are outside roles; an employee sends only if their role allows it.
  const maySend = user!.role !== "employee" || can("messages", "add");
  const [db, setDb] = useState(loadDb());
  useEffect(() => { const h = () => setDb(loadDb()); window.addEventListener("starlink-db-updated", h); return () => window.removeEventListener("starlink-db-updated", h); }, []);
  const me = user!.id;
  const wide = useWide();

  // Client: only Admin(s) + the employee assigned to their account (if any).
  // Employee: only Admin(s) + the clients within their work (all, when their role reaches every client).
  // Admin: everyone.
  const myClient = user!.role === "client" ? db.clients.find(c => c.id === user!.clientId) : undefined;
  const people = user!.role === "admin"
    ? [...db.users.filter(u => u.id !== me)]
    : user!.role === "client"
    ? db.users.filter(u => u.role === "admin" || (u.role === "employee" && u.id === myClient?.accountManagerId))
    : db.users.filter(u => u.role === "admin" || (u.role === "client" && (() => { const c = db.clients.find(x => x.id === u.clientId); return !!c && worksOnClient(db, user!, c); })()));

  const inThread = (m: Message, other: string) => (m.fromUserId === me && m.toUserId === other) || (m.fromUserId === other && m.toUserId === me);
  const lastMessage = (contactId: string) => db.messages
    .filter(m => inThread(m, contactId))
    .reduce<Message | undefined>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), undefined);
  const unreadCount = (contactId: string) =>
    db.messages.filter(m => m.fromUserId === contactId && m.toUserId === me && !m.read).length;
  // Like any chat app: the latest conversation at the top, then everyone else by name.
  const contacts = people
    .map(c => ({ c, last: lastMessage(c.id) }))
    .sort((a, b) => (b.last?.createdAt ?? "").localeCompare(a.last?.createdAt ?? "") || a.c.name.localeCompare(b.c.name))
    .map(x => x.c);

  // Nothing open until someone picks a conversation: opening one reads it, so
  // it must never happen on its own.
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mobileView, setMobileView] = useState<"contacts" | "chat">("contacts");
  const thread = selected ? db.messages.filter(m => inThread(m, selected)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  const selectedContact = contacts.find(c => c.id === selected);

  // ── Read as it is looked at: an open conversation, on a screen in view,
  //    marks what came in as read — and the "Message from …" alerts with it.
  const threadOnScreen = !!selected && (wide || mobileView === "chat");
  const [inView, setInView] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const h = () => setInView(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  const unreadHere = thread.filter(m => m.toUserId === me && !m.read).map(m => m.id).join(",");
  useEffect(() => {
    if (!threadOnScreen || !inView || !unreadHere || !selectedContact) return;
    const ids = new Set(unreadHere.split(","));
    const alertTitle = `Message from ${selectedContact.name}`;
    updateDb(d => {
      d.messages.forEach(m => { if (ids.has(m.id)) m.read = true; });
      d.notifications.forEach(n => { if (n.userId === me && !n.read && n.type === "message" && n.title === alertTitle) n.read = true; });
    });
  }, [threadOnScreen, inView, unreadHere, selectedContact, me]);

  const send = () => {
    if (!text.trim() || !selected) return;
    const body = text.trim();
    updateDb(d => {
      d.messages.push({ id: uid("m_"), fromUserId: me, toUserId: selected, text: body, createdAt: new Date().toISOString(), read: false });
      // The other person hears of it in Alerts (and on their phone), not only when they next open Messages.
      notifyUsers(d, [selected], { title: `Message from ${user!.name}`, body: body.length > 140 ? `${body.slice(0, 140)}…` : body, type: "message" }, me);
    });
    setText("");
  };

  // Staff (admin/employee) may delete any message; a client only ones they sent.
  const canDeleteMsg = (m: { fromUserId: string }) => user!.role !== "client" || m.fromUserId === me;

  // Deleted for both people in the conversation, so it asks first.
  const deleteMessage = async (id: string) => {
    const m = db.messages.find(x => x.id === id);
    if (!m) return;
    const quote = m.text.length > 80 ? `${m.text.slice(0, 77)}…` : m.text;
    if (!(await confirmBox(`Delete this message?\n\n"${quote}" — it disappears for both of you. This cannot be undone.`))) return;
    updateDb(d => { d.messages = d.messages.filter(x => x.id !== id); });
  };

  const clearChat = async () => {
    if (!selected) return;
    const mine = thread.filter(canDeleteMsg).length;
    if (!(await confirmBox(`Delete this conversation?\n\n${mine} message${mine !== 1 ? "s" : ""} with ${selectedContact?.name ?? "them"} disappear for both of you${mine < thread.length ? ` (the ${thread.length - mine} they sent stay — only they can delete those)` : ""}. This cannot be undone.`))) return;
    updateDb(d => {
      d.messages = d.messages.filter(m => {
        if (!inThread(m, selected)) return true; // keep other conversations untouched
        return !canDeleteMsg(m);                // drop only messages we're allowed to delete
      });
    });
  };

  const contactRow = (c: User, big: boolean) => {
    const unread = unreadCount(c.id);
    const last = lastMessage(c.id);
    const active = wide && selected === c.id;
    return (
      <button key={c.id} onClick={() => { setSelected(c.id); setMobileView("chat"); }} aria-current={active ? "true" : undefined}
        className={`w-full flex items-center gap-3 ${big ? "p-3" : "p-2.5"} rounded-xl text-left transition ${active ? "bg-primary/10" : "hover:bg-secondary active:bg-secondary/70"}`}>
        <UserAvatar photo={c.photo} name={c.name} className={`${big ? "h-12 w-12 text-base font-semibold" : "h-10 w-10 text-sm"} rounded-full`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${unread ? "font-semibold text-brand-dark" : "font-medium"}`}>{c.name}</p>
            {last && <p className={`text-[10px] shrink-0 ${unread ? "text-primary font-semibold" : "text-muted-foreground"}`}>{listTime(last.createdAt)}</p>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs truncate ${unread ? "text-foreground" : "text-muted-foreground"}`}>
              {last ? <>{last.fromUserId === me ? "You: " : ""}{last.text}</> : <span className="capitalize">{c.role}</span>}
            </p>
            {unread > 0 && <span className="h-5 min-w-[20px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center shrink-0">{unread}</span>}
          </div>
        </div>
      </button>
    );
  };

  const header = (withBack: boolean) => (
    <div className="px-3 sm:px-4 py-3 border-b border-border/60 flex items-center gap-3 shrink-0">
      {withBack && (
        <button onClick={() => setMobileView("contacts")} aria-label="Back to conversations" className="h-9 w-9 rounded-xl hover:bg-secondary flex items-center justify-center shrink-0 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      {selectedContact && (
        <>
          <UserAvatar photo={selectedContact.photo} name={selectedContact.name} className="h-9 w-9 rounded-full text-sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{selectedContact.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{selectedContact.role}</p>
          </div>
          {thread.length > 0 && (
            <button onClick={clearChat} aria-label="Delete conversation"
              className="h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </div>
  );

  const composer = maySend ? (
    <div className="p-3 border-t flex gap-2 shrink-0">
      <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Type a message..." className="rounded-xl h-11" aria-label="Message" />
      <AsyncButton onClick={send} className="btn-hero rounded-xl h-11 w-11 p-0" aria-label="Send"><Send className="h-4 w-4" /></AsyncButton>
    </div>
  ) : <ReadOnlyNote />;

  return (
    // The page is the height of the screen under the top bar, like any chat
    // app: the list and the thread scroll inside it, the box to type in stays
    // at the bottom. (Phone: the top bar and the bottom tabs; laptop: the top
    // bar and the page's own padding.)
    <div className="max-w-7xl mx-auto flex flex-col gap-4 min-h-[26rem] h-[calc(100dvh-11.5rem-env(safe-area-inset-top))] md:h-[calc(100dvh-7.5rem)]">
      {/* On a phone the open conversation has its own header with the way back. */}
      <div className={mobileView === "chat" ? "max-md:hidden" : undefined}>
        <PageHeader title="Messages" />
      </div>

      {wide ? (
        // ── Laptop and tablet: the conversations beside the thread ──
        <div className="grid grid-cols-[minmax(16rem,22rem)_1fr] gap-4 flex-1 min-h-0">
          <div className="card-luxe p-2 overflow-y-auto min-h-0">
            {contacts.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">No contacts available.</p>}
            {contacts.map(c => contactRow(c, false))}
          </div>
          <div className="card-luxe flex flex-col overflow-hidden min-h-0">
            {selected ? (
              <>
                {header(false)}
                <Thread key={selected} thread={thread} me={me} canDelete={canDeleteMsg} onDelete={deleteMessage} />
                {composer}
              </>
            ) : (
              <div className="flex-1 grid place-items-center text-center p-8 text-muted-foreground">
                <div>
                  <Send className="h-9 w-9 mx-auto mb-3 opacity-25" />
                  <p className="text-sm font-medium text-foreground">Choose a conversation</p>
                  <p className="text-xs mt-1">Pick someone on the left to read and reply.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // ── Phone: one pane at a time — the conversations, or one thread ──
        <div className="flex flex-col flex-1 min-h-0">
          {mobileView === "contacts" ? (
            <div className="card-luxe p-3 flex-1 overflow-y-auto">
              {contacts.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">No contacts available.</p>}
              {contacts.map(c => contactRow(c, true))}
            </div>
          ) : (
            <div className="card-luxe flex flex-col flex-1 overflow-hidden">
              {header(true)}
              <Thread key={selected ?? ""} thread={thread} me={me} canDelete={canDeleteMsg} onDelete={deleteMessage} />
              {composer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One conversation, the way a chat app shows it: the latest {@link PAGE}
 * messages first, older ones as you scroll up (the place you were reading
 * stays put), a line between days, and on your own messages ✓ sent, ✓✓ read.
 */
function Thread({ thread, me, canDelete, onDelete }: {
  thread: Message[]; me: string; canDelete(m: Message): boolean; onDelete(id: string): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(PAGE);
  const [menuMsg, setMenuMsg] = useState<string | null>(null);
  const keep = useRef<{ height: number; top: number } | null>(null);
  const shown = thread.slice(-count);
  const hidden = thread.length - shown.length;

  // Opening: at the newest message.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  // Older ones added on top: keep the message being read where it was.
  useLayoutEffect(() => {
    const el = box.current, k = keep.current;
    if (el && k) { el.scrollTop = el.scrollHeight - k.height + k.top; keep.current = null; }
  }, [count]);
  // A new message: follow it if it's yours or you were already at the bottom.
  const lastId = thread[thread.length - 1]?.id;
  const lastMine = thread[thread.length - 1]?.fromUserId === me;
  const prevLast = useRef(lastId);
  useEffect(() => {
    const el = box.current;
    if (!el || prevLast.current === lastId) return;
    prevLast.current = lastId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (lastMine || nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastId, lastMine]);

  const onScroll = () => {
    const el = box.current;
    if (!el || hidden <= 0 || el.scrollTop > 80 || keep.current) return;
    keep.current = { height: el.scrollHeight, top: el.scrollTop };
    setCount(c => c + PAGE);
  };

  return (
    <div ref={box} onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-2" aria-label="Messages in this conversation">
      {thread.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">No messages yet — say hello.</p>}
      {hidden > 0 && (
        <button type="button" onClick={() => { const el = box.current; if (el) keep.current = { height: el.scrollHeight, top: el.scrollTop }; setCount(c => c + PAGE); }}
          className="mx-auto block text-[11px] font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded-full px-3 py-1">
          Earlier messages ({hidden})
        </button>
      )}
      {shown.map((m, i) => {
        const mine = m.fromUserId === me;
        const deletable = canDelete(m);
        const newDay = i === 0 || dayLabel(shown[i - 1].createdAt) !== dayLabel(m.createdAt);
        return (
          <div key={m.id}>
            {newDay && (
              <div className="flex justify-center py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-secondary/80 rounded-full px-2.5 py-0.5">{dayLabel(m.createdAt)}</span>
              </div>
            )}
            <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`flex flex-col gap-1 max-w-[80%] md:max-w-[75%] ${mine ? "items-end" : "items-start"}`}>
                <div
                  onClick={() => deletable && setMenuMsg(menuMsg === m.id ? null : m.id)}
                  className={`px-3 py-2 rounded-2xl text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-secondary rounded-bl-md"} ${deletable ? "cursor-pointer" : ""}`}>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                    {timeOf(m.createdAt)}
                    {mine && (m.read
                      ? <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Read" />
                      : <Check className="h-3.5 w-3.5" aria-label="Sent" />)}
                  </p>
                </div>
                {menuMsg === m.id && deletable && (
                  <button onClick={() => { setMenuMsg(null); onDelete(m.id); }}
                    className="flex items-center gap-1 text-[11px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 px-2.5 py-1.5 rounded-lg transition-colors">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
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
