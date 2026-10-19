import { companyOf } from "@/lib/companies";
import { metalLabel } from "@/lib/metals";
import { PeriodPicker } from "./ui";
import { StatusBadge } from "@/components/StatusBadge";
import { SectionTitle } from "@/components/SectionTitle";
import { DataTable, CellMain, CellTag, CellAmount, CellDate } from "@/components/DataTable";
import { purchaseQty as qtyOfPurchase, materialName, materialUnit, diamondSpec } from "@/lib/materials";
import { useState, useMemo, useEffect } from "react";
import { loadDb, fmtMoney, fmtDate, currentUserOrders, totalAdvance, balanceDue, orderTotal, TIMELINE_STEPS, logEvent, keptValue, findInvoiceForOrder } from "@/lib/db";
import type { Order, Purchase } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { filled, when, recorded, userName, refLink, linkList, noteText, refNo, lockerLabel, type Detail } from "@/components/rowDetails";
import { fmtMoneyInr, purchasePaid, purchasePending, materialLedger } from "@/lib/manufacturing";
import { downloadLedgerPdf } from "@/lib/ledgerExport";
import { profitReport, recognisedSale, saleDate, operatingExpenses, exchangeDifferenceTotal } from "@/lib/orderCost";
import { exportProfitCsv } from "@/lib/productExport";
import { useDbVersion } from "@/hooks/useDb";
import { exportAllowed } from "@/lib/access";
import { costDataReady } from "@/lib/db";
import { FreightBacklog } from "@/components/FreightBacklog";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Download, Package, Truck, CheckCircle2, DollarSign,
  Clock, TrendingUp, BarChart3,
  Coins, Gem, Award, Boxes, ShoppingCart, FileSpreadsheet, FileText, Factory, Gift,
} from "lucide-react";
import jsPDF from "jspdf";
import { toast } from "sonner";
import { IfExport } from "@/components/IfExport";
import { PageHeader } from "@/components/PageHeader";
import { ExportMenu, FilterChips, FiltersButton, StatStrip, type TableExport, type TableFilter } from "@/components/TableToolbar";
import { useMayExport } from "@/hooks/useCan";

/* Local YYYY-MM-DD key (matches how the rest of the app displays dates) so a
   purchase near midnight IST lands on the calendar day staff expect. */
function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Which report bucket a purchase belongs to. Diamonds without an explicit
 *  kind are treated as loose (matches the DiamondPurchaseDetail contract). */
function purchaseCategory(p: Purchase): "gold" | "diamond" | "cert" | "other" {
  if (p.material === "gold") return "gold";
  if (p.material !== "diamond") return "other"; // platinum, gemstones, findings — Settings → Materials
  return p.diamond?.kind === "certified" ? "cert" : "diamond";
}
function purchaseQty(p: Purchase): number {
  return qtyOfPurchase(p);
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

function periodLabel(from: string, to: string): string {
  return from || to ? `${from || "start"} → ${to || "today"}` : "All time";
}

const xlsx = (onSelect: () => void): TableExport => ({ label: "Excel", icon: FileSpreadsheet, hint: "Opens in Excel or Google Sheets", onSelect });
const pdf = (onSelect: () => void): TableExport => ({ label: "PDF", icon: FileText, hint: "Ready to print or send", onSelect });

/**
 * A report's own controls, beside its title: its period (each report can be
 * narrowed on its own — Purchases for January, Sales for March), on the same
 * picker as the page's, and its downloads in one Export menu.
 */
function SectionTools({ what, from, to, setFrom, setTo, exports }: {
  what: string; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; exports: TableExport[];
}) {
  const mayExport = useMayExport();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <PeriodPicker allTime value={{ from, to }} onChange={p => { setFrom(p.from); setTo(p.to); }} />
      {mayExport && <ExportMenu exports={exports} scope={what} />}
    </div>
  );
}

/** The report sections, each of which the Reports page can show on its own tab. */
export type SectionKey = "purchases" | "payments" | "sales" | "profit" | "speed" | "stages" | "clients" | "orders";

export interface ReportSectionsProps {
  /** Shown inside the Reports page's tabs: no header, filters or summary of its own. */
  embedded?: boolean;
  /** Which sections to show; all when not given. */
  show?: SectionKey[];
  /** The Reports page's date range — every section follows it (each can still be narrowed). */
  period?: { from: string; to: string };
  /** The Reports page's client filter. */
  clientId?: string;
  /** Narrows every order-based section further — the Reports page's employee filter. */
  scope?: (o: Order) => boolean;
  /** Changes when `scope` does, so the sections recompute. */
  scopeKey?: string;
  /** One of our companies: its purchases and stock ledgers. */
  companyId?: string;
}

