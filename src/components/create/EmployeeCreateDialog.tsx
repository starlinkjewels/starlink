import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { choicesOf } from "@/lib/optionLists";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Clock, Crown, Eye, EyeOff, KeyRound, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { loadDb, updateDb, flush, uid, rolesStoreReady, type User, type DB } from "@/lib/db";
import { REACH_LABEL, ROLE_MODULES, countCells, diffFromRole, tempState, type PermMatrix } from "@/lib/permissions";
import { AccessFields, accessTemplates, draftFor, permWords, writeAccess, type AccessDraft } from "@/components/AccessManager";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { createAuthUser, isAdminEmail } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { companiesOf, hasCompanies } from "@/lib/companies";
import { CompanyTicks } from "@/components/EmployeeCompanies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { confirmBox } from "@/lib/confirm";

// Departments: Settings → Dropdown lists.

/**
 * The one Create Employee form — the Employees page's, also opened from
 * "+ Add new employee" wherever an employee is picked. Admin only.
 */
/** Who already holds this email, said so that the next step is plain. */
export function emailTakenMessage(db: DB, email: string, exceptId?: string): string | null {
  const u = db.users.find(x => x.id !== exceptId && (x.email || "").toLowerCase() === email);
  if (!u) return null;
  if (u.role === "client") {
    const c = db.clients.find(x => x.id === u.clientId);
    return `That email is the login of a client${c ? ` (${c.companyName})` : ""}. Use a different email for the employee.`;
  }
  const who = `${u.name}${u.role === "admin" ? " (admin)" : ""}`;
  if (!u.authUid) return `That email is already on ${who}, who has no login yet. Open the Employees page and press "Give login" on their card instead of adding them again.`;
  if (u.status === "inactive") return `That email belongs to ${who}, who is deactivated. Press "Activate" on their card instead of adding them again.`;
  return `That email already belongs to ${who} on the Employees page.`;
}

/* The form is in steps, one thing at a time: who they are (and whether they
 * sign in), what they may do, then pay and a last look before it is created.
 * Access is a step only for someone with a login — without one there is
 * nothing for access to apply to, as before. */
type StepKey = "person" | "access" | "review";
const STEP: Record<StepKey, { label: string; hint: string }> = {
  person: { label: "Person", hint: "Who they are and how they sign in" },
  access: { label: "Access", hint: "What they may see and do" },
  review: { label: "Pay & review", hint: "Opening pay, then a last look" },
};

