import { useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  loadDb, updateDb, fmtMoney, fmtDate, totalAdvance, orderTotal, balanceDue, uid, capOrderAdvances, DIAMOND_SHAPES,
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
  Factory as FactoryIcon, Coins, Gem, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { printInvoice } from "@/lib/invoicePrint";
import { AsyncButton } from "@/components/AsyncButton";
import {
  fmtMoneyInr, purchasePending, issuancePending, manufacturingReadiness,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements, issuanceUsed,
} from "@/lib/manufacturing";
import { decreaseStock, increaseStock } from "@/lib/stock";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];

// One line = one Purchase doc on save — lets a single supplier invoice that
// covers several sizes/qualities (e.g. two diamond parcels) be entered in one
// sitting instead of reopening the form for each variety.
interface BuyLine {
  material: PurchaseMaterial;
  goldWeight: string;
  goldPurity: string;
  goldRate: string;
  diaCarat: string;
  diaQuality: string;
  diaRate: string;
  currency: PurchaseCurrency;
  totalUsd: string;
  exchangeRate: string;
  invoiceNumber: string;
  notes: string;
}

function emptyBuyLine(): BuyLine {
  return {
    material: "gold", goldWeight: "", goldPurity: "22K", goldRate: "",
    diaCarat: "", diaQuality: "", diaRate: "",
    currency: "INR", totalUsd: "", exchangeRate: "",
    invoiceNumber: "", notes: "",
  };
}

