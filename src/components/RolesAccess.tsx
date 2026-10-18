import { useState } from "react";
import { updateDb, uid, rolesStoreReady, currentUserOrders, currentUserClients, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { isAdminEmail } from "@/lib/firebase";
import {
  ACTION_LABEL, MODULE_ACTIONS, PERM_ACTIONS, ROLE_MODULES, ROLE_TEMPLATES, STANDARD_STAFF, REACH_LABEL,
  normalisePerms, rolesOnly, accessOf, tempState, countCells, type PermAction, type PermMatrix, type StaffRole, type RoleReach,
} from "@/lib/permissions";
import { AccessSummary, ManageAccessDialog, permWords } from "@/components/AccessManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, Plus, Pencil, Trash2, Lock, Crown, Globe2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

/**
 * Roles and admins — who may see and do what. ADMIN ONLY: rendered on the
 * Employees page, which only an admin can open.
 *
 * Nothing changes for anybody until an admin decides it should: an employee
 * without a role keeps Standard staff, which is what every employee could do
 * before roles existed.
 */

export function RolesPanel() {
  // Access is set per person now, on each employee's card. What stays here is
  // the one thing worth seeing across everyone: temporary access, running now
  // or about to start — exceptions are meant to be seen, not forgotten.
  const db = useDb();
  const [managing, setManaging] = useState<User | null>(null);
  const now = Date.now();
  const people = db.users.filter(u => u.role === "employee" && u.authUid).flatMap(u => {
    const live = (accessOf(db.roles ?? [], u.id)?.temp ?? []).filter(t => tempState(t, now) !== "ended");
    return live.length ? [{ u, live }] : [];
  });
  if (!people.length) return null;
  return (
    <div className="card-luxe p-4 sm:p-5 space-y-2">
      <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-amber-600" /> Temporary access running</p>
      <div className="divide-y divide-border/50 rounded-xl border border-border/60">
        {people.map(({ u, live }) => (
          <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-brand-dark truncate">{u.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {live.map(t => `${permWords(t.perms, t.reach)} ${tempState(t, now) === "upcoming" ? `from ${new Date(t.from!).toLocaleDateString("en-IN", { day: "numeric", month: "short" }).replace(/\bSept\b/, "Sep")}` : `until ${new Date(t.until).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}`}`).join(" · ")}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setManaging(u)} className="rounded-lg h-8 shrink-0">Manage</Button>
          </div>
        ))}
      </div>
      {managing && <ManageAccessDialog u={managing} onClose={() => setManaging(null)} />}
    </div>
  );
}

/**
 * Make someone an admin, or an employee again — asked first. Shared by the
 * controls below and the Employees page's ⋯ menus, so both ask and write the
 * same. Never offered for an owner.
 */
export async function setAdminRole(u: User, on: boolean): Promise<void> {
  if (!(await confirmBox(on
    ? `Make ${u.name} an admin?\n\nThey will be able to do everything — including managing employees, roles, settings and other admins. Owners stay owners.`
    : `Remove ${u.name} as an admin?\n\nThey become an employee with Standard staff access, which you can then narrow with a role.`))) return;
  updateDb(d => {
    const x = d.users.find(y => y.id === u.id);
    if (!x) return;
    x.role = on ? "admin" : "employee";
    if (on) delete x.roleId;
  });
  toast.success(on ? `${u.name} is now an admin` : `${u.name} is no longer an admin`);
}

/**
 * On an employee's card: which role they hold, and whether they are an admin.
 * An owner (one of the founding admin emails) has neither control — nothing in
 * the app can demote them, so the business can never be locked out.
 */
export function EmployeeAccessControls({ u }: { u: User }) {
  const db = useDb();
  const live = rolesStoreReady();
  const owner = isAdminEmail(u.email);
  const [managing, setManaging] = useState(false);

  if (owner) {
    return (
      <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-3">
        <Crown className="h-3 w-3" /> Owner — permanent admin, cannot be changed
      </p>
    );
  }

  const setAdmin = (on: boolean) => setAdminRole(u, on);

  if (u.role === "admin") {
    return (
      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="text-[11px] text-amber-700 font-medium flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Admin — can do everything</span>
        {live && <button onClick={() => setAdmin(false)} className="text-[11px] text-destructive hover:underline">Remove admin</button>}
      </div>
    );
  }
  // An employee without a login cannot sign in, so access would do nothing.
  if (!u.authUid) return null;
  return (
    <div className="mt-3 space-y-2">
      <AccessSummary u={u} db={db} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={!live} onClick={() => setManaging(true)} className="rounded-lg h-8 flex-1 gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Manage access
        </Button>
        {live && <button onClick={() => setAdmin(true)} className="text-[11px] text-primary hover:underline whitespace-nowrap">Make admin</button>}
      </div>
      {managing && <ManageAccessDialog u={u} onClose={() => setManaging(false)} />}
    </div>
  );
}
