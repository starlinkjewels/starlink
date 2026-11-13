// Settings → Software health (admins): what the watchers on the server found —
// attacks, misuse and failures — the protections in place, and the partners
// every alert goes to. Read straight from the server's own records
// (securityEvents, healthState — written only by functions/src/health/).
import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Activity, BellRing, CheckCircle2, AlertTriangle, CircleSlash, Send, Check, Power, Info } from "lucide-react";
import { db as fsdb, functions, auth, isAdminEmail, ADMIN_EMAILS } from "@/lib/firebase";
import { fmtDate } from "@/lib/db";
import { confirmBox } from "@/lib/confirm";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellDate, type DataColumn } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import type { MoreAction } from "@/components/MoreMenu";

type Severity = "critical" | "warning" | "info";
interface HealthEvent {
  id: string; at: string; lastAt?: string; kind: string; severity: Severity; title: string; detail: string;
  who?: { name?: string; email?: string }; ip?: string; ua?: string; count: number;
  account?: { uid: string; email?: string; disabled?: boolean };
  handled?: { at: string; by: string; note?: string };
}
interface Acct { uid: string; email: string; created?: string; lastSignIn?: string | null; disabled?: boolean; role?: string }
interface HealthState {
  since?: string; lastTickAt?: string;
  accounts?: { total?: number; unknownOld?: Acct[]; switchedOff?: Acct[]; inactiveCanSignIn?: Acct[]; error?: string };
  jobs?: { failing?: Record<string, number>; error?: string; checkedAt?: string };
  backup?: { lastAt?: string | null; error?: string; records?: number; verified?: boolean | null; every?: string };
  rules?: { database?: string | null; files?: string | null; error?: string };
  partners?: { alerts?: number; emails?: string[] };
}

const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return fmtDate(iso);
};
const SEV: Record<Severity, { label: string; tone: "red" | "amber" | "neutral" }> = {
  critical: { label: "Serious", tone: "red" }, warning: { label: "Needs a look", tone: "amber" }, info: { label: "Info", tone: "neutral" },
};

