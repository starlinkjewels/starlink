import { useState } from "react";
import { Users, UserRound, Eye } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs, assignOrders, type DB, type Order, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { reachOf } from "@/lib/permissions";
import { salesStaff } from "@/lib/clientHandlers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Who an order belongs to, and handing it to someone else — at any time, by
 * the admin. An order used to be given to someone once, when it was placed,
 * and could never move again.
 */

const NOBODY = "__none";

/** The people an order can be given to: the active sales staff, then the admins — and whoever has it now. */
export function assignableStaff(db: DB, current?: string): User[] {
  const byName = (a: User, b: User) => a.name.localeCompare(b.name);
  const active = db.users.filter(u => u.status !== "inactive" || u.id === current);
  const sales = new Set(salesStaff(db.users).map(u => u.id));
  return [
    ...active.filter(u => u.role === "employee" && (sales.has(u.id) || u.id === current)).sort(byName),
    ...active.filter(u => u.role === "admin").sort(byName),
  ];
}

/** A person as the pickers show them: initials, name, and what they do. */
function PersonLine({ u, size = "md" }: { u?: User; size?: "sm" | "md" }) {
  const box = size === "md" ? "h-8 w-8 text-[11px]" : "h-7 w-7 text-[10px]";
  if (!u) {
    return (
      <span className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden="true" className={`${box} shrink-0 rounded-full border border-dashed border-muted-foreground/40 grid place-items-center text-muted-foreground`}><UserRound className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex flex-col text-left leading-tight">
          <span className="text-sm font-medium text-muted-foreground group-data-[highlighted]:text-inherit">Nobody</span>
          <span className="text-[11px] text-muted-foreground/80 group-data-[highlighted]:text-inherit group-data-[highlighted]:opacity-85">Not assigned</span>
        </span>
      </span>
    );
  }
  const initials = u.name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const sub = u.role === "admin" ? "Admin" : [u.department, !u.authUid ? "no login" : ""].filter(Boolean).join(" · ") || "Employee";
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <span aria-hidden="true" className={`${box} shrink-0 rounded-full font-semibold grid place-items-center ${u.role === "admin" ? "bg-amber-500/15 text-amber-700" : "bg-primary/10 text-primary"}`}>{initials || "?"}</span>
      <span className="min-w-0 flex flex-col text-left leading-tight">
        <span className="text-sm font-semibold text-brand-dark truncate group-data-[highlighted]:text-inherit">{u.name}</span>
        <span className="text-[11px] text-muted-foreground truncate group-data-[highlighted]:text-inherit group-data-[highlighted]:opacity-85">{sub}</span>
      </span>
    </span>
  );
}

function StaffOptions({ db, current }: { db: DB; current?: string }) {
  return (
    <>
      <SelectItem value={NOBODY} className="group py-1.5"><PersonLine size="sm" /></SelectItem>
      {assignableStaff(db, current).map(u => (
        <SelectItem key={u.id} value={u.id} className="group py-1.5"><PersonLine u={u} size="sm" /></SelectItem>
      ))}
    </>
  );
}

/** The picker's closed face: the chosen person in full. A div, not a span, so
 *  the trigger's one-line clamp (which stacked the icon over the name) leaves it alone. */
function PersonTrigger({ label, u, placeholder, wide }: { label: string; u?: User | null; placeholder?: string; wide?: boolean }) {
  return (
    <SelectTrigger className={`h-auto min-h-12 py-2 rounded-xl w-full ${wide ? "" : "max-w-sm"} bg-card shadow-sm hover:border-primary/40 transition-colors`} aria-label={label}>
      <div className="flex-1 min-w-0">
        <SelectValue placeholder={placeholder}>{u === null && placeholder ? undefined : <PersonLine u={u ?? undefined} />}</SelectValue>
      </div>
    </SelectTrigger>
  );
}

/** Besides the person it is assigned to, who else has this order in their list. */
function alsoSees(db: DB, o: Order): string | null {
  const manager = db.users.find(u => u.id === db.clients.find(c => c.id === o.clientId)?.accountManagerId);
  const parts: string[] = [];
  if (manager && manager.id !== o.assignedEmployeeId) parts.push(`${manager.name} (manages this client)`);
  const wide = db.users.filter(u => u.role === "employee" && u.status !== "inactive" && u.id !== o.assignedEmployeeId && u.id !== manager?.id
    && reachOf(u, db.roles ?? []) === "all");
  if (wide.length) parts.push(`${wide.length} employee${wide.length !== 1 ? "s" : ""} who may see every order`);
  return parts.length ? parts.join(" · ") : null;
}

