// The agent (/ai, admins): the business's own analyst, named after the business
// ("Starlink Agent") — never after whose AI it runs on.
//   Today    — the day's figures (no AI), the morning brief (one a day, shared by
//              every admin; it can be listened to), what waits for approval
//   Ask      — any question, typed or spoken (Gujarati, Hindi, English …); answers
//              from the app's own figures, every figure checked (✓), read aloud
//              in a natural voice if wished; a hands-free conversation mode
//   Clients  — Client Pulse: each client's rhythm, when they'll order next, what's
//              slipping and the next step (no AI)
//   Actions  — what the agent proposed: approve to someone (their task, told) or dismiss
//   Signals  — what needs attention, by the app's own rules (no AI)
//   Memory   — what the owner teaches it about the business, used in every answer
// The agent never changes a record: it reads the figures and proposes; people decide.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { FunctionsError } from "firebase/functions";
import { toast } from "sonner";
import { AlertTriangle, ArrowUp, BookOpen, Check, CheckCircle2, ClipboardList, Headphones, Lightbulb, Loader2, MessageSquare, Mic, Plus, RefreshCw, ShieldCheck, Sparkles, SquarePen, Square, Sun, Trash2, Users, Volume2, VolumeX, X } from "lucide-react";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { brandName, brandShort } from "@/lib/brand";
import { loadDb, uid, type DB } from "@/lib/db";
import { useRates } from "@/lib/liveRates";
import { askOffice, STEP_WORDS, type ChatMessage } from "@/lib/aiOffice/agent";
import { runTool, setOfficeContext } from "@/lib/aiOffice/tools";
import { growthSignals, type Signal } from "@/lib/aiOffice/signals";
import { allPulses, type Pulse } from "@/lib/aiOffice/pulse";
import { liveFineInr } from "@/lib/aiOffice/margin";
import type { Proof } from "@/lib/aiOffice/verify";
import { hear, speak, speechLanguage, useRecorder, VOICE_CHOICES } from "@/lib/aiOffice/voice";
import { approveAction, dismissAction, keepActions, saveBrief, saveMemory, suggestAssignee, todayKey, useOffice, type MemoryNote, type OfficeAction } from "@/lib/aiOffice/store";
import { kpis, lateOpen, presetPeriod, receivables } from "@/lib/analytics";

type Tab = "today" | "ask" | "clients" | "actions" | "signals" | "memory";
const TABS: Tab[] = ["today", "ask", "clients", "actions", "signals", "memory"];
const PREF = "aiOffice.prefs", CHAT_KEY = "aiOffice.chat";
const LANGS = [{ v: "auto", l: "Same as asked" }, { v: "English", l: "English" }, { v: "Gujarati", l: "ગુજરાતી" }, { v: "Hindi", l: "हिंदी" }];
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
interface Prefs { lang: string; speakReplies: boolean; voice: string; pace: number; handsFree: boolean }
const PREF_DEFAULT: Prefs = { lang: "auto", speakReplies: false, voice: "priya", pace: 1, handsFree: false };
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** The agent's name: the business's own ("Starlink Agent"). */
export const agentName = () => `${brandShort()} Agent`;

