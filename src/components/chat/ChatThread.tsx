import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ban, Copy, Forward, Package, Pencil, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Message, Order, User } from "@/lib/db";
import { OrderThumb } from "@/components/OrderThumb";
import { FileCard, Ticks, VoicePlayer } from "./ChatBits";
import { canDeleteForAll, canEditMessage, react } from "@/lib/chat";

/** How many messages a conversation opens with; scrolling up brings this many more. */
const PAGE = 30;
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
/** "Today", "Yesterday", or the date — the line between days in a conversation. */
export function dayLabel(iso: string): string {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
/** A steady colour per person, for their name in a group. */
const NAME_TONES = ["text-emerald-600", "text-sky-600", "text-violet-600", "text-amber-600", "text-rose-600", "text-teal-600", "text-indigo-600"];
const toneOf = (id: string) => NAME_TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % NAME_TONES.length];

/**
 * One conversation, the way WhatsApp shows it: the latest messages first,
 * older ones as you scroll up (the place you were reading stays put), a line
 * between days. Tap a message for its reactions and actions; swipe it right
 * (phone) to reply.
 */
export function ChatThread({ thread, me, group, nameOf, orderOf, focusId, onReply, onEdit, onForward, onDelete, onOpenImage, onOpenOrder }: {
  thread: Message[];
  me: User;
  group: boolean;
  nameOf: (id: string) => string;
  orderOf: (id: string) => Order | undefined;
  /** A message to bring into view (from search, or a reply's quote). */
  focusId?: string | null;
  onReply(m: Message): void;
  onEdit(m: Message): void;
  onForward(m: Message): void;
  onDelete(m: Message): void;
  onOpenImage(url: string): void;
  onOpenOrder(orderId: string): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(PAGE);
  const [menuMsg, setMenuMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
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
  const lastMine = thread[thread.length - 1]?.fromUserId === me.id;
  const prevLast = useRef(lastId);
  useEffect(() => {
    const el = box.current;
    if (!el || prevLast.current === lastId) return;
    prevLast.current = lastId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (lastMine || nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastId, lastMine]);

  // Bring one message into view — loading older ones until it is there — and flash it.
  const jumpTo = (id: string) => {
    const i = thread.findIndex(m => m.id === id);
    if (i < 0) { toast.message("That message is no longer here"); return; }
    const need = thread.length - i;
    if (need > count) setCount(need + 5);
    setTimeout(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(id);
      setTimeout(() => setFlash(f => (f === id ? null : f)), 1600);
    }, 60);
  };
  useEffect(() => { if (focusId) jumpTo(focusId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focusId]);

  const onScroll = () => {
    // (An open message menu stays: the list also scrolls by itself — a message
    //  arriving, the chat opening — and that must not snatch it away.)
    const el = box.current;
    if (!el || hidden <= 0 || el.scrollTop > 80 || keep.current) return;
    keep.current = { height: el.scrollHeight, top: el.scrollTop };
    setCount(c => c + PAGE);
  };

  return (
    <div ref={box} onScroll={onScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-3 space-y-1.5 bg-secondary/20" aria-label="Messages in this conversation">
      {thread.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">No messages yet — say hello.</p>}
      {hidden > 0 && (
        <button type="button" onClick={() => { const el = box.current; if (el) keep.current = { height: el.scrollHeight, top: el.scrollTop }; setCount(c => c + PAGE); }}
          className="mx-auto block text-[11px] font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded-full px-3 py-1">
          Earlier messages ({hidden})
        </button>
      )}
      {shown.map((m, i) => {
        const prev = shown[i - 1];
        const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
        const firstOfRun = newDay || prev.fromUserId !== m.fromUserId;
        return (
          <div key={m.id}>
            {newDay && (
              <div className="flex justify-center py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-background/90 shadow-sm rounded-full px-2.5 py-0.5">{dayLabel(m.createdAt)}</span>
              </div>
            )}
            <Bubble m={m} me={me} group={group} showName={group && firstOfRun} nameOf={nameOf} orderOf={orderOf}
              open={menuMsg === m.id} flash={flash === m.id}
              onToggle={() => setMenuMsg(x => (x === m.id ? null : m.id))}
              onReply={() => { setMenuMsg(null); onReply(m); }} onEdit={() => { setMenuMsg(null); onEdit(m); }}
              onForward={() => { setMenuMsg(null); onForward(m); }} onDelete={() => { setMenuMsg(null); onDelete(m); }}
              onReact={e => { setMenuMsg(null); void react(m, me.id, e).catch(() => toast.error("Couldn't add the reaction")); }}
              onJump={jumpTo} onOpenImage={onOpenImage} onOpenOrder={onOpenOrder} />
          </div>
        );
      })}
    </div>
  );
}

function Bubble({ m, me, group, showName, nameOf, orderOf, open, flash, onToggle, onReply, onEdit, onForward, onDelete, onReact, onJump, onOpenImage, onOpenOrder }: {
  m: Message; me: User; group: boolean; showName: boolean; nameOf: (id: string) => string; orderOf: (id: string) => Order | undefined;
  open: boolean; flash: boolean;
  onToggle(): void; onReply(): void; onEdit(): void; onForward(): void; onDelete(): void; onReact(e: string): void;
  onJump(id: string): void; onOpenImage(url: string): void; onOpenOrder(id: string): void;
}) {
  const mine = m.fromUserId === me.id;
  const gone = !!m.deletedAt;
  // Swipe right to reply (phone).
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const images = (m.attachments ?? []).filter(a => a.kind === "image");
  const others = (m.attachments ?? []).filter(a => a.kind !== "image");
  const card = m.orderCard;
  const cardOrder = card ? orderOf(card.orderId) : undefined;
  const reactions = Object.entries(m.reactions ?? {});
  const counts = reactions.reduce<Record<string, number>>((a, [, e]) => ({ ...a, [e]: (a[e] ?? 0) + 1 }), {});
  const mineReaction = m.reactions?.[me.id];

  const copy = async () => {
    try { await navigator.clipboard.writeText(m.text); toast.success("Copied"); } catch { toast.error("Couldn't copy"); }
  };

  return (
    <div id={`msg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`flex flex-col gap-1 max-w-[85%] md:max-w-[70%] ${mine ? "items-end" : "items-start"}`}>
        <div
          role="button" tabIndex={0} aria-expanded={open}
          onClick={() => !gone && onToggle()}
          onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !gone) { e.preventDefault(); onToggle(); } }}
          onTouchStart={e => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchMove={e => {
            const s = start.current; if (!s || gone) return;
            const x = e.touches[0].clientX - s.x, y = Math.abs(e.touches[0].clientY - s.y);
            if (y > 24) { start.current = null; setDx(0); return; }
            setDx(Math.max(0, Math.min(72, x)));
          }}
          onTouchEnd={() => { if (dx > 56) onReply(); setDx(0); start.current = null; }}
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
          className={`relative px-2.5 py-1.5 rounded-2xl text-sm shadow-sm transition-[transform,box-shadow] ${dx ? "" : "duration-200"} cursor-pointer select-text
            ${mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-background rounded-bl-md"}
            ${flash ? "ring-4 ring-amber-300/70" : open ? "ring-2 ring-primary/40" : ""}`}>
          {showName && !mine && <p className={`text-[11px] font-semibold mb-0.5 ${toneOf(m.fromUserId)}`}>{nameOf(m.fromUserId)}</p>}
          {gone ? (
            <p className={`flex items-center gap-1.5 italic text-[13px] ${mine ? "text-white/75" : "text-muted-foreground"}`}><Ban className="h-3.5 w-3.5" />This message was deleted</p>
          ) : (
            <>
              {m.forwarded && <p className={`flex items-center gap-1 text-[11px] italic mb-0.5 ${mine ? "text-white/75" : "text-muted-foreground"}`}><Forward className="h-3 w-3" />Forwarded</p>}
              {m.replyTo && (
                <button type="button" onClick={e => { e.stopPropagation(); onJump(m.replyTo!.id); }}
                  className={`block w-full text-left rounded-lg px-2 py-1 mb-1 border-l-4 ${mine ? "bg-white/15 border-white/60" : "bg-secondary/80 border-primary/60"}`}>
                  <span className={`block text-[11px] font-semibold ${mine ? "text-white" : "text-primary"}`}>{m.replyTo.fromUserId === me.id ? "You" : nameOf(m.replyTo.fromUserId)}</span>
                  <span className={`block text-xs truncate ${mine ? "text-white/80" : "text-muted-foreground"}`}>{m.replyTo.text}</span>
                </button>
              )}
              {images.length > 0 && (
                <div className={`grid gap-1 mb-1 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"} max-w-[16rem]`}>
                  {images.slice(0, 4).map((a, i) => (
                    <button key={a.url} type="button" onClick={e => { e.stopPropagation(); onOpenImage(a.url); }} className="relative overflow-hidden rounded-xl bg-black/5">
                      <img src={a.url} alt={a.name ?? "Photo"} loading="lazy" className={`w-full object-cover ${images.length === 1 ? "max-h-72" : "h-28"}`} />
                      {i === 3 && images.length > 4 && <span className="absolute inset-0 bg-black/50 text-white text-lg font-semibold grid place-items-center">+{images.length - 4}</span>}
                    </button>
                  ))}
                </div>
              )}
              {others.map(a => (
                <div key={a.url} className="mb-1" onClick={e => e.stopPropagation()}>
                  {a.kind === "voice" ? <VoicePlayer a={a} mine={mine} /> : <FileCard a={a} mine={mine} />}
                </div>
              ))}
              {card && (
                <button type="button" onClick={e => { e.stopPropagation(); onOpenOrder(card.orderId); }}
                  className={`flex items-center gap-2.5 w-full text-left rounded-xl px-2 py-1.5 mb-1 ${mine ? "bg-white/15 hover:bg-white/20" : "bg-secondary/70 hover:bg-secondary"}`}>
                  {cardOrder ? <OrderThumb o={cardOrder} size="sm" /> : <span className="h-9 w-9 rounded-lg bg-white/30 grid place-items-center shrink-0"><Package className="h-4 w-4" /></span>}
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold truncate">Order {card.orderNumber}</span>
                    <span className={`block text-[10px] truncate ${mine ? "text-white/75" : "text-muted-foreground"}`}>{card.label ?? cardOrder?.status ?? "Open the order"}</span>
                  </span>
                </button>
              )}
              {m.text && <p className="whitespace-pre-wrap break-words px-0.5">{m.text}</p>}
            </>
          )}
          <p className={`flex items-center justify-end gap-1 text-[10px] mt-0.5 ${mine ? "text-white/70" : "text-muted-foreground"}`}>
            {m.editedAt && !gone && <span className="italic">edited</span>}
            {timeOf(m.createdAt)}
            {mine && !gone && <Ticks m={m} light />}
          </p>
        </div>

        {reactions.length > 0 && !gone && (
          <div className={`-mt-2 ${mine ? "mr-2" : "ml-2"} flex gap-0.5 rounded-full bg-background shadow-sm ring-1 ring-border/60 px-1.5 py-0.5 text-xs z-[1]`}>
            {Object.entries(counts).map(([e, n]) => (
              <button key={e} type="button" onClick={() => onReact(e)} title={reactions.filter(([, x]) => x === e).map(([id]) => (id === me.id ? "You" : nameOf(id))).join(", ")}
                className={`px-0.5 rounded ${mineReaction === e ? "bg-primary/10" : ""}`}>{e}{n > 1 ? <span className="text-[10px] text-muted-foreground ml-0.5">{n}</span> : null}</button>
            ))}
          </div>
        )}

        {open && !gone && (
          <div className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
            <div className="flex gap-1 rounded-full bg-background shadow-md ring-1 ring-border/60 px-2 py-1">
              {REACTIONS.map(e => (
                <button key={e} type="button" onClick={() => onReact(e)} aria-label={`React ${e}`}
                  className={`h-8 w-8 rounded-full text-lg grid place-items-center hover:bg-secondary ${mineReaction === e ? "bg-primary/10" : ""}`}>{e}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 justify-end">
              <Act icon={Reply} label="Reply" onClick={onReply} />
              {!!m.text && <Act icon={Copy} label="Copy" onClick={() => void copy()} />}
              <Act icon={Forward} label="Forward" onClick={onForward} />
              {canEditMessage(m, me.id) && <Act icon={Pencil} label="Edit" onClick={onEdit} />}
              {canDeleteForAll(m, me) && <Act icon={Trash2} label="Delete for everyone" danger onClick={onDelete} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Act({ icon: Icon, label, onClick, danger }: { icon: typeof Reply; label: string; onClick(): void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg shadow-sm ring-1 ring-border/60 transition-colors ${danger ? "text-destructive bg-background hover:bg-destructive/10" : "bg-background hover:bg-secondary"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
