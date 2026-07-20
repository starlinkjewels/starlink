import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { loadDb, fmtMoney, fmtDate, totalAdvance, balanceDue } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { TasksPanel } from "@/components/TasksPanel";
import {
  ArrowLeft, Mail, Phone, Building2, Users, Package,
  CheckCircle2, Clock, ListTodo, ExternalLink, History,
} from "lucide-react";
import { motion } from "framer-motion";

export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const db = loadDb();
  const [tasksOpen, setTasksOpen] = useState(false);

  const employee = db.users.find(u => u.id === id && u.role === "employee");
  if (!employee) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Employee not found.{" "}
        <Link to="/employees" className="text-primary underline">Back to Employees</Link>
      </div>
    );
  }

  const clients = db.clients.filter(c => c.accountManagerId === employee.id);
  const clientIds = new Set(clients.map(c => c.id));
  const orders = db.orders
    .filter(o => clientIds.has(o.clientId))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const activeOrders = orders.filter(o => !["Delivered", "Rejected"].includes(o.status)).length;
  const deliveredOrders = orders.filter(o => o.status === "Delivered").length;
  const totalValue = orders.reduce((s, o) => s + o.amount, 0);

  const tasks = (db.tasks ?? []).filter(t => t.assignedTo === employee.id);
  const pendingTasks = tasks.filter(t => !t.completed).length;
  const doneTasks = tasks.filter(t => t.completed).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate("/employees")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Employees
      </button>

      {/* Employee Profile Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white font-semibold grid place-items-center shrink-0 text-xl">
              {employee.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-2xl md:text-3xl text-brand-dark">{employee.name}</h1>
                <StatusBadge status={employee.status} />
              </div>
              <p className="text-muted-foreground mt-1">{employee.department || "—"}</p>
            </div>
          </div>
          <Button onClick={() => setTasksOpen(true)} className="btn-hero rounded-xl gap-2">
            <ListTodo className="h-4 w-4" /> Assign / View Tasks
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{employee.email || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{employee.phone || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Joined</p><p className="font-medium">{fmtDate(employee.createdAt)}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Username</p><p className="font-medium font-mono text-xs">{employee.username}</p></div>
          </div>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Assigned Clients", value: clients.length, icon: Users, color: "text-primary", bg: "from-primary/10 to-brand-light/10" },
          { label: "Active Orders", value: activeOrders, icon: Clock, color: "text-warning-foreground", bg: "from-warning/10 to-orange-400/10" },
          { label: "Tasks Pending", value: pendingTasks, icon: ListTodo, color: "text-destructive", bg: "from-destructive/10 to-red-400/10" },
          { label: "Tasks Done", value: doneTasks, icon: CheckCircle2, color: "text-success", bg: "from-success/10 to-emerald-400/10" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`card-luxe p-4 bg-gradient-to-br ${s.bg}`}>
            <div className={`h-9 w-9 rounded-xl bg-white/80 grid place-items-center mb-3 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-display font-bold text-brand-dark">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Task progress bar */}
      {tasks.length > 0 && (
        <div className="card-luxe p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Task Completion</p>
            <p className="text-xs text-muted-foreground">{doneTasks} of {tasks.length} done</p>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-success to-emerald-400"
              style={{ width: `${tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Assigned Clients */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Assigned Clients</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{clients.length} client{clients.length !== 1 ? "s" : ""} · {orders.length} total orders · {fmtMoney(totalValue)}</p>
        </div>
        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
            <Users className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">No clients assigned to this employee yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {clients.map(c => {
              const cOrders = db.orders.filter(o => o.clientId === c.id);
              const cActive = cOrders.filter(o => !["Delivered", "Rejected"].includes(o.status)).length;
              return (
                <div key={c.id} className="flex items-center justify-between gap-3 p-4 hover:bg-secondary/20 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{c.companyName}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.ownerName} · {cOrders.length} orders{cActive > 0 ? ` · ${cActive} active` : ""}</p>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="rounded-xl gap-1.5 shrink-0">
                    <Link to={`/clients/${c.id}`}>
                      <History className="h-3.5 w-3.5" /> History
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent orders across all assigned clients */}
      {orders.length > 0 && (
        <div className="card-luxe overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl text-brand-dark">Order Activity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{deliveredOrders} delivered · {activeOrders} active</p>
            </div>
          </div>
          <div className="divide-y divide-border/40">
            {orders.slice(0, 12).map(o => {
              const client = db.clients.find(c => c.id === o.clientId);
              const adv = totalAdvance(o);
              const bal = balanceDue(o);
              return (
                <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-secondary/20 transition-colors group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0">
                      <Package className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-brand-dark">{o.orderNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">{client?.companyName} · {o.jewelleryType} · {fmtDate(o.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-semibold ${bal === 0 && adv > 0 ? "text-success" : ""}`}>{fmtMoney(o.amount)}</span>
                    <StatusBadge status={o.status} />
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <TasksPanel userId={employee.id} open={tasksOpen} onClose={() => setTasksOpen(false)} asAdmin />
    </div>
  );
}
