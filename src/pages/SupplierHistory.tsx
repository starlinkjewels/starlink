import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, DIAMOND_SHAPES, nextDiamondStockNumber, type Purchase, type PurchaseMaterial, type PurchaseCurrency } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  supplierAccount, purchasePaid, purchasePending, allocateSupplierPaymentFIFO, fmtMoneyInr, lockerBalance, fmtLockerAmount,
} from "@/lib/manufacturing";
import { increaseStock, decreaseStockSelfHealing } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Truck, Mail, Phone, MapPin, Hash, Wallet, Plus, CreditCard, Package, TrendingUp,
  Download, FileText, FileSpreadsheet, X, Trash2, ArrowDownCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

// One line = one Purchase doc on save — a single supplier invoice often
// covers several sizes/qualities (e.g. two diamond parcels), so purchases are
// entered as a list rather than forcing one open/fill/save cycle per variety.
interface PurchaseLine {
  material: PurchaseMaterial;
  purpose: "order" | "stock";
  orderNumber: string;
  goldWeight: string;
  goldPurity: string;
  goldRate: string;
  diaCarat: string;
  diaQuality: string;
  diaRate: string;
  diaKind: "loose" | "certified";
  diaShape: string;
  diaCertNo: string;
  diaLab: string;
  diaColor: string;
  diaClarity: string;
  diaCut: string;
  diaPolish: string;
  diaSym: string;
  diaFluor: string;
  diaMeasure: string;
  currency: PurchaseCurrency;
  totalUsd: string;
  exchangeRate: string;
  invoiceNumber: string;
  notes: string;
}

function emptyPurchaseLine(): PurchaseLine {
  return {
    material: "gold", purpose: "stock", orderNumber: "",
    goldWeight: "", goldPurity: "22K", goldRate: "",
    diaCarat: "", diaQuality: "", diaRate: "",
    diaKind: "loose", diaShape: "Round", diaCertNo: "", diaLab: "",
    diaColor: "", diaClarity: "", diaCut: "", diaPolish: "", diaSym: "", diaFluor: "", diaMeasure: "",
    currency: "INR", totalUsd: "", exchangeRate: "",
    invoiceNumber: "", notes: "",
  };
}

function purchaseLineTotalInr(line: PurchaseLine): number {
  const computed = line.material === "gold"
    ? (Number(line.goldWeight) || 0) * (Number(line.goldRate) || 0)
    : (Number(line.diaCarat) || 0) * (Number(line.diaRate) || 0);
  return line.currency === "USD"
    ? Math.round((Number(line.totalUsd) || 0) * (Number(line.exchangeRate) || 0))
    : Math.round(computed);
}

