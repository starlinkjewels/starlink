import { useState } from "react";
import { toast } from "sonner";
import { loadDb, updateDb, flush, uid, rolesStoreReady, type User, type DB } from "@/lib/db";
import { STANDARD_STAFF } from "@/lib/permissions";
import { AccessFields, draftFor, writeAccess, type AccessDraft } from "@/components/AccessManager";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { createAuthUser, isAdminEmail } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { CompanyTicks } from "@/components/EmployeeCompanies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { confirmBox } from "@/lib/confirm";

const DEPTS = ["Sales","CAD","Design","Production","Diamond Setting","Polishing","QC","Packing","Dispatch","Accounts"];

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

  const create = async () => {
    const newId = uid("u_");
    if (!f.name.trim()) { toast.error("Enter a name"); return; }
    // Without a login there is no email at all — whatever was typed before the
    // login was switched off is hidden, and must not be checked or kept.
    const email = needsLogin ? f.email.trim().toLowerCase() : "";
    if (needsLogin) {
      if (!email || !f.password) { toast.error("Enter an email and password, or turn off the login"); return; }
      // An owner's login is a permanent admin already — it exists, and adding it
      // again would only make a second record for the same person.
      if (isAdminEmail(email)) { toast.error("That is an owner's login — it is already a permanent admin and needs no record here. Use the partner's own email."); return; }
      const taken = emailTakenMessage(loadDb(), email);
      if (taken) { toast.error(taken, { duration: 9000 }); return; }
    }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`${needsLogin && rolesLive && access === "employee" ? "max-w-3xl" : "max-w-md"} rounded-2xl`}>
          <DialogHeader><DialogTitle className="font-display text-2xl">Create Employee</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {(["name", "phone"] as const).map(key => (
              <div key={key}>
                <Label className="text-xs capitalize">{key}</Label>
                <Input value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })}
                  className="rounded-xl mt-1" />
              </div>
            ))}

            {/* Wages-only staff never sign in, so nothing about a login is asked
                of them. It used to be compulsory, which meant inventing an email
                that then blocks that address from ever being a real login. */}
            <label className="flex items-start gap-2.5 rounded-xl border border-border/70 p-3 cursor-pointer">
              <input type="checkbox" checked={needsLogin} onChange={e => setNeedsLogin(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
              <span>
                <span className="text-sm font-medium text-brand-dark block">Give them a login</span>
                <span className="text-[11px] text-muted-foreground">
                  Leave this off for someone who is only on the books for wages — they are paid and appear in the
                  salary ledger without an email or password.
                </span>
              </span>
            </label>

            {needsLogin && (["email", "password"] as const).map(key => (
              <div key={key}>
                <Label className="text-xs">{key === "email" ? "Email (login ID)" : "Password"}</Label>
                <Input type={key === "password" ? "password" : "email"}
                  value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })}
                  className="rounded-xl mt-1" />
              </div>
            ))}
            {needsLogin && (
              <div className="rounded-xl border border-border/70 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-brand-dark">Access</p>
                  <div role="radiogroup" aria-label="Kind of account" className="inline-flex gap-0.5 p-1 rounded-xl bg-secondary">
                    {([["employee", "Employee"], ["admin", "Admin — partner"]] as const).map(([k, l]) => (
                      <button key={k} type="button" role="radio" aria-checked={access === k} disabled={!rolesLive} onClick={() => setAccess(k)}
                        className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${access === k ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
                    ))}
                  </div>
                </div>
                {!rolesLive ? <p className="text-[11px] text-muted-foreground">Roles and extra admins switch on once the security update is deployed — until then everyone is Standard staff.</p>
                  : access === "admin" ? <p className="text-[11px] text-muted-foreground">Full control, the same as you: money, settings, employees and roles. You can take it back later from their card.</p>
                  : <>
                      <p className="text-[11px] text-muted-foreground -mt-1">Pick the role closest to their job, then tick or clear anything for this person alone. Temporary access ends by itself. All of it can be changed later from their card.</p>
                      <AccessFields draft={draft} onChange={setDraft} docs={db.roles ?? []} by={{ id: me?.id ?? "", name: me?.name ?? "Admin" }} />
                    </>}
              </div>
            )}
            {!(needsLogin && rolesLive && access === "admin") && <CompanyTicks value={coIds} onChange={setCoIds} />}
            {!(needsLogin && rolesLive && access === "admin") && (
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={f.department} onValueChange={v => setF({ ...f, department: v })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            {/* Opening salary already paid before the app (optional, migration) */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-amber-700">Opening — already paid before this app (optional)</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <Label className="text-[11px]">Currency</Label>
                  <Select value={openingCurrency} onValueChange={v => setOpeningCurrency(v as "INR" | "USD")}>
                    <SelectTrigger className="rounded-lg mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="INR">₹ INR</SelectItem><SelectItem value="USD">$ USD</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">Amount</Label>
                  <Input type="number" min={0} step="0.01" value={openingPaid} onChange={e => setOpeningPaid(e.target.value)} placeholder="0.00" className="rounded-lg mt-1 h-9" />
                </div>
              </div>
              <div>
                <Label className="text-[11px]">As of date</Label>
                <Input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="rounded-lg mt-1 h-9" />
              </div>
              <p className="text-[11px] text-muted-foreground">Salary/wages already paid to this person before you started using this app. Added to their total paid to date.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl px-6">{saving ? "Creating…" : "Create employee"}</Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}