/** The answer as the page shows it: headings, bullets, **bold**, order numbers as links, and any figure the records don't hold marked. */
function Reply({ text, db, proof }: { text: string; db: DB; proof?: Proof }) {
  const byNumber = useMemo(() => new Map(db.orders.map(o => [o.orderNumber.toUpperCase(), o.id])), [db.orders]);
  const flagged = new Set(proof?.unmatched ?? []);
  const flagRe = flagged.size ? new RegExp(`(${[...flagged].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g") : null;
  const inline = (s: string, k: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|\b[A-Z]{2,6}-\d{4}-\d{2,6}\b)/g).flatMap((p, i) => {
      if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return [<strong key={`${k}${i}`} className="font-semibold text-foreground">{inlineFlags(p.slice(2, -2), `${k}${i}b`)}</strong>];
      const id = byNumber.get(p.toUpperCase());
      if (id) return [<Link key={`${k}${i}`} to={`/orders/${id}`} className="font-medium text-primary hover:underline">{p}</Link>];
      return [<span key={`${k}${i}`}>{inlineFlags(p, `${k}${i}f`)}</span>];
    });
  const inlineFlags = (s: string, k: string): ReactNode[] => !flagRe ? [s] : s.split(flagRe).map((p, i) => flagged.has(p)
    ? <span key={`${k}${i}`} title="Not found in the app's figures for this answer — it may be the agent's own sum. Check before acting on it." className="underline decoration-dotted decoration-amber-500 underline-offset-2">{p}</span>
    : <span key={`${k}${i}`}>{p}</span>);
  const lines = text.replace(/\r/g, "").split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((raw, i) => {
        const l = raw.trim();
        if (!l) return <div key={i} className="h-1" />;
        const head = /^#{1,4}\s+(.*)$/.exec(l)?.[1] ?? (/^\*\*([^*]+)\*\*:?$/.exec(l)?.[1]);
        if (head) return <p key={i} className="pt-2 text-[13px] font-semibold uppercase tracking-wide text-brand-dark">{head.replace(/\*\*/g, "")}</p>;
        const bullet = /^(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l);
        if (bullet) return <div key={i} className="flex gap-2 pl-1"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/70" /><p className="min-w-0">{inline(bullet[1], `${i}-`)}</p></div>;
        return <p key={i}>{inline(l, `${i}-`)}</p>;
      })}
    </div>
  );
}

/** Under an answer: whether its figures match the records, and what it looked at. */
function ProofLine({ proof, tools }: { proof?: Proof; tools?: string[] }) {
  if (!proof && !tools?.length) return null;
  const all = proof && proof.checked > 0 && proof.unmatched.length === 0;
  return (
    <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {proof && proof.checked > 0 && (
        <span className={`inline-flex items-center gap-1 font-medium ${all ? "text-success" : "text-amber-700"}`}>
          <ShieldCheck className="h-3.5 w-3.5" />
          {all ? (proof.checked === 1 ? "The figure matches the app's records" : `All ${proof.checked} figures match the app's records`) : `${proof.matched} of ${proof.checked} figures match the records — check the marked ${proof.unmatched.length === 1 ? "one" : "ones"}`}
        </span>
      )}
      {tools?.length ? <span>Looked at: {tools.filter(t => t !== "propose_action").map(t => STEP_WORDS[t] ?? t).join(", ")}</span> : null}
    </div>
  );
}

function errorText(e: unknown): string {
  const fe = e as FunctionsError;
  if (fe?.code === "functions/resource-exhausted" || fe?.code === "functions/failed-precondition" || fe?.code === "functions/permission-denied" || fe?.code === "functions/invalid-argument") return fe.message;
  if (fe?.code === "functions/deadline-exceeded") return "That took too long — try a narrower question.";
  return "The agent couldn't answer just now — please try again.";
}

const LEVEL_TONE: Record<Signal["level"], string> = { high: "bg-destructive/10 text-destructive", medium: "bg-amber-100 text-amber-800", low: "bg-primary/10 text-primary" };
const LEVEL_WORD: Record<Signal["level"], string> = { high: "Now", medium: "This week", low: "Opportunity" };
const STAGE: Record<Pulse["stage"], { label: string; tone: string }> = {
  slipping: { label: "Slipping", tone: "bg-destructive/10 text-destructive" }, late: { label: "Overdue", tone: "bg-amber-100 text-amber-800" },
  due: { label: "Due now", tone: "bg-primary/10 text-primary" }, growing: { label: "Growing", tone: "bg-success/10 text-success" },
  steady: { label: "Steady", tone: "bg-secondary text-muted-foreground" }, new: { label: "New", tone: "bg-secondary text-muted-foreground" },
};

