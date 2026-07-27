import { useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  loadDb, updateDb, fmtMoney, fmtDate, totalAdvance, orderTotal, balanceDue, uid, capOrderAdvances,
  type Order, type Purchase, type PurchaseMaterial, type PurchaseCurrency, type MaterialIssuance,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl } from "@/lib/storage";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Package, Printer,
  DollarSign, Plus, TrendingUp, AlertCircle, Wallet,
  ImagePlus, Truck, ExternalLink, Eye, Scale, Calculator, Minimize2, Maximize2, RotateCcw,
  Factory as FactoryIcon, Coins, Gem,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { printInvoice } from "@/lib/invoicePrint";
import { AsyncButton } from "@/components/AsyncButton";
import { fmtMoneyInr, purchasePending, issuancePending, manufacturingReadiness } from "@/lib/manufacturing";
import { decreaseStock } from "@/lib/stock";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

/** Compress a File to a base64 JPEG ≤800px */
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 900;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Order status derived purely from how many timeline steps are done — so a
 *  reverted (undone) stage downgrades the status correctly, not just upgrades. */
function statusFromTimeline(timeline: Order["timeline"]): Order["status"] {
  const total = timeline.length;
  const done = timeline.filter(t => t.status === "done").length;
  const finalApprovalIdx = timeline.findIndex(x => x.step === "Final Approval");
  const dispatchIdx = timeline.findIndex(x => x.step === "Dispatch");
  if (done >= total) return "Delivered";
  if (dispatchIdx >= 0 && done >= dispatchIdx + 1) return "Dispatched";
  if (finalApprovalIdx >= 0 && done >= finalApprovalIdx + 1) return "Ready";
  if (done >= 3) return "In Production";
  if (done >= 2) return "Approved";
  return "Waiting";
}

