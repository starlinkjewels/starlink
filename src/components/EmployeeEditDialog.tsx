import { ListCombo } from "@/components/ListCombo";
import { useState } from "react";
import { choicesOf } from "@/lib/optionLists";
import { toast } from "sonner";
import { KeyRound, Loader2, Mail, UserRound, Wallet } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { loadDb, updateDb, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { functions, isAdminEmail } from "@/lib/firebase";
import { hasCompanies } from "@/lib/companies";
import { CompanyTicks } from "@/components/EmployeeCompanies";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The departments the Create Employee form offers (EmployeeCreateDialog). */
// Departments: Settings → Dropdown lists.

/**
 * Correcting someone's details after they were added — everything the Create
 * Employee form asks. The email IS their sign-in, and the sign-in account lives
 * in Firebase Authentication, so an employee's login (email, password) is
 * changed on the server — EmployeeLogin below; an admin's or an owner's is only
 * shown. Admin only, as the Employees pages are.
 */
export function EmployeeEditDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const db = useDb();
  const u = userId ? db.users.find(x => x.id === userId) : undefined;
  if (!u) return null;
  // Keyed, so each person opens with their own details.
  return <EmployeeSheet key={u.id} u={u} onClose={onClose} />;
}

function EmployeeSheet({ u, onClose }: { u: User; onClose: () => void }) {
  const db = useDb();
  const isEmployee = u.role === "employee";
  const multiCo = hasCompanies(db.settings);
  const [f, setF] = useState({
    name: u.name, phone: u.phone ?? "", department: u.department ?? "",
    openingPaid: u.openingPaid ? String(u.openingPaid) : "",
    openingCurrency: (u.openingPaidCurrency ?? "INR") as "INR" | "USD",
    openingDate: u.openingPaidDate?.slice(0, 10) ?? "",
  });
  const [coIds, setCoIds] = useState<string[]>(u.companyIds ?? []);
  const depts = choicesOf("departments", f.department);

  const save = () => {
    if (!f.name.trim()) { toast.error("Enter a name"); return; }
    const op = Number(f.openingPaid);
    if (f.openingPaid.trim() && !(op >= 0)) { toast.error("Enter a valid opening amount"); return; }
    updateDb(d => {
      const x = d.users.find(y => y.id === u.id);
      if (!x) return;
      x.name = f.name.trim();
      x.phone = f.phone.trim() || undefined;
      // An admin partner runs the whole business — no department, no list of
      // companies (as the create writes them).
      if (x.role === "employee") {
        x.department = f.department || undefined;
        if (multiCo) { if (coIds.length) x.companyIds = coIds; else delete x.companyIds; }
      }
      // Already paid before the app: folded into their total paid to date and
      // the first line of their salary ledger. Cleared, all three go.
      if (op > 0) {
        x.openingPaid = op;
        x.openingPaidCurrency = f.openingCurrency;
        x.openingPaidDate = f.openingDate || undefined;
      } else {
        delete x.openingPaid; delete x.openingPaidCurrency; delete x.openingPaidDate;
      }
    });
    toast.success(`${f.name.trim()} updated`);
    onClose();
  };

  const owner = isAdminEmail(u.email);
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={UserRound}
      title="Edit details"
      description={`${u.name} · ${owner ? "Owner" : u.role === "admin" ? "Admin · Partner" : u.department || "Employee"}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
          <Button onClick={save} className="btn-hero rounded-xl h-10 px-8">Save</Button>
        </div>
      }>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ee-name" className="text-xs">Name *</Label>
            <Input id="ee-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="h-10 rounded-xl mt-1" />
          </div>
          <div>
            <Label htmlFor="ee-phone" className="text-xs">Phone</Label>
            <Input id="ee-phone" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className="h-10 rounded-xl mt-1" />
          </div>
          {isEmployee && (
            <div>
              <Label className="text-xs">Department</Label>
              <ListCombo list="departments" value={f.department} onChange={v => setF({ ...f, department: v })} placeholder="No department" className="h-10 rounded-xl mt-1" ariaLabel="Department" />
            </div>
          )}
        </div>
        {isEmployee && multiCo && <CompanyTicks value={coIds} onChange={setCoIds} />}

        {/* An employee's login: the admin can change its email and password. An admin's
            (a partner's) or an owner's is shown, not changed. */}
        {isEmployee && u.authUid && !owner ? <EmployeeLogin u={u} /> : (
        <div className="rounded-xl border border-border/70 bg-secondary/30 p-3.5 flex items-start gap-3">
          <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Email (login ID)</p>
            <p className="text-sm font-medium break-all">{u.email || <span className="italic text-muted-foreground font-normal">No login — salary only</span>}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {u.authUid || u.role === "admin"
                ? "Can't be changed here — locked out? Send password reset."
                : "To let them sign in, use Give login on the Employees page."}
            </p>
          </div>
        </div>
        )}

        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Wallet className="h-4 w-4 text-amber-600" />Already paid before this app</p>
            <p className="text-xs text-muted-foreground mt-0.5">Added to their total paid to date.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={f.openingCurrency} onValueChange={v => setF({ ...f, openingCurrency: v as "INR" | "USD" })}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Opening currency"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INR">₹ INR</SelectItem><SelectItem value="USD">$ USD</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ee-opening" className="text-xs">Amount</Label>
              <Input id="ee-opening" type="number" min={0} step="0.01" value={f.openingPaid} onChange={e => setF({ ...f, openingPaid: e.target.value })} placeholder="0.00" className="h-10 rounded-xl mt-1" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="ee-opening-date" className="text-xs">As of date</Label>
              <Input id="ee-opening-date" type="date" value={f.openingDate} onChange={e => setF({ ...f, openingDate: e.target.value })} className="h-10 rounded-xl mt-1" />
            </div>
          </div>
        </section>
      </div>
    </ActionSheet>
  );
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/**
 * An employee's sign-in (admin only): a new email they sign in with, and/or a
 * new password — they are signed out everywhere and sign in with the new one.
 * Done on the server (setClientLogin, which takes an employee's or a client's
 * login, never an admin's or an owner's). The password is never kept on any record.
 */
function EmployeeLogin({ u }: { u: User }) {
  const [email, setEmail] = useState(u.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const clean = email.trim().toLowerCase();
    const newEmail = clean !== (u.email ?? "").toLowerCase() ? clean : "";
    if (!newEmail && !password) { toast.error("Change the email or type a new password"); return; }
    if (newEmail && !EMAIL_RE.test(newEmail)) { toast.error("That email address doesn't look right"); return; }
    if (newEmail && isAdminEmail(newEmail)) { toast.error("That email belongs to an owner"); return; }
    if (newEmail && loadDb().users.some(x => (x.email ?? "").toLowerCase() === newEmail && x.id !== u.id)) { toast.error("That email is already used by another login"); return; }
    if (password && password.length < 6) { toast.error("The password needs at least 6 characters"); return; }
    setBusy(true);
    try {
      await httpsCallable(functions, "setClientLogin")({ authUid: u.authUid, ...(newEmail ? { email: newEmail } : {}), ...(password ? { password } : {}) });
      if (newEmail) updateDb(d => { const x = d.users.find(y => y.id === u.id); if (x) { x.email = newEmail; x.username = newEmail; } });
      setPassword("");
      toast.success([newEmail && `${u.name} now signs in with ${newEmail}`, password && "new password set — they are signed out everywhere"].filter(Boolean).join(" · "));
    } catch (e) {
      toast.error((e as { message?: string }).message || "The login couldn't be changed");
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-border/70 p-3.5 space-y-3">
      <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><KeyRound className="h-4 w-4 text-muted-foreground" />Login <span className="text-xs font-normal text-muted-foreground">· signs in as {u.email}</span></p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ee-login-email" className="text-xs">Email (login ID)</Label>
          <Input id="ee-login-email" name="employee-login-email" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} className="h-10 rounded-xl mt-1" />
        </div>
        <div>
          <Label htmlFor="ee-login-pass" className="text-xs">New password · optional</Label>
          <Input id="ee-login-pass" name="employee-new-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave empty to keep it" className="h-10 rounded-xl mt-1" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">A new password signs them out on every device.</p>
        <Button type="button" variant="outline" className="rounded-xl h-10 gap-2 shrink-0" disabled={busy} onClick={save}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save login
        </Button>
      </div>
    </div>
  );
}
