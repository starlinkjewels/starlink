import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { httpsCallable, type HttpsCallableResult, type FunctionsError } from "firebase/functions";
import { motion } from "framer-motion";
import { functions, AI_ENABLED, AI_NAME } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Sparkles, ArrowUp, Copy, Check, RotateCcw, SquarePen, Package, FileText, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

type ChatRole = "user" | "assistant";
interface ChatMsg { role: ChatRole; content: string; failed?: boolean }

const starlinkAiChat = httpsCallable<
  { message: string; history: { role: ChatRole; content: string }[] },
  { reply: string }
>(functions, "starlinkAiChat");

/** Starters only for what the assistant can look up: orders, invoices,
 *  clients and their account balances. */
const ROLE_COPY: Record<string, { subtitle: string; suggestions: { icon: LucideIcon; text: string }[] }> = {
  client: {
    subtitle: "Your orders, invoices and account",
    suggestions: [
      { icon: Package, text: "What's the status of my latest order?" },
      { icon: Wallet, text: "What's my balance due?" },
      { icon: FileText, text: "Which of my invoices are unpaid?" },
      { icon: Package, text: "List my last 5 orders" },
    ],
  },
  employee: {
    subtitle: "Orders and accounts of your clients",
    suggestions: [
      { icon: Package, text: "List my assigned orders" },
      { icon: Package, text: "Which of my orders are in production?" },
      { icon: Wallet, text: "What's outstanding across my clients?" },
      { icon: FileText, text: "Which invoices of my clients are unpaid?" },
    ],
  },
  admin: {
    subtitle: "Orders, invoices and accounts of every client",
    suggestions: [
      { icon: Package, text: "Which orders are in production right now?" },
      { icon: FileText, text: "Which invoices are still unpaid?" },
      { icon: Users, text: "Which clients owe us the most?" },
      { icon: Package, text: "Show the latest 5 orders" },
    ],
  },
};

/** Minimal, safe renderer for the model's plain-text replies — bold, bullet
 *  and numbered lists, paragraphs. No dangerouslySetInnerHTML, no markdown
 *  tables (the system prompt already steers the model away from those). */