function buyLineTotalInr(line: BuyLine): number {
  const computed = line.material === "gold"
    ? (Number(line.goldWeight) || 0) * (Number(line.goldRate) || 0)
    : (Number(line.diaCarat) || 0) * (Number(line.diaRate) || 0);
  return line.currency === "USD"
    ? Math.round((Number(line.totalUsd) || 0) * (Number(line.exchangeRate) || 0))
    : Math.round(computed);
}

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
  const [advLockerId, setAdvLockerId] = useState("");
  const [advLockerAmount, setAdvLockerAmount] = useState("");

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
  // A single supplier invoice often covers several different sizes/qualities
  // (e.g. two diamond parcels, or two gold purities) in one go — so purchases
  // are entered as a list of lines, each an independent Purchase doc on save,
  // rather than forcing one open/fill/save cycle per variety.
  const [showBuyForm, setShowBuyForm] = useState(false);
  const [buySupplierId, setBuySupplierId] = useState("");
  const [buyLines, setBuyLines] = useState<BuyLine[]>([emptyBuyLine()]);
  const [buying, setBuying] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueMaterial, setIssueMaterial] = useState<"gold" | "diamond">("gold");
  const [issueFactoryId, setIssueFactoryId] = useState("");
  const [issuePurity, setIssuePurity] = useState("22K");
  const [issueQuality, setIssueQuality] = useState("Round");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueChargeAmount, setIssueChargeAmount] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueDiaKind, setIssueDiaKind] = useState<"loose" | "certified">("loose");
  const [issueCertPacketIds, setIssueCertPacketIds] = useState<string[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Stage ① — assign factory + quote an estimate (before the piece is made).
  const [showEstimate, setShowEstimate] = useState(false);
  const [estGold, setEstGold] = useState("");
  const [estDia, setEstDia] = useState("");
  const [estMaking, setEstMaking] = useState("");

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

  const buyGrandTotalInr = buyLines.reduce((s, l) => s + buyLineTotalInr(l), 0);

  const updateBuyLine = (idx: number, patch: Partial<BuyLine>) =>
    setBuyLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addBuyLine = () => setBuyLines(prev => [...prev, emptyBuyLine()]);
  const removeBuyLine = (idx: number) => setBuyLines(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const resetBuyForm = () => {
    setBuySupplierId("");
    setBuyLines([emptyBuyLine()]);
  };

  const recordPurchaseForOrder = async () => {
    if (!buySupplierId) { toast.error("Choose a supplier"); return; }
    for (const line of buyLines) {
      if (line.material === "gold" && (!line.goldWeight || Number(line.goldWeight) <= 0)) { toast.error("Enter gold weight for every line"); return; }
      if (line.material === "diamond" && (!line.diaCarat || Number(line.diaCarat) <= 0)) { toast.error("Enter diamond carat for every line"); return; }
      if (line.currency === "USD" && (!line.totalUsd || !line.exchangeRate)) { toast.error("Enter the USD amount and exchange rate for every USD line"); return; }
      if (buyLineTotalInr(line) <= 0) { toast.error("A line's total comes to ₹0 — check its weight/rate fields"); return; }
    }

    const supplier = db.suppliers.find(s => s.id === buySupplierId);
    const now = new Date().toISOString();
    const newPurchases: Purchase[] = buyLines.map(line => ({
      id: uid("pur_"),
      supplierId: buySupplierId,
      material: line.material,
      gold: line.material === "gold" ? { weightGrams: Number(line.goldWeight), purity: line.goldPurity, ratePerGram: Number(line.goldRate) || 0 } : undefined,
      diamond: line.material === "diamond" ? { carat: Number(line.diaCarat), quality: line.diaQuality || undefined, ratePerCarat: Number(line.diaRate) || 0 } : undefined,
      purpose: "order",
      orderId: order.id,
      currency: line.currency,
      totalUsd: line.currency === "USD" ? Number(line.totalUsd) : undefined,
      exchangeRate: line.currency === "USD" ? Number(line.exchangeRate) : undefined,
      totalInr: buyLineTotalInr(line),
      payments: [],
      invoiceNumber: line.invoiceNumber.trim() || undefined,
      notes: line.notes.trim() || undefined,
      createdBy: user!.id,
      createdAt: now,
    }));
    setBuying(true);
    try {
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        const o = d.orders.find(o => o.id === order.id);
        if (o) {
          if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
          if (!o.manufacturingLog) o.manufacturingLog = [];
        }
        for (const purchase of newPurchases) {
          d.purchases.unshift(purchase);
          if (o) {
            o.linkedPurchaseIds!.push(purchase.id);
            const qty = purchase.material === "gold" ? purchase.gold!.weightGrams : purchase.diamond!.carat;
            const purityOrQuality = purchase.material === "gold" ? purchase.gold!.purity : (purchase.diamond!.quality || "");
            const label = purchase.material === "gold" ? `${qty}g ${purityOrQuality} gold` : `${qty}ct diamond${purityOrQuality ? ` (${purityOrQuality})` : ""}`;
            o.manufacturingLog!.push({
              id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
              material: purchase.material, amountMaterial: qty, amountInr: purchase.totalInr,
              remarks: `Purchased ${label} from ${supplier?.name || "supplier"} for this order — ${fmtMoneyInr(purchase.totalInr)}`,
            });
          }
        }
      });
      toast.success(`${newPurchases.length > 1 ? `${newPurchases.length} purchases` : "Purchase"} recorded — ${fmtMoneyInr(buyGrandTotalInr)}`);
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
    setIssueFactoryId("");
    setIssuePurity("22K"); setIssueQuality("Round"); setIssueQuantity(""); setIssueChargeAmount(""); setIssueNotes("");
    setIssueDiaKind("loose"); setIssueCertPacketIds([]);
  };

  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock");

  // Pure informational tag — "this factory will make this order." Moves no
  // material and never affects manufacturingReadiness; only an actual
  // MaterialIssuance for this order does that.
  const assignFactory = (factoryId: string) => {
    const factory = db.factories.find(f => f.id === factoryId);
    const now = new Date().toISOString();
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id);
      if (!o) return;
      o.assignedFactoryId = factoryId || undefined;
      if (factoryId) {
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({
          id: uid("mlog_"), type: "factory_assigned", at: now, employeeId: user!.id, factoryId,
          remarks: `Factory assigned: ${factory?.name || "factory"}`,
        });
      }
    });
    if (factoryId) toast.success(`${factory?.name || "Factory"} assigned to this order`);
  };

  const openEstimate = () => {
    setEstGold(order.estimatedGrossWeight?.toString() ?? order.metalWeight?.toString() ?? "");
    setEstDia(order.diamondWeight?.toString() ?? "");
    setEstMaking(order.estimatedMakingCharges?.toString() ?? "");
    setShowEstimate(true);
  };

  const saveEstimate = () => {
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id);
      if (!o) return;
      o.estimatedGrossWeight = estGold ? Number(estGold) : undefined;
      if (estDia) o.diamondWeight = Number(estDia);
      o.estimatedMakingCharges = estMaking ? Number(estMaking) : undefined;
    });
    toast.success("Estimate saved");
    setShowEstimate(false);
  };

  // Records material USE + its making charge for this order in one save.
  // Where the material physically comes from is resolved automatically, not
  // asked: this factory's own pool (from an earlier bulk delivery) first, then
  // a purchase bought specifically for this order, then shared company stock —
  // the client only ever needs to tell us "how much" and "what's the charge."
  const issueMaterialToFactory = async () => {
    if (!issueFactoryId) { toast.error("Choose a factory"); return; }
    const factory = db.factories.find(f => f.id === issueFactoryId);
    const chargeAmount = Number(issueChargeAmount) || 0;

    // ── Certified diamond packets: the exact stones used (not a pooled carat) ──
    if (issueMaterial === "diamond" && issueDiaKind === "certified") {
      const packets = inStockPackets.filter(p => issueCertPacketIds.includes(p.id));
      if (packets.length === 0) { toast.error("Select at least one certified packet"); return; }
      const totalCarat = Math.round(packets.reduce((s, p) => s + p.carat, 0) * 100) / 100;
      const issuanceId = uid("mi_");
      const now = new Date().toISOString();
      setIssuing(true);
      try {
        updateDb(d => {
          if (!d.materialIssuances) d.materialIssuances = [];
          d.materialIssuances.unshift({
            id: issuanceId, factoryId: issueFactoryId, orderId: order.id, material: "diamond",
            purityOrQuality: "Certified", quantityIssued: totalCarat,
            source: "stock", diamondKind: "certified", diamondPacketIds: packets.map(p => p.id),
            issuedAt: now, issuedBy: user!.id, status: "open",
            finishedPieces: [{ id: uid("fp_"), quantityUsed: totalCarat, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
            makingCharges: { amountInr: chargeAmount, payments: [] },
            notes: issueNotes.trim() || undefined,
          });
          // Move each selected packet out of stock, tagged to this order.
          for (const p of d.diamondPackets) {
            if (issueCertPacketIds.includes(p.id) && p.status === "in_stock") { p.status = "issued"; p.orderId = order.id; }
          }
          const o = d.orders.find(o => o.id === order.id);
          if (o) {
            if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
            o.materialIssuanceIds.push(issuanceId);
            if (!o.manufacturingLog) o.manufacturingLog = [];
            o.manufacturingLog.push({
              id: uid("mlog_"), type: "material_issued", at: now, employeeId: user!.id, factoryId: issueFactoryId,
              material: "diamond", amountMaterial: totalCarat, amountInr: chargeAmount || undefined,
              remarks: `${packets.length} certified diamond${packets.length !== 1 ? "s" : ""} (${totalCarat}ct) used at ${factory?.name || "factory"}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""} — cert ${packets.map(p => p.certificateNumber).join(", ")}`,
            });
          }
        });
        toast.success(`${packets.length} certified packet${packets.length !== 1 ? "s" : ""} recorded for ${factory?.name || "factory"}`);
        setShowIssueForm(false); resetIssueForm();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      } finally { setIssuing(false); }
      return;
    }

    const qty = Number(issueQuantity);
    if (!qty || qty <= 0) { toast.error(`Enter the ${issueMaterial} weight/carat used`); return; }
    const purityOrQuality = issueMaterial === "gold" ? issuePurity : (issueQuality.trim() || "unspecified");

    const poolBalance = factoryPoolBalance(db.materialIssuances, issueFactoryId, issueMaterial, purityOrQuality);
    const eligiblePurchase = eligiblePurchases[0];
    const resolvedSource: "factoryPool" | "purchase" | "stock" =
      poolBalance >= qty ? "factoryPool" : eligiblePurchase ? "purchase" : "stock";

    const issuanceId = uid("mi_");
    const now = new Date().toISOString();
    setIssuing(true);
    try {
      if (resolvedSource === "stock") {
        await decreaseStock({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Used by ${factory?.name || "factory"} for order ${order.orderNumber}`,
        });
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: issueFactoryId, orderId: order.id, material: issueMaterial,
          purityOrQuality, quantityIssued: qty,
          source: resolvedSource, sourcePurchaseId: resolvedSource === "purchase" ? eligiblePurchase!.id : undefined,
          issuedAt: now, issuedBy: user!.id, status: "open",
          finishedPieces: [{ id: uid("fp_"), quantityUsed: qty, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
          makingCharges: { amountInr: chargeAmount, payments: [] },
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
            material: issueMaterial, amountMaterial: qty, amountInr: chargeAmount || undefined,
            remarks: `${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} ${issueMaterial} used at ${factory?.name || "factory"}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""}`,
          });
        }
      });
      toast.success(`Recorded ${qty}${issueMaterial === "gold" ? "g" : "ct"} ${purityOrQuality} used${chargeAmount ? ` — ${fmtMoneyInr(chargeAmount)} charge` : ""}`);
      setShowIssueForm(false);
      resetIssueForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
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
    // Never let goods leave without a price, and warn before shipping unpaid.
    if (order.timeline[idx].step === "Dispatch") {
      if (orderTotal(order) <= 0) { toast.error("Set the order price before dispatching."); return; }
      if (balanceDue(order) > 0 && !confirm(`Balance of ${fmtMoney(balanceDue(order))} is still unpaid on this order. Dispatch anyway?`)) return;
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
    if (!yes && !confirm("Reject this order? You can re-open it to Waiting later if this was a mistake.")) return;
    const now = new Date().toISOString();
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.status = yes ? "Approved" : "Rejected";
      if (yes) {
        o.timeline[0].status = "done"; o.timeline[0].date = now;
        o.timeline[1].status = "done"; o.timeline[1].date = now;
        if (o.timeline[2]) o.timeline[2].status = "in_progress";
      }
      const clientUser = d.users.find(u => u.clientId === o.clientId);
      if (clientUser) d.notifications.unshift({
        id: uid("n_"), userId: clientUser.id,
        title: yes ? "Order Approved" : "Order Rejected",
        body: yes ? `${o.orderNumber} has been approved and is now in production.` : `${o.orderNumber} has been rejected.`,
        type: "order", read: false, createdAt: now,
      });
    });
    toast.success(yes ? "Order approved" : "Order rejected");
  };

  // Undo an accidental reject — put the order back to Waiting for a fresh decision.
  const reopenOrder = () => {
    if (!confirm("Re-open this rejected order back to Waiting?")) return;
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.status = "Waiting";
      o.timeline.forEach((t, i) => { if (i > 0) { t.status = "pending"; t.date = undefined; } });
      o.timeline[0].status = "done";
    });
    toast.success("Order re-opened — now Waiting");
  };

  // Cancel an order (admin) — returns any issued gold/diamond and certified
  // packets to stock, closes its issuances, and stops billing it (Rejected is
  // excluded from client totals). Re-openable afterwards.
  const cancelOrder = async () => {
    if (!confirm("Cancel this order? Any material/diamonds issued for it return to stock and it will no longer be billed. You can re-open it later.")) return;
    const openIssuances = db.materialIssuances.filter(i => i.orderId === order.id && i.status === "open");
    setCancelling(true);
    try {
      // Restore stock-sourced loose/gold remainders to the pool (transactional).
      for (const mi of openIssuances) {
        if (mi.source === "stock" && mi.diamondKind !== "certified") {
          const used = (mi.finishedPieces || []).reduce((s, f) => s + f.quantityUsed, 0);
          const remaining = Math.round((mi.quantityIssued - used) * 100) / 100;
          if (remaining > 0) {
            await increaseStock({
              material: mi.material, purityOrQuality: mi.purityOrQuality, quantity: remaining,
              refType: "manual", createdBy: user!.id, note: `Returned on cancelling order ${order.orderNumber}`,
            });
          }
        }
      }
      const now = new Date().toISOString();
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.status = "Rejected";
        for (const mi of d.materialIssuances) {
          if (mi.orderId === order.id && mi.status === "open") {
            // A factoryPool draw has nothing to return to shared Stock —
            // shrinking it to what was actually used releases the undrawn
            // portion straight back to the factory's own pool.
            if (mi.source === "factoryPool") mi.quantityIssued = Math.round(issuanceUsed(mi) * 100) / 100;
            mi.status = "closed";
          }
        }
        // Free every certified packet tied to this order back into stock.
        for (const p of d.diamondPackets || []) {
          if (p.orderId === order.id) { p.status = "in_stock"; p.orderId = undefined; }
        }
        const clientUser = d.users.find(u => u.clientId === o.clientId);
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id, title: "Order Cancelled",
          body: `${o.orderNumber} has been cancelled.`, type: "order", read: false, createdAt: now,
        });
      });
      toast.success("Order cancelled — issued material returned to stock");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel order");
    } finally { setCancelling(false); }
  };

  const addAdvance = () => {
    const amt = parseFloat(advAmt);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!advLockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (!advLockerAmount || Number(advLockerAmount) <= 0) { toast.error("Enter the amount actually deposited in that locker"); return; }
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
        o.advances.push({
          id: uid("adv_"), amount: applied, note: advNote || defaultNote, recordedBy: user!.id, createdAt: new Date().toISOString(),
          lockerId: advLockerId || undefined, lockerAmount: advLockerId ? Number(advLockerAmount) : undefined,
        });
        if (advLockerId) {
          const locker = d.lockers.find(l => l.id === advLockerId);
          if (locker) {
            if (!d.lockerTransactions) d.lockerTransactions = [];
            d.lockerTransactions.push({
              id: uid("ltx_"), lockerId: advLockerId, type: "income", amountInr: Number(advLockerAmount),
              currency: locker.currency || "INR", category: `Client Payment — ${o.orderNumber}`,
              refType: "clientPayment", refId: o.id, recordedBy: user!.id, createdAt: new Date().toISOString(),
            });
          }
        }
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
    setAdvAmt(""); setAdvNote(""); setAdvLockerId(""); setAdvLockerAmount(""); setShowAdvForm(false);
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
            {user!.role === "admin" && order.status !== "Rejected" && (
              <AsyncButton variant="outline" onClick={cancelOrder} disabled={cancelling} className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
                Cancel Order
              </AsyncButton>
            )}
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
        {canEditStage() && order.status === "Rejected" && (
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-destructive font-medium">This order was rejected.</span>
            <AsyncButton variant="outline" onClick={reopenOrder} className="rounded-xl gap-2">
              <RotateCcw className="h-4 w-4" /> Re-open to Waiting
            </AsyncButton>
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
              <div className={`p-3 rounded-xl text-center border ${balance > 0 ? "bg-destructive/5 border-destructive/20" : orderTotal(order) <= 0 ? "bg-secondary border-border/40" : "bg-success/8 border-success/20"}`}>
                <p className="text-xs text-muted-foreground mb-1">Balance Due</p>
                <p className={`font-semibold text-sm ${balance > 0 ? "text-destructive" : orderTotal(order) <= 0 ? "text-muted-foreground" : "text-success"}`}>
                  {balance > 0 ? fmtMoney(balance) : orderTotal(order) <= 0 ? "Pricing pending" : "✓ Cleared"}
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
                {db.lockers.filter(l => l.active !== false).length === 0 && (
                  <p className="text-xs text-amber-600">
                    No lockers yet — <Link to="/locker" className="underline font-medium">create one first</Link> before recording a payment.
                  </p>
                )}
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Deposited to Locker *</Label>
                    <Select value={advLockerId} onValueChange={setAdvLockerId}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose a locker" /></SelectTrigger>
                      <SelectContent>
                        {db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {advLockerId && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Amount Deposited ({db.lockers.find(l => l.id === advLockerId)?.currency === "USD" ? "$" : "₹"})</Label>
                      <Input type="number" min={0} step="0.01" value={advLockerAmount} onChange={e => setAdvLockerAmount(e.target.value)} className="rounded-xl h-10" />
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <AsyncButton size="sm" onClick={addAdvance} className="btn-hero rounded-xl">Save Payment</AsyncButton>
                  <Button size="sm" variant="outline" onClick={() => { setShowAdvForm(false); setAdvAmt(""); setAdvNote(""); setAdvLockerId(""); setAdvLockerAmount(""); }} className="rounded-xl">Cancel</Button>
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
                <Truck className="h-4 w-4" /> Buy for this Order
              </Button>
              <Button onClick={() => { setShowIssueForm(v => !v); setShowBuyForm(false); if (!issueFactoryId && order.assignedFactoryId) setIssueFactoryId(order.assignedFactoryId); }} className="btn-hero rounded-xl gap-2">
                <FactoryIcon className="h-4 w-4" /> Use from Stock
              </Button>
            </div>
          </div>

          {/* Stage ① — Assign the factory and quote an estimate before the piece is made. */}
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-brand-dark shrink-0">① Assign &amp; Estimate</span>
                <Select value={order.assignedFactoryId || "__none"} onValueChange={v => assignFactory(v === "__none" ? "" : v)}>
                  <SelectTrigger className="h-8 w-52 rounded-lg text-xs"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not assigned</SelectItem>
                    {db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {canEditStage() && (
                <Button size="sm" variant="outline" onClick={() => (showEstimate ? setShowEstimate(false) : openEstimate())} className="rounded-lg h-8 gap-1.5 text-xs">
                  {showEstimate ? "Close" : (order.estimatedMakingCharges != null || order.estimatedGrossWeight != null ? "Edit Estimate" : "Add Estimate")}
                </Button>
              )}
            </div>

            {/* Estimate summary (read-only) */}
            {!showEstimate && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Est. gold: <span className="font-semibold text-foreground">{order.estimatedGrossWeight ?? order.metalWeight ?? "—"}{(order.estimatedGrossWeight ?? order.metalWeight) != null ? " g" : ""}</span></span>
                <span>Est. diamond: <span className="font-semibold text-foreground">{order.diamondWeight ? `${order.diamondWeight} ct` : "—"}</span></span>
                <span>Est. making: <span className="font-semibold text-foreground">{order.estimatedMakingCharges != null ? fmtMoney(order.estimatedMakingCharges) : "—"}</span></span>
              </div>
            )}

            {/* Estimate editor */}
            {showEstimate && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <Label className="text-[11px]">Est. Gold Weight (g)</Label>
                  <Input type="number" min={0} step="0.01" value={estGold} onChange={e => setEstGold(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <div>
                  <Label className="text-[11px]">Est. Diamond (ct)</Label>
                  <Input type="number" min={0} step="0.01" value={estDia} onChange={e => setEstDia(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <div>
                  <Label className="text-[11px]">Est. Making Charge ($)</Label>
                  <Input type="number" min={0} step="0.01" value={estMaking} onChange={e => setEstMaking(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <div className="sm:col-span-3 flex justify-end">
                  <Button size="sm" onClick={saveEstimate} className="btn-hero rounded-lg h-9 gap-1.5 text-xs">Save Estimate</Button>
                </div>
              </div>
            )}
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
            <div className="pt-2 border-t border-border/60 space-y-3">
              <p className="text-sm font-medium text-brand-dark">Record Material Purchase for {order.orderNumber}</p>
              <Select value={buySupplierId} onValueChange={setBuySupplierId}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                <SelectContent>{db.suppliers.filter(s => s.active !== false).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>

              {buyLines.map((line, idx) => (
                <div key={idx} className="p-3 rounded-xl border border-border/60 space-y-2.5 relative">
                  {buyLines.length > 1 && (
                    <button type="button" onClick={() => removeBuyLine(idx)} className="absolute top-2 right-2 h-6 w-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <p className="text-xs font-medium text-muted-foreground">Item {idx + 1}</p>
                  <Select value={line.material} onValueChange={v => updateBuyLine(idx, { material: v as PurchaseMaterial })}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
                  </Select>

                  {line.material === "gold" ? (
                    <div className="grid grid-cols-3 gap-2.5">
                      <Input type="number" min={0} value={line.goldWeight} onChange={e => updateBuyLine(idx, { goldWeight: e.target.value })} className="rounded-xl h-10" placeholder="Weight (g)" />
                      <Select value={line.goldPurity} onValueChange={v => updateBuyLine(idx, { goldPurity: v })}>
                        <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="number" min={0} value={line.goldRate} onChange={e => updateBuyLine(idx, { goldRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/g (${line.currency})`} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2.5">
                      <Input type="number" min={0} step="0.01" value={line.diaCarat} onChange={e => updateBuyLine(idx, { diaCarat: e.target.value })} className="rounded-xl h-10" placeholder="Carat" />
                      <Input value={line.diaQuality} onChange={e => updateBuyLine(idx, { diaQuality: e.target.value })} className="rounded-xl h-10" placeholder="Quality (optional)" />
                      <Input type="number" min={0} value={line.diaRate} onChange={e => updateBuyLine(idx, { diaRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/ct (${line.currency})`} />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <Select value={line.currency} onValueChange={v => updateBuyLine(idx, { currency: v as PurchaseCurrency })}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
                    </Select>
                    {line.currency === "USD" && (
                      <>
                        <Input type="number" min={0} value={line.totalUsd} onChange={e => updateBuyLine(idx, { totalUsd: e.target.value })} className="rounded-xl h-10" placeholder="Total ($)" />
                        <Input type="number" min={0} step="0.01" value={line.exchangeRate} onChange={e => updateBuyLine(idx, { exchangeRate: e.target.value })} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Input value={line.invoiceNumber} onChange={e => updateBuyLine(idx, { invoiceNumber: e.target.value })} className="rounded-xl h-10" placeholder="Invoice # (optional)" />
                    <Input value={line.notes} onChange={e => updateBuyLine(idx, { notes: e.target.value })} className="rounded-xl h-10" placeholder="Notes (optional)" />
                  </div>

                  <p className="text-xs text-muted-foreground text-right">Line total: <span className="font-semibold text-foreground">{fmtMoneyInr(buyLineTotalInr(line))}</span></p>
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addBuyLine} className="rounded-xl gap-2 w-full">
                <Plus className="h-4 w-4" /> Add Another Item (different size/quality)
              </Button>

              <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
                <span className="text-sm text-muted-foreground">Grand Total (INR)</span>
                <span className="font-display text-lg font-bold text-brand-dark">{fmtMoneyInr(buyGrandTotalInr)}</span>
              </div>

              <div className="flex gap-2.5">
                <AsyncButton onClick={recordPurchaseForOrder} disabled={buying} className="btn-hero rounded-xl h-10">{buying ? "Saving…" : buyLines.length > 1 ? `Save ${buyLines.length} Purchases` : "Save Purchase"}</AsyncButton>
                <Button variant="outline" onClick={() => { setShowBuyForm(false); resetBuyForm(); }} className="rounded-xl h-10">Cancel</Button>
              </div>
            </div>
          )}

          {showIssueForm && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <p className="text-sm font-medium text-brand-dark">Record Material Used for {order.orderNumber}</p>
              <p className="text-xs text-muted-foreground -mt-1.5">How much gold/diamond the factory used, and their making charge — that's it.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={issueFactoryId} onValueChange={setIssueFactoryId}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                  <SelectContent>{db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={issueMaterial} onValueChange={v => setIssueMaterial(v as "gold" | "diamond")}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="gold">Gold</SelectItem><SelectItem value="diamond">Diamond</SelectItem></SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {issueMaterial === "gold" ? (
                  <Select value={issuePurity} onValueChange={setIssuePurity}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Select value={issueDiaKind} onValueChange={v => setIssueDiaKind(v as "loose" | "certified")}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="loose">Loose (by shape)</SelectItem>
                      <SelectItem value="certified" disabled={inStockPackets.length === 0}>
                        Certified packet{inStockPackets.length === 0 ? " (none in stock)" : ""}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {issueMaterial === "diamond" && issueDiaKind === "loose" && (
                  <Select value={issueQuality || "Round"} onValueChange={setIssueQuality}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Shape" /></SelectTrigger>
                    <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>

              {issueMaterial === "gold" && issueFactoryId && orderMaterialRequirements(order).needsGold && (() => {
                const balance = factoryPoolBalance(db.materialIssuances, issueFactoryId, "gold", issuePurity);
                const estimate = estimatedPureGoldNeeded(order);
                if (estimate <= 0 || balance >= estimate) return null;
                return (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-destructive/5 text-destructive text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>This factory's pool only has {balance}g of {issuePurity} — this order ({order.productKarats || "?"}) is estimated to need ~{estimate}g of pure gold. The rest will come from company stock.</span>
                  </div>
                );
              })()}

              {/* Certified packets → pick the specific stones used */}
              {issueMaterial === "diamond" && issueDiaKind === "certified" ? (
                <div className="rounded-xl border border-border/60 p-2 max-h-52 overflow-y-auto space-y-1">
                  {inStockPackets.length === 0 && <p className="text-xs text-muted-foreground p-2">No certified diamonds in stock.</p>}
                  {inStockPackets.map(p => {
                    const checked = issueCertPacketIds.includes(p.id);
                    return (
                      <label key={p.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer ${checked ? "bg-primary/10" : "hover:bg-secondary"}`}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setIssueCertPacketIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id))} />
                        <span className="text-sm flex-1 min-w-0 truncate">{p.shape} · {p.carat}ct · Cert {p.certificateNumber}{p.certificateLab ? ` (${p.certificateLab})` : ""}</span>
                      </label>
                    );
                  })}
                  {issueCertPacketIds.length > 0 && (
                    <p className="text-xs text-muted-foreground px-2 pt-1">
                      {issueCertPacketIds.length} selected · {Math.round(inStockPackets.filter(p => issueCertPacketIds.includes(p.id)).reduce((s, p) => s + p.carat, 0) * 100) / 100} ct total
                    </p>
                  )}
                </div>
              ) : (
                <Input
                  type="number" min={0} value={issueQuantity} onChange={e => setIssueQuantity(e.target.value)}
                  className="rounded-xl h-10" placeholder={issueMaterial === "gold" ? "Weight used (g)" : "Carat used"}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input
                  type="number" min={0} value={issueChargeAmount} onChange={e => setIssueChargeAmount(e.target.value)}
                  className="rounded-xl h-10" placeholder="Making charge (₹, optional)"
                />
                <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
              </div>

              <div className="flex gap-2.5">
                <AsyncButton onClick={issueMaterialToFactory} disabled={issuing} className="btn-hero rounded-xl h-10">{issuing ? "Saving…" : "Save Usage & Charge"}</AsyncButton>
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
                const used = issuanceUsed(mi);
                const unit = mi.material === "gold" ? "g" : "ct";
                const certPackets = mi.diamondKind === "certified"
                  ? (db.diamondPackets ?? []).filter(p => mi.diamondPacketIds?.includes(p.id))
                  : [];
                const label = mi.diamondKind === "certified"
                  ? `${certPackets.length} certified diamond${certPackets.length !== 1 ? "s" : ""} (${mi.quantityIssued}ct) — ${certPackets.map(p => `${p.shape} ${p.carat}ct, Cert ${p.certificateNumber}`).join("; ")}`
                  : `${mi.material === "gold" ? "Gold" : "Diamond"} — ${mi.purityOrQuality}, ${used}${unit} used${Math.abs(used - mi.quantityIssued) > 0.001 ? ` (${mi.quantityIssued}${unit} issued)` : ""}`;
                return (
                  <Link key={mi.id} to={`/factories/${mi.factoryId}`} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      {mi.material === "gold" ? <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0" /> : <Gem className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                      <span className="truncate" title={label}>{label} · {factory?.name || "factory"}</span>
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
