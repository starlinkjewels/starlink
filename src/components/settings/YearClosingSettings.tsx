// Settings → Year closing: close a financial year, see any closed year's Year
// book, and reopen the last one (the main admin only, with a reason).
//
// The standard close, as accounting packages do it: review first (checks),
// then the figures as at the last day (the Year book), then the close itself —
// typed to confirm, logged. Closing freezes the Year book (adminRecords) and
// sets the lock (settings.booksClosedTo, lib/yearLock.ts). No record is moved,
// changed or deleted: the new year opens with every balance exactly as the old
// one closed, because balances are worked out from the records themselves.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookLock, BookOpen, CalendarCheck, CheckCircle2, Info, Loader2, Lock, LockOpen, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellTag, type DataColumn } from "@/components/DataTable";
import type { MoreAction } from "@/components/MoreMenu";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { auth, isAdminEmail, ADMIN_EMAILS } from "@/lib/firebase";
import {
  loadDb, updateDbAs, flush, ensureAllCollections, collectionsReady, fmtMoney, fmtDate,
  type DB, type AdminRecord, type YearCloseEntry,
} from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { fmtCcy } from "@/lib/currency";
import { companyById } from "@/lib/companies";
import { materialName } from "@/lib/materials";
import { LAZY_COLS } from "@/lib/pageData";
import { closedTo, closedYearKey } from "@/lib/yearLock";
import { fiscalYearOf, fiscalYearsBetween, fiscalYearSpan, dayOf, addDays, customYear, fiscalDay, type FiscalYear } from "@/lib/fiscalYear";
import { planFor, nextDiwali } from "@/lib/salesTargets";
import { buildYearBook, closeChecks, bookParts, bookFromParts, type YearBook, type CloseCheck, type StockLine } from "@/lib/yearEnd";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Everything the Year book reads — all of it loaded and fresh before a figure is worked out. */
const BOOK_COLS = ["orders", "clients", "suppliers", "factories", "brokers", "designers", "lockers", "cadJobs", "readyStock", "expenses", "invoices", "adminRecords",
  ...LAZY_COLS.filter(c => !["catalogFolders", "catalogFavorites", "productPhotoFolders", "productPhotoItems", "shares"].includes(c))];

const usd = (n: number | null | undefined) => (n == null ? "—" : fmtMoney(n));
const inr = (n: number | null | undefined) => (n == null ? "—" : fmtMoneyInr(n));
const grams = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} g`;
const carats = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ct`;

/** The stored Year book of a year, put back together from its parts. */
export function storedBook(db: Pick<DB, "adminRecords">, key: string): YearBook | null {
  const parts: Record<string, unknown> = {};
  for (const r of db.adminRecords ?? []) if (r.kind === "yearBook" && r.key === key) parts[r.part] = r.book;
  return bookFromParts(parts);
}

/** Make sure every record is here, from the server, before working out a year. */
async function readyForBook(): Promise<boolean> {
  await ensureAllCollections();
  return collectionsReady(BOOK_COLS, 30000);
}

/** `openEnd`: a year on the business's own dates still open — its last day is chosen when it is closed. */
type YearRow = { fy: FiscalYear; entry?: YearCloseEntry; state: "closed" | "reopened" | "open" | "current" | "future"; openEnd?: boolean };

/** The same day a year later, less one — the default last day of a year on own dates. */
const yearAfter = (day: string) => addDays(`${Number(day.slice(0, 4)) + 1}${day.slice(4)}`, -1);

