import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { loadDb, fmtMoney, fmtDate, totalAdvance, balanceDue } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import {
  ArrowLeft, Package, Search, Mail, Phone, MapPin, Globe,
  FileText, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Download, ExternalLink, Building2, Hash,
} from "lucide-react";
import { motion } from "framer-motion";
import jsPDF from "jspdf";
import { useAuth } from "@/lib/auth";

export function ClientHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = loadDb();

  const client = db.clients.find(c => c.id === id);
  // Employees may only open clients assigned to them — not the whole client base.
  const forbidden = client && user!.role === "employee" && client.accountManagerId !== user!.id;
  if (!client || forbidden) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {forbidden ? "You don't have access to this client." : "Client not found."}{" "}
        <Link to="/clients" className="text-primary underline">Back to Clients</Link>
      </div>
    );
  }

  const allOrders = db.orders
    .filter(o => o.clientId === id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const allInvoices = db.invoices.filter(inv => inv.clientId === id);

  // Summary stats
  const totalValue = allOrders.reduce((s, o) => s + o.amount, 0);
  const paidAmount = allInvoices.filter(i => i.paid).reduce((s, i) => s + i.amount, 0);
  const pendingAmount = allInvoices.filter(i => !i.paid).reduce((s, i) => s + i.amount, 0);
  const activeOrders = allOrders.filter(o => !["Delivered", "Rejected"].includes(o.status)).length;
  const deliveredOrders = allOrders.filter(o => o.status === "Delivered").length;

  const statusCounts: Record<string, number> = {};
  allOrders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

  // Filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = allOrders.filter(o => {
    const matchQ = !q || o.orderNumber.toLowerCase().includes(q.toLowerCase()) || o.jewelleryType.toLowerCase().includes(q.toLowerCase());
    const matchS = statusFilter === "all" || o.status === statusFilter;
    return matchQ && matchS;
  });

  const PAGE_SIZE = 10;
  const { paged, page, setPage, totalPages, start, end } = usePagination(filtered, PAGE_SIZE);

  const downloadClientReport = () => {
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    doc.text("STARLINK JEWELS", 20, 20);
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.text("Client Order History Report", 20, 28);
    doc.setLineWidth(0.4); doc.line(20, 33, 190, 33);

    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(client.companyName, 20, 43);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Owner: ${client.ownerName}`, 20, 50);
    doc.text(`Email: ${client.email}   Phone: ${client.phone}`, 20, 56);
    doc.text(`Country: ${client.country}   GST/VAT: ${client.gstVat}`, 20, 62);
    doc.text(`Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, 20, 68);
    doc.line(20, 73, 190, 73);

    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Summary", 20, 81);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Total Orders: ${allOrders.length}`, 20, 89);
    doc.text(`Delivered: ${deliveredOrders}   Active: ${activeOrders}`, 20, 95);
    doc.text(`Total Order Value: ${fmtMoney(totalValue)}`, 20, 101);
    doc.text(`Paid: ${fmtMoney(paidAmount)}   Outstanding: ${fmtMoney(pendingAmount)}`, 20, 107);
    doc.line(20, 113, 190, 113);

    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Order History", 20, 121);
    doc.setFontSize(9);
    const headers = ["Order #", "Type", "Metal", "Status", "Qty", "Amount", "Date"];
    const colX =     [20,        65,      100,     130,      158,   170,      188];
    let y = 129;
    headers.forEach((h, i) => { doc.text(h, colX[i], y); });
    doc.line(20, y + 3, 190, y + 3);
    doc.setFont("helvetica", "normal");
    allOrders.forEach(o => {
      y += 9;
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(o.orderNumber.slice(-10), colX[0], y);
      doc.text(o.jewelleryType.slice(0, 10), colX[1], y);
      doc.text(o.metal.slice(0, 10), colX[2], y);
      doc.text(o.status.slice(0, 12), colX[3], y);
      doc.text(String(o.quantity), colX[4], y);
      doc.text(fmtMoney(o.amount).replace("$", "$"), colX[5], y);
      doc.text(fmtDate(o.createdAt), colX[6], y);
    });

    doc.save(`ClientReport-${client.companyName.replace(/\s+/g, "_")}.pdf`);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => navigate("/clients")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Clients
      </button>

      {/* Client Profile Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-2xl md:text-3xl text-brand-dark">{client.companyName}</h1>
                <StatusBadge status={client.status} />
              </div>
              <p className="text-muted-foreground mt-1">{client.ownerName}</p>
            </div>
          </div>
          <Button onClick={downloadClientReport} variant="outline" className="rounded-xl gap-2">
            <Download className="h-4 w-4" /> Export Report
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{client.email || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{client.phone || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Country</p><p className="font-medium">{client.country || "—"}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <Hash className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">GST / VAT</p><p className="font-medium">{client.gstVat || "—"}</p></div>
          </div>
          {client.address && (
            <div className="col-span-2 flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div><p className="text-xs text-muted-foreground">Address</p><p className="font-medium">{client.address}</p></div>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Client Since</p><p className="font-medium">{fmtDate(client.createdAt)}</p></div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div><p className="text-xs text-muted-foreground">Username</p><p className="font-medium font-mono text-xs">{client.username}</p></div>
          </div>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Orders", value: allOrders.length, icon: Package, color: "text-primary", bg: "from-primary/10 to-brand-light/10" },
          { label: "Active Orders", value: activeOrders, icon: Clock, color: "text-warning-foreground", bg: "from-warning/10 to-orange-400/10" },
          { label: "Delivered", value: deliveredOrders, icon: CheckCircle2, color: "text-success", bg: "from-success/10 to-emerald-400/10" },
          { label: "Total Value", value: fmtMoney(totalValue), icon: TrendingUp, color: "text-brand-dark", bg: "from-brand-light/10 to-primary/10" },
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

      {/* Invoice Summary */}
      {allInvoices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card-luxe p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Paid Invoices</p>
              <p className="font-semibold">{allInvoices.filter(i => i.paid).length} · {fmtMoney(paidAmount)}</p>
            </div>
          </div>
          <div className="card-luxe p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 grid place-items-center shrink-0">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending Invoices</p>
              <p className="font-semibold">{allInvoices.filter(i => !i.paid).length} · {fmtMoney(pendingAmount)}</p>
            </div>
          </div>
          <div className="card-luxe p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Invoices</p>
              <p className="font-semibold">{allInvoices.length} · {fmtMoney(totalValue)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Order History */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-brand-dark">Order History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} of {allOrders.length} orders</p>
            {filtered.length > 0 && <p className="text-xs text-muted-foreground">Showing {start + 1}–{end}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="pl-8 h-9 w-44 rounded-xl text-sm" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 h-9 rounded-xl text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["Waiting","Approved","In Production","Ready","Dispatched","Delivered","Rejected"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Order #</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Item</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Metal</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Diamond</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Qty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Priority</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Amount</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Advance</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Balance</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Invoice</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((o, i) => {
                const invoice = allInvoices.find(inv => inv.orderId === o.id);
                const progress = Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100);
                const adv = totalAdvance(o);
                const bal = balanceDue(o);
                return (
                  <motion.tr key={o.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-border/40 hover:bg-secondary/20 transition-colors group">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-xs font-semibold text-brand-dark">{o.orderNumber}</p>
                      <div className="mt-1.5 h-1 w-20 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{progress}%</p>
                    </td>
                    <td className="px-4 py-3.5 font-medium">{o.jewelleryType}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{o.metal}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{o.diamondType}</td>
                    <td className="px-4 py-3.5 text-center">{o.quantity}</td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium ${o.priority === "Urgent" ? "text-red-500" : o.priority === "High Priority" ? "text-orange-500" : "text-muted-foreground"}`}>
                        {o.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3.5"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3.5 text-right font-semibold">{fmtMoney(o.amount)}</td>
                    <td className="px-4 py-3.5 text-right">
                      {adv > 0
                        ? <span className="text-success font-medium text-xs">{fmtMoney(adv)}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className={`text-xs font-semibold ${bal === 0 ? "text-success" : "text-destructive"}`}>
                        {bal === 0 ? "✓ Cleared" : fmtMoney(bal)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {invoice ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${invoice.paid ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
                          {invoice.paid ? "Paid" : "Unpaid"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <Link to={`/orders/${o.id}`}>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/40">
          {paged.map(o => {
            const invoice = allInvoices.find(inv => inv.orderId === o.id);
            const progress = Math.round(o.timeline.filter(t => t.status === "done").length / o.timeline.length * 100);
            const adv = totalAdvance(o);
            const bal = balanceDue(o);
            return (
              <Link key={o.id} to={`/orders/${o.id}`} className="flex items-start gap-3 p-4 hover:bg-secondary/20 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm">{o.orderNumber}</p>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{o.jewelleryType} · {o.metal} · {o.diamondType} · {o.quantity} pcs</p>
                  <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-brand-light" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>{progress}% · {fmtDate(o.createdAt)}</span>
                    <div className="flex items-center gap-2">
                      {adv > 0 && <span className="text-success font-medium">Adv {fmtMoney(adv)}</span>}
                      {bal > 0
                        ? <span className="text-destructive font-semibold">Bal {fmtMoney(bal)}</span>
                        : adv > 0 ? <span className="text-success font-semibold">✓ Cleared</span> : null}
                      {invoice && (
                        <span className={`font-medium ${invoice.paid ? "text-success" : "text-destructive"}`}>
                          {invoice.paid ? "Paid" : "Unpaid"}
                        </span>
                      )}
                      <span className="font-semibold text-foreground">{fmtMoney(o.amount)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">{allOrders.length === 0 ? "No orders yet" : "No orders match filters"}</p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 border-t border-border/60">
            <PaginationBar
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              label={`Showing ${start + 1}–${end} of ${filtered.length} orders`}
            />
          </div>
        )}

        {/* Table footer with totals */}
        {filtered.length > 0 && (
          <div className="px-5 py-3 bg-secondary/30 border-t border-border/60 flex items-center justify-between text-sm flex-wrap gap-3">
            <span className="text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-muted-foreground">Total <span className="font-semibold text-foreground">{fmtMoney(filtered.reduce((s, o) => s + o.amount, 0))}</span></span>
              {filtered.some(o => (o.advances||[]).length > 0) && (
                <>
                  <span className="text-muted-foreground">Advance <span className="font-semibold text-success">{fmtMoney(filtered.reduce((s, o) => s + totalAdvance(o), 0))}</span></span>
                  <span className="text-muted-foreground">Balance <span className={`font-semibold ${filtered.reduce((s,o)=>s+balanceDue(o),0)>0?"text-destructive":"text-success"}`}>{fmtMoney(filtered.reduce((s, o) => s + balanceDue(o), 0))}</span></span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