/** A labelled field; the star marks what must be filled in. */
function Field({ id, label, required, children }: { id?: string; label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id} className="text-xs font-medium text-foreground/80">
        {label}{required && <span className="text-destructive ml-0.5" aria-hidden>*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** A section's title and one quiet line under it. */
function SectionHead({ icon, title, optional, hint }: { icon?: ReactNode; title: string; optional?: boolean; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5">
        {icon}{title}{optional && <span className="text-[11px] font-normal text-muted-foreground">— optional</span>}
      </p>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export function EmployeeCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
}) {
  const db = useDb();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", phone: "", department: "Sales" });
  // Someone who is only on the books for wages does not need to sign in. Forcing
  // an email and password on them meant inventing a fake address, which then
  // occupies a login and cannot be reused for a real one.
  const [needsLogin, setNeedsLogin] = useState(true);
  // What they may do once signed in: Standard staff, one of the custom roles,
  // or a full admin — a partner in the business. Only offered once roles are
  // live on the server, since until then the server would not honour an admin.
  // An employee, with access set right here — their role, anything changed for
  // them, temporary access — or a full admin (a partner in the business).
  const [access, setAccess] = useState<"employee" | "admin">("employee");
  const [draft, setDraft] = useState<AccessDraft>(() => draftFor(db.roles ?? [], null));
  const { user: me } = useAuth();
  // The companies a new employee sells for — none ticked = every company.
  const [coIds, setCoIds] = useState<string[]>([]);
  const rolesLive = rolesStoreReady();
  // Opening salary already paid before the app (migration) — optional.
  const [openingPaid, setOpeningPaid] = useState("");
  const [openingCurrency, setOpeningCurrency] = useState<"INR" | "USD">("INR");
  const [openingDate, setOpeningDate] = useState("");

  // Which step is showing, and whether Next was refused (marks the empty fields).
  const [step, setStep] = useState<StepKey>("person");
  const [tried, setTried] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const stepTop = useRef<HTMLDivElement>(null);
  const steps: StepKey[] = needsLogin ? ["person", "access", "review"] : ["person", "review"];
  const cur: StepKey = steps.includes(step) ? step : "person";
  const pos = steps.indexOf(cur);
  const last = pos === steps.length - 1;
  // Admin partners get no department or companies — as the create writes it.
  const asAdminChosen = needsLogin && rolesLive && access === "admin";

  // Each opening starts at the first step; what was typed is kept, as before.
  useEffect(() => { if (open) { setStep("person"); setTried(false); setShowPw(false); } }, [open]);
  // A new step starts at its top, not where the last one was scrolled to.
  useEffect(() => { stepTop.current?.parentElement?.scrollTo({ top: 0 }); }, [cur]);

  /** The checks the create makes of the person and their login — asked before
   *  leaving the first step too, so a mistake is caught where it can be fixed. */
  const personOk = (): boolean => {
    if (!f.name.trim()) { toast.error("Enter a name"); return false; }
    // Without a login there is no email at all — whatever was typed before the
    // login was switched off is hidden, and must not be checked or kept.
    const email = needsLogin ? f.email.trim().toLowerCase() : "";
    if (needsLogin) {
      if (!email || !f.password) { toast.error("Enter an email and password, or turn off the login"); return false; }
      // An owner's login is a permanent admin already — it exists, and adding it
      // again would only make a second record for the same person.
      if (isAdminEmail(email)) { toast.error("That is an owner's login — it is already a permanent admin and needs no record here. Use the partner's own email."); return false; }
      const taken = emailTakenMessage(loadDb(), email);
      if (taken) { toast.error(taken, { duration: 9000 }); return false; }
    }
    return true;
  };

  const go = (to: StepKey) => {
    // Past the first step only once it is right; going back is always allowed.
    if (cur === "person" && to !== "person" && !personOk()) { setTried(true); return; }
    setStep(to);
  };
  const next = () => { if (!last) go(steps[pos + 1]); };
  const back = () => { if (pos > 0) setStep(steps[pos - 1]); };
  // Enter in a field of the first step moves on, as a one-page form would submit.
  const enterNext = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && !e.nativeEvent.isComposing) { e.preventDefault(); next(); }
  };

  const create = async () => {
    const newId = uid("u_");
    // Asked again here: the email may have been taken since the first step.
    if (!personOk()) { setTried(true); setStep("person"); return; }
    // Without a login there is no email at all — whatever was typed before the
    // login was switched off is hidden, and must not be checked or kept.
    const email = needsLogin ? f.email.trim().toLowerCase() : "";

    setSaving(true);
    try {
      // Only create a sign-in account when they actually need one. A
      // salary-only record has no Auth user, no email and no password — it exists
      // to be paid and to appear in the salary ledger, nothing more.
      const asAdmin = needsLogin && rolesLive && access === "admin";
      if (asAdmin && !(await confirmBox(`Create ${f.name.trim()} as an admin?\n\nThey will be able to do everything — money, settings, employees, roles and other admins. Owners stay owners.`))) return;
      const authUid = needsLogin ? await createAuthUser(email, f.password) : undefined;
      const opAmt = Number(openingPaid);
      const at = new Date().toISOString();
      updateDb(d => {
        d.users.push({
        id: newId, role: asAdmin ? "admin" : "employee", status: "active", createdAt: at,
        ...(!asAdmin && coIds.length ? { companyIds: coIds } : {}),
        authUid, username: email, email, password: "",
        // A department says where on the floor someone works; an admin partner
        // runs the whole business, so they are not given one.
        name: f.name, phone: f.phone, department: asAdmin ? undefined : f.department,
        openingPaid: opAmt > 0 ? opAmt : undefined,
        openingPaidCurrency: opAmt > 0 ? openingCurrency : undefined,
        openingPaidDate: opAmt > 0 ? (openingDate || undefined) : undefined,
        } as User);
        // Their access: the role on their profile, anything changed for them
        // and any temporary access in their own record.
        if (needsLogin && rolesLive && !asAdmin) writeAccess(d, newId, draft, { name: me?.name ?? "Admin" }, at);
      });
      // Wait for the login's permission record to reach the server before
      // saying it is done. It goes up just after the profile; close the tab in
      // between and the account can sign in to nothing.
      await flush();
      toast.success(!needsLogin ? "Employee added for salary — no login created"
        : asAdmin ? "Admin created — they can sign in and do everything"
        : "Employee created — they can sign in with their email & password");
      onOpenChange(false);
      onCreated?.(newId);
      setF({ name: "", email: "", password: "", phone: "", department: "Sales" });
      setNeedsLogin(true);
      setAccess("employee");
      setDraft(draftFor(loadDb().roles ?? [], null));
      setCoIds([]);
      setOpeningPaid(""); setOpeningCurrency("INR"); setOpeningDate("");
    } catch (e) {
      toast.error(authErrorMessage(e));
    } finally { setSaving(false); }
  };

  // ── The last step's summary: what the create above will write. ──
  const docs = db.roles ?? [];
  const sameAs = (a: PermMatrix, b: PermMatrix) => { const d = diffFromRole(a, b); return countCells(d.add) + countCells(d.remove) === 0; };
  const tpl = accessTemplates(docs).find(t => sameAs(t.perms, draft.perms) && t.reach === draft.reach);
  const sections = ROLE_MODULES.filter(m => draft.perms[m.key]?.view).length;
  const liveTemp = draft.temp.filter(t => tempState(t) !== "ended");
  const multiCo = hasCompanies(db.settings);
  const opAmtNow = Number(openingPaid);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep");
  const review: { label: string; value: ReactNode; edit?: StepKey }[] = [
    { label: "Name", value: f.name.trim() || "—", edit: "person" },
    { label: "Phone", value: f.phone.trim() || "—", edit: "person" },
    ...(!asAdminChosen ? [{ label: "Department", value: f.department, edit: "person" as StepKey }] : []),
    ...(multiCo && !asAdminChosen ? [{
      label: "Sells for", edit: "person" as StepKey,
      value: coIds.length ? companiesOf(db.settings).filter(c => coIds.includes(c.id)).map(c => c.name).join(", ") : "Every company",
    }] : []),
    { label: "Sign-in", edit: "person",
      value: needsLogin ? <span className="break-all">{f.email.trim().toLowerCase()}</span> : <span className="italic text-muted-foreground">No login — salary only</span> },
    ...(needsLogin ? [{
      label: "Access", edit: "access" as StepKey,
      value: !rolesLive ? "Standard staff"
        : access === "admin" ? <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium"><Crown className="h-3.5 w-3.5" /> Admin — partner · can do everything</span>
        : `${tpl ? `${tpl.name} access` : "Custom access"} · ${sections} section${sections !== 1 ? "s" : ""} · ${REACH_LABEL[draft.reach].toLowerCase()}`,
    }] : []),
    // Temporary access is kept only for an employee once roles are live.
    ...(needsLogin && rolesLive && !asAdminChosen ? [{
      label: "Temporary", edit: "access" as StepKey,
      value: liveTemp.length
        ? <span className="block space-y-0.5">{liveTemp.map(t => (
            <span key={t.id} className="flex items-start gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" /><span className="min-w-0">{permWords(t.perms, t.reach)} <span className="text-muted-foreground">· until {day(t.until)}</span></span></span>
          ))}</span>
        : <span className="text-muted-foreground">None</span>,
    }] : []),
    { label: "Opening paid",
      value: opAmtNow > 0
        ? `${openingCurrency === "INR" ? "₹" : "$"}${opAmtNow.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${openingDate ? ` · as of ${day(`${openingDate}T00:00`)}` : ""}`
        : <span className="text-muted-foreground">None</span> },
  ];
  const bad = (empty: boolean) => (tried && empty ? "border-destructive focus-visible:ring-destructive" : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        {/* One height on a computer for every step, so Next stays where it is. */}
        <DialogContent className="max-w-4xl rounded-2xl sm:h-[min(90dvh,46rem)]">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Create Employee</DialogTitle>
            <DialogDescription className="text-xs">{STEP[cur].hint}</DialogDescription>
            {/* Where they are: a step done can be gone back to; the next ones
                only through the checks Next makes. */}
            <ol className="flex items-center gap-2 pt-3" aria-label="Steps">
              {steps.map((k, i) => {
                const done = i < pos, on = i === pos;
                return (
                  <li key={k} className={`flex items-center gap-2 min-w-0 ${i < steps.length - 1 ? "flex-1" : ""}`}>
                    <button type="button" onClick={() => go(k)} aria-current={on ? "step" : undefined}
                      className="group flex items-center gap-2 min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className={`h-6 w-6 shrink-0 rounded-full grid place-items-center text-[11px] font-bold tabular-nums transition-colors ${on ? "bg-primary text-primary-foreground ring-4 ring-primary/15" : done ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      <span className={`text-sm font-medium truncate ${on ? "text-brand-dark" : "text-muted-foreground group-hover:text-foreground max-sm:hidden"}`}>{STEP[k].label}</span>
                    </button>
                    {i < steps.length - 1 && <span aria-hidden className={`h-px flex-1 min-w-3 ${done ? "bg-primary/40" : "bg-border"}`} />}
                  </li>
                );
              })}
            </ol>
          </DialogHeader>

          {/* ── 1 · Person ── */}
          {cur === "person" && (
            <div ref={stepTop} className="space-y-6" onKeyDown={enterNext}>
              <section className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field id="ec-name" label="Name" required>
                    <Input id="ec-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Full name"
                      aria-invalid={tried && !f.name.trim()} className={`h-10 rounded-xl ${bad(!f.name.trim())}`} />
                  </Field>
                  <Field id="ec-phone" label="Phone">
                    <Input id="ec-phone" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className="h-10 rounded-xl" />
                  </Field>
                  {!asAdminChosen && (
                    <Field label="Department">
                      <Select value={f.department} onValueChange={v => setF({ ...f, department: v })}>
                        <SelectTrigger className="h-10 rounded-xl" aria-label="Department"><SelectValue /></SelectTrigger>
                        <SelectContent>{choicesOf("departments", f.department).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  )}
                </div>
                {!asAdminChosen && <CompanyTicks value={coIds} onChange={setCoIds} />}
              </section>

              {/* Wages-only staff never sign in, so nothing about a login is asked
                  of them. It used to be compulsory, which meant inventing an email
                  that then blocks that address from ever being a real login. */}
              <section className="rounded-xl border border-border/70 overflow-hidden">
                <label className="flex items-start gap-3 p-4 cursor-pointer">
                  <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><KeyRound className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-brand-dark block">Give them a login</span>
                    <span className="text-xs text-muted-foreground block mt-0.5">Off for wages-only staff — no email needed.</span>
                  </span>
                  <Switch checked={needsLogin} onCheckedChange={setNeedsLogin} aria-label="Give them a login" className="mt-1" />
                </label>
                {needsLogin && (
                  <div className="border-t border-border/60 bg-secondary/30 p-4 grid sm:grid-cols-2 gap-4">
                    <Field id="ec-email" label="Email (login ID)" required>
                      <Input id="ec-email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="off" placeholder="name@company.com"
                        aria-invalid={tried && !f.email.trim()} className={`h-10 rounded-xl bg-white ${bad(!f.email.trim())}`} />
                    </Field>
                    <Field id="ec-password" label="Password" required>
                      <div className="relative">
                        <Input id="ec-password" type={showPw ? "text" : "password"} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="new-password"
                          aria-invalid={tried && !f.password} className={`h-10 rounded-xl bg-white pr-10 ${bad(!f.password)}`} />
                        <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? "Hide password" : "Show password"} title={showPw ? "Hide password" : "Show password"}
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
                          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </Field>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── 2 · Access (only with a login) ── */}
          {cur === "access" && (
            <div ref={stepTop} className="space-y-6">
              <section className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <SectionHead title="Kind of account" hint="An admin partner can do everything." />
                <div role="radiogroup" aria-label="Kind of account" className="grid grid-cols-2 sm:inline-flex gap-0.5 p-1 rounded-xl bg-secondary border border-border/60 shrink-0">
                  {([["employee", "Employee", UserRound], ["admin", "Admin — partner", ShieldCheck]] as const).map(([k, l, Icon]) => (
                    <button key={k} type="button" role="radio" aria-checked={access === k} disabled={!rolesLive} onClick={() => setAccess(k)}
                      className={`h-9 px-2.5 sm:px-3.5 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all disabled:opacity-50 ${access === k ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                      <Icon className={`h-4 w-4 ${access === k ? "text-primary" : ""}`} />{l}
                    </button>
                  ))}
                </div>
              </section>
              {!rolesLive ? (
                <p className="rounded-xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">Until the security update is deployed, everyone is Standard staff.</p>
              ) : access === "admin" ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <Crown className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">Full control, as you have: money, settings and roles. Can be taken back later.</p>
                </div>
              ) : (
                <div className="border-t border-border/60 pt-6 space-y-5">
                  <p className="text-xs text-muted-foreground">Pick a role, then adjust anything for this person.</p>
                  <AccessFields layout="stacked" draft={draft} onChange={setDraft} docs={docs} by={{ id: me?.id ?? "", name: me?.name ?? "Admin" }} />
                </div>
              )}
            </div>
          )}

          {/* ── 3 · Pay & review ── */}
          {cur === "review" && (
            <div ref={stepTop} className="space-y-7">
              {/* Opening salary already paid before the app (optional, migration) */}
              <section className="space-y-3">
                <SectionHead icon={<Wallet className="h-4 w-4 text-amber-600" />} title="Already paid before this app" optional
                  hint="Added to their total paid to date." />
                <div className="grid grid-cols-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                  <Field label="Currency">
                    <Select value={openingCurrency} onValueChange={v => setOpeningCurrency(v as "INR" | "USD")}>
                      <SelectTrigger className="h-10 rounded-xl" aria-label="Currency"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="INR">₹ INR</SelectItem><SelectItem value="USD">$ USD</SelectItem></SelectContent>
                    </Select>
                  </Field>
                  <Field id="ec-opening" label="Amount">
                    <Input id="ec-opening" type="number" min={0} step="0.01" value={openingPaid} onChange={e => setOpeningPaid(e.target.value)} placeholder="0.00" className="h-10 rounded-xl" />
                  </Field>
                  <div className="col-span-2 sm:col-span-1 min-w-0">
                    <Field id="ec-opening-date" label="As of date">
                      <Input id="ec-opening-date" type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="h-10 rounded-xl" />
                    </Field>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHead title="Review" hint="All of it can be changed later." />
                <dl className="rounded-xl border border-border/70 divide-y divide-border/50 bg-white">
                  {review.map(r => (
                    <div key={r.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:grid-cols-[9rem_minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2.5">
                      <dt className="text-xs text-muted-foreground">{r.label}</dt>
                      <dd className="text-sm text-brand-dark min-w-0 break-words">{r.value}</dd>
                      {r.edit
                        ? <button type="button" onClick={() => go(r.edit!)} className="text-xs font-medium text-primary hover:underline">Edit</button>
                        : <span />}
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl text-muted-foreground sm:mr-auto">Cancel</Button>
            {pos > 0 && (
              <Button variant="outline" onClick={back} disabled={saving} className="rounded-xl gap-1"><ChevronLeft className="h-4 w-4" />Back</Button>
            )}
            {last ? (
              <Button onClick={create} disabled={saving} className="btn-hero rounded-xl px-6">
                {saving ? "Creating…" : <><span className="sm:hidden">Create</span><span className="max-sm:hidden">Create employee</span></>}
              </Button>
            ) : (
              <Button onClick={next} className="btn-hero rounded-xl px-5 gap-1">Next<ChevronRight className="h-4 w-4" /></Button>
            )}
          </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}
