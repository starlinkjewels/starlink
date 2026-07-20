import { useState } from "react";
import { Link } from "react-router-dom";
import { loadDb, updateDb, uid, type User } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { TasksPanel } from "@/components/TasksPanel";
import { Plus, Trash2, Search, ListTodo, Eye, Users } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

const DEPTS = ["Sales","CAD","Design","Production","Diamond Setting","Polishing","QC","Packing","Dispatch","Accounts"];
const PAGE_SIZE = 9;

export function EmployeesPage() {
  const db = loadDb();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", username: "", password: "", email: "", phone: "", department: "Sales" });

  // Tasks panel state
  const [tasksPanelUser, setTasksPanelUser] = useState<string | null>(null);

  const emps = db.users
    .filter(u => u.role === "employee")
    .filter(u =>
      u.name.toLowerCase().includes(q.toLowerCase()) ||
      u.username.toLowerCase().includes(q.toLowerCase())
    );

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(emps, PAGE_SIZE);

  const create = () => {
    if (!f.name || !f.username || !f.password) { toast.error("Fill required fields"); return; }
    updateDb(d => d.users.push({ id: uid("u_"), role: "employee", status: "active", createdAt: new Date().toISOString(), ...f } as User));
    toast.success("Employee created");
    setOpen(false);
    setF({ name: "", username: "", password: "", email: "", phone: "", department: "Sales" });
  };

  const toggle = (u: User) => {
    updateDb(d => { const x = d.users.find(x => x.id === u.id)!; x.status = x.status === "active" ? "inactive" : "active"; });
    toast.success("Updated");
  };

  const del = (id: string) => {
    if (!confirm("Delete employee?")) return;
    updateDb(d => { d.users = d.users.filter(u => u.id !== id); });
    toast.success("Deleted");
  };

  /** Count pending tasks for an employee */
  const pendingCount = (userId: string) =>
    (db.tasks ?? []).filter(t => t.assignedTo === userId && !t.completed).length;

  /** Count clients assigned to an employee */
  const clientCount = (userId: string) =>
    db.clients.filter(c => c.accountManagerId === userId).length;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Employees</h1>
          <p className="text-sm text-muted-foreground">{total} team member{total !== 1 ? "s" : ""}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Create Employee</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {(["name","username","password","email","phone"] as const).map(k => (
                <div key={k}>
                  <Label className="text-xs capitalize">{k}</Label>
                  <Input
                    type={k === "password" ? "password" : "text"}
                    value={(f as Record<string,string>)[k]}
                    onChange={e => setF({ ...f, [k]: e.target.value })}
                    className="rounded-xl mt-1"
                  />
                </div>
              ))}
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={f.department} onValueChange={v => setF({ ...f, department: v })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={create} className="btn-hero rounded-xl w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employees..." className="pl-9 h-11 rounded-xl" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(u => {
          const pending = pendingCount(u.id);
          return (
            <div key={u.id} className="card-luxe p-5 flex items-start gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white font-semibold grid place-items-center shrink-0 text-lg">
                {u.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <StatusBadge status={u.status} />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <p className="text-xs inline-block px-2 py-0.5 rounded-full bg-secondary">{u.department}</p>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" /> {clientCount(u.id)} client{clientCount(u.id) !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex gap-2 mt-3">
                  <Button asChild size="sm" className="btn-hero rounded-lg flex-1 gap-1.5">
                    <Link to={`/employees/${u.id}`}>
                      <Eye className="h-3.5 w-3.5" /> View
                    </Link>
                  </Button>

                  {/* Tasks button */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTasksPanelUser(u.id)}
                    className="rounded-lg flex-1 gap-1.5 relative"
                  >
                    <ListTodo className="h-3.5 w-3.5 text-primary" />
                    Tasks
                    {pending > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center h-4.5 h-[18px] min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                        {pending}
                      </span>
                    )}
                  </Button>
                </div>

                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => toggle(u)} className="rounded-lg flex-1">
                    {u.status === "active" ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => del(u.id)} className="rounded-lg text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        {total === 0 && (
          <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No employees found.</div>
        )}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={total > 0 ? `Showing ${start + 1}–${end} of ${total} employees` : undefined}
      />

      {/* Tasks panel (admin assigning tasks to an employee) */}
      <TasksPanel
        userId={tasksPanelUser ?? ""}
        open={!!tasksPanelUser}
        onClose={() => setTasksPanelUser(null)}
        asAdmin
      />
    </div>
  );
}
