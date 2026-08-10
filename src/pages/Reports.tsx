import { useState, useMemo } from "react";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, totalAdvance, balanceDue, orderTotal, TIMELINE_STEPS } from "@/lib/db";
import type { Order, Purchase } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { fmtMoneyInr, purchasePaid, purchasePending, materialLedger } from "@/lib/manufacturing";
import { downloadLedgerPdf } from "@/lib/ledgerExport";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Download, Package, Truck, CheckCircle2, DollarSign,
  Clock, TrendingUp, Users, X, BarChart3, Filter,
  Coins, Gem, Award, Boxes, ShoppingCart, CalendarDays,
} from "lucide-react";
import jsPDF from "jspdf";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* Local YYYY-MM-DD key (matches how the rest of the app displays dates) so a
   purchase near midnight IST lands on the calendar day staff expect. */
function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Which report bucket a purchase belongs to. Diamonds without an explicit
 *  kind are treated as loose (matches the DiamondPurchaseDetail contract). */
function purchaseCategory(p: Purchase): "gold" | "diamond" | "cert" {
  if (p.material === "gold") return "gold";
  return p.diamond?.kind === "certified" ? "cert" : "diamond";
}
function purchaseQty(p: Purchase): number {
  return p.material === "gold" ? (p.gold?.weightGrams || 0) : (p.diamond?.carat || 0);
}

/* ── helpers ── */
function dispatchDays(o: Order): number | null {
  const step = o.timeline.find(t => t.step === "Dispatch" && t.status === "done");
  if (!step?.date) return null;
  return Math.max(0, Math.round(
    (new Date(step.date).getTime() - new Date(o.createdAt).getTime()) / 86_400_000
  ));
}

function SummaryCard({
  icon: Icon, label, value, sub, color = "primary",
}: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    amber:   "bg-amber-500/10 text-amber-600",
    blue:    "bg-blue-500/10 text-blue-600",
    rose:    "bg-rose-500/10 text-rose-600",
  };
  return (
    <div className="card-luxe p-3.5 sm:p-5 flex items-center gap-3 sm:gap-4">
      <div className={`h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl grid place-items-center shrink-0 ${colorMap[color] ?? colorMap.primary}`}>
        <Icon className="h-4.5 w-4.5 sm:h-6 sm:w-6 h-[18px] w-[18px] sm:h-6 sm:w-6" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg sm:text-2xl text-brand-dark leading-tight">{value}</p>
        {sub && <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 hidden sm:block">{sub}</p>}
      </div>
    </div>
  );
}

