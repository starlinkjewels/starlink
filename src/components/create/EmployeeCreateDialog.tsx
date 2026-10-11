import { useState } from "react";
import { toast } from "sonner";
import { loadDb, updateDb, flush, uid, rolesStoreReady, type User } from "@/lib/db";
import { STANDARD_STAFF } from "@/lib/permissions";
import { useDb } from "@/hooks/useDb";
import { createAuthUser, isAdminEmail } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { CompanyTicks } from "@/components/EmployeeCompanies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DEPTS = ["Sales","CAD","Design","Production","Diamond Setting","Polishing","QC","Packing","Dispatch","Accounts"];

/**
 * The one Create Employee form — the Employees page's, also opened from
 * "+ Add new employee" wherever an employee is picked. Admin only.
 */
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
  const [access, setAccess] = useState<string>(STANDARD_STAFF.id);
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
    const email = f.email.trim().toLowerCase();
    if (needsLogin) {
      if (!email || !f.password) { toast.error("Enter an email and password, or turn off the login"); return; }
      // An owner's login is a permanent admin already — it exists, and adding it
      // again would only make a second record for the same person.
      if (isAdminEmail(email)) { toast.error("That is an owner's login — it is already a permanent admin and needs no record here. Use the partner's own email."); return; }
      if (loadDb().users.some(u => u.email.toLowerCase() === email)) { toast.error("That email is already in use"); return; }
    } else if (email && loadDb().users.some(u => u.email.toLowerCase() === email)) {
      toast.error("That email is already in use"); return;
    }

    setSaving(true);
    try {
      // Only create a sign-in account when they actually need one. A
      // salary-only record has no Auth user, no email and no password — it exists
      // to be paid and to appear in the salary ledger, nothing more.
      const asAdmin = needsLogin && rolesLive && access === "admin";
      const roleId = needsLogin && rolesLive && access !== "admin" && access !== STANDARD_STAFF.id
        && (loadDb().roles ?? []).some(r => r.id === access) ? access : undefined;
      if (asAdmin && !confirm(`Create ${f.name.trim()} as an admin?\n\nThey will be able to do everything — money, settings, employees, roles and other admins. Owners stay owners.`)) return;
      const authUid = needsLogin ? await createAuthUser(email, f.password) : undefined;
      const opAmt = Number(openingPaid);
      updateDb(d => d.users.push({
        id: newId, role: asAdmin ? "admin" : "employee", status: "active", createdAt: new Date().toISOString(),
        ...(roleId ? { roleId } : {}),
        ...(!asAdmin && coIds.length ? { companyIds: coIds } : {}),
        authUid, username: email, email, password: "",
        // A department says where on the floor someone works; an admin partner
        // runs the whole business, so they are not given one.
        name: f.name, phone: f.phone, department: asAdmin ? undefined : f.department,
        openingPaid: opAmt > 0 ? opAmt : undefined,
        openingPaidCurrency: opAmt > 0 ? openingCurrency : undefined,
        openingPaidDate: opAmt > 0 ? (openingDate || undefined) : undefined,
      } as User));
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
      setAccess(STANDARD_STAFF.id);
      setCoIds([]);
      setOpeningPaid(""); setOpeningCurrency("INR"); setOpeningDate("");
    } catch (e) {
      toast.error(authErrorMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md rounded-2xl">
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
              <div>
                <Label className="text-xs">Access</Label>
                <Select value={access} onValueChange={setAccess} disabled={!rolesLive}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STANDARD_STAFF.id}>{STANDARD_STAFF.name}</SelectItem>
                    {(db.roles ?? []).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    <SelectItem value="admin">Admin — partner, can do everything</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {!rolesLive ? "Roles and extra admins switch on once the security update is deployed — until then everyone is Standard staff."
                    : access === "admin" ? "Full control, the same as you: money, settings, employees and roles. You can take it back later from their card."
                    : "What they may see and do. You can change it any time from their card."}
                </p>
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

            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl w-full">{saving ? "Creating…" : "Create"}</Button>
          </div>
        </DialogContent>
    </Dialog>
  );
}