export function SupplierHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const db = useDb();

  const supplier = db.suppliers.find(s => s.id === id);
  if (!supplier) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Supplier not found. <Link to="/suppliers" className="text-primary underline">Back to Suppliers</Link>
      </div>
    );
  }

  const purchases = db.purchases
    .filter(p => p.supplierId === id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const receipts = (db.supplierReceipts ?? []).filter(r => r.supplierId === id);
  const account = supplierAccount(purchases, receipts);

  // ── Record purchase ──
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([emptyPurchaseLine()]);
  const [recordingPurchase, setRecordingPurchase] = useState(false);

  const grandTotalInr = purchaseLines.reduce((s, l) => s + purchaseLineTotalInr(l), 0);

  const updatePurchaseLine = (idx: number, patch: Partial<PurchaseLine>) =>
    setPurchaseLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addPurchaseLine = () => setPurchaseLines(prev => [...prev, emptyPurchaseLine()]);
  const removePurchaseLine = (idx: number) => setPurchaseLines(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const resetPurchaseForm = () => setPurchaseLines([emptyPurchaseLine()]);

  const recordPurchase = async () => {
    for (const line of purchaseLines) {
      if (line.material === "gold" && (!line.goldWeight || Number(line.goldWeight) <= 0)) { toast.error("Enter gold weight for every line"); return; }
      if (line.material === "diamond" && (!line.diaCarat || Number(line.diaCarat) <= 0)) { toast.error("Enter diamond carat for every line"); return; }
      if (line.material === "diamond" && line.diaKind === "certified" && !line.diaCertNo.trim()) { toast.error("Enter the certificate number for every certified diamond line"); return; }
      if (line.currency === "USD" && (!line.totalUsd || !line.exchangeRate)) { toast.error("Enter the USD amount and exchange rate for every USD line"); return; }
      if (line.purpose === "order" && !line.orderNumber.trim()) { toast.error("Enter the order number for every 'for a specific order' line"); return; }
      if (purchaseLineTotalInr(line) <= 0) { toast.error("A line's total comes to ₹0 — check its weight/rate fields"); return; }
    }

    // Resolve order links up front so a typo fails before any writes happen.
    const resolved: { line: PurchaseLine; linkedOrderId?: string }[] = [];
    for (const line of purchaseLines) {
      if (line.purpose === "order") {
        const order = db.orders.find(o => o.orderNumber.trim().toLowerCase() === line.orderNumber.trim().toLowerCase());
        if (!order) { toast.error(`No order found matching "${line.orderNumber}"`); return; }
        resolved.push({ line, linkedOrderId: order.id });
      } else {
        resolved.push({ line });
      }
    }

    const now = new Date().toISOString();
    const entries = resolved.map(({ line, linkedOrderId }) => ({
      id: uid("pur_"), line, linkedOrderId, totalInr: purchaseLineTotalInr(line),
    }));

    setRecordingPurchase(true);
    try {
      // Stock increases must succeed before the purchase records are written,
      // so we never end up with a purchase that silently failed to update stock.
      for (const entry of entries) {
        const line = entry.line;
        if (line.purpose !== "stock") continue;
        // Certified diamonds are NOT pooled into stock levels — each becomes its
        // own packet (created in the updateDb below). Loose diamonds pool by shape.
        if (line.material === "diamond" && line.diaKind === "certified") continue;
        await increaseStock({
          material: line.material,
          purityOrQuality: line.material === "gold" ? line.goldPurity : line.diaShape,
          quantity: line.material === "gold" ? Number(line.goldWeight) : Number(line.diaCarat),
          refType: "purchase",
          refId: entry.id,
          createdBy: user!.id,
        });
      }
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        for (const entry of entries) {
          const { line, linkedOrderId, totalInr } = entry;
          const purchase: Purchase = {
            id: entry.id,
            supplierId: id!,
            material: line.material,
            gold: line.material === "gold" ? { weightGrams: Number(line.goldWeight), purity: line.goldPurity, ratePerGram: Number(line.goldRate) || 0 } : undefined,
            diamond: line.material === "diamond" ? {
              carat: Number(line.diaCarat),
              quality: line.diaQuality || undefined,
              ratePerCarat: Number(line.diaRate) || 0,
              kind: line.diaKind,
              shape: line.diaShape,
              certificateNumber: line.diaKind === "certified" ? line.diaCertNo.trim() : undefined,
              certificateLab: line.diaKind === "certified" ? (line.diaLab.trim() || undefined) : undefined,
            } : undefined,
            purpose: line.purpose,
            orderId: linkedOrderId,
            currency: line.currency,
            totalUsd: line.currency === "USD" ? Number(line.totalUsd) : undefined,
            exchangeRate: line.currency === "USD" ? Number(line.exchangeRate) : undefined,
            totalInr,
            payments: [],
            invoiceNumber: line.invoiceNumber.trim() || undefined,
            notes: line.notes.trim() || undefined,
            createdBy: user!.id,
            createdAt: now,
          };
          d.purchases.unshift(purchase);

          // Certified diamond → its own packet (never pooled). Goes to stock, or
          // straight onto the order if this purchase was for a specific order.
          if (line.material === "diamond" && line.diaKind === "certified") {
            if (!d.diamondPackets) d.diamondPackets = [];
            const carat = Number(line.diaCarat) || 0;
            d.diamondPackets.unshift({
              id: uid("dp_"),
              stockNumber: nextDiamondStockNumber(d),
              shape: line.diaShape,
              carat,
              quality: line.diaQuality || undefined,
              color: line.diaColor.trim() || undefined,
              clarity: line.diaClarity.trim() || undefined,
              cut: line.diaCut.trim() || undefined,
              polish: line.diaPolish.trim() || undefined,
              symmetry: line.diaSym.trim() || undefined,
              fluorescence: line.diaFluor.trim() || undefined,
              measurement: line.diaMeasure.trim() || undefined,
              certificateNumber: line.diaCertNo.trim(),
              certificateLab: line.diaLab.trim() || undefined,
              ratePerCaratInr: carat > 0 ? Math.round((totalInr / carat) * 100) / 100 : undefined,
              supplierId: id!,
              purchaseId: purchase.id,
              // Stays in stock (reserved to the order if linked) so it flows through
              // the normal issue-to-factory step instead of jumping straight to "used".
              status: "in_stock",
              orderId: linkedOrderId,
              createdBy: user!.id,
              createdAt: now,
            });
          }

          if (linkedOrderId) {
            const o = d.orders.find(o => o.id === linkedOrderId);
            if (o) {
              if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
              o.linkedPurchaseIds.push(purchase.id);
              if (!o.manufacturingLog) o.manufacturingLog = [];
              const qty = line.material === "gold" ? Number(line.goldWeight) : Number(line.diaCarat);
              const label = line.material === "gold"
                ? `${qty}g ${line.goldPurity} gold`
                : `${qty}ct ${line.diaShape} diamond${line.diaKind === "certified" ? ` (Certified ${line.diaCertNo.trim()})` : line.diaQuality ? ` (${line.diaQuality})` : ""}`;
              o.manufacturingLog.push({
                id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
                material: line.material, amountMaterial: qty, amountInr: totalInr,
                remarks: `Purchased ${label} from ${supplier.name} for this order — ${fmtMoneyInr(totalInr)}`,
              });
            }
          }
        }
      });
      toast.success(`${entries.length > 1 ? `${entries.length} purchases` : "Purchase"} recorded — ${fmtMoneyInr(grandTotalInr)}`);
      setShowPurchaseForm(false);
      resetPurchaseForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record purchase");
    } finally { setRecordingPurchase(false); }
  };

  // ── Record payment ──
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payLockerId, setPayLockerId] = useState("");
  const [payTargetPurchase, setPayTargetPurchase] = useState<string>("__fifo");
  const [payNote, setPayNote] = useState("");

  const recordPayment = () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!payLockerId) { toast.error("Choose which locker this payment came from"); return; }
    // Overpayment allowed — the excess beyond what's owed is parked on the newest
    // purchase (shows as Overpaid), never silently lost.
    const payLocker = db.lockers.find(l => l.id === payLockerId);
    if (payLocker && amt > lockerBalance(payLocker, db.lockerTransactions) &&
        !window.confirm(`This payment of ${fmtLockerAmount(amt, payLocker.currency)} is more than ${payLocker.name}'s balance of ${fmtLockerAmount(lockerBalance(payLocker, db.lockerTransactions), payLocker.currency)}. The locker will go negative — continue only if a deposit is still missing.`)) return;
    const now = new Date().toISOString();

    updateDb(d => {
      const supplierPurchases = d.purchases.filter(p => p.supplierId === id);
      if (payTargetPurchase === "__fifo") {
        const leftover = allocateSupplierPaymentFIFO(supplierPurchases, amt, payLockerId, user!.id, now, payNote.trim() || undefined);
        if (leftover > 0) {
          const newest = [...supplierPurchases].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
          if (newest) {
            if (!newest.payments) newest.payments = [];
            newest.payments.push({ id: uid("ppay_"), amountInr: leftover, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
          }
        }
      } else {
        const p = d.purchases.find(p => p.id === payTargetPurchase);
        if (p) {
          if (!p.payments) p.payments = [];
          p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
        }
      }
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: payLockerId, type: "expense", amountInr: amt,
        category: `Supplier Payment — ${supplier.name}`, refType: "purchase",
        refId: payTargetPurchase === "__fifo" ? undefined : payTargetPurchase,
        note: payNote.trim() || undefined, recordedBy: user!.id, createdAt: now,
      });
    });
    toast.success("Payment recorded");
    setPayAmount(""); setPayNote(""); setPayTargetPurchase("__fifo"); setShowPayForm(false);
  };

  // ── Receive money FROM the supplier (refund / return credit) ──
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [rcvAmount, setRcvAmount] = useState("");
  const [rcvLockerId, setRcvLockerId] = useState("");
  const [rcvNote, setRcvNote] = useState("");

  const recordReceipt = () => {
    const amt = Number(rcvAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!rcvLockerId) { toast.error("Choose which locker the money went into"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      if (!d.supplierReceipts) d.supplierReceipts = [];
      d.supplierReceipts.push({ id: uid("srcpt_"), supplierId: id!, amountInr: amt, lockerId: rcvLockerId, recordedBy: user!.id, createdAt: now, note: rcvNote.trim() || undefined });
      if (!d.lockerTransactions) d.lockerTransactions = [];
      d.lockerTransactions.push({
        id: uid("ltx_"), lockerId: rcvLockerId, type: "income", amountInr: amt,
        category: `Received from ${supplier.name}`, refType: "manual",
        note: rcvNote.trim() || undefined, recordedBy: user!.id, createdAt: now,
      });
    });
    toast.success("Receipt recorded");
    setRcvAmount(""); setRcvNote(""); setRcvLockerId(""); setShowReceiveForm(false);
  };

  // ── Void a purchase ──
  // Deliberately CONSERVATIVE: a void only proceeds when it can fully and safely
  // reverse itself. It refuses (with a clear reason) if any payment was recorded
  // (those may have been FIFO-allocated and can't be traced back cleanly — the
  // payment must be reversed from the locker first), if a certified packet has
  // already left stock, or if pooled stock has already been consumed. This keeps
  // production money/inventory from silently drifting.
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const voidPurchase = async (p: Purchase) => {
    if (purchasePaid(p) > 0) {
      toast.error("This purchase has payments recorded. Reverse the payment from the Locker first, then void it.");
      return;
    }
    const relatedPackets = (db.diamondPackets ?? []).filter(pk => pk.purchaseId === p.id);
    if (relatedPackets.some(pk => pk.status !== "in_stock")) {
      toast.error("A certified diamond from this purchase is already issued or used on an order. Cancel it from the order first.");
      return;
    }
    if (!confirm(`Void this purchase of ${purchaseDesc(p)} (${fmtMoneyInr(p.totalInr)})?\n\nStock added by it will be reversed and the record removed. This can't be undone.`)) return;
    setVoidingId(p.id);
    try {
      // Reverse pooled stock first (only stock-purpose loose diamond / gold ever
      // increased the pool). Floor-checked — throws if the material was consumed.
      if (p.purpose === "stock" && !(p.material === "diamond" && p.diamond?.kind === "certified")) {
        await decreaseStockSelfHealing({
          material: p.material,
          purityOrQuality: p.material === "gold" ? (p.gold?.purity ?? "") : (p.diamond?.shape ?? ""),
          quantity: p.material === "gold" ? (p.gold?.weightGrams ?? 0) : (p.diamond?.carat ?? 0),
          type: "issuance_out",
          refType: "purchase",
          refId: p.id,
          createdBy: user!.id,
          note: `Void of purchase ${p.invoiceNumber || p.id.slice(-6)}`,
        }, db.stockMovements);
      }
      updateDb(d => {
        d.purchases = (d.purchases ?? []).filter(x => x.id !== p.id);
        // Remove the certified packets it created (all confirmed in_stock above).
        d.diamondPackets = (d.diamondPackets ?? []).filter(pk => pk.purchaseId !== p.id);
        // Unlink from its order + drop the "material purchased" log line.
        if (p.orderId) {
          const o = d.orders.find(o => o.id === p.orderId);
          if (o) {
            o.linkedPurchaseIds = (o.linkedPurchaseIds ?? []).filter(pid => pid !== p.id);
            o.manufacturingLog = (o.manufacturingLog ?? []).filter(
              m => !(m.type === "material_purchased" && m.amountInr === p.totalInr && m.at === p.createdAt),
            );
          }
        }
      });
      toast.success("Purchase voided and stock reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reverse the stock for this purchase.");
    } finally { setVoidingId(null); }
  };

  const pendingPurchases = purchases.filter(p => purchasePending(p) > 0);

  const purchaseDesc = (p: Purchase) =>
    p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity} gold` : `${p.diamond?.carat}ct diamond${p.diamond?.quality ? ` (${p.diamond.quality})` : ""}`;

  // Full account statement — every purchase (owed) and every payment (paid)
  // across all purchases, chronological, with a running balance. This is the
  // "professional ledger" view, not just a purchase-by-purchase list.
  const statement = (() => {
    const rows: { id: string; date: string; particulars: string; debit: number; credit: number }[] = [];
    for (const p of purchases) {
      rows.push({ id: p.id, date: p.createdAt, particulars: `Purchase — ${purchaseDesc(p)}${p.invoiceNumber ? ` (Inv ${p.invoiceNumber})` : ""}`, debit: p.totalInr, credit: 0 });
      for (const pay of p.payments || []) {
        rows.push({ id: pay.id, date: pay.createdAt, particulars: `Payment${pay.note ? ` — ${pay.note}` : ""}`, debit: 0, credit: pay.amountInr });
      }
    }
    // Money received back from the supplier — a credit, like a payment.
    for (const r of receipts) {
      rows.push({ id: r.id, date: r.createdAt, particulars: `Received from supplier${r.note ? ` — ${r.note}` : ""}`, debit: 0, credit: r.amountInr });
    }
    let running = 0;
    const withBalance = [...rows]
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .map(r => { running += r.debit - r.credit; return { ...r, balance: running }; });
    return withBalance.reverse(); // newest first, matching every other list on this page
  })();

  const exportCsv = () => {
    downloadCsv(
      `Supplier-${supplier.name.replace(/\s+/g, "_")}`,
      ["Date", "Particulars", "Purchased (INR)", "Paid (INR)", "Balance (INR)"],
      statement.map(r => [fmtDate(r.date), r.particulars, r.debit || "", r.credit || "", r.balance]),
    );
  };

  const exportPdf = () => {
    downloadLedgerPdf({
      title: "Supplier Account Statement",
      subjectLines: [
        `Supplier: ${supplier.name}`,
        supplier.contactPerson ? `Contact: ${supplier.contactPerson}` : "",
        `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].filter(Boolean),
      summary: [
        { label: "Total Purchased", value: fmtInrPlain(account.totalPurchased) },
        { label: "Total Paid", value: fmtInrPlain(account.totalPaid) },
        { label: "Balance Owed", value: fmtInrPlain(account.balanceOwed) },
        { label: "Overpaid", value: fmtInrPlain(account.overpaid) },
      ],
      columns: [
        { header: "Date", x: 20 },
        { header: "Particulars", x: 50 },
        { header: "Purchased", x: 122 },
        { header: "Paid", x: 148 },
        { header: "Balance", x: 170 },
      ],
      rows: statement.map(r => [
        fmtDate(r.date), r.particulars.slice(0, 28),
        r.debit ? fmtInrPlain(r.debit).replace("Rs. ", "") : "—",
        r.credit ? fmtInrPlain(r.credit).replace("Rs. ", "") : "—",
        fmtInrPlain(r.balance).replace("Rs. ", ""),
      ]),
      filename: `Supplier-${supplier.name.replace(/\s+/g, "_")}`,
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate("/suppliers")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Suppliers
      </button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-luxe p-6">
        <div className="flex items-start gap-4 min-w-0">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-400/15 grid place-items-center shrink-0">
            <Truck className="h-7 w-7 text-amber-600" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl md:text-3xl text-brand-dark leading-tight break-words">{supplier.name}</h1>
            <p className="text-muted-foreground mt-1 break-words">{supplier.contactPerson}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div className="flex items-start gap-2 min-w-0"><Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="font-medium break-all">{supplier.email || "—"}</p></div></div>
          <div className="flex items-start gap-2"><Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{supplier.phone || "—"}</p></div></div>
          <div className="flex items-start gap-2"><Hash className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div><p className="text-xs text-muted-foreground">GSTIN</p><p className="font-medium">{supplier.gstin || "—"}</p></div></div>
          {supplier.address && <div className="flex items-start gap-2 min-w-0"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium break-words">{supplier.address}</p></div></div>}
        </div>
      </motion.div>

      {/* Account Ledger */}
      <div className="card-luxe p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center shrink-0"><Wallet className="h-5 w-5 text-success" /></div>
            <div>
              <h3 className="font-display text-lg text-brand-dark">Account Ledger</h3>
              <p className="text-xs text-muted-foreground">All amounts in INR</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportPdf}><FileText className="h-4 w-4 mr-2" /> Download PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}><FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel (CSV)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {user?.role === "admin" && (
              <Button onClick={() => { setShowPayForm(v => !v); setShowReceiveForm(false); }} variant="outline" className="rounded-xl gap-2">
                <CreditCard className="h-4 w-4" /> Pay
              </Button>
            )}
            {user?.role === "admin" && (
              <Button onClick={() => { setShowReceiveForm(v => !v); setShowPayForm(false); }} variant="outline" className="rounded-xl gap-2">
                <ArrowDownCircle className="h-4 w-4" /> Receive
              </Button>
            )}
            {user?.role === "admin" && (
              <Button onClick={() => setShowPurchaseForm(v => !v)} className="btn-hero rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Record Purchase
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Total Purchased</p><p className="font-semibold text-sm">{fmtMoneyInr(account.totalPurchased)}</p></div>
          <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center"><p className="text-xs text-muted-foreground mb-1">Total Paid</p><p className="font-semibold text-sm text-success">{fmtMoneyInr(account.totalPaid)}</p></div>
          <div className="p-3 rounded-xl bg-blue-500/8 border border-blue-500/20 text-center"><p className="text-xs text-muted-foreground mb-1">Received (refunds)</p><p className="font-semibold text-sm text-blue-600">{fmtMoneyInr(account.received)}</p></div>
          <div className={`p-3 rounded-xl text-center border ${account.net > 0 ? "bg-destructive/5 border-destructive/20" : account.net < 0 ? "bg-blue-500/8 border-blue-500/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">{account.net < 0 ? "Supplier owes you" : "Net balance"}</p>
            <p className={`font-semibold text-sm ${account.net > 0 ? "text-destructive" : account.net < 0 ? "text-blue-600" : "text-success"}`}>{account.net > 0 ? fmtMoneyInr(account.net) : account.net < 0 ? fmtMoneyInr(-account.net) : "✓ Settled"}</p>
          </div>
        </div>

        {showPurchaseForm && (
          <div className="pt-2 border-t border-border/60 space-y-3">
            <p className="text-sm font-medium text-brand-dark">Record Purchase</p>

            {purchaseLines.map((line, idx) => (
              <div key={idx} className="p-3 rounded-xl border border-border/60 space-y-2.5 relative">
                {purchaseLines.length > 1 && (
                  <button type="button" onClick={() => removePurchaseLine(idx)} className="absolute top-2 right-2 h-6 w-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <p className="text-xs font-medium text-muted-foreground">Item {idx + 1}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Select value={line.material} onValueChange={v => updatePurchaseLine(idx, { material: v as PurchaseMaterial })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
                  </Select>
                  <Select value={line.purpose} onValueChange={v => updatePurchaseLine(idx, { purpose: v as "order" | "stock" })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="stock">For General Stock</SelectItem><SelectItem value="order">For a Specific Order</SelectItem></SelectContent>
                  </Select>
                </div>

                {line.purpose === "order" && (
                  <Input value={line.orderNumber} onChange={e => updatePurchaseLine(idx, { orderNumber: e.target.value })} className="rounded-xl h-10" placeholder="Order number, e.g. SLJ-2026-1020" />
                )}

                {line.material === "gold" ? (
                  <div className="grid grid-cols-3 gap-2.5">
                    <Input type="number" min={0} value={line.goldWeight} onChange={e => updatePurchaseLine(idx, { goldWeight: e.target.value })} className="rounded-xl h-10" placeholder="Weight (g)" />
                    <Select value={line.goldPurity} onValueChange={v => updatePurchaseLine(idx, { goldPurity: v })}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={0} value={line.goldRate} onChange={e => updatePurchaseLine(idx, { goldRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/g (${line.currency})`} />
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <Select value={line.diaKind} onValueChange={v => updatePurchaseLine(idx, { diaKind: v as "loose" | "certified" })}>
                        <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="loose">Loose (by shape)</SelectItem>
                          <SelectItem value="certified">Certified (own packet)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={line.diaShape} onValueChange={v => updatePurchaseLine(idx, { diaShape: v })}>
                        <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Shape" /></SelectTrigger>
                        <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      <Input type="number" min={0} step="0.01" value={line.diaCarat} onChange={e => updatePurchaseLine(idx, { diaCarat: e.target.value })} className="rounded-xl h-10" placeholder="Carat" />
                      <Input value={line.diaQuality} onChange={e => updatePurchaseLine(idx, { diaQuality: e.target.value })} className="rounded-xl h-10" placeholder="Quality (optional)" />
                      <Input type="number" min={0} value={line.diaRate} onChange={e => updatePurchaseLine(idx, { diaRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/ct (${line.currency})`} />
                    </div>
                    {line.diaKind === "certified" && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <Input value={line.diaCertNo} onChange={e => updatePurchaseLine(idx, { diaCertNo: e.target.value })} className="rounded-xl h-10" placeholder="Report / Certificate #" />
                          <Input value={line.diaLab} onChange={e => updatePurchaseLine(idx, { diaLab: e.target.value })} className="rounded-xl h-10" placeholder="Lab — GIA / IGI (optional)" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <Input value={line.diaColor} onChange={e => updatePurchaseLine(idx, { diaColor: e.target.value })} className="rounded-xl h-10" placeholder="Color" />
                          <Input value={line.diaClarity} onChange={e => updatePurchaseLine(idx, { diaClarity: e.target.value })} className="rounded-xl h-10" placeholder="Clarity" />
                          <Input value={line.diaCut} onChange={e => updatePurchaseLine(idx, { diaCut: e.target.value })} className="rounded-xl h-10" placeholder="Cut" />
                          <Input value={line.diaFluor} onChange={e => updatePurchaseLine(idx, { diaFluor: e.target.value })} className="rounded-xl h-10" placeholder="FL (fluor.)" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          <Input value={line.diaPolish} onChange={e => updatePurchaseLine(idx, { diaPolish: e.target.value })} className="rounded-xl h-10" placeholder="Polish" />
                          <Input value={line.diaSym} onChange={e => updatePurchaseLine(idx, { diaSym: e.target.value })} className="rounded-xl h-10" placeholder="Symmetry" />
                          <Input value={line.diaMeasure} onChange={e => updatePurchaseLine(idx, { diaMeasure: e.target.value })} className="rounded-xl h-10" placeholder="Measurement (mm)" />
                        </div>
                        <p className="text-[11px] text-muted-foreground">Each certified stone is one line = one packet. Add another line for another stone.</p>
                      </>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Select value={line.currency} onValueChange={v => updatePurchaseLine(idx, { currency: v as PurchaseCurrency })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
                  </Select>
                  {line.currency === "USD" && (
                    <>
                      <Input type="number" min={0} value={line.totalUsd} onChange={e => updatePurchaseLine(idx, { totalUsd: e.target.value })} className="rounded-xl h-10" placeholder="Total ($)" />
                      <Input type="number" min={0} step="0.01" value={line.exchangeRate} onChange={e => updatePurchaseLine(idx, { exchangeRate: e.target.value })} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input value={line.invoiceNumber} onChange={e => updatePurchaseLine(idx, { invoiceNumber: e.target.value })} className="rounded-xl h-10" placeholder="Invoice # (optional)" />
                  <Input value={line.notes} onChange={e => updatePurchaseLine(idx, { notes: e.target.value })} className="rounded-xl h-10" placeholder="Notes (optional)" />
                </div>

                <p className="text-xs text-muted-foreground text-right">Line total: <span className="font-semibold text-foreground">{fmtMoneyInr(purchaseLineTotalInr(line))}</span></p>
              </div>
            ))}

            <Button type="button" variant="outline" onClick={addPurchaseLine} className="rounded-xl gap-2 w-full">
              <Plus className="h-4 w-4" /> Add Another Item (different size/quality)
            </Button>

            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
              <span className="text-sm text-muted-foreground">Grand Total (INR)</span>
              <span className="font-display text-lg font-bold text-brand-dark">{fmtMoneyInr(grandTotalInr)}</span>
            </div>

            <div className="flex gap-2.5">
              <AsyncButton onClick={recordPurchase} disabled={recordingPurchase} className="btn-hero rounded-xl h-10">{recordingPurchase ? "Saving…" : purchaseLines.length > 1 ? `Save ${purchaseLines.length} Purchases` : "Save Purchase"}</AsyncButton>
              <Button variant="outline" onClick={() => { setShowPurchaseForm(false); resetPurchaseForm(); }} className="rounded-xl h-10">Cancel</Button>
            </div>
          </div>
        )}

        {showPayForm && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <p className="text-sm font-medium text-brand-dark">Record Payment</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Input type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} className="rounded-xl h-10" placeholder="Amount (₹)" />
              <Select value={payLockerId} onValueChange={setPayLockerId}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="From which locker?" /></SelectTrigger>
                <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={payTargetPurchase} onValueChange={setPayTargetPurchase}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__fifo">Oldest pending first (unspecified)</SelectItem>
                  {pendingPurchases.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.invoiceNumber || p.id.slice(-6)} — pending {fmtMoneyInr(purchasePending(p))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input value={payNote} onChange={e => setPayNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (optional)" />
            <div className="flex gap-2.5">
              <AsyncButton onClick={recordPayment} className="btn-hero rounded-xl h-10">Save Payment</AsyncButton>
              <Button variant="outline" onClick={() => setShowPayForm(false)} className="rounded-xl h-10">Cancel</Button>
            </div>
          </div>
        )}

        {showReceiveForm && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <p className="text-sm font-medium text-brand-dark">Receive from {supplier.name}</p>
            <p className="text-xs text-muted-foreground -mt-1.5">Money the supplier gave back (refund / return credit). It goes into a locker and reduces what you owe them.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input type="number" min={1} value={rcvAmount} onChange={e => setRcvAmount(e.target.value)} className="rounded-xl h-10" placeholder="Amount received (₹)" />
              <Select value={rcvLockerId} onValueChange={setRcvLockerId}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Into which locker?" /></SelectTrigger>
                <SelectContent>{db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR").map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Input value={rcvNote} onChange={e => setRcvNote(e.target.value)} className="rounded-xl h-10" placeholder="Note (e.g. refund for returned goods)" />
            <div className="flex gap-2.5">
              <AsyncButton onClick={recordReceipt} className="btn-hero rounded-xl h-10">Save Receipt</AsyncButton>
              <Button variant="outline" onClick={() => setShowReceiveForm(false)} className="rounded-xl h-10">Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Account Statement — full chronological ledger with a running balance,
          purchases and payments interleaved, like a bank/vendor statement. */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Account Statement</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{statement.length} entr{statement.length !== 1 ? "ies" : "y"} · running balance in INR</p>
        </div>
        <div className="divide-y divide-border/40">
          {statement.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${r.debit > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                {r.debit > 0 ? <TrendingUp className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.particulars}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(r.date)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-semibold ${r.debit > 0 ? "text-destructive" : "text-success"}`}>
                  {r.debit > 0 ? `+${fmtMoneyInr(r.debit)}` : `−${fmtMoneyInr(r.credit)}`}
                </p>
                <p className="text-[11px] text-muted-foreground">Bal: {fmtMoneyInr(r.balance)}</p>
              </div>
            </div>
          ))}
          {statement.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No entries yet.</div>}
        </div>
      </div>

      {/* Purchase history */}
      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="font-display text-xl text-brand-dark">Purchase History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{purchases.length} purchase{purchases.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="divide-y divide-border/40">
          {purchases.map(p => {
            const paid = purchasePaid(p);
            const pending = purchasePending(p);
            return (
              <div key={p.id} className="flex items-start gap-3 p-4">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-400/15 grid place-items-center shrink-0">
                  {p.material === "gold" ? <TrendingUp className="h-5 w-5 text-amber-600" /> : <Package className="h-5 w-5 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold">
                      {p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity} Gold` : `${p.diamond?.carat}ct Diamond${p.diamond?.quality ? ` (${p.diamond.quality})` : ""}`}
                    </p>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      {p.purpose === "order" ? "For Order" : "Stock"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(p.createdAt)}{p.invoiceNumber ? ` · Invoice ${p.invoiceNumber}` : ""}
                    {p.currency === "USD" && ` · $${p.totalUsd} @ ₹${p.exchangeRate}/$`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{fmtMoneyInr(p.totalInr)}</p>
                  <p className={`text-xs font-medium ${pending > 0 ? "text-destructive" : "text-success"}`}>
                    {pending > 0 ? `${fmtMoneyInr(pending)} pending` : "Paid"}
                  </p>
                  {paid > 0 && pending > 0 && <p className="text-[10px] text-muted-foreground">{fmtMoneyInr(paid)} paid so far</p>}
                  {user?.role === "admin" && paid === 0 && (
                    <button
                      onClick={() => voidPurchase(p)}
                      disabled={voidingId === p.id}
                      className="mt-1 text-[11px] text-destructive inline-flex items-center gap-1 hover:underline disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" /> {voidingId === p.id ? "Voiding…" : "Void"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {purchases.length === 0 && <div className="px-5 py-12 text-center text-muted-foreground">No purchases recorded yet.</div>}
        </div>
      </div>
    </div>
  );
}
