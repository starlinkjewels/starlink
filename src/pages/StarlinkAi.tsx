import { useEffect, useRef, useState, type ReactNode } from "react";
import { httpsCallable, type HttpsCallableResult, type FunctionsError } from "firebase/functions";
import { motion, AnimatePresence } from "framer-motion";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { Textarea } from "@/components/ui/textarea";
import { AsyncButton } from "@/components/AsyncButton";
import { Sparkles, Send } from "lucide-react";
import { toast } from "sonner";

type ChatRole = "user" | "assistant";
interface ChatMsg { role: ChatRole; content: string }

const starlinkAiChat = httpsCallable<
  { message: string; history: { role: ChatRole; content: string }[] },
  { reply: string }
>(functions, "starlinkAiChat");

const ROLE_COPY: Record<string, { subtitle: string; empty: string; suggestions: string[] }> = {
  client: {
    subtitle: "Ask about your own orders, invoices, and account.",
    empty: "Read-only answers about your own orders — it can't change anything.",
    suggestions: [
      "What's the status of my most recent order?",
      "What's my balance due?",
      "List my last 5 orders",
    ],
  },
  employee: {
    subtitle: "Ask about orders and accounts for clients assigned to you.",
    empty: "Read-only answers for your assigned clients — it can't change anything.",
    suggestions: [
      "List my assigned orders",
      "Which of my orders are still in production?",
      "What's the outstanding balance across my clients?",
    ],
  },
  admin: {
    subtitle: "Ask about any client's orders, invoices, and accounts.",
    empty: "Read-only answers across all clients — it can't change anything.",
    suggestions: [
      "List the most recent orders",
      "How many orders are waiting?",
      "What's the total outstanding balance?",
    ],
  },
};

/** Minimal, safe renderer for the model's plain-text replies — bold + short
 *  bullet lists + paragraphs. No dangerouslySetInnerHTML, no markdown tables
 *  (the system prompt already steers the model away from those). */
function ChatText({ content }: { content: string }) {
  const renderInline = (text: string): ReactNode =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
    );

  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-4 space-y-1">
          {list.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      );
      list = [];
    }
  };

  content.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*]\s+/, ""));
    } else {
      flushList();
      if (trimmed) blocks.push(<p key={`p-${i}`} className="leading-relaxed">{renderInline(trimmed)}</p>);
    }
  });
  flushList();

  return <div className="space-y-1.5">{blocks}</div>;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
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

export function StarlinkAiPage() {
  const { user } = useAuth();
  const copy = ROLE_COPY[user?.role ?? "client"] ?? ROLE_COPY.client;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const history = messages.slice(-10);
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
        fe.code === "functions/failed-precondition" ? "Starlink AI is temporarily unavailable." :
        "Starlink AI couldn't answer that — please try again.";
      toast.error(msg);
      setMessages(m => [...m, { role: "assistant", content: msg }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto h-full min-h-0 flex flex-col">
      <div className="card-luxe flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/60 flex items-center gap-3 shrink-0 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-brand-dark grid place-items-center shrink-0 shadow-soft">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg text-brand-dark">Starlink AI</p>
            <p className="text-xs text-muted-foreground truncate">{copy.subtitle}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-dark/10 grid place-items-center">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-display text-xl text-brand-dark">Ask Starlink AI</p>
                <p className="text-sm text-muted-foreground mt-1">{copy.empty}</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {copy.suggestions.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="flex items-center gap-2.5 text-sm text-left px-3.5 py-2.5 rounded-xl border border-border/70 bg-white/60 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary to-brand-dark grid place-items-center shrink-0 shadow-soft">
                    <Sparkles className="h-3 w-3 text-white" />
                  </div>
                )}
                <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm shadow-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-secondary rounded-bl-md"
                }`}>
                  {m.role === "assistant" ? <ChatText content={m.content} /> : m.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {sending && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-end gap-2 justify-start">
              <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary to-brand-dark grid place-items-center shrink-0 shadow-soft">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <div className="px-3.5 py-1 rounded-2xl rounded-bl-md bg-secondary">
                <TypingDots />
              </div>
            </motion.div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t flex gap-2 shrink-0 bg-white/60">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask a question…"
            rows={1}
            className="rounded-xl resize-none min-h-11 max-h-32 bg-white"
          />
          <AsyncButton onClick={() => send()} disabled={!input.trim()} className="btn-hero rounded-xl h-11 w-11 p-0 shrink-0">
            <Send className="h-4 w-4" />
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
