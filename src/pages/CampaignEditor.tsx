// One campaign. While a draft: write it (with AI or block by block), choose
// who it goes to, test it, send it — the email beside it on a laptop or a
// phone all along, drawn by the code it is sent with. Saved as it is typed;
// every AI rewrite keeps the version before it. Once started: how it is
// going — every person's email, what went, what didn't and why — with pause,
// resume, cancel and try again.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, Clock, Copy, FlaskConical, History, Mail, Pause, Play, RefreshCw, RotateCcw, Send, Sparkles, Trash2, Users, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { SectionTitle } from "@/components/SectionTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MoreAction } from "@/components/MoreMenu";
import { EmailPreview, type PreviewPerson } from "@/components/campaigns/EmailPreview";
import { BlockEditor } from "@/components/campaigns/BlockEditor";
import { AudiencePicker, countAudience } from "@/components/campaigns/AudiencePicker";
import { ImagePicker, type PickedPiece } from "@/components/campaigns/ImagePicker";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { confirmBox } from "@/lib/confirm";
import { fmtDate, timeAgo } from "@/lib/db";
import { BUILTIN, useBrand } from "@/lib/brand";
import { cleanDesign, designProblems, renderCampaign, type CampaignDesign, type RenderCtx } from "@/lib/pure/campaignEmail";
import {
  AI_LANGUAGES, AI_TONES, aiWrite, control, createDraft, designHash, runNow, saveDraft, saveVersion, sendTest, startCampaign,
  STATUS_LABEL, STATUS_TONE, useCampaign, useCampaignSettings, useRecipients, useSendInfo, useSuppressed, useVersions,
  type Audience, type Campaign, type CampaignSettings, type Recipient, type RecipientStatus,
} from "@/lib/campaigns";

const nf = (n: number) => n.toLocaleString("en-IN");
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

/** The frame around the email: who sends it, the logo, the footer — as the server will draw it. */
function useCtx(s: CampaignSettings | undefined, fallbackName: string): Omit<RenderCtx, "subject" | "preheader" | "vars" | "reason"> & { fromName: string } {
  return useMemo(() => {
    const fromName = s?.fromName?.trim() || fallbackName;
    return {
      fromName, brandName: fromName, logoUrl: s?.logoUrl || `${location.origin}${BUILTIN.wide ?? BUILTIN.logo}`, logoWidth: s?.logoWidth || 170,
      address: s?.address || undefined, contact: s?.contact || undefined,
    };
  }, [s, fallbackName]);
}

/* ─────────────── A draft ─────────────── */