function ChatText({ content }: { content: string }) {
  const renderInline = (text: string): ReactNode =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
    );

  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l-${blocks.length}`} className={`${list.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1 marker:text-muted-foreground`}>
        {list.items.map((item, i) => <li key={i} className="pl-0.5">{renderInline(item)}</li>)}
      </Tag>
    );
    list = null;
  };

  content.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    const bullet = /^[-*•]\s+/.test(trimmed), numbered = /^\d+[.)]\s+/.test(trimmed);
    if (bullet || numbered) {
      if (list && list.ordered !== numbered) flushList();
      if (!list) list = { ordered: numbered, items: [] };
      list.items.push(trimmed.replace(/^([-*•]|\d+[.)])\s+/, ""));
    } else {
      flushList();
      if (trimmed) blocks.push(<p key={`p-${i}`}>{renderInline(trimmed)}</p>);
    }
  });
  flushList();

  return <div className="space-y-2.5 leading-relaxed">{blocks}</div>;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Thinking">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

/** The assistant's mark: the same small round sparkle beside each answer. */
function AiMark() {
  return (
    <span className="h-7 w-7 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0">
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => toast.error("Couldn't copy"));
      }}
      className="inline-flex items-center gap-1.5 h-8 px-2 -ml-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? "Copied" : "Copy"}
    </button>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export function StarlinkAiPage() {
  const { user } = useAuth();
  const copy = ROLE_COPY[user?.role ?? "client"] ?? ROLE_COPY.client;
  // The conversation stays while the app is open (moving to another page and
  // back keeps it); "New chat" clears it. Kept per person.
  const storeKey = user?.id ? `ai-chat:${user.id}` : null;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // Which person's conversation is loaded — nothing is saved before it is, so
  // a first draw before the sign-in is known can't save an empty chat over it.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!storeKey) return;
    let saved: ChatMsg[] = [];
    try { const v = JSON.parse(sessionStorage.getItem(storeKey) || "[]"); if (Array.isArray(v)) saved = v.slice(-40); } catch { /* private mode */ }
    setMessages(saved);
    setLoadedKey(storeKey);
  }, [storeKey]);

  useEffect(() => {
    if (!storeKey || loadedKey !== storeKey) return;
    try { sessionStorage.setItem(storeKey, JSON.stringify(messages.slice(-40))); } catch { /* private mode */ }
  }, [messages, storeKey, loadedKey]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    if (!AI_ENABLED) {
      setMessages(m => [...m, { role: "user", content }, { role: "assistant", content: "The assistant isn’t switched on for this account yet.", failed: true }]);
      setInput("");
      return;
    }
    const history = messages.filter(m => !m.failed).slice(-10).map(({ role, content }) => ({ role, content }));
    setMessages(m => [...m, { role: "user", content }]);
    setInput("");
    setSending(true);
    try {
      const res: HttpsCallableResult<{ reply: string }> = await starlinkAiChat({ message: content, history });
      setMessages(m => [...m, { role: "assistant", content: res.data.reply }]);
    } catch (err) {
      const fe = err as FunctionsError;
      const msg =
        fe.code === "functions/resource-exhausted" ? fe.message :
        fe.code === "functions/failed-precondition" ? `${AI_NAME} is temporarily unavailable.` :
        `${AI_NAME} couldn't answer that — please try again.`;
      setMessages(m => [...m, { role: "assistant", content: msg, failed: true }]);
    } finally {
      setSending(false);
      boxRef.current?.focus();
    }
  };

  // "Try again" asks the question an answer failed on once more.
  const retry = (i: number) => {
    const q = [...messages.slice(0, i)].reverse().find(m => m.role === "user")?.content;
    if (!q) return;
    setMessages(m => m.slice(0, i - 1));
    void send(q);
  };

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0];
  // A phone gets the short hint, so the box stays one line tall.
  const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches;
  const canSend = !!input.trim() && !sending;

  return (
    // The whole screen below the top bar: the conversation scrolls, the box
    // to type in stays at the bottom (see .app-fill-page in styles.css).
    <div className="app-fill-page max-w-3xl mx-auto flex flex-col">
      <PageHeader
        title={AI_NAME}
        subtitle={copy.subtitle}
        secondary={messages.length ? { label: "New chat", icon: SquarePen, onClick: () => { setMessages([]); setInput(""); boxRef.current?.focus(); } } : null}
      />

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1 mt-4">
        {messages.length === 0 ? (
          <div className="min-h-full flex flex-col justify-center py-6">
            <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary grid place-items-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{greeting()}{firstName ? `, ${firstName}` : ""}</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">What would you like to know? Answers come from your own records.</p>
            <div className="mt-6 grid sm:grid-cols-2 gap-2.5">
              {copy.suggestions.map(s => (
                <button
                  key={s.text}
                  type="button"
                  onClick={() => send(s.text)}
                  className="group flex items-start gap-3 text-left p-3.5 rounded-xl border border-border/80 bg-card hover:border-primary/40 hover:bg-primary/[0.03] transition-colors"
                >
                  <s.icon className="h-4 w-4 mt-0.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                  <span className="text-sm font-medium text-foreground leading-snug">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {messages.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <AiMark />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className={`text-[15px] break-words ${m.failed ? "text-muted-foreground" : "text-foreground"}`}>
                        <ChatText content={m.content} />
                      </div>
                      <div className="mt-1.5">
                        {m.failed
                          ? <button type="button" onClick={() => retry(i)} disabled={sending}
                              className="inline-flex items-center gap-1.5 h-8 px-2 -ml-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/[0.07] disabled:opacity-50">
                              <RotateCcw className="h-3.5 w-3.5" />Try again
                            </button>
                          : <CopyButton text={m.content} />}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
            {sending && (
              <div className="flex items-center gap-3">
                <AiMark />
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">Looking it up <TypingDots /></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The box to type in — always at the bottom of the screen. */}
      <div className="shrink-0 pt-3">
        <div className="flex items-end gap-2 rounded-2xl border border-border/80 bg-card p-2 pl-4 shadow-[0_1px_2px_rgb(15_23_42/0.06)] focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition">
          <textarea
            ref={boxRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            placeholder={narrow ? "Ask a question…" : "Ask about an order, an invoice or a client…"}
            rows={1}
            aria-label={`Ask ${AI_NAME}`}
            className="flex-1 resize-none bg-transparent py-2 text-base md:text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none max-h-40"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={!canSend}
            aria-label="Send"
            className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 transition-colors ${canSend ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary text-muted-foreground"}`}
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Answers come from your own records — it can’t change anything.</p>
      </div>
    </div>
  );
}