/** The order screen's "Assigned to": a choice for the admin, a name for anyone else. */
export function AssignOrderField({ order }: { order: Order }) {
  const db = useDb();
  const { user } = useAuth();
  const current = db.users.find(u => u.id === order.assignedEmployeeId);
  if (user?.role !== "admin") {
    return <div className="min-w-0"><p className="text-xs text-muted-foreground mb-1.5">Assigned to</p><PersonLine u={current} /></div>;
  }
  const change = (v: string) => {
    const to = v === NOBODY ? null : v;
    const name = to ? db.users.find(u => u.id === to)?.name ?? "them" : "nobody";
    let moved = 0;
    updateDbAs({ summary: `Assigned ${order.orderNumber} to ${name}` }, d => {
      moved = assignOrders(d, [order.id], to, { id: user.id, name: user.name }, new Date().toISOString());
    });
    if (moved) toast.success(to ? `${order.orderNumber} is now assigned to ${name}${to !== user.id ? " — they have been told" : ""}` : `${order.orderNumber} is no longer assigned to anyone`);
  };
  const also = alsoSees(db, order);
  return (
    <div className="min-w-0 col-span-2">
      <p className="text-xs text-muted-foreground mb-1.5">Assigned to</p>
      <Select value={order.assignedEmployeeId && current ? order.assignedEmployeeId : NOBODY} onValueChange={change}>
        <PersonTrigger label="Assigned to" u={current} />
        <SelectContent className="max-h-80"><StaffOptions db={db} current={order.assignedEmployeeId} /></SelectContent>
      </Select>
      {also && (
        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-start gap-1.5 max-w-sm">
          <Eye className="h-3.5 w-3.5 shrink-0 mt-px" /><span>Also visible to {also}</span>
        </p>
      )}
    </div>
  );
}

/** New Order: who the order will belong to — the person placing it, unless changed. */
export function AssignPicker({ value, onChange, wide }: { value: string; onChange: (v: string) => void; wide?: boolean }) {
  const db = useDb();
  const current = db.users.find(u => u.id === value);
  return (
    <Select value={value && current ? value : NOBODY} onValueChange={v => onChange(v === NOBODY ? "" : v)}>
      <PersonTrigger label="Assigned to" u={current} wide={wide} />
      <SelectContent className="max-h-80"><StaffOptions db={db} current={value} /></SelectContent>
    </Select>
  );
}

/** Orders page: give every ticked order to one person. */
export function AssignOrdersDialog({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const [to, setTo] = useState<string>("");
  // Who holds them now, so the move is seen before it is made.
  const now = new Map<string, number>();
  for (const o of orders) {
    const name = db.users.find(u => u.id === o.assignedEmployeeId)?.name ?? "Nobody";
    now.set(name, (now.get(name) ?? 0) + 1);
  }
  const target = to === NOBODY ? null : to;
  const already = orders.filter(o => (o.assignedEmployeeId ?? null) === target).length;
  const name = target ? db.users.find(u => u.id === target)?.name ?? "them" : "nobody";

  const apply = () => {
    if (!to || !user) return;
    let moved = 0;
    updateDbAs({ summary: `Assigned ${orders.length} order${orders.length !== 1 ? "s" : ""} to ${name}` }, d => {
      moved = assignOrders(d, orders.map(o => o.id), target, { id: user.id, name: user.name }, new Date().toISOString());
    });
    toast.success(moved ? `${moved} order${moved !== 1 ? "s" : ""} now assigned to ${name}` : "Nothing to change — they were already assigned there");
    onClose();
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Assign {orders.length} order{orders.length !== 1 ? "s" : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl bg-secondary/60 p-3 text-xs">
            <p className="font-semibold text-brand-dark mb-1">Assigned now</p>
            <p className="text-muted-foreground">{[...now].map(([n, c]) => `${n} · ${c}`).join("  ·  ")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Give them to</p>
            <Select value={to} onValueChange={setTo}>
              <PersonTrigger label="Give them to" u={to ? (target ? db.users.find(u => u.id === target) : undefined) : null} placeholder="Choose a person" />
              <SelectContent className="max-h-80"><StaffOptions db={db} /></SelectContent>
            </Select>
          </div>
          {to && (
            <p className="text-xs text-muted-foreground">
              {orders.length - already} will move to <span className="font-semibold text-brand-dark">{name}</span>
              {already ? `; ${already} already ${already === 1 ? "is" : "are"} there` : ""}.
              {target && target !== user?.id ? " They get a notification." : ""}
              {" "}Whoever manages each client keeps seeing that client's orders.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={apply} disabled={!to || orders.length === already} className="btn-hero rounded-xl">Assign</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