export function OrderDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();

  // Advance form state
  const [showAdvForm, setShowAdvForm] = useState(false);
  const [advAmt, setAdvAmt] = useState("");
  const [advNote, setAdvNote] = useState("");

  // CAD image
  const cadRef = useRef<HTMLInputElement>(null);
  const [cadUploading, setCadUploading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [cadView, setCadView] = useState<"fit" | "full">("fit"); // CAD preview: contained vs full-width

  // Dispatch form
  const [showDispatch, setShowDispatch] = useState(false);
  const [courierName, setCourierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingLink, setTrackingLink] = useState("");

  // Actual weights & pricing form
  const [showActualForm, setShowActualForm] = useState(false);
  const [actGrossW, setActGrossW] = useState("");
  const [actNetW, setActNetW] = useState("");
  const [actDiamW, setActDiamW] = useState("");
  const [actOrderValue, setActOrderValue] = useState("");
  const [actShipping, setActShipping] = useState("");

  // Pricing form (admin/employee set the order value — client never sets this)
  const [showPricing, setShowPricing] = useState(false);
  const [priceValue, setPriceValue] = useState("");
  const [priceShipping, setPriceShipping] = useState("");

  // Manufacturing — record a purchase / issue material for THIS order directly,
  // without leaving the page (order is already known, no order-number lookup needed).
  const [showBuyForm, setShowBuyForm] = useState(false);
  const [buyMaterial, setBuyMaterial] = useState<PurchaseMaterial>("gold");
  const [buySupplierId, setBuySupplierId] = useState("");
  const [buyCurrency, setBuyCurrency] = useState<PurchaseCurrency>("INR");
  const [buyGoldWeight, setBuyGoldWeight] = useState("");
  const [buyGoldPurity, setBuyGoldPurity] = useState("22K");
  const [buyGoldRate, setBuyGoldRate] = useState("");
  const [buyDiaCarat, setBuyDiaCarat] = useState("");
  const [buyDiaQuality, setBuyDiaQuality] = useState("");
  const [buyDiaRate, setBuyDiaRate] = useState("");
  const [buyTotalUsd, setBuyTotalUsd] = useState("");
  const [buyExchangeRate, setBuyExchangeRate] = useState("");
  const [buyInvoiceNumber, setBuyInvoiceNumber] = useState("");
  const [buyNotes, setBuyNotes] = useState("");
  const [buying, setBuying] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueMaterial, setIssueMaterial] = useState<"gold" | "diamond">("gold");
  const [issueFactoryId, setIssueFactoryId] = useState("");
  const [issueSource, setIssueSource] = useState<"stock" | "purchase">("stock");
  const [issuePurchaseId, setIssuePurchaseId] = useState("");
  const [issuePurity, setIssuePurity] = useState("22K");
  const [issueQuality, setIssueQuality] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issuing, setIssuing] = useState(false);

  const db = useDb();
  const order = db.orders.find(o => o.id === id);
  if (!order) return <div className="text-center py-20">Order not found. <Link to="/orders" className="text-primary underline">Back</Link></div>;

  const client = db.clients.find(c => c.id === order.clientId);
  const employee = db.users.find(u => u.id === order.assignedEmployeeId);
  const advances = order.advances || [];
  const advTotal = totalAdvance(order);
  const balance = balanceDue(order);
  // Any actual weight recorded? Drives the "Actual Details" display (all fields optional).
  const hasActuals = !!(order.actualNetWeight || order.actualGrossWeight || order.actualDiamondWeight);

  // ── Manufacturing: purchases/issuances linked to this order ──
  const linkedPurchases = db.purchases.filter(p => p.orderId === order.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const linkedIssuances = db.materialIssuances.filter(i => i.orderId === order.id).sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));

  const buyComputedInr =
    buyMaterial === "gold" ? (Number(buyGoldWeight) || 0) * (Number(buyGoldRate) || 0)
    : (Number(buyDiaCarat) || 0) * (Number(buyDiaRate) || 0);
  const buyFinalTotalInr = buyCurrency === "USD" ? Math.round((Number(buyTotalUsd) || 0) * (Number(buyExchangeRate) || 0)) : Math.round(buyComputedInr);

  const resetBuyForm = () => {
    setBuyMaterial("gold"); setBuySupplierId(""); setBuyCurrency("INR");
    setBuyGoldWeight(""); setBuyGoldPurity("22K"); setBuyGoldRate("");
    setBuyDiaCarat(""); setBuyDiaQuality(""); setBuyDiaRate("");
    setBuyTotalUsd(""); setBuyExchangeRate(""); setBuyInvoiceNumber(""); setBuyNotes("");
  };

  const recordPurchaseForOrder = async () => {
    if (!buySupplierId) { toast.error("Choose a supplier"); return; }
    if (buyMaterial === "gold" && (!buyGoldWeight || Number(buyGoldWeight) <= 0)) { toast.error("Enter gold weight"); return; }
    if (buyMaterial === "diamond" && (!buyDiaCarat || Number(buyDiaCarat) <= 0)) { toast.error("Enter diamond carat"); return; }
    if (buyCurrency === "USD" && (!buyTotalUsd || !buyExchangeRate)) { toast.error("Enter the USD amount and exchange rate"); return; }
    if (buyFinalTotalInr <= 0) { toast.error("Total comes to ₹0 — check the weight/rate fields"); return; }

    const supplier = db.suppliers.find(s => s.id === buySupplierId);
    const purchaseId = uid("pur_");
    const now = new Date().toISOString();
    const purchase: Purchase = {
      id: purchaseId,
      supplierId: buySupplierId,
      material: buyMaterial,
      gold: buyMaterial === "gold" ? { weightGrams: Number(buyGoldWeight), purity: buyGoldPurity, ratePerGram: Number(buyGoldRate) || 0 } : undefined,
      diamond: buyMaterial === "diamond" ? { carat: Number(buyDiaCarat), quality: buyDiaQuality || undefined, ratePerCarat: Number(buyDiaRate) || 0 } : undefined,
      purpose: "order",
      orderId: order.id,
      currency: buyCurrency,
      totalUsd: buyCurrency === "USD" ? Number(buyTotalUsd) : undefined,
      exchangeRate: buyCurrency === "USD" ? Number(buyExchangeRate) : undefined,
      totalInr: buyFinalTotalInr,
      payments: [],
      invoiceNumber: buyInvoiceNumber.trim() || undefined,
      notes: buyNotes.trim() || undefined,
      createdBy: user!.id,
      createdAt: now,
    };
    setBuying(true);
    try {
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        d.purchases.unshift(purchase);
        const o = d.orders.find(o => o.id === order.id);
        if (o) {
          if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
          o.linkedPurchaseIds.push(purchaseId);
          if (!o.manufacturingLog) o.manufacturingLog = [];
          const qty = buyMaterial === "gold" ? Number(buyGoldWeight) : Number(buyDiaCarat);
          const label = buyMaterial === "gold" ? `${qty}g ${buyGoldPurity} gold` : `${qty}ct diamond${buyDiaQuality ? ` (${buyDiaQuality})` : ""}`;
          o.manufacturingLog.push({
            id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
            material: buyMaterial, amountMaterial: qty, amountInr: buyFinalTotalInr,
            remarks: `Purchased ${label} from ${supplier?.name || "supplier"} for this order — ${fmtMoneyInr(buyFinalTotalInr)}`,
          });
        }
      });
      toast.success(`Purchase recorded — ${fmtMoneyInr(buyFinalTotalInr)}`);
      setShowBuyForm(false);
      resetBuyForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record purchase");
    } finally { setBuying(false); }
  };

  // Purchases bought specifically for this order, of the selected material, not
  // already drawn on by an earlier issuance — lets material go straight to the
  // factory without a phantom detour through shared Stock.
  const eligiblePurchases = linkedPurchases.filter(p => {
    if (p.purpose !== "order" || p.material !== issueMaterial) return false;
    const alreadyUsed = db.materialIssuances.some(i => i.source === "purchase" && i.sourcePurchaseId === p.id);
    return !alreadyUsed;
  });

  const resetIssueForm = () => {
    setIssueFactoryId(""); setIssueSource("stock"); setIssuePurchaseId("");
    setIssuePurity("22K"); setIssueQuality(""); setIssueQuantity(""); setIssueNotes("");
  };

  const issueMaterialToFactory = async () => {
    const qty = Number(issueQuantity);
    if (!issueFactoryId) { toast.error("Choose a factory"); return; }
    if (!qty || qty <= 0) { toast.error(`Enter the ${issueMaterial} quantity to issue`); return; }
    const purityOrQuality = issueMaterial === "gold" ? issuePurity : (issueQuality.trim() || "unspecified");
    if (issueSource === "purchase" && !issuePurchaseId) { toast.error("Choose which purchase this comes from"); return; }

    const factory = db.factories.find(f => f.id === issueFactoryId);
    const issuanceId = uid("mi_");
    const now = new Date().toISOString();
    setIssuing(true);
    try {
      if (issueSource === "stock") {
        await decreaseStock({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Issued to ${factory?.name || "factory"} for order ${order.orderNumber}`,
        });
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: issueFactoryId, orderId: order.id, material: issueMaterial,
          purityOrQuality, quantityIssued: qty,
          source: issueSource, sourcePurchaseId: issueSource === "purchase" ? issuePurchaseId : undefined,
          issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
          notes: issueNotes.trim() || undefined,
        };
        d.materialIssuances.unshift(issuance);
        const o = d.orders.find(o => o.id === order.id);
        if (o) {
          if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
          o.materialIssuanceIds.push(issuanceId);
          if (!o.manufacturingLog) o.manufacturingLog = [];
          o.manufacturingLog.push({
            id: uid("mlog_"), type: "material_issued", at: now, employeeId: user!.id, factoryId: issueFactoryId,
            material: issueMaterial, amountMaterial: qty,
            remarks: `${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} issued to ${factory?.name || "factory"}${issueSource === "purchase" ? " (from a purchase made for this order)" : ""}`,
          });
        }
      });
      toast.success(`${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} issued to ${factory?.name || "factory"}`);
      setShowIssueForm(false);
      resetIssueForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to issue material");
    } finally { setIssuing(false); }
  };

  // Admin, or the employee who owns this order (assigned to them OR the account
  // manager of the order's client) — full control of their own clients' orders.
  const canEditStage = () => user!.role === "admin"
    || (user!.role === "employee" && (order.assignedEmployeeId === user!.id || client?.accountManagerId === user!.id));

  // "Final Approval" can't be marked complete until the gold/diamond this
  // order actually needs has been issued to a factory — admins can still
  // force it through (e.g. material sourced outside this system) so a
  // legacy or edge-case order can never get permanently stuck.
  const readiness = manufacturingReadiness(order, db.materialIssuances);

  const advanceStep = (idx: number, overrideReadiness = false) => {
    if (order.timeline[idx].step === "Final Approval" && !overrideReadiness && !readiness.ready) {
      toast.error(`Issue ${readiness.missing.join(" and ")} to a factory before Final Approval`);
      return;
    }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.timeline[idx] = { ...o.timeline[idx], status: "done", date: new Date().toISOString(), employeeId: user!.id, department: user!.department, remarks: "Completed" };
      if (idx + 1 < o.timeline.length && o.timeline[idx + 1].status === "pending") o.timeline[idx + 1].status = "in_progress";
      const done = o.timeline.filter(t => t.status === "done").length;
      const finalApprovalIdx = o.timeline.findIndex(x => x.step === "Final Approval");
      const dispatchIdx      = o.timeline.findIndex(x => x.step === "Dispatch");
      if (done >= 2 && o.status === "Waiting") o.status = "Approved";
      if (done >= 3 && done < finalApprovalIdx + 1) o.status = "In Production";
      if (done >= finalApprovalIdx + 1) o.status = "Ready";
      if (done >= dispatchIdx + 1) o.status = "Dispatched";
      if (done === o.timeline.length) o.status = "Delivered";
      const clientUser = d.users.find(u => u.clientId === o.clientId);
      if (clientUser) d.notifications.unshift({ id: "n" + Date.now(), userId: clientUser.id, title: "Timeline updated", body: `${o.orderNumber}: ${o.timeline[idx].step}`, type: "info", read: false, createdAt: new Date().toISOString() });
    });
    toast.success("Stage marked complete");
  };

  const forceAdvanceStep = (idx: number) => {
    if (!confirm(`Mark Final Approval complete without recording ${readiness.missing.join(" and ")} issuance? Only do this if the material was sourced outside this system.`)) return;
    advanceStep(idx, true);
  };

  // Undo a stage marked complete by mistake — this stage becomes the current
  // (in-progress) one and every later stage is reset to not-done; the order
  // status is recomputed from what's left done.
  const revertStep = (idx: number) => {
    if (!confirm("Undo this stage? This stage and any later ones will be marked not done, and the order status will update.")) return;
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      for (let i = idx; i < o.timeline.length; i++) {
        o.timeline[i] = { ...o.timeline[i], status: "pending", date: undefined, employeeId: undefined, department: undefined, remarks: undefined };
      }
      o.timeline[idx].status = "in_progress";
      o.status = statusFromTimeline(o.timeline);
    });
    toast.success("Stage reverted");
  };

  const approve = (yes: boolean) => {
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.status = yes ? "Approved" : "Rejected";
      if (yes) {
        o.timeline[0].status = "done"; o.timeline[0].date = new Date().toISOString();
        o.timeline[1].status = "done"; o.timeline[1].date = new Date().toISOString();
        if (o.timeline[2]) o.timeline[2].status = "in_progress";
      }
    });
    toast.success(yes ? "Order approved" : "Order rejected");
  };

  const addAdvance = () => {
    const amt = parseFloat(advAmt);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    let paidInFull = false;
    let isFirst = false;
    let toCredit = 0;
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      if (!o.advances) o.advances = [];
      // Never let a single order be paid beyond its balance — cap at the balance
      // and send the excess to the client's credit so it can clear other bills.
      const bal = balanceDue(o);
      const applied = Math.min(amt, bal);
      toCredit = Math.round((amt - applied) * 100) / 100;
      isFirst = o.advances.length === 0;
      if (applied > 0) {
        // First payment on the order is the "advance"; every later collection is a
        // regular payment; the one that clears the balance is the "final payment".
        paidInFull = totalAdvance(o) + applied >= orderTotal(o);
        const defaultNote = paidInFull ? "Final Payment" : isFirst ? "Advance payment" : "Payment received";
        o.advances.push({ id: uid("adv_"), amount: applied, note: advNote || defaultNote, recordedBy: user!.id, createdAt: new Date().toISOString() });
      }
      if (toCredit > 0) {
        const c = d.clients.find(x => x.id === o.clientId);
        if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + toCredit) * 100) / 100;
      }
      const clientUser = d.users.find(u => u.clientId === o.clientId);
      if (clientUser && applied > 0) d.notifications.unshift({
        id: uid("n_"), userId: clientUser.id,
        title: paidInFull ? "Order Paid in Full" : isFirst ? "Advance Recorded" : "Payment Recorded",
        body: paidInFull
          ? `${o.orderNumber} paid in full — final payment of ${fmtMoney(applied)} received`
          : isFirst
          ? `${fmtMoney(applied)} advance received for ${o.orderNumber}`
          : `${fmtMoney(applied)} payment received for ${o.orderNumber}`,
        type: "info", read: false, createdAt: new Date().toISOString(),
      });
    });
    toast.success(
      toCredit > 0
        ? `Payment recorded — ${fmtMoney(toCredit)} added to client credit`
        : paidInFull ? "Final payment recorded — order paid in full"
        : isFirst ? "Advance payment recorded" : "Payment recorded"
    );
    setAdvAmt(""); setAdvNote(""); setShowAdvForm(false);
  };

  const saveCadImage = async (file: File) => {
    setCadUploading(true);
    try {
      const compressed = await compressImage(file);
      const cadUrl = await uploadDataUrl(compressed, `orders/${order.id}/cad`);
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.cadImage = cadUrl;
        const clientUser = d.users.find(u => u.clientId === o.clientId);
        if (clientUser) d.notifications.unshift({ id: uid("n_"), userId: clientUser.id, title: "CAD Design Ready", body: `CAD design uploaded for ${o.orderNumber}. Please review.`, type: "info", read: false, createdAt: new Date().toISOString() });
      });
      toast.success("CAD image uploaded — client notified");
    } catch { toast.error("Failed to upload image"); }
    setCadUploading(false);
  };

  const saveActualDetails = () => {
    // Every field is optional — update only what was actually filled in, and
    // never overwrite an existing value with a blank.
    const gw = parseFloat(actGrossW);
    const nw = parseFloat(actNetW);
    const dw = parseFloat(actDiamW);
    const val = parseFloat(actOrderValue);
    const ship = parseFloat(actShipping);
    const has = (n: number) => !isNaN(n) && n > 0;
    const shipEntered = actShipping.trim() !== "" && !isNaN(ship) && ship >= 0;
    if (!has(gw) && !has(nw) && !has(dw) && !has(val) && !shipEntered) {
      toast.error("Enter at least one value to update");
      return;
    }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      if (has(gw)) o.actualGrossWeight   = gw;
      if (has(nw)) o.actualNetWeight     = nw;
      if (has(dw)) o.actualDiamondWeight = dw;
      if (shipEntered) o.shippingCharge = ship;
      if (has(val)) {
        o.amount = val;
        const clientUser = d.users.find(u => u.clientId === o.clientId);
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id,
          title: "Order Finalized",
          body: `${o.orderNumber} final amount confirmed: ${fmtMoney(val)}${(o.shippingCharge || 0) > 0 ? ` + ${fmtMoney(o.shippingCharge)} shipping` : ""}`,
          type: "info", read: false, createdAt: new Date().toISOString(),
        });
      }
      // If the (possibly lowered) value now sits below what's already paid, move
      // the overpaid excess to the client's credit so it can clear other bills.
      const back = capOrderAdvances(o);
      if (back > 0) {
        const c = d.clients.find(x => x.id === o.clientId);
        if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + back) * 100) / 100;
      }
    });
    toast.success("Actual details saved");
    setShowActualForm(false);
  };

  const saveDispatch = () => {
    if (!courierName.trim() || !trackingNumber.trim()) {
      toast.error("Enter both courier name and tracking number");
      return;
    }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.courierName = courierName.trim();
      o.trackingNumber = trackingNumber.trim();
      o.trackingLink = trackingLink.trim() || undefined;
      const clientUser = d.users.find(u => u.clientId === o.clientId);
      if (clientUser) d.notifications.unshift({ id: uid("n_"), userId: clientUser.id, title: "Order Dispatched", body: `${o.orderNumber} dispatched via ${courierName.trim()} · Tracking: ${trackingNumber.trim()}`, type: "info", read: false, createdAt: new Date().toISOString() });
    });
    toast.success("Dispatch info saved — client notified");
    setShowDispatch(false);
  };

  const savePricing = () => {
    const val = parseFloat(priceValue);
    const ship = parseFloat(priceShipping) || 0;
    if (!val || val <= 0) { toast.error("Enter a valid order value"); return; }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.amount = val;
      o.shippingCharge = ship;
      const clientUser = d.users.find(u => u.clientId === o.clientId);
      if (clientUser) d.notifications.unshift({ id: uid("n_"), userId: clientUser.id, title: "Order Priced", body: `${o.orderNumber} order value set to ${fmtMoney(val)}${ship > 0 ? ` + ${fmtMoney(ship)} shipping` : ""}`, type: "info", read: false, createdAt: new Date().toISOString() });
    });
    toast.success("Pricing saved — client notified");
    setShowPricing(false);
  };

  // Conditions for CAD and Dispatch sections
  const cadStepIdx   = order.timeline.findIndex(t => t.step === "CAD Designing");
  const dispStepIdx  = order.timeline.findIndex(t => t.step === "Dispatch");
  const showCadSection  = cadStepIdx >= 0 && order.timeline[cadStepIdx].status !== "pending";
  const showDispSection = !!order.courierName || (
    canEditStage() && dispStepIdx >= 0 && order.timeline[dispStepIdx].status !== "pending"
  );

  const handlePrintInvoice = () => {
    const existing = db.invoices.find(i => i.orderId === order.id);
    const amount = orderTotal(order);
    const paid = balance <= 0;
    let invNumber: string;
    if (existing) {
      // Stable number, reused on every reprint — keep amount/paid status current.
      invNumber = existing.number;
      if (existing.amount !== amount || existing.paid !== paid) {
        updateDb(d => {
          const i = d.invoices.find(x => x.id === existing.id);
          if (i) { i.amount = amount; i.paid = paid; }
        });
      }
    } else {
      // First time this order is billed — assign the next number in sequence.
      invNumber = String(db.invoices.length + 1).padStart(4, "0");
      updateDb(d => {
        d.invoices.push({ id: uid("inv_"), orderId: order.id, clientId: order.clientId, number: invNumber, amount, paid, createdAt: new Date().toISOString() });
      });
    }
    printInvoice(order, client, db.settings, invNumber);
  };

  return (
    <>
    <div className="max-w-5xl mx-auto space-y-5">
      <button onClick={() => nav(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>

      {/* Order Header */}
      <div className="card-luxe p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center">
              <Package className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{order.orderNumber}</p>
              <h1 className="font-display text-2xl md:text-3xl text-brand-dark">{order.jewelleryType} in {order.metal}</h1>
              <p className="text-sm text-muted-foreground mt-1">{client?.companyName} · {order.contactPerson}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={order.status} />
            <Button variant="outline" onClick={handlePrintInvoice} className="rounded-xl"><Printer className="h-4 w-4 mr-2" />Print / Download Bill</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          {([
            ["Quantity", `${order.quantity} pcs`],
            ["Est. Diamond Wt", `${order.diamondWeight} ct (${order.diamondType})`],
            ...(order.estimatedGrossWeight ? [["Est. Gross Weight", `${order.estimatedGrossWeight}g`]] : []),
            ...(order.estimatedNetWeight   ? [["Est. Net Weight",   `${order.estimatedNetWeight}g`]]   : []),
            ["Priority", order.priority],
            ["Delivery Date", fmtDate(order.expectedDelivery)],
            ["Assigned to", employee?.name || "—"],
            ["Created", fmtDate(order.createdAt)],
            ...(order.designNumber  ? [["Design Number",  order.designNumber]]  : []),
            ...(order.productColor  ? [["Color",          order.productColor]]  : []),
            ...(order.productKarats ? [["Karats",         order.productKarats]] : []),
            ...(order.productSize   ? [["Product Size",   order.productSize]]   : []),
            ...(order.deliveryTime  ? [["Delivery Time",  order.deliveryTime]]  : []),
            ...(order.rhodium       ? [["Rhodium",        order.rhodium]]       : []),
            ...(order.stamping      ? [["Stamping",       order.stamping]]      : []),
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}><p className="text-xs text-muted-foreground">{k}</p><p className="font-medium mt-0.5">{v}</p></div>
          ))}
        </div>

        {/* ── Pricing — set/edited by admin & employee only, never by the client ── */}
        {user!.role !== "client" && (
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Order Value</p>
                  <p className={`font-medium mt-0.5 ${order.amount ? "" : "text-muted-foreground italic"}`}>
                    {order.amount ? fmtMoney(order.amount) : "Pricing pending"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Shipping</p>
                  <p className="font-medium mt-0.5">{(order.shippingCharge || 0) > 0 ? fmtMoney(order.shippingCharge) : "—"}</p>
                </div>
              </div>
              {canEditStage() && (
                <Button
                  size="sm" variant="outline" className="rounded-xl gap-2"
                  onClick={() => {
                    setPriceValue(order.amount ? String(order.amount) : "");
                    setPriceShipping(order.shippingCharge ? String(order.shippingCharge) : "");
                    setShowPricing(v => !v);
                  }}
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  {order.amount ? "Edit Pricing" : "Set Pricing"}
                </Button>
              )}
            </div>

            <AnimatePresence>
              {showPricing && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 mt-1 grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Order Value ($) *</Label>
                      <Input
                        type="number" min={0} step="0.01" autoFocus
                        value={priceValue}
                        onChange={e => setPriceValue(e.target.value)}
                        className="rounded-xl h-10"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Shipping Charge ($)</Label>
                      <Input
                        type="number" min={0} step="0.01"
                        value={priceShipping}
                        onChange={e => setPriceShipping(e.target.value)}
                        className="rounded-xl h-10"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <AsyncButton size="sm" onClick={savePricing} className="btn-hero rounded-xl">Save &amp; Notify Client</AsyncButton>
                    <Button size="sm" variant="outline" onClick={() => setShowPricing(false)} className="rounded-xl">Cancel</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Reference images */}
        {order.images && order.images.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">Reference Images</p>
            <div className="flex gap-2 flex-wrap">
              {order.images.map((src, i) => (
                <button key={i} type="button" onClick={() => setLightboxSrc(src)}
                  className="h-20 w-20 rounded-xl overflow-hidden border border-border hover:border-primary/50 transition-colors group relative">
                  <img src={src} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye className="h-4 w-4 text-white" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {order.instructions && (
          <div className="mt-4 p-3 rounded-xl bg-secondary text-sm">
            <p className="text-xs text-muted-foreground mb-1">Special Instructions</p>
            {order.instructions}
          </div>
        )}

        {canEditStage() && order.status === "Waiting" && (
          <div className="mt-5 flex gap-3">
            <AsyncButton onClick={() => approve(true)} className="btn-hero rounded-xl">Approve Order</AsyncButton>
            <AsyncButton variant="outline" onClick={() => approve(false)} className="rounded-xl">Reject</AsyncButton>
          </div>
        )}
      </div>

      {/* ── Actual Weights & Final Pricing Card ── */}
      {user!.role !== "client" && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 grid place-items-center">
                <Scale className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-display text-lg text-brand-dark">Actual Weights & Final Pricing</h3>
                <p className="text-xs text-muted-foreground">
                  {hasActuals
                    ? "Actual weight and final order value on file"
                    : "Fill in after the piece is ready (post Final Approval)"}
                </p>
              </div>
            </div>
            {canEditStage() && (
              <Button
                size="sm" variant="outline" className="rounded-xl gap-2"
                onClick={() => {
                  setActGrossW(order.actualGrossWeight ? String(order.actualGrossWeight) : "");
                  setActNetW(order.actualNetWeight ? String(order.actualNetWeight) : "");
                  setActDiamW(order.actualDiamondWeight ? String(order.actualDiamondWeight) : "");
                  setActOrderValue(order.amount ? String(order.amount) : "");
                  setActShipping(order.shippingCharge ? String(order.shippingCharge) : "");
                  setShowActualForm(v => !v);
                }}
              >
                <Calculator className="h-3.5 w-3.5" />
                {hasActuals ? "Edit Actual Details" : "Enter Actual Details"}
              </Button>
            )}
          </div>

          {/* Estimated vs actual comparison */}
          {(order.estimatedGrossWeight || order.estimatedNetWeight || order.diamondWeight) && (
            <div className="rounded-xl bg-secondary/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Estimated at Order Time</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {order.estimatedGrossWeight ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Gross Weight</p>
                    <p className="font-medium">{order.estimatedGrossWeight}g</p>
                  </div>
                ) : <div />}
                {order.estimatedNetWeight ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Net Weight</p>
                    <p className="font-medium">{order.estimatedNetWeight}g</p>
                  </div>
                ) : <div />}
                <div>
                  <p className="text-xs text-muted-foreground">Diamond Weight</p>
                  <p className="font-medium">{order.diamondWeight}ct</p>
                </div>
              </div>
            </div>
          )}

          {/* Filled actual details */}
          {hasActuals && !showActualForm && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actual Details (Confirmed)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {order.actualGrossWeight && (
                  <div className="p-3 rounded-xl bg-secondary text-sm">
                    <p className="text-xs text-muted-foreground">Gross Weight</p>
                    <p className="font-semibold">{order.actualGrossWeight}g</p>
                  </div>
                )}
                {order.actualNetWeight && (
                  <div className="p-3 rounded-xl bg-secondary text-sm">
                    <p className="text-xs text-muted-foreground">Net Weight</p>
                    <p className="font-semibold">{order.actualNetWeight}g</p>
                  </div>
                )}
                {order.actualDiamondWeight && (
                  <div className="p-3 rounded-xl bg-secondary text-sm">
                    <p className="text-xs text-muted-foreground">Diamond Weight</p>
                    <p className="font-semibold">{order.actualDiamondWeight}ct</p>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border/60 p-3 space-y-2 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Pricing</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order Value</span>
                  <span className="font-medium">{fmtMoney(order.amount)}</span>
                </div>
                {(order.shippingCharge ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping Charge</span>
                    <span className="font-medium">{fmtMoney(order.shippingCharge)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-border/60">
                  <span className="font-semibold">Final Order Value</span>
                  <span className="font-bold text-primary">{fmtMoney(orderTotal(order))}</span>
                </div>
              </div>
            </div>
          )}

          {/* Pending notice */}
          {!hasActuals && !showActualForm && (
            <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Actual details not yet entered</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Enter actual weight and set the order value after the piece is ready.
                </p>
              </div>
            </div>
          )}

          {/* Edit / entry form */}
          <AnimatePresence>
            {showActualForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-3 border-t border-border/60 space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Actual Weights</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Gross Weight (g)</Label>
                        <Input type="number" step="0.001" min={0} value={actGrossW}
                          onChange={e => setActGrossW(e.target.value)}
                          className="rounded-xl h-10" placeholder="0.000" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Net Weight (g)</Label>
                        <Input type="number" step="0.001" min={0} value={actNetW}
                          onChange={e => setActNetW(e.target.value)}
                          className="rounded-xl h-10" placeholder="0.000" autoFocus />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Diamond Weight (ct)</Label>
                        <Input type="number" step="0.001" min={0} value={actDiamW}
                          onChange={e => setActDiamW(e.target.value)}
                          className="rounded-xl h-10" placeholder="0.000" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pricing</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Order Value ($)</Label>
                        <Input type="number" step="0.01" min={0} value={actOrderValue}
                          onChange={e => setActOrderValue(e.target.value)}
                          className="rounded-xl h-10" placeholder="0" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Shipping Charge ($)</Label>
                        <Input type="number" step="0.01" min={0} value={actShipping}
                          onChange={e => setActShipping(e.target.value)}
                          className="rounded-xl h-10" placeholder="0" />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <AsyncButton size="sm" onClick={saveActualDetails} className="btn-hero rounded-xl">Save Details</AsyncButton>
                    <Button size="sm" variant="outline" onClick={() => setShowActualForm(false)} className="rounded-xl">Cancel</Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── CAD Design Card ── */}
      {showCadSection && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
                <ImagePlus className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-display text-lg text-brand-dark">CAD Design</h3>
                <p className="text-xs text-muted-foreground">
                  {order.cadImage ? "CAD image on file — visible to client" : "No CAD image uploaded yet"}
                </p>
              </div>
            </div>
            {canEditStage() && (
              <div>
                <input
                  ref={cadRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (file) await saveCadImage(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => cadRef.current?.click()}
                  disabled={cadUploading}
                  className="rounded-xl gap-2"
                >
                  <ImagePlus className="h-4 w-4" />
                  {cadUploading ? "Uploading…" : order.cadImage ? "Replace CAD" : "Upload CAD Image"}
                </Button>
              </div>
            )}
          </div>

          {order.cadImage && (
            <div className="space-y-2">
              {/* View toggle — Fit (whole image) / Full (fills width). Tap image to zoom. */}
              <div className="flex items-center justify-end">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border/60">
                  <button
                    type="button" onClick={() => setCadView("fit")} aria-label="Fit view"
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${cadView === "fit" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                    <Minimize2 className="h-3.5 w-3.5" /> Fit
                  </button>
                  <button
                    type="button" onClick={() => setCadView("full")} aria-label="Full view"
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${cadView === "full" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                    <Maximize2 className="h-3.5 w-3.5" /> Full
                  </button>
                </div>
              </div>

              <div className="relative group rounded-xl border border-border bg-secondary/40 overflow-hidden">
                <img
                  src={order.cadImage}
                  alt="CAD Design"
                  className={`w-full max-w-full object-contain mx-auto cursor-pointer transition-all ${cadView === "fit" ? "max-h-72 sm:max-h-80" : "max-h-none"}`}
                  onClick={() => setLightboxSrc(order.cadImage!)}
                />
                <button
                  type="button"
                  onClick={() => setLightboxSrc(order.cadImage!)}
                  className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-black/50 text-white grid place-items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  aria-label="Zoom CAD image"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center">Tap the image to zoom · {cadView === "fit" ? "showing whole design" : "full width"}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Dispatch Information Card ── */}
      {showDispSection && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 grid place-items-center">
                <Truck className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h3 className="font-display text-lg text-brand-dark">Dispatch Details</h3>
                <p className="text-xs text-muted-foreground">Courier and tracking information</p>
              </div>
            </div>
            {canEditStage() && (
              <Button size="sm" variant="outline" onClick={() => {
                setCourierName(order.courierName ?? "");
                setTrackingNumber(order.trackingNumber ?? "");
                setTrackingLink(order.trackingLink ?? "");
                setShowDispatch(v => !v);
              }} className="rounded-xl gap-2">
                <Truck className="h-4 w-4" />
                {order.courierName ? "Update Info" : "Add Dispatch Info"}
              </Button>
            )}
          </div>

          {/* Saved dispatch info */}
          {order.courierName && !showDispatch && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-secondary">
                <p className="text-xs text-muted-foreground mb-1">Courier Company</p>
                <p className="font-semibold">{order.courierName}</p>
              </div>
              <div className="p-4 rounded-xl bg-secondary">
                <p className="text-xs text-muted-foreground mb-1">Tracking Number</p>
                <p className="font-semibold font-mono">{order.trackingNumber}</p>
              </div>
              {order.trackingLink && (
                <div className="sm:col-span-2 p-4 rounded-xl bg-secondary">
                  <p className="text-xs text-muted-foreground mb-1">Tracking Link</p>
                  <a
                    href={order.trackingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-primary font-semibold text-sm hover:underline break-all"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    {order.trackingLink}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Edit form */}
          <AnimatePresence>
            {showDispatch && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-2 border-t border-border/60 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Courier Company Name</Label>
                      <Input
                        value={courierName}
                        onChange={e => setCourierName(e.target.value)}
                        className="rounded-xl h-10"
                        placeholder="e.g. FedEx, DHL, UPS"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tracking Number</Label>
                      <Input
                        value={trackingNumber}
                        onChange={e => setTrackingNumber(e.target.value)}
                        className="rounded-xl h-10 font-mono"
                        placeholder="e.g. 1Z999AA10123456784"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Tracking Link (optional)</Label>
                      <Input
                        value={trackingLink}
                        onChange={e => setTrackingLink(e.target.value)}
                        className="rounded-xl h-10"
                        placeholder="e.g. https://fedex.com/track?id=..."
                        type="url"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <AsyncButton size="sm" onClick={saveDispatch} className="btn-hero rounded-xl">Save &amp; Notify Client</AsyncButton>
                    <Button size="sm" variant="outline" onClick={() => setShowDispatch(false)} className="rounded-xl">Cancel</Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Advance Payment Card ── */}
      <div className="card-luxe p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center">
              <Wallet className="h-5 w-5 text-success" />
            </div>
            <div>
              <h3 className="font-display text-lg text-brand-dark">Payments</h3>
              <p className="text-xs text-muted-foreground">
                {advances.length} payment{advances.length !== 1 ? "s" : ""} recorded
                {advances.length > 0 && balance <= 0 && <span className="text-success font-medium"> · Paid in full</span>}
              </p>
            </div>
          </div>
          {canEditStage() && balance > 0 && (
            <Button size="sm" onClick={() => setShowAdvForm(v => !v)} className="btn-hero rounded-xl gap-2">
              <Plus className="h-4 w-4" /> {advances.length === 0 ? "Add Advance" : "Collect Payment"}
            </Button>
          )}
        </div>

        {/* Summary strip */}
        {(() => {
          const shipping = order.shippingCharge || 0;
          const certFee  = order.certificateFee || 0;
          const total    = orderTotal(order);
          const extraCols = (shipping > 0 ? 1 : 0) + (certFee > 0 ? 1 : 0);
          const totalCols = 2 + extraCols; // base 2 (advance + balance) + value col + extras
          const gridCols = totalCols <= 3 ? "sm:grid-cols-3" : totalCols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-5";
          return (
            <div className={`grid gap-3 grid-cols-2 ${gridCols}`}>
              <div className="p-3 rounded-xl bg-secondary text-center">
                <p className="text-xs text-muted-foreground mb-1">Order Value</p>
                <p className="font-semibold text-sm">{fmtMoney(order.amount)}</p>
              </div>
              {shipping > 0 && (
                <div className="p-3 rounded-xl bg-secondary text-center">
                  <p className="text-xs text-muted-foreground mb-1">Shipping</p>
                  <p className="font-semibold text-sm">{fmtMoney(shipping)}</p>
                </div>
              )}
              {certFee > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Certificate</p>
                  <p className="font-semibold text-sm text-amber-700">{fmtMoney(certFee)}</p>
                </div>
              )}
              <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center">
                <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                <p className="font-semibold text-sm text-success">{fmtMoney(advTotal)}</p>
              </div>
              <div className={`p-3 rounded-xl text-center border ${balance > 0 ? "bg-destructive/5 border-destructive/20" : "bg-success/8 border-success/20"}`}>
                <p className="text-xs text-muted-foreground mb-1">Balance Due</p>
                <p className={`font-semibold text-sm ${balance > 0 ? "text-destructive" : "text-success"}`}>
                  {balance > 0 ? fmtMoney(balance) : "✓ Cleared"}
                </p>
              </div>
              {(shipping > 0 || certFee > 0) && (
                <div className={`col-span-2 ${gridCols.replace("sm:grid-cols-", "sm:col-span-")} px-1 pt-0.5 text-xs text-muted-foreground`}>
                  Order Total: <span className="font-semibold text-foreground">{fmtMoney(total)}</span>
                  {certFee > 0 && <span className="ml-1 text-amber-600">(incl. {fmtMoney(certFee)} certificate fee)</span>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Progress bar */}
        {orderTotal(order) > 0 && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Payment progress</span>
              <span>{Math.min(100, Math.round(advTotal / orderTotal(order) * 100))}%</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-success to-emerald-400 transition-all"
                style={{ width: `${Math.min(100, (advTotal / orderTotal(order)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Add advance form */}
        <AnimatePresence>
          {showAdvForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-2 border-t border-border/60 space-y-3">
                <p className="text-sm font-medium text-brand-dark">{advances.length === 0 ? "Record Advance" : "Collect Payment"}</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount ($)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="number" min="1" step="0.01"
                        value={advAmt} onChange={e => setAdvAmt(e.target.value)}
                        className="pl-9 rounded-xl h-10"
                        placeholder="0.00"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Payment Note</Label>
                    <Input
                      value={advNote} onChange={e => setAdvNote(e.target.value)}
                      className="rounded-xl h-10"
                      placeholder="e.g. Cash, Bank transfer, Cheque #"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <AsyncButton size="sm" onClick={addAdvance} className="btn-hero rounded-xl">Save Payment</AsyncButton>
                  <Button size="sm" variant="outline" onClick={() => { setShowAdvForm(false); setAdvAmt(""); setAdvNote(""); }} className="rounded-xl">Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Advance ledger */}
        {advances.length > 0 ? (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment History</p>
            {advances.map((a, i) => {
              const recorder = db.users.find(u => u.id === a.recordedBy);
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/50 border border-border/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-success/15 grid place-items-center shrink-0">
                      <TrendingUp className="h-4 w-4 text-success" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{a.note}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(a.createdAt)} · by {recorder?.name || "Admin"}
                      </p>
                    </div>
                  </div>
                  <p className="font-semibold text-success shrink-0">{fmtMoney(a.amount)}</p>
                </motion.div>
              );
            })}

            {/* Running total row */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                {balance <= 0
                  ? <CheckCircle2 className="h-4 w-4 text-success" />
                  : <AlertCircle className="h-4 w-4 text-warning-foreground" />}
                <span className="text-sm font-semibold">{balance <= 0 ? "Fully paid" : "Outstanding balance"}</span>
              </div>
              <span className={`font-bold ${balance > 0 ? "text-destructive" : "text-success"}`}>
                {balance > 0 ? fmtMoney(balance) : "Cleared"}
              </span>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-muted-foreground">
            <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No payments recorded yet.</p>
          </div>
        )}
      </div>

      {/* Production Timeline */}
      <div className="card-luxe p-6">
        <h3 className="font-display text-xl text-brand-dark mb-5">Production Timeline</h3>
        <div className="relative pl-8 space-y-4">
          <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
          {order.timeline.map((t, idx) => {
            const isDone = t.status === "done";
            const isActive = t.status === "in_progress";
            const emp = db.users.find(u => u.id === t.employeeId);
            return (
              <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }} className="relative">
                <div className={`absolute -left-8 top-0.5 h-6 w-6 rounded-full grid place-items-center border-2 ${isDone ? "bg-success border-success text-white" : isActive ? "bg-primary border-primary text-white animate-pulse" : "bg-white border-border text-muted-foreground"}`}>
                  {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-2 w-2" />}
                </div>
                <div className={`p-3 rounded-xl border ${isActive ? "border-primary bg-primary/5" : isDone ? "border-success/30 bg-success/5" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className={`font-medium text-sm ${isDone || isActive ? "text-foreground" : "text-muted-foreground"}`}>{t.step}</p>
                    {t.date && <span className="text-xs text-muted-foreground">{new Date(t.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                  </div>
                  {(emp || t.department || t.remarks) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {emp?.name && <>By {emp.name}</>}{t.department && <> · {t.department}</>}{t.remarks && <> · {t.remarks}</>}
                    </p>
                  )}
                  {canEditStage() && !isDone && isActive && t.step === "Final Approval" && !readiness.ready && (
                    <div className="mt-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                      <p className="text-[11px] text-destructive font-medium">
                        Issue {readiness.missing.join(" and ")} to a factory before Final Approval
                      </p>
                      {user!.role === "admin" && (
                        <button onClick={() => forceAdvanceStep(idx)} className="mt-1 text-[10px] text-muted-foreground hover:text-foreground underline">
                          Force complete anyway (admin override)
                        </button>
                      )}
                    </div>
                  )}
                  {canEditStage() && !isDone && (
                    isActive
                      ? (t.step !== "Final Approval" || readiness.ready) && <AsyncButton size="sm" variant="outline" onClick={() => advanceStep(idx)} className="mt-2 h-7 rounded-lg text-xs">Mark complete</AsyncButton>
                      : <p className="text-[10px] text-muted-foreground/60 mt-1.5 select-none">⏳ Complete previous step first</p>
                  )}
                  {canEditStage() && isDone && (
                    <button
                      onClick={() => revertStep(idx)}
                      className="mt-2 inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <RotateCcw className="h-3 w-3" /> Undo
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Manufacturing — buy material / issue to a factory for THIS order,
          without leaving the page or re-typing the order number (staff only —
          internal sourcing cost, never shown to the client). */}
      {user!.role !== "client" && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-display text-xl text-brand-dark">Manufacturing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {order.materialSourcing === "stock" ? "Sourcing plan: Use from Stock"
                  : order.materialSourcing === "purchase" ? "Sourcing plan: Buy New for this order"
                  : order.materialSourcing === "readyStock" ? "Sold directly from Ready Stock"
                  : "No sourcing plan set at order creation"}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => { setShowBuyForm(v => !v); setShowIssueForm(false); }} variant="outline" className="rounded-xl gap-2">
                <Truck className="h-4 w-4" /> Record Purchase
              </Button>
              <Button onClick={() => { setShowIssueForm(v => !v); setShowBuyForm(false); }} className="btn-hero rounded-xl gap-2">
                <FactoryIcon className="h-4 w-4" /> Issue to Factory
              </Button>
            </div>
          </div>

          <div className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium ${readiness.ready ? "bg-success/8 text-success" : "bg-destructive/5 text-destructive"}`}>
            {readiness.ready ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {order.materialSourcing === "readyStock"
              ? "Sold from Ready Stock — no factory material issuance needed"
              : readiness.ready
              ? "Ready for Final Approval — all required material issued to a factory"
              : `Final Approval blocked — issue ${readiness.missing.join(" and ")} to a factory first`}
          </div>

          {showBuyForm && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <p className="text-sm font-medium text-brand-dark">Record Material Purchase for {order.orderNumber}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={buySupplierId} onValueChange={setBuySupplierId}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                  <SelectContent>{db.suppliers.filter(s => s.active !== false).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={buyMaterial} onValueChange={v => setBuyMaterial(v as PurchaseMaterial)}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
                </Select>
              </div>

              {buyMaterial === "gold" ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <Input type="number" min={0} value={buyGoldWeight} onChange={e => setBuyGoldWeight(e.target.value)} className="rounded-xl h-10" placeholder="Weight (g)" />
                  <Select value={buyGoldPurity} onValueChange={setBuyGoldPurity}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} value={buyGoldRate} onChange={e => setBuyGoldRate(e.target.value)} className="rounded-xl h-10" placeholder={`Rate/g (${buyCurrency})`} />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  <Input type="number" min={0} step="0.01" value={buyDiaCarat} onChange={e => setBuyDiaCarat(e.target.value)} className="rounded-xl h-10" placeholder="Carat" />
                  <Input value={buyDiaQuality} onChange={e => setBuyDiaQuality(e.target.value)} className="rounded-xl h-10" placeholder="Quality (optional)" />
                  <Input type="number" min={0} value={buyDiaRate} onChange={e => setBuyDiaRate(e.target.value)} className="rounded-xl h-10" placeholder={`Rate/ct (${buyCurrency})`} />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Select value={buyCurrency} onValueChange={v => setBuyCurrency(v as PurchaseCurrency)}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
                </Select>
                {buyCurrency === "USD" && (
                  <>
                    <Input type="number" min={0} value={buyTotalUsd} onChange={e => setBuyTotalUsd(e.target.value)} className="rounded-xl h-10" placeholder="Total ($)" />
                    <Input type="number" min={0} step="0.01" value={buyExchangeRate} onChange={e => setBuyExchangeRate(e.target.value)} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input value={buyInvoiceNumber} onChange={e => setBuyInvoiceNumber(e.target.value)} className="rounded-xl h-10" placeholder="Invoice # (optional)" />
                <Input value={buyNotes} onChange={e => setBuyNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
                <span className="text-sm text-muted-foreground">Total (INR)</span>
                <span className="font-display text-lg font-bold text-brand-dark">{fmtMoneyInr(buyFinalTotalInr)}</span>
              </div>

              <div className="flex gap-2.5">
                <AsyncButton onClick={recordPurchaseForOrder} disabled={buying} className="btn-hero rounded-xl h-10">{buying ? "Saving…" : "Save Purchase"}</AsyncButton>
                <Button variant="outline" onClick={() => { setShowBuyForm(false); resetBuyForm(); }} className="rounded-xl h-10">Cancel</Button>
              </div>
            </div>
          )}

          {showIssueForm && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <p className="text-sm font-medium text-brand-dark">Issue Material to Factory for {order.orderNumber}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={issueFactoryId} onValueChange={setIssueFactoryId}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                  <SelectContent>{db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={issueMaterial} onValueChange={v => { setIssueMaterial(v as "gold" | "diamond"); setIssueSource("stock"); setIssuePurchaseId(""); }}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={issueSource} onValueChange={v => { setIssueSource(v as "stock" | "purchase"); setIssuePurchaseId(""); }}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stock">From Stock</SelectItem>
                    <SelectItem value="purchase" disabled={eligiblePurchases.length === 0}>
                      From a purchase made for this order {eligiblePurchases.length === 0 ? "(none available)" : ""}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {issueSource === "purchase" ? (
                  <Select value={issuePurchaseId} onValueChange={v => {
                    setIssuePurchaseId(v);
                    const p = eligiblePurchases.find(p => p.id === v);
                    if (p) {
                      if (p.material === "gold" && p.gold) { setIssuePurity(p.gold.purity); setIssueQuantity(String(p.gold.weightGrams)); }
                      if (p.material === "diamond" && p.diamond) { setIssueQuality(p.diamond.quality || ""); setIssueQuantity(String(p.diamond.carat)); }
                    }
                  }}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose purchase" /></SelectTrigger>
                    <SelectContent>
                      {eligiblePurchases.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity}` : `${p.diamond?.carat}ct ${p.diamond?.quality || ""}`} — {fmtMoneyInr(p.totalInr)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : issueMaterial === "gold" ? (
                  <Select value={issuePurity} onValueChange={setIssuePurity}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={issueQuality} onChange={e => setIssueQuality(e.target.value)} className="rounded-xl h-10" placeholder="Quality (optional)" />
                )}
              </div>

              <Input
                type="number" min={0} value={issueQuantity} onChange={e => setIssueQuantity(e.target.value)}
                className="rounded-xl h-10" placeholder={issueMaterial === "gold" ? "Weight (g)" : "Carat"}
                disabled={issueSource === "purchase" && !!issuePurchaseId}
              />
              <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />

              <div className="flex gap-2.5">
                <AsyncButton onClick={issueMaterialToFactory} disabled={issuing} className="btn-hero rounded-xl h-10">{issuing ? "Issuing…" : "Issue Material"}</AsyncButton>
                <Button variant="outline" onClick={() => { setShowIssueForm(false); resetIssueForm(); }} className="rounded-xl h-10">Cancel</Button>
              </div>
            </div>
          )}

          {(linkedPurchases.length > 0 || linkedIssuances.length > 0) && (
            <div className="pt-2 border-t border-border/60 space-y-2">
              {linkedPurchases.map(p => {
                const pending = purchasePending(p);
                const supplier = db.suppliers.find(s => s.id === p.supplierId);
                return (
                  <Link key={p.id} to={`/suppliers/${p.supplierId}`} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      {p.material === "gold" ? <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0" /> : <Gem className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                      <span className="truncate">{p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity}` : `${p.diamond?.carat}ct`} from {supplier?.name || "supplier"}</span>
                    </span>
                    <span className={`shrink-0 font-medium ${pending > 0 ? "text-destructive" : "text-success"}`}>{fmtMoneyInr(p.totalInr)}{pending > 0 ? ` · ${fmtMoneyInr(pending)} due` : ""}</span>
                  </Link>
                );
              })}
              {linkedIssuances.map(mi => {
                const pending = issuancePending(mi);
                const factory = db.factories.find(f => f.id === mi.factoryId);
                return (
                  <Link key={mi.id} to={`/factories/${mi.factoryId}`} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <FactoryIcon className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                      <span className="truncate">{mi.quantityIssued}{mi.material === "gold" ? "g" : "ct"} {mi.purityOrQuality} issued to {factory?.name || "factory"}</span>
                    </span>
                    <span className={`shrink-0 font-medium ${mi.status === "open" ? "text-primary" : "text-success"}`}>{mi.status === "open" ? "In progress" : "Closed"}{pending > 0 ? ` · ${fmtMoneyInr(pending)} due` : ""}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Manufacturing Log — a separate, append-only array from `timeline` on
          purpose (see src/lib/db.ts ManufacturingLogEntry comment): these are
          immutable facts, not progression steps, so they never touch the
          index-based advance/revert logic above. Shown in the same visual
          style so it reads as one continuous story. */}
      {user!.role !== "client" && !!order.manufacturingLog?.length && (
        <div className="card-luxe p-6">
          <h3 className="font-display text-xl text-brand-dark mb-5">Manufacturing Log</h3>
          <div className="relative pl-8 space-y-4">
            <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
            {[...order.manufacturingLog].sort((a, b) => +new Date(a.at) - +new Date(b.at)).map((entry, idx) => {
              const factory = db.factories.find(f => f.id === entry.factoryId);
              const emp = db.users.find(u => u.id === entry.employeeId);
              const Icon =
                entry.type === "material_purchased" ? Truck :
                entry.type === "material_returned" ? RotateCcw :
                entry.type === "making_charge_added" ? Coins :
                entry.type === "piece_finished" ? Gem : FactoryIcon;
              const label =
                entry.type === "material_purchased" ? "Material purchased" :
                entry.type === "factory_assigned" ? "Factory assigned" :
                entry.type === "material_issued" ? "Material issued" :
                entry.type === "material_returned" ? "Material returned" :
                entry.type === "piece_finished" ? "Piece finished" : "Making charge added";
              return (
                <motion.div key={entry.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }} className="relative">
                  <div className="absolute -left-8 top-0.5 h-6 w-6 rounded-full grid place-items-center border-2 bg-white border-border text-muted-foreground">
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="p-3 rounded-xl border border-border">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="font-medium text-sm text-foreground">{label}{factory ? ` — ${factory.name}` : ""}</p>
                      <span className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {entry.amountMaterial !== undefined && `${entry.amountMaterial}${entry.material === "diamond" ? "ct" : "g"} ${entry.material || ""}`}
                      {entry.amountMaterial !== undefined && entry.amountInr !== undefined && " · "}
                      {entry.amountInr !== undefined && fmtMoneyInr(entry.amountInr)}
                      {emp?.name && <> · By {emp.name}</>}
                      {entry.remarks && <> · {entry.remarks}</>}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>

    {/* ── Image Lightbox ── */}
    <AnimatePresence>
      {lightboxSrc && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <motion.img
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            src={lightboxSrc}
            alt="Preview"
            className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 text-white grid place-items-center transition-colors"
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
