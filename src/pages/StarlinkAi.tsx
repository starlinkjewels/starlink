import { useEffect, useRef, useState } from "react";
import { httpsCallable, HttpsCallableResult, type FunctionsError } from "firebase/functions";
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

const SUGGESTIONS = [
  "What's the status of my most recent order?",
  "What's my balance due?",
  "List my last 5 orders",
];

export function StarlinkAiPage() {
  const { user } = useAuth();
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
    <div className="max-w-3xl mx-auto h-[calc(100vh-10rem)] flex flex-col">
      <div className="card-luxe flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/60 flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-display text-lg text-brand-dark">Starlink AI</p>
            <p className="text-xs text-muted-foreground">
              Ask about your {user?.role === "client" ? "orders, invoices, and account" : "assigned clients' orders and accounts"} — answers only your own data.
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-display text-xl text-brand-dark">Ask Starlink AI</p>
                <p className="text-sm text-muted-foreground mt-1">Read-only answers from your own data — it can't change anything.</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-sm text-left px-3.5 py-2.5 rounded-xl border border-border/70 hover:bg-secondary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-secondary rounded-bl-md"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm bg-secondary text-muted-foreground">
                Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t flex gap-2 shrink-0">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask a question…"
            rows={1}
            className="rounded-xl resize-none min-h-11 max-h-32"
          />
          <AsyncButton onClick={() => send()} disabled={!input.trim()} className="btn-hero rounded-xl h-11 w-11 p-0 shrink-0">
            <Send className="h-4 w-4" />
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