/** Quick-preset date range → { from, to } as YYYY-MM-DD. */
function rangePreset(which: "this" | "last" | "year" | "all"): { from: string; to: string } {
  if (which === "all") return { from: "", to: "" };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (which === "year") return { from: `${now.getFullYear()}-01-01`, to: ymd(now.toISOString()) };
  const base = which === "this" ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = base.getFullYear(), m = base.getMonth();
  const last = new Date(y, m + 1, 0);
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last.getDate())}` };
}
function periodLabel(from: string, to: string): string {
  return from || to ? `${from || "start"} → ${to || "today"}` : "All time";
}

/** Reusable per-report period control: quick presets + custom From→To range. */
function PeriodBar({ from, to, setFrom, setTo }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const apply = (w: "this" | "last" | "year" | "all") => { const r = rangePreset(w); setFrom(r.from); setTo(r.to); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {([["this", "This month"], ["last", "Last month"], ["year", "This year"], ["all", "All time"]] as const).map(([k, lbl]) => {
        const active = k === "all" && !from && !to;
        return (
          <button key={k} onClick={() => apply(k)}
            className={`px-3 h-8 rounded-lg text-xs font-medium border transition-colors ${active ? "bg-primary text-white border-primary" : "bg-white border-border text-brand-dark hover:bg-secondary"}`}>
            {lbl}
          </button>
        );
      })}
      <div className="flex items-center gap-1.5 sm:ml-auto">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="h-8 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <span className="text-muted-foreground text-xs">→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="h-8 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
export function ReportsPage() {
  const { user } = useAuth();
  const isClient   = user?.role === "client";
  const isAdmin    = user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const canSeeAll  = isAdmin || isEmployee;

  const db        = loadDb();
  const myOrders  = currentUserOrders(db, user!);
  const clients   = db.clients;

  /* ── filters (admin / employee) ── */
  const [clientFilter, setClientFilter] = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");

  const clearFilters = () => {
    setClientFilter("all"); setDateFrom(""); setDateTo("");
  };
  const hasFilters = clientFilter !== "all" || !!dateFrom || !!dateTo;

  /* ── Financial reports — each has its OWN date range so staff can generate
     them separately (e.g. Purchases for Jan, Sales for Mar) ── */
  const [matFrom, setMatFrom]     = useState("");
  const [matTo,   setMatTo]       = useState("");
  const [payFrom, setPayFrom]     = useState("");
  const [payTo,   setPayTo]       = useState("");
  const [salesFrom, setSalesFrom] = useState("");
  const [salesTo,   setSalesTo]   = useState("");
  const makeInRange = (from: string, to: string) => (iso: string) => {
    const k = ymd(iso);
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  };

  const materialReport = useMemo(() => {
    if (!canSeeAll) return null;
    const inRange = makeInRange(matFrom, matTo);
    // Purchase date = supplier invoice date when recorded, else when it was entered.
    const rows = (db.purchases ?? []).filter(p => inRange(p.invoiceDate || p.createdAt));
    const mk = () => ({ qty: 0, amount: 0, count: 0, stockQty: 0, stockAmt: 0, orderQty: 0, orderAmt: 0 });
    const g = mk(), dl = mk(), dc = mk();
    const byPurity = new Map<string, { qty: number; amount: number }>();
    const byShape  = new Map<string, { qty: number; amount: number }>();
    for (const p of rows) {
      const c = purchaseCategory(p);
      const bucket = c === "gold" ? g : c === "cert" ? dc : dl;
      const qty = purchaseQty(p);
      bucket.qty += qty; bucket.amount += p.totalInr; bucket.count++;
      if (p.purpose === "stock") { bucket.stockQty += qty; bucket.stockAmt += p.totalInr; }
      else { bucket.orderQty += qty; bucket.orderAmt += p.totalInr; }
      if (c === "gold") {
        const key = p.gold?.purity || "—";
        const e = byPurity.get(key) || { qty: 0, amount: 0 }; e.qty += qty; e.amount += p.totalInr; byPurity.set(key, e);
      } else {
        const key = p.diamond?.shape || p.diamond?.quality || (c === "cert" ? "Certified" : "—");
        const e = byShape.get(key) || { qty: 0, amount: 0 }; e.qty += qty; e.amount += p.totalInr; byShape.set(key, e);
      }
    }
    const grand = g.amount + dl.amount + dc.amount;
    return {
      rows: [...rows].sort((a, b) => +new Date(b.invoiceDate || b.createdAt) - +new Date(a.invoiceDate || a.createdAt)),
      g, dl, dc, grand,
      byPurity: [...byPurity.entries()].sort((a, b) => b[1].amount - a[1].amount),
      byShape:  [...byShape.entries()].sort((a, b) => b[1].amount - a[1].amount),
    };
  }, [db.purchases, matFrom, matTo, canSeeAll]);

  const matPeriodLabel   = periodLabel(matFrom, matTo);
  const payPeriodLabel   = periodLabel(payFrom, payTo);
  const salesPeriodLabel = periodLabel(salesFrom, salesTo);

  /* ── Material report — PDF ── */
  function exportMaterialPdf() {
    if (!materialReport) return;
    try {
      const r = materialReport;
      const doc = new jsPDF();
      const money = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("Starlink Jewels — Material Purchase Report", 20, 22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`Period: ${matPeriodLabel}    Generated: ${new Date().toLocaleString()}`, 20, 30);
      let y = 44;
      const section = (title: string, unit: string, b: typeof r.g) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(title, 20, y); y += 7;
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);
        const avg = b.qty > 0 ? b.amount / b.qty : 0;
        [
          [`Total quantity`, `${b.qty.toLocaleString()} ${unit}`],
          [`Avg rate`, `${money(avg)} / ${unit}`],
          [`Total value`, money(b.amount)],
          [`Purchases`, `${b.count}  (stock ${money(b.stockAmt)} · order ${money(b.orderAmt)})`],
        ].forEach(([k, v]) => { doc.text(`${k}:`, 25, y); doc.text(String(v), 90, y); y += 6; });
        y += 3;
      };
      section("Metal (Gold)", "g", r.g);
      section("Diamond (Loose)", "ct", r.dl);
      section("Certified Diamond", "ct", r.dc);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(`Grand Total Purchases: ${money(r.grand)}`, 20, y + 2);

      // Full purchase history (every line) so the downloaded PDF is complete, not just a summary.
      const suppliers = db.suppliers ?? [];
      y += 12;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Full purchase ledger", 20, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120); doc.text("(Rate, Amount & Balance in Rs)", 62, y); doc.setTextColor(30); y += 7;
      doc.setFontSize(8);
      // Right-aligned money columns with plain grouped numbers (jsPDF can't render ₹).
      const plain = (n: number) => Math.round(n).toLocaleString("en-IN");
      const cols: [string, number, boolean][] = [["Date", 14, false], ["Supplier", 36, false], ["Item", 82, false], ["Qty", 108, true], ["Rate", 132, true], ["Amount", 160, true], ["Balance", 194, true]];
      const colR = (i: number) => (i < cols.length - 1 ? cols[i + 1][1] - 3 : 194);
      cols.forEach(([h, x, right], i) => doc.text(h, right ? colR(i) : x, y, right ? { align: "right" } : undefined)); y += 4;
      doc.setDrawColor(200); doc.line(14, y - 2, 196, y - 2);
      doc.setFont("helvetica", "normal");
      let running = 0;
      const ordered = [...r.rows].sort((a, b) => +new Date(a.invoiceDate || a.createdAt) - +new Date(b.invoiceDate || b.createdAt));
      for (const p of ordered) {
        const c = purchaseCategory(p); const qty = purchaseQty(p); const unit = c === "gold" ? "g" : "ct";
        const label = c === "gold" ? "Gold" : c === "cert" ? "Cert.Dia" : "Diamond";
        running += p.totalInr;
        const cells = [fmtDate(p.invoiceDate || p.createdAt), (suppliers.find(s => s.id === p.supplierId)?.name ?? "").slice(0, 20), label, `${qty}${unit}`, qty > 0 ? plain(p.totalInr / qty) : "-", plain(p.totalInr), plain(running)];
        cells.forEach((cval, i) => doc.text(cval, cols[i][2] ? colR(i) : cols[i][1], y, cols[i][2] ? { align: "right" } : undefined));
        y += 5; if (y > 285) { doc.addPage(); y = 20; }
      }
      doc.setFont("helvetica", "bold"); doc.text(`Grand Total: ${money(r.grand)}`, 152, y + 3);
      doc.save(`Starlink-Material-Purchase-${matFrom || "all"}.pdf`);
    } catch { toast.error("Couldn't generate the PDF file."); }
  }

  /* ── Material report — Excel (CSV) ── */
  function exportMaterialExcel() {
    if (!materialReport) return;
    try {
      const suppliers = db.suppliers ?? [];
      const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const headers = ["Date","Supplier","Category","Purpose","Purity/Shape","Quantity","Unit","Rate (Rs)","Amount (Rs)","Running Total (Rs)","Invoice #"];
      const catLabel = { gold: "Metal (Gold)", diamond: "Diamond (Loose)", cert: "Certified Diamond" };
      let running = 0;
      const rows = [...materialReport.rows]
        .sort((a, b) => +new Date(a.invoiceDate || a.createdAt) - +new Date(b.invoiceDate || b.createdAt))
        .map(p => {
          const c = purchaseCategory(p);
          const qty = purchaseQty(p);
          const unit = c === "gold" ? "g" : "ct";
          const detail = c === "gold" ? (p.gold?.purity || "") : (p.diamond?.shape || p.diamond?.quality || (c === "cert" ? "Certified" : ""));
          const rate = qty > 0 ? Math.round(p.totalInr / qty) : "";
          running += p.totalInr;
          return [
            fmtDate(p.invoiceDate || p.createdAt),
            suppliers.find(s => s.id === p.supplierId)?.name ?? "",
            catLabel[c], p.purpose, detail, qty, unit, rate, Math.round(p.totalInr), Math.round(running), p.invoiceNumber ?? "",
          ];
        });
      const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Starlink-Material-Purchase-${matFrom || "all"}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error("Couldn't generate the Excel file."); }
  }

  const rupees = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
  const csvDownload = (name: string, headers: string[], rows: (string | number)[][]) => {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* ── Payments made (money out) — supplier + factory payments in the period ── */
  const paymentsReport = useMemo(() => {
    if (!canSeeAll) return null;
    const inRange = makeInRange(payFrom, payTo);
    const suppliers = db.suppliers ?? [];
    const factories = db.factories ?? [];
    type Row = { date: string; party: string; kind: "Supplier" | "Factory"; ref: string; amount: number };
    const rows: Row[] = [];
    for (const p of db.purchases ?? [])
      for (const pay of p.payments ?? [])
        if (inRange(pay.createdAt))
          rows.push({ date: pay.createdAt, party: suppliers.find(s => s.id === p.supplierId)?.name ?? "Supplier", kind: "Supplier", ref: p.invoiceNumber || "—", amount: pay.amountInr });
    for (const i of db.materialIssuances ?? [])
      for (const pay of i.makingCharges?.payments ?? [])
        if (inRange(pay.createdAt))
          rows.push({ date: pay.createdAt, party: factories.find(f => f.id === i.factoryId)?.name ?? "Factory", kind: "Factory", ref: "Making charges", amount: pay.amountInr });
    const supTotal = rows.filter(r => r.kind === "Supplier").reduce((s, r) => s + r.amount, 0);
    const facTotal = rows.filter(r => r.kind === "Factory").reduce((s, r) => s + r.amount, 0);
    rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
    return { rows, supTotal, facTotal, grand: supTotal + facTotal };
  }, [db.purchases, db.materialIssuances, db.suppliers, db.factories, payFrom, payTo, canSeeAll]);

  /* ── Sales / client billing — orders placed in the period ── */
  const salesReport = useMemo(() => {
    if (!canSeeAll) return null;
    const inRange = makeInRange(salesFrom, salesTo);
    const orders = (db.orders ?? []).filter(o => o.status !== "Rejected" && inRange(o.createdAt));
    const billed = orders.reduce((s, o) => s + orderTotal(o), 0);
    const received = orders.reduce((s, o) => s + totalAdvance(o), 0);
    const outstanding = orders.reduce((s, o) => s + balanceDue(o), 0);
    const giftRedeemed = orders.reduce((s, o) => s + (o.giftCardRedeemed || 0), 0);
    const map = new Map<string, { name: string; count: number; billed: number; received: number; outstanding: number }>();
    for (const o of orders) {
      const name = clients.find(c => c.id === o.clientId)?.companyName ?? "Unknown";
      const e = map.get(o.clientId) ?? { name, count: 0, billed: 0, received: 0, outstanding: 0 };
      e.count++; e.billed += orderTotal(o); e.received += totalAdvance(o); e.outstanding += balanceDue(o);
      map.set(o.clientId, e);
    }
    return {
      orders: [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      billed, received, outstanding, giftRedeemed,
      byClient: [...map.values()].sort((a, b) => b.billed - a.billed),
    };
  }, [db.orders, clients, salesFrom, salesTo, canSeeAll]);

  /* ── Payments report exports ── */
  function exportPaymentsPdf() {
    if (!paymentsReport) return;
    try {
      const r = paymentsReport;
      const doc = new jsPDF();
      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("Starlink Jewels — Payments Made Report", 20, 22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`Period: ${payPeriodLabel}    Generated: ${new Date().toLocaleString()}`, 20, 30);
      doc.setFontSize(11);
      doc.text(`Supplier payments: ${rupees(r.supTotal)}`, 20, 44);
      doc.text(`Factory payments:  ${rupees(r.facTotal)}`, 20, 52);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(`Total paid out: ${rupees(r.grand)}`, 20, 64);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      let y = 78;
      doc.text("Date", 20, y); doc.text("Party", 55, y); doc.text("Type", 120, y); doc.text("Amount", 160, y); y += 5;
      r.rows.forEach(row => {
        doc.text(fmtDate(row.date), 20, y);
        doc.text(String(row.party).slice(0, 32), 55, y);
        doc.text(row.kind, 120, y);
        doc.text(rupees(row.amount), 160, y);
        y += 5;
        if (y > 280) { doc.addPage(); y = 20; }
      });
      doc.save(`Starlink-Payments-${payFrom || "all"}.pdf`);
    } catch { toast.error("Couldn't generate the PDF file."); }
  }
  function exportPaymentsExcel() {
    if (!paymentsReport) return;
    try {
      csvDownload(
        `Starlink-Payments-${payFrom || "all"}.csv`,
        ["Date", "Party", "Type", "Reference", "Amount (Rs)"],
        paymentsReport.rows.map(r => [fmtDate(r.date), r.party, r.kind, r.ref, Math.round(r.amount)]),
      );
    } catch { toast.error("Couldn't generate the Excel file."); }
  }

  /* ── Sales report exports ── */
  function exportSalesPdf() {
    if (!salesReport) return;
    try {
      const r = salesReport;
      const doc = new jsPDF();
      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("Starlink Jewels — Sales / Billing Report", 20, 22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`Period: ${salesPeriodLabel}    Generated: ${new Date().toLocaleString()}`, 20, 30);
      doc.setFontSize(11);
      doc.text(`Orders: ${r.orders.length}`, 20, 44);
      doc.text(`Billed: ${fmtMoney(r.billed)}`, 20, 52);
      doc.text(`Received: ${fmtMoney(r.received)}`, 20, 60);
      doc.text(`Outstanding: ${fmtMoney(r.outstanding)}`, 20, 68);
      if (r.giftRedeemed > 0) doc.text(`Gift cards redeemed: ${fmtMoney(r.giftRedeemed)}  (already deducted from Billed)`, 20, 76);
      let y = r.giftRedeemed > 0 ? 90 : 82;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("By client", 20, y); y += 8;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      r.byClient.forEach(c => {
        doc.text(String(c.name).slice(0, 34), 20, y);
        doc.text(`${c.count} ord`, 95, y);
        doc.text(fmtMoney(c.billed), 120, y);
        doc.text(`out ${fmtMoney(c.outstanding)}`, 155, y);
        y += 6;
        if (y > 280) { doc.addPage(); y = 20; }
      });

      // Full order-by-order history so the PDF is complete, not just a summary.
      y += 8; if (y > 260) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Full order history", 20, y); y += 7;
      doc.setFontSize(8);
      ([["Order #", 14], ["Client", 40], ["Date", 92], ["Billed", 122], ["Received", 150], ["Balance", 176]] as [string, number][])
        .forEach(([h, x]) => doc.text(h, x, y)); y += 4;
      doc.setDrawColor(200); doc.line(14, y - 2, 196, y - 2);
      doc.setFont("helvetica", "normal");
      for (const o of r.orders) {
        doc.text(String(o.orderNumber), 14, y);
        doc.text((clients.find(c => c.id === o.clientId)?.companyName ?? "").slice(0, 24), 40, y);
        doc.text(fmtDate(o.createdAt), 92, y);
        doc.text(fmtMoney(orderTotal(o)), 122, y);
        doc.text(fmtMoney(totalAdvance(o)), 150, y);
        doc.text(fmtMoney(balanceDue(o)), 176, y);
        y += 5; if (y > 285) { doc.addPage(); y = 20; }
      }
      doc.save(`Starlink-Sales-${salesFrom || "all"}.pdf`);
    } catch { toast.error("Couldn't generate the PDF file."); }
  }
  function exportSalesExcel() {
    if (!salesReport) return;
    try {
      csvDownload(
        `Starlink-Sales-${salesFrom || "all"}.csv`,
        ["Order #", "Client", "Type", "Status", "Date", "Billed", "Gift Card", "Received", "Outstanding"],
        salesReport.orders.map(o => [
          o.orderNumber, clients.find(c => c.id === o.clientId)?.companyName ?? "", o.jewelleryType, o.status,
          fmtDate(o.createdAt), orderTotal(o), o.giftCardRedeemed || 0, totalAdvance(o), balanceDue(o),
        ]),
      );
    } catch { toast.error("Couldn't generate the Excel file."); }
  }

  /* ── Per-material ledgers — separate Gold / Loose Diamond / Certified Diamond
     reports, each a full ledger (every purchase + running total) ── */
  type MatCat = "gold" | "diamond" | "cert";
  const CAT_META: Record<MatCat, { label: string; unit: string; detail: string }> = {
    gold:    { label: "Gold",             unit: "g",  detail: "Purity" },
    diamond: { label: "Loose Diamond",    unit: "ct", detail: "Shape" },
    cert:    { label: "Certified Diamond", unit: "ct", detail: "Shape/Cert" },
  };
  const catDetail = (p: Purchase, cat: MatCat) =>
    cat === "gold" ? (p.gold?.purity || "") : (p.diamond?.shape || p.diamond?.quality || (cat === "cert" ? "Certified" : ""));
  // Oldest-first for a running-balance ledger.
  const catRows = (cat: MatCat) => (materialReport?.rows ?? [])
    .filter(p => purchaseCategory(p) === cat)
    .sort((a, b) => +new Date(a.invoiceDate || a.createdAt) - +new Date(b.invoiceDate || b.createdAt));
  const catBucket = (cat: MatCat) => cat === "gold" ? materialReport!.g : cat === "cert" ? materialReport!.dc : materialReport!.dl;

  // Full stock-movement ledger (purchases IN + factory issues / order use / sales
  // OUT + returns) with running balance, for Gold & Loose Diamond — the "proper
  // ledger" the Stock page shows, filtered to the report's date range.
  const movementLedger = (material: "gold" | "diamond") => {
    const all = materialLedger(db.stockMovements ?? [], material, {
      purchases: db.purchases ?? [], issuances: db.materialIssuances ?? [], orders: db.orders ?? [],
      factories: db.factories ?? [], suppliers: db.suppliers ?? [], diamondSales: db.diamondSales ?? [], clients: db.clients ?? [],
    });
    return all.filter(r => {
      const k = ymd(r.createdAt);
      if (matFrom && k < matFrom) return false;
      if (matTo && k > matTo) return false;
      return true;
    });
  };

  // Comprehensive per-material ledger (Excel) — EVERY field on each purchase:
  // invoice, supplier, purpose/order, full grading, currency/FX, paid/pending,
  // running balance & notes.
  function exportCategoryExcel(cat: MatCat) {
    if (!materialReport) return;
    try {
      const m = CAT_META[cat];
      // Gold & Loose Diamond → full movement ledger (in/out/balance), not just purchases.
      if (cat === "gold" || cat === "diamond") {
        const led = movementLedger(cat);
        csvDownload(
          `Starlink-${m.label.replace(/\s+/g, "_")}-Ledger-${matFrom || "all"}.csv`,
          ["Date", "Particulars", m.detail, `In (${m.unit})`, `Out (${m.unit})`, `Balance (${m.unit})`, "Rate (Rs)", "Amount (Rs)"],
          led.map(r => [
            fmtDate(r.createdAt), r.link.label, r.purityOrQuality,
            r.inQty || "", r.outQty || "", r.balance,
            r.rateInr ? Math.round(r.rateInr) : "", r.amountInr ? Math.round(r.amountInr) : "",
          ]),
        );
        return;
      }
      const suppliers = db.suppliers ?? [];
      const packets = db.diamondPackets ?? [];
      const rows = catRows(cat);
      let running = 0;
      const base = (p: Purchase) => {
        running += p.totalInr;
        return {
          date: fmtDate(p.invoiceDate || p.createdAt),
          inv: p.invoiceNumber ?? "",
          supplier: suppliers.find(s => s.id === p.supplierId)?.name ?? "",
          purpose: p.purpose,
          order: p.orderId ? (db.orders.find(o => o.id === p.orderId)?.orderNumber ?? "") : "",
          currency: p.currency,
          usd: p.currency === "USD" ? (p.totalUsd ?? "") : "",
          fx: p.currency === "USD" ? (p.exchangeRate ?? "") : "",
          amount: Math.round(p.totalInr),
          paid: Math.round(purchasePaid(p)),
          pending: Math.round(purchasePending(p)),
          running: Math.round(running),
          notes: p.notes ?? "",
        };
      };

      // Certified diamonds aren't pooled in stock movements — export the full
      // purchase detail (with certificate grading from the linked packet).
      const headers = ["Date", "Invoice #", "Supplier", "Purpose", "Order #", "Shape", "Carat", "Quality", "Certificate #", "Lab", "Color", "Clarity", "Cut", "Polish", "Symmetry", "Fluorescence", "Measurement", "Rate/ct", "Currency", "USD Amount", "Exchange Rate", "Amount (INR)", "Paid (INR)", "Pending (INR)", "Running Total (INR)", "Notes"];
      const data = rows.map(p => {
        const c = base(p);
        const pk = packets.find(x => x.purchaseId === p.id); // full grading lives on the packet
        return [c.date, c.inv, c.supplier, c.purpose, c.order,
          p.diamond?.shape ?? pk?.shape ?? "", p.diamond?.carat ?? pk?.carat ?? "", p.diamond?.quality ?? pk?.quality ?? "",
          p.diamond?.certificateNumber ?? pk?.certificateNumber ?? "", p.diamond?.certificateLab ?? pk?.certificateLab ?? "",
          pk?.color ?? "", pk?.clarity ?? "", pk?.cut ?? "", pk?.polish ?? "", pk?.symmetry ?? "", pk?.fluorescence ?? "", pk?.measurement ?? "",
          p.diamond?.ratePerCarat ?? "", c.currency, c.usd, c.fx, c.amount, c.paid, c.pending, c.running, c.notes];
      });
      csvDownload(`Starlink-${m.label.replace(/\s+/g, "_")}-Ledger-${matFrom || "all"}.csv`, headers, data);
    } catch { toast.error("Couldn't generate the Excel file."); }
  }

  function exportCategoryPdf(cat: MatCat) {
    if (!materialReport) return;
    try {
      const m = CAT_META[cat]; const b = catBucket(cat);

      // Gold & Loose Diamond → full movement ledger PDF (in/out/balance).
      if (cat === "gold" || cat === "diamond") {
        const led = movementLedger(cat);
        const r3 = (n: number) => Math.round(n * 1000) / 1000; // kill float noise (24.58999… → 24.59)
        const totalIn = r3(led.reduce((s, r) => s + r.inQty, 0));
        const totalOut = r3(led.reduce((s, r) => s + r.outQty, 0));
        const totalAmt = led.reduce((s, r) => s + (r.amountInr || 0), 0);
        const closing = led[0]?.balance ?? 0; // newest-first → first row is the latest balance
        const rs = (n: number) => Math.round(n).toLocaleString("en-IN");
        downloadLedgerPdf({
          title: `${m.label} — Stock Ledger`,
          subjectLines: [`Period: ${matPeriodLabel}`, "Rate & Amount in Rs (INR)"],
          summary: [
            { label: "Purchased", value: `${b.qty.toLocaleString()} ${m.unit}  ·  ${rupees(b.amount)}` },
            { label: "Current balance", value: `${closing.toLocaleString()} ${m.unit}` },
          ],
          landscape: true,
          columns: [
            { header: "Date", x: 14 }, { header: cat === "gold" ? "Purity" : "Shape", x: 42 }, { header: "Particulars", x: 70 },
            { header: "In", x: 172 }, { header: "Out", x: 196 }, { header: "Balance", x: 220 },
            { header: "Rate", x: 242 }, { header: "Amount", x: 262 },
          ],
          align: ["left", "left", "left", "right", "right", "right", "right", "right"],
          rows: led.map(r => [
            fmtDate(r.createdAt), String(r.purityOrQuality), String(r.link.label),
            r.inQty ? `${r.inQty}${m.unit}` : "—",
            r.outQty ? `${r.outQty}${m.unit}` : "—",
            `${r.balance}${m.unit}`,
            r.rateInr ? rs(r.rateInr) : "—",
            r.amountInr ? rs(r.amountInr) : "—",
          ]),
          totalsRow: ["", "", "Totals", `${totalIn}${m.unit}`, `${totalOut}${m.unit}`, `${closing}${m.unit}`, "", rs(totalAmt)],
          filename: `Starlink-${m.label.replace(/\s+/g, "_")}-Ledger-${matFrom || "all"}`,
        });
        return;
      }

      const rows = catRows(cat); const suppliers = db.suppliers ?? [];
      const avg = b.qty > 0 ? b.amount / b.qty : 0;
      const rs = (n: number) => Math.round(n).toLocaleString("en-IN");
      const packets = db.diamondPackets ?? [];
      const dataRows = rows.map(p => {
        const qty = purchaseQty(p);
        const pk = packets.find(x => x.purchaseId === p.id); // certificate details live on the packet
        // Fill the reference: supplier invoice # if there is one, otherwise the
        // linked order's number for order-purpose buys (so it's never blank).
        const ref = p.invoiceNumber
          || (p.orderId ? (db.orders.find(o => o.id === p.orderId)?.orderNumber ?? "") : "")
          || "—";
        const cert = p.diamond?.certificateNumber || pk?.certificateNumber || "—";
        return [
          fmtDate(p.invoiceDate || p.createdAt),
          (suppliers.find(s => s.id === p.supplierId)?.name ?? "").slice(0, 26),
          String(ref).slice(0, 16),
          String(p.diamond?.shape || pk?.shape || "—"),
          String(cert).slice(0, 24),
          `${qty}${m.unit}`,
          qty > 0 ? rs(p.totalInr / qty) : "—",
          rs(p.totalInr),
        ];
      });
      downloadLedgerPdf({
        title: `${m.label} — Purchase Ledger`,
        subjectLines: [`Period: ${matPeriodLabel}`, "Rate & Amount in Rs (INR)"],
        summary: [
          { label: "Total quantity", value: `${b.qty.toLocaleString()} ${m.unit}` },
          { label: "Average rate", value: `${rupees(avg)} / ${m.unit}` },
          { label: "Total value", value: rupees(b.amount) },
          { label: "Purchases", value: `${b.count}  (stock ${rupees(b.stockAmt)} · order ${rupees(b.orderAmt)})` },
        ],
        landscape: true,
        columns: [
          { header: "Date", x: 14 },
          { header: "Supplier", x: 42 },
          { header: "Inv / Order", x: 96 },
          { header: "Shape", x: 132 },
          { header: "Certificate", x: 158 },
          { header: "Qty", x: 222 },
          { header: "Rate", x: 248 },
          { header: "Amount", x: 268 },
        ],
        align: ["left", "left", "left", "left", "left", "right", "right", "right"],
        rows: dataRows,
        totalsRow: ["", "", "", "", "", "", "Total", rs(b.amount)],
        filename: `Starlink-${m.label.replace(/\s+/g, "_")}-Ledger-${matFrom || "all"}`,
      });
    } catch { toast.error("Couldn't generate the PDF file."); }
  }

  /* ── filtered data ── */
  const filtered = useMemo(() => {
    let list = [...myOrders];
    if (canSeeAll && clientFilter !== "all") {
      list = list.filter(o => o.clientId === clientFilter);
    }
    // Compare on the LOCAL calendar date so orders near midnight (IST) land in the
    // right day and a "To" date includes same-day orders.
    if (dateFrom || dateTo) {
      list = list.filter(o => {
        const d = new Date(o.createdAt);
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (dateFrom && local < dateFrom) return false;
        if (dateTo && local > dateTo) return false;
        return true;
      });
    }
    return list;
  }, [myOrders, clientFilter, dateFrom, dateTo]);

  /* ── summary metrics ── */
  const total      = filtered.length;
  const delivered  = filtered.filter(o => o.status === "Delivered");
  const dispatched = filtered.filter(o => ["Dispatched","Delivered"].includes(o.status));
  const inProd     = filtered.filter(o => o.status === "In Production");
  const revenue    = delivered.reduce((s, o) => s + (o.amount || 0), 0);

  /* ── dispatch speed ── */
  const speedRows = filtered
    .map(o => { const d = dispatchDays(o); return d !== null ? { o, days: d } : null; })
    .filter(Boolean) as { o: Order; days: number }[];

  const avgDays = speedRows.length > 0
    ? (speedRows.reduce((s, r) => s + r.days, 0) / speedRows.length).toFixed(1)
    : null;

  const fast   = speedRows.filter(r => r.days <= 7).length;
  const normal = speedRows.filter(r => r.days > 7 && r.days <= 20).length;
  const slow   = speedRows.filter(r => r.days > 20).length;

  /* ── production-stage chart — every order has a timeline, so this always
     has data (the old "by department" relied on a field that's often unset). */
  const byStage = useMemo(() => {
    const stageOf = (o: Order): string => {
      const ip = o.timeline.find(t => t.status === "in_progress");
      if (ip) return ip.step;
      const done = o.timeline.filter(t => t.status === "done");
      return done.length ? done[done.length - 1].step : (o.timeline[0]?.step ?? "—");
    };
    const counts = new Map<string, number>();
    filtered.forEach(o => { const s = stageOf(o); counts.set(s, (counts.get(s) || 0) + 1); });
    // Known steps first (in order), then any legacy step names still on old orders.
    const known = TIMELINE_STEPS as readonly string[];
    const ordered = [
      ...known.filter(s => counts.has(s)),
      ...[...counts.keys()].filter(s => !known.includes(s)),
    ];
    return ordered.map(s => ({ name: s.length > 11 ? s.slice(0, 10) + "…" : s, fullName: s, count: counts.get(s) || 0 }));
  }, [filtered]);

  /* ── client-wise breakdown (admin / employee, no client filter) ── */
  const byClient = useMemo(() => {
    if (!canSeeAll) return [];
    const map = new Map<string, {
      id: string; name: string; total: number;
      dispatched: number; delivered: number; revenue: number; avgDays: number | null;
    }>();
    filtered.forEach(o => {
      const c = clients.find(cl => cl.id === o.clientId);
      const name = c?.companyName || "Unknown";
      const prev = map.get(o.clientId) ?? { id: o.clientId, name, total: 0, dispatched: 0, delivered: 0, revenue: 0, avgDays: null };
      prev.total++;
      if (["Dispatched","Delivered"].includes(o.status)) prev.dispatched++;
      if (o.status === "Delivered") { prev.delivered++; prev.revenue += o.amount || 0; }
      map.set(o.clientId, prev);
    });
    // compute avgDays per client
    map.forEach((row) => {
      const rows = filtered
        .filter(o => o.clientId === row.id)
        .map(o => dispatchDays(o))
        .filter(d => d !== null) as number[];
      row.avgDays = rows.length > 0 ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length) : null;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered, clients]);

  /* ── status breakdown for client ── */
  const STATUS_LIST = ["Waiting","Approved","In Production","Ready","Dispatched","Delivered"] as const;
  const statusColors: Record<string, string> = {
    "Waiting": "bg-slate-100 text-slate-600",
    "Approved": "bg-blue-100 text-blue-700",
    "In Production": "bg-amber-100 text-amber-700",
    "Ready": "bg-purple-100 text-purple-700",
    "Dispatched": "bg-primary/10 text-primary",
    "Delivered": "bg-success/10 text-success",
  };

  /* ── PDF export ── */
  function exportPdf() {
   try {
    const doc = new jsPDF();
    doc.setFont("helvetica","bold"); doc.setFontSize(18);
    doc.text("Starlink Jewels — Business Report", 20, 22);
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 30);
    if (hasFilters) {
      const filterDesc = [
        clientFilter !== "all" && `Client: ${clients.find(c=>c.id===clientFilter)?.companyName}`,
        dateFrom && `From: ${dateFrom}`,
        dateTo   && `To: ${dateTo}`,
      ].filter(Boolean).join(" | ");
      doc.text(`Filters: ${filterDesc}`, 20, 36);
    }
    doc.setFont("helvetica","bold"); doc.setFontSize(12);
    doc.text("Summary", 20, 48);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    let y = 56;
    const rows: [string,string][] = [
      ["Total Orders",    String(total)],
      ["Dispatched",      String(dispatched.length)],
      ["Delivered",       String(delivered.length)],
      ["In Production",   String(inProd.length)],
      ...(canSeeAll ? [["Total Revenue", fmtMoney(revenue)]] as [string,string][] : []),
      ...(avgDays ? [["Avg Dispatch Time", `${avgDays} days`]] as [string,string][] : []),
    ];
    rows.forEach(([k,v]) => { doc.text(`${k}:`, 25, y); doc.text(v, 110, y); y += 7; });
    if (byClient.length > 0) {
      y += 4; doc.setFont("helvetica","bold"); doc.setFontSize(12);
      doc.text("Client Breakdown", 20, y); y += 8;
      doc.setFont("helvetica","normal"); doc.setFontSize(9);
      byClient.forEach(cl => {
        doc.text(`${cl.name}`, 25, y);
        doc.text(`${cl.total} orders · ${cl.dispatched} dispatched · ${fmtMoney(cl.revenue)}`, 75, y);
        y += 6;
        if (y > 270) { doc.addPage(); y = 20; }
      });
    }
    doc.save("Starlink-Report.pdf");
   } catch { toast.error("Couldn't generate the PDF file."); }
  }

  /* ── Excel export (CSV — opens directly in Excel) ── */
  function exportExcel() {
   try {
    const headers = [
      "Order #", "Client", "Type", "Metal", "Diamond", "Qty", "Status", "Priority",
      "Order Value", "Advance Paid", "Balance Due", "Invoice Total", "Created", "Design #",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [...filtered]
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map(o => {
        const c = clients.find(cl => cl.id === o.clientId);
        return [
          o.orderNumber, c?.companyName ?? "", o.jewelleryType, o.metal, o.diamondType,
          o.quantity, o.status, o.priority, o.amount ?? 0, totalAdvance(o), balanceDue(o),
          orderTotal(o), fmtDate(o.createdAt), o.designNumber ?? "",
        ];
      });
    const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
    // UTF-8 BOM so Excel reads it with correct encoding.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Starlink-Orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
   } catch { toast.error("Couldn't generate the Excel file."); }
  }

  /* ── render ── */
  return (
    <div className="max-w-7xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-brand-dark leading-tight">
            {isClient ? "My Reports" : "Reports"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {isClient
              ? "Overview of your orders and delivery performance"
              : `${total} order${total !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : " · all time"}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 h-9 sm:h-10 rounded-xl border border-border bg-white hover:bg-secondary transition-colors text-xs sm:text-sm font-medium text-brand-dark">
            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Export Excel</span>
            <span className="sm:hidden">Excel</span>
          </button>
          <button onClick={exportPdf}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 h-9 sm:h-10 rounded-xl btn-hero text-xs sm:text-sm font-medium">
            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Download PDF</span>
            <span className="sm:hidden">PDF</span>
          </button>
        </div>
      </div>

      {/* ── Filters (admin / employee) ── */}
      {canSeeAll && (
        <div className="card-luxe p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs sm:text-sm font-semibold text-brand-dark tracking-wide uppercase">Filters</p>
            {hasFilters && (
              <button onClick={clearFilters}
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Client */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Client</label>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Date From */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {/* Date To */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          {/* Active filter chips */}
          {hasFilters && (
            <div className="flex flex-wrap gap-2 mt-3">
              {clientFilter !== "all" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  <Users className="h-3 w-3" />
                  {clients.find(c => c.id === clientFilter)?.companyName}
                  <button onClick={() => setClientFilter("all")} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
              {dateFrom && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  From {dateFrom}
                  <button onClick={() => setDateFrom("")} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
              {dateTo && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  To {dateTo}
                  <button onClick={() => setDateTo("")} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className={`grid gap-4 ${canSeeAll ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
        <SummaryCard icon={Package}      label="Total Orders"   value={total}              color="primary" />
        <SummaryCard icon={Truck}        label="Dispatched"     value={dispatched.length}  color="blue"
          sub={total > 0 ? `${Math.round(dispatched.length/total*100)}% of orders` : undefined} />
        <SummaryCard icon={CheckCircle2} label="Delivered"      value={delivered.length}   color="success" />
        {canSeeAll
          ? <SummaryCard icon={DollarSign}  label="Client Billing"  value={fmtMoney(revenue)}  color="amber" sub="Delivered (USD) · costs in Passbook" />
          : <SummaryCard icon={TrendingUp}  label="In Production" value={inProd.length}    color="rose" />
        }
      </div>

      {/* ── Material Purchase Report (admin / employee) ── */}
      {canSeeAll && materialReport && (
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          {/* Header + export */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-amber-500/10 grid place-items-center shrink-0"><Coins className="h-5 w-5 text-amber-600" /></div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Purchases</p>
                <h3 className="font-semibold text-brand-dark text-sm sm:text-base leading-tight">Material Purchase Report</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Gold · diamond · certified — stock + order buys · {matPeriodLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={exportMaterialExcel}
                className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-border bg-white hover:bg-secondary transition-colors text-xs font-medium text-brand-dark">
                <Download className="h-3.5 w-3.5" /> Excel
              </button>
              <button onClick={exportMaterialPdf}
                className="flex items-center gap-1.5 px-3 h-9 rounded-xl btn-hero text-xs font-medium">
                <Download className="h-3.5 w-3.5" /> PDF
              </button>
            </div>
          </div>

          <PeriodBar from={matFrom} to={matTo} setFrom={setMatFrom} setTo={setMatTo} />

          {/* Category cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              { label: "Metal (Gold)", cat: "gold" as MatCat, unit: "g", icon: Coins, ring: "bg-amber-500/10 text-amber-600", b: materialReport.g },
              { label: "Diamond (Loose)", cat: "diamond" as MatCat, unit: "ct", icon: Gem, ring: "bg-blue-500/10 text-blue-600", b: materialReport.dl },
              { label: "Certified Diamond", cat: "cert" as MatCat, unit: "ct", icon: Award, ring: "bg-primary/10 text-primary", b: materialReport.dc },
            ]).map(c => {
              const avg = c.b.qty > 0 ? c.b.amount / c.b.qty : 0;
              return (
                <div key={c.label} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${c.ring}`}><c.icon className="h-4 w-4" /></div>
                    <p className="text-xs font-semibold text-brand-dark">{c.label}</p>
                  </div>
                  <p className="font-display text-2xl text-brand-dark leading-none">{c.b.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}<span className="text-sm text-muted-foreground font-sans ml-1">{c.unit}</span></p>
                  <p className="text-xs text-muted-foreground mt-1">{c.b.count} purchase{c.b.count !== 1 ? "s" : ""} · avg {c.b.qty > 0 ? `${fmtMoneyInr(avg)}/${c.unit}` : "—"}</p>
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-lg font-semibold text-brand-dark">{fmtMoneyInr(c.b.amount)}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Boxes className="h-3 w-3" /> Stock {fmtMoneyInr(c.b.stockAmt)}</span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><ShoppingCart className="h-3 w-3" /> Order {fmtMoneyInr(c.b.orderAmt)}</span>
                    </div>
                  </div>
                  {/* Separate full-ledger download for THIS material only */}
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => exportCategoryExcel(c.cat)} disabled={c.b.count === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-border bg-white hover:bg-secondary text-[11px] font-medium text-brand-dark disabled:opacity-40">
                      <Download className="h-3 w-3" /> Excel
                    </button>
                    <button onClick={() => exportCategoryPdf(c.cat)} disabled={c.b.count === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg btn-hero text-[11px] font-medium disabled:opacity-40">
                      <Download className="h-3 w-3" /> PDF
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grand total */}
          <div className="rounded-2xl bg-gradient-to-br from-primary/8 to-brand-light/10 border border-primary/15 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">Grand Total Purchases</p>
              <p className="text-[11px] text-muted-foreground">Metal + diamond + certified · {materialReport.rows.length} purchase{materialReport.rows.length !== 1 ? "s" : ""}</p>
            </div>
            <p className="font-display text-3xl text-primary leading-none">{fmtMoneyInr(materialReport.grand)}</p>
          </div>

          {/* Breakdown tables — gold by purity, diamond by shape/quality */}
          {(materialReport.byPurity.length > 0 || materialReport.byShape.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {materialReport.byPurity.length > 0 && (
                <div className="rounded-xl border border-border/60 overflow-hidden">
                  <div className="px-3 py-2 bg-secondary/60 text-xs font-semibold text-brand-dark">Gold by purity</div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border/40">
                      {materialReport.byPurity.map(([k, v]) => (
                        <tr key={k}>
                          <td className="px-3 py-2 font-medium text-brand-dark">{k}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{v.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} g</td>
                          <td className="px-3 py-2 text-right font-semibold text-brand-dark">{fmtMoneyInr(v.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {materialReport.byShape.length > 0 && (
                <div className="rounded-xl border border-border/60 overflow-hidden">
                  <div className="px-3 py-2 bg-secondary/60 text-xs font-semibold text-brand-dark">Diamond by shape / quality</div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border/40">
                      {materialReport.byShape.map(([k, v]) => (
                        <tr key={k}>
                          <td className="px-3 py-2 font-medium text-brand-dark">{k}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{v.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ct</td>
                          <td className="px-3 py-2 text-right font-semibold text-brand-dark">{fmtMoneyInr(v.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Detail table */}
          {materialReport.rows.length > 0 ? (
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-border/60">
              <table className="table-luxe w-full text-xs sm:text-sm">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-border/60">
                    {["Date","Supplier","Category","Purpose","Detail","Qty","Rate","Total"].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {materialReport.rows.map(p => {
                    const c = purchaseCategory(p);
                    const qty = purchaseQty(p);
                    const unit = c === "gold" ? "g" : "ct";
                    const detail = c === "gold" ? (p.gold?.purity || "—") : (p.diamond?.shape || p.diamond?.quality || (c === "cert" ? "Certified" : "—"));
                    const label = c === "gold" ? "Gold" : c === "cert" ? "Cert. Dia" : "Diamond";
                    const supplier = (db.suppliers ?? []).find(s => s.id === p.supplierId);
                    return (
                      <tr key={p.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(p.invoiceDate || p.createdAt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{supplier?.name ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${c === "gold" ? "bg-amber-500/10 text-amber-700" : c === "cert" ? "bg-primary/10 text-primary" : "bg-blue-500/10 text-blue-700"}`}>{label}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 text-[11px] ${p.purpose === "stock" ? "text-muted-foreground" : "text-brand-dark"}`}>
                            {p.purpose === "stock" ? <Boxes className="h-3 w-3" /> : <ShoppingCart className="h-3 w-3" />}{p.purpose}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{detail}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">{qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} {unit}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{qty > 0 ? `${fmtMoneyInr(p.totalInr / qty)}/${unit}` : "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-semibold text-brand-dark">{fmtMoneyInr(p.totalInr)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Coins className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />
              No material purchases in this period.
            </div>
          )}
        </div>
      )}

      {/* ── Payments Made Report (admin / employee) ── */}
      {canSeeAll && paymentsReport && (
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-rose-500/10 grid place-items-center shrink-0"><DollarSign className="h-5 w-5 text-rose-600" /></div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Money Out</p>
                <h3 className="font-semibold text-brand-dark text-sm sm:text-base leading-tight">Payments Made Report</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Paid to suppliers &amp; factories · {payPeriodLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={exportPaymentsExcel} className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-border bg-white hover:bg-secondary transition-colors text-xs font-medium text-brand-dark"><Download className="h-3.5 w-3.5" /> Excel</button>
              <button onClick={exportPaymentsPdf} className="flex items-center gap-1.5 px-3 h-9 rounded-xl btn-hero text-xs font-medium"><Download className="h-3.5 w-3.5" /> PDF</button>
            </div>
          </div>

          <PeriodBar from={payFrom} to={payTo} setFrom={setPayFrom} setTo={setPayTo} />

          <div className="grid gap-3 grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Suppliers</p>
              <p className="font-display text-lg sm:text-xl text-brand-dark mt-1">{fmtMoneyInr(paymentsReport.supTotal)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Coins className="h-3.5 w-3.5" /> Factories</p>
              <p className="font-display text-lg sm:text-xl text-brand-dark mt-1">{fmtMoneyInr(paymentsReport.facTotal)}</p>
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-rose-500/8 to-rose-400/10 border border-rose-500/15 p-4">
              <p className="text-[11px] text-rose-700/80 font-semibold uppercase tracking-wider">Total paid</p>
              <p className="font-display text-lg sm:text-xl text-rose-600 mt-1">{fmtMoneyInr(paymentsReport.grand)}</p>
            </div>
          </div>

          {paymentsReport.rows.length > 0 ? (
            <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-xl border border-border/60">
              <table className="table-luxe w-full text-xs sm:text-sm">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-border/60">
                    {["Date","Party","Type","Reference","Amount"].map(h => <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {paymentsReport.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.party}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.kind === "Supplier" ? "bg-amber-500/10 text-amber-700" : "bg-orange-500/10 text-orange-700"}`}>{r.kind}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.ref}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold text-brand-dark">{fmtMoneyInr(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground"><DollarSign className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />No payments in this period.</div>
          )}
        </div>
      )}

      {/* ── Sales / Billing Report (admin / employee) ── */}
      {canSeeAll && salesReport && (
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-success/10 grid place-items-center shrink-0"><TrendingUp className="h-5 w-5 text-success" /></div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Money In</p>
                <h3 className="font-semibold text-brand-dark text-sm sm:text-base leading-tight">Sales / Billing Report</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Orders placed in period · {salesPeriodLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={exportSalesExcel} className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-border bg-white hover:bg-secondary transition-colors text-xs font-medium text-brand-dark"><Download className="h-3.5 w-3.5" /> Excel</button>
              <button onClick={exportSalesPdf} className="flex items-center gap-1.5 px-3 h-9 rounded-xl btn-hero text-xs font-medium"><Download className="h-3.5 w-3.5" /> PDF</button>
            </div>
          </div>

          <PeriodBar from={salesFrom} to={salesTo} setFrom={setSalesFrom} setTo={setSalesTo} />

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-[11px] text-muted-foreground">Orders</p>
              <p className="font-display text-xl text-brand-dark mt-1">{salesReport.orders.length}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
              <p className="text-[11px] text-muted-foreground">Billed</p>
              <p className="font-display text-xl text-brand-dark mt-1">{fmtMoney(salesReport.billed)}</p>
            </div>
            <div className="rounded-2xl border border-success/20 bg-success/5 p-4">
              <p className="text-[11px] text-muted-foreground">Received</p>
              <p className="font-display text-xl text-success mt-1">{fmtMoney(salesReport.received)}</p>
            </div>
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-[11px] text-muted-foreground">Outstanding</p>
              <p className="font-display text-xl text-destructive mt-1">{fmtMoney(salesReport.outstanding)}</p>
            </div>
            {salesReport.giftRedeemed > 0 && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-[11px] text-muted-foreground">Gift cards redeemed</p>
                <p className="font-display text-xl text-primary mt-1">{fmtMoney(salesReport.giftRedeemed)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">already deducted from Billed</p>
              </div>
            )}
          </div>

          {salesReport.byClient.length > 0 ? (
            <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-xl border border-border/60">
              <table className="table-luxe w-full text-xs sm:text-sm">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-border/60">
                    {["Client","Orders","Billed","Received","Outstanding"].map(h => <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {salesReport.byClient.map((c, i) => (
                    <tr key={i} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-2 font-medium text-brand-dark whitespace-nowrap">{c.name}</td>
                      <td className="px-3 py-2">{c.count}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold text-brand-dark">{fmtMoney(c.billed)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-success">{fmtMoney(c.received)}</td>
                      <td className={`px-3 py-2 whitespace-nowrap font-semibold ${c.outstanding > 0 ? "text-destructive" : "text-success"}`}>{c.outstanding > 0 ? fmtMoney(c.outstanding) : "✓"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground"><TrendingUp className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />No orders placed in this period.</div>
          )}
        </div>
      )}

      {/* ── Dispatch Speed Card ── */}
      <div className="card-luxe p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl bg-blue-500/10 grid place-items-center shrink-0">
            <Clock className="h-4.5 w-4.5 sm:h-5 sm:w-5 h-[18px] w-[18px] text-blue-600" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Dispatch Speed</p>
            <h3 className="font-semibold text-brand-dark text-sm sm:text-base leading-tight">Days from order to dispatch</h3>
          </div>
        </div>

        {speedRows.length === 0 ? (
          <div className="py-8 text-center">
            <Truck className="h-10 w-10 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No dispatched orders in this period</p>
          </div>
        ) : (
          <>
            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/40 border border-blue-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-lg bg-blue-500/15 grid place-items-center shrink-0">
                    <Truck className="h-4 w-4 text-blue-600" />
                  </div>
                  <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-blue-700/80">Dispatched</p>
                </div>
                <p className="font-display text-3xl sm:text-4xl text-brand-dark leading-none">{speedRows.length}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground mt-1.5">orders in this period</p>
              </div>
              <div className="rounded-2xl bg-gradient-to-br from-primary/8 to-brand-light/10 border border-primary/15 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-lg bg-primary/15 grid place-items-center shrink-0">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-primary/80">Avg Time</p>
                </div>
                <p className="font-display text-3xl sm:text-4xl text-primary leading-none">
                  {avgDays}<span className="text-base sm:text-lg text-muted-foreground font-sans font-normal ml-1">days</span>
                </p>
                <p className="text-[11px] sm:text-xs text-muted-foreground mt-1.5">from order to dispatch</p>
              </div>
            </div>

            {/* Speed bands */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: "Fast",   sub: "≤ 7 days",  count: fast,   color: "bg-success/10 border-success/30 text-success" },
                { label: "Normal", sub: "8–20 days",  count: normal, color: "bg-amber-50 border-amber-200 text-amber-700" },
                { label: "Slow",   sub: ">20 days",   count: slow,   color: "bg-rose-50 border-rose-200 text-rose-600" },
              ].map(b => (
                <div key={b.label} className={`rounded-xl border p-2.5 sm:p-3 text-center ${b.color}`}>
                  <p className="font-display text-xl sm:text-2xl">{b.count}</p>
                  <p className="text-[11px] sm:text-xs font-semibold mt-0.5">{b.label}</p>
                  <p className="text-[9px] sm:text-[10px] opacity-70">{b.sub}</p>
                </div>
              ))}
            </div>

            {/* Top slowest / fastest for admin */}
            {canSeeAll && speedRows.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Individual Order Breakdown</p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {[...speedRows].sort((a,b) => b.days - a.days).map(r => {
                    const c = clients.find(cl => cl.id === r.o.clientId);
                    return (
                      <div key={r.o.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-secondary/60 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-brand-dark">{r.o.orderNumber}</span>
                          <span className="text-muted-foreground text-xs ml-2">{c?.companyName}</span>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold
                          ${r.days <= 7 ? "bg-success/10 text-success" : r.days <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                          {r.days}d
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Orders by Production Stage (admin / employee) ── */}
      {canSeeAll && byStage.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Analytics</p>
            <h3 className="font-semibold text-brand-dark text-sm sm:text-base">Orders by Production Stage</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">How many orders are currently at each stage</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byStage} margin={{ left: -16, right: 4, top: 4, bottom: 30 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number, _: string, p: any) => [v, p.payload.fullName]}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }}
              />
              <Bar dataKey="count" name="Orders" fill="oklch(0.475 0.13 264)" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Client-wise breakdown (admin / employee) ── */}
      {canSeeAll && byClient.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Breakdown</p>
            <h3 className="font-semibold text-brand-dark text-sm sm:text-base">
              {clientFilter === "all" ? "Client-wise Summary" : `Orders — ${clients.find(c=>c.id===clientFilter)?.companyName}`}
            </h3>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2.5">
            {byClient.map(cl => (
              <div key={cl.id} className="rounded-xl bg-secondary/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-brand-dark text-sm truncate">{cl.name}</p>
                  <span className="text-xs text-muted-foreground shrink-0">{cl.total} order{cl.total !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium">{cl.dispatched} dispatched</span>
                  <span className="px-2 py-0.5 rounded-full bg-success/10 text-success text-[11px] font-medium">{cl.delivered} delivered</span>
                  {cl.avgDays !== null && (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium
                      ${cl.avgDays <= 7 ? "bg-success/10 text-success" : cl.avgDays <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                      {cl.avgDays}d avg
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{fmtMoney(cl.revenue)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-luxe w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  {["Client","Orders","Dispatched","Delivered","Revenue","Avg Dispatch"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-4 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {byClient.map(cl => (
                  <tr key={cl.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-brand-dark whitespace-nowrap">{cl.name}</td>
                    <td className="py-2.5 pr-4">{cl.total}</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">{cl.dispatched}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">{cl.delivered}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-brand-dark">{fmtMoney(cl.revenue)}</td>
                    <td className="py-2.5">
                      {cl.avgDays !== null
                        ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                            ${cl.avgDays <= 7 ? "bg-success/10 text-success" : cl.avgDays <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                            {cl.avgDays} days
                          </span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── All Orders table (admin / employee) ── */}
      {canSeeAll && filtered.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Detail</p>
              <h3 className="font-semibold text-brand-dark text-sm sm:text-base">All Orders ({filtered.length})</h3>
            </div>
            <button onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-border bg-white hover:bg-secondary transition-colors text-xs font-medium text-brand-dark shrink-0">
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="table-luxe w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-border/60">
                  {["Order #","Client","Type","Status","Qty","Order Value","Advance","Balance","Date"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-4 pt-1 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {[...filtered].sort((a,b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(o => {
                  const c = clients.find(cl => cl.id === o.clientId);
                  const bal = balanceDue(o);
                  return (
                    <tr key={o.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-brand-dark whitespace-nowrap">{o.orderNumber}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">{c?.companyName ?? "—"}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">{o.jewelleryType}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[o.status] ?? "bg-secondary text-foreground"}`}>{o.status}</span>
                      </td>
                      <td className="py-2.5 pr-4">{o.quantity}</td>
                      <td className="py-2.5 pr-4 font-semibold text-brand-dark whitespace-nowrap">{fmtMoney(o.amount)}</td>
                      <td className="py-2.5 pr-4 text-success whitespace-nowrap">{totalAdvance(o) > 0 ? fmtMoney(totalAdvance(o)) : "—"}</td>
                      <td className={`py-2.5 pr-4 font-semibold whitespace-nowrap ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "✓ Cleared"}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2 max-h-[28rem] overflow-y-auto">
            {[...filtered].sort((a,b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(o => {
              const c = clients.find(cl => cl.id === o.clientId);
              const bal = balanceDue(o);
              return (
                <div key={o.id} className="rounded-xl bg-secondary/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-semibold text-brand-dark truncate">{o.orderNumber}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${statusColors[o.status] ?? "bg-secondary text-foreground"}`}>{o.status}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{c?.companyName ?? "—"} · {o.jewelleryType} · {fmtDate(o.createdAt)}</p>
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="font-semibold text-brand-dark">{fmtMoney(o.amount)}</span>
                    <span className={`font-semibold ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? `Bal ${fmtMoney(bal)}` : "✓ Cleared"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Client-facing: status breakdown ── */}
      {isClient && (
        <>
          <div className="card-luxe p-4 sm:p-5">
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Overview</p>
              <h3 className="font-semibold text-brand-dark text-sm sm:text-base">Order Status Breakdown</h3>
            </div>
            <div className="space-y-2.5">
              {STATUS_LIST.map(s => {
                const cnt = filtered.filter(o => o.status === s).length;
                const pct = total > 0 ? (cnt / total) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-2 sm:gap-3">
                    <div className="w-24 sm:w-28 shrink-0">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[s]}`}>{s}</span>
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-5 text-right text-xs font-semibold text-brand-dark shrink-0">{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* My recent orders */}
          {filtered.length > 0 && (
            <div className="card-luxe p-4 sm:p-5">
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">History</p>
                <h3 className="font-semibold text-brand-dark text-sm sm:text-base">My Orders</h3>
              </div>
              <div className="space-y-2">
                {filtered.slice(0,20).map(o => {
                  const d = dispatchDays(o);
                  return (
                    <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-secondary/40">
                      <div className="min-w-0">
                        <p className="font-semibold text-brand-dark text-sm leading-tight">{o.orderNumber}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{o.jewelleryType} · {fmtDate(o.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[o.status] ?? "bg-secondary text-foreground"}`}>
                          {o.status}
                        </span>
                        {d !== null && (
                          <span className="text-[10px] text-muted-foreground">{d}d dispatch</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {total === 0 && (
        <div className="card-luxe p-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-brand-dark">No orders found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasFilters ? "Try adjusting the filters above." : "No data available yet."}
          </p>
        </div>
      )}

    </div>
  );
}