export function AiOfficePage() {
  const { user } = useAuth();
  const db = useDb();
  const office = useOffice(true);
  const name = agentName();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.includes(sp.get("t") as Tab) ? sp.get("t") : "today") as Tab;
  const setTab = (t: Tab) => setSp(p => { const n = new URLSearchParams(p); n.set("t", t); return n; }, { replace: true });
  const [prefs, setPrefs] = useState<Prefs>(() => { try { return { ...PREF_DEFAULT, ...JSON.parse(store.get(PREF) || "{}") }; } catch { return PREF_DEFAULT; } });
  const setPref = (p: Partial<Prefs>) => setPrefs(x => { const n = { ...x, ...p }; store.set(PREF, JSON.stringify(n)); return n; });
  const language = prefs.lang === "auto" ? undefined : prefs.lang;
  const notes = office.memory.map(n => n.text);

  // Today's market rate for fine gold, for the margin guard (tools and signals).
  const rates = useRates();
  const fineNow = liveFineInr(rates?.price);
  useEffect(() => { setOfficeContext({ fineNowInr: fineNow }); }, [fineNow]);

  const today = todayKey();
  const brief = office.briefs.find(b => b.date === today);
  const lastBrief = office.briefs[0];
  const proposed = office.actions.filter(a => a.status === "proposed");
  const signals = useMemo(() => growthSignals(db, new Date(), fineNow), [db, fineNow]);
  const highSignals = signals.filter(s => s.level === "high").length;
  const pulses = useMemo(() => allPulses(db), [db]);
  const atRisk = pulses.filter(p => p.stage === "slipping" || p.stage === "late").length;

  const stats = useMemo(() => {
    const orders = db.orders.filter(o => !o.deletedAt);
    const k = kpis(db, orders, presetPeriod("thisMonth"), false);
    return { k, owed: receivables(orders), late: lateOpen(orders).length, open: orders.filter(o => ["Waiting", "Approved", "In Production", "Ready"].includes(o.status) && !o.forReadyStock).length };
  }, [db]);

  // ── Speaking ──
  const speaking = useRef<{ stop: () => void } | null>(null);
  const [talking, setTalking] = useState<"loading" | "speaking" | null>(null);
  const stopSpeaking = () => { speaking.current?.stop(); speaking.current = null; setTalking(null); };
  const say = async (text: string, heard?: string | null) => {
    stopSpeaking();
    setTalking("loading");
    const s = speak(text, { voice: prefs.voice, pace: prefs.pace, language: speechLanguage(text, heard), onStart: () => setTalking("speaking") });
    speaking.current = s;
    try { await s.done; } catch (e) { toast.error(errorText(e)); }
    if (speaking.current === s) { speaking.current = null; setTalking(null); }
  };
  useEffect(() => () => speaking.current?.stop(), []);

  // ── The brief ──
  const [briefing, setBriefing] = useState<string | null>(null);
  const makeBrief = async () => {
    if (briefing) return;
    setBriefing("Gathering today's figures…");
    try {
      const d = loadDb();
      // The day's figures go in as the answers to the tools that give them — the agent starts from them.
      const pre: [string, string][] = [["business_snapshot", '{"period":"thisMonth"}'], ["growth_signals", "{}"], ["client_pulse", '{"limit":8}'], ["money_due", '{"limit":10}'], ["margin_guard", '{"limit":8}'], ["factories", '{"period":"last30"}'], ["team", '{"period":"thisMonth"}']];
      const calls = pre.map(([n, args], i) => ({ id: `pre_${i}`, type: "function" as const, function: { name: n, arguments: args } }));
      const history: ChatMessage[] = [
        { role: "user", content: `Write today's morning brief (${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}).` },
        { role: "assistant", content: "", tool_calls: calls },
        ...calls.map(c => ({ role: "tool" as const, tool_call_id: c.id, content: JSON.stringify(runTool(d, c.function.name, c.function.arguments, [])).slice(0, 20000) })),
      ];
      setBriefing("Writing the brief…");
      const r = await askOffice(history, { mode: "brief", language, notes, onStep: t => setBriefing(`Looking at ${STEP_WORDS[t] ?? t}…`) });
      await saveBrief({ date: today, text: r.text, at: new Date().toISOString(), by: user!.id, tokens: r.tokens, proof: r.proof, ...(language ? { language } : {}) });
      const n = await keepActions(r.actions, "brief", user!.id, office.actions);
      toast.success(n ? `Today's brief is ready — ${n} next step${n > 1 ? "s" : ""} to approve` : "Today's brief is ready");
    } catch (e) {
      toast.error(errorText(e));
    } finally { setBriefing(null); }
  };

  // ── Ask ──
  const [chat, setChat] = useState<ChatMessage[]>(() => { try { return JSON.parse(store.get(CHAT_KEY) || "[]"); } catch { return []; } });
  useEffect(() => store.set(CHAT_KEY, JSON.stringify(chat.slice(-60))), [chat]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [chat, asking]);
  const ask = async (q?: string, heard?: string | null) => {
    const text = (q ?? input).trim();
    if (!text || asking) return;
    if (tab !== "ask") setTab("ask");
    setInput(""); setFailed("");
    const history: ChatMessage[] = [...chat, { role: "user", content: text }];
    setChat(history);
    setAsking("Thinking…");
    try {
      const r = await askOffice(history, { mode: "ask", language, notes, onStep: t => setAsking(`Looking at ${STEP_WORDS[t] ?? t}…`) });
      setChat(r.messages);
      const n = await keepActions(r.actions, "ask", user!.id, office.actions);
      if (n) toast.success(`${n} next step${n > 1 ? "s" : ""} added to Actions`);
      setAsking(null);
      // Spoken back when asked by voice, or when replies are set to be spoken.
      if (prefs.speakReplies || heard !== undefined) {
        await say(r.text, heard);
        if (prefs.handsFree && heard !== undefined) void listen();
      }
    } catch (e) {
      setFailed(errorText(e));
    } finally { setAsking(null); }
  };

  // ── Listening ──
  const mic = useRecorder(55);
  const [hearing, setHearing] = useState(false);
  const listen = async () => {
    stopSpeaking();
    try { await mic.start(); } catch { toast.error("The microphone isn't available — allow it in the browser to speak to the agent."); }
  };
  const doneListening = async () => {
    const blob = await mic.stop();
    if (!blob || blob.size < 1500) { toast.message("Didn't catch that — hold on a moment longer."); return; }
    setHearing(true);
    try {
      const h = await hear(blob);
      if (!h.text) { toast.message("Didn't catch that — please say it again."); return; }
      await ask(h.text, h.language);
    } catch (e) { toast.error(errorText(e)); } finally { setHearing(false); }
  };
  const shown = chat.filter(m => (m.role === "user" || m.role === "assistant") && m.content.trim());

  const suggestions = [
    "What needs my attention today?",
    "Which clients are slipping away, and what should we offer each?",
    "Which open orders lose the most margin from the gold rate?",
    "Who owes us the most, and since when?",
    "How did this month compare with last month — sales, profit, collections?",
    "આ મહિને સૌથી વધુ વેચાણ કઈ ડિઝાઇનનું થયું?",
    "कौन से ऑर्डर लेट हैं और किसके पास हैं?",
    "Give each team member one task for this week that grows sales.",
  ];

  // ── Memory ──
  const [newNote, setNewNote] = useState("");
  const addNote = async () => {
    const text = newNote.trim().slice(0, 300);
    if (!text) return;
    if (office.memory.length >= 30) { toast.error("30 notes at most — remove one first."); return; }
    await saveMemory([...office.memory, { id: uid("mem_"), text, at: new Date().toISOString(), by: user!.id }]);
    setNewNote("");
    toast.success(`${name} will keep that in mind`);
  };
  const removeNote = (n: MemoryNote) => void saveMemory(office.memory.filter(x => x.id !== n.id));

  const pulseTask = async (p: Pulse) => {
    const n = await keepActions([{ title: p.nextStep, why: p.reasons.length ? p.reasons.join("; ") : `${STAGE[p.stage].label} — next order due ${p.nextDue ?? "—"}`, clientName: p.name, priority: p.stage === "slipping" ? "high" : "medium", dueInDays: p.stage === "slipping" ? 2 : 5 }], "ask", user!.id, office.actions);
    toast.success(n ? "Added to Actions — approve it to someone" : "It's already in Actions today");
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader
        title={name}
        subtitle={`${brandName()} · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}`}
        actions={
          <Select value={prefs.lang} onValueChange={v => setPref({ lang: v })}>
            <SelectTrigger aria-label="Answer language" className="h-9 w-[150px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGS.map(x => <SelectItem key={x.v} value={x.v}>{x.l}</SelectItem>)}</SelectContent>
          </Select>
        }
      />
      <TabBar label={name} value={tab} onChange={setTab} className="w-fit max-w-full"
        tabs={[
          { key: "today", label: "Today", icon: Sun },
          { key: "ask", label: "Ask", icon: MessageSquare },
          { key: "clients", label: "Clients", icon: Users, count: atRisk || undefined },
          { key: "actions", label: "Actions", icon: ClipboardList, count: proposed.length || undefined },
          { key: "signals", label: "Signals", icon: Lightbulb, count: highSignals || undefined },
          { key: "memory", label: "Memory", icon: BookOpen },
        ]} />

      {tab === "today" && (
        <div className="space-y-4">
          <StatStrip items={[
            { label: "Sales this month", value: usd(stats.k.salesUsd), sub: `${stats.k.soldCount} orders`, tone: "in" },
            { label: "Collected", value: usd(stats.k.collectedUsd), tone: "in" },
            { label: "Owed to us", value: usd(stats.owed.total), sub: stats.owed.d90 ? `${usd(stats.owed.d90)} over 90 days` : undefined, tone: "out" },
            { label: "Open orders", value: String(stats.open), sub: stats.late ? `${stats.late} late` : "none late" },
          ]} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
            <section className="card-luxe p-4 sm:p-5 space-y-3 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-display text-lg text-brand-dark flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Today&rsquo;s brief</p>
                  <p className="text-xs text-muted-foreground">{brief ? `Made ${new Date(brief.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} by ${db.users.find(u => u.id === brief.by)?.name ?? "an admin"}` : "From today's figures — money, orders, clients, gold, factories and the team."}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {brief && (talking
                    ? <Button size="sm" variant="outline" className="gap-1.5" onClick={stopSpeaking}><Square className="h-3.5 w-3.5" />Stop</Button>
                    : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void say(brief.text)}><Headphones className="h-4 w-4" />Listen</Button>)}
                  <Button size="sm" variant={brief ? "outline" : "default"} className="gap-1.5" disabled={!!briefing} onClick={() => void makeBrief()}>
                    {briefing ? <Loader2 className="h-4 w-4 animate-spin" /> : brief ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{brief ? "Make again" : "Make today's brief"}
                  </Button>
                </div>
              </div>
              {talking === "loading" && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Getting the voice ready…</p>}
              {briefing && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{briefing}</p>}
              {brief ? <><Reply text={brief.text} db={db} proof={brief.proof} /><ProofLine proof={brief.proof} /></>
                : !briefing && (lastBrief ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">The last brief, from {lastBrief.date}:</p>
                    <div className="opacity-70"><Reply text={lastBrief.text} db={db} proof={lastBrief.proof} /></div>
                  </div>
                ) : <p className="text-sm text-muted-foreground">No brief yet today. It takes about half a minute — the figures are the app&rsquo;s own; {name} explains them, checks every figure, and suggests what to do.</p>)}
            </section>
            <section className="card-luxe p-4 sm:p-5 space-y-3 min-w-0">
              <p className="font-display text-lg text-brand-dark">Waiting for you</p>
              {proposed.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to approve. Next steps {name} suggests appear here.</p>
                : proposed.slice(0, 5).map(a => <ActionCard key={a.id} a={a} db={db} me={{ id: user!.id, name: user!.name }} compact />)}
              {proposed.length > 5 && <button className="text-sm text-primary hover:underline" onClick={() => setTab("actions")}>All {proposed.length} →</button>}
              <div className="pt-2 border-t border-border/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Needs attention now</p>
                {signals.filter(s => s.level === "high").slice(0, 4).map((s, i) => <p key={i} className="text-sm py-0.5"><span className="font-medium">{s.title}</span> <span className="text-muted-foreground">— {s.detail}</span></p>)}
                {!highSignals && <p className="text-sm text-muted-foreground">Nothing urgent.</p>}
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "ask" && (
        <div className="card-luxe p-0 overflow-hidden flex flex-col h-[calc(100dvh-15rem)] min-h-[440px]">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/60 flex-wrap">
            <p className="text-xs text-muted-foreground">Answers from the app&rsquo;s own figures — every figure checked.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={prefs.speakReplies} onCheckedChange={v => setPref({ speakReplies: v })} aria-label="Speak the answers" />{prefs.speakReplies ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}Speak</label>
              <Select value={prefs.voice} onValueChange={v => setPref({ voice: v })}>
                <SelectTrigger aria-label="Voice" className="h-8 w-[100px] rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{VOICE_CHOICES.map(v => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={String(prefs.pace)} onValueChange={v => setPref({ pace: Number(v) })}>
                <SelectTrigger aria-label="Speed" className="h-8 w-[84px] rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{[0.9, 1, 1.1, 1.25].map(v => <SelectItem key={v} value={String(v)}>{v === 1 ? "Normal" : `${v}×`}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="After an answer is spoken, it listens again — talk without touching the screen."><Switch checked={prefs.handsFree} onCheckedChange={v => setPref({ handsFree: v })} aria-label="Conversation mode" />Conversation</label>
              {shown.length > 0 && <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { setChat([]); setFailed(""); stopSpeaking(); }}><SquarePen className="h-4 w-4" />New</Button>}
            </div>
          </div>
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
            {shown.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Type, or tap the microphone and speak — in Gujarati, Hindi or English.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {suggestions.map(s => (
                    <button key={s} type="button" onClick={() => void ask(s)} className="text-left rounded-xl border border-border/70 bg-white px-3 py-2.5 text-sm hover:border-primary/50 hover:bg-primary/5">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {shown.map((m, i) => m.role === "user"
              ? <div key={i} className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3.5 py-2 text-sm whitespace-pre-wrap">{m.content}</p></div>
              : (
                <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md border border-border/70 bg-white px-4 py-3">
                  <Reply text={m.content} db={db} proof={m.proof} />
                  <div className="flex items-start justify-between gap-2">
                    <ProofLine proof={m.proof} tools={m.tools} />
                    <button type="button" aria-label="Read it aloud" title="Read it aloud" className="mt-2 h-7 w-7 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" onClick={() => void say(m.content)}><Volume2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            {(asking || hearing) && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{hearing ? "Listening to what you said…" : asking}</p>}
            {talking && <p className="text-sm text-primary flex items-center gap-2">{talking === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4 animate-pulse" />}{talking === "loading" ? "Getting the voice ready…" : `${name} is speaking`}<button className="text-xs underline text-muted-foreground" onClick={stopSpeaking}>Stop</button></p>}
            {failed && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{failed} <button className="underline" onClick={() => { const q = [...chat].reverse().find(m => m.role === "user")?.content; if (q) { setChat(c => c.slice(0, c.map(x => x.role).lastIndexOf("user"))); void ask(q); } }}>Try again</button></p>}
          </div>
          <form className="border-t border-border/60 p-3 flex items-end gap-2" onSubmit={e => { e.preventDefault(); void ask(); }}>
            {mic.supported && (mic.recording ? (
              <Button type="button" size="icon" className="h-10 w-10 rounded-xl shrink-0 bg-destructive hover:bg-destructive/90 animate-pulse" aria-label="Stop and send" onClick={() => void doneListening()}><Square className="h-4 w-4" /></Button>
            ) : (
              <Button type="button" size="icon" variant="outline" className="h-10 w-10 rounded-xl shrink-0" aria-label="Speak" disabled={!!asking || hearing} onClick={() => void listen()}><Mic className="h-4 w-4" /></Button>
            ))}
            {mic.recording ? (
              <div className="flex-1 h-10 rounded-xl border border-destructive/40 bg-destructive/5 px-3 flex items-center gap-2 text-sm text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />Listening… {mic.seconds}s — tap ■ when you&rsquo;re done
              </div>
            ) : (
              <textarea value={input} onChange={e => setInput(e.target.value)} rows={1} aria-label={`Ask ${name}`}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}
                placeholder="Ask about sales, clients, orders, gold, factories, stock, the team…" className="flex-1 resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-sm max-h-40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            )}
            <Button type="submit" size="icon" className="h-10 w-10 rounded-xl shrink-0" disabled={!input.trim() || !!asking || mic.recording} aria-label="Ask"><ArrowUp className="h-4 w-4" /></Button>
          </form>
        </div>
      )}

      {tab === "clients" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Each client against their own rhythm — how often they order, what they buy, how fast they pay. Worked out by the app (no AI); most at risk first.</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {(["slipping", "late", "due", "growing", "steady", "new"] as const).map(k => { const n = pulses.filter(p => p.stage === k).length; return n ? <span key={k} className={`rounded-md px-2 py-0.5 font-medium ${STAGE[k].tone}`}>{STAGE[k].label} · {n}</span> : null; })}
          </div>
          {pulses.length === 0 && <div className="card-luxe p-8 text-center text-sm text-muted-foreground">No client orders yet.</div>}
          {pulses.map(p => (
            <div key={p.clientId} className="card-luxe px-4 py-3 space-y-1.5">
              <div className="flex items-start gap-3 flex-wrap">
                <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STAGE[p.stage].tone}`}>{STAGE[p.stage].label}</span>
                <div className="min-w-0 flex-1">
                  <Link to={`/clients/${p.clientId}`} className="text-sm font-medium hover:underline">{p.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    {p.orders} orders{p.usualGapDays ? ` · every ~${p.usualGapDays} days` : ""}{p.daysSinceLast != null ? ` · last ${p.daysSinceLast} days ago` : ""}
                    {p.nextDue ? ` · next due ${p.nextDue}${p.daysPastDue != null && p.daysPastDue > 0 ? ` (${p.daysPastDue} days over)` : ""}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Usually {[p.usual.karat, p.usual.metal && !/gold/i.test(p.usual.metal) ? p.usual.metal : null, p.usual.item].filter(Boolean).join(" ") || "—"}{p.usual.typicalUsd ? ` ~${usd(p.usual.typicalUsd)}` : ""}
                    {p.payDaysRecent != null ? ` · pays in ~${p.payDaysRecent} days` : ""}{p.owedUsd ? ` · owes ${usd(p.owedUsd)}` : ""}
                  </p>
                </div>
                <div className="w-28 shrink-0">
                  <p className="text-[10px] text-muted-foreground text-right">Risk {p.risk}</p>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${p.risk >= 45 ? "bg-destructive" : p.risk >= 20 ? "bg-amber-500" : "bg-success"}`} style={{ width: `${Math.max(4, p.risk)}%` }} /></div>
                </div>
              </div>
              {p.reasons.length > 0 && <ul className="text-xs text-foreground/80 list-disc pl-5">{p.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <p className="text-xs flex-1 min-w-[12rem]"><span className="font-medium">Next:</span> {p.nextStep}</p>
                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => void pulseTask(p)}><Plus className="h-3.5 w-3.5" />Make it a task</Button>
                <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => void ask(`Tell me about ${p.name}: what's changed, what they usually buy, and exactly what we should offer them now.`)}><Sparkles className="h-3.5 w-3.5" />Ask</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "actions" && (
        <div className="space-y-3">
          {office.actions.length === 0 && <div className="card-luxe p-8 text-center text-sm text-muted-foreground">No actions yet. Make today&rsquo;s brief, ask a question, or turn a client&rsquo;s next step into a task — they come here for you to approve.</div>}
          {proposed.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waiting for approval · {proposed.length}</p>}
          {proposed.map(a => <ActionCard key={a.id} a={a} db={db} me={{ id: user!.id, name: user!.name }} />)}
          {office.actions.some(a => a.status !== "proposed") && <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decided</p>}
          {office.actions.filter(a => a.status !== "proposed").slice(0, 40).map(a => <ActionCard key={a.id} a={a} db={db} me={{ id: user!.id, name: user!.name }} />)}
        </div>
      )}

      {tab === "signals" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Worked out by the app&rsquo;s own rules from today&rsquo;s records — no AI: money, late work, clients&rsquo; rhythm, gold rate against open orders{fineNow ? ` (₹${Math.round(fineNow).toLocaleString("en-IN")}/g fine today)` : ""}, prices, purchase costs, factories, stock.</p>
          {signals.length === 0 && <div className="card-luxe p-8 text-center text-sm text-muted-foreground">Nothing stands out today.</div>}
          {signals.map((s, i) => (
            <div key={i} className="card-luxe px-4 py-3 flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${LEVEL_TONE[s.level]}`}>{LEVEL_WORD[s.level]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.detail}</p>
                <SignalLinks s={s} db={db} />
              </div>
              <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => void ask(`${s.title}. ${s.detail} What should we do about it, and who should do it?`)}><Sparkles className="h-3.5 w-3.5" />Ask</Button>
            </div>
          ))}
        </div>
      )}

      {tab === "memory" && (
        <div className="card-luxe p-4 sm:p-5 space-y-3 max-w-3xl">
          <div>
            <p className="font-display text-lg text-brand-dark">What {name} should know</p>
            <p className="text-xs text-muted-foreground">Facts about the business it can&rsquo;t see in the records — kept with every question and brief. Every admin shares them.</p>
          </div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void addNote(); }}>
            <Input value={newNote} onChange={e => setNewNote(e.target.value)} maxLength={300} placeholder="e.g. Mel White always pays after Diwali" aria-label="Teach the agent" className="h-10 rounded-xl" />
            <Button type="submit" className="h-10 gap-1.5 shrink-0" disabled={!newNote.trim()}><Plus className="h-4 w-4" />Add</Button>
          </form>
          {office.memory.length === 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>For example:</p>
              {["Never offer more than 5% discount without asking me", "Givara prefers 14K white gold and orders before Christmas", "Shreeji is our best factory for rings; Krishna for chains", "Our target this year: $50,000 a month in sales"].map(x => (
                <button key={x} type="button" className="block text-left text-primary hover:underline" onClick={() => setNewNote(x)}>{x}</button>
              ))}
            </div>
          )}
          <div className="divide-y divide-border/60">
            {office.memory.map(n => (
              <div key={n.id} className="flex items-start gap-2 py-2">
                <p className="text-sm flex-1">{n.text}<span className="block text-[11px] text-muted-foreground">{db.users.find(u => u.id === n.by)?.name ?? "An admin"} · {n.at.slice(0, 10)}</span></p>
                <button type="button" aria-label="Remove" className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeNote(n)}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SignalLinks({ s, db }: { s: Signal; db: DB }) {
  const orders = (s.orderIds ?? []).slice(0, 6).map(id => db.orders.find(o => o.id === id)).filter(Boolean);
  const client = s.clientId ? db.clients.find(c => c.id === s.clientId) : undefined;
  const factory = s.factoryId ? db.factories.find(f => f.id === s.factoryId) : undefined;
  if (!orders.length && !client && !factory) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {client && <Link to={`/clients/${client.id}`} className="text-primary hover:underline">{client.companyName || client.ownerName}</Link>}
      {factory && <Link to={`/factories/${factory.id}`} className="text-primary hover:underline">{factory.name}</Link>}
      {orders.map(o => <Link key={o!.id} to={`/orders/${o!.id}`} className="text-primary hover:underline">{o!.orderNumber}</Link>)}
    </p>
  );
}

/** One proposed task: why, who, approve (it becomes their task) or dismiss. */
function ActionCard({ a, db, me, compact }: { a: OfficeAction; db: DB; me: { id: string; name: string }; compact?: boolean }) {
  const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive").sort((x, y) => x.name.localeCompare(y.name));
  const [to, setTo] = useState(() => suggestAssignee(db, a) ?? me.id);
  const [busy, setBusy] = useState(false);
  const order = a.orderId ? db.orders.find(o => o.id === a.orderId) : undefined;
  const client = a.clientId ? db.clients.find(c => c.id === a.clientId) : undefined;
  const who = db.users.find(u => u.id === a.assignedTo)?.name;
  const task = a.taskId ? (db.tasks ?? []).find(t => t.id === a.taskId) : undefined;
  return (
    <div className={`rounded-xl border px-3.5 py-3 space-y-2 ${a.status === "proposed" ? "border-border/70 bg-white" : "border-border/40 bg-secondary/30"}`}>
      <div className="flex items-start gap-2">
        {a.priority === "high" && a.status === "proposed" && <span className="mt-0.5 shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">Urgent</span>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{a.title}</p>
          {!compact && a.why && <p className="text-xs text-muted-foreground mt-0.5">{a.why}</p>}
          <p className="text-xs mt-0.5 flex flex-wrap gap-x-2">
            {order && <Link to={`/orders/${order.id}`} className="text-primary hover:underline">{order.orderNumber}</Link>}
            {client && <Link to={`/clients/${client.id}`} className="text-primary hover:underline">{client.companyName || client.ownerName}</Link>}
            {a.dueInDays && a.status === "proposed" && <span className="text-muted-foreground">within {a.dueInDays} day{a.dueInDays > 1 ? "s" : ""}</span>}
          </p>
        </div>
      </div>
      {a.status === "proposed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger aria-label={`Who does: ${a.title}`} className="h-8 w-[170px] rounded-lg text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}{u.id === me.id ? " (me)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1" disabled={busy} onClick={async () => { setBusy(true); try { await approveAction(a, to, me); toast.success(`Given to ${staff.find(u => u.id === to)?.name ?? "them"}`); } catch { toast.error("Couldn't approve it — try again."); } finally { setBusy(false); } }}><Check className="h-3.5 w-3.5" />Approve</Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1 text-muted-foreground" disabled={busy} onClick={async () => { setBusy(true); try { await dismissAction(a, me.id); } finally { setBusy(false); } }}><X className="h-3.5 w-3.5" />Dismiss</Button>
          {a.assignee && <span className="text-[11px] text-muted-foreground">Suggested: {a.assignee}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          {a.status === "approved" ? <><CheckCircle2 className={`h-3.5 w-3.5 ${task?.completed ? "text-success" : "text-primary"}`} />Given to {who ?? "someone"}{task ? (task.completed ? " — done" : " — open") : ""}</> : <>Dismissed</>}
        </p>
      )}
    </div>
  );
}