export function HealthSettings() {
  const [state, setState] = useState<HealthState | null>(null);
  const [events, setEvents] = useState<HealthEvent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const owner = isAdminEmail(auth.currentUser?.email);

  useEffect(() => {
    const off1 = onSnapshot(doc(fsdb, "healthState", "main"), s => setState((s.data() as HealthState) ?? {}), () => setDenied(true));
    const off2 = onSnapshot(query(collection(fsdb, "securityEvents"), orderBy("at", "desc"), limit(300)),
      s => setEvents(s.docs.map(d => d.data() as HealthEvent)), () => setDenied(true));
    return () => { off1(); off2(); };
  }, []);

  const act = async (op: string, args: Record<string, unknown>, done: string) => {
    setBusy(op + JSON.stringify(args));
    try {
      const r = await httpsCallable<Record<string, unknown>, { alerts?: number; emails?: number }>(functions, "healthAction")({ op, ...args });
      toast.success(op === "test" ? `Test sent — ${r.data.alerts ?? 0} in-app alert${r.data.alerts === 1 ? "" : "s"}, ${r.data.emails ?? 0} email${r.data.emails === 1 ? "" : "s"}` : done);
    } catch (e) {
      toast.error((e as { message?: string })?.message?.replace(/^.*?:\s*/, "") || "Couldn't do that — try again");
    } finally { setBusy(null); }
  };

  if (denied) {
    return <p className="text-sm text-muted-foreground">Software health is for admins, and starts once its server part and rules are switched on.</p>;
  }
  if (!state || !events) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const week = Date.now() - 7 * 86_400_000;
  const openSerious = events.filter(e => e.severity === "critical" && e.kind !== "test" && !e.handled && new Date(e.at).getTime() > week).length;
  const openLook = events.filter(e => e.severity === "warning" && !e.handled && new Date(e.at).getTime() > week).length;
  const tickAge = state.lastTickAt ? Date.now() - new Date(state.lastTickAt).getTime() : Infinity;
  const running = tickAge < 45 * 60_000;
  // Every 6 hours by the server (functions/src/backup/), each checked; before the first of those, the app's daily one.
  const sixHourly = state.backup?.every === "6h";
  const backupOk = !!state.backup?.lastAt && Date.now() - new Date(state.backup.lastAt).getTime() < (sixHourly ? 7 : 48) * 3600_000 && state.backup?.verified !== false;
  const failing = Object.entries(state.jobs?.failing ?? {});
  const unknownOld = state.accounts?.unknownOld ?? [];
  const switchedOff = state.accounts?.switchedOff ?? [];
  const inactive = state.accounts?.inactiveCanSignIn ?? [];
  const emails = state.partners?.emails ?? [];

  const status = openSerious ? { label: `${openSerious} serious`, tone: "out" as const, icon: ShieldAlert }
    : openLook || !running ? { label: !running ? "Check not running" : `${openLook} to look at`, tone: "out" as const, icon: AlertTriangle }
    : { label: "All clear", tone: "in" as const, icon: ShieldCheck };

  const check = (ok: boolean | "off", title: string, text: React.ReactNode, extra?: React.ReactNode) => (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 p-3">
      {ok === true ? <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" /> : ok === "off" ? <CircleSlash className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" /> : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="text-xs text-muted-foreground mt-0.5">{text}</div>
        {extra}
      </div>
    </div>
  );
  const acctRow = (a: Acct, canOff: boolean, canOn: boolean) => (
    <div key={a.uid} className="flex items-center justify-between gap-2 text-xs py-1 border-t border-border/50 first:border-t-0">
      <span className="min-w-0 truncate">{a.email || a.uid}{a.lastSignIn ? ` · last in ${ago(a.lastSignIn)}` : " · never signed in"}{a.disabled ? " · switched off" : ""}</span>
      {canOff && !a.disabled && <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1" disabled={!!busy}
        onClick={async () => { if (await confirmBox(`Switch off ${a.email || "this account"}?\n\nIt can no longer sign in. It is not one of your team or clients.`)) void act("disable", { uid: a.uid }, "Switched off"); }}><Power className="h-3 w-3" />Switch off</Button>}
      {canOn && a.disabled && owner && <Button size="sm" variant="outline" className="h-7 rounded-lg" disabled={!!busy}
        onClick={async () => { if (await confirmBox(`Switch ${a.email || "this account"} back on?\n\nOnly if you know who it is — it is not one of your team or clients. The watch will leave it alone from now on.`)) void act("enable", { uid: a.uid }, "Switched back on"); }}>Switch back on</Button>}
    </div>
  );

  const columns: DataColumn<HealthEvent>[] = [
    { key: "at", header: "When", kind: "date", sortValue: e => e.lastAt ?? e.at, csv: e => e.at, cell: e => <CellDate>{ago(e.lastAt ?? e.at)}</CellDate> },
    { key: "sev", header: "Level", sortValue: e => (e.severity === "critical" ? 0 : e.severity === "warning" ? 1 : 2), csv: e => SEV[e.severity].label,
      cell: e => <CellTag tone={SEV[e.severity].tone}>{SEV[e.severity].label}</CellTag> },
    { key: "what", header: "What", always: true, sortValue: e => e.title, csv: e => `${e.title} — ${e.detail}`,
      cell: e => <CellMain title={<>{e.title}{e.count > 1 && <span className="text-muted-foreground font-normal"> ×{e.count}</span>}</>} sub={e.detail} /> },
    { key: "who", header: "Who / from", sortValue: e => e.who?.name ?? e.ip ?? "", csv: e => [e.who?.name, e.who?.email, e.ip].filter(Boolean).join(" · "),
      cell: e => <span className="text-xs text-muted-foreground">{[e.who?.name, e.ip].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "state", header: "Status", sortValue: e => (e.handled ? 1 : 0), csv: e => (e.handled ? `Handled by ${e.handled.by}` : "Open"),
      cell: e => e.handled ? <CellTag tone="green">Handled</CellTag> : e.kind === "test" ? <CellTag>Test</CellTag> : <CellTag tone="amber">Open</CellTag> },
  ];
  const rowActions = (e: HealthEvent): MoreAction[] => [
    { label: "Mark handled", icon: Check, show: !e.handled && e.kind !== "test", onSelect: () => void act("handled", { eventId: e.id }, "Marked handled") },
    { label: "Switch the account back on", icon: Power, show: !!e.account?.disabled, disabled: !owner, hint: owner ? "Only if you know who it is" : "Owners only",
      onSelect: async () => { if (await confirmBox(`Switch ${e.account?.email || "this account"} back on?`)) void act("enable", { uid: e.account!.uid }, "Switched back on"); } },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle title="Software health" sub="Attacks, misuse and failures — watched every 15 minutes, every partner told"
        info={<>Serious things (an unknown account, many wrong passwords, a mass delete, someone made an admin, an admin on a new device) alert every partner at once — in the app, on their phone and by email. The rest come in one summary email at 8 in the morning.</>} />

      <StatStrip items={[
        { label: "Status", value: status.label, icon: status.icon, tone: status.tone },
        { label: "Last check", value: ago(state.lastTickAt), icon: Activity, tone: running ? undefined : "out", sub: running ? "every 15 minutes" : "the check is not running" },
        { label: "Alerts go to", value: `${emails.length} partner${emails.length === 1 ? "" : "s"}`, icon: BellRing, sub: emails.slice(0, 3).join(", ") || "—" },
      ]} />

      <div className="flex justify-end">
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => void act("test", {}, "")} className="rounded-xl h-9 gap-1.5"><Send className="h-4 w-4" /> Send a test alert</Button>
      </div>

      <section className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark">Protection</p>
        <div className="grid gap-2 lg:grid-cols-2">
          {check(!!state.rules?.database, "Database rules", state.rules?.database ? <>Every person reaches only what their access allows — checked by the database itself. Last changed {fmtDate(state.rules.database)}.</> : "Not known yet.")}
          {check(!!state.rules?.files, "File rules", state.rules?.files ? <>Only staff add, change or delete the app's files; clients only add pictures to their orders and chat. Last changed {fmtDate(state.rules.files)}.</> : "Not known yet.")}
          {check(unknownOld.filter(a => !a.disabled).length === 0, "Unknown accounts",
            <>Accounts that are not one of your team or clients. New ones are switched off at once{switchedOff.length ? ` (${switchedOff.length} so far)` : ""}.{unknownOld.length ? ` ${unknownOld.length} older one${unknownOld.length === 1 ? "" : "s"} from before the watch started — switch off any you don't know.` : " None found."}</>,
            unknownOld.length + switchedOff.length > 0 && <div className="mt-2">{unknownOld.map(a => acctRow(a, true, true))}{switchedOff.map(a => acctRow(a, false, true))}</div>)}
          {check(inactive.length === 0, "Switched-off staff", inactive.length
            ? <>{inactive.length} person{inactive.length === 1 ? "" : "s"} marked inactive can still sign in — they see nothing of the business (the rules refuse them), but their login is still open: {inactive.map(a => a.email).filter(Boolean).slice(0, 4).join(", ")}.</>
            : "Nobody marked inactive can sign in.")}
          {check(backupOk, "Backups", state.backup?.lastAt
            ? sixHourly
              ? <>Every 6 hours by the server, each read back and checked. Last {ago(state.backup.lastAt)}{state.backup.records ? ` — ${state.backup.records.toLocaleString("en-IN")} records` : ""}{state.backup.verified === false ? " — its check found a problem: see Data & Backup" : state.backup.verified ? ", read back whole" : ""}{Date.now() - new Date(state.backup.lastAt).getTime() > 7 * 3600_000 ? ". Overdue — take one in Data & Backup" : ""}.</>
              : <>Last backup {ago(state.backup.lastAt)}{backupOk ? "" : " — older than 2 days: take one in Data & Backup"}.</>
            : "No backup found yet — take one in Data & Backup.")}
          {check(failing.length === 0 && !state.jobs?.error, "Server jobs", failing.length ? <>Failing since the last check: {failing.map(([k, n]) => `${k} (${n})`).join(", ")}.</> : state.jobs?.error ? "Couldn't read the server's logs." : "Mail, the Agent, totals, Autopilot and the rest — no errors.")}
          {check("off", "App Check", <>Off on purpose since 14 Oct (its key needs fixing). With it on, only the real app could reach the database; until then the rules above are what protects the data.</>)}
          {check(running, "This watch", running ? <>Running — last check {ago(state.lastTickAt)}. Owners: {ADMIN_EMAILS.join(", ")}.</> : "The 15-minute check has not run recently.")}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-sm font-semibold text-brand-dark">What was found</p>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Info className="h-4 w-4" /> Nothing yet — that is good news.</p>
        ) : (
          <DataTable id="health-events" noun="event" rows={events} columns={columns} rowKey={e => e.id}
            rowActions={rowActions} defaultSort={{ key: "at", dir: "desc" }}
            searchText={e => `${e.title} ${e.detail} ${e.who?.name ?? ""} ${e.ip ?? ""}`} searchPlaceholder="Search events"
            exportName="Software-health" pageSizes={[25, 50, 100]} />
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Watched: accounts nobody gave (switched off), 5+ wrong passwords on one login in 15 minutes, 20+ records deleted by one person in 10 minutes, 300+ changes in 10 minutes,
        someone made an admin or their access changed, a closed year reopened, an admin or owner signing in on a new device, saves refused by the security rules, screens failing,
        server jobs failing, no backup in 2 days. Wrong passwords typed outside this app's sign-in screen can't be seen.
      </p>
    </div>
  );
}