function AiPanel({ c, design, subject, preheader, onResult }: {
  c: Campaign; design: CampaignDesign; subject: string; preheader: string;
  onResult: (r: { subjects: string[]; preheader: string; design: CampaignDesign }, mode: "write" | "change") => void;
}) {
  const brand = useBrand();
  const [brief, setBrief] = useState("");
  const [lang, setLang] = useState(AI_LANGUAGES[0]);
  const [tone, setTone] = useState(AI_TONES[0]);
  const [pieces, setPieces] = useState<PickedPiece[]>([]);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState<"" | "write" | "change">("");
  const has = design.blocks.length > 0;
  const a = c.audience ?? {};
  const who = (a.allClients || a.clientIds?.length) && (a.allEmployees || a.userIds?.length) ? "both" : (a.allEmployees || a.userIds?.length) ? "employees" : "clients";
  const go = async (mode: "write" | "change") => {
    if (brief.trim().length < 6) { toast.error(mode === "change" ? "Say what to change" : "Say what the email is about — a sentence or two"); return; }
    setBusy(mode);
    try {
      const r = await aiWrite({ mode, brief, language: lang, tone, audience: who, pieces: pieces.map(p => ({ title: p.title, sub: p.sub, src: p.src })),
        current: mode === "change" ? { subject, preheader, design } : undefined, brandColor: brand.color });
      onResult(r, mode);
      toast.success(mode === "change" ? "Changed — the earlier one is kept in Versions" : "Written — read it through, change anything");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 space-y-3">
      <SectionTitle title="Write it with AI" icon={Sparkles} sub="Say what it's about — it writes the subject, the words and the layout" />
      <Textarea rows={3} className="rounded-xl bg-white" maxLength={2000} value={brief} onChange={e => setBrief(e.target.value)}
        placeholder={has ? "What to change — e.g. “make it shorter, add a line about free shipping on orders over $5,000”" : "e.g. “Our new lab-grown diamond bridal collection is ready — 40 designs in 14K and 18K, ships in 10 days. Invite clients to see the catalogue.”"} />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={lang} onValueChange={setLang}><SelectTrigger aria-label="Language" className="h-9 w-36 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent>{AI_LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select>
        <Select value={tone} onValueChange={setTone}><SelectTrigger aria-label="Tone" className="h-9 w-52 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent>{AI_TONES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" size="sm" className="h-9 rounded-xl bg-white" onClick={() => setPick(true)}>{pieces.length ? `${pieces.length} piece${pieces.length === 1 ? "" : "s"} to show` : "Pieces to show (optional)"}</Button>
        {pieces.length > 0 && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPieces([])}>clear</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="gap-1.5" disabled={!!busy} onClick={() => void (has ? confirmBox("Write a new email over this one?\n\nThis one is kept in Versions.", { confirmText: "Write a new one" }).then(ok => { if (ok) void go("write"); }) : go("write"))}>
          <Sparkles className="h-4 w-4" />{busy === "write" ? "Writing…" : has ? "Write a new one" : "Write it"}</Button>
        {has && <Button variant="outline" className="gap-1.5 bg-white" disabled={!!busy} onClick={() => void go("change")}>{busy === "change" ? "Changing…" : "Change this one"}</Button>}
      </div>
      <p className="text-[11px] text-muted-foreground">It never makes up prices, dates or links — only what you write here. Pictures only from the pieces you pick.</p>
      <ImagePicker open={pick} multi onClose={() => setPick(false)} onPick={p => setPieces([...pieces, ...p].slice(0, 12))} />
    </div>
  );
}

function VersionsSheet({ c, open, onClose, onRestore }: { c: Campaign; open: boolean; onClose: () => void; onRestore: (v: { subject: string; preheader?: string; design: CampaignDesign }) => void }) {
  const v = useVersions(open ? c.id : undefined);
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} icon={History} title="Versions" description="Earlier versions of this email — the last 30">
      {!v.rows.length && <p className="text-sm text-muted-foreground py-6 text-center">{v.loading ? "Loading…" : "No earlier version yet. One is kept before every AI rewrite, and when you press Save a version."}</p>}
      <ul className="space-y-2">
        {v.rows.map(x => (
          <li key={x.id} className="rounded-xl border border-border p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{x.subject || "No subject"}</p><p className="text-xs text-muted-foreground">{x.label} · {fmtDate(x.at)} · {timeAgo(x.at)} · {x.design.blocks?.length ?? 0} blocks</p></div>
            <Button size="sm" variant="outline" onClick={async () => {
              if (!(await confirmBox("Go back to this version?\n\nThe email as it is now is kept as a version too.", { confirmText: "Go back" }))) return;
              onRestore(x); onClose();
            }}><RotateCcw className="h-3.5 w-3.5 mr-1" />Use this</Button>
          </li>
        ))}
      </ul>
    </ActionSheet>
  );
}

