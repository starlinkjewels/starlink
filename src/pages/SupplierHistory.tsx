import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, type Purchase, type PurchaseMaterial, type PurchaseCurrency } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import {
  supplierAccount, purchasePaid, purchasePending, allocateSupplierPaymentFIFO, fmtMoneyInr,
} from "@/lib/manufacturing";
import { increaseStock } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Truck, Mail, Phone, MapPin, Hash, Wallet, Plus, CreditCard, Package, TrendingUp,
  Download, FileText, FileSpreadsheet,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { downloadCsv, downloadLedgerPdf, fmtInrPlain } from "@/lib/ledgerExport";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

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
  const account = supplierAccount(purchases);

  // ── Record purchase ──
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [material, setMaterial] = useState<PurchaseMaterial>("gold");
  const [purpose, setPurpose] = useState<"order" | "stock">("stock");
  const [orderNumber, setOrderNumber] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [goldWeight, setGoldWeight] = useState("");
  const [goldPurity, setGoldPurity] = useState("22K");
  const [goldRate, setGoldRate] = useState("");
  const [diaCarat, setDiaCarat] = useState("");
  const [diaQuality, setDiaQuality] = useState("");
  const [diaRate, setDiaRate] = useState("");
  const [totalUsd, setTotalUsd] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const computedInr =
    material === "gold" ? (Number(goldWeight) || 0) * (Number(goldRate) || 0)
    : (Number(diaCarat) || 0) * (Number(diaRate) || 0);
  const finalTotalInr = currency === "USD" ? Math.round((Number(totalUsd) || 0) * (Number(exchangeRate) || 0)) : Math.round(computedInr);

  const resetPurchaseForm = () => {
    setMaterial("gold"); setPurpose("stock"); setOrderNumber(""); setCurrency("INR");
    setGoldWeight(""); setGoldPurity("22K"); setGoldRate("");
    setDiaCarat(""); setDiaQuality(""); setDiaRate("");
    setTotalUsd(""); setExchangeRate(""); setInvoiceNumber(""); setNotes("");
  };

  const recordPurchase = async () => {
    if (material === "gold" && (!goldWeight || Number(goldWeight) <= 0)) { toast.error("Enter gold weight"); return; }
    if (material === "diamond" && (!diaCarat || Number(diaCarat) <= 0)) { toast.error("Enter diamond carat"); return; }
    if (currency === "USD" && (!totalUsd || !exchangeRate)) { toast.error("Enter the USD amount and exchange rate"); return; }
    if (purpose === "order" && !orderNumber.trim()) { toast.error("Enter the order number this purchase is for"); return; }
    if (finalTotalInr <= 0) { toast.error("Total comes to ₹0 — check the weight/rate fields"); return; }

    let linkedOrderId: string | undefined;
    if (purpose === "order") {
      const order = db.orders.find(o => o.orderNumber.trim().toLowerCase() === orderNumber.trim().toLowerCase());
      if (!order) { toast.error(`No order found matching "${orderNumber}"`); return; }
      linkedOrderId = order.id;
    }

    const purchaseId = uid("pur_");
    const now = new Date().toISOString();
    const purchase: Purchase = {
      id: purchaseId,
      supplierId: id!,
      material,
      gold: material === "gold" ? { weightGrams: Number(goldWeight), purity: goldPurity, ratePerGram: Number(goldRate) || 0 } : undefined,
      diamond: material === "diamond" ? { carat: Number(diaCarat), quality: diaQuality || undefined, ratePerCarat: Number(diaRate) || 0 } : undefined,
      purpose,
      orderId: linkedOrderId,
      currency,
      totalUsd: currency === "USD" ? Number(totalUsd) : undefined,
      exchangeRate: currency === "USD" ? Number(exchangeRate) : undefined,
      totalInr: finalTotalInr,
      payments: [],
      invoiceNumber: invoiceNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      createdBy: user!.id,
      createdAt: now,
    };

    try {
      // Stock increase must succeed before the purchase record is written, so
      // we never end up with a purchase that silently failed to update stock.
      if (purpose === "stock") {
        await increaseStock({
          material,
          purityOrQuality: material === "gold" ? goldPurity : (diaQuality || "unspecified"),
          quantity: material === "gold" ? Number(goldWeight) : Number(diaCarat),
          refType: "purchase",
          refId: purchaseId,
          createdBy: user!.id,
        });
      }
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        d.purchases.unshift(purchase);
        if (linkedOrderId) {
          const o = d.orders.find(o => o.id === linkedOrderId);
          if (o) {
            if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
            o.linkedPurchaseIds.push(purchaseId);
            if (!o.manufacturingLog) o.manufacturingLog = [];
            const qty = material === "gold" ? Number(goldWeight) : Number(diaCarat);
            const label = material === "gold" ? `${qty}g ${goldPurity} gold` : `${qty}ct diamond${diaQuality ? ` (${diaQuality})` : ""}`;
            o.manufacturingLog.push({
              id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
              material, amountMaterial: qty, amountInr: finalTotalInr,
              remarks: `Purchased ${label} from ${supplier.name} for this order — ${fmtMoneyInr(finalTotalInr)}`,
            });
          }
        }
      });
      toast.success(`Purchase recorded — ${fmtMoneyInr(finalTotalInr)}`);
      setShowPurchaseForm(false);
      resetPurchaseForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record purchase");
    }
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
    const now = new Date().toISOString();

    updateDb(d => {
      const supplierPurchases = d.purchases.filter(p => p.supplierId === id);
      if (payTargetPurchase === "__fifo") {
        allocateSupplierPaymentFIFO(supplierPurchases, amt, payLockerId, user!.id, now, payNote.trim() || undefined);
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
            {account.balanceOwed > 0 && (
              <Button onClick={() => setShowPayForm(v => !v)} variant="outline" className="rounded-xl gap-2">
                <CreditCard className="h-4 w-4" /> Record Payment
              </Button>
            )}
            <Button onClick={() => setShowPurchaseForm(v => !v)} className="btn-hero rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Record Purchase
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center"><p className="text-xs text-muted-foreground mb-1">Total Purchased</p><p className="font-semibold text-sm">{fmtMoneyInr(account.totalPurchased)}</p></div>
          <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center"><p className="text-xs text-muted-foreground mb-1">Total Paid</p><p className="font-semibold text-sm text-success">{fmtMoneyInr(account.totalPaid)}</p></div>
          <div className={`p-3 rounded-xl text-center border ${account.balanceOwed > 0 ? "bg-destructive/5 border-destructive/20" : "bg-success/8 border-success/20"}`}>
            <p className="text-xs text-muted-foreground mb-1">Balance Owed</p>
            <p className={`font-semibold text-sm ${account.balanceOwed > 0 ? "text-destructive" : "text-success"}`}>{account.balanceOwed > 0 ? fmtMoneyInr(account.balanceOwed) : "✓ Cleared"}</p>
          </div>
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-center"><p className="text-xs text-muted-foreground mb-1">Overpaid</p><p className="font-semibold text-sm text-primary">{fmtMoneyInr(account.overpaid)}</p></div>
        </div>

        {showPurchaseForm && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            <p className="text-sm font-medium text-brand-dark">Record Purchase</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Select value={material} onValueChange={v => setMaterial(v as PurchaseMaterial)}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
              </Select>
              <Select value={purpose} onValueChange={v => setPurpose(v as "order" | "stock")}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="stock">For General Stock</SelectItem><SelectItem value="order">For a Specific Order</SelectItem></SelectContent>
              </Select>
            </div>

            {purpose === "order" && (
              <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} className="rounded-xl h-10" placeholder="Order number, e.g. SLJ-2026-1020" />
            )}

            {material === "gold" ? (
              <div className="grid grid-cols-3 gap-2.5">
                <Input type="number" min={0} value={goldWeight} onChange={e => setGoldWeight(e.target.value)} className="rounded-xl h-10" placeholder="Weight (g)" />
                <Select value={goldPurity} onValueChange={setGoldPurity}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" min={0} value={goldRate} onChange={e => setGoldRate(e.target.value)} className="rounded-xl h-10" placeholder={`Rate/g (${currency})`} />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                <Input type="number" min={0} step="0.01" value={diaCarat} onChange={e => setDiaCarat(e.target.value)} className="rounded-xl h-10" placeholder="Carat" />
                <Input value={diaQuality} onChange={e => setDiaQuality(e.target.value)} className="rounded-xl h-10" placeholder="Quality (optional)" />
                <Input type="number" min={0} value={diaRate} onChange={e => setDiaRate(e.target.value)} className="rounded-xl h-10" placeholder={`Rate/ct (${currency})`} />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
              </Select>
              {currency === "USD" && (
                <>
                  <Input type="number" min={0} value={totalUsd} onChange={e => setTotalUsd(e.target.value)} className="rounded-xl h-10" placeholder="Total ($)" />
                  <Input type="number" min={0} step="0.01" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
                </>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="rounded-xl h-10" placeholder="Invoice # (optional)" />
              <Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
              <span className="text-sm text-muted-foreground">Total (INR)</span>
              <span className="font-display text-lg font-bold text-brand-dark">{fmtMoneyInr(finalTotalInr)}</span>
            </div>

            <div className="flex gap-2.5">
              <AsyncButton onClick={recordPurchase} className="btn-hero rounded-xl h-10">Save Purchase</AsyncButton>
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
                <SelectContent>{db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
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
