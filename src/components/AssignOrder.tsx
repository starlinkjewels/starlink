import { useState } from "react";
import { UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs, assignOrders, type DB, type Order, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { reachOf } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Who an order belongs to, and handing it to someone else — at any time, by
 * the admin. An order used to be given to someone once, when it was placed,
 * and could never move again.
 */

const NOBODY = "__none";

/** The people an order can be given to: active employees, then the admins. */
export function assignableStaff(db: DB): User[] {
  const byName = (a: User, b: User) => a.name.localeCompare(b.name);
  const active = db.users.filter(u => u.status !== "inactive");
  return [
    ...active.filter(u => u.role === "employee").sort(byName),
    ...active.filter(u => u.role === "admin").sort(byName),
  ];
}

function StaffOptions({ db }: { db: DB }) {
  return (
    <>
      <SelectItem value={NOBODY}>Nobody</SelectItem>
      {assignableStaff(db).map(u => (
        <SelectItem key={u.id} value={u.id}>
          {u.name}{u.role === "admin" ? " (admin)" : u.department ? ` · ${u.department}` : ""}{u.role === "employee" && !u.authUid ? " — no login" : ""}
        </SelectItem>
      ))}
    </>
  );
}

/** Besides the person it is assigned to, who else has this order in their list. */
function alsoSees(db: DB, o: Order): string | null {
  const manager = db.users.find(u => u.id === db.clients.find(c => c.id === o.clientId)?.accountManagerId);
  const parts: string[] = [];
  if (manager && manager.id !== o.assignedEmployeeId) parts.push(`${manager.name} (manages this client)`);
  const wide = db.users.filter(u => u.role === "employee" && u.status !== "inactive" && u.id !== o.assignedEmployeeId && u.id !== manager?.id
    && reachOf(u, db.roles ?? []) === "all");
  if (wide.length) parts.push(`${wide.length} employee${wide.length !== 1 ? "s" : ""} whose role sees every order`);
  return parts.length ? `Also sees it: ${parts.join(" · ")}` : null;
}

/** The order screen's "Assigned to": a choice for the admin, a name for anyone else. */
export function AssignOrderField({ order }: { order: Order }) {
  const db = useDb();
  const { user } = useAuth();
  const current = db.users.find(u => u.id === order.assignedEmployeeId);
  if (user?.role !== "admin") {
    return <div><p className="text-xs text-muted-foreground">Assigned to</p><p className="font-medium mt-0.5">{current?.name || "—"}</p></div>;
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
      <p className="text-xs text-muted-foreground">Assigned to</p>
      <Select value={order.assignedEmployeeId && current ? order.assignedEmployeeId : NOBODY} onValueChange={change}>
        <SelectTrigger className="mt-1 h-9 rounded-lg text-sm w-full max-w-xs" aria-label="Assigned to">
          <UserCog className="h-3.5 w-3.5 mr-1.5 text-primary shrink-0" /><SelectValue />
        </SelectTrigger>
        <SelectContent><StaffOptions db={db} /></SelectContent>
      </Select>
      {also && <p className="text-[11px] text-muted-foreground mt-1">{also}</p>}
    </div>
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
      <DialogContent className="max-w-md rounded-2xl">
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
              <SelectTrigger className="h-10 rounded-xl" aria-label="Give them to"><SelectValue placeholder="Choose a person" /></SelectTrigger>
              <SelectContent><StaffOptions db={db} /></SelectContent>
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