function DraftEditor({ c }: { c: Campaign }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const db = useDb();
  const brand = useBrand();
  const settings = useCampaignSettings();
  const [infoTick, setInfoTick] = useState(0);
  const info = useSendInfo(infoTick);
  const supp = useSuppressed();
  const ctx = useCtx(settings, info?.fromName || brand.name || BUILTIN.name);
  const [tab, setTab] = useState<"write" | "to" | "send" | "preview">("write");
  const [name, setName] = useState(c.name);
  const [subject, setSubject] = useState(c.subject ?? "");
  const [preheader, setPreheader] = useState(c.preheader ?? "");
  const [design, setDesign] = useState<CampaignDesign>(cleanDesign(c.design));
  const [audience, setAudience] = useState<Audience>(c.audience ?? {});
  const [suggest, setSuggest] = useState<string[]>([]);
  const [save, setSave] = useState<"saved" | "saving" | "error">("saved");
  const [versions, setVersions] = useState(false);
  const [testTo, setTestTo] = useState(() => user?.email ?? "");
  const [asRef, setAsRef] = useState("");
  const [busy, setBusy] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [hash, setHash] = useState("");
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Saved as it is typed (a moment after the last key).
  const flush = async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSave("saving");
    try { await saveDraft(c.id, { name, subject, preheader, design, audience }); setSave("saved"); }
    catch (e) { dirty.current = true; setSave("error"); throw e; }
  };
  const changed = () => { dirty.current = true; setSave("saving"); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { void flush().catch(() => undefined); }, 900); };
  useEffect(() => { if (dirty.current) changed(); }, [name, subject, preheader, design, audience]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (dirty.current) void saveDraft(c.id, { name, subject, preheader, design, audience }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = <T,>(set: (v: T) => void) => (v: T) => { dirty.current = true; set(v); };
  useEffect(() => { let on = true; void designHash(subject, preheader, design).then(h => on && setHash(h)); return () => { on = false; }; }, [subject, preheader, design]);
  const tested = !!c.testedHash && c.testedHash === hash;

  // Who it could be previewed as: the people it goes to (first 100 with an email).
  const people = useMemo(() => {
    const out: { ref: string; label: string; p: PreviewPerson }[] = [];
    const cIds = new Set(audience.clientIds ?? []), uIds = new Set(audience.userIds ?? []);
    for (const x of db.clients) if ((audience.allClients ? x.status !== "inactive" : cIds.has(x.id)) && EMAIL_RE.test((x.email ?? "").split(/[,;\s]+/)[0] ?? "")) out.push({ ref: `client:${x.id}`, label: `${x.companyName || x.ownerName} (client)`, p: { kind: "client", name: x.ownerName || x.companyName, company: x.companyName } });
    for (const u of db.users) if ((u.role === "admin" || u.role === "employee") && (audience.allEmployees ? u.status !== "inactive" : uIds.has(u.id)) && EMAIL_RE.test(u.email ?? "")) out.push({ ref: `user:${u.id}`, label: `${u.name} (team)`, p: { kind: "employee", name: u.name } });
    return out.slice(0, 100);
  }, [db.clients, db.users, audience]);
  const person: PreviewPerson = people.find(x => x.ref === asRef)?.p ?? people[0]?.p ?? { kind: "client", name: "Ravi Mehta", company: "Mehta Jewellers" };
  const count = countAudience(audience, db.clients, db.users, new Set(supp.rows.map(s => s.email.toLowerCase())));
  const rendered = useMemo(() => renderCampaign(design, { ...ctx, subject }), [design, ctx, subject]);
  const stops = designProblems(design, subject, rendered).filter(p => p.level === "stop");

  const onAi = async (r: { subjects: string[]; preheader: string; design: CampaignDesign }, mode: "write" | "change") => {
    if (design.blocks.length) await saveVersion({ id: c.id, subject, preheader, design }, user!.id, mode === "change" ? "Before an AI change" : "Before an AI rewrite").catch(() => undefined);
    dirty.current = true;
    setDesign(r.design);
    setSuggest(r.subjects);
    if (mode === "write" || !subject.trim()) setSubject(r.subjects[0] ?? subject);
    if (mode === "write" || !preheader.trim()) setPreheader(r.preheader || preheader);
  };
  const test = async () => {
    const to = [...new Set(testTo.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
    if (!to.length || to.length > 5 || !to.every(e => EMAIL_RE.test(e))) { toast.error("Up to 5 valid addresses, with commas between"); return; }
    setBusy("test");
    try {
      dirty.current = true; await flush();
      const r = await sendTest(c.id, to, asRef || people[0]?.ref);
      if (r.sent.length) toast.success(`Test sent to ${r.sent.join(", ")} — check the inbox (and spam) on a laptop and a phone`);
      if (r.failed.length) toast.error(`Not sent: ${r.failed.join("; ")}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  const start = async () => {
    const later = when === "later";
    const t = later ? Date.parse(at) : NaN;
    if (later && (!Number.isFinite(t) || t < Date.now() + 60_000)) { toast.error("Choose a time in the future"); return; }
    const days = info ? Math.max(1, Math.ceil(count.emails / Math.max(1, info.dailyBudget))) : 1;
    if (!(await confirmBox([
      `Send “${subject}” to ${nf(count.emails)} ${count.emails === 1 ? "person" : "people"}${later ? ` on ${new Date(t).toLocaleString()}` : " now"}?`,
      info ? `It goes out from ${info.sender}, ${info.dailyBudget} a day${days > 1 ? ` — about ${days} days in all` : ""}.` : "",
      "It can be paused or cancelled while it goes out — an email already sent can't be taken back.",
    ].filter(Boolean), { confirmText: later ? "Schedule it" : "Send it" }))) return;
    setBusy("start");
    try {
      await flush();
      const r = await startCampaign(c.id, later ? new Date(t).toISOString() : undefined);
      toast.success(r.scheduled ? `Scheduled — ${nf(r.queued)} emails` : `Started — ${nf(r.queued)} emails going out${r.skipped ? ` (${r.skipped} left out)` : ""}`);
      if (!r.scheduled) void runNow().catch(() => undefined).finally(() => setInfoTick(x => x + 1));
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };

  const menu: MoreAction[] = [
    { label: "Save a version", icon: History, hint: "Keep the email as it is now, to come back to", onSelect: async () => { await saveVersion({ id: c.id, subject, preheader, design }, user!.id, "Saved by hand"); toast.success("Version saved"); } },
    { label: "Versions…", icon: RotateCcw, onSelect: () => setVersions(true) },
    { label: "Copy as a new draft", icon: Copy, onSelect: async () => { await flush().catch(() => undefined); nav(`/campaigns/${await createDraft(user!.id, { name: `${name} (copy)`, subject, preheader, design, audience })}`); } },
    { label: "Delete draft", icon: Trash2, danger: true, onSelect: async () => {
      if (!(await confirmBox(`Delete “${name}”?`, { danger: true, confirmText: "Delete" }))) return;
      dirty.current = false; window.clearTimeout(timer.current);
      try { await control("delete", c.id); nav("/campaigns"); } catch (e) { toast.error((e as Error).message); }
    } },
  ];

  const preview = <EmailPreview design={design} subject={subject} preheader={preheader} ctx={ctx} person={person} fromName={ctx.fromName} />;
  return (
    <div className="space-y-5">
      <PageHeader title={name || "Untitled campaign"} back={{ label: "Campaigns", to: "/campaigns" }}
        eyebrow={<span className="inline-flex items-center gap-2"><CellTag tone="neutral">Draft</CellTag><span className={`text-xs ${save === "error" ? "text-destructive" : "text-muted-foreground"}`}>{save === "saving" ? "Saving…" : save === "error" ? "Not saved — check the connection" : "Saved"}</span></span>}
        primary={{ label: "Test & send", icon: Send, onClick: () => setTab("send") }} menu={menu} menuTitle="Campaign" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] items-start">
        <div className="min-w-0 space-y-5">
          <TabBar label="Steps" value={tab} onChange={setTab} tabs={[
            { key: "write", label: "1 · Write", icon: Mail }, { key: "to", label: "2 · To", icon: Users, count: count.emails },
            { key: "send", label: "3 · Test & send", icon: Send }, { key: "preview", label: "Preview", icon: FlaskConical },
          ].filter(t => t.key !== "preview" || typeof window === "undefined" || window.innerWidth < 1024) as { key: "write" | "to" | "send" | "preview"; label: string; icon: typeof Mail; count?: number }[]} />
          {tab === "write" && (
            <div className="space-y-5">
              <div className="grid gap-4">
                <div><Label htmlFor="cm-name">Campaign name (only you see it)</Label><Input id="cm-name" className="mt-1 rounded-xl" maxLength={120} value={name} onChange={e => edit(setName)(e.target.value)} /></div>
                <div><Label htmlFor="cm-subj">Subject</Label><Input id="cm-subj" className="mt-1 rounded-xl" maxLength={200} placeholder="What the inbox shows first" value={subject} onChange={e => edit(setSubject)(e.target.value)} />
                  {suggest.length > 1 && <div className="mt-2 flex flex-wrap gap-1.5">{suggest.map(s => (
                    <button key={s} type="button" onClick={() => edit(setSubject)(s)} className={`rounded-full border px-2.5 py-1 text-xs ${s === subject ? "border-primary bg-primary/10 text-primary" : "border-border bg-white hover:border-primary/40"}`}>{s}</button>
                  ))}</div>}
                  <p className="mt-1 text-[11px] text-muted-foreground">{subject.length}/60 shown on most phones · {"{{first_name|there}}"} puts in each person's name</p></div>
                <div><Label htmlFor="cm-pre">Preview line</Label><Input id="cm-pre" className="mt-1 rounded-xl" maxLength={200} placeholder="The words after the subject in the inbox (40–100 letters)" value={preheader} onChange={e => edit(setPreheader)(e.target.value)} /></div>
              </div>
              <AiPanel c={{ ...c, audience }} design={design} subject={subject} preheader={preheader} onResult={(r, m) => void onAi(r, m)} />
              <BlockEditor design={design} onChange={edit(setDesign)} />
            </div>
          )}
          {tab === "to" && <AudiencePicker audience={audience} onChange={edit(setAudience)} suppressed={supp.rows} />}
          {tab === "send" && (
            <div className="space-y-6">
              <section className="space-y-3 rounded-2xl border border-border bg-white p-4">
                <SectionTitle title="1. Send yourself a test" icon={FlaskConical} sub="Exactly what they'll get, marked [TEST] — only to these addresses" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label htmlFor="cm-test" className="text-xs">To (up to 5, with commas)</Label><Input id="cm-test" className="mt-1 rounded-xl" value={testTo} onChange={e => setTestTo(e.target.value)} /></div>
                  <div><Label className="text-xs">Filled in as</Label>
                    <Select value={asRef || people[0]?.ref || "sample"} onValueChange={setAsRef}><SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>{people.length ? people.map(x => <SelectItem key={x.ref} value={x.ref}>{x.label}</SelectItem>) : <SelectItem value="sample">A sample client</SelectItem>}</SelectContent></Select></div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" className="gap-1.5" onClick={() => void test()} disabled={!!busy || stops.length > 0}><FlaskConical className="h-4 w-4" />{busy === "test" ? "Sending the test…" : "Send a test"}</Button>
                  {tested
                    ? <span className="text-sm text-success inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Tested {timeAgo(c.lastTestAt).toLowerCase()} — this exact email</span>
                    : c.testedHash ? <span className="text-sm text-amber-700">Changed since the last test — send a test again</span>
                    : <span className="text-sm text-muted-foreground">Not tested yet</span>}
                </div>
                {stops.length > 0 && <p className="text-xs text-destructive">First: {stops.map(s => s.text).join(" · ")}</p>}
              </section>
              <section className="space-y-3 rounded-2xl border border-border bg-white p-4">
                <SectionTitle title="2. Send it" icon={Send} sub={`${nf(count.emails)} email${count.emails === 1 ? "" : "s"} · ${info ? `${info.dailyBudget} a day from ${info.sender}` : "…"}`} />
                {info && count.emails > info.dailyBudget && <p className="text-xs text-muted-foreground rounded-lg bg-secondary/50 px-3 py-2">More than a day's budget: it sends {info.dailyBudget} a day and carries on by itself — about {Math.ceil(count.emails / info.dailyBudget)} days. (Settings → Daily budget.)</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={when} onValueChange={v => setWhen(v as "now" | "later")}><SelectTrigger className="h-10 w-40 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="now">Now</SelectItem><SelectItem value="later">At a time</SelectItem></SelectContent></Select>
                  {when === "later" && <Input type="datetime-local" className="h-10 w-56 rounded-xl" value={at} onChange={e => setAt(e.target.value)} />}
                  <Button className="gap-1.5" onClick={() => void start()} disabled={!!busy || !tested || stops.length > 0 || count.emails === 0}>
                    {when === "later" ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}{busy === "start" ? "Starting…" : when === "later" ? "Schedule" : `Send to ${nf(count.emails)}`}</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{!tested ? "Send a test of this exact email first. " : ""}{count.emails === 0 ? "Choose who it goes to (step 2). " : ""}Each person once; unsubscribed addresses are left out; clients get a one-click unsubscribe.</p>
              </section>
            </div>
          )}
          {tab === "preview" && preview}
        </div>
        <div className="hidden lg:block lg:sticky lg:top-4 min-w-0">{preview}</div>
      </div>
      <VersionsSheet c={c} open={versions} onClose={() => setVersions(false)} onRestore={async v => {
        await saveVersion({ id: c.id, subject, preheader, design }, user!.id, "Before going back").catch(() => undefined);
        dirty.current = true; setSubject(v.subject); setPreheader(v.preheader ?? ""); setDesign(cleanDesign(v.design));
        toast.success("Back to that version");
      }} />
    </div>
  );
}

/* ─────────────── Going out / sent ─────────────── */

const R_LABEL: Record<RecipientStatus, string> = { queued: "Waiting", sending: "Sending", sent: "Sent", failed: "Not sent", skipped: "Left out", unsure: "Unsure" };
const R_TONE: Record<RecipientStatus, "neutral" | "blue" | "green" | "red" | "amber"> = { queued: "neutral", sending: "blue", sent: "green", failed: "red", skipped: "neutral", unsure: "amber" };

function Report({ c }: { c: Campaign }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const brand = useBrand();
  const rec = useRecipients(c.id);
  const [tick, setTick] = useState(0);
  const info = useSendInfo(tick);
  const [filter, setFilter] = useState<"all" | RecipientStatus>("all");
  const [busy, setBusy] = useState("");
  const n = c.counts ?? { total: 0, queued: 0, sent: 0, failed: 0, skipped: 0, unsure: 0 };
  const live = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rec.rows) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [rec.rows]);
  // The live list once it's here; the stored figures until then.
  const k = (s: RecipientStatus) => (rec.loading ? (n as Record<string, number>)[s] ?? 0 : live[s] ?? 0);
  const toSend = Math.max(0, (rec.loading ? n.total : rec.rows.length) - k("skipped"));
  const pct = toSend ? Math.round((k("sent") / toSend) * 100) : 0;
  const unsub = rec.rows.filter(r => r.unsubscribedAt).length || n.unsubscribed || 0;
  const s = c.frozen?.settings;
  const ctx = useCtx(s, brand.name || BUILTIN.name);
  const act = async (label: string, f: () => Promise<unknown>, ok: string) => { setBusy(label); try { await f(); toast.success(ok); } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); } };
  const going = ["sending", "scheduled", "paused"].includes(c.status);
  const rows = filter === "all" ? rec.rows : rec.rows.filter(r => r.status === filter);
  const daysLeft = info && k("queued") > 0 ? Math.ceil(k("queued") / Math.max(1, info.dailyBudget)) : 0;

  const columns: DataColumn<Recipient>[] = [
    { key: "who", header: "Person", always: true, sortValue: r => r.name ?? r.email, cell: r => <CellMain title={r.name || r.email} sub={[r.name ? r.email : "", r.company ?? ""].filter(Boolean).join(" · ") || undefined} /> },
    { key: "kind", header: "As", sortValue: r => r.kind, cell: r => <span className="text-sm">{r.kind === "client" ? "Client" : "Team"}</span> },
    { key: "status", header: "Status", sortValue: r => r.status, cell: r => <div><CellTag tone={R_TONE[r.status]}>{R_LABEL[r.status]}</CellTag>{r.unsubscribedAt && <p className="text-[11px] text-muted-foreground mt-1">Unsubscribed {timeAgo(r.unsubscribedAt).toLowerCase()}</p>}</div> },
    { key: "when", header: "Sent", sortValue: r => r.sentAt ?? "", cell: r => <span className="text-sm whitespace-nowrap">{r.sentAt ? new Date(r.sentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"}</span> },
    { key: "why", header: "Note", sortValue: r => r.why ?? "", cell: r => <span className="text-xs text-muted-foreground max-w-[18rem] block">{r.why ?? ""}</span> },
  ];
  const menu: MoreAction[] = [
    { label: "Send the next few now", icon: Send, show: c.status === "sending", hint: "Instead of waiting for the minute's check", onSelect: () => void act("run", runNow, "Sending") },
    { label: `Try the ${k("failed")} not sent again`, icon: RefreshCw, show: k("failed") > 0 && c.status !== "cancelled", hint: "Bounced and unsubscribed addresses stay off", onSelect: () => void act("retry", () => control("retryFailed", c.id), "Queued again") },
    { label: `Send the ${k("unsure")} unsure again`, icon: RefreshCw, show: k("unsure") > 0 && c.status !== "cancelled", hint: "They may have got it already — they could get it twice", onSelect: async () => {
      if (!(await confirmBox("Send to the unsure ones again?\n\nThe connection broke while their email was going out — some of them may have it already and would get it twice.", { confirmText: "Send again" }))) return;
      void act("retry", () => control("retryUnsure", c.id), "Queued again");
    } },
    { label: "Copy as a new draft", icon: Copy, onSelect: async () => nav(`/campaigns/${await createDraft(user!.id, { name: `${c.name} (copy)`, subject: c.frozen?.subject ?? c.subject, preheader: c.frozen?.preheader, design: c.frozen?.design ?? c.design, audience: c.audience })}`) },
    { label: "Cancel the rest", icon: XCircle, danger: true, show: going, hint: "Nobody else gets it — those sent keep theirs", onSelect: async () => {
      if (!(await confirmBox(`Cancel “${c.name}”?\n\nThe ${nf(k("queued"))} still waiting won't get it. Emails already sent can't be taken back.`, { danger: true, confirmText: "Cancel the rest" }))) return;
      void act("cancel", () => control("cancel", c.id), "Cancelled");
    } },
    { label: "Delete", icon: Trash2, danger: true, show: !going, onSelect: async () => {
      if (!(await confirmBox(`Delete “${c.name}” and its report?\n\nEmails already sent stay in people's inboxes.`, { danger: true, confirmText: "Delete" }))) return;
      try { await control("delete", c.id); nav("/campaigns"); } catch (e) { toast.error((e as Error).message); }
    } },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={c.name} back={{ label: "Campaigns", to: "/campaigns" }} eyebrow={<CellTag tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</CellTag>}
        subtitle={c.frozen?.subject.replace(/\{\{\s*([a-z_]+)\s*(?:\|[^}]*)?\}\}/gi, "[$1]")}
        primary={c.status === "sending" || c.status === "scheduled" ? { label: "Pause", icon: Pause, disabled: !!busy, onClick: () => void act("pause", () => control("pause", c.id), "Paused — nothing more goes out until you resume") }
          : c.status === "paused" ? { label: "Resume", icon: Play, disabled: !!busy, onClick: () => void act("resume", () => control("resume", c.id), "Going out again") } : null}
        menu={menu} menuTitle="Campaign" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
        <div className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3"><p className="text-sm font-semibold">{nf(k("sent"))} of {nf(toSend)} sent</p><span className="text-sm tabular-nums text-muted-foreground">{pct}%</span></div>
            <div className="h-2.5 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
            <p className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              {c.status === "scheduled" && c.scheduleAt && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />Sends {new Date(c.scheduleAt).toLocaleString()}</span>}
              {c.pauseReason && <span className="inline-flex items-center gap-1 text-amber-800"><Clock className="h-3.5 w-3.5" />{c.pauseReason}{c.resumeAt ? ` (from ${new Date(c.resumeAt).toLocaleString()})` : ""}</span>}
              {c.status === "sending" && !c.pauseReason && k("queued") > 0 && <span>Going out one every few seconds{daysLeft > 1 ? ` · about ${daysLeft} days at ${info?.dailyBudget} a day` : ""}</span>}
              {c.startedAt && <span>Started {fmtDate(c.startedAt)}</span>}
              {c.finishedAt && <span>{c.status === "cancelled" ? "Cancelled" : "Finished"} {fmtDate(c.finishedAt)}</span>}
            </p>
          </div>
          {info?.hold && going && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
              <Clock className="h-4 w-4 shrink-0" />
              <p className="flex-1 min-w-0"><b>Every campaign is waiting</b> until {new Date(info.hold.until).toLocaleString()} — {info.hold.why}</p>
              <Button size="sm" variant="outline" className="bg-white" disabled={!!busy} onClick={async () => {
                if (!(await confirmBox("Stop waiting and send again now?\n\nOnly when the reason is sorted (the mailbox's password fixed, say) — if Gmail says stop again, it waits again.", { confirmText: "Send again now" }))) return;
                await act("hold", () => control("clearHold"), "Waiting stopped — it carries on within a minute"); setTick(x => x + 1);
              }}>Stop waiting</Button>
            </div>
          )}
          <StatStrip items={[
            { label: "Sent", value: nf(k("sent")), icon: CheckCircle2, tone: "in" },
            { label: "Waiting", value: nf(k("queued") + k("sending")), icon: Clock },
            { label: "Not sent", value: nf(k("failed") + k("unsure")), icon: X, tone: k("failed") + k("unsure") ? "out" : undefined, sub: k("unsure") ? `${k("unsure")} unsure` : undefined },
            { label: "Unsubscribed", value: nf(unsub), icon: XCircle, sub: `${nf(k("skipped") + (c.skippedCount ?? 0))} left out` },
          ]} />
          <TabBar label="Show" value={filter} onChange={setFilter} tabs={([["all", "All"], ["sent", "Sent"], ["queued", "Waiting"], ["failed", "Not sent"], ["unsure", "Unsure"], ["skipped", "Left out"]] as const)
            .map(([key, label]) => ({ key, label, count: key === "all" ? rec.rows.length : live[key] ?? 0 })).filter(t => t.key === "all" || t.count > 0)} />
          <DataTable id="campaign-recipients" noun="person" plural="people" rows={rows} columns={columns} rowKey={r => r.id} loading={rec.loading}
            rowActions={r => [{
              label: "Mark as bounced", icon: XCircle, show: r.status === "sent", hint: "Gmail sent a 'couldn't be delivered' email back — no campaign goes to it again",
              onSelect: async () => {
                if (!(await confirmBox(`Mark ${r.email} as bounced?

No campaign goes to this address again (it can be taken off the Unsubscribed list later).`, { confirmText: "Mark bounced" }))) return;
                void act("bounce", () => control("bounced", c.id, r.email), "Marked bounced");
              },
            }]}
            searchText={r => [r.name, r.email, r.company, R_LABEL[r.status], r.why].filter(Boolean).join(" ")} searchPlaceholder="Search people" exportName={`Campaign-${c.name}`} />
          {(c.skippedList?.length ?? 0) > 0 && (
            <details className="rounded-xl border border-border bg-white px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">{c.skippedCount} left out at the start (no email, or not valid)</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{c.skippedList!.map((x, i) => <li key={i}>{x.name} — {x.why}</li>)}</ul>
            </details>
          )}
        </div>
        <div className="lg:sticky lg:top-4 min-w-0">
          {c.frozen && <EmailPreview design={c.frozen.design} subject={c.frozen.subject} preheader={c.frozen.preheader} ctx={ctx} person={{ kind: "client", name: "Ravi Mehta", company: "Mehta Jewellers" }} fromName={ctx.fromName} compact />}
        </div>
      </div>
    </div>
  );
}

export default function CampaignEditorPage() {
  const { id } = useParams();
  const c = useCampaign(id);
  if (c === undefined) return <p className="text-sm text-muted-foreground p-6">Loading…</p>;
  if (c === null) return <div className="p-6 space-y-2"><p className="font-semibold">This campaign isn't here</p><p className="text-sm text-muted-foreground">It may have been deleted.</p></div>;
  return c.status === "draft" ? <DraftEditor key={c.id} c={c} /> : <Report c={c} />;
}