export function YearClosingSettings() {
  const db = useDb();
  const { user } = useAuth();
  const mainAdmin = isAdminEmail(auth.currentUser?.email) || isAdminEmail(user?.email);
  const sm = db.settings.fyStartMonth || 4;
  const custom = !!db.settings.fyCustomDates;
  const until = closedTo(db.settings);
  const entries = db.settings.yearCloses ?? [];
  const current = fiscalYearOf(new Date(), sm);
  const today = dayOf(new Date());
  const yesterday = addDays(today, -1);

  // Every year the business has records in, up to this one.
  const years: YearRow[] = useMemo(() => {
    const days = [
      ...db.orders.map(o => o.createdAt), ...(db.purchases ?? []).map(p => p.createdAt), ...(db.lockerTransactions ?? []).map(t => t.createdAt),
      ...(db.stockMovements ?? []).map(m => m.createdAt), ...db.lockers.map(l => l.createdAt), ...(db.expenses ?? []).map(e => e.createdAt),
      ...entries.map(e => e.from),
    ].map(d => dayOf(d)).filter(Boolean).sort();
    const first = days[0] || current.from;
    if (custom) {
      // On its own dates: the years closed so far, then the one running now —
      // from the day after the last close (or the first record) to a last day
      // chosen when it is closed.
      const nextFrom = until ? addDays(until, 1) : first;
      const again = entries.find(e => e.status === "reopened" && e.from === nextFrom);
      const done: YearRow[] = entries.filter(e => e !== again)
        .sort((a, b) => b.from.localeCompare(a.from))
        .map(e => ({ fy: { key: e.key, from: e.from, to: e.to, startYear: Number(e.from.slice(0, 4)) }, entry: e,
          state: e.status === "closed" && until && e.to <= until ? "closed" as const : "reopened" as const }));
      if (nextFrom > yesterday) return done;
      // Its last day: as closed before, else the end its sales target was set to (Targets), else the next Diwali.
      const planned = planFor(db, nextFrom)?.to ?? nextDiwali(nextFrom) ?? yearAfter(nextFrom);
      const end = again ? again.to : (planned < yesterday ? planned : yesterday);
      const fy = again ? { key: again.key, from: again.from, to: again.to, startYear: Number(again.from.slice(0, 4)) } : customYear(nextFrom, end, entries.map(e => e.key));
      return [{ fy, entry: again, state: again ? "reopened" as const : "open" as const, openEnd: true }, ...done];
    }
    return fiscalYearsBetween(first, current.from, sm).reverse().map(fy => {
      const entry = entries.find(e => e.key === fy.key);
      const state: YearRow["state"] = until && fy.to <= until ? "closed" : entry?.status === "reopened" ? "reopened" : fy.key === current.key ? "current" : "open";
      return { fy, entry, state };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.orders.length, db.purchases?.length, db.lockerTransactions?.length, db.stockMovements?.length, db.lockers.length, db.expenses?.length, entries.length, until, sm, custom, JSON.stringify(entries.map(e => [e.key, e.status, e.to]))]);

  // The next year to close: the oldest ended year after the closed ones — on
  // own dates, the year running now (its last day is chosen when closing).
  const nextToClose = custom ? years.find(y => y.openEnd) : [...years].reverse().find(y => y.state !== "closed" && y.fy.to < today);
  // Only the last closed year can be reopened (the lock moves back one year at a time).
  const lastClosed = years.find(y => y.state === "closed");

  const [closing, setClosing] = useState<FiscalYear | null>(null);
  const [viewing, setViewing] = useState<FiscalYear | null>(null);
  const [reopening, setReopening] = useState<FiscalYear | null>(null);

  const columns: DataColumn<YearRow>[] = [
    { key: "year", header: "Year", always: true, sortValue: r => r.fy.from, cell: r => <span className="font-semibold text-brand-dark whitespace-nowrap">{r.fy.key}</span> },
    { key: "period", header: "Period", cell: r => (r.openEnd ? `From ${fiscalDay(r.fy.from)} — last day chosen when closing` : fiscalYearSpan(r.fy)) },
    { key: "status", header: "Status", sortValue: r => r.state, csv: r => r.state,
      cell: r => r.state === "closed" ? <CellTag tone="green">Closed</CellTag>
        : r.state === "reopened" ? <CellTag tone="amber">Reopened</CellTag>
        : r.state === "current" ? <CellTag tone="blue">Current year</CellTag>
        : <CellTag tone="neutral">Open</CellTag> },
    { key: "when", header: "Last closed", kind: "date", sortValue: r => lastLog(r.entry, "closed")?.at ?? "",
      cell: r => { const l = lastLog(r.entry, "closed"); return l ? `${fmtDate(l.at)} · ${l.byName}` : "—"; } },
  ];
  // Each year's actions in its ⋯ (on a phone as on a computer); the one main
  // action — closing the next year — is also the button above the table.
  const notMain = mainAdmin ? undefined : `Only the main admin (${ADMIN_EMAILS[0]})`;
  const rowActions = (r: YearRow): MoreAction[] => [
    { label: "Year book", icon: BookOpen, onSelect: () => setViewing(r.fy), show: !!storedBook(db, r.fy.key), hint: "As it was closed" },
    { label: `Close ${r.fy.key}`, icon: Lock, onSelect: () => setClosing(r.fy), show: nextToClose?.fy.key === r.fy.key, disabled: !mainAdmin, hint: notMain ?? "Checks, the Year book, then the lock" },
    { label: `Reopen ${r.fy.key}`, icon: LockOpen, onSelect: () => setReopening(r.fy), show: lastClosed?.fy.key === r.fy.key, disabled: !mainAdmin, hint: notMain ?? "With a reason — it is recorded" },
  ];

  const setYearType = (v: string) => {
    if (v === "custom") {
      updateDbAs({ summary: "Years now run on the business's own dates (e.g. Diwali to Diwali)" }, d => { d.settings.fyCustomDates = true; });
      toast.success("Years now run on your own dates — choose each year's last day when you close it");
      return;
    }
    const m = Number(v);
    updateDbAs({ summary: `Financial year now starts in ${MONTHS[m - 1]}` }, d => { delete d.settings.fyCustomDates; d.settings.fyStartMonth = m; });
    toast.success(`The financial year now starts in ${MONTHS[m - 1]}`);
  };

  return (
    <div className="card-luxe p-6 space-y-6">
      <SectionTitle icon={CalendarCheck} title="Year closing"
        sub={`${custom ? "Years on your own dates (e.g. Diwali to Diwali)" : `Financial year ${MONTHS[sm - 1]} – ${MONTHS[(sm + 10) % 12]}`} · ${until ? `closed up to ${fmtDate(until)}` : "no year closed yet"}`} />

      <StatStrip items={[
        custom
          ? { label: "This year", value: until ? `From ${fiscalDay(addDays(until, 1))}` : "Not closed yet", sub: "Ends on the day you close it" }
          : { label: "This year", value: current.key, sub: fiscalYearSpan(current) },
        { label: "Closed up to", value: until ? closedYearKey(until, db.settings) : "—", sub: until ? `Locked to ${fmtDate(until)}` : "Nothing locked", icon: until ? Lock : LockOpen },
        { label: "Next to close", value: nextToClose?.fy.key ?? "—", sub: nextToClose ? (nextToClose.openEnd ? `From ${fiscalDay(nextToClose.fy.from)}` : `Ended ${fmtDate(nextToClose.fy.to)}`) : "Every ended year is closed" },
      ]} />

      <div className="rounded-xl border border-border/70 bg-secondary/40 p-4 text-sm text-foreground/80 flex gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p>Closing a year keeps its <b>Year book</b> — profit &amp; loss and every balance on its last day — and <b>locks</b> it: nothing dated in it can be added, changed or deleted until it is reopened.</p>
          <p className="text-muted-foreground">Nothing is moved or deleted. The new year opens with every balance where the old one closed.</p>
          {!mainAdmin && <p className="font-medium">Only the main admin ({ADMIN_EMAILS[0]}) can close or reopen a year.</p>}
        </div>
      </div>

      {mainAdmin && !(custom && until) && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem]">
            <Label className="text-xs text-muted-foreground">The year runs</Label>
            <Select value={custom ? "custom" : String(sm)} onValueChange={setYearType}>
              <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)} disabled={!!until && i + 1 !== sm}>
                    {m} – {MONTHS[(i + 11) % 12]}{i + 1 === 4 ? " (India)" : ""}
                  </SelectItem>
                ))}
                <SelectItem value="custom">On our own dates — e.g. Diwali to Diwali</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground pb-2.5 max-w-md">
            {custom ? "Each year ends on the day you choose when you close it — the eve of Diwali, say. The next year starts the day after."
              : until ? "The month is fixed now that a year is closed; you can still move to your own dates." : "Fixed once the first year is closed."}
          </p>
        </div>
      )}

      <div>
        <SectionTitle title="Years" sub="Closed in order, oldest first"
          actions={nextToClose ? (
            <Button size="sm" className="h-9 rounded-xl whitespace-nowrap" disabled={!mainAdmin} title={notMain} onClick={() => setClosing(nextToClose.fy)}>
              <Lock className="h-4 w-4 mr-1.5" />Close {nextToClose.fy.key}
            </Button>
          ) : undefined} />
        <div className="mt-3">
          <DataTable id="year-closing" noun="year" rows={years} columns={columns} rowKey={r => r.fy.key} controls="none" pageSizes={[25]}
            rowActions={rowActions} emptyText="No records yet." />
        </div>
      </div>

      {entries.some(e => e.log.length) && (
        <div>
          <SectionTitle title="History" sub="Every close and reopen — who, when, why" />
          <ul className="mt-3 space-y-1.5 text-sm">
            {entries.flatMap(e => e.log.map(l => ({ ...l, key: e.key }))).sort((a, b) => b.at.localeCompare(a.at)).map((l, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-foreground/80">
                <span className="font-medium text-brand-dark">{l.action === "closed" ? "Closed" : "Reopened"} {l.key}</span>
                <span>· {new Date(l.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} · {l.byName}</span>
                {l.note && <span className="text-muted-foreground">— {l.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {closing && <CloseYearSheet fy={closing} custom={custom && nextToClose?.fy.from === closing.from} taken={entries.filter(e => e.from !== closing.from).map(e => e.key)} onClose={() => setClosing(null)} />}
      {viewing && <YearBookSheet fy={viewing} onClose={() => setViewing(null)} />}
      {reopening && <ReopenSheet fy={reopening} onClose={() => setReopening(null)} />}
    </div>
  );
}

function lastLog(e: YearCloseEntry | undefined, action: "closed" | "reopened") {
  return [...(e?.log ?? [])].reverse().find(l => l.action === action);
}

/* ── Close: checks → the figures → confirm ─────────────────────────────── */
function CloseYearSheet({ fy: opened, custom = false, taken = [], onClose }: { fy: FiscalYear; custom?: boolean; taken?: string[]; onClose: () => void }) {
  const { user } = useAuth();
  // On own dates the last day is chosen here (the eve of Diwali, say); the year's
  // name follows from its dates. Otherwise the year is fixed.
  const yesterday = addDays(dayOf(new Date()), -1);
  const [end, setEnd] = useState(opened.to);
  const fy = custom ? customYear(opened.from, end, taken) : opened;
  const [step, setStep] = useState<"loading" | "review" | "saving">("loading");
  const [book, setBook] = useState<YearBook | null>(null);
  const [checks, setChecks] = useState<CloseCheck[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");

  // Work the year out once the panel is open (and again when its last day is
  // changed): every record loaded first.
  useEffect(() => {
    let live = true;
    setStep("loading"); setTyped("");
    if (custom && !(end >= fy.from && end <= yesterday)) { setFailed(`Choose a last day from ${fiscalDay(fy.from)} to ${fiscalDay(yesterday)}.`); return; }
    setFailed(null);
    void (async () => {
      try {
        if (!(await readyForBook())) { if (live) setFailed("Still loading the records — close this and try again in a moment."); return; }
        const all = loadDb();
        const b = buildYearBook(all, fy);
        if (!live) return;
        setBook(b);
        setChecks(closeChecks(all, fy, b));
        setStep("review");
      } catch (e) {
        console.error("[year close] could not work the year out", e);
        if (live) setFailed("The year's figures could not be worked out. Nothing was changed.");
      }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);

  const stops = checks.filter(c => c.level === "stop");
  const canClose = step === "review" && !!book && !stops.length && typed.trim() === fy.key;

  const doClose = async () => {
    if (!book || !canClose) return;
    const fb = auth.currentUser;
    if (!isAdminEmail(fb?.email)) { toast.error("Only the main admin can close a year."); return; }
    setStep("saving");
    try {
      // Worked out once more at the moment of closing, from the latest records.
      if (!(await readyForBook())) throw new Error("Still loading the records — try again in a moment.");
      const live = loadDb();
      const fresh = buildYearBook(live, fy);
      const stopNow = closeChecks(live, fy, fresh).filter(c => c.level === "stop");
      if (stopNow.length) { setChecks(closeChecks(live, fy, fresh)); setBook(fresh); setStep("review"); toast.error("Something changed — look at the checks again."); return; }
      const parts = bookParts(fresh);
      for (const [part, body] of Object.entries(parts)) {
        if (JSON.stringify(body).length > 900_000) throw new Error(`The Year book's ${part} is too large to keep in one record.`);
      }
      const at = new Date().toISOString();
      const byName = user?.name || fb?.displayName || fb?.email || "Main admin";
      updateDbAs({ summary: `Closed the financial year ${fy.key}` }, d => {
        if (!d.adminRecords) d.adminRecords = [];
        // The frozen book, replacing any from an earlier close of the same year
        // (on own dates the year may have been closed before under another last day).
        const sameYear = new Set([fy.key, ...(d.settings.yearCloses ?? []).filter(e => e.from === fy.from).map(e => e.key)]);
        d.adminRecords = d.adminRecords.filter(r => !(r.kind === "yearBook" && sameYear.has(r.key)));
        for (const [part, body] of Object.entries(parts)) {
          d.adminRecords.push({ id: `year_${fy.key}_${part}`, kind: "yearBook", key: fy.key, part, book: body } as AdminRecord);
        }
        const list = d.settings.yearCloses ? [...d.settings.yearCloses] : [];
        const i = list.findIndex(e => e.key === fy.key || e.from === fy.from);
        const prev = i >= 0 ? list[i] : { key: fy.key, from: fy.from, to: fy.to, status: "closed" as const, log: [] };
        const entry: YearCloseEntry = { ...prev, key: fy.key, from: fy.from, to: fy.to, status: "closed", log: [...prev.log, { action: "closed", at, by: user?.id || fb!.uid, byName, ...(note.trim() ? { note: note.trim() } : {}) }] };
        if (i >= 0) list[i] = entry; else list.push(entry);
        d.settings.yearCloses = list;
        d.settings.booksClosedTo = fy.to;
        if (!d.settings.fyStartMonth && !custom) d.settings.fyStartMonth = Number(fy.from.slice(5, 7));
      });
      await flush();
      if (closedTo(loadDb().settings) !== fy.to) throw new Error("The close was not saved — check your connection and try again.");
      toast.success(`${fy.key} is closed. Its Year book is kept in Settings → Year closing.`);
      onClose();
    } catch (e) {
      setStep("review");
      toast.error(e instanceof Error ? e.message : "The year was not closed.");
    }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o && step !== "saving") onClose(); }} size="xl" icon={BookLock}
      title={`Close ${fy.key}`} description={fiscalYearSpan(fy)}
      footer={step !== "loading" && !failed ? (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <Label htmlFor="fy-type" className="text-xs text-muted-foreground">Type <b className="text-brand-dark">{fy.key}</b> to close the year</Label>
            <Input id="fy-type" value={typed} onChange={e => setTyped(e.target.value)} placeholder={fy.key} className="h-10 rounded-xl mt-1" autoComplete="off" disabled={!!stops.length || step === "saving"} />
          </div>
          <Button className="h-10 rounded-xl" disabled={!canClose} onClick={doClose}>
            {step === "saving" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}Close {fy.key}
          </Button>
        </div>
      ) : undefined}>
      {custom && (
        <div className="mb-6 rounded-xl border border-border/70 p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="fy-end" className="text-xs text-muted-foreground">Last day of this year</Label>
            <Input id="fy-end" type="date" value={end} min={fy.from} max={yesterday} onChange={e => e.target.value && setEnd(e.target.value)} className="h-10 rounded-xl mt-1 w-auto" disabled={step === "saving"} />
          </div>
          <p className="text-xs text-muted-foreground pb-2.5 max-w-sm">From {fiscalDay(fy.from)}. Pick the day the books close — the eve of Diwali, say. The next year starts the day after.</p>
        </div>
      )}
      {failed ? <p className="text-sm text-destructive">{failed}</p>
        : step === "loading" || !book ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Working out every balance as on {fmtDate(fy.to)}…</p>
        : (
        <div className="space-y-6">
          <section>
            <SectionTitle title="1 · Checks" sub={stops.length ? `${stops.length} to fix before closing` : "Nothing stops the close"} />
            <ul className="mt-3 space-y-2">
              {checks.length === 0 && <li className="flex gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-success mt-0.5" />Everything agrees.</li>}
              {checks.map((c, i) => (
                <li key={i} className={`flex gap-2.5 rounded-xl border p-3 text-sm ${c.level === "stop" ? "border-destructive/40 bg-destructive/5" : c.level === "warn" ? "border-warning/40 bg-warning/5" : "border-border/60"}`}>
                  {c.level === "stop" ? <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" /> : c.level === "warn" ? <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />}
                  <span className="min-w-0"><span className="font-medium text-brand-dark">{c.title}</span><span className="block text-foreground/75">{c.detail}</span>
                    {c.link && <Link to={c.link} className="text-primary text-xs font-medium hover:underline">Open</Link>}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <SectionTitle title={`2 · The Year book as on ${fmtDate(fy.to)}`} sub="What will be frozen — check it before closing" />
            <div className="mt-3"><BookBody book={book} /></div>
          </section>
          <section className="space-y-1.5">
            <SectionTitle title="3 · Close" sub="Locks the year for everyone, admins included" />
            <Label htmlFor="fy-note" className="text-xs text-muted-foreground">A note (optional) — e.g. “Audited by …”</Label>
            <Textarea id="fy-note" value={note} onChange={e => setNote(e.target.value)} rows={2} className="rounded-xl" />
          </section>
        </div>
      )}
    </ActionSheet>
  );
}

/* ── Reopen (the last closed year), with a reason ──────────────────────── */
function ReopenSheet({ fy, onClose }: { fy: FiscalYear; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // The lock moves back to the close before this one — whatever its dates.
  const before = (db.settings.yearCloses ?? []).filter(e => e.status === "closed" && e.to < fy.from).sort((a, b) => b.to.localeCompare(a.to))[0];

  const doReopen = async () => {
    const fb = auth.currentUser;
    if (!isAdminEmail(fb?.email)) { toast.error("Only the main admin can reopen a year."); return; }
    if (reason.trim().length < 4) { toast.error("Say why the year is being reopened."); return; }
    setBusy(true);
    try {
      const at = new Date().toISOString();
      const byName = user?.name || fb?.displayName || fb?.email || "Main admin";
      updateDbAs({ summary: `Reopened the financial year ${fy.key} — ${reason.trim()}` }, d => {
        const list = d.settings.yearCloses ? [...d.settings.yearCloses] : [];
        const i = list.findIndex(e => e.key === fy.key);
        const prev = i >= 0 ? list[i] : { key: fy.key, from: fy.from, to: fy.to, status: "closed" as const, log: [] };
        const entry: YearCloseEntry = { ...prev, status: "reopened", log: [...prev.log, { action: "reopened", at, by: user?.id || fb!.uid, byName, note: reason.trim() }] };
        if (i >= 0) list[i] = entry; else list.push(entry);
        d.settings.yearCloses = list;
        // The lock moves back to the year before — closed only if it was closed.
        if (before) d.settings.booksClosedTo = before.to; else delete d.settings.booksClosedTo;
      });
      await flush();
      toast.success(`${fy.key} is open again. Close it again when the corrections are done.`);
      onClose();
    } catch {
      toast.error("The year was not reopened.");
    } finally { setBusy(false); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o && !busy) onClose(); }} size="md" icon={LockOpen} title={`Reopen ${fy.key}`} description={fiscalYearSpan(fy)}
      footer={<Button className="h-10 rounded-xl w-full sm:w-auto" disabled={busy || reason.trim().length < 4} onClick={doReopen}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LockOpen className="h-4 w-4 mr-2" />}Reopen {fy.key}</Button>}>
      <div className="space-y-4 text-sm">
        <p>Entries dated in {fy.key} can be added, corrected and deleted again until the year is closed again. Its Year book stays as it was closed, for comparison.</p>
        <p className="text-muted-foreground">Reopening is recorded with your name and reason. Close the year again when the corrections are done — the Year book is then worked out afresh.</p>
        <div>
          <Label htmlFor="fy-reason" className="text-xs text-muted-foreground">Why is it being reopened?</Label>
          <Textarea id="fy-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} className="rounded-xl mt-1" placeholder="e.g. A March bill was entered with the wrong amount" />
        </div>
      </div>
    </ActionSheet>
  );
}

/* ── A closed year's Year book ─────────────────────────────────────────── */
function YearBookSheet({ fy, onClose }: { fy: FiscalYear; onClose: () => void }) {
  const db = useDb();
  const book = storedBook(db, fy.key);
  const entry = (db.settings.yearCloses ?? []).find(e => e.key === fy.key);
  const closedLog = lastLog(entry, "closed");
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="xl" icon={BookOpen} title={`Year book ${fy.key}`}
      description={<>{fiscalYearSpan(fy)}{closedLog ? ` · closed ${fmtDate(closedLog.at)} by ${closedLog.byName}` : ""}{entry?.status === "reopened" ? " · reopened since — this is the book as it was closed" : ""}</>}>
      {book ? <BookBody book={book} /> : <p className="text-sm text-muted-foreground">No Year book is kept for this year.</p>}
    </ActionSheet>
  );
}

/* ── The book itself: profit & loss, then every balance ────────────────── */
function BookBody({ book }: { book: YearBook }) {
  const db = useDb();
  const p = book.pnl;
  const coName = (id?: string) => (id ? companyById(db.settings, id).name : "");
  const multiCo = (db.settings.companies ?? []).length > 0;
  const suffix = `-${book.key}`;

  const totalsClients = book.clients.reduce((s, c) => s + c.net, 0);
  const cash = new Map<string, number>();
  for (const l of book.lockers) cash.set(l.currency, (cash.get(l.currency) || 0) + l.balance);
  const stockValue = book.stock.reduce((s, x) => s + (x.valueInr || 0), 0) + book.packets.valueInr;

  const stockCols: DataColumn<StockLine>[] = [
    { key: "what", header: "Material", always: true, sortValue: s => `${s.material}|${s.bucket}`, csv: s => `${s.material === "gold" ? "Gold" : s.material === "diamond" ? "Diamond" : materialName(db.settings, s.material)} ${s.bucket}`,
      cell: s => <span><span className="font-medium">{s.material === "gold" ? "Gold" : s.material === "diamond" ? "Diamond" : materialName(db.settings, s.material)}</span> · {s.bucket}</span> },
    ...(multiCo ? [{ key: "co", header: "Company", sortValue: (s: StockLine) => coName(s.companyId), cell: (s: StockLine) => coName(s.companyId) }] : []),
    { key: "qty", header: "Quantity", align: "right", sortValue: s => s.qty, csv: s => s.qty, cell: s => `${s.qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${s.unit}` },
    { key: "fine", header: "Fine gold", align: "right", hideIfEmpty: true, sortValue: s => s.fine ?? null, csv: s => s.fine ?? "", cell: s => (s.fine != null ? grams(s.fine) : "") },
    { key: "rate", header: "Average cost", align: "right", sortValue: s => s.rateInr, csv: s => s.rateInr ?? "", cell: s => (s.rateInr == null ? <span className="text-muted-foreground">Not priced</span> : `${inr(s.rateInr)}/${s.unit}`) },
    { key: "value", header: "Value", align: "right", sortValue: s => s.valueInr, csv: s => s.valueInr ?? "", cell: s => inr(s.valueInr) },
  ];

  return (
    <div className="space-y-7">
      <section>
        <SectionTitle title="Profit & loss" sub={`${p.sold} sale${p.sold === 1 ? "" : "s"} dispatched in the year — as Reports → Profit & Loss`} />
        <div className="mt-3">
          <StatStrip items={[
            { label: "Sales", value: usd(p.salesUsd), sub: p.salesInr != null ? inr(p.salesInr) : undefined, tone: "in" },
            { label: "Gross profit", value: usd(p.grossProfitUsd), sub: p.grossMarginPct != null ? `${p.grossMarginPct}% margin` : undefined },
            { label: "Running costs", value: usd(p.expenses.usd), sub: `${inr(p.expenses.inr)} · ${p.expenses.count} expense${p.expenses.count === 1 ? "" : "s"}`, tone: "out" },
            { label: "Net profit", value: usd(p.netUsd), sub: p.netMarginPct != null ? `${p.netMarginPct}% of sales` : undefined, tone: "strong" },
          ]} note={[
            p.incomplete ? `${p.incomplete} sale${p.incomplete === 1 ? "" : "s"} counted on part of their cost.` : "",
            p.fxUsd ? `Exchange difference ${usd(p.fxUsd)}.` : "",
            p.supplierSales.count ? `Sales to suppliers: profit ${inr(p.supplierSales.profitInr)}.` : "",
          ].filter(Boolean).join(" ") || undefined} />
        </div>
      </section>

      <section>
        <SectionTitle title={`Balances as on ${fmtDate(book.to)}`} sub="Each one is the new year's opening balance" />
        <div className="mt-3">
          <StatStrip items={[
            { label: "Clients (net)", value: usd(totalsClients), sub: `${book.clients.length} with a balance` },
            { label: "Suppliers (net)", value: inr(book.suppliers.reduce((s, x) => s + x.net, 0)), sub: "+ we owe them" },
            { label: "Factories", value: inr(book.factories.reduce((s, x) => s + x.owed, 0)), sub: `${grams(book.factories.reduce((s, x) => s + x.fineGold, 0))} fine gold with them` },
            { label: "Cash & bank", value: [...cash].map(([c, n]) => fmtCcy(n, c)).join(" · ") || "—" },
            { label: "Stock value", value: inr(stockValue), sub: `${book.readyStock.pieces} Ready Stock pieces` },
          ]} />
        </div>
      </section>

      <PartyTable title="Clients" sub="$ — + they owe us, − we hold their money" rows={book.clients} id="yb-clients" exportName={`Year-book-clients${suffix}`}
        href={r => `/clients/${r.id}`} figures={[{ key: "net", header: "Balance", get: r => r.net, fmt: usd }]} />
      <PartyTable title="Suppliers" sub="₹ — + we owe them, − they hold ours; gold owed in fine grams" rows={book.suppliers} id="yb-suppliers" exportName={`Year-book-suppliers${suffix}`}
        href={r => `/suppliers/${r.id}`} figures={[{ key: "net", header: "Balance", get: r => r.net, fmt: inr }, { key: "gold", header: "Gold owed", get: r => r.goldFine, fmt: n => (n ? grams(n) : "") }]} />
      <PartyTable title="Factories" sub="Labour owed (₹), and what they hold of ours" rows={book.factories} id="yb-factories" exportName={`Year-book-factories${suffix}`}
        href={r => `/factories/${r.id}`} figures={[
          { key: "owed", header: "Labour owed", get: r => r.owed, fmt: inr },
          { key: "gold", header: "Fine gold", get: r => r.fineGold, fmt: n => (n ? grams(n) : "") },
          { key: "dia", header: "Diamonds", get: r => r.diamondCt, fmt: n => (n ? carats(n) : "") },
          { key: "other", header: "Other", get: r => Object.keys(r.other).length, text: r => Object.entries(r.other).map(([k, q]) => `${materialName(db.settings, k)} ${q}`).join(" · ") },
        ]} />
      {(book.brokers.length > 0 || book.designers.length > 0) && (
        <PartyTable title="Brokers & designers" sub="₹ — + we owe them, − they hold ours" id="yb-brokers" exportName={`Year-book-brokers-designers${suffix}`}
          rows={[...book.brokers.map(b => ({ ...b, net: b.due, kind: "Broker" })), ...book.designers.map(d => ({ ...d, net: d.due, kind: "Designer" }))]}
          href={r => (r.kind === "Broker" ? `/suppliers/brokers/${r.id}` : `/designers/${r.id}`)}
          figures={[{ key: "kind", header: "", get: () => 0, text: r => r.kind }, { key: "net", header: "Balance", get: r => r.net, fmt: inr }]} />
      )}
      {book.employees.length > 0 && (
        <PartyTable title="Employees — advance (upad)" sub="What each still owed back" rows={book.employees} id="yb-employees" exportName={`Year-book-employee-advances${suffix}`}
          href={r => `/employees/${r.id}`} figures={[{ key: "owed", header: "Advance owed", get: r => Object.values(r.owed).reduce((s, v) => s + v, 0), text: r => Object.entries(r.owed).map(([c, v]) => fmtCcy(v, c)).join(" · ") }]} />
      )}
      <PartyTable title="Cash & bank accounts" sub="Each in its own currency" rows={book.lockers} id="yb-lockers" exportName={`Year-book-accounts${suffix}`}
        href={() => "/locker"} figures={[{ key: "bal", header: "Balance", get: r => r.balance, text: r => fmtCcy(r.balance, r.currency) }]} />

      <section>
        <SectionTitle title="Closing stock" sub={`At each lot's average cost on ${fmtDate(book.to)}`} />
        <div className="mt-3">
          <DataTable id="yb-stock" noun="lot" rows={book.stock} columns={stockCols} rowKey={s => `${s.companyId}|${s.material}|${s.bucket}`}
            exportName={`Year-book-stock${suffix}`} pageSizes={[25, 50, 100]} defaultSort={{ key: "value", dir: "desc" }}
            searchText={s => `${s.material} ${s.bucket}`} emptyText="No stock on the day." />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Certified stones: {book.packets.count} ({carats(book.packets.ct)}) · {inr(book.packets.valueInr)}{book.packets.unpriced ? ` · ${book.packets.unpriced} not priced` : ""}.
          {" "}Ready Stock: {book.readyStock.pieces} piece{book.readyStock.pieces === 1 ? "" : "s"} · cost {usd(book.readyStock.costUsd)}{book.readyStock.unpriced ? ` · ${book.readyStock.unpriced} with no cost` : ""}.
        </p>
      </section>
    </div>
  );
}

type Fig<R> = { key: string; header: string; get: (r: R) => number; fmt?: (n: number) => string; text?: (r: R) => string };
function PartyTable<R extends { id: string; name: string }>({ title, sub, rows, id, exportName, href, figures }: {
  title: string; sub: string; rows: R[]; id: string; exportName: string; href: (r: R) => string; figures: Fig<R>[];
}) {
  const columns: DataColumn<R>[] = [
    { key: "name", header: "Name", always: true, sortValue: r => r.name, cell: r => <span className="font-medium text-brand-dark">{r.name}</span> },
    ...figures.map((f): DataColumn<R> => ({
      key: f.key, header: f.header, align: f.text && !f.fmt ? "left" : "right",
      sortValue: r => (f.text && !f.fmt ? f.text(r) : f.get(r)), csv: r => (f.text ? f.text(r) : f.get(r)),
      cell: r => (f.text ? f.text(r) : f.fmt ? f.fmt(f.get(r)) : String(f.get(r))),
    })),
  ];
  return (
    <section>
      <SectionTitle title={title} sub={sub} />
      <div className="mt-3">
        <DataTable id={id} noun="row" rows={rows} columns={columns} rowKey={r => r.id} rowHref={href} exportName={exportName}
          pageSizes={[10, 25, 50]} searchText={r => r.name} emptyText="Nothing owed either way." />
      </div>
    </section>
  );
}
