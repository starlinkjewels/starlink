import { useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  loadDb, updateDb, fmtMoney, fmtDate, totalAdvance, orderTotal, orderGrossTotal, balanceDue, uid, capOrderAdvances, DIAMOND_SHAPES, toPureGold, pureFromPurity, CARAT_TO_GRAM, KARAT_PURITY, nextDiamondStockNumber, findInvoiceForOrder, invoiceOrderIds, nextInvoiceNumber, activeGiftCardsFor, maxGiftRedeem, cashbackPercentFor, issueGiftCard,
  type Order, type Purchase, type PurchaseMaterial, type PurchaseCurrency, type MaterialIssuance,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl, uploadFile, deleteByUrl } from "@/lib/storage";
import { sendMail, orderApprovedEmail, orderDispatchedEmail } from "@/lib/email";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Package, Printer,
  DollarSign, Plus, TrendingUp, AlertCircle, Wallet,
  ImagePlus, Truck, ExternalLink, Eye, Scale, Calculator, Minimize2, Maximize2, RotateCcw,
  Factory as FactoryIcon, Coins, Gem, X, Box, Camera, Video, Download, Trash2, PackageCheck, Gift,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { printInvoice, printBatchInvoice } from "@/lib/invoicePrint";
import { AsyncButton } from "@/components/AsyncButton";
import {
  fmtMoneyInr, purchasePending, issuancePending, manufacturingReadiness,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements, issuanceUsed, labourValue, factoryFineGoldBalance,
} from "@/lib/manufacturing";
import { decreaseStockSelfHealing, increaseStock, logOrderDirectPurchase } from "@/lib/stock";

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
  // Diamond kind + certified grading (mirrors the Supplier purchase form).
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
  exchangeRate: string;
  invoiceNumber: string;
  notes: string;
}

function emptyBuyLine(): BuyLine {
  return {
    material: "diamond", goldWeight: "", goldPurity: "22K", goldRate: "",
    diaCarat: "", diaQuality: "", diaRate: "",
    diaKind: "loose", diaShape: "Round", diaCertNo: "", diaLab: "",
    diaColor: "", diaClarity: "", diaCut: "", diaPolish: "", diaSym: "", diaFluor: "", diaMeasure: "",
    currency: "INR", exchangeRate: "",
    invoiceNumber: "", notes: "",
  };
}

/** Weight × rate, in the line's own billing currency — always the source of
 *  truth for the amount (never manually typed). */
function buyLineBaseAmount(line: BuyLine): number {
  return line.material === "gold"
    ? (Number(line.goldWeight) || 0) * (Number(line.goldRate) || 0)
    : (Number(line.diaCarat) || 0) * (Number(line.diaRate) || 0);
}

