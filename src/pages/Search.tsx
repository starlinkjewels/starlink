import { useState } from "react";
import { loadDb } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { Package, Users, Briefcase, FileText } from "lucide-react";

export function SearchPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const db = loadDb();
  const ql = q.toLowerCase();
  const orders = q ? db.orders.filter(o =>
    o.orderNumber.toLowerCase().includes(ql) ||
    o.jewelleryType.toLowerCase().includes(ql) ||
    (o.designNumber || "").toLowerCase().includes(ql)
  ).slice(0, 8) : [];
  // Employees only search their own assigned clients; clients don't search the client list at all.
  const scopedClients = user!.role === "employee"
    ? db.clients.filter(c => c.accountManagerId === user!.id)
    : user!.role === "admin"
    ? db.clients
    : [];
  const clients = q ? scopedClients.filter(c => c.companyName.toLowerCase().includes(ql) || c.ownerName.toLowerCase().includes(ql)).slice(0, 8) : [];
  const employees = q ? db.users.filter(u => u.role === "employee" && (u.name.toLowerCase().includes(ql) || (u.department || "").toLowerCase().includes(ql))).slice(0, 8) : [];
  const invoices = q ? db.invoices.filter(i => i.number.toLowerCase().includes(ql)).slice(0, 8) : [];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Search</h1>
      <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search orders, clients, employees, invoices..." className="rounded-xl h-12" />
      {q && <div className="space-y-4">
        <Section title="Orders" icon={Package} items={orders.map(o => ({ id: o.id, to: `/orders/${o.id}`, title: o.orderNumber, sub: `${o.jewelleryType} - ${o.status}${o.designNumber ? ` · Design #${o.designNumber}` : ""}` }))} />
        <Section title="Clients" icon={Users} items={clients.map(c => ({ id: c.id, to: `/clients`, title: c.companyName, sub: c.ownerName }))} />
        <Section title="Employees" icon={Briefcase} items={employees.map(u => ({ id: u.id, to: `/employees`, title: u.name, sub: u.department || "" }))} />
        <Section title="Invoices" icon={FileText} items={invoices.map(i => ({ id: i.id, to: `/invoices`, title: i.number, sub: `$${i.amount}` }))} />
      </div>}
    </div>
  );
}

function Section({ title, icon: Icon, items }: { title: string; icon: any; items: { id: string; to: string; title: string; sub: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="card-luxe p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{title}</p>
      <div className="space-y-1">
        {items.map(i => <Link key={i.id} to={i.to} className="block p-2 rounded-lg hover:bg-secondary"><p className="text-sm font-medium">{i.title}</p><p className="text-xs text-muted-foreground">{i.sub}</p></Link>)}
      </div>
    </div>
  );
}