/* ─────────────────────────────────────────────────────────────── */
export function ReportSections({ embedded = false, show, period, clientId, scope, scopeKey = "", companyId }: ReportSectionsProps = {}) {
  const vis = (k: SectionKey) => !show || show.includes(k);
  const { user } = useAuth();
  const isClient   = user?.role === "client";
  const isAdmin    = user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const canSeeAll  = isAdmin || isEmployee;

  const db        = loadDb();
  // Changes whenever the data does — the P&L is keyed on it, since the
  // store's lists are edited in place and would never trip a memo by themselves.
  const dbVersion = useDbVersion();
  // What this person may report on — for an employee, their own orders —
  // narrowed by the page's employee filter when one is set.
  const myOrders  = currentUserOrders(db, user!).filter(o => !scope || scope(o));
  const clients   = db.clients;

  /* ── filters (admin / employee) ── */
  const [clientFilter, setClientFilter] = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");

  const clearFilters = () => {
    setClientFilter("all"); setDateFrom(""); setDateTo("");
  };
  const hasFilters = clientFilter !== "all" || !!dateFrom || !!dateTo;
  const pageFilters: TableFilter[] = [
    { kind: "select", label: "Client", value: clientFilter === "all" ? "" : clientFilter, onChange: v => setClientFilter(v || "all"),
      allLabel: "All Clients", options: clients.map(c => ({ value: c.id, label: c.companyName })) },
    { kind: "date", from: dateFrom, to: dateTo, onChange: (f, t) => { setDateFrom(f); setDateTo(t); } },
  ];
  const mayExport = useMayExport();

  /* ── Financial reports — each has its OWN date range so staff can generate
     them separately (e.g. Purchases for Jan, Sales for Mar) ── */
  const [matFrom, setMatFrom]     = useState("");
  const [matTo,   setMatTo]       = useState("");
  const [payFrom, setPayFrom]     = useState("");
  const [payTo,   setPayTo]       = useState("");
  const [salesFrom, setSalesFrom] = useState("");
  const [salesTo,   setSalesTo]   = useState("");
  const [profitFrom, setProfitFrom] = useState("");
  const [profitTo,   setProfitTo]   = useState("");
  const [profitBy,   setProfitBy]   = useState<"client" | "month" | "type">("client");
  // Inside the Reports page, every section starts from the page's range and
  // client, and follows them when they change.
  const pFrom = period?.from ?? "", pTo = period?.to ?? "";
  useEffect(() => {
    if (!embedded) return;
    setMatFrom(pFrom); setMatTo(pTo); setPayFrom(pFrom); setPayTo(pTo);
    setSalesFrom(pFrom); setSalesTo(pTo); setProfitFrom(pFrom); setProfitTo(pTo);
    setDateFrom(pFrom); setDateTo(pTo);
  }, [embedded, pFrom, pTo]);
  useEffect(() => { if (embedded) setClientFilter(clientId || "all"); }, [embedded, clientId]);
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
    const rows = (db.purchases ?? []).filter(p => inRange(p.invoiceDate || p.createdAt) && (!companyId || companyOf(p) === companyId));
    const mk = () => ({ qty: 0, amount: 0, count: 0, stockQty: 0, stockAmt: 0, orderQty: 0, orderAmt: 0 });
    const g = mk(), dl = mk(), dc = mk(), ot = mk();
    const byPurity = new Map<string, { qty: number; amount: number }>();
    const byShape  = new Map<string, { qty: number; amount: number }>();
    for (const p of rows) {
      const c = purchaseCategory(p);
      const bucket = c === "gold" ? g : c === "cert" ? dc : c === "other" ? ot : dl;
      const qty = purchaseQty(p);
      bucket.qty += qty; bucket.amount += p.totalInr; bucket.count++;
      if (p.purpose === "stock") { bucket.stockQty += qty; bucket.stockAmt += p.totalInr; }
      else { bucket.orderQty += qty; bucket.orderAmt += p.totalInr; }
      if (c === "gold") {
        const key = p.gold?.purity || "—";
        const e = byPurity.get(key) || { qty: 0, amount: 0 }; e.qty += qty; e.amount += p.totalInr; byPurity.set(key, e);
      } else if (c === "other") {
        const key = `${materialName(db.settings, p.material)}${p.other?.grade && p.other.grade !== "—" ? ` · ${p.other.grade}` : ""}`;
        const e = byShape.get(key) || { qty: 0, amount: 0 }; e.qty += qty; e.amount += p.totalInr; byShape.set(key, e);
      } else {
        const key = p.diamond?.shape || p.diamond?.quality || (c === "cert" ? "Certified" : "—");
        const e = byShape.get(key) || { qty: 0, amount: 0 }; e.qty += qty; e.amount += p.totalInr; byShape.set(key, e);
      }
    }
    const grand = g.amount + dl.amount + dc.amount + ot.amount;
    return {
      rows: [...rows].sort((a, b) => +new Date(b.invoiceDate || b.createdAt) - +new Date(a.invoiceDate || a.createdAt)),
      g, dl, dc, ot, grand,
      byPurity: [...byPurity.entries()].sort((a, b) => b[1].amount - a[1].amount),
      byShape:  [...byShape.entries()].sort((a, b) => b[1].amount - a[1].amount),
    };
  }, [db.purchases, matFrom, matTo, canSeeAll, companyId]);

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
      doc.text(`Period: ${matPeriodLabel}    Generated: ${new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}`, 20, 30);
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
        const c = purchaseCategory(p); const qty = purchaseQty(p); const unit = materialUnit(db.settings, p.material);
        const label = c === "gold" ? "Gold" : c === "cert" ? "Cert.Dia" : c === "other" ? materialName(db.settings, p.material).slice(0, 10) : "Diamond";
        running += p.totalInr;
        const cells = [fmtDate(p.invoiceDate || p.createdAt), (suppliers.find(s => s.id === p.supplierId)?.name ?? "").slice(0, 20), label, `${qty}${unit}`, qty > 0 ? plain(p.totalInr / qty) : "-", plain(p.totalInr), plain(running)];
        cells.forEach((cval, i) => doc.text(cval, cols[i][2] ? colR(i) : cols[i][1], y, cols[i][2] ? { align: "right" } : undefined));
        y += 5; if (y > 285) { doc.addPage(); y = 20; }
      }
      doc.setFont("helvetica", "bold"); doc.text(`Grand Total: ${money(r.grand)}`, 152, y + 3);
      if (!exportAllowed()) return;
      logEvent("export", `Downloaded ${`Starlink-Material-Purchase-${matFrom || "all"}.pdf`}`);
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
      const catLabel = { gold: "Metal (Gold)", diamond: "Diamond (Loose)", cert: "Certified Diamond", other: "Other material" };
      let running = 0;
      const rows = [...materialReport.rows]
        .sort((a, b) => +new Date(a.invoiceDate || a.createdAt) - +new Date(b.invoiceDate || b.createdAt))
        .map(p => {
          const c = purchaseCategory(p);
          const qty = purchaseQty(p);
          const unit = materialUnit(db.settings, p.material);
          const detail = c === "gold" ? (p.gold?.purity || "") : c === "other" ? `${materialName(db.settings, p.material)} ${p.other?.grade ?? ""}`.trim() : (diamondSpec(p.diamond, (db.diamondPackets ?? []).find(x => x.purchaseId === p.id)) || (c === "cert" ? "Certified" : ""));
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
      if (!exportAllowed()) return;
      logEvent("export", `Downloaded ${`Starlink-Material-Purchase-${matFrom || "all"}.csv`}`);
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
    if (!exportAllowed()) return;
    logEvent("export", `Downloaded ${name}`);
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* ── Payments made (money out) — supplier + factory payments in the period ── */
  const paymentsReport = useMemo(() => {
    if (!canSeeAll) return null;
    const inRange = makeInRange(payFrom, payTo);
    const suppliers = db.suppliers ?? [];
    const factories = db.factories ?? [];
    // id: the payment's own, under the record it was made on — the table's row key.
    // payId…orderId: for the row opened — the account, note and who recorded it, and what it paid for.
    type Row = { id: string; date: string; party: string; kind: "Supplier" | "Factory"; ref: string; amount: number;
      payId?: string; lockerId?: string; note?: string; by?: string; partyId?: string; orderId?: string; material?: Purchase["material"] };
    const rows: Row[] = [];
    for (const p of db.purchases ?? [])
      (p.payments ?? []).forEach((pay, n) => {
        if (inRange(pay.createdAt))
          rows.push({ id: `p:${p.id}:${pay.id ?? n}`, date: pay.createdAt, party: suppliers.find(s => s.id === p.supplierId)?.name ?? "Supplier", kind: "Supplier", ref: p.invoiceNumber || "—", amount: pay.amountInr,
            payId: pay.id, lockerId: pay.lockerId, note: pay.note, by: pay.recordedBy, partyId: p.supplierId, orderId: p.orderId, material: p.material });
      });
    for (const i of db.materialIssuances ?? [])
      (i.makingCharges?.payments ?? []).forEach((pay, n) => {
        if (inRange(pay.createdAt))
          rows.push({ id: `f:${i.id}:${pay.id ?? n}`, date: pay.createdAt, party: factories.find(f => f.id === i.factoryId)?.name ?? "Factory", kind: "Factory", ref: "Making charges", amount: pay.amountInr,
            payId: pay.id, lockerId: pay.lockerId, note: pay.note, by: pay.recordedBy, partyId: i.factoryId, orderId: i.orderId });
      });
    const supTotal = rows.filter(r => r.kind === "Supplier").reduce((s, r) => s + r.amount, 0);
    const facTotal = rows.filter(r => r.kind === "Factory").reduce((s, r) => s + r.amount, 0);
    rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
    return { rows, supTotal, facTotal, grand: supTotal + facTotal };
  }, [db.purchases, db.materialIssuances, db.suppliers, db.factories, payFrom, payTo, canSeeAll]);

  /* ── Sales / client billing — orders placed in the period ── */
  const salesReport = useMemo(() => {
    if (!canSeeAll) return null;
    const inRange = makeInRange(salesFrom, salesTo);
    const orders = myOrders.filter(o => o.status !== "Rejected" && inRange(o.createdAt));
    const billed = orders.reduce((s, o) => s + orderTotal(o), 0);
    const received = orders.reduce((s, o) => s + totalAdvance(o), 0);
    const outstanding = orders.reduce((s, o) => s + balanceDue(o), 0);
    const giftRedeemed = orders.reduce((s, o) => s + (o.giftCardRedeemed || 0), 0);
    const map = new Map<string, { id: string; name: string; count: number; billed: number; received: number; outstanding: number }>();
    for (const o of orders) {
      const name = clients.find(c => c.id === o.clientId)?.companyName ?? "Unknown";
      const e = map.get(o.clientId) ?? { id: o.clientId, name, count: 0, billed: 0, received: 0, outstanding: 0 };
      e.count++; e.billed += orderTotal(o); e.received += totalAdvance(o); e.outstanding += balanceDue(o);
      map.set(o.clientId, e);
    }
    return {
      orders: [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      billed, received, outstanding, giftRedeemed,
      byClient: [...map.values()].sort((a, b) => b.billed - a.billed),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbVersion, scopeKey, clients, salesFrom, salesTo, canSeeAll]);

  /* ── Profit & Loss — ADMIN ONLY.
     Revenue is recognised when the goods leave: an order belongs to the period
     it was DISPATCHED in, and only shipped work counts, since a finished piece
     still on the bench has not been sold. Each sale is converted at the rate on
     its own sale day. Running costs for the same period come off the gross to
     give what the business actually made. ── */
  const profit = useMemo(() => {
    if (!isAdmin) return null;
    const inRange = makeInRange(profitFrom, profitTo);
    const gross = profitReport(db, myOrders.filter(o => recognisedSale(o) && inRange(saleDate(o))));
    const opex = operatingExpenses(db, inRange);
    // What turning the dollars into rupees gained or lost against the rate
    // each sale was booked at. Not anybody's margin on a piece, so it sits
    // between gross profit and the running costs.
    const fx = exchangeDifferenceTotal(db, gross.rows.map(r => r.order));
    const netUsd = gross.totals.profitUsd !== null && opex.totalUsd !== null && fx.usd !== null
      ? Math.round((gross.totals.profitUsd + fx.usd - opex.totalUsd) * 100) / 100
      : null;
    const netMargin = netUsd !== null && gross.totals.sellingUsd > 0
      ? Math.round((netUsd / gross.totals.sellingUsd) * 1000) / 10
      : null;
    return { ...gross, opex, fx, netUsd, netMargin };
  // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbVersion, scopeKey, profitFrom, profitTo, isAdmin]);
  const profitPeriodLabel = periodLabel(profitFrom, profitTo);
  const monthLabel = (k: string) => {
    const [y, m] = k.split("-").map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep");
  };

  /* ── Payments report exports ── */
  function exportPaymentsPdf() {
    if (!paymentsReport) return;
    try {
      const r = paymentsReport;
      const doc = new jsPDF();
      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("Starlink Jewels — Payments Made Report", 20, 22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`Period: ${payPeriodLabel}    Generated: ${new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}`, 20, 30);
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
      if (!exportAllowed()) return;
      logEvent("export", `Downloaded ${`Starlink-Payments-${payFrom || "all"}.pdf`}`);
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
      doc.text(`Period: ${salesPeriodLabel}    Generated: ${new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}`, 20, 30);
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
      if (!exportAllowed()) return;
      logEvent("export", `Downloaded ${`Starlink-Sales-${salesFrom || "all"}.pdf`}`);
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
  type MatCat = "gold" | "diamond" | "cert" | "other";
  const CAT_META: Record<MatCat, { label: string; unit: string; detail: string }> = {
    gold:    { label: "Gold",             unit: "g",  detail: "Purity" },
    diamond: { label: "Loose Diamond",    unit: "ct", detail: "Shape" },
    cert:    { label: "Certified Diamond", unit: "ct", detail: "Shape/Cert" },
    // Each in its own unit, so the unit goes on every line instead.
    other:   { label: "Other Materials",  unit: "",   detail: "Material / Grade" },
  };
  const catDetail = (p: Purchase, cat: MatCat) =>
    cat === "gold" ? (p.gold?.purity || "")
    : cat === "other" ? `${materialName(db.settings, p.material)} ${p.other?.grade ?? ""}`.trim()
    : (diamondSpec(p.diamond, (db.diamondPackets ?? []).find(x => x.purchaseId === p.id)) || (cat === "cert" ? "Certified" : ""));
  // Oldest-first for a running-balance ledger.
  const catRows = (cat: MatCat) => (materialReport?.rows ?? [])
    .filter(p => purchaseCategory(p) === cat)
    .sort((a, b) => +new Date(a.invoiceDate || a.createdAt) - +new Date(b.invoiceDate || b.createdAt));
  const catBucket = (cat: MatCat) => cat === "gold" ? materialReport!.g : cat === "cert" ? materialReport!.dc : cat === "other" ? materialReport!.ot : materialReport!.dl;

  // Full stock-movement ledger (purchases IN + factory issues / order use / sales
  // OUT + returns) with running balance, for Gold & Loose Diamond — the "proper
  // ledger" the Stock page shows, filtered to the report's date range.
  const movementLedger = (material: "gold" | "diamond") => {
    const all = materialLedger(db.stockMovements ?? [], material, {
      purchases: db.purchases ?? [], issuances: db.materialIssuances ?? [], orders: db.orders ?? [],
      factories: db.factories ?? [], suppliers: db.suppliers ?? [], diamondSales: db.diamondSales ?? [], clients: db.clients ?? [],
    }, companyId);
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
          ["Date", "Invoice #", "Particulars", m.detail, `In (${m.unit})`, `Out (${m.unit})`, `Balance (${m.unit})`, "Rate (Rs)", "Amount (Rs)"],
          led.map(r => [
            fmtDate(r.createdAt), r.invoiceNumber || "", r.link.label, r.purityOrQuality,
            r.inQty || "", r.outQty || "", r.balance,
            r.rateInr ? Math.round(r.rateInr) : "", r.amountInr ? Math.round(r.amountInr) : "",
          ]),
        );
        return;
      }
      if (cat === "other") {
        let run = 0;
        const sup = db.suppliers ?? [];
        csvDownload(
          `Starlink-Other-Materials-Ledger-${matFrom || "all"}.csv`,
          ["Date", "Invoice #", "Supplier", "Purpose", "Order #", "Material", "Grade", "Quantity", "Unit", "Rate (Rs)", "Amount (INR)", "Paid (INR)", "Pending (INR)", "Running Total (INR)", "Notes"],
          catRows("other").map(p => {
            run += p.totalInr;
            const q = purchaseQty(p);
            return [fmtDate(p.invoiceDate || p.createdAt), p.invoiceNumber ?? "", sup.find(x => x.id === p.supplierId)?.name ?? "", p.purpose,
              p.orderId ? (db.orders.find(o => o.id === p.orderId)?.orderNumber ?? "") : "",
              materialName(db.settings, p.material), p.other?.grade ?? "", q, materialUnit(db.settings, p.material),
              q > 0 ? Math.round(p.totalInr / q) : "", Math.round(p.totalInr), Math.round(purchasePaid(p)), Math.round(purchasePending(p)), Math.round(run), p.notes ?? ""];
          }),
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

      // catRows is oldest-first because the PDF above runs a balance down it;
      // on screen the newest purchase belongs at the top.
      const rows = [...catRows(cat)].reverse(); const suppliers = db.suppliers ?? [];
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
        const cert = cat === "other" ? (p.other?.grade || "—") : (p.diamond?.certificateNumber || pk?.certificateNumber || "—");
        return [
          fmtDate(p.invoiceDate || p.createdAt),
          (suppliers.find(s => s.id === p.supplierId)?.name ?? "").slice(0, 26),
          String(ref).slice(0, 16),
          cat === "other" ? materialName(db.settings, p.material).slice(0, 18) : String(p.diamond?.shape || pk?.shape || "—"),
          String(cert).slice(0, 24),
          `${qty}${cat === "other" ? ` ${materialUnit(db.settings, p.material)}` : m.unit}`,
          qty > 0 ? rs(p.totalInr / qty) : "—",
          rs(p.totalInr),
        ];
      });
      downloadLedgerPdf({
        title: `${m.label} — Purchase Ledger`,
        subjectLines: [`Period: ${matPeriodLabel}`, "Rate & Amount in Rs (INR)"],
        summary: [
          ...(cat === "other" ? [] : [
            { label: "Total quantity", value: `${b.qty.toLocaleString()} ${m.unit}` },
            { label: "Average rate", value: `${rupees(avg)} / ${m.unit}` },
          ]),
          { label: "Total value", value: rupees(b.amount) },
          { label: "Purchases", value: `${b.count}  (stock ${rupees(b.stockAmt)} · order ${rupees(b.orderAmt)})` },
        ],
        landscape: true,
        columns: [
          { header: "Date", x: 14 },
          { header: "Supplier", x: 42 },
          { header: "Inv / Order", x: 96 },
          { header: cat === "other" ? "Material" : "Shape", x: 132 },
          { header: cat === "other" ? "Grade" : "Certificate", x: 158 },
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
  const revenue    = delivered.reduce((s, o) => s + keptValue(o), 0);

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
      if (o.status === "Delivered") { prev.delivered++; prev.revenue += keptValue(o); }
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
  /* ── Opened rows: what each table's columns leave out ── */
  const mayOpen = (m: ModuleKey) => can(user, db.roles ?? [], m, "view");
  const orderLink = (o: Order) => refLink(`/orders/${o.id}`, o.orderNumber, mayOpen("orders"));
  const stageOf = (o: Order) => o.timeline.find(t => t.status === "in_progress") ?? [...o.timeline].reverse().find(t => t.status === "done");

  const purchaseDetails = (p: Purchase): Detail[] => {
    const order = p.orderId ? db.orders.find(o => o.id === p.orderId) : undefined;
    const pending = purchasePending(p);
    return filled([
      { label: "Paid", value: fmtMoneyInr(purchasePaid(p)) },
      pending > 0 && { label: "Pending", value: <span className="font-semibold text-destructive">{fmtMoneyInr(pending)}</span> },
      !!order && { label: "For order", value: orderLink(order) },
      p.currency === "USD" && !!p.totalUsd && { label: "Billed in dollars", value: `${fmtMoney(p.totalUsd)}${p.exchangeRate ? ` at ₹${p.exchangeRate} to the $` : ""}` },
      !!(p.diamond?.pieces || p.other?.pieces) && { label: "Stones", value: String(p.diamond?.pieces || p.other?.pieces) },
      // The whole lot or stone: shape · size · colour · clarity · pcs, or its report.
      p.material === "diamond" && { label: "Diamond", value: diamondSpec(p.diamond, (db.diamondPackets ?? []).find(x => x.purchaseId === p.id)) || undefined },
      !!p.diamond?.certificateNumber && { label: "Certificate", value: [p.diamond.certificateLab, p.diamond.certificateNumber].filter(Boolean).join(" ") },
      !!p.discountPct && { label: p.discountPct > 0 ? "Discount" : "Charge added", value: `${Math.abs(p.discountPct)}%` },
      !!p.roundOffInr && { label: "Rounded off", value: fmtMoneyInr(p.roundOffInr) },
      { label: "Notes", value: noteText(p.notes) },
      { label: "Recorded", value: recorded(db, p.createdAt, p.createdBy) },
    ]);
  };

  type PaymentRow = NonNullable<typeof paymentsReport>["rows"][number];
  const paymentDetails = (r: PaymentRow): Detail[] => {
    const txn = r.payId ? (db.lockerTransactions ?? []).find(t => t.paymentId === r.payId) : undefined;
    const order = r.orderId ? db.orders.find(o => o.id === r.orderId) : undefined;
    const partyPage = r.kind === "Supplier" ? "suppliers" : "factories";
    return filled([
      !!r.partyId && { label: r.kind, value: refLink(`/${partyPage}/${r.partyId}`, r.party, mayOpen(partyPage)) },
      { label: "Account", value: lockerLabel(db, r.lockerId) },
      { label: "Voucher", value: refNo(txn?.voucherNo) },
      { label: "For", value: r.material ? materialName(db.settings, r.material) : undefined },
      !!order && { label: "Order", value: orderLink(order) },
      { label: "Note", value: noteText(r.note) },
      { label: "Recorded", value: recorded(db, r.date, r.by) },
    ]);
  };

  type SalesClientRow = NonNullable<typeof salesReport>["byClient"][number];
  const salesClientDetails = (c: SalesClientRow): Detail[] => {
    const placed = (salesReport?.orders ?? []).filter(o => o.clientId === c.id);
    const gift = placed.reduce((s, o) => s + (o.giftCardRedeemed || 0), 0);
    return filled([
      placed.length > 0 && { label: "Orders placed", value: linkList(placed.map(o => ({ key: o.id, node: orderLink(o) }))) },
      gift > 0 && { label: "Gift cards used", value: fmtMoney(gift) },
    ]);
  };

  // The orders behind one profit line, worked out the way profitReport groups them.
  const profitGroupDetails = (g: { key: string; costUsd: number | null; costInr: number; incomplete: number }): Detail[] => {
    if (!profit) return [];
    const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
    const keyOf = (o: Order) => profitBy === "client" ? (clients.find(c => c.id === o.clientId)?.companyName ?? "Unknown")
      : profitBy === "month" ? monthKey(saleDate(o)) : o.jewelleryType;
    const unknown = g.incomplete ? profit.rows.filter(r => !r.complete && keyOf(r.order) === g.key) : [];
    return filled([
      // The Cost column reads in dollars once every order converted; the rupees behind it.
      g.costUsd !== null && { label: "Cost in rupees", value: fmtMoneyInr(g.costInr) },
      unknown.length > 0 && { label: "Cost not fully known on", value: linkList(unknown.map(r => ({ key: r.order.id, node: orderLink(r.order) }))) },
    ]);
  };

  type SummaryRow = (typeof byClient)[number];
  const clientSummaryDetails = (cl: SummaryRow): Detail[] => {
    const theirs = filtered.filter(o => o.clientId === cl.id);
    const client = clients.find(c => c.id === cl.id);
    const open = theirs.filter(o => !["Dispatched", "Delivered", "Rejected"].includes(o.status)).length;
    const owed = theirs.filter(o => o.status !== "Rejected").reduce((s, o) => s + balanceDue(o), 0);
    const latest = theirs.reduce<Order | undefined>((m, o) => (!m || o.createdAt > m.createdAt ? o : m), undefined);
    return filled([
      !!client && { label: "Account", value: refLink(`/clients/${client.id}`, client.companyName, mayOpen("clients")) },
      open > 0 && { label: "In progress", value: String(open) },
      { label: "Outstanding", value: owed > 0 ? <span className="font-semibold text-destructive">{fmtMoney(owed)}</span> : "Cleared" },
      !!latest && { label: "Latest order", value: <>{orderLink(latest)} · {fmtDate(latest.createdAt)} · {latest.status}</> },
    ]);
  };

  const reportOrderDetails = (o: Order): Detail[] => {
    const st = stageOf(o);
    const inv = findInvoiceForOrder(db.invoices ?? [], o.id);
    const total = orderTotal(o);
    return filled([
      { label: "Order", value: orderLink(o) },
      !!st && { label: "Stage", value: [st.step, st.date && when(st.date)].filter(Boolean).join(" · ") },
      { label: "Placed", value: when(o.createdAt) },
      { label: "Due", value: o.expectedDelivery && fmtDate(o.expectedDelivery) },
      o.priority !== "Normal" && { label: "Priority", value: o.priority },
      { label: "Piece", value: [o.productKarats, o.diamondWeight > 0 && o.diamondType, o.productSize && `size ${o.productSize}`].filter(Boolean).join(" · ") },
      { label: "Assigned to", value: userName(db, o.assignedEmployeeId) },
      !!inv && { label: "Invoice", value: refLink(`/invoices?q=${encodeURIComponent(inv.number)}`, inv.number, mayOpen("invoices")) },
      total > 0 && Math.abs(total - (o.amount || 0)) > 0.005 && { label: "Order total", value: fmtMoney(total) },
      !!o.courierName && { label: "Courier", value: (
        <>{o.courierName}{o.trackingNumber ? <> · {refNo(o.trackingNumber)}</> : null}{o.trackingLink ? <> · <a href={o.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Track</a></> : null}</>
      ) },
      !!o.dispatchedAt && { label: "Dispatched", value: fmtDate(o.dispatchedAt) },
    ]);
  };

  /* ── PDF export ── */
  function exportPdf() {
   try {
    const doc = new jsPDF();
    doc.setFont("helvetica","bold"); doc.setFontSize(18);
    doc.text("Starlink Jewels — Business Report", 20, 22);
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}`, 20, 30);
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
    if (!exportAllowed()) return;
    logEvent("export", `Downloaded ${"Starlink-Report.pdf"}`);
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
    if (!exportAllowed()) return;
    logEvent("export", `Downloaded ${`Starlink-Orders-${new Date().toISOString().slice(0, 10)}.csv`}`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
   } catch { toast.error("Couldn't generate the Excel file."); }
  }

  /* ── render ── */
  return (
    <div className={embedded ? "space-y-4" : "max-w-7xl mx-auto space-y-4"}>

      {/* Header */}
      {!embedded && (
        <PageHeader
          title={isClient ? "My Reports" : "Reports"}
          subtitle={isClient
            ? "Overview of your orders and delivery performance"
            : `${total} order${total !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : " · all time"}`}
          primary={mayExport ? { label: "Download PDF", icon: Download, onClick: exportPdf } : null}
          secondary={mayExport ? { label: "Export Excel", icon: FileSpreadsheet, onClick: exportExcel } : null}
        />
      )}

      {/* ── Filters (admin / employee) — one Filters button, what is on as chips ── */}
      {!embedded && canSeeAll && (
        <div className="flex flex-wrap items-center gap-2">
          <FiltersButton filters={pageFilters} onClear={clearFilters} count={`${total} order${total !== 1 ? "s" : ""}`} />
          <FilterChips filters={pageFilters} onClear={clearFilters} />
        </div>
      )}

      {/* ── Summary cards ── */}
      {!embedded && (
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
      )}

      {/* ── Material Purchase Report (admin / employee) ── */}
      {vis("purchases") && canSeeAll && materialReport && (
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          {/* Header + export */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <SectionTitle icon={Coins} title="Material Purchase Report"
              info="Gold, loose and certified diamonds and other materials — bought for stock and for orders." />
            <SectionTools what={`Material purchases · ${matPeriodLabel}`} from={matFrom} to={matTo} setFrom={setMatFrom} setTo={setMatTo}
              exports={[xlsx(exportMaterialExcel), pdf(exportMaterialPdf)]} />
          </div>

          {/* Category cards */}
          <div className={`grid gap-3 sm:grid-cols-2 ${materialReport.ot.count ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {([
              { label: "Metal (Gold)", cat: "gold" as MatCat, unit: "g", icon: Coins, ring: "bg-amber-500/10 text-amber-600", b: materialReport.g },
              { label: "Diamond (Loose)", cat: "diamond" as MatCat, unit: "ct", icon: Gem, ring: "bg-blue-500/10 text-blue-600", b: materialReport.dl },
              { label: "Certified Diamond", cat: "cert" as MatCat, unit: "ct", icon: Award, ring: "bg-primary/10 text-primary", b: materialReport.dc },
              ...(materialReport.ot.count ? [{ label: "Other Materials", cat: "other" as MatCat, unit: "", icon: Boxes, ring: "bg-emerald-500/10 text-emerald-600", b: materialReport.ot }] : []),
            ]).map(c => {
              const avg = c.b.qty > 0 && c.unit ? c.b.amount / c.b.qty : 0;
              return (
                <div key={c.label} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${c.ring}`}><c.icon className="h-4 w-4" /></div>
                    <p className="text-xs font-semibold text-brand-dark">{c.label}</p>
                  </div>
                  {c.unit
                    ? <p className="font-display text-2xl text-brand-dark leading-none">{c.b.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}<span className="text-sm text-muted-foreground font-sans ml-1">{c.unit}</span></p>
                    : <p className="font-display text-2xl text-brand-dark leading-none">{c.b.count}<span className="text-sm text-muted-foreground font-sans ml-1">bill line{c.b.count !== 1 ? "s" : ""}</span></p>}
                  <p className="text-xs text-muted-foreground mt-1">{c.b.count} purchase{c.b.count !== 1 ? "s" : ""}{c.unit ? ` · avg ${c.b.qty > 0 ? `${fmtMoneyInr(avg)}/${c.unit}` : "—"}` : " · each in its own unit"}</p>
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-lg font-semibold text-brand-dark">{fmtMoneyInr(c.b.amount)}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Boxes className="h-3 w-3" /> Stock {fmtMoneyInr(c.b.stockAmt)}</span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><ShoppingCart className="h-3 w-3" /> Order {fmtMoneyInr(c.b.orderAmt)}</span>
                    </div>
                  </div>
                  {/* Separate full-ledger download for THIS material only */}
                  <IfExport>
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
                  </IfExport>
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
          {materialReport.rows.length > 0 ? (() => {
            const supplierName = (p: Purchase) => (db.suppliers ?? []).find(s => s.id === p.supplierId)?.name ?? "";
            const labelOf = (p: Purchase) => { const c = purchaseCategory(p); return c === "gold" ? "Gold" : c === "cert" ? "Cert. Dia" : c === "other" ? materialName(db.settings, p.material) : "Diamond"; };
            const detailOf = (p: Purchase) => { const c = purchaseCategory(p); return c === "gold" ? (p.gold?.purity || "—") : c === "other" ? (p.other?.grade || "—") : (diamondSpec(p.diamond, (db.diamondPackets ?? []).find(x => x.purchaseId === p.id)) || (c === "cert" ? "Certified" : "—")); };
            const dateOf = (p: Purchase) => p.invoiceDate || p.createdAt;
            const TONE = { gold: "amber", cert: "blue", other: "green", diamond: "violet" } as const;
            return (
              <DataTable
                id="reports-material-purchases"
                noun="purchase"
                rows={materialReport.rows}
                rowKey={p => p.id}
                details={purchaseDetails}
                maxHeight="24rem"
                defaultSort={{ key: "date", dir: "desc" }}
                searchText={p => [supplierName(p), labelOf(p), detailOf(p), p.purpose, p.invoiceNumber ?? ""].join(" ")}
                searchPlaceholder="Search supplier, material, bill"
                columns={[
                  { key: "supplier", header: "Supplier", always: true, sortValue: supplierName, cell: p => <CellMain title={supplierName(p) || "—"} sub={p.invoiceNumber ? `Bill ${p.invoiceNumber}` : undefined} /> },
                  { key: "date", header: "Date", kind: "date", sortValue: p => +new Date(dateOf(p)), cell: p => <CellDate>{fmtDate(dateOf(p))}</CellDate> },
                  { key: "category", header: "Category", sortValue: labelOf, cell: p => <CellTag tone={TONE[purchaseCategory(p)]}>{labelOf(p)}</CellTag> },
                  { key: "purpose", header: "Purpose", sortValue: p => p.purpose, cell: p => (
                    <span className={`inline-flex items-center gap-1 text-[11px] whitespace-nowrap ${p.purpose === "stock" ? "text-muted-foreground" : "text-brand-dark"}`}>
                      {p.purpose === "stock" ? <Boxes className="h-3 w-3" /> : <ShoppingCart className="h-3 w-3" />}{p.purpose}
                    </span>
                  ) },
                  { key: "detail", header: "Detail", sortValue: detailOf, cell: p => <span className="whitespace-nowrap">{detailOf(p)}</span> },
                  { key: "qty", header: "Qty", align: "right", kind: "number", sortValue: p => purchaseQty(p),
                    cell: p => <span className="font-medium tabular-nums whitespace-nowrap">{purchaseQty(p).toLocaleString(undefined, { maximumFractionDigits: 3 })} {materialUnit(db.settings, p.material)}</span> },
                  { key: "rate", header: "Rate", align: "right", kind: "number", sortValue: p => { const q = purchaseQty(p); return q > 0 ? p.totalInr / q : null; },
                    cell: p => { const q = purchaseQty(p); return <span className="text-muted-foreground tabular-nums whitespace-nowrap">{q > 0 ? `${fmtMoneyInr(p.totalInr / q)}/${materialUnit(db.settings, p.material)}` : "—"}</span>; } },
                  { key: "total", header: "Total", align: "right", kind: "number", sortValue: p => p.totalInr, cell: p => <CellAmount>{fmtMoneyInr(p.totalInr)}</CellAmount> },
                ]}
              />
            );
          })() : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Coins className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />
              No material purchases in this period.
            </div>
          )}
        </div>
      )}

      {/* ── Payments Made Report (admin / employee) ── */}
      {vis("payments") && canSeeAll && paymentsReport && (
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <SectionTitle icon={DollarSign} title="Payments Made Report" sub="To suppliers & factories" />
            <SectionTools what={`Payments made · ${payPeriodLabel}`} from={payFrom} to={payTo} setFrom={setPayFrom} setTo={setPayTo}
              exports={[xlsx(exportPaymentsExcel), pdf(exportPaymentsPdf)]} />
          </div>

          <StatStrip items={[
            { label: "Suppliers", value: fmtMoneyInr(paymentsReport.supTotal), icon: Truck },
            { label: "Factories", value: fmtMoneyInr(paymentsReport.facTotal), icon: Factory, op: "+" },
            { label: "Total paid", value: fmtMoneyInr(paymentsReport.grand), tone: "out", op: "=", sub: `${paymentsReport.rows.length} payment${paymentsReport.rows.length !== 1 ? "s" : ""}` },
          ]} />

          {paymentsReport.rows.length > 0 ? (
            <DataTable
              id="reports-payments-made"
              noun="payment"
              rows={paymentsReport.rows}
              rowKey={r => r.id}
              // A payment opens the supplier's or factory's page it was made to.
              rowHref={r => `/${r.kind === "Supplier" ? "suppliers" : "factories"}/${r.partyId}`}
              canClickRow={r => !!r.partyId && mayOpen(r.kind === "Supplier" ? "suppliers" : "factories")}
              details={paymentDetails}
              maxHeight="20rem"
              defaultSort={{ key: "date", dir: "desc" }}
              searchText={r => `${r.party} ${r.kind} ${r.ref}`}
              searchPlaceholder="Search party or reference"
              columns={[
                { key: "party", header: "Party", always: true, sortValue: r => r.party, cell: r => <CellMain title={r.party} /> },
                { key: "date", header: "Date", kind: "date", sortValue: r => +new Date(r.date), cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
                { key: "type", header: "Type", sortValue: r => r.kind, cell: r => <CellTag tone={r.kind === "Supplier" ? "amber" : "violet"}>{r.kind}</CellTag> },
                { key: "ref", header: "Reference", sortValue: r => r.ref, cell: r => <span className="text-muted-foreground whitespace-nowrap">{r.ref}</span> },
                { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: r => r.amount, cell: r => <CellAmount>{fmtMoneyInr(r.amount)}</CellAmount> },
              ]}
            />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground"><DollarSign className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />No payments in this period.</div>
          )}
        </div>
      )}

      {/* ── Sales / Billing Report (admin / employee) ── */}
      {vis("sales") && canSeeAll && salesReport && (
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <SectionTitle icon={TrendingUp} title="Sales / Billing Report" sub="Orders placed in the period" />
            <SectionTools what={`Sales / billing · ${salesPeriodLabel}`} from={salesFrom} to={salesTo} setFrom={setSalesFrom} setTo={setSalesTo}
              exports={[xlsx(exportSalesExcel), pdf(exportSalesPdf)]} />
          </div>

          <StatStrip items={[
            { label: "Orders", value: salesReport.orders.length, icon: Package },
            { label: "Billed", value: fmtMoney(salesReport.billed), icon: FileText },
            { label: "Received", value: fmtMoney(salesReport.received), tone: "in" },
            { label: "Outstanding", value: fmtMoney(salesReport.outstanding), tone: "out" },
            ...(salesReport.giftRedeemed > 0 ? [{ label: "Gift cards redeemed", value: fmtMoney(salesReport.giftRedeemed), icon: Gift, sub: "Already off Billed" }] : []),
          ]} />

          {salesReport.byClient.length > 0 ? (
            <DataTable
              id="reports-sales-by-client"
              noun="client"
              rows={salesReport.byClient}
              rowKey={c => c.id}
              rowHref={mayOpen("clients") ? c => `/clients/${c.id}` : undefined}
              canClickRow={c => clients.some(x => x.id === c.id)}
              details={salesClientDetails}
              maxHeight="20rem"
              defaultSort={{ key: "billed", dir: "desc" }}
              searchText={c => c.name}
              searchPlaceholder="Search clients"
              columns={[
                { key: "client", header: "Client", always: true, sortValue: c => c.name, cell: c => <CellMain title={c.name} /> },
                { key: "orders", header: "Orders", align: "right", kind: "number", sortValue: c => c.count, cell: c => <span className="tabular-nums">{c.count}</span> },
                { key: "billed", header: "Billed", align: "right", kind: "number", sortValue: c => c.billed, cell: c => <CellAmount>{fmtMoney(c.billed)}</CellAmount> },
                { key: "received", header: "Received", align: "right", kind: "number", sortValue: c => c.received, cell: c => <CellAmount tone="in">{fmtMoney(c.received)}</CellAmount> },
                { key: "outstanding", header: "Outstanding", align: "right", kind: "number", sortValue: c => c.outstanding,
                  cell: c => (c.outstanding > 0 ? <CellAmount tone="out">{fmtMoney(c.outstanding)}</CellAmount> : <span className="font-semibold text-success">✓</span>) },
              ]}
            />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground"><TrendingUp className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />No orders placed in this period.</div>
          )}
        </div>
      )}

      {/* ── Profit Report — admin only ── */}
      {vis("profit") && isAdmin && profit && !costDataReady() && (
        <div className="card-luxe p-4 sm:p-5 border-amber-500/30">
          <h3 className="font-semibold text-brand-dark text-sm sm:text-base">Profit &amp; Loss</h3>
          <p className="text-xs text-muted-foreground mt-1">Working out costs… the figures appear as soon as every purchase and charge has loaded.</p>
        </div>
      )}
      {vis("profit") && isAdmin && profit && costDataReady() && (
        <div className="card-luxe p-4 sm:p-5 space-y-4 border-amber-500/30">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <SectionTitle icon={TrendingUp} title="Profit & Loss" sub="Admin only · orders dispatched" />
            {/* Nothing shipped in the period: nothing to download, so no Export. */}
            <SectionTools what={`Profit & Loss · ${profitPeriodLabel}`} from={profitFrom} to={profitTo} setFrom={setProfitFrom} setTo={setProfitTo}
              exports={profit.rows.length ? [xlsx(() => exportProfitCsv(db, profit.rows.map(r => r.order), `Starlink-Profit-${profitFrom || "all"}`))] : []} />
          </div>

          {profit.unconverted > 0 && (
            <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-800">
              Add the rupee-to-dollar rate in <span className="font-semibold">Settings → Pricing</span> to see profit.
              Until then only the rupee cost is shown.
            </p>
          )}
          {profit.approximateRates > 0 && profit.unconverted === 0 && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-amber-700">{profit.approximateRates} sale{profit.approximateRates !== 1 ? "s" : ""}</span>{" "}
              converted at a stand-in rate — there is no rate on file for the day {profit.approximateRates !== 1 ? "they were" : "it was"} sold.
              Add dated rates in Settings → Pricing to book each at its own day&rsquo;s rate.
            </p>
          )}

          {/* ── The P&L, top to bottom, the way an accountant reads it ── */}
          {(() => {
            const le = profit.totals.incomplete ? "≤ " : "";
            const line = (label: string, value: string, opts: { strong?: boolean; tone?: "pos" | "neg" | "muted"; sub?: string; indent?: boolean } = {}) => (
              <div className={`flex items-baseline justify-between gap-3 py-1.5 ${opts.strong ? "border-t border-border/70 mt-1 pt-2.5" : ""}`}>
                <span className={`${opts.indent ? "pl-4 text-muted-foreground" : ""} ${opts.strong ? "font-semibold text-brand-dark" : "text-sm"}`}>
                  {label}{opts.sub && <span className="block text-[10px] text-muted-foreground font-normal">{opts.sub}</span>}
                </span>
                <span className={`tabular-nums whitespace-nowrap ${opts.strong ? "font-display text-lg" : "text-sm font-medium"} ${opts.tone === "pos" ? "text-success" : opts.tone === "neg" ? "text-destructive" : ""}`}>
                  {value}
                </span>
              </div>
            );
            const usd = (v: number | null, prefix = "") => (v === null ? "—" : prefix + fmtMoney(v));
            const tone = (v: number | null) => (v === null ? "muted" : v < 0 ? "neg" : "pos") as "pos" | "neg" | "muted";
            return (
              <div className="rounded-2xl border border-border/70 bg-secondary/20 px-4 py-2">
                {line(`Sales — ${profit.totals.count} order${profit.totals.count !== 1 ? "s" : ""} shipped`, fmtMoney(profit.totals.sellingUsd))}
                {line("Cost of goods sold", usd(profit.totals.costUsd, "− "),
                  { sub: `material, factory, freight · ${fmtMoneyInr(profit.totals.costInr)}`, indent: true })}
                {line("Gross profit", profit.totals.profitUsd === null ? "—" : le + fmtMoney(profit.totals.profitUsd),
                  { strong: true, tone: tone(profit.totals.profitUsd),
                    sub: profit.totals.marginPct === null ? undefined : `${le}${profit.totals.marginPct}% gross margin` })}
                {line(
                  profit.fx.usd !== null && profit.fx.usd < 0 ? "Exchange loss on collections" : "Exchange gain on collections",
                  profit.fx.usd === null ? "—" : `${profit.fx.usd < 0 ? "− " : "+ "}${fmtMoney(Math.abs(profit.fx.usd))}`,
                  { indent: true, sub: [
                      `rupees received vs. booked on ${fmtMoney(profit.fx.convertedUsd)} converted · ${fmtMoneyInr(profit.fx.inr)}`,
                      profit.fx.heldUsd > 0 ? `${fmtMoney(profit.fx.heldUsd)} still held in foreign accounts — realised when converted` : "",
                      profit.fx.unknownUsd > 0 ? `${fmtMoney(profit.fx.unknownUsd)} with no conversion rate on record` : "",
                    ].filter(Boolean).join(" · ") })}
                {line(`Operating expenses — ${profit.opex.count} entr${profit.opex.count !== 1 ? "ies" : "y"}`, usd(profit.opex.totalUsd, "− "),
                  { sub: [
                      profit.opex.byCategory.length ? profit.opex.byCategory.slice(0, 4).map(c => `${c.category} ${fmtMoney(c.usd)}`).join(" · ") : "salaries, rent, travel and other running costs",
                      // Paid in a currency with no rate on file: left out rather than guessed.
                      ...(profit.opex.uncounted ?? []).map(u => `${u.count} in ${u.currency} not counted — add a ${u.currency} rate in Settings → Exchange rates`),
                    ].join(" · "), indent: true })}
                {line("Net profit", profit.netUsd === null ? "—" : le + fmtMoney(profit.netUsd),
                  { strong: true, tone: tone(profit.netUsd),
                    sub: profit.netMargin === null ? undefined : `${le}${profit.netMargin}% net margin` })}
              </div>
            );
          })()}

          <FreightBacklog />

          {profit.totals.incomplete > 0 && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-amber-700">{profit.totals.incomplete} order{profit.totals.incomplete !== 1 ? "s" : ""}</span>{" "}
              still {profit.totals.incomplete !== 1 ? "have" : "has"} part of the cost unknown, so profit is shown as at most (≤). The Excel
              lists exactly what is missing on each.
            </p>
          )}

          {profit.rows.length > 0 ? (
            <>
              <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
                {([["client", "By client"], ["month", "By month"], ["type", "By item"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setProfitBy(k)}
                    className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${profitBy === k ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* One table per grouping — each keeps its own sort and columns,
                  and the first column is named for what it groups by. */}
              <DataTable
                key={profitBy}
                id={`reports-profit-${profitBy}`}
                noun={profitBy === "client" ? "client" : profitBy === "month" ? "month" : "item"}
                rows={profitBy === "client" ? profit.byClient : profitBy === "month" ? profit.byMonth : profit.byType}
                rowKey={g => g.key}
                details={profitGroupDetails}
                maxHeight="24rem"
                // Months newest first, clients and items biggest sales first — the order they come in.
                defaultSort={profitBy === "month" ? { key: "group", dir: "desc" } : { key: "sales", dir: "desc" }}
                searchText={g => (profitBy === "month" ? monthLabel(g.key) : g.key)}
                searchPlaceholder={`Search ${profitBy === "client" ? "clients" : profitBy === "month" ? "months" : "items"}`}
                columns={[
                  { key: "group", header: profitBy === "client" ? "Client" : profitBy === "month" ? "Month" : "Item", always: true,
                    kind: profitBy === "month" ? "date" : "text", sortValue: g => g.key,
                    cell: g => <CellMain title={profitBy === "month" ? monthLabel(g.key) : g.key} /> },
                  { key: "orders", header: "Orders", align: "right", kind: "number", sortValue: g => g.count,
                    cell: g => <span className="tabular-nums whitespace-nowrap">{g.count}{g.incomplete > 0 && <span className="text-amber-600" title="cost not fully known"> · {g.incomplete}?</span>}</span> },
                  { key: "sales", header: "Sales", align: "right", kind: "number", sortValue: g => g.sellingUsd, cell: g => <CellAmount>{fmtMoney(g.sellingUsd)}</CellAmount> },
                  // Dollars when every order converted; rupees otherwise — so it sorts by the dollars.
                  { key: "cost", header: "Cost", align: "right", kind: "number", sortValue: g => g.costUsd,
                    cell: g => <span className="tabular-nums whitespace-nowrap">{g.costUsd !== null ? fmtMoney(g.costUsd) : fmtMoneyInr(g.costInr)}</span> },
                  { key: "profit", header: "Profit", align: "right", kind: "number", sortValue: g => g.profitUsd,
                    cell: g => <CellAmount tone={(g.profitUsd ?? 0) < 0 ? "out" : "in"}>{g.profitUsd === null ? "—" : (g.incomplete ? "≤ " : "") + fmtMoney(g.profitUsd)}</CellAmount> },
                  { key: "margin", header: "Margin", align: "right", kind: "number", sortValue: g => g.marginPct,
                    cell: g => <span className={`tabular-nums whitespace-nowrap ${(g.profitUsd ?? 0) < 0 ? "text-destructive" : "text-success"}`}>{g.marginPct === null ? "—" : `${g.incomplete ? "≤ " : ""}${g.marginPct}%`}</span> },
                ]}
              />

              {/* Sold for less than they cost — the first thing worth knowing. */}
              {profit.losses.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs font-semibold text-destructive mb-1.5">
                    {profit.losses.length} order{profit.losses.length !== 1 ? "s" : ""} sold below cost
                  </p>
                  <ul className="space-y-0.5">
                    {profit.losses.slice(0, 10).map(r => (
                      <li key={r.order.id} className="flex items-baseline justify-between gap-3 text-xs">
                        <span>
                          <span className="font-medium text-brand-dark">{r.order.orderNumber}</span>
                          <span className="text-muted-foreground"> · {clients.find(c => c.id === r.order.clientId)?.companyName ?? ""} · sold {fmtMoney(r.sellingUsd)}</span>
                        </span>
                        <span className="font-semibold text-destructive tabular-nums">{fmtMoney(r.profitUsd!)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground"><TrendingUp className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />No finished orders in this period.</div>
          )}
        </div>
      )}

      {/* ── Dispatch Speed Card ── */}
      {vis("speed") && (
      <div className="card-luxe p-4 sm:p-5">
        <SectionTitle className="mb-4" icon={Clock} title="Dispatch Speed" sub="Days from order to dispatch" />

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
      )}

      {/* ── Orders by Production Stage (admin / employee) ── */}
      {vis("stages") && canSeeAll && byStage.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <SectionTitle className="mb-4" title="Orders by Production Stage" sub="Where orders are now" />
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
      {vis("clients") && canSeeAll && byClient.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <SectionTitle className="mb-4" title={clientFilter === "all" ? "Client-wise Summary" : `Orders — ${clients.find(c=>c.id===clientFilter)?.companyName}`} />

          {/* One table at every size — on a phone it scrolls sideways with the
              client held in view. */}
          <DataTable
            id="reports-client-summary"
            noun="client"
            rows={byClient}
            rowKey={cl => cl.id}
            rowHref={mayOpen("clients") ? cl => `/clients/${cl.id}` : undefined}
            canClickRow={cl => clients.some(x => x.id === cl.id)}
            details={clientSummaryDetails}
            defaultSort={{ key: "orders", dir: "desc" }}
            searchText={cl => cl.name}
            searchPlaceholder="Search clients"
            columns={[
              { key: "client", header: "Client", always: true, sortValue: cl => cl.name, cell: cl => <CellMain title={cl.name} /> },
              { key: "orders", header: "Orders", align: "right", kind: "number", sortValue: cl => cl.total, cell: cl => <span className="tabular-nums">{cl.total}</span> },
              { key: "dispatched", header: "Dispatched", align: "right", kind: "number", sortValue: cl => cl.dispatched, cell: cl => <CellTag tone="blue">{cl.dispatched}</CellTag> },
              { key: "delivered", header: "Delivered", align: "right", kind: "number", sortValue: cl => cl.delivered, cell: cl => <CellTag tone="green">{cl.delivered}</CellTag> },
              { key: "revenue", header: "Revenue", align: "right", kind: "number", sortValue: cl => cl.revenue, cell: cl => <CellAmount>{fmtMoney(cl.revenue)}</CellAmount> },
              { key: "avg", header: "Avg Dispatch", align: "right", kind: "number", sortValue: cl => cl.avgDays,
                cell: cl => (cl.avgDays !== null
                  ? <CellTag tone={cl.avgDays <= 7 ? "green" : cl.avgDays <= 20 ? "amber" : "red"}>{cl.avgDays} days</CellTag>
                  : <span className="text-muted-foreground text-xs">—</span>) },
            ]}
          />
        </div>
      )}

      {/* ── All Orders table (admin / employee) ── */}
      {vis("orders") && canSeeAll && filtered.length > 0 && (
        <div className="card-luxe p-4 sm:p-5">
          <SectionTitle className="mb-4" title="All Orders" />

          {/* Sortable, searchable, columns to choose — at every size; on a phone
              it scrolls sideways with the order number held in view. */}
          <DataTable
            id="reports-all-orders"
            noun="order"
            rows={filtered}
            exports={[xlsx(exportExcel)]}
            rowKey={o => o.id}
            // Every row is one of this person's own orders: it opens the order.
            rowHref={mayOpen("orders") ? o => `/orders/${o.id}` : undefined}
            details={reportOrderDetails}
            maxHeight="32rem"
            defaultSort={{ key: "date", dir: "desc" }}
            searchText={o => `${o.orderNumber} ${o.designNumber ?? ""} ${clients.find(cl => cl.id === o.clientId)?.companyName ?? ""} ${o.jewelleryType} ${metalLabel(o.metal)} ${o.status}`}
            columns={[
              { key: "no", header: "Order #", always: true, sortValue: o => o.orderNumber, cell: o => <span className="font-mono text-xs font-semibold text-brand-dark whitespace-nowrap">{o.orderNumber}</span> },
              { key: "design", header: "Design #", hidden: true, sortValue: o => o.designNumber ?? "", cell: o => o.designNumber || "—" },
              { key: "client", header: "Client", sortValue: o => clients.find(cl => cl.id === o.clientId)?.companyName ?? "", cell: o => <span className="whitespace-nowrap">{clients.find(cl => cl.id === o.clientId)?.companyName ?? "—"}</span> },
              { key: "type", header: "Type", sortValue: o => o.jewelleryType, cell: o => <span className="whitespace-nowrap">{o.jewelleryType}</span> },
              { key: "metal", header: "Metal", hidden: true, sortValue: o => o.metal, cell: o => <span className="whitespace-nowrap">{metalLabel(o.metal)}</span> },
              { key: "status", header: "Status", sortValue: o => o.status, cell: o => <StatusBadge status={o.status} /> },
              { key: "qty", header: "Qty", align: "right", kind: "number", sortValue: o => o.quantity, cell: o => o.quantity },
              { key: "value", header: "Order Value", align: "right", kind: "number", sortValue: o => o.amount || 0, cell: o => <span className="font-semibold text-brand-dark tabular-nums whitespace-nowrap">{fmtMoney(o.amount)}</span> },
              { key: "adv", header: "Advance", align: "right", kind: "number", sortValue: o => totalAdvance(o), cell: o => <span className="text-success tabular-nums whitespace-nowrap">{totalAdvance(o) > 0 ? fmtMoney(totalAdvance(o)) : "—"}</span> },
              { key: "bal", header: "Balance", align: "right", kind: "number", sortValue: o => balanceDue(o), cell: o => { const bal = balanceDue(o); return <span className={`font-semibold tabular-nums whitespace-nowrap ${bal > 0 ? "text-destructive" : "text-success"}`}>{bal > 0 ? fmtMoney(bal) : "✓ Cleared"}</span>; } },
              { key: "date", header: "Date", align: "right", kind: "date", sortValue: o => +new Date(o.createdAt), cell: o => <CellDate>{fmtDate(o.createdAt)}</CellDate> },
            ]}
          />
        </div>
      )}

      {/* ── Client-facing: status breakdown ── */}
      {isClient && (
        <>
          <div className="card-luxe p-4 sm:p-5">
            <SectionTitle className="mb-4" title="Order Status Breakdown" />
            <div className="space-y-2.5">
              {STATUS_LIST.map(s => {
                const cnt = filtered.filter(o => o.status === s).length;
                const pct = total > 0 ? (cnt / total) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-2 sm:gap-3">
                    <div className="w-32 shrink-0">
                      <StatusBadge status={s} />
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
              <SectionTitle className="mb-3" title="My Orders" />
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
                        <StatusBadge status={o.status} />
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
      {!embedded && total === 0 && (
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