function buyLineTotalInr(line: BuyLine): number {
  const base = buyLineBaseAmount(line);
  return line.currency === "USD"
    ? Math.round(base * (Number(line.exchangeRate) || 0))
    : Math.round(base);
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
function statusFromTimeline(timeline: Order["timeline"], forReadyStock = false, readyStockSale = false): Order["status"] {
  const total = timeline.length;
  const done = timeline.filter(t => t.status === "done").length;
  // In-house Ready-Stock builds have no client-approval/shipping stages: they just
  // stay "In Production" until the final step, then "Ready" (piece ready for stock).
  if (forReadyStock) return done >= total ? "Ready" : "In Production";
  const dispatchIdxA = timeline.findIndex(x => x.step === "Dispatch");
  // Ready-Stock SALE of an existing piece: Confirmed → (Ready) → Dispatch → Delivered.
  if (readyStockSale) {
    if (done >= total) return "Delivered";
    if (dispatchIdxA >= 0 && done >= dispatchIdxA + 1) return "Dispatched";
    return "Ready";
  }
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
  const model3dmRef = useRef<HTMLInputElement>(null);
  const [model3dmUploading, setModel3dmUploading] = useState(false);
  const [show360, setShow360] = useState(false); // 3D model viewer modal

  // Finished-product photography (photos + one video, uploaded at/after dispatch)
  const productPhotoRef = useRef<HTMLInputElement>(null);
  const productVideoRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const MAX_VIDEO_MB = 60;

  // Dispatch form
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchModalIdx, setDispatchModalIdx] = useState<number | null>(null); // Dispatch-details popup on "Mark complete"
  const [dispatchSaving, setDispatchSaving] = useState(false);
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
  const [actMaking, setActMaking] = useState("");

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
  // Rework / alteration — a delivered piece comes back, gold/diamond +/- and a
  // rework charge at a factory. Reflected in stock, factory balance & ledgers.
  const [showRework, setShowRework] = useState(false);
  const [rwFactoryId, setRwFactoryId] = useState("");
  const [rwGoldDir, setRwGoldDir] = useState<"none" | "add" | "remove">("none");
  const [rwGoldG, setRwGoldG] = useState("");
  const [rwGoldKarat, setRwGoldKarat] = useState("22K");
  const [rwDiaDir, setRwDiaDir] = useState<"none" | "add" | "remove">("none");
  const [rwDiaCt, setRwDiaCt] = useState("");
  const [rwDiaShape, setRwDiaShape] = useState("Round");
  const [rwCharge, setRwCharge] = useState("");
  const [rwNote, setRwNote] = useState("");
  const [rwSaving, setRwSaving] = useState(false);
  const [issueDiaKind, setIssueDiaKind] = useState<"loose" | "certified">("loose");
  const [issueCertPacketIds, setIssueCertPacketIds] = useState<string[]>([]);
  const [issueCertSearch, setIssueCertSearch] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Single materials flow: factory + estimate + diamond (stock or buy).
  const [showEstimate, setShowEstimate] = useState(false);
  const [estGold, setEstGold] = useState("");
  const [estDia, setEstDia] = useState("");
  const [estMaking, setEstMaking] = useState("");
  const [diaSource, setDiaSource] = useState<"stock" | "buy">("stock");
  const [showDiamond, setShowDiamond] = useState(false);

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
    // Client's flow: assign the factory first, then buy — the purchased material
    // goes STRAIGHT to that factory, no separate "issue" step.
    if (!order.assignedFactoryId) { toast.error("Assign a factory first (Stage ① above) — the material goes straight to it."); return; }
    for (const line of buyLines) {
      if (line.material === "gold" && (!line.goldWeight || Number(line.goldWeight) <= 0)) { toast.error("Enter gold weight for every line"); return; }
      if (line.material === "diamond" && (!line.diaCarat || Number(line.diaCarat) <= 0)) { toast.error("Enter diamond carat for every line"); return; }
      if (line.material === "diamond" && line.diaKind === "certified" && !line.diaCertNo.trim()) { toast.error("Enter the report number for every certified diamond line"); return; }
      if (line.currency === "USD" && !line.exchangeRate) { toast.error("Enter the exchange rate for every USD line"); return; }
      if (buyLineTotalInr(line) <= 0) { toast.error("A line's total comes to ₹0 — check its weight/rate fields"); return; }
    }

    const supplier = db.suppliers.find(s => s.id === buySupplierId);
    const now = new Date().toISOString();
    const newPurchases: Purchase[] = buyLines.map(line => ({
      id: uid("pur_"),
      supplierId: buySupplierId,
      material: line.material,
      gold: line.material === "gold" ? { weightGrams: Number(line.goldWeight), purity: line.goldPurity, ratePerGram: Number(line.goldRate) || 0 } : undefined,
      diamond: line.material === "diamond" ? {
        carat: Number(line.diaCarat), quality: line.diaQuality || undefined, ratePerCarat: Number(line.diaRate) || 0,
        kind: line.diaKind, shape: line.diaShape,
        certificateNumber: line.diaKind === "certified" ? line.diaCertNo.trim() : undefined,
        certificateLab: line.diaKind === "certified" ? (line.diaLab.trim() || undefined) : undefined,
      } : undefined,
      purpose: "order",
      orderId: order.id,
      currency: line.currency,
      totalUsd: line.currency === "USD" ? Math.round(buyLineBaseAmount(line) * 100) / 100 : undefined,
      exchangeRate: line.currency === "USD" ? Number(line.exchangeRate) : undefined,
      totalInr: buyLineTotalInr(line),
      payments: [],
      invoiceNumber: line.invoiceNumber.trim() || undefined,
      notes: line.notes.trim() || undefined,
      createdBy: user!.id,
      createdAt: now,
    }));

    // Precompute each line's pooled-stock bucket up front — needed both for the
    // stock-movement logging below (which must happen before updateDb, so a
    // failed write there fails the whole action instead of leaving an orphaned
    // purchase with no stock trail) and inside updateDb itself.
    const lineMeta = newPurchases.map((purchase, i) => {
      const line = buyLines[i];
      const isCertified = purchase.material === "diamond" && line.diaKind === "certified";
      const qty = purchase.material === "gold" ? purchase.gold!.weightGrams : purchase.diamond!.carat;
      // Loose diamonds are pooled by SHAPE (Round/Oval/…), same as the Supplier
      // and Buy & Assign flows — NOT by quality grade — so the Stock ledger and
      // balances stay consistent across every purchase path.
      const purityOrQuality = purchase.material === "gold" ? purchase.gold!.purity
        : isCertified ? "Certified" : (purchase.diamond!.shape || "unspecified");
      return { isCertified, qty, purityOrQuality };
    });

    setBuying(true);
    try {
      const factoryId = order.assignedFactoryId!;
      const factory = db.factories.find(f => f.id === factoryId);

      // Material bought for this order goes straight to the factory and never
      // enters the shared stock pool — but log it (paired in+out, nets to zero)
      // so it still shows up on the Stock report. Certified diamonds are tracked
      // individually via DiamondPacket instead and are never pooled.
      for (let i = 0; i < newPurchases.length; i++) {
        const { isCertified, qty, purityOrQuality } = lineMeta[i];
        if (isCertified) continue;
        await logOrderDirectPurchase({
          material: newPurchases[i].material, purityOrQuality, quantity: qty,
          purchaseId: newPurchases[i].id, orderId: order.id, createdBy: user!.id,
        });
      }

      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        if (!d.materialIssuances) d.materialIssuances = [];
        const o = d.orders.find(o => o.id === order.id);
        if (o) {
          if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
          if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
          if (!o.manufacturingLog) o.manufacturingLog = [];
        }
        for (let i = 0; i < newPurchases.length; i++) {
          const purchase = newPurchases[i];
          const line = buyLines[i];
          d.purchases.unshift(purchase);
          if (!o) continue;
          o.linkedPurchaseIds!.push(purchase.id);
          const { isCertified, qty, purityOrQuality } = lineMeta[i];
          const label = purchase.material === "gold"
            ? `${qty}g ${purityOrQuality} gold`
            : `${qty}ct ${line.diaShape} diamond${isCertified ? ` (Certified ${line.diaCertNo.trim()})` : purchase.diamond!.quality ? ` (${purchase.diamond!.quality})` : ""}`;
          o.manufacturingLog!.push({
            id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
            material: purchase.material, amountMaterial: qty, amountInr: purchase.totalInr,
            remarks: `Purchased ${label} from ${supplier?.name || "supplier"} for this order — ${fmtMoneyInr(purchase.totalInr)}`,
          });

          // Certified diamond → its own packet, going straight to the factory.
          let packetIds: string[] | undefined;
          if (isCertified) {
            if (!d.diamondPackets) d.diamondPackets = [];
            const packetId = uid("dp_");
            const carat = Number(line.diaCarat) || 0;
            d.diamondPackets.unshift({
              id: packetId, stockNumber: nextDiamondStockNumber(d), shape: line.diaShape, carat, quality: line.diaQuality || undefined,
              color: line.diaColor.trim() || undefined, clarity: line.diaClarity.trim() || undefined,
              cut: line.diaCut.trim() || undefined, polish: line.diaPolish.trim() || undefined,
              symmetry: line.diaSym.trim() || undefined, fluorescence: line.diaFluor.trim() || undefined,
              measurement: line.diaMeasure.trim() || undefined,
              certificateNumber: line.diaCertNo.trim(), certificateLab: line.diaLab.trim() || undefined,
              ratePerCaratInr: carat > 0 ? Math.round((purchase.totalInr / carat) * 100) / 100 : undefined,
              supplierId: buySupplierId, purchaseId: purchase.id,
              status: "issued", orderId: order.id,
              createdBy: user!.id, createdAt: now,
            });
            packetIds = [packetId];
          }

          // Auto-issue straight to the assigned factory (source "purchase" — the
          // pooled stockLevels balance is untouched, though it's now logged in
          // stockMovements for reporting; see logOrderDirectPurchase above). One step.
          const issuanceId = uid("mi_");
          d.materialIssuances.unshift({
            id: issuanceId, factoryId, orderId: order.id, material: purchase.material,
            purityOrQuality, quantityIssued: qty, source: "purchase", sourcePurchaseId: purchase.id,
            diamondKind: purchase.material === "diamond" ? line.diaKind : undefined,
            diamondPacketIds: packetIds,
            issuedAt: now, issuedBy: user!.id, status: "open",
            finishedPieces: [{ id: uid("fp_"), quantityUsed: qty, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
            makingCharges: { amountInr: 0, payments: [] },
          });
          o.materialIssuanceIds!.push(issuanceId);
          o.manufacturingLog!.push({
            id: uid("mlog_"), type: "material_issued", at: now, employeeId: user!.id, factoryId,
            material: purchase.material, amountMaterial: qty,
            remarks: `${qty}${purchase.material === "gold" ? "g" : "ct"} ${isCertified ? `certified ${line.diaShape}` : purityOrQuality} ${purchase.material} sent to ${factory?.name || "factory"} (bought for this order)`,
          });
        }
      });
      toast.success(`${newPurchases.length > 1 ? `${newPurchases.length} purchases` : "Purchase"} recorded (${fmtMoneyInr(buyGrandTotalInr)}) & sent to ${factory?.name || "the factory"}`);
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
    setIssueDiaKind("loose"); setIssueCertPacketIds([]); setIssueCertSearch("");
  };

  // ── Rework / alteration ──────────────────────────────────────────────────
  // A finished/delivered piece comes back for changes. We ADD a fresh set of
  // MaterialIssuance records (never touching the original finish record), and
  // move stock, so factory balances + all ledgers (which are derived) update on
  // their own. Gold/diamond ADDED is drawn from stock and passes through the
  // factory net-zero (issued-in + used-in-piece); REMOVED material goes back to
  // stock; the rework labour becomes a factory making charge.
  const recordRework = async () => {
    const factoryId = rwFactoryId || order.assignedFactoryId || "";
    if (!factoryId) { toast.error("Choose a factory for the rework"); return; }
    const factory = db.factories.find(f => f.id === factoryId);
    const goldG = rwGoldDir !== "none" ? Number(rwGoldG) || 0 : 0;
    const diaCt = rwDiaDir !== "none" ? Number(rwDiaCt) || 0 : 0;
    const charge = Number(rwCharge) || 0;
    if (goldG <= 0 && diaCt <= 0 && charge <= 0) { toast.error("Enter a gold/diamond change or a rework charge"); return; }
    setRwSaving(true);
    const now = new Date().toISOString();
    const noteBase = `Rework — ${order.orderNumber}${rwNote.trim() ? ` · ${rwNote.trim()}` : ""}`;
    try {
      // Stock first — an insufficient-stock error aborts before any record is written.
      if (goldG > 0 && rwGoldDir === "add") {
        await decreaseStockSelfHealing({ material: "gold", purityOrQuality: rwGoldKarat, quantity: goldG, type: "order_direct_use", refType: "order", refId: order.id, createdBy: user!.id, note: `Rework +${goldG}g ${rwGoldKarat} gold for ${order.orderNumber}` }, db.stockMovements);
      } else if (goldG > 0 && rwGoldDir === "remove") {
        await increaseStock({ material: "gold", purityOrQuality: rwGoldKarat, quantity: goldG, refType: "manual", createdBy: user!.id, note: `Rework −${goldG}g ${rwGoldKarat} gold from ${order.orderNumber} → stock` });
      }
      if (diaCt > 0 && rwDiaDir === "add") {
        await decreaseStockSelfHealing({ material: "diamond", purityOrQuality: rwDiaShape, quantity: diaCt, type: "order_direct_use", refType: "order", refId: order.id, createdBy: user!.id, note: `Rework +${diaCt}ct ${rwDiaShape} for ${order.orderNumber}` }, db.stockMovements);
      } else if (diaCt > 0 && rwDiaDir === "remove") {
        await increaseStock({ material: "diamond", purityOrQuality: rwDiaShape, quantity: diaCt, refType: "manual", createdBy: user!.id, note: `Rework −${diaCt}ct ${rwDiaShape} from ${order.orderNumber} → stock` });
      }

      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
        if (!o.manufacturingLog) o.manufacturingLog = [];
        let chargeAttached = false;
        // Gold ADD → factory-neutral leg (issued-in via source "stock" + finished-out).
        if (goldG > 0 && rwGoldDir === "add") {
          const kn = parseInt(rwGoldKarat, 10);
          const purMille = KARAT_PURITY[kn] ? Math.round(KARAT_PURITY[kn] * 1000) : undefined;
          const iid = uid("mi_");
          d.materialIssuances.unshift({
            id: iid, factoryId, orderId: o.id, material: "gold", purityOrQuality: rwGoldKarat,
            quantityIssued: goldG, source: "stock",
            finishedNetWeight: goldG, finishedKarat: rwGoldKarat, finishedPurity: purMille,
            finishedPieces: [{ id: uid("fp_"), quantityUsed: goldG, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
            issuedAt: now, issuedBy: user!.id, status: "closed",
            makingCharges: { amountInr: charge, payments: [] },
            notes: `${noteBase} (added ${goldG}g ${rwGoldKarat} gold)`,
          } as MaterialIssuance);
          o.materialIssuanceIds.push(iid);
          chargeAttached = charge > 0;
        }
        // Diamond ADD → factory-neutral leg (issued-in + used-in-piece).
        if (diaCt > 0 && rwDiaDir === "add") {
          const iid = uid("mi_");
          d.materialIssuances.unshift({
            id: iid, factoryId, orderId: o.id, material: "diamond", purityOrQuality: rwDiaShape,
            quantityIssued: diaCt, source: "stock", diamondKind: "loose", finishReturnedCt: 0,
            finishedPieces: [{ id: uid("fp_"), quantityUsed: diaCt, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
            issuedAt: now, issuedBy: user!.id, status: "closed",
            makingCharges: { amountInr: chargeAttached ? 0 : charge, payments: [] },
            notes: `${noteBase} (added ${diaCt}ct ${rwDiaShape})`,
          } as MaterialIssuance);
          o.materialIssuanceIds.push(iid);
          if (charge > 0) chargeAttached = true;
        }
        // Charge with no material added (only removals / labour-only) → carry it on
        // a charge-only issuance so it still lands on the factory account statement.
        if (charge > 0 && !chargeAttached) {
          const iid = uid("mi_");
          d.materialIssuances.unshift({
            id: iid, factoryId, orderId: o.id, material: "gold", purityOrQuality: "—",
            quantityIssued: 0, source: "factoryPool",
            finishedPieces: [], issuedAt: now, issuedBy: user!.id, status: "closed",
            makingCharges: { amountInr: charge, payments: [] },
            notes: `${noteBase} (rework labour)`,
          } as MaterialIssuance);
          o.materialIssuanceIds.push(iid);
        }
        const parts: string[] = [];
        if (goldG > 0) parts.push(`${rwGoldDir === "add" ? "+" : "−"}${goldG}g ${rwGoldKarat} gold`);
        if (diaCt > 0) parts.push(`${rwDiaDir === "add" ? "+" : "−"}${diaCt}ct ${rwDiaShape}`);
        if (charge > 0) parts.push(`labour ${fmtMoneyInr(charge)}`);
        o.manufacturingLog.push({
          id: uid("mlog_"), type: "making_charge_added", at: now, employeeId: user!.id, factoryId,
          material: goldG > 0 ? "gold" : "diamond", amountInr: charge || undefined,
          remarks: `Rework at ${factory?.name || "factory"} — ${parts.join(", ")}${rwNote.trim() ? ` · ${rwNote.trim()}` : ""}`,
        });
      });
      toast.success("Rework recorded — stock, factory & ledger updated");
      setShowRework(false);
      setRwGoldDir("none"); setRwGoldG(""); setRwDiaDir("none"); setRwDiaCt(""); setRwCharge(""); setRwNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rework failed");
    } finally { setRwSaving(false); }
  };

  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock");

  // ── Final Approval popup: one window for all the actual details ──
  const [faIdx, setFaIdx] = useState<number | null>(null);
  const [faGoldNet, setFaGoldNet] = useState("");
  const [faGoldPurity, setFaGoldPurity] = useState(""); // actual purity ‰ (e.g. 750), replaces the karat dropdown
  const [faDia, setFaDia] = useState<Record<string, "used" | "returned">>({}); // certified packets: whole used/returned
  const [faDiaReturnedCt, setFaDiaReturnedCt] = useState<Record<string, string>>({}); // loose diamonds: carats returned (partial allowed)
  const [faPerGram, setFaPerGram] = useState("");
  const [faCad, setFaCad] = useState("");
  const [faDiaHandling, setFaDiaHandling] = useState("");
  const [faOther, setFaOther] = useState("");
  const [faMetalG, setFaMetalG] = useState("");
  const [faMetalRate, setFaMetalRate] = useState("");
  const [faOrderValue, setFaOrderValue] = useState("");
  const [faShipping, setFaShipping] = useState("");
  const [faSaving, setFaSaving] = useState(false);

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
    // Keep the reused issue/buy handlers pointed at this factory, in diamond mode
    // (gold is reserved at the factory, so the order only ever sources diamond).
    if (factoryId) { setIssueFactoryId(factoryId); setIssueMaterial("diamond"); }
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

  // "Mark Done" on a factory issuance — finalize it from the order itself, so
  // staff never open the Factory page. Ported faithfully from FactoryHistory's
  // closeIssuance: unused material auto-returns (to Stock if stock-sourced, to
  // the factory's own pool if pool-sourced) and certified stones flip to "used".
  // "Receive finished piece" form — one issuance open at a time.
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [rcvNetW, setRcvNetW] = useState("");
  const [rcvKarat, setRcvKarat] = useState("");
  const [rcvPerGram, setRcvPerGram] = useState("");
  const [rcvCad, setRcvCad] = useState("");
  const [rcvDiaHandling, setRcvDiaHandling] = useState("");
  const [rcvOther, setRcvOther] = useState("");
  const [rcvMetalG, setRcvMetalG] = useState("");
  const [rcvMetalRate, setRcvMetalRate] = useState("");

  const openReceive = (mi: MaterialIssuance) => {
    setRcvNetW(mi.finishedNetWeight != null ? String(mi.finishedNetWeight) : (mi.material === "gold" ? String(mi.quantityIssued) : ""));
    setRcvKarat(mi.finishedKarat ?? (mi.material === "gold" ? mi.purityOrQuality : (order.productKarats ?? "")));
    setRcvPerGram(mi.labour?.perGramRate != null ? String(mi.labour.perGramRate) : "");
    setRcvCad(mi.labour?.cadCharge != null ? String(mi.labour.cadCharge) : "");
    setRcvDiaHandling(mi.labour?.diamondHandlingRate != null ? String(mi.labour.diamondHandlingRate) : "");
    setRcvOther(mi.labour?.otherCharges != null ? String(mi.labour.otherCharges) : "");
    setRcvMetalG(mi.labour?.metalByFactoryGrams != null ? String(mi.labour.metalByFactoryGrams) : "");
    setRcvMetalRate(mi.labour?.metalByFactoryRate != null ? String(mi.labour.metalByFactoryRate) : "");
    setReceivingId(mi.id);
  };

  const [closingId, setClosingId] = useState<string | null>(null);

  // Receive the finished piece back (the client's "RCV" step): record net weight
  // + karat (→ pure gold nets off the factory's fine-gold balance), the labour
  // formula (→ factory payable), and any metal the factory supplied itself. Then
  // finalize the issuance, returning any unused material like closeOrderIssuance.
  const receiveFinished = async (issuance: MaterialIssuance) => {
    const isGold = issuance.material === "gold";
    const netW = parseFloat(rcvNetW);
    const hasNet = isGold && !isNaN(netW) && netW > 0;
    const labour = {
      perGramRate: rcvPerGram ? Number(rcvPerGram) : undefined,
      diamondHandlingRate: rcvDiaHandling ? Number(rcvDiaHandling) : undefined,
      cadCharge: rcvCad ? Number(rcvCad) : undefined,
      otherCharges: rcvOther ? Number(rcvOther) : undefined,
      metalByFactoryGrams: rcvMetalG ? Number(rcvMetalG) : undefined,
      metalByFactoryRate: rcvMetalRate ? Number(rcvMetalRate) : undefined,
    };
    const diamondCt = order.actualDiamondWeight || order.diamondWeight || 0;
    const value = labourValue(labour, hasNet ? netW : (issuance.finishedNetWeight || 0), diamondCt);
    const karat = rcvKarat || issuance.purityOrQuality;
    // Gold: what's in the piece = net weight; the rest goes back. Diamonds keep
    // their existing used amount (net weight doesn't apply).
    const usedQty = hasNet ? Math.min(netW, issuance.quantityIssued) : issuanceUsed(issuance);
    const leftover = Math.round((issuance.quantityIssued - usedQty) * 100) / 100;
    const unit = isGold ? "g" : "ct";
    const factory = db.factories.find(f => f.id === issuance.factoryId);
    const now = new Date().toISOString();
    setClosingId(issuance.id);
    try {
      const returnsToStock = leftover > 0 && issuance.diamondKind !== "certified" && issuance.source === "stock";
      const releasesToPool = leftover > 0 && issuance.source === "factoryPool";
      if (returnsToStock) {
        await increaseStock({
          material: issuance.material, purityOrQuality: issuance.purityOrQuality, quantity: leftover,
          refType: "manual", createdBy: user!.id,
          note: `Unused material returned on receiving finished piece for ${factory?.name || "factory"}`,
        });
      }
      updateDb(d => {
        const mi = d.materialIssuances.find(x => x.id === issuance.id);
        if (mi) {
          mi.status = "closed";
          mi.labour = labour;
          mi.makingCharges = { amountInr: value, payments: mi.makingCharges?.payments || [] };
          if (hasNet) {
            mi.finishedNetWeight = netW;
            mi.finishedKarat = karat;
            mi.finishedPieces = [{ id: uid("fp_"), quantityUsed: usedQty, piecesCount: 1, recordedAt: now, recordedBy: user!.id }];
          }
          if (returnsToStock || releasesToPool) mi.quantityIssued = Math.round((mi.quantityIssued - leftover) * 100) / 100;
        }
        if (issuance.diamondKind === "certified" && issuance.diamondPacketIds) {
          for (const p of d.diamondPackets) if (issuance.diamondPacketIds.includes(p.id)) p.status = "used";
        }
        const o = d.orders.find(o => o.id === issuance.orderId);
        if (o) {
          if (!o.manufacturingLog) o.manufacturingLog = [];
          o.manufacturingLog.push({
            id: uid("mlog_"), type: "material_returned", at: now, employeeId: user!.id, factoryId: issuance.factoryId,
            material: issuance.material, amountMaterial: leftover > 0 ? leftover : undefined, amountInr: value || undefined,
            remarks: `Finished piece received from ${factory?.name || "factory"}${hasNet ? ` — net ${netW}${unit} (${toPureGold(netW, karat)}g fine gold)` : ""}${value ? ` · labour ${fmtMoneyInr(value)}` : ""}${leftover > 0 ? ` · ${leftover}${unit} returned` : ""}`,
          });
        }
      });
      toast.success(`Finished piece received${value ? ` — labour ${fmtMoneyInr(value)}` : ""}`);
      setReceivingId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally { setClosingId(null); }
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

    // "From Stock" is now an explicit choice, so it MUST draw from company stock
    // (and decrement it) — no silent auto-resolve to a factory pool or a linked
    // purchase, which was leaving stock untouched.
    const resolvedSource: "factoryPool" | "purchase" | "stock" = "stock";

    const issuanceId = uid("mi_");
    const now = new Date().toISOString();
    setIssuing(true);
    try {
      if (resolvedSource === "stock") {
        await decreaseStockSelfHealing({
          material: issueMaterial, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Used by ${factory?.name || "factory"} for order ${order.orderNumber}`,
        }, db.stockMovements);
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: issueFactoryId, orderId: order.id, material: issueMaterial,
          purityOrQuality, quantityIssued: qty,
          source: resolvedSource,
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
  const faStepIdx = order.timeline.findIndex(t => t.step === "Final Approval");
  const faDone = faStepIdx >= 0 && order.timeline[faStepIdx].status === "done";

  const advanceStep = (idx: number, overrideReadiness = false): boolean => {
    if (order.timeline[idx].step === "Final Approval" && !overrideReadiness && !readiness.ready) {
      toast.error(`Issue ${readiness.missing.join(" and ")} to a factory before Final Approval`);
      return false;
    }
    // Never let goods leave without a price, and warn before shipping unpaid.
    if (order.timeline[idx].step === "Dispatch") {
      if (orderTotal(order) <= 0) { toast.error("Set the order price before dispatching."); return false; }
      if (balanceDue(order) > 0 && !confirm(`Balance of ${fmtMoney(balanceDue(order))} is still unpaid on this order. Dispatch anyway?`)) return false;
    }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.timeline[idx] = { ...o.timeline[idx], status: "done", date: new Date().toISOString(), employeeId: user!.id, department: user!.department, remarks: "Completed" };
      if (idx + 1 < o.timeline.length && o.timeline[idx + 1].status === "pending") o.timeline[idx + 1].status = "in_progress";
      o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");
      // Cashback: on delivery of a real (client) order, grant a % gift card for
      // the next order — only for gift-card-enabled clients, and only once.
      if (o.status === "Delivered" && !o.forReadyStock && !o.cashbackIssued) {
        const c = d.clients.find(x => x.id === o.clientId);
        const pct = cashbackPercentFor(d, c);
        const amt = Math.round(orderTotal(o) * pct) / 100; // pct is a percentage
        if (c && pct > 0 && amt > 0) {
          const now = new Date().toISOString();
          issueGiftCard(d, { clientId: o.clientId, amount: amt, source: "cashback", issuedBy: "system", sourceOrderId: o.id, at: now });
          o.cashbackIssued = true;
          const cu = d.users.find(u => u.clientId === o.clientId && u.role === "client");
          if (cu) d.notifications.unshift({ id: uid("n_"), userId: cu.id, title: "Cashback earned 🎁", body: `${fmtMoney(amt)} gift card for your next order (from ${o.orderNumber}). Valid 30 days.`, type: "info", read: false, createdAt: now });
        }
      }
      const clientUser = d.users.find(u => u.clientId === o.clientId);
      if (clientUser) d.notifications.unshift({ id: "n" + Date.now(), userId: clientUser.id, title: "Timeline updated", body: `${o.orderNumber}: ${o.timeline[idx].step}`, type: "info", read: false, createdAt: new Date().toISOString() });
    });
    toast.success("Stage marked complete");
    return true;
  };

  const forceAdvanceStep = (idx: number) => {
    if (!confirm(`Mark Final Approval complete without recording ${readiness.missing.join(" and ")} issuance? Only do this if the material was sourced outside this system.`)) return;
    advanceStep(idx, true);
  };

  // The single "finishing" record for an order (gold net weight + labour). Used
  // to prefill the popup on re-edit and to update in place instead of duplicating.
  const finishRecord = () => db.materialIssuances.find(i => i.orderId === order.id && i.material === "gold" && i.source === "factoryPool");

  const openFinalApproval = (idx: number) => {
    const needsGold = orderMaterialRequirements(order).needsGold;
    const finish = finishRecord();
    setFaGoldNet(finish?.finishedNetWeight != null ? String(finish.finishedNetWeight) : (needsGold ? (order.estimatedGrossWeight?.toString() ?? order.metalWeight?.toString() ?? "") : ""));
    // Prefill purity ‰: saved value, else the textbook purity of the order's karat (editable).
    const defaultPurity = order.productKarats ? Math.round((KARAT_PURITY[parseInt(order.productKarats, 10)] ?? 0) * 1000) : 0;
    setFaGoldPurity(finish?.finishedPurity != null ? String(finish.finishedPurity) : (defaultPurity ? String(defaultPurity) : ""));
    setFaPerGram(finish?.labour?.perGramRate != null ? String(finish.labour.perGramRate) : "");
    setFaCad(finish?.labour?.cadCharge != null ? String(finish.labour.cadCharge) : "");
    setFaDiaHandling(finish?.labour?.diamondHandlingRate != null ? String(finish.labour.diamondHandlingRate) : "");
    setFaOther(finish?.labour?.otherCharges != null ? String(finish.labour.otherCharges) : "");
    setFaMetalG(finish?.labour?.metalByFactoryGrams != null ? String(finish.labour.metalByFactoryGrams) : "");
    setFaMetalRate(finish?.labour?.metalByFactoryRate != null ? String(finish.labour.metalByFactoryRate) : "");
    const dias = db.materialIssuances.filter(i => i.orderId === order.id && i.material === "diamond");
    const disp: Record<string, "used" | "returned"> = {};
    const ret: Record<string, string> = {};
    dias.forEach(i => {
      disp[i.id] = i.finishDisposition ?? "used";
      ret[i.id] = i.finishReturnedCt != null ? String(i.finishReturnedCt) : "0";
    });
    setFaDia(disp);
    setFaDiaReturnedCt(ret);
    setFaOrderValue(order.amount ? String(order.amount) : "");
    setFaShipping(order.shippingCharge ? String(order.shippingCharge) : "");
    setFaIdx(idx);
  };

  const saveFinalApproval = async () => {
    if (faIdx === null) return;
    const needsGold = orderMaterialRequirements(order).needsGold;
    const netW = parseFloat(faGoldNet);
    const hasNet = needsGold && !isNaN(netW) && netW > 0;
    const purity = parseFloat(faGoldPurity) || 0; // ‰ e.g. 750
    const karat = order.productKarats || "18K"; // label only
    const dias = db.materialIssuances.filter(i => i.orderId === order.id && i.material === "diamond");
    // Carats actually consumed into the piece: certified = whole if "used";
    // loose = issued minus the partial returned amount.
    const looseReturnedCt = (i: MaterialIssuance) => Math.min(Math.max(Number(faDiaReturnedCt[i.id]) || 0, 0), i.quantityIssued);
    const usedDiaCt = dias.reduce((s, i) => {
      if (i.diamondKind === "certified") return s + ((faDia[i.id] ?? "used") === "used" ? i.quantityIssued : 0);
      return s + (i.quantityIssued - looseReturnedCt(i));
    }, 0);
    const labour = {
      perGramRate: faPerGram ? Number(faPerGram) : undefined,
      diamondHandlingRate: faDiaHandling ? Number(faDiaHandling) : undefined,
      cadCharge: faCad ? Number(faCad) : undefined,
      otherCharges: faOther ? Number(faOther) : undefined,
      metalByFactoryGrams: faMetalG ? Number(faMetalG) : undefined,
      metalByFactoryRate: faMetalRate ? Number(faMetalRate) : undefined,
    };
    const labourVal = labourValue(labour, hasNet ? netW : 0, usedDiaCt);
    const factoryId = order.assignedFactoryId;
    const orderVal = parseFloat(faOrderValue);
    const ship = parseFloat(faShipping);
    const alreadyDone = order.timeline[faIdx]?.status === "done";
    const now = new Date().toISOString();
    setFaSaving(true);
    try {
      // Loose-diamond stock changes based on the transition (handles re-edits too).
      // Only source:"stock" issuances ever touch shared Stock, matching
      // FactoryHistory.tsx's returnMaterial: a factoryPool draw returns to the
      // factory's own pool instead (factoryPoolBalance already excludes a
      // finishDisposition:"returned" draw from "drawn" — no movement needed
      // here, just the flag set below), and a purchase-sourced diamond was
      // never in shared Stock, so "returning" it moves nothing.
      for (const i of dias) {
        if (i.diamondKind === "certified" || i.source !== "stock") continue;
        // Partial returns allowed — move only the DELTA in returned carats to/from stock.
        const returnedNow = looseReturnedCt(i);
        const returnedBefore = i.finishReturnedCt || 0;
        const delta = Math.round((returnedNow - returnedBefore) * 1000) / 1000;
        if (delta > 0) {
          await increaseStock({ material: "diamond", purityOrQuality: i.purityOrQuality, quantity: delta, refType: "manual", createdBy: user!.id, note: `${delta}ct diamond returned on final approval for ${order.orderNumber}` });
        } else if (delta < 0) {
          await decreaseStockSelfHealing({ material: "diamond", purityOrQuality: i.purityOrQuality, quantity: -delta, type: "issuance_out", refType: "materialIssuance", refId: i.id, createdBy: user!.id, note: `Diamond re-used (un-returned) on final approval edit for ${order.orderNumber}` }, db.stockMovements);
        }
      }
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        if (!d.materialIssuances) d.materialIssuances = [];
        // The finishing record — update in place if it exists (re-edit), else create.
        if (factoryId) {
          let finish = d.materialIssuances.find(i => i.orderId === order.id && i.material === "gold" && i.source === "factoryPool");
          if (!finish) {
            finish = {
              id: uid("mi_"), factoryId, orderId: order.id, material: "gold", purityOrQuality: karat,
              quantityIssued: 0, source: "factoryPool", issuedAt: now, issuedBy: user!.id, status: "closed",
              finishedPieces: [], makingCharges: { amountInr: 0, payments: [] },
            };
            d.materialIssuances.unshift(finish);
            if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
            o.materialIssuanceIds.push(finish.id);
          }
          finish.factoryId = factoryId;
          finish.purityOrQuality = karat;
          finish.quantityIssued = hasNet ? netW : 0;
          finish.finishedNetWeight = hasNet ? netW : undefined;
          finish.finishedKarat = hasNet ? karat : undefined;
          finish.finishedPurity = hasNet && purity > 0 ? purity : undefined;
          finish.labour = labour;
          finish.finishedPieces = hasNet ? [{ id: uid("fp_"), quantityUsed: netW, piecesCount: 1, recordedAt: now, recordedBy: user!.id }] : [];
          finish.makingCharges = { amountInr: labourVal, payments: finish.makingCharges?.payments || [] };
          finish.status = "closed";
        }
        // Apply each diamond's disposition.
        for (const i of dias) {
          const mi = d.materialIssuances.find(x => x.id === i.id);
          if (!mi) continue;
          mi.status = "closed";
          if (i.diamondKind === "certified" && i.diamondPacketIds) {
            // Whole packets — used or returned.
            const disp = faDia[i.id] ?? "used";
            mi.finishDisposition = disp;
            for (const p of d.diamondPackets) if (i.diamondPacketIds.includes(p.id)) {
              if (disp === "used") { p.status = "used"; p.orderId = order.id; }
              else { p.status = "in_stock"; p.orderId = undefined; }
            }
          } else {
            // Loose — record the partial returned carats; used = issued − returned.
            const returned = looseReturnedCt(i);
            mi.finishReturnedCt = returned;
            mi.finishDisposition = returned >= i.quantityIssued ? "returned" : "used";
            const usedCt = Math.round((i.quantityIssued - returned) * 1000) / 1000;
            mi.finishedPieces = [{ id: uid("fp_"), quantityUsed: usedCt, piecesCount: 1, recordedAt: now, recordedBy: user!.id }];
          }
        }
        // Client billing.
        if (!isNaN(orderVal) && orderVal > 0) o.amount = orderVal;
        if (faShipping.trim() !== "" && !isNaN(ship) && ship >= 0) o.shippingCharge = ship;
        const back = capOrderAdvances(o);
        if (back > 0) { const c = d.clients.find(x => x.id === o.clientId); if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + back) * 100) / 100; }
        if (!o.manufacturingLog) o.manufacturingLog = [];
        o.manufacturingLog.push({
          id: uid("mlog_"), type: "material_returned", at: now, employeeId: user!.id, factoryId,
          material: "gold", amountMaterial: hasNet ? netW : undefined, amountInr: labourVal || undefined,
          remarks: `${alreadyDone ? "Final details updated" : "Final approval"} — ${hasNet ? `net ${netW}g @ ${purity || "?"} purity (${purity > 0 ? pureFromPurity(netW, purity) : 0}g fine gold)` : "no gold used"}${labourVal ? ` · labour ${fmtMoneyInr(labourVal)}` : ""}`,
        });
      });
      if (!alreadyDone) advanceStep(faIdx, true);
      toast.success(alreadyDone ? "Final details updated" : "Final approval saved");
      setFaIdx(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save final approval");
    } finally { setFaSaving(false); }
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

  const orderEmailInfo = () => ({
    orderNumber: order.orderNumber,
    clientName: client?.companyName ?? "Client",
    jewelleryType: order.jewelleryType,
    metal: order.metal,
    quantity: order.quantity,
    expectedDelivery: order.expectedDelivery,
  });

  // Return any gold/diamond issued for this order back to stock, release undrawn
  // factory-pool draws, free certified packets, and close open issuances. Shared
  // by both Reject and Cancel so a rejected order never strands material.
  const returnIssuedMaterials = async () => {
    const openIssuances = db.materialIssuances.filter(i => i.orderId === order.id && i.status === "open");
    for (const mi of openIssuances) {
      if (mi.source === "stock" && mi.diamondKind !== "certified") {
        const used = (mi.finishedPieces || []).reduce((s, f) => s + f.quantityUsed, 0);
        const remaining = Math.round((mi.quantityIssued - used) * 100) / 100;
        if (remaining > 0) {
          await increaseStock({
            material: mi.material, purityOrQuality: mi.purityOrQuality, quantity: remaining,
            refType: "manual", createdBy: user!.id, note: `Returned from order ${order.orderNumber}`,
          });
        }
      }
    }
    updateDb(d => {
      for (const mi of d.materialIssuances) {
        if (mi.orderId === order.id && mi.status === "open") {
          if (mi.source === "factoryPool") mi.quantityIssued = Math.round(issuanceUsed(mi) * 100) / 100;
          mi.status = "closed";
        }
      }
      for (const p of d.diamondPackets || []) {
        if (p.orderId === order.id) { p.status = "in_stock"; p.orderId = undefined; }
      }
    });
  };

  const approve = async (yes: boolean) => {
    if (!yes && !confirm("Reject this order? Any gold/diamond issued for it returns to stock. You can re-open it to Waiting later if this was a mistake.")) return;
    const now = new Date().toISOString();
    // On reject, first return any material that was already issued for the order.
    if (!yes) {
      try { await returnIssuedMaterials(); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Failed to return issued material"); return; }
    }
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
    // Email the client on approval (fire-and-forget — never blocks the action).
    if (yes && client?.email) {
      const m = orderApprovedEmail(orderEmailInfo());
      void sendMail(client.email, m.subject, m.html);
    }
    toast.success(yes ? "Order approved" : "Order rejected — issued material returned to stock");
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
    setCancelling(true);
    try {
      await returnIssuedMaterials(); // return gold/diamond, free packets, close issuances
      const now = new Date().toISOString();
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.status = "Rejected";
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

  const save3dmModel = async (file: File) => {
    if (!/\.3dm$/i.test(file.name)) { toast.error("Please choose a .3dm file"); return; }
    setModel3dmUploading(true);
    try {
      const url = await uploadFile(file, `orders/${order.id}/model3dm`);
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.cad3dmUrl = url;
      });
      toast.success("3D model uploaded — View 360° is now available");
    } catch { toast.error("Failed to upload the 3D model"); }
    setModel3dmUploading(false);
  };

  // ── Finished-product photography ────────────────────────────────────────
  const addProductPhotos = async (files: FileList) => {
    const current = order.productPhotos?.length ?? 0;
    const incoming = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!incoming.length) { toast.error("Please choose image files"); return; }
    const room = Math.max(0, 8 - current);
    if (room === 0) { toast.error("Up to 8 photos — remove one first"); return; }
    const batch = incoming.slice(0, room);
    setPhotoUploading(true);
    try {
      const urls = await Promise.all(batch.map(async f => uploadDataUrl(await compressImage(f), `orders/${order.id}/product`)));
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.productPhotos = [...(o.productPhotos ?? []), ...urls];
      });
      toast.success(`${urls.length} photo${urls.length !== 1 ? "s" : ""} added${batch.length < incoming.length ? " · max 8" : ""}`);
    } catch { toast.error("Failed to upload photos"); }
    setPhotoUploading(false);
  };

  const addProductVideo = async (file: File) => {
    if (!file.type.startsWith("video/")) { toast.error("Please choose a video file"); return; }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) { toast.error(`Video is too large — keep it under ${MAX_VIDEO_MB} MB`); return; }
    setVideoUploading(true);
    try {
      const prev = order.productVideo;
      const url = await uploadFile(file, `orders/${order.id}/product`);
      updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.productVideo = url; });
      if (prev) await deleteByUrl(prev);
      toast.success("Product video uploaded");
    } catch { toast.error("Failed to upload the video"); }
    setVideoUploading(false);
  };

  const removeProductPhoto = async (photoUrl: string) => {
    updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.productPhotos = (o.productPhotos ?? []).filter(u => u !== photoUrl); });
    await deleteByUrl(photoUrl);
    toast.success("Photo removed");
  };

  const removeProductVideo = async () => {
    const videoUrl = order.productVideo;
    updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.productVideo = undefined; });
    await deleteByUrl(videoUrl);
    toast.success("Video removed");
  };

  // Force a real download (Storage URLs otherwise open in a tab). Fetch the blob
  // and save it with a friendly filename; fall back to opening the URL on error.
  const downloadOne = async (fileUrl: string, filename: string) => {
    try {
      const res = await fetch(fileUrl);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 4000);
    } catch { window.open(fileUrl, "_blank"); }
  };

  const downloadAllMedia = async () => {
    const design = (order.designNumber || order.orderNumber || "product").replace(/[^\w.-]+/g, "_");
    const photos = order.productPhotos ?? [];
    setDownloadingAll(true);
    try {
      for (let i = 0; i < photos.length; i++) await downloadOne(photos[i], `${design}-photo-${i + 1}.jpg`);
      if (order.productVideo) await downloadOne(order.productVideo, `${design}-video.mp4`);
    } finally { setDownloadingAll(false); }
  };

  // The Starlink360 web viewer needs the file URL passed (encoded) as ?file=…
  const viewer360Url = order.cad3dmUrl
    ? `https://starlink360.vercel.app/?file=${encodeURIComponent(order.cad3dmUrl)}&embed=true`
    : "";

  const saveActualDetails = () => {
    // Every field is optional — update only what was actually filled in, and
    // never overwrite an existing value with a blank.
    const gw = parseFloat(actGrossW);
    const nw = parseFloat(actNetW);
    const dw = parseFloat(actDiamW);
    const val = parseFloat(actOrderValue);
    const ship = parseFloat(actShipping);
    const mk = parseFloat(actMaking);
    const has = (n: number) => !isNaN(n) && n > 0;
    const shipEntered = actShipping.trim() !== "" && !isNaN(ship) && ship >= 0;
    const makingEntered = actMaking.trim() !== "" && !isNaN(mk) && mk >= 0;
    if (!has(gw) && !has(nw) && !has(dw) && !has(val) && !shipEntered && !makingEntered) {
      toast.error("Enter at least one value to update");
      return;
    }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      if (has(gw)) o.actualGrossWeight   = gw;
      if (has(nw)) o.actualNetWeight     = nw;
      if (has(dw)) o.actualDiamondWeight = dw;
      if (shipEntered) o.shippingCharge = ship;
      if (makingEntered) o.actualMakingCharges = mk;
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

  // Dispatch popup opened from the timeline's "Mark complete" — collect the
  // courier details, then complete the step AND email the client.
  const openDispatchModal = (idx: number) => {
    setCourierName(order.courierName ?? "");
    setTrackingNumber(order.trackingNumber ?? "");
    setTrackingLink(order.trackingLink ?? "");
    setDispatchModalIdx(idx);
  };

  const confirmDispatch = async () => {
    if (dispatchModalIdx === null) return;
    if (!courierName.trim()) { toast.error("Enter the courier name"); return; }
    if (!trackingNumber.trim()) { toast.error("Enter the tracking number"); return; }
    setDispatchSaving(true);
    try {
      // Save the dispatch details onto the order first…
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.courierName = courierName.trim();
        o.trackingNumber = trackingNumber.trim();
        o.trackingLink = trackingLink.trim() || undefined;
      });
      // …then complete the Dispatch step (runs the price/unpaid guard).
      const advanced = advanceStep(dispatchModalIdx, false);
      if (advanced) {
        if (client?.email) {
          const m = orderDispatchedEmail({ ...orderEmailInfo(), courierName: courierName.trim(), trackingNumber: trackingNumber.trim(), trackingLink: trackingLink.trim() || undefined });
          void sendMail(client.email, m.subject, m.html);
        }
        setDispatchModalIdx(null);
      }
      // If the guard blocked (no price / declined unpaid warning) keep the popup open.
    } finally { setDispatchSaving(false); }
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
  // Product photography: staff can upload at any stage of the order, not just
  // after dispatch; the card stays visible to everyone (incl. the client) once
  // media exists, even if the uploader's own edit rights change later.
  const hasProductMedia = (order.productPhotos?.length ?? 0) > 0 || !!order.productVideo;
  const showPhotographySection = canEditStage() || hasProductMedia;

  const handlePrintInvoice = () => {
    const amount = orderTotal(order);
    const paid = balance <= 0;
    const existing = findInvoiceForOrder(db.invoices, order.id);
    if (existing) {
      const ids = invoiceOrderIds(existing);
      // Part of a dispatch-batch invoice → print the whole invoice (all orders).
      if (ids.length > 1) {
        const orders = ids.map(id => db.orders.find(o => o.id === id)).filter((o): o is Order => !!o);
        printBatchInvoice(orders, client, db.settings, existing.number, existing.createdAt.slice(0, 10));
        return;
      }
      // Single-order invoice → keep its snapshot current, then print.
      if (existing.amount !== amount || existing.paid !== paid) {
        updateDb(d => { const i = d.invoices.find(x => x.id === existing.id); if (i) { i.amount = amount; i.paid = paid; } });
      }
      printInvoice(order, client, db.settings, existing.number);
      return;
    }
    // Not billed yet — create a single-order invoice on demand, then print.
    let invNumber = "";
    updateDb(d => {
      invNumber = nextInvoiceNumber(d);
      d.invoices.push({ id: uid("inv_"), orderId: order.id, orderIds: [order.id], clientId: order.clientId, number: invNumber, amount, paid, createdAt: new Date().toISOString() });
    });
    printInvoice(order, client, db.settings, invNumber);
  };

  // In-house build → create a Ready Stock item pre-filled from this order. Admin
  // sets the selling price & cost in Ready Stock (cost basis mixes INR labour with
  // material, so it's entered there, not guessed here).
  const addToReadyStock = () => {
    if (order.readyStockCreatedId) { nav("/ready-stock"); return; }
    const itemId = uid("rs_");
    const imgs = [order.cadImage, ...(order.productPhotos || []), ...(order.images || [])].filter(Boolean).slice(0, 3) as string[];
    const diaWt = order.actualDiamondWeight ?? (order.diamondWeight || undefined);
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      if (o.readyStockCreatedId) return;
      if (!d.readyStock) d.readyStock = [];
      d.readyStock.unshift({
        id: itemId,
        name: o.designNumber ? `${o.jewelleryType} #${o.designNumber}` : `${o.jewelleryType} — ${o.orderNumber}`,
        jewelleryType: o.jewelleryType,
        metal: o.metal,
        productKarats: o.productKarats,
        grossWeight: o.actualGrossWeight ?? o.estimatedGrossWeight,
        netWeight: o.actualNetWeight ?? o.estimatedNetWeight,
        diamondWeight: diaWt,
        diamondType: diaWt ? o.diamondType : undefined,
        price: 0, // admin sets the selling price in Ready Stock
        quantity: 1,
        images: imgs,
        sku: o.designNumber || undefined,
        notes: `Built in-house from order ${o.orderNumber}`,
        createdBy: user!.id,
        createdAt: new Date().toISOString(),
      });
      o.readyStockCreatedId = itemId;
      const idx = o.timeline.findIndex(t => t.step === "Ready for Stock");
      if (idx >= 0) { o.timeline[idx].status = "done"; o.timeline[idx].date = new Date().toISOString(); }
      o.status = statusFromTimeline(o.timeline, o.forReadyStock);
    });
    toast.success("Added to Ready Stock — set its selling price & cost there.");
    nav("/ready-stock");
  };

  // ── Gift card redemption (a discount on this order, ≤25% of order value). ──
  const applyGiftRedeem = (cardId: string, amount: number) => {
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.giftCardId = cardId;
      o.giftCardRedeemed = Math.round(amount * 100) / 100;
      // If the discount now makes the order overpaid, return the excess to credit.
      const back = capOrderAdvances(o);
      if (back > 0) { const c = d.clients.find(x => x.id === o.clientId); if (c) c.creditBalance = Math.round(((c.creditBalance || 0) + back) * 100) / 100; }
    });
    toast.success(`Gift card applied — ${fmtMoney(amount)} off this order`);
  };
  const removeGiftRedeem = () => {
    updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.giftCardId = undefined; o.giftCardRedeemed = undefined; });
    toast.success("Gift card removed");
  };

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-5">
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
              <p className="text-sm text-muted-foreground mt-1">{order.forReadyStock ? "🏭 Ready Stock (in-house build)" : client?.companyName}{order.materialSourcing === "readyStock" ? " · 💎 Sold from Ready Stock" : ""} · {order.contactPerson}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={order.status} />
            {order.forReadyStock
              ? (user!.role === "admin" && (
                  order.readyStockCreatedId
                    ? <Button variant="outline" onClick={() => nav("/ready-stock")} className="rounded-xl"><PackageCheck className="h-4 w-4 mr-2" />In Ready Stock ✓</Button>
                    : <Button onClick={addToReadyStock} className="btn-hero rounded-xl"><PackageCheck className="h-4 w-4 mr-2" />Add to Ready Stock</Button>
                ))
              : <Button variant="outline" onClick={handlePrintInvoice} className="rounded-xl"><Printer className="h-4 w-4 mr-2" />Print / Download Bill</Button>}
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

      {/* ── Actual Weights & Final Pricing — removed; these actuals are now
             entered in the Final Approval popup (single window for everything). ── */}
      {(false as boolean) && (
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
                  setActMaking(order.actualMakingCharges != null ? String(order.actualMakingCharges) : "");
                  setShowActualForm(v => !v);
                }}
              >
                <Calculator className="h-3.5 w-3.5" />
                {hasActuals ? "Edit Actual Details" : "Enter Actual Details"}
              </Button>
            )}
          </div>

          {/* Estimated vs actual comparison */}
          {(order.estimatedGrossWeight || order.estimatedNetWeight || order.diamondWeight || order.estimatedMakingCharges != null) && (
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
                {order.estimatedMakingCharges != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Making Charge</p>
                    <p className="font-medium">{fmtMoney(order.estimatedMakingCharges)}</p>
                  </div>
                )}
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
                {order.actualMakingCharges != null && (
                  <div className="p-3 rounded-xl bg-secondary text-sm">
                    <p className="text-xs text-muted-foreground">Making Charge</p>
                    <p className="font-semibold">{fmtMoney(order.actualMakingCharges)}</p>
                    {order.estimatedMakingCharges != null && order.estimatedMakingCharges !== order.actualMakingCharges && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">est. {fmtMoney(order.estimatedMakingCharges)}</p>
                    )}
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
                      <div className="space-y-1.5">
                        <Label className="text-xs">Actual Making Charge ($){order.estimatedMakingCharges != null ? ` · est. ${fmtMoney(order.estimatedMakingCharges)}` : ""}</Label>
                        <Input type="number" step="0.01" min={0} value={actMaking}
                          onChange={e => setActMaking(e.target.value)}
                          className="rounded-xl h-10" placeholder="0" />
                        <p className="text-[11px] text-muted-foreground">What the factory actually charged (internal — not shown to the client)</p>
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
            <div className="flex items-center gap-2 flex-wrap">
              {/* Visible to everyone (incl. client) once a 3D model is on file. */}
              {order.cad3dmUrl && (
                <Button size="sm" onClick={() => setShow360(true)} className="btn-hero rounded-xl gap-2">
                  <Box className="h-4 w-4" /> View 360°
                </Button>
              )}
              {canEditStage() && (
                <>
                  <input
                    ref={cadRef} type="file" accept="image/*" className="hidden"
                    onChange={async e => { const file = e.target.files?.[0]; if (file) await saveCadImage(file); e.target.value = ""; }}
                  />
                  <Button size="sm" variant="outline" onClick={() => cadRef.current?.click()} disabled={cadUploading} className="rounded-xl gap-2">
                    <ImagePlus className="h-4 w-4" />
                    {cadUploading ? "Uploading…" : order.cadImage ? "Replace CAD" : "Upload CAD Image"}
                  </Button>
                  <input
                    ref={model3dmRef} type="file" accept=".3dm" className="hidden"
                    onChange={async e => { const file = e.target.files?.[0]; if (file) await save3dmModel(file); e.target.value = ""; }}
                  />
                  <Button size="sm" variant="outline" onClick={() => model3dmRef.current?.click()} disabled={model3dmUploading} className="rounded-xl gap-2">
                    <Box className="h-4 w-4" />
                    {model3dmUploading ? "Uploading…" : order.cad3dmUrl ? "Replace 3D Model" : "Upload 3D Model (.3dm)"}
                  </Button>
                </>
              )}
            </div>
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

      {/* ── Product Photography Card ── */}
      {showPhotographySection && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-fuchsia-500/10 grid place-items-center">
                <Camera className="h-5 w-5 text-fuchsia-500" />
              </div>
              <div>
                <h3 className="font-display text-lg text-brand-dark">Product Photography</h3>
                <p className="text-xs text-muted-foreground">
                  {hasProductMedia
                    ? `${order.productPhotos?.length ?? 0} photo${(order.productPhotos?.length ?? 0) !== 1 ? "s" : ""}${order.productVideo ? " + 1 video" : ""} · download anytime`
                    : "Upload 4–5 photos and a short video of the finished piece"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {hasProductMedia && (
                <AsyncButton size="sm" variant="outline" onClick={downloadAllMedia} disabled={downloadingAll} className="rounded-xl gap-2">
                  <Download className="h-4 w-4" />
                  {downloadingAll ? "Downloading…" : "Download All"}
                </AsyncButton>
              )}
              {canEditStage() && (
                <>
                  <input
                    ref={productPhotoRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={async e => { if (e.target.files?.length) await addProductPhotos(e.target.files); e.target.value = ""; }}
                  />
                  <Button size="sm" variant="outline" onClick={() => productPhotoRef.current?.click()} disabled={photoUploading} className="rounded-xl gap-2">
                    <Camera className="h-4 w-4" />
                    {photoUploading ? "Uploading…" : "Add Photos"}
                  </Button>
                  <input
                    ref={productVideoRef} type="file" accept="video/*" className="hidden"
                    onChange={async e => { const f = e.target.files?.[0]; if (f) await addProductVideo(f); e.target.value = ""; }}
                  />
                  <Button size="sm" variant="outline" onClick={() => productVideoRef.current?.click()} disabled={videoUploading} className="rounded-xl gap-2">
                    <Video className="h-4 w-4" />
                    {videoUploading ? "Uploading…" : order.productVideo ? "Replace Video" : "Add Video"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Photo grid */}
          {(order.productPhotos?.length ?? 0) > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {order.productPhotos!.map((src, i) => (
                <div key={i} className="relative group aspect-square rounded-xl border border-border bg-secondary/40 overflow-hidden">
                  <img src={src} alt={`Product photo ${i + 1}`} className="h-full w-full object-cover cursor-pointer" onClick={() => setLightboxSrc(src)} />
                  <button
                    type="button" onClick={() => setLightboxSrc(src)}
                    className="absolute top-1.5 right-1.5 h-7 w-7 rounded-lg bg-black/50 text-white grid place-items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    aria-label="Zoom photo">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button" onClick={() => downloadOne(src, `photo-${i + 1}.jpg`)}
                    className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-lg bg-black/50 text-white grid place-items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    aria-label="Download photo">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  {canEditStage() && (
                    <button
                      type="button" onClick={() => removeProductPhoto(src)}
                      className="absolute top-1.5 left-1.5 h-7 w-7 rounded-lg bg-destructive/80 text-white grid place-items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      aria-label="Remove photo">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Video */}
          {order.productVideo && (
            <div className="space-y-2">
              <div className="rounded-xl border border-border bg-black overflow-hidden">
                <video src={order.productVideo} controls playsInline className="w-full max-h-80 mx-auto" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Video className="h-3.5 w-3.5" /> Product video</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadOne(order.productVideo!, "product-video.mp4")} className="rounded-lg gap-1.5 h-8">
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                  {canEditStage() && (
                    <AsyncButton size="sm" variant="outline" onClick={removeProductVideo} className="rounded-lg h-8 w-8 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Remove video">
                      <Trash2 className="h-3.5 w-3.5" />
                    </AsyncButton>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Empty state — staff, nothing uploaded yet */}
          {!hasProductMedia && canEditStage() && (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No product photos yet. Tap <span className="font-medium text-foreground">Add Photos</span> for 4–5 pictures and <span className="font-medium text-foreground">Add Video</span> for a short clip — the client can then view and download them from the Product Photos page under design <span className="font-medium text-foreground">{order.designNumber || order.orderNumber}</span>.
            </div>
          )}
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

        {/* Gift card — apply as a discount (≤25% of order value) */}
        {!order.forReadyStock && orderGrossTotal(order) > 0 && !["Delivered", "Rejected"].includes(order.status) && (() => {
          const cards = activeGiftCardsFor(db, order.clientId);
          const applied = order.giftCardRedeemed || 0;
          if (applied <= 0 && cards.length === 0) return null;
          const card = order.giftCardId ? (db.giftCards ?? []).find(c => c.id === order.giftCardId) : cards[0];
          const maxR = card ? maxGiftRedeem(order, card, db.orders) : 0;
          return (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Gift className="h-4 w-4 text-primary shrink-0" />
                {applied > 0
                  ? <p className="text-sm"><span className="font-semibold text-primary">{fmtMoney(applied)}</span> gift card applied to this order</p>
                  : <p className="text-sm text-muted-foreground">Gift card available — apply up to <span className="font-semibold text-foreground">{fmtMoney(maxR)}</span> (25% of order)</p>}
              </div>
              {applied > 0
                ? <button onClick={removeGiftRedeem} className="text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg px-2.5 py-1 shrink-0">Remove</button>
                : (maxR > 0 && card && <Button size="sm" onClick={() => applyGiftRedeem(card.id, maxR)} className="btn-hero rounded-lg h-8 shrink-0">Apply {fmtMoney(maxR)}</Button>)}
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
                      ? t.step === "Final Approval"
                        ? readiness.ready && <AsyncButton size="sm" variant="outline" onClick={() => openFinalApproval(idx)} className="mt-2 h-7 rounded-lg text-xs">Final Approval — enter actuals</AsyncButton>
                        : t.step === "Dispatch"
                          ? <AsyncButton size="sm" variant="outline" onClick={() => openDispatchModal(idx)} className="mt-2 h-7 rounded-lg text-xs">Mark complete</AsyncButton>
                          : <AsyncButton size="sm" variant="outline" onClick={() => advanceStep(idx)} className="mt-2 h-7 rounded-lg text-xs">Mark complete</AsyncButton>
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
          internal sourcing cost, never shown to the client). Hidden for a
          Ready-Stock sale — the piece already exists, nothing is manufactured. */}
      {user!.role !== "client" && order.materialSourcing !== "readyStock" && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-display text-xl text-brand-dark">Manufacturing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {order.materialSourcing === "stock" ? "Sourcing plan: Use from Stock"
                  : order.materialSourcing === "purchase" ? "Sourcing plan: Buy New for this order"
                  : "No sourcing plan set at order creation"}
              </p>
            </div>
          </div>

          {/* Stage ① — Assign the factory and quote an estimate before the piece is made. */}
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-brand-dark shrink-0">{faDone ? "Manufacturing (actual)" : "① Assign & Estimate"}</span>
                <Select value={order.assignedFactoryId || "__none"} onValueChange={v => assignFactory(v === "__none" ? "" : v)}>
                  <SelectTrigger className="h-8 w-52 rounded-lg text-xs"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not assigned</SelectItem>
                    {db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {canEditStage() && (faDone ? (
                <Button size="sm" variant="outline" onClick={() => openFinalApproval(faStepIdx)} className="rounded-lg h-8 gap-1.5 text-xs">Edit actual details</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => (showEstimate ? setShowEstimate(false) : openEstimate())} className="rounded-lg h-8 gap-1.5 text-xs">
                  {showEstimate ? "Close" : (order.estimatedMakingCharges != null || order.estimatedGrossWeight != null ? "Edit Estimate" : "Add Estimate")}
                </Button>
              ))}
            </div>

            {/* Reserved gold sitting at the assigned factory (gold is held there, not bought per order) */}
            {order.assignedFactoryId && (
              <div className="flex items-center gap-1.5 text-xs">
                <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span className="text-muted-foreground">Reserved gold at this factory:</span>
                <span className="font-semibold text-amber-700">{factoryFineGoldBalance(db.materialIssuances, order.assignedFactoryId).toLocaleString()} g fine (24KT)</span>
              </div>
            )}

            {/* After Final Approval: what was ACTUALLY used + the factory (editable). Before: the estimate. */}
            {!showEstimate && (faDone ? (() => {
              const finish = finishRecord();
              const dias = db.materialIssuances.filter(i => i.orderId === order.id && i.material === "diamond");
              return (
                <div className="space-y-1 text-xs">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
                    <span>Gold used: <span className="font-semibold text-foreground">{finish?.finishedNetWeight != null ? `${finish.finishedNetWeight} g ${finish.finishedPurity != null ? `@ ${finish.finishedPurity}‰` : (finish.finishedKarat || "")} · ${finish.finishedPurity != null ? pureFromPurity(finish.finishedNetWeight, finish.finishedPurity) : toPureGold(finish.finishedNetWeight, finish.finishedKarat || "24K")}g fine` : "—"}</span></span>
                    <span>Labour: <span className="font-semibold text-foreground">{finish?.makingCharges?.amountInr ? fmtMoneyInr(finish.makingCharges.amountInr) : "—"}</span></span>
                  </div>
                  {dias.map(i => {
                    const packs = i.diamondKind === "certified" ? (db.diamondPackets ?? []).filter(p => i.diamondPacketIds?.includes(p.id)) : [];
                    const lbl = i.diamondKind === "certified" ? (packs.map(p => `${p.shape} ${p.carat}ct`).join(", ") || "certified") : `${i.purityOrQuality} ${i.quantityIssued}ct`;
                    if (i.diamondKind !== "certified" && (i.finishReturnedCt ?? 0) > 0) {
                      const used = Math.round((i.quantityIssued - (i.finishReturnedCt ?? 0)) * 1000) / 1000;
                      return <div key={i.id} className="text-muted-foreground">Diamond: <span className="font-semibold text-foreground">{lbl}</span> — <span className="text-success font-medium">{used} ct used</span>, <span className="text-amber-600 font-medium">{i.finishReturnedCt} ct returned</span></div>;
                    }
                    return <div key={i.id} className="text-muted-foreground">Diamond: <span className="font-semibold text-foreground">{lbl}</span> — <span className={i.finishDisposition === "returned" ? "text-amber-600 font-medium" : "text-success font-medium"}>{i.finishDisposition === "returned" ? "returned to stock" : "used in piece"}</span></div>;
                  })}
                </div>
              );
            })() : (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Est. gold: <span className="font-semibold text-foreground">{order.estimatedGrossWeight ?? order.metalWeight ?? "—"}{(order.estimatedGrossWeight ?? order.metalWeight) != null ? " g" : ""}</span></span>
                <span>Est. diamond: <span className="font-semibold text-foreground">{order.diamondWeight ? `${order.diamondWeight} ct` : "—"}</span></span>
                <span>Est. making: <span className="font-semibold text-foreground">{order.estimatedMakingCharges != null ? fmtMoney(order.estimatedMakingCharges) : "—"}</span></span>
              </div>
            ))}

            {/* Estimate editor */}
            {showEstimate && !faDone && (
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

            {/* ② Diamond — from our stock, or buy new. (Gold stays reserved at the factory.) */}
            {canEditStage() && !faDone && orderMaterialRequirements(order).needsDiamond && (
              <div className="pt-3 border-t border-border/50 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-brand-dark">② Diamond</span>
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-secondary">
                  {(["stock", "buy"] as const).map(s => (
                    <button key={s} type="button"
                      onClick={() => {
                        if (!order.assignedFactoryId) { toast.error("Choose the factory first"); return; }
                        setDiaSource(s); setShowDiamond(true);
                        if (s === "stock") { setShowIssueForm(true); setShowBuyForm(false); setIssueMaterial("diamond"); setIssueFactoryId(order.assignedFactoryId); }
                        else { setShowBuyForm(true); setShowIssueForm(false); setBuyLines(ls => ls.map(l => ({ ...l, material: "diamond" }))); }
                      }}
                      className={`h-7 px-3 rounded-md text-xs font-medium transition-colors ${showDiamond && diaSource === s ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
                      {s === "stock" ? "From Stock" : "Buy New"}
                    </button>
                  ))}
                </div>
                {showDiamond && (
                  <button type="button" onClick={() => { setShowDiamond(false); setShowIssueForm(false); setShowBuyForm(false); }} className="text-xs text-muted-foreground underline">cancel</button>
                )}
              </div>
            )}
          </div>

          <div className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium ${readiness.ready ? "bg-success/8 text-success" : "bg-destructive/5 text-destructive"}`}>
            {readiness.ready ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {readiness.ready
              ? "Ready for Final Approval — factory assigned and diamond sourced"
              : `Final Approval blocked — ${readiness.missing.includes("gold") && !order.assignedFactoryId ? "assign a factory" : ""}${readiness.missing.includes("gold") && !order.assignedFactoryId && readiness.missing.includes("diamond") ? " and " : ""}${readiness.missing.includes("diamond") ? "add the diamond (from stock or buy)" : ""} first`}
          </div>

          {showBuyForm && (
            <div className="pt-2 border-t border-border/60 space-y-3">
              <p className="text-sm font-medium text-brand-dark">Buy for {order.orderNumber}</p>
              <p className="text-xs text-muted-foreground -mt-1">Goes straight to {db.factories.find(f => f.id === order.assignedFactoryId)?.name || "the assigned factory"} and is billed to the supplier.</p>
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
                  <p className="text-xs font-medium text-muted-foreground">Diamond {idx + 1}</p>
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
                    <div className="space-y-2.5">
                      {/* Loose vs Certified */}
                      <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl">
                        {(["loose", "certified"] as const).map(k => (
                          <button key={k} type="button" onClick={() => updateBuyLine(idx, { diaKind: k })}
                            className={`h-8 rounded-lg text-xs font-medium transition-colors ${line.diaKind === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
                            {k === "loose" ? "Loose" : "Certified"}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        <Select value={line.diaShape} onValueChange={v => updateBuyLine(idx, { diaShape: v })}>
                          <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Shape" /></SelectTrigger>
                          <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input type="number" min={0} step="0.01" value={line.diaCarat} onChange={e => updateBuyLine(idx, { diaCarat: e.target.value })} className="rounded-xl h-10" placeholder={line.diaKind === "certified" ? "Size (ct)" : "Carat"} />
                        <Input type="number" min={0} value={line.diaRate} onChange={e => updateBuyLine(idx, { diaRate: e.target.value })} className="rounded-xl h-10" placeholder={`Rate/ct (${line.currency})`} />
                      </div>
                      {line.diaKind === "loose" ? (
                        <Input value={line.diaQuality} onChange={e => updateBuyLine(idx, { diaQuality: e.target.value })} className="rounded-xl h-10" placeholder="Quality (optional)" />
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          <Input value={line.diaColor} onChange={e => updateBuyLine(idx, { diaColor: e.target.value })} className="rounded-xl h-10" placeholder="Color" />
                          <Input value={line.diaClarity} onChange={e => updateBuyLine(idx, { diaClarity: e.target.value })} className="rounded-xl h-10" placeholder="Clarity" />
                          <Input value={line.diaCut} onChange={e => updateBuyLine(idx, { diaCut: e.target.value })} className="rounded-xl h-10" placeholder="Cut" />
                          <Input value={line.diaPolish} onChange={e => updateBuyLine(idx, { diaPolish: e.target.value })} className="rounded-xl h-10" placeholder="Polish" />
                          <Input value={line.diaSym} onChange={e => updateBuyLine(idx, { diaSym: e.target.value })} className="rounded-xl h-10" placeholder="Symmetry" />
                          <Input value={line.diaFluor} onChange={e => updateBuyLine(idx, { diaFluor: e.target.value })} className="rounded-xl h-10" placeholder="Fluorescence" />
                          <Input value={line.diaMeasure} onChange={e => updateBuyLine(idx, { diaMeasure: e.target.value })} className="rounded-xl h-10 sm:col-span-2" placeholder="Measurement (e.g. 6.5×6.5×4.0 mm)" />
                          <Input value={line.diaLab} onChange={e => updateBuyLine(idx, { diaLab: e.target.value })} className="rounded-xl h-10" placeholder="Lab (GIA/IGI)" />
                          <Input value={line.diaCertNo} onChange={e => updateBuyLine(idx, { diaCertNo: e.target.value })} className="rounded-xl h-10 sm:col-span-3" placeholder="Report number *" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <Select value={line.currency} onValueChange={v => updateBuyLine(idx, { currency: v as PurchaseCurrency })}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
                    </Select>
                    {line.currency === "USD" && (
                      <>
                        <div className="rounded-xl h-10 px-3 flex items-center bg-secondary/60 text-sm text-muted-foreground">
                          Total: <span className="font-semibold text-foreground ml-1">${buyLineBaseAmount(line).toFixed(2)}</span>
                        </div>
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
              <p className="text-sm font-medium text-brand-dark">Diamond from stock → {db.factories.find(f => f.id === order.assignedFactoryId)?.name || "factory"}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={issueDiaKind} onValueChange={v => setIssueDiaKind(v as "loose" | "certified")}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loose">Loose (by shape)</SelectItem>
                    <SelectItem value="certified" disabled={inStockPackets.length === 0}>
                      Certified packet{inStockPackets.length === 0 ? " (none in stock)" : ""}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {issueDiaKind === "loose" && (
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
                <div className="space-y-1.5">
                  {inStockPackets.length > 3 && (
                    <Input
                      value={issueCertSearch} onChange={e => setIssueCertSearch(e.target.value)}
                      className="rounded-xl h-9 text-sm" placeholder="Search stock #, shape, or certificate…"
                    />
                  )}
                  <div className="rounded-xl border border-border/60 p-2 max-h-52 overflow-y-auto space-y-1">
                    {inStockPackets.length === 0 && <p className="text-xs text-muted-foreground p-2">No certified diamonds in stock.</p>}
                    {inStockPackets
                      .filter(p => {
                        const q = issueCertSearch.trim().toLowerCase();
                        if (!q) return true;
                        return [p.stockNumber, p.shape, p.certificateNumber].some(v => v?.toLowerCase().includes(q));
                      })
                      .map(p => {
                        const checked = issueCertPacketIds.includes(p.id);
                        return (
                          <label key={p.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer ${checked ? "bg-primary/10" : "hover:bg-secondary"}`}>
                            <input type="checkbox" checked={checked}
                              onChange={e => setIssueCertPacketIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id))} />
                            <span className="text-sm flex-1 min-w-0 truncate">
                              {p.stockNumber && <span className="font-mono text-xs font-semibold text-primary mr-1.5">{p.stockNumber}</span>}
                              {p.shape} · {p.carat}ct · Cert {p.certificateNumber}{p.certificateLab ? ` (${p.certificateLab})` : ""}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                  {issueCertPacketIds.length > 0 && (
                    <p className="text-xs text-muted-foreground px-2">
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
              {/* Only purchases NOT already shown as an issuance below — avoids the
                  same bought diamond appearing twice (once as a purchase, once as
                  the auto-created issuance). The purchase's cost/₹-due is folded
                  onto its issuance row instead. */}
              {linkedPurchases.filter(p => !linkedIssuances.some(i => i.sourcePurchaseId === p.id)).map(p => {
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
                const srcPurchase = mi.source === "purchase" && mi.sourcePurchaseId ? linkedPurchases.find(p => p.id === mi.sourcePurchaseId) : undefined;
                const srcSupplier = srcPurchase ? db.suppliers.find(s => s.id === srcPurchase.supplierId) : undefined;
                const srcInfo = srcPurchase ? ` · bought from ${srcSupplier?.name || "supplier"}` : mi.source === "stock" ? " · from stock" : "";
                const label = (mi.diamondKind === "certified"
                  ? `${certPackets.length} certified diamond${certPackets.length !== 1 ? "s" : ""} (${mi.quantityIssued}ct) — ${certPackets.map(p => `${p.shape} ${p.carat}ct, Cert ${p.certificateNumber}`).join("; ")}`
                  : `${mi.material === "gold" ? "Gold" : "Diamond"} — ${mi.purityOrQuality}, ${used}${unit} used${Math.abs(used - mi.quantityIssued) > 0.001 ? ` (${mi.quantityIssued}${unit} issued)` : ""}`) + srcInfo;
                const srcCost = srcPurchase ? purchasePending(srcPurchase) : 0;
                const isGold = mi.material === "gold";
                const liveLabour = labourValue({
                  perGramRate: rcvPerGram ? Number(rcvPerGram) : undefined,
                  diamondHandlingRate: rcvDiaHandling ? Number(rcvDiaHandling) : undefined,
                  cadCharge: rcvCad ? Number(rcvCad) : undefined,
                  otherCharges: rcvOther ? Number(rcvOther) : undefined,
                  metalByFactoryGrams: rcvMetalG ? Number(rcvMetalG) : undefined,
                  metalByFactoryRate: rcvMetalRate ? Number(rcvMetalRate) : undefined,
                }, Number(rcvNetW) || 0, order.actualDiamondWeight || order.diamondWeight || 0);
                return (
                  <div key={mi.id} className="rounded-xl bg-secondary text-sm">
                    <div className="flex items-center justify-between gap-2 p-2.5">
                      <Link to={`/factories/${mi.factoryId}`} className="flex items-center gap-2 min-w-0 hover:underline">
                        {isGold ? <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0" /> : <Gem className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                        <span className="truncate" title={label}>{label} · {factory?.name || "factory"}</span>
                      </Link>
                      <span className="flex items-center gap-2 shrink-0">
                        {srcCost > 0 && <span className="text-xs text-destructive font-medium">{fmtMoneyInr(srcCost)} to supplier</span>}
                        <span className={`font-medium ${mi.status === "open" ? "text-primary" : "text-success"}`}>{mi.status === "open" ? "In progress" : "Closed"}{pending > 0 ? ` · ${fmtMoneyInr(pending)} due` : ""}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rework / Alteration — a delivered piece came back for changes */}
          {canEditStage() && (
            <div className="pt-3 border-t border-border/60">
              {!showRework ? (
                <button onClick={() => { setRwFactoryId(order.assignedFactoryId || ""); setShowRework(true); }}
                  className="text-xs font-medium text-primary inline-flex items-center gap-1.5 hover:underline">
                  <RotateCcw className="h-3.5 w-3.5" /> Rework / Alteration — piece came back for changes
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-brand-dark">Rework / Alteration</p>
                    <button onClick={() => setShowRework(false)} className="text-xs text-muted-foreground underline">cancel</button>
                  </div>
                  <p className="text-xs text-muted-foreground">Add or remove gold/diamond and record the factory's rework charge. Added material is drawn from stock; removed material returns to stock — factory ledger &amp; stock update automatically.</p>
                  <div>
                    <Label className="text-xs">Factory</Label>
                    <Select value={rwFactoryId || order.assignedFactoryId || ""} onValueChange={setRwFactoryId}>
                      <SelectTrigger className="rounded-xl mt-1 h-10"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                      <SelectContent>{db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-xl bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-amber-600" /><span className="text-xs font-semibold">Gold</span>
                      <div className="ml-auto inline-flex rounded-lg bg-white border border-border p-0.5">
                        {(["none", "add", "remove"] as const).map(dir => (
                          <button key={dir} onClick={() => setRwGoldDir(dir)} className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${rwGoldDir === dir ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{dir === "none" ? "No change" : dir === "add" ? "Add" : "Remove"}</button>
                        ))}
                      </div>
                    </div>
                    {rwGoldDir !== "none" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs">Grams to {rwGoldDir}</Label><Input type="number" step="0.001" min={0} value={rwGoldG} onChange={e => setRwGoldG(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="e.g. 1.5" /></div>
                        <div><Label className="text-xs">Karat</Label><Select value={rwGoldKarat} onValueChange={setRwGoldKarat}><SelectTrigger className="rounded-xl mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Gem className="h-4 w-4 text-blue-500" /><span className="text-xs font-semibold">Diamond</span>
                      <div className="ml-auto inline-flex rounded-lg bg-white border border-border p-0.5">
                        {(["none", "add", "remove"] as const).map(dir => (
                          <button key={dir} onClick={() => setRwDiaDir(dir)} className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${rwDiaDir === dir ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{dir === "none" ? "No change" : dir === "add" ? "Add" : "Remove"}</button>
                        ))}
                      </div>
                    </div>
                    {rwDiaDir !== "none" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs">Carats to {rwDiaDir}</Label><Input type="number" step="0.001" min={0} value={rwDiaCt} onChange={e => setRwDiaCt(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="e.g. 0.5" /></div>
                        <div><Label className="text-xs">Shape</Label><Select value={rwDiaShape} onValueChange={setRwDiaShape}><SelectTrigger className="rounded-xl mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Rework charge (₹)</Label><Input type="number" min={0} value={rwCharge} onChange={e => setRwCharge(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="factory labour" /></div>
                    <div><Label className="text-xs">Note (optional)</Label><Input value={rwNote} onChange={e => setRwNote(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="e.g. resize, add stone" /></div>
                  </div>
                  <AsyncButton onClick={recordRework} disabled={rwSaving} className="btn-hero rounded-xl w-full h-10">{rwSaving ? "Saving…" : "Record rework"}</AsyncButton>
                </div>
              )}
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

      {/* ── Dispatch Details popup (from the timeline "Mark complete") ── */}
      {dispatchModalIdx !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !dispatchSaving && setDispatchModalIdx(null)}>
          <div className="card-luxe w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-lg text-brand-dark mb-1">Dispatch Details — {order.orderNumber}</h3>
            <p className="text-xs text-muted-foreground mb-4">Enter the courier details. On confirm, the order is marked dispatched and the client is emailed automatically.</p>
            <div className="space-y-3">
              <div><Label className="text-xs">Courier Company *</Label><Input value={courierName} onChange={e => setCourierName(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. FedEx, DHL" /></div>
              <div><Label className="text-xs">Tracking Number *</Label><Input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. 1234567890" /></div>
              <div><Label className="text-xs">Tracking Link (optional)</Label><Input value={trackingLink} onChange={e => setTrackingLink(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="https://..." /></div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setDispatchModalIdx(null)} disabled={dispatchSaving} className="flex-1 rounded-xl border border-border py-2 text-sm disabled:opacity-50">Cancel</button>
              <AsyncButton onClick={confirmDispatch} disabled={dispatchSaving} className="btn-hero flex-1 rounded-xl py-2 text-sm">{dispatchSaving ? "Sending…" : "Confirm Dispatch & Notify"}</AsyncButton>
            </div>
          </div>
        </div>
      )}

      {/* ── 360° 3D model viewer (Starlink360 embed) — responsive, full-screen ── */}
      {show360 && viewer360Url && (
        <div className="fixed inset-0 z-50 bg-black/70 flex flex-col p-2 sm:p-4" onClick={() => setShow360(false)}>
          <div className="flex items-center justify-between px-2 pb-2 shrink-0">
            <p className="text-white text-sm font-medium">360° View — {order.orderNumber}</p>
            <button onClick={() => setShow360(false)} className="h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 text-white grid place-items-center" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 rounded-2xl overflow-hidden bg-white" onClick={e => e.stopPropagation()}>
            <iframe
              src={viewer360Url}
              title="360° 3D model"
              className="w-full h-full border-0"
              allow="fullscreen"
            />
          </div>
        </div>
      )}

      {/* ── Final Approval popup — one window for all the actual details ── */}
      {faIdx !== null && (() => {
        const needsGold = orderMaterialRequirements(order).needsGold;
        // All of the order's diamonds (open on first approval, closed on a re-edit) so they stay editable.
        const faOpenDia = db.materialIssuances.filter(i => i.orderId === order.id && i.material === "diamond");
        const usedDiaCt = faOpenDia.reduce((s, i) => {
          if (i.diamondKind === "certified") return s + ((faDia[i.id] ?? "used") === "used" ? i.quantityIssued : 0);
          const ret = Math.min(Math.max(Number(faDiaReturnedCt[i.id]) || 0, 0), i.quantityIssued);
          return s + (i.quantityIssued - ret);
        }, 0);
        const faLive = labourValue({
          perGramRate: faPerGram ? Number(faPerGram) : undefined,
          diamondHandlingRate: faDiaHandling ? Number(faDiaHandling) : undefined,
          cadCharge: faCad ? Number(faCad) : undefined,
          otherCharges: faOther ? Number(faOther) : undefined,
          metalByFactoryGrams: faMetalG ? Number(faMetalG) : undefined,
          metalByFactoryRate: faMetalRate ? Number(faMetalRate) : undefined,
        }, needsGold ? (Number(faGoldNet) || 0) : 0, usedDiaCt);
        const faFactory = db.factories.find(f => f.id === order.assignedFactoryId);
        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !faSaving && setFaIdx(null)}>
            <div className="card-luxe w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="font-display text-lg text-brand-dark mb-1">Final Approval — {order.orderNumber}</h3>
              <p className="text-xs text-muted-foreground mb-4">Enter the real details now: gold used, each diamond used or returned, the labour, and the final order value.</p>

              {needsGold && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Gold used</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div><Label className="text-[11px]">Net Weight (g)</Label><Input type="number" min={0} step="0.001" value={faGoldNet} onChange={e => setFaGoldNet(e.target.value)} className="rounded-lg h-9 mt-1" /></div>
                    <div><Label className="text-[11px]">Purity (‰ — e.g. 750, 595)</Label><Input type="number" min={0} step="0.1" value={faGoldPurity} onChange={e => setFaGoldPurity(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="actual purity from factory" /></div>
                  </div>
                  {Number(faGoldNet) > 0 && Number(faGoldPurity) > 0 && <p className="text-[11px] text-muted-foreground mt-1">= {pureFromPurity(Number(faGoldNet), Number(faGoldPurity))}g fine (24KT) deducted from {faFactory?.name || "the factory"}</p>}
                </div>
              )}

              {faOpenDia.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Diamonds — used or returned?</p>
                  <div className="space-y-1.5">
                    {faOpenDia.map(i => {
                      const isCert = i.diamondKind === "certified";
                      const packs = isCert ? (db.diamondPackets ?? []).filter(p => i.diamondPacketIds?.includes(p.id)) : [];
                      const lbl = isCert
                        ? `${packs.map(p => `${p.shape} ${p.carat}ct Cert ${p.certificateNumber}`).join("; ") || "certified"}`
                        : `${i.purityOrQuality} · ${i.quantityIssued}ct issued`;
                      if (isCert) {
                        // A single certified stone can't be split — whole used or returned.
                        return (
                          <div key={i.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-secondary text-sm">
                            <span className="truncate min-w-0" title={lbl}>{lbl}</span>
                            <div className="inline-flex gap-0.5 p-0.5 rounded-md bg-white shrink-0">
                              {(["used", "returned"] as const).map(dd => (
                                <button key={dd} onClick={() => setFaDia(m => ({ ...m, [i.id]: dd }))}
                                  className={`h-7 px-2.5 rounded text-xs font-medium ${(faDia[i.id] ?? "used") === dd ? (dd === "used" ? "bg-primary text-white" : "bg-amber-500 text-white") : "text-muted-foreground"}`}>
                                  {dd === "used" ? "Used" : "Returned"}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      // Loose — enter the carats RETURNED (0 = all used). Used = issued − returned.
                      const retStr = faDiaReturnedCt[i.id] ?? "0";
                      const ret = Math.min(Math.max(Number(retStr) || 0, 0), i.quantityIssued);
                      const usedCt = Math.round((i.quantityIssued - ret) * 1000) / 1000;
                      return (
                        <div key={i.id} className="p-2 rounded-lg bg-secondary text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate min-w-0" title={lbl}>{lbl}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-muted-foreground">Returned (ct)</span>
                              <Input type="number" min={0} max={i.quantityIssued} step="0.001" value={retStr}
                                onChange={e => setFaDiaReturnedCt(m => ({ ...m, [i.id]: e.target.value }))}
                                className="h-8 w-24 rounded-lg" />
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">Used <span className="font-medium text-foreground">{usedCt} ct</span>{ret > 0 ? <> · Returned <span className="font-medium text-amber-600">{ret} ct</span> → stock</> : null}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">For a loose diamond, enter how many carats came back (e.g. issued 1ct, 0.50ct returned). Returned carats go back to stock; the rest is used in the piece.</p>
                </div>
              )}

              {/* Auto totals — diamond used (ct → g) and gross = gold net + diamond */}
              {(() => {
                const diaG = Math.round(usedDiaCt * CARAT_TO_GRAM * 1000) / 1000;
                const netG = needsGold ? (Number(faGoldNet) || 0) : 0;
                const gross = Math.round((netG + diaG) * 1000) / 1000;
                return (
                  <div className="mb-4 rounded-lg bg-secondary/60 p-3 text-xs space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total diamond used</span><span className="font-semibold text-foreground">{usedDiaCt} ct ({diaG} g)</span></div>
                    {needsGold && <div className="flex justify-between"><span className="text-muted-foreground">Gold net weight</span><span className="font-semibold text-foreground">{netG} g</span></div>}
                    <div className="flex justify-between border-t border-border/50 pt-1"><span className="font-medium text-brand-dark">Gross weight (gold + diamond)</span><span className="font-bold text-brand-dark">{gross} g</span></div>
                  </div>
                );
              })()}

              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Labour (factory payable, ₹)</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><Label className="text-[11px]">Labour / gram</Label><Input type="number" min={0} step="0.01" value={faPerGram} onChange={e => setFaPerGram(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ /g" /></div>
                  <div><Label className="text-[11px]">CAD charge</Label><Input type="number" min={0} step="0.01" value={faCad} onChange={e => setFaCad(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹" /></div>
                  <div><Label className="text-[11px]">Diamond handling / ct</Label><Input type="number" min={0} step="0.01" value={faDiaHandling} onChange={e => setFaDiaHandling(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ /ct" /></div>
                  <div><Label className="text-[11px]">Other charges</Label><Input type="number" min={0} step="0.01" value={faOther} onChange={e => setFaOther(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹" /></div>
                  <div><Label className="text-[11px]">Metal by factory (g)</Label><Input type="number" min={0} step="0.001" value={faMetalG} onChange={e => setFaMetalG(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="g" /></div>
                  <div><Label className="text-[11px]">Metal rate ₹ / g</Label><Input type="number" min={0} step="0.01" value={faMetalRate} onChange={e => setFaMetalRate(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ /g" /></div>
                </div>
                <p className="text-sm mt-2">Labour total: <span className="font-semibold text-brand-dark">{fmtMoneyInr(faLive)}</span></p>
              </div>

              <div className="mb-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Client billing ($)</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><Label className="text-[11px]">Final Order Value ($)</Label><Input type="number" min={0} step="0.01" value={faOrderValue} onChange={e => setFaOrderValue(e.target.value)} className="rounded-lg h-9 mt-1" /></div>
                  <div><Label className="text-[11px]">Shipping ($)</Label><Input type="number" min={0} step="0.01" value={faShipping} onChange={e => setFaShipping(e.target.value)} className="rounded-lg h-9 mt-1" /></div>
                </div>
                <p className="text-sm mt-2">Total to client: <span className="font-semibold text-brand-dark">{fmtMoney((Number(faOrderValue) || 0) + (Number(faShipping) || 0))}</span></p>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setFaIdx(null)} disabled={faSaving} className="flex-1 rounded-xl border border-border py-2 text-sm disabled:opacity-50">Cancel</button>
                <AsyncButton onClick={saveFinalApproval} disabled={faSaving} className="btn-hero flex-1 rounded-xl py-2 text-sm">{faSaving ? "Saving…" : "Save & Approve"}</AsyncButton>
              </div>
            </div>
          </div>
        );
      })()}
    </AnimatePresence>
    </>
  );
}
