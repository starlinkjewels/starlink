import { useNavigate, Link } from "react-router-dom";
import { currentUserClients, currentUserOrders, worksOnInvoice, fmtMoney } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { useUrlState } from "@/hooks/useUrlState";
import { lotLabel } from "@/lib/diamondLots";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { Package, Users, Briefcase, FileText, Truck, Factory, PenTool, Gem, ArrowRight, SearchX } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Hit = { id: string; to: string; title: string; sub: string; extra?: { to: string; label: string } };

/**
 * Search everything one has to hand: an order (its number, design, client,
 * tracking or factory bill no.), a client (name, phone, email, GST), a supplier,
 * a factory, a designer, a Ready Stock piece, a bag (BAG-0007), a person, an
 * invoice — each result opens the record itself. Enter opens the first one;
 * the words stay in the address, so Back returns to them.
 */
export function SearchPage() {
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const [q, setQ] = useUrlState("q");
  const db = useDb();
  const ql = q.trim().toLowerCase();
  const digits = ql.replace(/\D/g, "");
  const staff = user!.role === "admin" || user!.role === "employee";
  const has = (...vals: (string | undefined | null)[]) => vals.some(v => (v ?? "").toLowerCase().includes(ql));
  const phoneHas = (p?: string) => digits.length >= 4 && (p ?? "").replace(/\D/g, "").includes(digits);

  // Only what is within this person's work — the same records their own pages list.
  const clientName = new Map(db.clients.map(c => [c.id, c.companyName]));
  const orders = ql ? currentUserOrders(db, user!).filter(o =>
    has(o.orderNumber, o.jewelleryType, o.designNumber, o.contactPerson, o.trackingNumber, o.factoryBillNo, o.previousOrderNumber, clientName.get(o.clientId))
    // A credit note number finds the order its pieces came back from.
    || (o.returns ?? []).some(r => r.creditNoteNo.toLowerCase().includes(ql))
  ).slice(0, 8) : [];
  const scopedClients = user!.role === "employee" ? currentUserClients(db, user!) : user!.role === "admin" ? db.clients : [];
  const clients = ql ? scopedClients.filter(c => has(c.companyName, c.ownerName, c.email, c.gstVat, c.username) || phoneHas(c.phone)).slice(0, 8) : [];
  const ordersOf = (id: string) => currentUserOrders(db, user!).filter(o => o.clientId === id).length;
  const suppliers = ql && staff && can("suppliers") ? db.suppliers.filter(s => has(s.name, s.contactPerson, s.email, s.gstin) || phoneHas(s.phone)).slice(0, 6) : [];
  const factories = ql && staff && can("factories") ? db.factories.filter(f => has(f.name, f.contactPerson, f.email) || phoneHas(f.phone)).slice(0, 6) : [];
  const designers = ql && staff && can("designers") ? (db.designers ?? []).filter(x => has(x.name, x.email) || phoneHas(x.phone)).slice(0, 6) : [];
  const pieces = ql && can("readyStock") ? (db.readyStock ?? []).filter(i => has(i.name, i.sku, i.jewelleryType)).slice(0, 6) : [];
  const bags = ql && staff && can("stock") ? (db.diamondBags ?? []).filter(b => has(b.no, b.key)).slice(0, 6) : [];
  const employees = ql && user!.role === "admin" ? db.users.filter(u => (u.role === "employee" || u.role === "admin") && (has(u.name, u.department, u.email) || phoneHas(u.phone))).slice(0, 6) : [];
  const invoices = ql ? db.invoices.filter(i => worksOnInvoice(db, user!, i) && (
    has(i.number)
    // Also the number it carried before a renumber, so old paperwork finds it.
    || has(i.previousNumber))).slice(0, 8) : [];

  const groups: { title: string; icon: LucideIcon; items: Hit[] }[] = [
    { title: "Orders", icon: Package, items: orders.map(o => ({ id: o.id, to: `/orders/${o.id}`, title: o.orderNumber,
      sub: [clientName.get(o.clientId), o.jewelleryType, o.status, o.designNumber && `Design #${o.designNumber}`,
        o.returns?.length && `returned on ${[...new Set(o.returns.map(r => r.creditNoteNo))].join(", ")}`].filter(Boolean).join(" · ") })) },
    { title: "Clients", icon: Users, items: clients.map(c => {
      const n = ordersOf(c.id);
      return { id: c.id, to: `/clients/${c.id}`, title: c.companyName, sub: [c.ownerName, c.phone].filter(Boolean).join(" · "),
        extra: n ? { to: `/orders?q=${encodeURIComponent(c.companyName)}`, label: `${n} order${n === 1 ? "" : "s"}` } : undefined };
    }) },
    { title: "Suppliers", icon: Truck, items: suppliers.map(s => ({ id: s.id, to: `/suppliers/${s.id}`, title: s.name, sub: [s.contactPerson, s.phone].filter(Boolean).join(" · ") })) },
    { title: "Factories", icon: Factory, items: factories.map(f => ({ id: f.id, to: `/factories/${f.id}`, title: f.name, sub: [f.contactPerson, f.phone].filter(Boolean).join(" · ") })) },
    { title: "Designers", icon: PenTool, items: designers.map(x => ({ id: x.id, to: `/designers/${x.id}`, title: x.name, sub: x.kind === "inhouse" ? "In-house" : "Freelancer" })) },
    { title: "Ready Stock", icon: Gem, items: pieces.map(i => ({ id: i.id, to: `/ready-stock/${i.id}`, title: i.name, sub: [i.sku, `${i.quantity} in stock`].filter(Boolean).join(" · ") })) },
    { title: "Diamond bags", icon: Gem, items: bags.map(b => ({ id: b.id, to: `/stock/diamond?q=${encodeURIComponent(b.no)}&open=bag`, title: b.no, sub: lotLabel(b.key) })) },
    { title: "Team", icon: Briefcase, items: employees.map(u => ({ id: u.id, to: `/employees/${u.id}`, title: u.name, sub: u.department || (u.role === "admin" ? "Admin" : "") })) },
    { title: "Invoices", icon: FileText, items: invoices.map(i => ({ id: i.id, to: `/invoices?q=${encodeURIComponent(i.number)}`, title: i.number, sub: `${clientName.get(i.clientId) ?? ""} · ${fmtMoney(i.amount)}` })) },
  ].filter(g => g.items.length);
  const first = groups[0]?.items[0];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader title="Search" />
      <Input autoFocus value={q} onChange={e => setQ(e.target.value)} aria-label="Search everything"
        onKeyDown={e => { if (e.key === "Enter" && first) navigate(first.to); if (e.key === "Escape") setQ(""); }}
        placeholder="Order, design, client, phone, supplier, factory, bag, invoice…" className="rounded-xl h-12" />
      {ql && groups.length > 0 && <p className="text-[11px] text-muted-foreground px-1">Enter opens the first result</p>}
      {ql && (groups.length ? (
        <div className="space-y-4">{groups.map(g => <Section key={g.title} {...g} />)}</div>
      ) : (
        <div className="card-luxe px-4 py-10 text-center text-sm text-muted-foreground">
          <SearchX className="h-6 w-6 mx-auto mb-2 opacity-50" />
          Nothing found for “{q.trim()}”. Try an order or design no., a name, a phone number or a bag no.
        </div>
      ))}
    </div>
  );
}

function Section({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: Hit[] }) {
  return (
    <div className="card-luxe p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{title}</p>
      <div className="space-y-1">
        {items.map(i => (
          <div key={i.id} className="flex items-center gap-2 rounded-lg hover:bg-secondary">
            <Link to={i.to} className="block min-w-0 flex-1 p-2">
              <p className="text-sm font-medium truncate">{i.title}</p>
              {i.sub && <p className="text-xs text-muted-foreground truncate">{i.sub}</p>}
            </Link>
            {i.extra && (
              <Link to={i.extra.to} className="shrink-0 mr-2 inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-xs font-medium text-primary hover:bg-primary/[0.05]">
                {i.extra.label} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
