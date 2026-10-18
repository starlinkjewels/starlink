
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { SectionTitle } from "@/components/SectionTitle";
import { WeightCheck } from "@/components/WeightCheck";
import { weightProblem, pieceWeights } from "@/lib/weights";
import { useCan, useMayExport } from "@/hooks/useCan";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { OrderEditDialog } from "@/components/OrderEditDialog";
import { OrderPaymentEditDialog } from "@/components/OrderPaymentEditDialog";
import { cancelAccess, cancelBlocker, orderEditAccess, orderSpecLocks } from "@/lib/orderGuards";
import { cancelOrder as cancelOrderNow, cancelQuestion, cancelRefusal, returnIssuedMaterials as returnIssuedFor } from "@/lib/orderCancel";
import { orderPaymentEditBlocker, paymentReceipt } from "@/lib/orderPaymentEdit";
import { meltPlan } from "@/lib/melt";
import { needsAccess } from "@/lib/actionHints";
import { readyStockOffices, officeLabel, officeOf } from "@/lib/offices";
import { logItem, whoOf } from "@/lib/readyStockHistory";
import { exportAllowed } from "@/lib/access";
import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { OrderProfitCard } from "@/components/OrderProfitCard";
import { ShippingCostFields } from "@/components/BulkDispatchDialog";
import { recordShippingCost, EMPTY_SHIPPING_COST, type ShippingCost } from "@/lib/dispatch";
import { collectionLoaded,
  loadDb, updateDb, fmtMoney, fmtDate, totalAdvance, orderTotal, orderGrossTotal, balanceDue, returnedCredit, uid, capOrderAdvances, DIAMOND_SHAPES, toPureGold, pureFromPurity, CARAT_TO_GRAM, KARAT_PURITY, FACTORY_PURITY, nextDiamondStockNumber, findInvoiceForOrder, invoiceOrderIds, activeGiftCardsFor, maxGiftRedeem, giftMaxRedeemPctFor, cashbackPercentFor, issueGiftCard,
  type Order, type Purchase, type PurchaseMaterial, type PurchaseCurrency, type MaterialIssuance,
  mainDiamondShape,
  isDiamondOnlyOrder, isProductionStep, statusFromTimeline, todayLocal, stampFor, dayOf, logEvent, worksOnOrder, orderImage,
} from "@/lib/db";
import { AssignOrderField } from "@/components/AssignOrder";
import { InvoiceBadge, needsInvoice } from "@/components/InvoiceBadge";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl, uploadFile, deleteByUrl } from "@/lib/storage";
import { sendMail, orderApprovedEmail, orderDispatchedEmail } from "@/lib/email";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Package, Printer,
  DollarSign, Plus, TrendingUp, AlertCircle, Wallet,
  ImagePlus, Truck, ExternalLink, Eye, Scale, Calculator, Minimize2, Maximize2, RotateCcw,
  Factory as FactoryIcon, Coins, Gem, X, Box, Camera, Video, Download, Trash2, Pencil, PackageCheck, Gift, Tag, Flame,
  CalendarClock, CalendarDays, Hash, UserRound,
  Undo2, XCircle, type LucideIcon,
} from "lucide-react";
import { MeltDialog } from "@/components/MeltDialog";
import { OtherMaterialSelect, GradeInput, useOtherMaterials } from "@/components/MaterialFields";
import { coField, companyOf, companyOfOrder, workCompanyOf, companyById, hasCompanies } from "@/lib/companies";
import { CompanyBadge } from "@/components/CompanyFields";
import { isOtherMaterial, materialName, materialUnit, fmtQty, purchaseQty, purchaseText, type MaterialKey } from "@/lib/materials";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { printInvoice, printBatchInvoice } from "@/lib/invoicePrint";
import { generateBand, labelPresets } from "@/lib/band";
import { BandDialog } from "@/components/BandDialog";
import { AsyncButton } from "@/components/AsyncButton";
import {
  fmtMoneyInr, purchasePending, issuancePending, manufacturingReadiness,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements, issuanceUsed, labourValue, minimumLabourApplies, factoryFineGoldBalance,
  applyDiscountPct, discountLabel,
  deriveStockBalances,
} from "@/lib/manufacturing";
import { decreaseStockSelfHealing, increaseStock, logOrderDirectPurchase } from "@/lib/stock";
import { canVoidPurchase, voidPurchase as voidPurchaseCascade, purchaseLabel, voidImpact, canEditPurchase, purchaseEditScope, editPurchase, type PurchaseEdit } from "@/lib/purchaseVoid";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import { canEditIssuance, editIssuance, deleteIssuance, issuanceVoidImpact, isStockIssuance } from "@/lib/issuanceEdit";
import { receiptForAdvance, deleteReceipt, deleteImpact, receiptCancelBlocker } from "@/lib/receipts";
import { ccy, ccySymbol, fmtCcy, rateText, roundCcy, tableRate } from "@/lib/currency";
import { compressImage as compressImg, canUploadOriginal, PRODUCT_PHOTO_MAX, PRODUCT_PHOTO_QUALITY } from "@/lib/images";
import { downloadAsZip } from "@/lib/zipDownload";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";
import { ReturnDialog, OrderReturns, useMayReturn } from "@/components/SalesReturn";
import { returnBlocker } from "@/lib/salesReturn";

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
  diaPcs: string;
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
  /** Supplier discount on this line, in % off the weight x rate amount. */
  discountPct: string;
  currency: PurchaseCurrency;
  exchangeRate: string;
  invoiceNumber: string;
  notes: string;
}

/** One supplier's bill in the order's Buy form. */
interface BuyBill {
  key: string;
  supplierId: string;
  /** The supplier's bill number. One per bill, not per line, and required — it
   *  is how the purchase book is checked against what is in the software. */
  billNo: string;
  lines: BuyLine[];
  /** The odd rupees nobody hands over: one figure for the whole bill, riding on
   *  its first line so the supplier's due matches the cash actually paid. */
  roundOff: string;
}

let billSeq = 0;
function emptyBuyBill(): BuyBill {
  return { key: `bill_${++billSeq}`, supplierId: "", billNo: "", lines: [emptyBuyLine()], roundOff: "" };
}

const billLinesTotalInr = (b: BuyBill) => b.lines.reduce((s, l) => s + buyLineTotalInr(l), 0);
const billRoundOffInr = (b: BuyBill) => Math.round(Number(b.roundOff) || 0);
const billTotalInr = (b: BuyBill) => billLinesTotalInr(b) + billRoundOffInr(b);

function emptyBuyLine(): BuyLine {
  return {
    material: "diamond", goldWeight: "", goldPurity: "22K", goldRate: "",
    diaCarat: "", diaPcs: "", diaQuality: "", diaRate: "",
    diaKind: "loose", diaShape: "Round", diaCertNo: "", diaLab: "",
    diaColor: "", diaClarity: "", diaCut: "", diaPolish: "", diaSym: "", diaFluor: "", diaMeasure: "",
    discountPct: "", currency: "INR", exchangeRate: "",
    invoiceNumber: "", notes: "",
  };
}

/** Weight × rate less the supplier discount, in the line’s own billing
 *  currency — always the source of truth for the amount (never manually typed). */
function buyLineBaseAmount(line: BuyLine): number {
  const gross = line.material === "gold"
    ? (Number(line.goldWeight) || 0) * (Number(line.goldRate) || 0)
    : (Number(line.diaCarat) || 0) * (Number(line.diaRate) || 0);
  // A supplier discount ("less 5%") comes off the line before anything else —
  // the stock value, the supplier bill and the order cost all use this figure.
  return applyDiscountPct(gross, line.discountPct);
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

/**
 * The page waits for its record before drawing anything that holds state. The
 * data behind the first screen arrives a moment after the page opens, and a
 * page that returned early on its first draw and then ran all its hooks on the
 * next crashed (React #310) whenever it was opened or refreshed directly.
 */
/** One fact about the piece, as a tile; nothing at all when there is no value. */
function OrderSpec({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  if (value == null || value === "") return null;
  return (
    <div className={`rounded-xl bg-secondary/40 px-3 py-2 min-w-0 ${wide ? "col-span-2" : ""}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-brand-dark mt-0.5 break-words">{value}</p>
    </div>
  );
}

/**
 * A small icon action on a manufacturing row. When it can't be used it stays
 * in place, greyed, with the reason as its tooltip — and a tap says it, since
 * a phone has no tooltips.
 */
function RowAction({ icon: Icon, label, why, onRun, danger, busy }: {
  icon: LucideIcon; label: string; why?: string; onRun: () => unknown; danger?: boolean; busy?: boolean;
}) {
  return (
    <button type="button" disabled={busy} title={why ?? label} aria-label={label} aria-disabled={!!why}
      onClick={e => { e.preventDefault(); e.stopPropagation(); if (why) toast.error(why); else void onRun(); }}
      className={`h-7 w-7 rounded-lg grid place-items-center shrink-0 disabled:opacity-50 ${why ? "opacity-40 cursor-not-allowed text-muted-foreground" : danger ? "text-destructive hover:bg-destructive/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}>
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const db = useDb();
  const { user } = useAuth();
  const found = db.orders.find(o => o.id === id);
  if (found && user?.role === "employee" && !worksOnOrder(db, user, found)) {
    const holder = db.users.find(u => u.id === found.assignedEmployeeId)?.name;
    return (
      <div className="text-center py-20 text-muted-foreground max-w-md mx-auto space-y-2">
        <p className="font-medium text-brand-dark">{found.orderNumber} is not one of your orders.</p>
        <p className="text-sm">{holder ? `It is assigned to ${holder}. ` : ""}Ask the admin to assign it to you, or to give you a role that sees every order.</p>
        <Link to="/orders" className="text-primary underline text-sm">Back to your orders</Link>
      </div>
    );
  }
  if (!found) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {collectionLoaded("orders") ? "Order not found." : "Loading…"}{" "}
        <Link to="/orders" className="text-primary underline">Back</Link>
      </div>
    );
  }
  // Keyed by the record, so moving straight to another one starts it afresh.
  return <OrderDetailPageBody key={id} />;
}

function OrderDetailPageBody() {
  const { id } = useParams();
  const { user } = useAuth();
  const can = useCan();
  const addNew = useAddNew();
  const nav = useNavigate();

  // Barcode band modal state
  const [bandOpen, setBandOpen] = useState(false);

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
  // Reference images, added after the order was placed (up to 3, as on New Order).
  const refImageRef = useRef<HTMLInputElement>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const MAX_VIDEO_MB = 60;

  // Dispatch form
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchModalIdx, setDispatchModalIdx] = useState<number | null>(null); // Dispatch-details popup on "Mark complete"
  const [dispatchSaving, setDispatchSaving] = useState(false);
  const [courierName, setCourierName] = useState("");
  // The day the goods actually left. Entries are often caught up two or three
  // days later, and stamping those with "now" put the wrong day in the record
  // with no way to correct it.
  const [dispatchDay, setDispatchDay] = useState(todayLocal());
  // What sending it cost — recorded with the dispatch, once.
  const [dispShipCost, setDispShipCost] = useState<ShippingCost>(EMPTY_SHIPPING_COST);
  // Arrival is entered late more often than dispatch is, so it takes a date on
  // the same terms.
  const [deliverModalIdx, setDeliverModalIdx] = useState<number | null>(null);
  const [deliverDay, setDeliverDay] = useState(todayLocal());
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
  // One order's stones often come from more than one supplier — two parcels
  // from one dealer and a certified stone from another. Each supplier's bill is
  // its own document (supplier, bill number, lines, round-off), so the form
  // holds a list of bills and saves them together.
  const [buyBills, setBuyBills] = useState<BuyBill[]>(() => [emptyBuyBill()]);
  const [buying, setBuying] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueMaterial, setIssueMaterial] = useState<MaterialKey>("gold");
  const [issueGrade, setIssueGrade] = useState("");
  const otherMaterials = useOtherMaterials();
  /** "gold", "diamond", or the other material's own name — for messages. */
  const matWord = (k: string) => (k === "gold" || k === "diamond" ? k : materialName(db.settings, k));
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
  // Where the added gold comes from. Normally the factory takes it from the
  // gold it already holds of ours, so THEIR ledger drops by the pure (24KT)
  // equivalent and our warehouse stock is untouched.
  const [rwGoldFrom, setRwGoldFrom] = useState<"factory" | "stock">("factory");
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
  const [meltOpen, setMeltOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  // The order's details (side panel), and a payment row being corrected.
  const [editOpen, setEditOpen] = useState(false);
  const [editingPayId, setEditingPayId] = useState<string | null>(null);
  const mayReturn = useMayReturn();
  const mayExport = useMayExport();
  // An in-house build going into Ready Stock: which office will keep it.
  const [rsOffice, setRsOffice] = useState<string | null>(null);

  // Single materials flow: factory + estimate + diamond (stock or buy).
  const [showEstimate, setShowEstimate] = useState(false);
  const [estGold, setEstGold] = useState(""); // estimated GROSS weight (g)
  const [estNet, setEstNet] = useState("");   // estimated NET weight — the gold (g)
  const [estDia, setEstDia] = useState("");
  const [estMaking, setEstMaking] = useState("");
  const [diaSource, setDiaSource] = useState<"stock" | "buy">("stock");
  const [showDiamond, setShowDiamond] = useState(false);

  const db = useDb();
  const order = db.orders.find(o => o.id === id);
  if (!order) return <div className="text-center py-20">Order not found. <Link to="/orders" className="text-primary underline">Back</Link></div>;
  // Whose stock and factory share this order's material work uses — each company holds its own.
  const workCo = workCompanyOf(db, order);

  const client = db.clients.find(c => c.id === order.clientId);
  const employee = db.users.find(u => u.id === order.assignedEmployeeId);
  const advances = order.advances || [];
  const advTotal = totalAdvance(order);
  const balance = balanceDue(order);
  // Any actual weight recorded? Drives the "Actual Details" display (all fields optional).
  const hasActuals = !!(order.actualNetWeight || order.actualGrossWeight || order.actualDiamondWeight);

  // ── Manufacturing: purchases/issuances linked to this order ──
  const linkedPurchases = db.purchases.filter(p => p.orderId === order.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // Remove a purchase recorded against this order (e.g. the same diamond
  // entered twice). Reverses EVERYTHING it created — supplier due, the auto
  // factory issue, stock movements, certified packet and the order links — via
  // the shared unwind in src/lib/purchaseVoid.ts. Refuses when it can no longer
  // be undone cleanly (already paid, or the factory already finished the piece).
  const [removingPurchaseId, setRemovingPurchaseId] = useState<string | null>(null);
  const removeLinkedPurchase = async (p: Purchase) => {
    const check = canVoidPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!(await confirmBox(
      `Remove this purchase of ${purchaseLabel(p)} (${fmtMoneyInr(p.totalInr)}) from this order?

` +
      "What changes:\n" + voidImpact(db, p).join("\n") + "\n\nThis cannot be undone.",
    ))) return;
    setRemovingPurchaseId(p.id);
    try {
      await voidPurchaseCascade(db, p, user!.id);
      toast.success("Duplicate purchase removed — supplier due, factory issue and stock all reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove this purchase.");
    } finally { setRemovingPurchaseId(null); }
  };

  // Correct material taken from our own stock. The purchase row beside it could
  // always be corrected; this one could not, so a wrong carat stayed wrong and
  // the stones stayed out of stock. See src/lib/issuanceEdit.ts.
  const [editingIssuance, setEditingIssuance] = useState<MaterialIssuance | null>(null);
  const [isf, setIsf] = useState({ qty: "", bucket: "", charge: "", notes: "" });
  const [savingIssuance, setSavingIssuance] = useState(false);
  const [removingIssuanceId, setRemovingIssuanceId] = useState<string | null>(null);

  /**
   * Say the finished piece has no diamond in it.
   *
   * Final Approval waits for a diamond because the order asked for one. A plain
   * gold piece, or one whose estimate called for stones it did not end up
   * using, had no way past that except the admin override — which records
   * nothing about why. This records the reason and lets the order move on.
   */
  const setNoDiamond = (on: boolean) => {
    const issued = db.materialIssuances.filter(i => i.orderId === order.id && i.material === "diamond");
    if (on && issued.length > 0) {
      toast.error("Diamond is already recorded against this order — remove it first.");
      return;
    }
    updateDb(d => { const o = d.orders.find(x => x.id === order.id); if (o) o.noDiamond = on || undefined; });
    toast.success(on ? "Marked gold only — no diamond in this piece" : "Diamond is expected again");
  };

  const openEditIssuance = (mi: MaterialIssuance) => {
    const check = canEditIssuance(db, mi);
    if (!check.ok) { toast.error(check.reason!); return; }
    setEditingIssuance(mi);
    setIsf({
      qty: String(mi.quantityIssued), bucket: mi.purityOrQuality,
      charge: mi.makingCharges.amountInr ? String(mi.makingCharges.amountInr) : "",
      notes: mi.notes ?? "",
    });
  };

  const saveIssuance = async () => {
    if (!editingIssuance) return;
    setSavingIssuance(true);
    try {
      await editIssuance(db, editingIssuance, {
        quantity: Number(isf.qty) || undefined,
        purityOrQuality: isf.bucket,
        chargeAmount: isf.charge === "" ? undefined : Number(isf.charge) || 0,
        notes: isf.notes,
      }, user!.id);
      toast.success("Corrected — stock moved by the difference");
      setEditingIssuance(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't correct this.");
    } finally { setSavingIssuance(false); }
  };

  const removeIssuance = async (mi: MaterialIssuance) => {
    const check = canEditIssuance(db, mi);
    if (!check.ok) { toast.error(check.reason!); return; }
    const unit = materialUnit(db.settings, mi.material);
    if (!(await confirmBox([
      `Cancel this issue of ${mi.quantityIssued}${unit} ${mi.purityOrQuality}?`,
      "",
      ...issuanceVoidImpact(db, mi),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    setRemovingIssuanceId(mi.id);
    try {
      await deleteIssuance(db, mi, user!.id);
      toast.success("Issue cancelled — material returned to stock");
      setEditingIssuance(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this.");
    } finally { setRemovingIssuanceId(null); }
  };

  // Correct a purchase entered wrong (carat/rate/certificate). The change is
  // carried through the supplier due, factory issue, packet and stock trail.
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  // Design number — correctable at any time (it drives the invoice stock id and
  // the Product Photos grouping, so a typo needs to be fixable).
  const [editDesign, setEditDesign] = useState<string | null>(null);
  const saveDesignNumber = () => {
    const v = (editDesign ?? "").trim();
    updateDb(d => { const o = d.orders.find(x => x.id === order.id); if (o) o.designNumber = v || undefined; });
    setEditDesign(null);
    toast.success(v ? `Design number set to ${v}` : "Design number cleared");
  };
  const openEditPurchase = (p: Purchase) => {
    // A finished piece locks the WEIGHT, not the price — open the dialog in
    // price-only mode instead of refusing, so a mistyped rate is still fixable.
    const scope = purchaseEditScope(db, p);
    if (!scope.quantity && !scope.money) { toast.error(scope.reason!); return; }
    setEditingPurchase(p);
  };
  const saveEditPurchase = async (edit: PurchaseEdit) => {
    if (!editingPurchase) return;
    try {
      await editPurchase(db, editingPurchase, edit, user!.id);
      toast.success("Purchase corrected — supplier due, factory issue and stock updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the correction.");
    }
  };
  const linkedIssuances = db.materialIssuances.filter(i => i.orderId === order.id).sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
  // Why a linked purchase can't be corrected / removed from here (admin only,
  // as before) — shown on its greyed button rather than the button vanishing.
  const purchaseWhy = (p: Purchase, what: "edit" | "remove"): string | undefined => {
    if (user!.role !== "admin") return "Only the admin can correct or remove a purchase";
    const check = what === "edit" ? canEditPurchase(db, p) : canVoidPurchase(db, p);
    return check.ok ? undefined : check.reason;
  };

  const buyGrandTotalInr = buyBills.reduce((s, b) => s + billTotalInr(b), 0);
  const buyLineCount = buyBills.reduce((s, b) => s + b.lines.length, 0);

  const updateBill = (bi: number, patch: Partial<BuyBill>) =>
    setBuyBills(prev => prev.map((b, i) => (i === bi ? { ...b, ...patch } : b)));
  const updateBuyLine = (bi: number, li: number, patch: Partial<BuyLine>) =>
    setBuyBills(prev => prev.map((b, i) => (i === bi ? { ...b, lines: b.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) } : b)));
  const addBuyLine = (bi: number) =>
    setBuyBills(prev => prev.map((b, i) => (i === bi ? { ...b, lines: [...b.lines, emptyBuyLine()] } : b)));
  const removeBuyLine = (bi: number, li: number) =>
    setBuyBills(prev => prev.map((b, i) => (i === bi && b.lines.length > 1 ? { ...b, lines: b.lines.filter((_, j) => j !== li) } : b)));
  const addBuyBill = () => setBuyBills(prev => [...prev, emptyBuyBill()]);
  const removeBuyBill = (bi: number) => setBuyBills(prev => (prev.length > 1 ? prev.filter((_, i) => i !== bi) : prev));
  const allBuyLinesDiamond = () =>
    setBuyBills(bs => bs.map(b => ({ ...b, lines: b.lines.map(l => ({ ...l, material: "diamond" as const })) })));

  const resetBuyForm = () => setBuyBills([emptyBuyBill()]);

  const recordPurchaseForOrder = async () => {
    const supplierName = (id: string) => db.suppliers.find(s => s.id === id)?.name || "supplier";
    const many = buyBills.length > 1;
    for (let bi = 0; bi < buyBills.length; bi++) {
      const bill = buyBills[bi];
      const which = many ? `Bill ${bi + 1}: ` : "";
      if (!bill.supplierId) { toast.error(`${which}choose the supplier`); return; }
      if (!bill.billNo.trim()) { toast.error(`${which}enter ${supplierName(bill.supplierId)}'s bill number`); return; }
      for (const line of bill.lines) {
        if (line.material === "gold" && (!line.goldWeight || Number(line.goldWeight) <= 0)) { toast.error(`${which}enter gold weight for every line`); return; }
        if (line.material === "diamond" && (!line.diaCarat || Number(line.diaCarat) <= 0)) { toast.error(`${which}enter diamond carat for every line`); return; }
        if (line.material === "diamond" && line.diaKind === "certified" && !line.diaCertNo.trim()) { toast.error(`${which}enter the report number for every certified diamond`); return; }
        if (line.currency === "USD" && !line.exchangeRate) { toast.error(`${which}enter the exchange rate for every USD line`); return; }
        if (buyLineTotalInr(line) <= 0) { toast.error(`${which}a line's total comes to ₹0 — check its weight/rate fields`); return; }
      }
    }
    // Client's flow: assign the factory first, then buy — the purchased material
    // goes STRAIGHT to that factory, no separate "issue" step. A diamond-only
    // order has no factory: the stones are bought for the client, not to be set.
    if (!order.assignedFactoryId && !isDiamondOnlyOrder(order)) { toast.error("Assign a factory first (Stage ① above) — the material goes straight to it."); return; }
    // The same bill entered twice is the same bill paid twice.
    const billKey = (supplierId: string, no: string) => `${supplierId}|${no.trim().toLowerCase()}`;
    const seen = new Set<string>();
    for (const bill of buyBills) {
      const k = billKey(bill.supplierId, bill.billNo);
      if (seen.has(k)) { toast.error(`Bill ${bill.billNo.trim()} from ${supplierName(bill.supplierId)} is entered twice — put all its stones in one bill.`); return; }
      seen.add(k);
    }
    const onFile = buyBills.filter(b => (db.purchases ?? []).some(p => billKey(p.supplierId, p.invoiceNumber ?? "") === billKey(b.supplierId, b.billNo)));
    if (onFile.length && !(await confirmBox(
      `${onFile.map(b => `Bill ${b.billNo.trim()} from ${supplierName(b.supplierId)}`).join(", ")} is already recorded.\n\n` +
      "Save these lines against it as well? Cancel if it is the same purchase being entered again."))) return;

    const now = new Date().toISOString();
    // Every line of every bill becomes its own Purchase; each carries its bill's
    // supplier and number, exactly as one bill entered on its own would.
    const entries: { purchase: Purchase; line: BuyLine; bill: BuyBill }[] = [];
    for (const bill of buyBills) {
      const first = entries.length;
      for (const line of bill.lines) {
        entries.push({ bill, line, purchase: {
          id: uid("pur_"), ...coField(workCo),
          supplierId: bill.supplierId,
          material: line.material,
          gold: line.material === "gold" ? { weightGrams: Number(line.goldWeight), purity: line.goldPurity, ratePerGram: Number(line.goldRate) || 0 } : undefined,
          diamond: line.material === "diamond" ? {
            carat: Number(line.diaCarat), quality: line.diaQuality || undefined, ratePerCarat: Number(line.diaRate) || 0,
            pieces: line.diaKind === "loose" && Number(line.diaPcs) > 0 ? Math.round(Number(line.diaPcs)) : undefined,
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
          discountPct: Number(line.discountPct) ? Number(line.discountPct) : undefined,
          roundOffInr: undefined as number | undefined,
          payments: [],
          invoiceNumber: bill.billNo.trim(),
          notes: line.notes.trim() || undefined,
          createdBy: user!.id,
          createdAt: now,
        } });
      }
      // Each bill is rounded once, not per line, so it rides on its first purchase.
      const ro = billRoundOffInr(bill);
      if (ro !== 0 && entries.length > first) {
        entries[first].purchase.totalInr += ro;
        entries[first].purchase.roundOffInr = ro;
      }
    }
    const newPurchases = entries.map(x => x.purchase);

    // Precompute each line's pooled-stock bucket up front — needed both for the
    // stock-movement logging below (which must happen before updateDb, so a
    // failed write there fails the whole action instead of leaving an orphaned
    // purchase with no stock trail) and inside updateDb itself.
    const lineMeta = entries.map(({ purchase, line }) => {
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
      const factoryId = order.assignedFactoryId || "";
      const factory = db.factories.find(f => f.id === factoryId);

      // Material bought for this order goes straight to the factory and never
      // enters the shared stock pool — but log it (paired in+out, nets to zero)
      // so it still shows up on the Stock report. Certified diamonds are tracked
      // individually via DiamondPacket instead and are never pooled.
      for (let i = 0; i < newPurchases.length; i++) {
        const { isCertified, qty, purityOrQuality } = lineMeta[i];
        if (isCertified) continue;
        await logOrderDirectPurchase({ companyId: workCo,
          material: newPurchases[i].material, purityOrQuality, quantity: qty,
          purchaseId: newPurchases[i].id, orderId: order.id, createdBy: user!.id,
          // Same instant as the purchase itself, so the two legs stay findable.
          createdAt: now,
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
        for (let i = 0; i < entries.length; i++) {
          const { purchase, line, bill } = entries[i];
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
            remarks: `Purchased ${label} from ${supplierName(bill.supplierId)} (bill ${bill.billNo.trim()}) for this order — ${fmtMoneyInr(purchase.totalInr)}`,
          });

          // Certified diamond → its own packet, going straight to the factory.
          let packetIds: string[] | undefined;
          if (isCertified) {
            if (!d.diamondPackets) d.diamondPackets = [];
            const packetId = uid("dp_");
            const carat = Number(line.diaCarat) || 0;
            d.diamondPackets.unshift({ ...coField(workCo),
              id: packetId, stockNumber: nextDiamondStockNumber(d), shape: line.diaShape, carat, quality: line.diaQuality || undefined,
              color: line.diaColor.trim() || undefined, clarity: line.diaClarity.trim() || undefined,
              cut: line.diaCut.trim() || undefined, polish: line.diaPolish.trim() || undefined,
              symmetry: line.diaSym.trim() || undefined, fluorescence: line.diaFluor.trim() || undefined,
              measurement: line.diaMeasure.trim() || undefined,
              certificateNumber: line.diaCertNo.trim(), certificateLab: line.diaLab.trim() || undefined,
              ratePerCaratInr: carat > 0 ? Math.round((purchase.totalInr / carat) * 100) / 100 : undefined,
              supplierId: bill.supplierId, purchaseId: purchase.id,
              status: "issued", orderId: order.id,
              createdBy: user!.id, createdAt: now,
            });
            packetIds = [packetId];
          }

          // Auto-issue straight to the assigned factory (source "purchase" — the
          // pooled stockLevels balance is untouched, though it's now logged in
          // stockMovements for reporting; see logOrderDirectPurchase above). One step.
          // Skipped when there is no factory: a diamond-only order's stones are
          // bought for the client and dispatched, never sent out to be set.
          if (!factoryId) continue;
          const issuanceId = uid("mi_");
          d.materialIssuances.unshift({
            id: issuanceId, factoryId, orderId: order.id, material: purchase.material, ...coField(workCo),
            purityOrQuality, quantityIssued: qty, source: "purchase", sourcePurchaseId: purchase.id,
            diamondKind: purchase.material === "diamond" ? line.diaKind : undefined,
            piecesIssued: purchase.material === "diamond" && line.diaKind === "loose" && Number(line.diaPcs) > 0
              ? Math.round(Number(line.diaPcs)) : undefined,
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
      const what = buyBills.length > 1
        ? `${buyBills.length} bills (${newPurchases.length} items)`
        : newPurchases.length > 1 ? `${newPurchases.length} purchases` : "Purchase";
      toast.success(factoryId
        ? `${what} recorded (${fmtMoneyInr(buyGrandTotalInr)}) & sent to ${factory?.name || "the factory"}`
        : `${what} recorded (${fmtMoneyInr(buyGrandTotalInr)}) against ${order.orderNumber}`);
      setShowBuyForm(false); setShowDiamond(false);
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
    setIssueDiaKind("loose"); setIssueCertPacketIds([]); setIssueCertSearch(""); setIssueGrade("");
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
      if (goldG > 0 && rwGoldDir === "add" && rwGoldFrom === "stock") {
        await decreaseStockSelfHealing({ material: "gold", companyId: workCo, purityOrQuality: rwGoldKarat, quantity: goldG, type: "order_direct_use", refType: "order", refId: order.id, createdBy: user!.id, note: `Rework +${goldG}g ${rwGoldKarat} gold for ${order.orderNumber}` }, db.stockMovements);
      } else if (goldG > 0 && rwGoldDir === "remove") {
        await increaseStock({ material: "gold", companyId: workCo, purityOrQuality: rwGoldKarat, quantity: goldG, refType: "manual", createdBy: user!.id, note: `Rework −${goldG}g ${rwGoldKarat} gold from ${order.orderNumber} → stock` });
      }
      if (diaCt > 0 && rwDiaDir === "add") {
        await decreaseStockSelfHealing({ material: "diamond", companyId: workCo, purityOrQuality: rwDiaShape, quantity: diaCt, type: "order_direct_use", refType: "order", refId: order.id, createdBy: user!.id, note: `Rework +${diaCt}ct ${rwDiaShape} for ${order.orderNumber}` }, db.stockMovements);
      } else if (diaCt > 0 && rwDiaDir === "remove") {
        await increaseStock({ material: "diamond", companyId: workCo, purityOrQuality: rwDiaShape, quantity: diaCt, refType: "manual", createdBy: user!.id, note: `Rework −${diaCt}ct ${rwDiaShape} from ${order.orderNumber} → stock` });
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
            id: iid, factoryId, orderId: o.id, material: "gold", ...coField(workCo), purityOrQuality: rwGoldKarat,
            quantityIssued: goldG, source: rwGoldFrom === "stock" ? "stock" : "factoryPool",
            finishedNetWeight: goldG, finishedKarat: rwGoldKarat, finishedPurity: purMille,
            finishedPieces: [{ id: uid("fp_"), quantityUsed: goldG, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
            issuedAt: now, issuedBy: user!.id, status: "closed",
            makingCharges: { amountInr: charge, payments: [] },
            notes: `${noteBase} (added ${goldG}g ${rwGoldKarat} gold from ${rwGoldFrom === "stock" ? "our stock" : "the factory’s holding"})`,
          } as MaterialIssuance);
          o.materialIssuanceIds.push(iid);
          chargeAttached = charge > 0;
        }
        // Diamond ADD → factory-neutral leg (issued-in + used-in-piece).
        if (diaCt > 0 && rwDiaDir === "add") {
          const iid = uid("mi_");
          d.materialIssuances.unshift({
            id: iid, factoryId, orderId: o.id, material: "diamond", ...coField(workCo), purityOrQuality: rwDiaShape,
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
            id: iid, factoryId, orderId: o.id, material: "gold", ...coField(workCo), purityOrQuality: "—",
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

  // Carats actually issued to the factory for this order — the figure the scale
  // adjustment is measured against.
  const issuedDiaCt = Math.round(
    db.materialIssuances
      .filter(i => i.orderId === order.id && i.material === "diamond")
      .reduce((s2, i) => s2 + i.quantityIssued, 0) * 1000) / 1000;

  useEffect(() => {
    setDiaTotW(order.actualDiamondWeight != null ? String(order.actualDiamondWeight) : "");
    setDiaTotPcs(order.actualDiamondPcs != null ? String(order.actualDiamondPcs) : "");
  }, [order.id, order.actualDiamondWeight, order.actualDiamondPcs]);

  /** Save the factory-bill diamond totals. The difference from what we issued is
   *  kept as the scale adjustment, so the two ledgers can still be reconciled. */
  const saveDiamondTotals = () => {
    const w = diaTotW.trim() === "" ? undefined : Number(diaTotW);
    const pcs = diaTotPcs.trim() === "" ? undefined : Math.round(Number(diaTotPcs));
    if (w !== undefined && (!isFinite(w) || w < 0)) return;
    if (pcs !== undefined && (!isFinite(pcs) || pcs < 0)) return;
    if (w === order.actualDiamondWeight && pcs === order.actualDiamondPcs) return;
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id);
      if (!o) return;
      o.actualDiamondWeight = w && w > 0 ? w : undefined;
      o.actualDiamondPcs = pcs && pcs > 0 ? pcs : undefined;
      o.diamondWeightAdjust = w && issuedDiaCt > 0
        ? Math.round((w - issuedDiaCt) * 1000) / 1000 || undefined
        : undefined;
    });
    toast.success("Diamond totals saved");
  };

  // The stones this order's company holds.
  const inStockPackets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && companyOf(p) === workCo);

  // ── Final Approval popup: one window for all the actual details ──
  const [faIdx, setFaIdx] = useState<number | null>(null);
  const [faGoldNet, setFaGoldNet] = useState("");
  const [faGoldPurity, setFaGoldPurity] = useState(""); // actual purity ‰ (e.g. 750), replaces the karat dropdown
  const [faDia, setFaDia] = useState<Record<string, "used" | "returned">>({}); // certified packets: whole used/returned
  const [faDiaReturnedCt, setFaDiaReturnedCt] = useState<Record<string, string>>({}); // loose diamonds: carats returned (partial allowed)
  const [faDiaReturnedPcs, setFaDiaReturnedPcs] = useState<Record<string, string>>({}); // loose diamonds: how many STONES came back
  const [faXReturned, setFaXReturned] = useState<Record<string, string>>({}); // other materials: how much came back
  // A factory weighs the stones on its own scale, so its bill can read 6.60ct
  // where we issued 6.58ct. Handling charges are billed on THEIR total, so
  // without a way to match it the two ledgers can never agree. This is that
  // adjustment (+ or −), and the stone count that goes on the same bill.
  const [faDiaAdjust, setFaDiaAdjust] = useState("");
  const [faDiaPcs, setFaDiaPcs] = useState("");
  const [faBillNo, setFaBillNo] = useState("");
  // The same two figures, editable straight from the Manufacturing card so they
  // can be set from the factory’s bill without reopening Final Approval.
  const [diaTotW, setDiaTotW] = useState("");
  const [diaTotPcs, setDiaTotPcs] = useState("");
  // Two-tone pieces — a second metal alongside the gold (platinum / silver / …).
  const [faOtherMetal, setFaOtherMetal] = useState("");
  const [faOtherNet, setFaOtherNet] = useState("");
  const [faMinLabour, setFaMinLabour] = useState("");
  const [faOtherPurity, setFaOtherPurity] = useState("");
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
    // metalWeight is the old single "gold weight" field — metal only, so net.
    setEstGold(order.estimatedGrossWeight?.toString() ?? "");
    setEstNet(order.estimatedNetWeight?.toString() ?? (order.metalWeight ? String(order.metalWeight) : ""));
    setEstDia(order.diamondWeight?.toString() ?? "");
    setEstMaking(order.estimatedMakingCharges?.toString() ?? "");
    setShowEstimate(true);
  };

  const saveEstimate = () => {
    const wp = weightProblem({ gross: Number(estGold), net: Number(estNet), diamondCt: Number(estDia || order.diamondWeight) });
    if (wp) { toast.error(wp); return; }
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id);
      if (!o) return;
      o.estimatedGrossWeight = estGold ? Number(estGold) : undefined;
      o.estimatedNetWeight = estNet ? Number(estNet) : undefined;
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
    const otherNet = order.otherMetal ? (order.otherMetalWeight || 0) : 0;
    const value = labourValue(
      labour,
      Math.round(((hasNet ? netW : (issuance.finishedNetWeight || 0)) + otherNet) * 1000) / 1000,
      diamondCt,
    );
    const karat = rcvKarat || issuance.purityOrQuality;
    // Gold: what's in the piece = net weight; the rest goes back. Diamonds keep
    // their existing used amount (net weight doesn't apply).
    const usedQty = hasNet ? Math.min(netW, issuance.quantityIssued) : issuanceUsed(issuance);
    const leftover = Math.round((issuance.quantityIssued - usedQty) * 100) / 100;
    const unit = materialUnit(db.settings, issuance.material);
    const factory = db.factories.find(f => f.id === issuance.factoryId);
    const now = new Date().toISOString();
    setClosingId(issuance.id);
    try {
      const returnsToStock = leftover > 0 && issuance.diamondKind !== "certified" && issuance.source === "stock";
      const releasesToPool = leftover > 0 && issuance.source === "factoryPool";
      if (returnsToStock) {
        await increaseStock({
          material: issuance.material, companyId: companyOf(issuance), purityOrQuality: issuance.purityOrQuality, quantity: leftover,
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
            id: issuanceId, factoryId: issueFactoryId, orderId: order.id, material: "diamond", ...coField(workCo),
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
        setShowIssueForm(false); setShowDiamond(false); resetIssueForm();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      } finally { setIssuing(false); }
      return;
    }

    const qty = Number(issueQuantity);
    if (isOtherMaterial(issueMaterial) && !otherMaterials.some(m => m.id === issueMaterial)) { toast.error("Choose the material"); return; }
    if (!qty || qty <= 0) { toast.error(`Enter the ${matWord(issueMaterial)} ${isOtherMaterial(issueMaterial) ? "quantity" : "weight/carat"} used`); return; }
    const purityOrQuality = issueMaterial === "gold" ? issuePurity : isOtherMaterial(issueMaterial) ? (issueGrade.trim() || "—") : (issueQuality.trim() || "unspecified");

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
          material: issueMaterial, companyId: workCo, purityOrQuality, quantity: qty,
          type: "issuance_out", refType: "materialIssuance", refId: issuanceId, createdBy: user!.id,
          note: `Used by ${factory?.name || "factory"} for order ${order.orderNumber}`,
        }, db.stockMovements);
      }
      updateDb(d => {
        if (!d.materialIssuances) d.materialIssuances = [];
        const issuance: MaterialIssuance = {
          id: issuanceId, factoryId: issueFactoryId, orderId: order.id, material: issueMaterial, ...coField(workCo),
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
            remarks: `${qty}${materialUnit(db.settings, issueMaterial)} ${purityOrQuality} ${matWord(issueMaterial)} used at ${factory?.name || "factory"}${chargeAmount ? ` — making charge ${fmtMoneyInr(chargeAmount)}` : ""}`,
          });
        }
      });
      toast.success(`Recorded ${qty}${materialUnit(db.settings, issueMaterial)} ${purityOrQuality} ${isOtherMaterial(issueMaterial) ? `${matWord(issueMaterial)} ` : ""}used${chargeAmount ? ` — ${fmtMoneyInr(chargeAmount)} charge` : ""}`);
      setShowIssueForm(false); setShowDiamond(false);
      resetIssueForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally { setIssuing(false); }
  };

  // Admin, or an employee whose work this order is (assigned to them, a client
  // they manage, or every order when their role reaches all) — as long as their
  // role lets them change orders at all.
  const canEditStage = () => user!.role === "admin"
    || (user!.role === "employee" && can("orders", "edit") && worksOnOrder(db, user!, order));

  // "Final Approval" can't be marked complete until the gold/diamond this
  // order actually needs has been issued to a factory — admins can still
  // force it through (e.g. material sourced outside this system) so a
  // legacy or edge-case order can never get permanently stuck.
  const readiness = manufacturingReadiness(order, db.materialIssuances);
  // Loose/certified stones sold on their own: nothing is designed, cast or set,
  // so there is no production timeline, no factory and no final approval —
  // the diamond is bought for the order and dispatched.
  const diamondOnly = isDiamondOnlyOrder(order);
  const shownSteps = order.timeline
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !(diamondOnly && isProductionStep(t.step)));
  const faStepIdx = order.timeline.findIndex(t => t.step === "Final Approval");
  const faDone = faStepIdx >= 0 && order.timeline[faStepIdx].status === "done";

  const advanceStep = async (idx: number, overrideReadiness = false, atISO?: string): Promise<boolean> => {
    if (order.timeline[idx].step === "Final Approval" && !overrideReadiness && !readiness.ready) {
      toast.error(`Issue ${readiness.missing.join(" and ")} to a factory before Final Approval`);
      return false;
    }
    // Never let goods leave without a price, and warn before shipping unpaid.
    if (order.timeline[idx].step === "Dispatch") {
      if (orderTotal(order) <= 0) { toast.error("Set the order price before dispatching."); return false; }
      if (balanceDue(order) > 0 && !(await confirmBox(`Balance of ${fmtMoney(balanceDue(order))} is still unpaid on this order. Dispatch anyway?`))) return false;
    }
    // The caller may know the stage happened on an earlier day than the one it
    // is being entered on; everything else is stamped as it is recorded.
    const at = atISO ?? new Date().toISOString();
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      // Diamond-only orders created before the production stages were dropped
      // still carry them. They are hidden, so close them along with the step
      // actually being marked — otherwise the order can never reach Dispatch.
      if (diamondOnly) {
        for (let i = 0; i < idx; i++) {
          if (o.timeline[i].status !== "done" && isProductionStep(o.timeline[i].step)) {
            o.timeline[i] = { ...o.timeline[i], status: "done", date: at, remarks: "Not applicable — diamond only" };
          }
        }
      }
      o.timeline[idx] = { ...o.timeline[idx], status: "done", date: at, employeeId: user!.id, department: user!.department, remarks: "Completed" };
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

  const forceAdvanceStep = async (idx: number) => {
    if (!(await confirmBox(`Mark Final Approval complete without recording ${readiness.missing.join(" and ")} issuance? Only do this if the material was sourced outside this system.`))) return;
    await advanceStep(idx, true);
  };

  // The single "finishing" record for an order (gold net weight + labour). Used
  // to prefill the popup on re-edit and to update in place instead of duplicating.
  const finishRecord = () => db.materialIssuances.find(i => i.orderId === order.id && i.material === "gold" && i.source === "factoryPool");

  /** Other materials issued for this order (Settings → Materials) — Final Approval says what came back. */
  const faXIssues = () => db.materialIssuances.filter(i => i.orderId === order.id && isOtherMaterial(i.material) && i.source !== "melt");
  const faXReturnedOf = (i: MaterialIssuance) => Math.min(Math.max(Number(faXReturned[i.id]) || 0, 0), i.quantityIssued);
  /** Grams the other materials add to the piece: metals as weighed, stones at 0.2 g a carat (pieces are not weighed). */
  const faXGrams = () => {
    let metal = 0, stone = 0;
    for (const i of faXIssues()) {
      const used = Math.max(0, i.quantityIssued - faXReturnedOf(i));
      const u = materialUnit(db.settings, i.material);
      if (u === "g") metal += used; else if (u === "ct") stone += used * CARAT_TO_GRAM;
    }
    return { metal: Math.round(metal * 1000) / 1000, stone: Math.round(stone * 1000) / 1000 };
  };

  const openFinalApproval = (idx: number) => {
    if (order.melted) { toast.error("This piece was melted — its actual details are kept as they were."); return; }
    const needsGold = orderMaterialRequirements(order).needsGold;
    const finish = finishRecord();
    setFaGoldNet(finish?.finishedNetWeight != null ? String(finish.finishedNetWeight) : (needsGold ? (order.estimatedNetWeight?.toString() ?? order.estimatedGrossWeight?.toString() ?? order.metalWeight?.toString() ?? "") : ""));
    // Prefill the purity the FACTORY works to for this karat (14KT = 595, not the
    // textbook 583). That is what actually gets entered; the textbook figure is
    // the fallback for a karat not in that table.
    const defaultPurity = order.productKarats
      ? (FACTORY_PURITY[order.productKarats]
          ?? Math.round((KARAT_PURITY[parseInt(order.productKarats, 10)] ?? 0) * 1000))
      : 0;
    setFaGoldPurity(finish?.finishedPurity != null ? String(finish.finishedPurity) : (defaultPurity ? String(defaultPurity) : ""));
    setFaPerGram(finish?.labour?.perGramRate != null ? String(finish.labour.perGramRate) : "");
    setFaMinLabour(finish?.labour?.minimumLabour != null ? String(finish.labour.minimumLabour) : "");
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
    const retPcs: Record<string, string> = {};
    dias.forEach(i => { retPcs[i.id] = i.finishReturnedPcs != null ? String(i.finishReturnedPcs) : ""; });
    setFaDiaReturnedPcs(retPcs);
    setFaXReturned(Object.fromEntries(faXIssues().map(i => [i.id, i.finishReturnedQty != null ? String(i.finishReturnedQty) : "0"])));
    setFaDiaAdjust(order.diamondWeightAdjust != null ? String(order.diamondWeightAdjust) : "");
    setFaDiaPcs(order.actualDiamondPcs != null ? String(order.actualDiamondPcs) : "");
    setFaBillNo(order.factoryBillNo ?? "");
    // A platinum or silver piece IS that metal — it is not a second metal added
    // to a gold one. The field starts on the order's own metal so its weight can
    // be entered at once; leaving it blank disabled the weight box, which is
    // also the weight labour per gram is charged on.
    const selfMetal = order.metal === "Platinum" || order.metal === "Silver" ? order.metal : "";
    setFaOtherMetal(order.otherMetal ?? selfMetal);
    setFaOtherNet(order.otherMetalWeight != null ? String(order.otherMetalWeight) : "");
    setFaOtherPurity(order.otherMetalPurity != null ? String(order.otherMetalPurity) : "");
    setFaOrderValue(order.amount ? String(order.amount) : "");
    setFaShipping(order.shippingCharge ? String(order.shippingCharge) : "");
    setFaIdx(idx);
  };

  const saveFinalApproval = async () => {
    if (faIdx === null) return;
    if (order.melted) { toast.error("This piece was melted — its actual details are kept as they were."); return; }
    const needsGold = orderMaterialRequirements(order).needsGold;
    const netW = parseFloat(faGoldNet);
    // A weight typed here is gold that went into the piece, whatever metal the
    // order was raised as. This was gated on needsGold, so on a platinum or
    // silver order the figure was taken, ignored and silently thrown away — and
    // a two-tone piece is platinum AND gold.
    const hasNet = !isNaN(netW) && netW > 0;
    const purity = parseFloat(faGoldPurity) || 0; // ‰ e.g. 750
    const karat = order.productKarats || "18K"; // label only
    const dias = db.materialIssuances.filter(i => i.orderId === order.id && i.material === "diamond");
    // Carats actually consumed into the piece: certified = whole if "used";
    // loose = issued minus the partial returned amount.
    const looseReturnedCt = (i: MaterialIssuance) => Math.min(Math.max(Number(faDiaReturnedCt[i.id]) || 0, 0), i.quantityIssued);
    const usedDiaCtRaw = dias.reduce((s, i) => {
      if (i.diamondKind === "certified") return s + ((faDia[i.id] ?? "used") === "used" ? i.quantityIssued : 0);
      return s + (i.quantityIssued - looseReturnedCt(i));
    }, 0);
    // The factory weighs on its own scale and bills handling on ITS total, so
    // this adjustment is carried into every figure that follows.
    const diaAdjust = Number(faDiaAdjust) || 0;
    const usedDiaCt = Math.round((usedDiaCtRaw + diaAdjust) * 1000) / 1000;
    const labour = {
      perGramRate: faPerGram ? Number(faPerGram) : undefined,
      minimumLabour: faMinLabour ? Number(faMinLabour) : undefined,
      diamondHandlingRate: faDiaHandling ? Number(faDiaHandling) : undefined,
      cadCharge: faCad ? Number(faCad) : undefined,
      otherCharges: faOther ? Number(faOther) : undefined,
      metalByFactoryGrams: faMetalG ? Number(faMetalG) : undefined,
      metalByFactoryRate: faMetalRate ? Number(faMetalRate) : undefined,
    };
    // Labour per gram is charged on the whole piece, not only its gold. A
    // platinum or silver piece has no gold net weight, so charging on gold
    // alone silently dropped the per-gram labour from the factory's bill.
    const faOtherW = faOtherMetal.trim() ? (Number(faOtherNet) || 0) : 0;
    // Metal issued from stock as another material (platinum, silver) is in the piece too.
    const xG = faXGrams();
    const xIssues = faXIssues();
    const labourNet = Math.round(((hasNet ? netW : 0) + faOtherW + xG.metal) * 1000) / 1000;
    const labourVal = labourValue(labour, labourNet, usedDiaCt);
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
          await increaseStock({ material: "diamond", companyId: companyOf(i), purityOrQuality: i.purityOrQuality, quantity: delta, refType: "manual", createdBy: user!.id, note: `${delta}ct diamond returned on final approval for ${order.orderNumber}` });
        } else if (delta < 0) {
          await decreaseStockSelfHealing({ material: "diamond", companyId: companyOf(i), purityOrQuality: i.purityOrQuality, quantity: -delta, type: "issuance_out", refType: "materialIssuance", refId: i.id, createdBy: user!.id, note: `Diamond re-used (un-returned) on final approval edit for ${order.orderNumber}` }, db.stockMovements);
        }
      }
      // Other materials the same way: only what came out of our stock goes back to it, by the change.
      for (const i of xIssues) {
        if (i.source !== "stock") continue;
        const delta = Math.round((faXReturnedOf(i) - (i.finishReturnedQty || 0)) * 1000) / 1000;
        const u = materialUnit(db.settings, i.material), name = materialName(db.settings, i.material);
        if (delta > 0) {
          await increaseStock({ material: i.material, companyId: companyOf(i), purityOrQuality: i.purityOrQuality, quantity: delta, refType: "manual", createdBy: user!.id, note: `${delta}${u} ${name} returned on final approval for ${order.orderNumber}` });
        } else if (delta < 0) {
          await decreaseStockSelfHealing({ material: i.material, companyId: companyOf(i), purityOrQuality: i.purityOrQuality, quantity: -delta, type: "issuance_out", refType: "materialIssuance", refId: i.id, createdBy: user!.id, note: `${name} re-used (un-returned) on final approval edit for ${order.orderNumber}` }, db.stockMovements);
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
              id: uid("mi_"), factoryId, orderId: order.id, material: "gold", ...coField(workCo), purityOrQuality: karat,
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
            const retPcsRaw = (faDiaReturnedPcs[i.id] ?? "").trim();
            mi.finishReturnedPcs = retPcsRaw === "" ? undefined : Math.max(0, Math.round(Number(retPcsRaw) || 0));
            mi.finishDisposition = returned >= i.quantityIssued ? "returned" : "used";
            const usedCt = Math.round((i.quantityIssued - returned) * 1000) / 1000;
            mi.finishedPieces = [{ id: uid("fp_"), quantityUsed: usedCt, piecesCount: 1, recordedAt: now, recordedBy: user!.id }];
          }
        }
        // Every other material: what came back, and what stayed in the piece.
        for (const i of xIssues) {
          const mi = d.materialIssuances.find(x => x.id === i.id);
          if (!mi) continue;
          const returned = faXReturnedOf(i);
          mi.status = "closed";
          mi.finishReturnedQty = returned;
          const used = Math.round((i.quantityIssued - returned) * 1000) / 1000;
          mi.finishedPieces = [{ id: uid("fp_"), quantityUsed: used, piecesCount: 1, recordedAt: now, recordedBy: user!.id }];
        }
        // Two-tone: the second metal used in the finished piece.
        const otherW = parseFloat(faOtherNet);
        const otherP = parseFloat(faOtherPurity);
        o.otherMetal = faOtherMetal.trim() || undefined;
        o.otherMetalWeight = faOtherMetal.trim() && !isNaN(otherW) && otherW > 0 ? otherW : undefined;
        o.otherMetalPurity = faOtherMetal.trim() && !isNaN(otherP) && otherP > 0 ? otherP : undefined;

        // The diamond figure the factory’s bill is based on, and the difference
        // from what we issued, so the two ledgers can be reconciled later.
        o.factoryBillNo = faBillNo.trim() || undefined;
        o.actualDiamondWeight = usedDiaCt > 0 ? usedDiaCt : undefined;
        o.diamondWeightAdjust = diaAdjust !== 0 ? diaAdjust : undefined;
        // The piece's weights as this screen showed them: net = the gold, and
        // gross = gold + second metal + diamonds at 0.2 g a carat. Saved on the
        // order so the card, the band and every export read the same figures
        // instead of the estimate from the day it was ordered.
        if (hasNet) o.actualNetWeight = netW;
        const faGross = Math.round(((hasNet ? netW : 0) + faOtherW + xG.metal + xG.stone + usedDiaCt * CARAT_TO_GRAM) * 1000) / 1000;
        if (hasNet || faOtherW > 0 || xG.metal > 0) o.actualGrossWeight = faGross;
        const diaPcsN = Math.round(Number(faDiaPcs) || 0);
        o.actualDiamondPcs = diaPcsN > 0 ? diaPcsN : undefined;

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
      // A stock build raised before Final Approval existed has no such step, so
      // the actuals are recorded without one being marked complete.
      if (!alreadyDone && faIdx >= 0) await advanceStep(faIdx, true);
      toast.success(alreadyDone ? "Final details updated" : "Final approval saved");
      setFaIdx(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save final approval");
    } finally { setFaSaving(false); }
  };

  // Undo a stage marked complete by mistake — this stage becomes the current
  // (in-progress) one and every later stage is reset to not-done; the order
  // status is recomputed from what's left done.
  const revertStep = async (idx: number) => {
    if (!(await confirmBox("Undo this stage? This stage and any later ones will be marked not done, and the order status will update."))) return;
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
  // by both Reject and Cancel so a rejected order never strands material — and
  // now by the Orders list's Cancel too, so it lives in lib/orderCancel.ts.
  const returnIssuedMaterials = () => returnIssuedFor(order.id, user!);

  const approve = async (yes: boolean) => {
    if (!yes && !(await confirmBox("Reject this order? Any issued gold/diamond returns to stock and any advance paid moves to the client's credit. You can re-open it later if this was a mistake."))) return;
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
    toast.success(yes ? "Order approved" : "Order rejected — material returned & any advance moved to client credit");
  };

  // Undo an accidental reject — put the order back to Waiting for a fresh decision.
  const reopenOrder = async () => {
    if (!(await confirmBox("Re-open this rejected order back to Waiting?"))) return;
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      o.status = "Waiting";
      o.timeline.forEach((t, i) => { if (i > 0) { t.status = "pending"; t.date = undefined; } });
      o.timeline[0].status = "done";
      // Re-opening a Ready-Stock sale re-reserves the piece from inventory (it was
      // returned on cancel/reject).
      if (o.materialSourcing === "readyStock" && o.readyStockItemId) {
        const item = d.readyStock?.find(x => x.id === o.readyStockItemId);
        if (item) {
          const had = item.quantity;
          item.quantity = Math.max(0, item.quantity - 1);
          logItem(item, { ...whoOf(user), kind: "sold", text: `Order ${o.orderNumber} re-opened — sold on it again · ${had} → ${item.quantity}`, ref: { orderId: o.id } });
        }
      }
    });
    toast.success("Order re-opened — now Waiting");
  };

  // Cancel an order (admin) — returns any issued gold/diamond and certified
  // packets to stock, closes its issuances, and stops billing it (Rejected is
  // excluded from client totals). Re-openable afterwards. Refused once it has
  // been dispatched or billed (lib/orderGuards.ts says why) — the menu shows it
  // greyed with that reason, and the lib checks again as it runs.
  const cancelOrder = async () => {
    // Checked with the invoices and Ready Stock loaded — read before they
    // arrive, a billed order would look cancellable.
    const why = cancelAccess(user) ?? await cancelRefusal(order.id);
    if (why) { toast.error(why); return; }
    if (!(await confirmBox(cancelQuestion(order.orderNumber)))) return;
    setCancelling(true);
    try {
      await cancelOrderNow(order.id, user!);
      toast.success("Order cancelled — material returned & any advance moved to client credit");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel order");
    } finally { setCancelling(false); }
  };

  // The advance is billed in USD; the locker it lands in can hold any currency.
  // (The Settings rate as useSuggestedRate gives it — a hook can't sit after
  // this page's early return.)
  const advLockerCcy = ccy(db.lockers.find(l => l.id === advLockerId)?.currency);
  const advRate = advLockerCcy === "USD" ? undefined : tableRate(db.settings.currencyRates, "USD", advLockerCcy);
  // Picking a locker fills in what the advance comes to there — dollars as they
  // are, any other currency at the Settings rate — still typed over with what
  // actually landed. A figure already typed for a locker in the same currency is left alone.
  const pickAdvLocker = (v: string) => {
    const db0 = loadDb();
    const l = db0.lockers.find(x => x.id === v);
    const lc = ccy(l?.currency);
    setAdvLockerId(v);
    if (l && advLockerId && advLockerAmount && lc === advLockerCcy) return;
    const usd = parseFloat(advAmt) || 0;
    const rate = !l ? undefined : lc === "USD" ? 1 : tableRate(db0.settings.currencyRates, "USD", lc);
    setAdvLockerAmount(rate && usd > 0 ? String(roundCcy(usd * rate, lc)) : "");
  };

  const addAdvance = async () => {
    const amt = parseFloat(advAmt);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!advLockerId) { toast.error("Choose which locker this was deposited into"); return; }
    if (!advLockerAmount || Number(advLockerAmount) <= 0) { toast.error("Enter the amount actually deposited in that locker"); return; }
    let paidInFull = false;
    let isFirst = false;
    let toCredit = 0;
    // Ids are minted up front so the payment can be given its receipt number
    // straight after. Every payment is a numbered receipt from the moment it is
    // taken — nothing is left for a repair tool to pick up later.
    const advanceId = uid("adv_");
    const txnId = uid("ltx_");
    let applied = 0;
    const at = new Date().toISOString();
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      if (!o.advances) o.advances = [];
      // Never let a single order be paid beyond its balance — cap at the balance
      // and send the excess to the client's credit so it can clear other bills.
      const bal = balanceDue(o);
      applied = Math.min(amt, bal);
      toCredit = Math.round((amt - applied) * 100) / 100;
      isFirst = o.advances.length === 0;
      if (applied > 0) {
        // First payment on the order is the "advance"; every later collection is a
        // regular payment; the one that clears the balance is the "final payment".
        paidInFull = totalAdvance(o) + applied >= orderTotal(o);
        const defaultNote = paidInFull ? "Final Payment" : isFirst ? "Advance payment" : "Payment received";
        o.advances.push({
          id: advanceId, amount: applied, note: advNote || defaultNote, recordedBy: user!.id, createdAt: at,
          lockerId: advLockerId || undefined, lockerAmount: advLockerId ? Number(advLockerAmount) : undefined,
        });
        if (advLockerId) {
          const locker = d.lockers.find(l => l.id === advLockerId);
          if (locker) {
            if (!d.lockerTransactions) d.lockerTransactions = [];
            d.lockerTransactions.push({
              id: txnId, lockerId: advLockerId, type: "income", amountInr: Number(advLockerAmount),
              currency: ccy(locker.currency), category: `Client Payment — ${o.orderNumber}`,
              refType: "clientPayment", refId: o.id, recordedBy: user!.id, createdAt: at,
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
    let receiptNo = "";
    if (applied > 0) {
      try {
        const r = await receiptForAdvance({
          // The whole amount received: what went past this order's balance
          // is credit this receipt left, and comes back off if it is cancelled.
          clientId: order.clientId, advanceIds: [advanceId], amountUsd: amt,
          date: at, method: advNote || "Payment received",
          lockerTxnId: advLockerId ? txnId : undefined, userId: user!.id,
        });
        receiptNo = ` · ${r.receiptNo}`;
      } catch {
        // The money is recorded either way; only the number is missing, and
        // Settings can still hand it one.
        toast.error("Payment saved, but its receipt number could not be reserved");
      }
    }
    toast.success(
      toCredit > 0
        ? `Payment recorded${receiptNo} — ${fmtMoney(toCredit)} added to client credit`
        : paidInFull ? `Final payment recorded${receiptNo} — order paid in full`
        : isFirst ? `Advance payment recorded${receiptNo}` : `Payment recorded${receiptNo}`
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

  // ── Reference images ────────────────────────────────────────────────────
  // Often only thought of later — a diamond-only order has no CAD, and this is
  // the picture its card shows.
  const addRefImages = async (files: FileList) => {
    const incoming = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!incoming.length) { toast.error("Please choose image files"); return; }
    const room = Math.max(0, 3 - (order.images?.length ?? 0));
    if (room === 0) { toast.error("Up to 3 reference images — remove one first"); return; }
    setRefUploading(true);
    try {
      const urls = await Promise.all(incoming.slice(0, room).map(async f => uploadDataUrl(await compressImg(f), `orders/${order.id}`)));
      updateDb(d => {
        const o = d.orders.find(x => x.id === order.id)!;
        o.images = [...(o.images ?? []), ...urls];
      });
      toast.success(`${urls.length} reference image${urls.length !== 1 ? "s" : ""} added${room < incoming.length ? " · max 3" : ""}`);
    } catch { toast.error("Failed to upload images"); }
    setRefUploading(false);
  };
  const removeRefImage = async (src: string) => {
    if (!(await confirmBox("Remove this reference image?"))) return;
    updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.images = (o.images ?? []).filter(u => u !== src); });
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
      // These are what the client downloads, not a thumbnail for us, so the file
      // that was picked is uploaded as it is — what comes back is what went in.
      // Only something camera-sized is scaled. Capped at 900px before this, a
      // 1500×1500 shot reached the client as 900×900.
      const urls = await Promise.all(batch.map(async f =>
        canUploadOriginal(f)
          ? uploadFile(f, `orders/${order.id}/product`)
          : uploadDataUrl(await compressImg(f, PRODUCT_PHOTO_MAX, PRODUCT_PHOTO_QUALITY), `orders/${order.id}/product`)));
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

  /**
   * One picker for the whole shoot. Photos and a clip were two separate buttons,
   * so every piece meant choosing files twice — and the phone gallery offers
   * both side by side anyway. Whatever is picked is sorted here by what it is.
   */
  const addProductMedia = async (files: FileList) => {
    const picked = Array.from(files);
    const images = picked.filter(f => f.type.startsWith("image/"));
    const videos = picked.filter(f => f.type.startsWith("video/"));
    const other = picked.length - images.length - videos.length;
    if (!images.length && !videos.length) { toast.error("Choose photos or a video"); return; }
    if (other > 0) toast.warning(`${other} file${other !== 1 ? "s" : ""} skipped — only photos and video`);
    if (videos.length > 1) toast.warning("One video per piece — the first was used");
    if (images.length) {
      const dt = new DataTransfer();
      for (const f of images) dt.items.add(f);
      await addProductPhotos(dt.files);
    }
    if (videos.length) await addProductVideo(videos[0]);
  };

  // The client downloads these from Product Photos, and removing one deletes
  // the file itself — so it asks first.
  const removeProductPhoto = async (photoUrl: string) => {
    const n = (order.productPhotos ?? []).indexOf(photoUrl) + 1;
    if (!(await confirmBox([
      `Remove ${n ? `photo ${n}` : "this photo"} of ${order.orderNumber}?`,
      "",
      `The file is deleted — it disappears from this order and from Product Photos (design ${order.designNumber || order.orderNumber}), and the client can no longer download it. This cannot be undone.`,
    ].join("\n")))) return;
    updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.productPhotos = (o.productPhotos ?? []).filter(u => u !== photoUrl); });
    await deleteByUrl(photoUrl);
    toast.success("Photo removed");
  };

  const removeProductVideo = async () => {
    const videoUrl = order.productVideo;
    if (!videoUrl) return;
    if (!(await confirmBox(`Remove the product video of ${order.orderNumber}?\n\nThe file is deleted — it disappears from this order and from Product Photos, and the client can no longer download it. This cannot be undone.`))) return;
    updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.productVideo = undefined; });
    await deleteByUrl(videoUrl);
    toast.success("Video removed");
  };

  // Force a real download (Storage URLs otherwise open in a tab). Fetch the blob
  // and save it with a friendly filename; fall back to opening the URL on error.
  const downloadOne = async (fileUrl: string, filename: string) => {
    if (!exportAllowed()) return;
    try {
      const res = await fetch(fileUrl);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      logEvent("export", `Downloaded ${filename}`, { file: filename });
      setTimeout(() => URL.revokeObjectURL(obj), 4000);
    } catch { window.open(fileUrl, "_blank"); }
  };

  const downloadAllMedia = async () => {
    const design = (order.designNumber || order.orderNumber || "product").replace(/[^\w.-]+/g, "_");
    const files = (order.productPhotos ?? []).map((url, i) => ({ url, filename: `${design}-photo-${i + 1}.jpg` }));
    if (order.productVideo) files.push({ url: order.productVideo, filename: `${design}-video.mp4` });
    setDownloadingAll(true);
    try {
      // One archive rather than one save per file: a browser blocks the second
      // and later downloads as pop-ups, so the client got one photo and assumed
      // the rest were missing.
      const r = await downloadAsZip(files, design);
      if (!r.added) toast.error("Nothing could be downloaded — check the connection and try again");
      else if (r.failed.length) toast.warning(`${r.added} downloaded, ${r.failed.length} could not be fetched`);
      else toast.success(`${r.added} file${r.added !== 1 ? "s" : ""} downloaded as ${design}.zip`);
    } finally { setDownloadingAll(false); }
  };

  // The Starlink360 web viewer needs the file URL passed (encoded) as ?file=…
  const viewer360Url = order.cad3dmUrl
    ? `https://starlink360.vercel.app/?file=${encodeURIComponent(order.cad3dmUrl)}&embed=true`
    : "";

  /** The piece's weights as they will be once the Actual Details form is saved. */
  const actualWeightsAfter = () => {
    const keep = (typed: string, onFile: number | undefined) => {
      const n = parseFloat(typed);
      return !isNaN(n) && n > 0 ? n : onFile;
    };
    const finishNet = db.materialIssuances.find(i => i.orderId === order.id && i.material === "gold" && i.finishedNetWeight != null)?.finishedNetWeight;
    return {
      gross: keep(actGrossW, order.actualGrossWeight),
      net: keep(actNetW, order.actualNetWeight ?? finishNet),
      other: order.otherMetal ? order.otherMetalWeight : undefined,
      diamondCt: keep(actDiamW, order.actualDiamondWeight ?? (order.diamondWeight || undefined)),
    };
  };

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
    // A blank box keeps what is recorded, so check the weights as they will
    // stand after saving — a new net against the gross already on file too.
    const wp = weightProblem(actualWeightsAfter());
    if (wp) { toast.error(wp); return; }
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
      o.dispatchedAt = stampFor(dispatchDay);
      // If the parcel has already gone, correcting the date here corrects the
      // stage it was recorded against — the two must never disagree.
      const di = o.timeline.findIndex(t => t.step === "Dispatch");
      if (di >= 0 && o.timeline[di].status === "done") o.timeline[di] = { ...o.timeline[di], date: o.dispatchedAt };
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
    setDispatchDay(order.dispatchedAt ? dayOf(order.dispatchedAt) : todayLocal());
    setDispShipCost(EMPTY_SHIPPING_COST);
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
        o.dispatchedAt = stampFor(dispatchDay);
      });
      // …then complete the Dispatch step (runs the price/unpaid guard), dated
      // the day the parcel left rather than the day it was typed up.
      const advanced = await advanceStep(dispatchModalIdx, false, stampFor(dispatchDay));
      if (advanced) {
        // Only once it has really gone — a dispatch the price guard turned back
        // must not leave a freight bill behind it.
        updateDb(d => {
          recordShippingCost(d, [order.id], dispShipCost,
            { courierName, trackingNumber }, { id: user!.id }, stampFor(dispatchDay));
        });
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
  // Nothing is designed for a diamond-only order, so no CAD panel — even on an
  // older one whose stored timeline still has the stage.
  const showCadSection  = !diamondOnly && cadStepIdx >= 0 && order.timeline[cadStepIdx].status !== "pending";
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
        printBatchInvoice(orders, client, db.settings, existing.number, existing.createdAt.slice(0, 10), Object.fromEntries(orders.map(o => [o.id, mainDiamondShape(db, o.id) ?? ""])));
        return;
      }
      // Single-order invoice → keep its snapshot current, then print.
      if (existing.amount !== amount || existing.paid !== paid) {
        updateDb(d => { const i = d.invoices.find(x => x.id === existing.id); if (i) { i.amount = amount; i.paid = paid; } });
      }
      printInvoice(order, client, db.settings, existing.number, mainDiamondShape(db, order.id));
      return;
    }
    // Not billed yet. Printing must NEVER mint an invoice number — a real invoice
    // is only ever issued from Invoices → "Create invoice from dispatched orders".
    // (An order that was neither approved nor dispatched once got invoice 0002
    // purely because someone opened its bill from here.) Print a PROFORMA instead.
    printInvoice(order, client, db.settings, "", mainDiamondShape(db, order.id), true);
    toast.message("Proforma printed — no invoice number issued", {
      description: "The real invoice is created from Invoices → Create invoice from dispatched orders.",
    });
  };

  // In-house build → create a Ready Stock item pre-filled from this order. Admin
  // sets the selling price & cost in Ready Stock (cost basis mixes INR labour with
  // material, so it's entered there, not guessed here).
  const addToReadyStock = async (office: string) => {
    if (order.readyStockCreatedId) { nav(`/ready-stock/${order.readyStockCreatedId}`); return; }
    // The piece carries whatever weights it has. Without Final Approval those
    // are still the estimates it was ordered on, and a stock item is priced off
    // them — so say so rather than let an estimate pass as the real weight.
    if (!hasActuals && !(await confirmBox([
      "The factory's actual details have not been recorded for this piece.",
      "",
      "It will go into Ready Stock with the ESTIMATED weights, which is what its",
      "cost and price will then be worked out from.",
      "",
      "Record actual details first? Cancel to go back and do that.",
    ].join("\n")))) return;
    const itemId = uid("rs_");
    const imgs = [order.cadImage, ...(order.productPhotos || []), ...(order.images || [])].filter(Boolean).slice(0, 3) as string[];
    const pw = pieceWeights(order, db.materialIssuances);
    if (pw.problem) { toast.error(`Fix the weights first — ${pw.problem}`); return; }
    const diaWt = pw.diamondCt || undefined;
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
        grossWeight: pw.gross || undefined,
        netWeight: pw.net || undefined,
        diamondWeight: diaWt,
        diamondType: diaWt ? o.diamondType : undefined,
        price: 0, // admin sets the selling price in Ready Stock
        quantity: 1,
        images: imgs,
        sku: o.designNumber || undefined,
        location: office || undefined,
        notes: `Built in-house from order ${o.orderNumber}`,
        // The build's company — whose stock it was made from.
        ...coField(companyOfOrder(db, o)),
        createdBy: user!.id,
        createdAt: new Date().toISOString(),
        history: [{ at: new Date().toISOString(), ...whoOf(user), kind: "added", text: `Built in-house on order ${o.orderNumber}${office ? ` · at the ${officeLabel(office)}` : ""}`, ref: { orderId: o.id } }],
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

  // ── The ⋯ menus. Staff see every action; one that can't be used now is
  // greyed with the reason under it, never left out. A client's view has none.
  const isStaffUser = user!.role !== "client";
  const editWhy = orderEditAccess(db, user, can, order) ?? orderSpecLocks(db, order).all;
  const cancelWhy = cancelAccess(user) ?? cancelBlocker(db, order);
  const returnWhy = !mayReturn ? needsAccess("invoices", "edit") : returnBlocker(order);
  // Melt opens when the piece is a finished, made, unsold piece; its dialog
  // then says anything else in the way. Otherwise the plan's own reason.
  const meltWhy = (): string | undefined => {
    if (user!.role !== "admin") return "Only the admin can melt a piece";
    if (order.melted) return "Already melted";
    if (order.returns?.length || !hasActuals || isDiamondOnlyOrder(order) || order.materialSourcing === "readyStock" || order.readyStockCreatedId)
      return meltPlan(db, order).blocked ?? "Record the factory's actual details (Final Approval) first";
    return undefined;
  };
  const meltReason = meltWhy();
  const orderActions: MoreAction[] = [
    { label: "Edit details", icon: Pencil, hint: editWhy ?? "Type, metal, size, due date, instructions…", disabled: !!editWhy, onSelect: () => setEditOpen(true), show: isStaffUser },
    { label: "Print band", icon: Tag, hint: order.melted ? "Melted — the piece no longer exists" : !mayExport ? needsAccess("orders", "export") : "The barcode jewellery tag",
      disabled: !!order.melted || !mayExport, onSelect: () => setBandOpen(true),
      show: db.settings.barcodeBandEnabled !== false && isStaffUser },
    { label: "Return pieces", icon: Undo2, hint: returnWhy ?? "The client sent pieces back — credit note, pieces into Ready Stock", disabled: !!returnWhy, onSelect: () => setReturnOpen(true),
      show: isStaffUser },
    { label: "Melt", icon: Flame, danger: true, hint: meltReason ?? "Gold back to a factory or stock, stones back to stock", disabled: !!meltReason, onSelect: () => setMeltOpen(true),
      show: isStaffUser },
    { label: "Cancel order", icon: XCircle, danger: true, hint: cancelWhy ?? "Close it as rejected — it can be re-opened", onSelect: cancelOrder, disabled: cancelling || !!cancelWhy,
      show: isStaffUser },
    { label: "Delete", icon: Trash2, danger: true, hint: "Orders are never deleted — cancel instead", disabled: true, onSelect: () => undefined, show: isStaffUser },
  ];

  // A payment row: corrected or deleted as the receipt it came in on.
  const removePayment = async (a: (typeof advances)[number]) => {
    const { rec, why } = paymentReceipt(loadDb(), a);
    if (!rec) { toast.error(why ?? "No receipt to delete"); return; }
    // Said before asking: a receipt whose credit has been spent since, or whose
    // account entry can't be told apart from its neighbours, isn't cancelled.
    const stuck = receiptCancelBlocker(loadDb(), rec.id);
    if (stuck) { toast.error(stuck); return; }
    if (!(await confirmBox(`Delete this ${fmtMoney(a.amount)} payment — receipt ${rec.receiptNo}?\n\n${deleteImpact(loadDb(), rec.id).join("\n")}\n\nThis cannot be undone.`))) return;
    try {
      deleteReceipt(rec.id, user!.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this receipt");
      return;
    }
    toast.success(`Receipt ${rec.receiptNo} cancelled — the payment is off the order`);
  };
  const paymentActions = (a: (typeof advances)[number]): MoreAction[] => {
    const { rec, why } = paymentReceipt(db, a);
    const editBlock = !can("payments", "edit") ? needsAccess("payments", "edit") : orderPaymentEditBlocker(db, order, a);
    const delBlock = !can("payments", "delete") ? needsAccess("payments", "delete") : why ?? (rec ? receiptCancelBlocker(db, rec.id) : undefined);
    return [
      { label: "Edit", icon: Pencil, hint: editBlock ?? `Receipt ${rec?.receiptNo} — amount, day, note, account`, disabled: !!editBlock, onSelect: () => setEditingPayId(a.id) },
      { label: "Delete", icon: Trash2, danger: true, hint: delBlock ?? `Cancels receipt ${rec?.receiptNo} and its deposit`, disabled: !!delBlock, onSelect: () => removePayment(a) },
    ];
  };
  const editingPay = editingPayId ? advances.find(a => a.id === editingPayId) : undefined;

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-5">
      <Link to="/orders" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground -ml-0.5"><ArrowLeft className="h-4 w-4" />Back to Orders</Link>

      <div className="card-luxe p-0 overflow-hidden">
      {/* Order Header — the piece at a glance: its picture, where it stands,
          what it is, and who has it. */}
      {(() => {
        const heroImg = orderImage(order);
        const doneSteps = order.timeline.filter(t => t.status === "done").length;
        const pct = order.timeline.length ? Math.round(doneSteps / order.timeline.length * 100) : 0;
        const stage = order.timeline.find(t => t.status === "in_progress")?.step
          ?? [...order.timeline].reverse().find(t => t.status === "done")?.step ?? order.timeline[0]?.step ?? "";
        const open = !["Dispatched", "Delivered", "Rejected"].includes(order.status);
        const dayMs = 86400e3;
        const daysLeft = order.expectedDelivery ? Math.ceil((+new Date(order.expectedDelivery) - +new Date(todayLocal())) / dayMs) : null;
        const due = daysLeft === null || !open ? null
          : daysLeft < 0 ? { text: `${-daysLeft} day${daysLeft !== -1 ? "s" : ""} late`, tone: "bg-destructive/10 text-destructive ring-destructive/30" }
          : daysLeft <= 3 ? { text: daysLeft === 0 ? "due today" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`, tone: "bg-amber-500/10 text-amber-700 ring-amber-500/30" }
          : { text: `${daysLeft} days left`, tone: "bg-secondary text-muted-foreground ring-border/60" };
        return (
          <div className="relative p-5 sm:p-6 bg-gradient-to-br from-primary/[0.07] via-transparent to-brand-light/[0.09]">
            <div className="flex flex-col lg:flex-row lg:items-start gap-5">
              <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-2xl overflow-hidden bg-white ring-1 ring-border/60 shadow-sm shrink-0 grid place-items-center">
                {heroImg ? <img src={heroImg} alt={order.orderNumber} className="w-full h-full object-contain p-1" /> : <Package className="h-9 w-9 text-primary/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold tracking-wide text-muted-foreground">{order.orderNumber}</span>
                  <StatusBadge status={order.status} />
                  {order.priority && order.priority !== "Normal" && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700">{order.priority} priority</span>
                  )}
                  {order.melted && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive inline-flex items-center gap-1"><Flame className="h-3 w-3" />Melted</span>}
                  {user!.role !== "client" && <CompanyBadge id={companyOfOrder(db, order)} />}
                  {!!order.returns?.length && (() => {
                    const back = order.returns.reduce((s, r) => s + r.qty, 0), of = order.quantity || 1;
                    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />{back >= of ? "Returned" : `${back} of ${of} returned`}</span>;
                  })()}
                </div>
                <h1 className="font-display text-[26px] sm:text-[30px] leading-[1.15] text-brand-dark mt-1.5 break-words">{order.jewelleryType} in {order.metal}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {order.forReadyStock ? "🏭 Ready Stock (in-house build)" : client ? <span className="font-medium text-foreground/80">{client.companyName}</span> : null}
                  {order.materialSourcing === "readyStock" ? (() => {
                    const it = order.readyStockItemId ? db.readyStock.find(i => i.id === order.readyStockItemId) : undefined;
                    return ` · 💎 Sold from Ready Stock${it && officeOf(it) ? ` — ${officeLabel(officeOf(it))}` : ""}`;
                  })() : ""}
                  {order.contactPerson ? ` · ${order.contactPerson}` : ""}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-card ring-1 ring-border/60 text-xs">
                    <CalendarClock className="h-3.5 w-3.5 text-primary" /> Due <span className="font-semibold text-brand-dark">{fmtDate(order.expectedDelivery)}</span>
                    {due && <span className={`ml-1 px-1.5 py-0.5 rounded-full ring-1 text-[10px] font-semibold ${due.tone}`}>{due.text}</span>}
                  </span>
                  {order.designNumber && (
                    <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-card ring-1 ring-border/60 text-xs">
                      <Hash className="h-3.5 w-3.5 text-primary" /> Design <span className="font-semibold text-brand-dark">{order.designNumber}</span>
                    </span>
                  )}
                  {order.diamondWeight > 0 && (
                    <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-card ring-1 ring-border/60 text-xs">
                      <Gem className="h-3.5 w-3.5 text-sky-600" /> <span className="font-semibold text-brand-dark">{order.diamondWeight} ct</span> {order.diamondType}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-card ring-1 ring-border/60 text-xs">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" /> Placed <span className="font-semibold text-brand-dark">{fmtDate(order.createdAt)}</span>
                  </span>
                </div>
              </div>
              {/* One main action as a button; the rest in the ⋯ menu beside it —
                  the same sizes as every page header, one row on a phone. */}
              <div className="flex items-center gap-2 lg:justify-end shrink-0 max-sm:w-full">
                {order.forReadyStock
                  ? (user!.role === "admin" && (
                      order.readyStockCreatedId
                        ? <Button onClick={() => nav(`/ready-stock/${order.readyStockCreatedId}`)} className="btn-hero h-10 rounded-xl px-4 gap-2 max-sm:flex-1"><PackageCheck className="h-4 w-4" />In Ready Stock ✓</Button>
                        : <Button onClick={() => { let o = ""; try { o = localStorage.getItem("rs-build-office") || ""; } catch { /* ignore */ } const list = readyStockOffices(db.settings); setRsOffice(list.includes(o) ? o : list[0] ?? ""); }} className="btn-hero h-10 rounded-xl px-4 gap-2 max-sm:flex-1"><PackageCheck className="h-4 w-4" />Add to Ready Stock</Button>
                    ))
                  : (order.status !== "Rejected" || findInvoiceForOrder(db.invoices, order.id)) && <IfExport><Button onClick={handlePrintInvoice} className="btn-hero h-10 rounded-xl px-4 gap-2 max-sm:flex-1"><Printer className="h-4 w-4" />{findInvoiceForOrder(db.invoices, order.id) ? "Print / Download Bill" : "Proforma Bill"}</Button></IfExport>}
                <MoreMenu title="This order" actions={orderActions} />
              </div>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                {order.status === "Rejected"
                  ? <span className="font-semibold text-destructive">Order closed — {order.melted ? "melted" : "rejected"}</span>
                  : <span className="text-muted-foreground">Now: <span className="font-semibold text-brand-dark">{stage}</span></span>}
                <span className="tabular-nums text-muted-foreground">
                  {order.status === "Rejected"
                    ? <>stopped at {doneSteps} of {order.timeline.length} stages</>
                    : <><span className="font-semibold text-brand-dark">{pct}%</span> · {doneSteps} of {order.timeline.length} stages</>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${order.status === "Rejected" ? "bg-destructive/45" : "bg-gradient-to-r from-primary to-brand-light"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        );
      })()}

        {/* Details, grouped: the piece · its stones and weight · people and dates. */}
        <div className="p-5 sm:p-6 border-t border-border/60 grid gap-5 sm:gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3"><Package className="h-3.5 w-3.5 text-primary" /> The piece</p>
            <div className="grid grid-cols-2 gap-2">
              <OrderSpec label="Type" value={order.jewelleryType} />
              <OrderSpec label="Metal" value={order.metal} />
              <OrderSpec label="Karats" value={order.productKarats} />
              <OrderSpec label="Color" value={order.productColor} />
              <OrderSpec label="Quantity" value={`${order.quantity} pcs`} />
              <OrderSpec label="Rhodium" value={order.rhodium} />
              <OrderSpec label="Product size" value={order.productSize} wide />
              <OrderSpec label="Stamping" value={order.stamping} wide />
              <OrderSpec label="Delivery time" value={order.deliveryTime} wide />
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3"><Gem className="h-3.5 w-3.5 text-sky-600" /> Stones &amp; weight</p>
            <div className="grid grid-cols-2 gap-2">
              <OrderSpec label="Est. diamonds" value={`${order.diamondWeight} ct`} />
              <OrderSpec label="Diamond type" value={order.diamondType} />
              <OrderSpec label="Est. gross weight" value={order.estimatedGrossWeight ? `${order.estimatedGrossWeight} g` : undefined} />
              <OrderSpec label="Est. net weight" value={order.estimatedNetWeight ? `${order.estimatedNetWeight} g` : undefined} />
              <OrderSpec label="Actual net weight" value={order.actualNetWeight ? `${order.actualNetWeight} g` : undefined} />
              <OrderSpec label="Actual diamonds" value={order.actualDiamondWeight ? `${order.actualDiamondWeight} ct` : undefined} />
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3"><UserRound className="h-3.5 w-3.5 text-primary" /> People &amp; dates</p>
            <div className="grid grid-cols-2 gap-2">
              {/* Design Number — editable inline (staff), and addable when missing */}
              <div className="col-span-2 rounded-xl bg-secondary/40 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Design number</p>
                {editDesign !== null ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Input
                      value={editDesign}
                      autoFocus
                      onChange={e => setEditDesign(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveDesignNumber(); if (e.key === "Escape") setEditDesign(null); }}
                      placeholder="e.g. LR-1418"
                      className="h-8 rounded-lg text-sm"
                    />
                    <button onClick={saveDesignNumber} className="h-8 px-2.5 rounded-lg btn-hero text-xs font-medium shrink-0">Save</button>
                    <button onClick={() => setEditDesign(null)} className="h-8 w-8 rounded-lg border border-border grid place-items-center text-muted-foreground shrink-0"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-brand-dark mt-0.5 flex items-center gap-1.5">
                    {order.designNumber || <span className="text-muted-foreground italic font-normal">—</span>}
                    {canEditStage() && (
                      <button
                        onClick={() => setEditDesign(order.designNumber ?? "")}
                        title="Edit design number"
                        className="h-6 w-6 rounded grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </p>
                )}
              </div>
              <OrderSpec label="Priority" value={order.priority} />
              <OrderSpec label="Delivery date" value={fmtDate(order.expectedDelivery)} />
            </div>
            <div className="mt-2"><AssignOrderField order={order} /></div>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-5 sm:pb-6">

        {/* ── Pricing — set/edited by admin & employee only, never by the client ── */}
        {user!.role !== "client" && (
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Order Value</p>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <p className={`font-semibold text-lg tabular-nums ${order.amount ? "text-brand-dark" : "text-muted-foreground italic font-medium text-base"}`}>
                      {order.amount ? fmtMoney(order.amount) : "Pricing pending"}
                    </p>
                    {returnedCredit(order) > 0 && <span className="text-xs font-medium text-amber-800">−{fmtMoney(returnedCredit(order))} returned</span>}
                    {/* Its invoice, in green, right beside the price — or plainly none. */}
                    {(() => {
                      const inv = findInvoiceForOrder(db.invoices, order.id);
                      if (inv || needsInvoice(order)) return <InvoiceBadge invoice={inv} dispatched={needsInvoice(order)} size="md" onOpen={n => nav(`/invoices?q=${encodeURIComponent(n)}`)} />;
                      return order.forReadyStock ? null : <span className="text-[11px] font-medium px-2 py-1 rounded-lg bg-secondary text-muted-foreground">Not invoiced yet</span>;
                    })()}
                  </div>
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

        {/* Reference images — staff can add them after the order was placed */}
        {((order.images?.length ?? 0) > 0 || (user!.role !== "client" && canEditStage() && !order.melted)) && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">Reference Images</p>
            <div className="flex gap-2 flex-wrap">
              {(order.images ?? []).map((src, i) => (
                <div key={src} className="relative group">
                  <button type="button" onClick={() => setLightboxSrc(src)}
                    className="h-20 w-20 rounded-xl overflow-hidden border border-border hover:border-primary/50 transition-colors relative block">
                    <img src={src} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Eye className="h-4 w-4 text-white" />
                    </div>
                  </button>
                  {user!.role !== "client" && canEditStage() && (
                    <button type="button" onClick={() => removeRefImage(src)} aria-label="Remove reference image"
                      className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-destructive text-white grid place-items-center shadow-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {user!.role !== "client" && canEditStage() && !order.melted && (order.images?.length ?? 0) < 3 && (
                <button type="button" onClick={() => refImageRef.current?.click()} disabled={refUploading}
                  className="h-20 w-20 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground disabled:opacity-60">
                  {refUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  <span className="text-[10px] font-medium">{refUploading ? "Uploading…" : "Add image"}</span>
                </button>
              )}
              <input ref={refImageRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => { if (e.target.files?.length) addRefImages(e.target.files); e.target.value = ""; }} />
            </div>
          </div>
        )}

        {(order.instructions || (isStaffUser && !editWhy)) && (
          <div className="mt-4 p-3 rounded-xl bg-secondary text-sm">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-xs text-muted-foreground">Special Instructions</p>
              {/* Changed with the rest of the details, in the side panel. */}
              {isStaffUser && (
                <button type="button" onClick={() => (editWhy ? toast.error(editWhy) : setEditOpen(true))} title={editWhy ?? "Edit the instructions and other details"}
                  aria-label="Edit instructions" aria-disabled={!!editWhy}
                  className={`h-6 w-6 rounded grid place-items-center text-muted-foreground shrink-0 ${editWhy ? "opacity-40 cursor-not-allowed" : "hover:text-primary hover:bg-primary/10"}`}>
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            {order.instructions || <span className="text-muted-foreground italic">None yet — add them with Edit details.</span>}
          </div>
        )}

        {canEditStage() && order.status === "Waiting" && (
          <div className="mt-5 flex gap-3">
            <AsyncButton onClick={() => approve(true)} className="btn-hero rounded-xl">Approve Order</AsyncButton>
            <AsyncButton variant="outline" onClick={() => approve(false)} className="rounded-xl">Reject</AsyncButton>
          </div>
        )}
        <OrderReturns order={order} />
        {order.melted && user!.role !== "client" && (() => {
          const m = order.melted;
          const fac = db.factories.find(f => f.id === m.gold?.factoryId)?.name;
          const ct = Math.round(m.diamonds.reduce((s, x) => s + x.ct, 0) * 1000) / 1000;
          return (
            <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1">
              <p className="font-semibold text-destructive flex items-center gap-1.5"><Flame className="h-4 w-4" /> Melted {fmtDate(m.at)} by {m.byName}{m.reason ? ` — ${m.reason}` : ""}</p>
              <p className="text-xs text-muted-foreground">
                {m.gold ? `${m.gold.grams} g ${m.gold.purity} gold ${m.gold.to === "factory" ? `to ${fac ?? "the factory"} (its pool)` : "into our stock"}` : "No gold kept"}
                {ct > 0 ? ` · ${ct} ct loose diamonds back in stock` : ""}
                {m.packetIds.length ? ` · ${m.packetIds.length} certified packet${m.packetIds.length !== 1 ? "s" : ""} back in stock` : ""}
                {` · labour ₹${m.labourInr.toLocaleString("en-IN")} stays owed to the factory`}
                {m.chargeInr ? ` · melting charge ₹${m.chargeInr.toLocaleString("en-IN")} owed to ${db.factories.find(f => f.id === m.meltedBy)?.name ?? "the factory"}` : ""}
                {m.advanceToCredit ? ` · ${fmtMoney(m.advanceToCredit)} advance moved to the client's credit` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground">It can't be re-opened — place a new order to make it again.</p>
            </div>
          );
        })()}
        {canEditStage() && order.status === "Rejected" && !order.melted && (
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-destructive font-medium">This order was rejected.</span>
            <AsyncButton variant="outline" onClick={reopenOrder} className="rounded-xl gap-2">
              <RotateCcw className="h-4 w-4" /> Re-open to Waiting
            </AsyncButton>
          </div>
        )}
        </div>
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

          {/* Weights already on file that contradict each other — recorded
              before these checks existed, or put out of step by a later edit. */}
          {(() => {
            const wp = pieceWeights(order, db.materialIssuances).problem;
            return wp && user!.role !== "client" ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <span className="font-semibold">Check the weights:</span> {wp}
              </p>
            ) : null;
          })()}

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
                    <WeightCheck className="mt-2" {...actualWeightsAfter()} />
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
            <SectionTitle icon={ImagePlus} title="CAD Design" sub={order.cadImage ? "On file · the client sees it" : "Not uploaded yet"} />
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
            <SectionTitle icon={Truck} title="Dispatch Details" />
            {canEditStage() && (
              <Button size="sm" variant="outline" onClick={() => {
                setCourierName(order.courierName ?? "");
                setTrackingNumber(order.trackingNumber ?? "");
                setTrackingLink(order.trackingLink ?? "");
                setDispatchDay(order.dispatchedAt ? dayOf(order.dispatchedAt) : todayLocal());
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
              {order.dispatchedAt && (
                <div className="p-4 rounded-xl bg-secondary">
                  <p className="text-xs text-muted-foreground mb-1">Dispatched On</p>
                  <p className="font-semibold">{fmtDate(order.dispatchedAt)}</p>
                </div>
              )}
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
                    <div className="space-y-1.5">
                      <Label className="text-xs">Dispatch Date</Label>
                      <Input
                        type="date"
                        value={dispatchDay}
                        max={todayLocal()}
                        onChange={e => setDispatchDay(e.target.value)}
                        className="rounded-xl h-10"
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
            <SectionTitle icon={Camera} title="Product Photography"
              sub={hasProductMedia ? `${order.productPhotos?.length ?? 0} photo${(order.productPhotos?.length ?? 0) !== 1 ? "s" : ""}${order.productVideo ? " + 1 video" : ""}` : "None yet"} />
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
                    ref={productPhotoRef} type="file" accept="image/*,video/*" multiple className="hidden"
                    onChange={async e => { if (e.target.files?.length) await addProductMedia(e.target.files); e.target.value = ""; }}
                  />
                  <Button size="sm" variant="outline" onClick={() => productPhotoRef.current?.click()}
                    disabled={photoUploading || videoUploading} className="rounded-xl gap-2">
                    <Camera className="h-4 w-4" />
                    {photoUploading || videoUploading ? "Uploading…" : order.productVideo ? "Add Photos / Replace Video" : "Add Photos & Video"}
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
                <video src={order.productVideo} controls muted playsInline preload="metadata" className="w-full max-h-80 mx-auto" />
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
              Add 4–5 photos and a short video. The client finds them under design <span className="font-medium text-foreground">{order.designNumber || order.orderNumber}</span>.
            </div>
          )}
        </div>
      )}

      {/* ── Cost & Profit — the admin's eyes only. Employees can open this
          page, and the client portal renders it too, so the gate is the role
          itself, never the page. */}
      {user!.role === "admin" && <OrderProfitCard db={db} order={order} />}

      {/* ── Advance Payment Card ── */}
      <div className="card-luxe p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <SectionTitle icon={Wallet} title="Payments"
            sub={<>{advances.length} payment{advances.length !== 1 ? "s" : ""}{advances.length > 0 && balance <= 0 && <span className="text-success font-medium"> · Paid in full</span>}</>} />
          {canEditStage() && balance > 0 && (user!.role === "admin" || can("payments", "add")) && (
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
          const returned = returnedCredit(order);
          const extraCols = (shipping > 0 ? 1 : 0) + (certFee > 0 ? 1 : 0) + (returned > 0 ? 1 : 0);
          // Three base tiles (Order Value, Total Paid, Balance Due) + optional
          // Shipping/Certificate — one tile per column so they sit on ONE row.
          const totalCols = 3 + extraCols;
          const gridCols = totalCols <= 3 ? "sm:grid-cols-3" : totalCols === 4 ? "sm:grid-cols-4" : totalCols === 5 ? "sm:grid-cols-5" : "sm:grid-cols-6";
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
              {returned > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Returned</p>
                  <p className="font-semibold text-sm text-amber-800">−{fmtMoney(returned)}</p>
                </div>
              )}
              <div className="p-3 rounded-xl bg-success/8 border border-success/20 text-center">
                <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                <p className="font-semibold text-sm text-success">{fmtMoney(advTotal)}</p>
              </div>
              <div className={`p-3 rounded-xl text-center border ${balance > 0 ? "bg-destructive/5 border-destructive/20" : orderTotal(order) <= 0 ? "bg-secondary border-border/40" : "bg-success/8 border-success/20"}`}>
                <p className="text-xs text-muted-foreground mb-1">Balance Due</p>
                <p className={`font-semibold text-sm ${balance > 0 ? "text-destructive" : orderTotal(order) <= 0 ? "text-muted-foreground" : "text-success"}`}>
                  {balance > 0 ? fmtMoney(balance) : orderTotal(order) <= 0 ? (returned > 0 ? "Nothing due" : "Pricing pending") : "✓ Cleared"}
                </p>
              </div>
              {(shipping > 0 || certFee > 0 || returned > 0) && (
                <div className={`col-span-2 ${gridCols.replace("sm:grid-cols-", "sm:col-span-")} px-1 pt-0.5 text-xs text-muted-foreground`}>
                  Order Total: <span className="font-semibold text-foreground">{fmtMoney(total)}</span>
                  {certFee > 0 && <span className="ml-1 text-amber-600">(incl. {fmtMoney(certFee)} certificate fee)</span>}
                  {returned > 0 && <span className="ml-1 text-amber-800">(after {fmtMoney(returned)} returned)</span>}
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
          const giftPct = giftMaxRedeemPctFor(db, client);
          const maxR = card ? maxGiftRedeem(order, card, db.orders, giftPct) : 0;
          return (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Gift className="h-4 w-4 text-primary shrink-0" />
                {applied > 0
                  ? <p className="text-sm"><span className="font-semibold text-primary">{fmtMoney(applied)}</span> gift card applied to this order</p>
                  : <p className="text-sm text-muted-foreground">Gift card available — apply up to <span className="font-semibold text-foreground">{fmtMoney(maxR)}</span> ({Math.round(giftPct * 100)}% of order)</p>}
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
                    <Select value={advLockerId} onValueChange={addNew("locker", pickAdvLocker)}>
                      <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose a locker" /></SelectTrigger>
                      <SelectContent>
                        {db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>)}
                      <AddNewItem kind="locker" /></SelectContent>
                    </Select>
                  </div>
                  {advLockerId && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Amount Deposited ({ccySymbol(advLockerCcy).trim()})</Label>
                      <Input type="number" min={0} step="0.01" value={advLockerAmount} onChange={e => setAdvLockerAmount(e.target.value)} className="rounded-xl h-10" />
                      {advRate && parseFloat(advAmt) > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {fmtMoney(parseFloat(advAmt))} at {rateText("USD", advLockerCcy, advRate)} is {fmtCcy(roundCcy(parseFloat(advAmt) * advRate, advLockerCcy), advLockerCcy)} — enter what actually landed.
                        </p>
                      )}
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
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="font-semibold text-success">{fmtMoney(a.amount)}</p>
                    {/* Staff: correct or delete it as its receipt; why not, when it can't be. */}
                    {isStaffUser && <MoreMenu size="sm" label="Payment actions" title={paymentReceipt(db, a).rec ? `Receipt ${paymentReceipt(db, a).rec!.receiptNo}` : "This payment"} actions={paymentActions(a)} />}
                  </div>
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

      {/* Production Timeline. A diamond-only order is not produced, so it shows
          only the stages it really has — order, dispatch, delivery. */}
      <div className="card-luxe p-6">
        <SectionTitle className="mb-5" title={diamondOnly ? "Order Progress" : "Production Timeline"} />
        <div className="relative pl-8 space-y-4">
          <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-border" />
          {shownSteps.map(({ t, i: idx }, n) => {
            const isDone = t.status === "done";
            // With the production stages hidden, the stored in_progress flag can
            // be sitting on one of them — so the active stage is simply the
            // first one still to do.
            const isActive = !isDone && (diamondOnly
              ? shownSteps.findIndex(s => s.t.status !== "done") === n
              : t.status === "in_progress");
            const emp = db.users.find(u => u.id === t.employeeId);
            return (
              <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }} className="relative">
                <div className={`absolute -left-8 top-0.5 h-6 w-6 rounded-full grid place-items-center border-2 ${isDone ? "bg-success border-success text-white" : isActive ? "bg-primary border-primary text-white animate-pulse" : "bg-white border-border text-muted-foreground"}`}>
                  {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-2 w-2" />}
                </div>
                <div className={`p-3 rounded-xl border ${isActive ? "border-primary bg-primary/5" : isDone ? "border-success/30 bg-success/5" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className={`font-medium text-sm ${isDone || isActive ? "text-foreground" : "text-muted-foreground"}`}>{t.step}</p>
                    {t.date && <span className="text-xs text-muted-foreground">{new Date(t.date).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}</span>}
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
                          : t.step === "Delivered"
                            ? <AsyncButton size="sm" variant="outline" onClick={() => { setDeliverDay(order.deliveredAt ? dayOf(order.deliveredAt) : todayLocal()); setDeliverModalIdx(idx); }} className="mt-2 h-7 rounded-lg text-xs">Mark complete</AsyncButton>
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
            <SectionTitle title={diamondOnly ? "Diamond" : "Manufacturing"}
              sub={diamondOnly ? "Bought for this order — nothing is made"
                : order.materialSourcing === "stock" ? "Plan: use from stock"
                : order.materialSourcing === "purchase" ? "Plan: buy new for this order"
                : "No sourcing plan"} />
          </div>

          {/* Diamond-only: nothing to assign, estimate or approve — just buy
              the stones the order is for. */}
          {diamondOnly && canEditStage() && !showBuyForm && (
            <Button variant="outline"
              onClick={() => { setShowBuyForm(true); setShowIssueForm(false); setShowDiamond(false); allBuyLinesDiamond(); }}
              className="rounded-xl h-10 gap-2 w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Buy Diamond for this order
            </Button>
          )}

          {/* Stage ① — Assign the factory and quote an estimate before the piece is made. */}
          {!diamondOnly && (
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-brand-dark shrink-0">{faDone ? "Manufacturing (actual)" : "① Assign & Estimate"}</span>
                <Select disabled={!canEditStage()} value={order.assignedFactoryId || "__none"} onValueChange={addNew("factory", v => assignFactory(v === "__none" ? "" : v))}>
                  <SelectTrigger className="h-8 w-52 rounded-lg text-xs"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not assigned</SelectItem>
                    {db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  <AddNewItem kind="factory" /></SelectContent>
                </Select>
              </div>
              {canEditStage() && faStepIdx < 0 && (
                <Button size="sm" variant="outline" onClick={() => openFinalApproval(-1)} className="rounded-lg h-8 gap-1.5 text-xs">
                  {hasActuals ? "Edit actual details" : "Record actual details"}
                </Button>
              )}
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
                <span className="font-semibold text-amber-700">{factoryFineGoldBalance(db.materialIssuances, order.assignedFactoryId, db.factories.find(f => f.id === order.assignedFactoryId)?.openingFineGold).toLocaleString()} g fine (24KT)</span>
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
                    {order.factoryBillNo && (
                      <span>Factory bill: <span className="font-semibold text-foreground font-mono">{order.factoryBillNo}</span></span>
                    )}
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
                  {/* The figure the factory bills handling on — their scale, not
                      ours — with the stone count from the same bill. Editable here
                      so it can be set without reopening Final Approval. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1.5 mt-1 border-t border-border/50">
                    <span className="text-muted-foreground">Total diamond weight:</span>
                    {canEditStage() ? (
                      <Input type="number" step="0.001" min={0} value={diaTotW}
                        onChange={e => setDiaTotW(e.target.value)} onBlur={saveDiamondTotals}
                        className="h-7 w-24 rounded-lg text-xs" placeholder="ct" />
                    ) : (
                      <span className="font-semibold text-foreground">{order.actualDiamondWeight ? `${order.actualDiamondWeight} ct` : "—"}</span>
                    )}
                    <span className="text-muted-foreground">Total diamond pcs:</span>
                    {canEditStage() ? (
                      <Input type="number" step="1" min={0} value={diaTotPcs}
                        onChange={e => setDiaTotPcs(e.target.value)} onBlur={saveDiamondTotals}
                        className="h-7 w-20 rounded-lg text-xs" placeholder="pcs" />
                    ) : (
                      <span className="font-semibold text-foreground">{order.actualDiamondPcs ?? "—"}</span>
                    )}
                    {issuedDiaCt > 0 && (
                      <span className="text-[11px] text-muted-foreground">issued {issuedDiaCt} ct</span>
                    )}
                  </div>
                  {hasActuals && (
                    <p className="font-bold text-destructive pt-1">Job finish — the factory’s actual details are recorded</p>
                  )}
                </div>
              );
            })() : (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Est. gross: <span className="font-semibold text-foreground">{order.estimatedGrossWeight ? `${order.estimatedGrossWeight} g` : "—"}</span></span>
                <span>Est. net (gold): <span className="font-semibold text-foreground">{(order.estimatedNetWeight || order.metalWeight) ? `${order.estimatedNetWeight || order.metalWeight} g` : "—"}</span></span>
                <span>Est. diamond: <span className="font-semibold text-foreground">{order.diamondWeight ? `${order.diamondWeight} ct` : "—"}</span></span>
                <span>Est. making: <span className="font-semibold text-foreground">{order.estimatedMakingCharges != null ? fmtMoney(order.estimatedMakingCharges) : "—"}</span></span>
              </div>
            ))}

            {/* Estimate editor */}
            {showEstimate && !faDone && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <Label className="text-[11px]">Est. Gross Weight (g)</Label>
                  <Input type="number" min={0} step="0.001" value={estGold} onChange={e => setEstGold(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <div>
                  <Label className="text-[11px]">Est. Net Weight — gold (g)</Label>
                  <Input type="number" min={0} step="0.001" value={estNet} onChange={e => setEstNet(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <div>
                  <Label className="text-[11px]">Est. Diamond (ct)</Label>
                  <Input type="number" min={0} step="0.01" value={estDia} onChange={e => setEstDia(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <div>
                  <Label className="text-[11px]">Est. Making Charge ($)</Label>
                  <Input type="number" min={0} step="0.01" value={estMaking} onChange={e => setEstMaking(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="0" />
                </div>
                <WeightCheck className="col-span-2 sm:col-span-4" gross={Number(estGold)} net={Number(estNet)} diamondCt={Number(estDia || order.diamondWeight)} />
                <div className="col-span-2 sm:col-span-4 flex justify-end">
                  <Button size="sm" onClick={saveEstimate} className="btn-hero rounded-lg h-9 gap-1.5 text-xs">Save Estimate</Button>
                </div>
              </div>
            )}

            {/* ② Diamond — from our stock, or buy new. (Gold stays reserved at the factory.) */}
            {canEditStage() && !faDone && !diamondOnly && order.noDiamond && (
              <div className="pt-3 border-t border-border/50 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-brand-dark">② Diamond</span>
                <span className="text-xs text-muted-foreground">Gold only — no diamond in this piece.</span>
                <button type="button" onClick={() => setNoDiamond(false)} className="text-xs text-primary hover:underline">
                  this piece does have diamond
                </button>
              </div>
            )}
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
                        else { setShowBuyForm(true); setShowIssueForm(false); allBuyLinesDiamond(); }
                      }}
                      className={`h-7 px-3 rounded-md text-xs font-medium transition-colors ${showDiamond && diaSource === s ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
                      {s === "stock" ? "From Stock" : "Buy New"}
                    </button>
                  ))}
                </div>
                {showDiamond && (
                  <button type="button" onClick={() => { setShowDiamond(false); setShowIssueForm(false); setShowBuyForm(false); }} className="text-xs text-muted-foreground underline">cancel</button>
                )}
                {/* Some pieces are plain gold. Saying so is a third answer to
                    "where is the diamond coming from", not an override. */}
                {!diamondOnly && (
                  <button type="button" onClick={() => setNoDiamond(true)}
                    className="text-xs text-primary hover:underline ml-auto">
                    No diamond in this piece
                  </button>
                )}
              </div>
            )}
            {/* ③ Anything else the piece uses — platinum, a gemstone, a lock (Settings → Materials). */}
            {canEditStage() && !faDone && otherMaterials.length > 0 && (
              <div className="pt-3 border-t border-border/50 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-brand-dark">③ Other material</span>
                <span className="text-xs text-muted-foreground">{otherMaterials.map(m => m.name).slice(0, 4).join(", ")}{otherMaterials.length > 4 ? "…" : ""}</span>
                <button type="button"
                  onClick={() => {
                    if (!order.assignedFactoryId) { toast.error("Choose the factory first"); return; }
                    setShowIssueForm(true); setShowBuyForm(false); setShowDiamond(false);
                    setIssueMaterial(otherMaterials[0].id); setIssueGrade(""); setIssueFactoryId(order.assignedFactoryId);
                  }}
                  className={`h-7 px-3 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/70 ${showIssueForm && isOtherMaterial(issueMaterial) ? "ring-2 ring-primary/30 text-brand-dark" : "text-muted-foreground"}`}>
                  From Stock
                </button>
              </div>
            )}
          </div>
          )}

          {!diamondOnly && (
          <div className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium ${readiness.ready ? "bg-success/8 text-success" : "bg-destructive/5 text-destructive"}`}>
            {readiness.ready ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {readiness.ready
              ? "Ready for Final Approval — factory assigned and diamond sourced"
              : `Final Approval blocked — ${readiness.missing.includes("gold") && !order.assignedFactoryId ? "assign a factory" : ""}${readiness.missing.includes("gold") && !order.assignedFactoryId && readiness.missing.includes("diamond") ? " and " : ""}${readiness.missing.includes("diamond") ? "add the diamond (from stock or buy)" : ""} first`}
          </div>
          )}

          {showBuyForm && (
            <div className="pt-2 border-t border-border/60 space-y-3">
              <p className="text-sm font-medium text-brand-dark">Buy for {order.orderNumber}</p>
              <p className="text-xs text-muted-foreground -mt-1">
                {diamondOnly
                  ? "Held against this order and billed to the supplier — no factory involved."
                  : `Goes straight to ${db.factories.find(f => f.id === order.assignedFactoryId)?.name || "the assigned factory"} and is billed to the supplier.`}
              </p>
              {buyBills.map((bill, bi) => {
                const linesInr = billLinesTotalInr(bill);
                const roInr = billRoundOffInr(bill);
                const supplierName = db.suppliers.find(s => s.id === bill.supplierId)?.name;
                return (
                <div key={bill.key} className="rounded-2xl border border-primary/25 bg-primary/[0.02] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      {buyBills.length > 1 ? `Bill ${bi + 1}` : "Supplier's bill"}{supplierName ? ` · ${supplierName}` : ""}
                    </p>
                    {buyBills.length > 1 && (
                      <button type="button" onClick={() => removeBuyBill(bi)} className="text-[11px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                        <X className="h-3.5 w-3.5" /> Remove this bill
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Select value={bill.supplierId} onValueChange={addNew("supplier", v => updateBill(bi, { supplierId: v }))}>
                      <SelectTrigger className="h-10 rounded-xl bg-white"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                      <SelectContent>{db.suppliers.filter(s => s.active !== false).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}<AddNewItem kind="supplier" /></SelectContent>
                    </Select>
                    <Input value={bill.billNo} onChange={e => updateBill(bi, { billNo: e.target.value })}
                      className="rounded-xl h-10 bg-white" placeholder="Supplier's bill no. *" />
                  </div>

                  {bill.lines.map((line, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-border/60 bg-white space-y-2.5 relative">
                      {bill.lines.length > 1 && (
                        <button type="button" onClick={() => removeBuyLine(bi, idx)} className="absolute top-2 right-2 h-6 w-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <p className="text-xs font-medium text-muted-foreground">Diamond {idx + 1}</p>
                      {line.material === "gold" ? (
                        // Two to a row on a phone, each named above it, so nothing is cut short.
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Weight (g)</span>
                            <Input type="number" min={0} value={line.goldWeight} onChange={e => updateBuyLine(bi, idx, { goldWeight: e.target.value })} className="rounded-xl h-10" placeholder="0" /></label>
                          <div className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Purity</span>
                            <Select value={line.goldPurity} onValueChange={v => updateBuyLine(bi, idx, { goldPurity: v })}>
                              <SelectTrigger className="h-10 rounded-xl" aria-label="Purity"><SelectValue /></SelectTrigger>
                              <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                            </Select></div>
                          <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>{`Rate/g (${line.currency})`}</span>
                            <Input type="number" min={0} value={line.goldRate} onChange={e => updateBuyLine(bi, idx, { goldRate: e.target.value })} className="rounded-xl h-10" placeholder="0" /></label>
                          <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Discount %</span>
                            <Input type="number" min={-100} max={100} step="0.01" value={line.discountPct} onChange={e => updateBuyLine(bi, idx, { discountPct: e.target.value })} className="rounded-xl h-10" placeholder="0" title="A minus figure adds instead" /></label>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {/* Loose vs Certified */}
                          <div className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl">
                            {(["loose", "certified"] as const).map(k => (
                              <button key={k} type="button" onClick={() => updateBuyLine(bi, idx, { diaKind: k })}
                                className={`h-8 rounded-lg text-xs font-medium transition-colors ${line.diaKind === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
                                {k === "loose" ? "Loose" : "Certified"}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            <div className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Shape</span>
                              <Select value={line.diaShape} onValueChange={v => updateBuyLine(bi, idx, { diaShape: v })}>
                                <SelectTrigger className="h-10 rounded-xl" aria-label="Shape"><SelectValue placeholder="Shape" /></SelectTrigger>
                                <SelectContent>{DIAMOND_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                              </Select></div>
                            <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>{line.diaKind === "certified" ? "Size (ct)" : "Carat"}</span>
                              <Input type="number" min={0} step="0.01" value={line.diaCarat} onChange={e => updateBuyLine(bi, idx, { diaCarat: e.target.value })} className="rounded-xl h-10" placeholder="0" /></label>
                            {line.diaKind === "loose" && (
                              <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Pcs</span>
                                <Input type="number" min={0} step="1" value={line.diaPcs} onChange={e => updateBuyLine(bi, idx, { diaPcs: e.target.value })} className="rounded-xl h-10" placeholder="Optional" /></label>
                            )}
                            <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>{`Rate/ct (${line.currency})`}</span>
                              <Input type="number" min={0} value={line.diaRate} onChange={e => updateBuyLine(bi, idx, { diaRate: e.target.value })} className="rounded-xl h-10" placeholder="0" /></label>
                            <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Discount %</span>
                              <Input type="number" min={-100} max={100} step="0.01" value={line.discountPct} onChange={e => updateBuyLine(bi, idx, { discountPct: e.target.value })} className="rounded-xl h-10" placeholder="0" title="A minus figure adds instead" /></label>
                          </div>
                          {line.diaKind === "loose" ? (
                            <Input value={line.diaQuality} onChange={e => updateBuyLine(bi, idx, { diaQuality: e.target.value })} className="rounded-xl h-10" placeholder="Quality (optional)" />
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                              <Input value={line.diaColor} onChange={e => updateBuyLine(bi, idx, { diaColor: e.target.value })} className="rounded-xl h-10" placeholder="Color" />
                              <Input value={line.diaClarity} onChange={e => updateBuyLine(bi, idx, { diaClarity: e.target.value })} className="rounded-xl h-10" placeholder="Clarity" />
                              <Input value={line.diaCut} onChange={e => updateBuyLine(bi, idx, { diaCut: e.target.value })} className="rounded-xl h-10" placeholder="Cut" />
                              <Input value={line.diaPolish} onChange={e => updateBuyLine(bi, idx, { diaPolish: e.target.value })} className="rounded-xl h-10" placeholder="Polish" />
                              <Input value={line.diaSym} onChange={e => updateBuyLine(bi, idx, { diaSym: e.target.value })} className="rounded-xl h-10" placeholder="Symmetry" />
                              <Input value={line.diaFluor} onChange={e => updateBuyLine(bi, idx, { diaFluor: e.target.value })} className="rounded-xl h-10" placeholder="Fluorescence" />
                              <Input value={line.diaMeasure} onChange={e => updateBuyLine(bi, idx, { diaMeasure: e.target.value })} className="rounded-xl h-10 sm:col-span-2" placeholder="Measurement (e.g. 6.5×6.5×4.0 mm)" />
                              <Input value={line.diaLab} onChange={e => updateBuyLine(bi, idx, { diaLab: e.target.value })} className="rounded-xl h-10" placeholder="Lab (GIA/IGI)" />
                              <Input value={line.diaCertNo} onChange={e => updateBuyLine(bi, idx, { diaCertNo: e.target.value })} className="rounded-xl h-10 sm:col-span-3" placeholder="Report number *" />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <Select value={line.currency} onValueChange={v => updateBuyLine(bi, idx, { currency: v as PurchaseCurrency })}>
                          <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="INR">Billed in INR</SelectItem><SelectItem value="USD">Billed in USD</SelectItem></SelectContent>
                        </Select>
                        {line.currency === "USD" && (
                          <>
                            <div className="rounded-xl h-10 px-3 flex items-center bg-secondary/60 text-sm text-muted-foreground">
                              Total: <span className="font-semibold text-foreground ml-1">${buyLineBaseAmount(line).toFixed(2)}</span>
                            </div>
                            <Input type="number" min={0} step="0.01" value={line.exchangeRate} onChange={e => updateBuyLine(bi, idx, { exchangeRate: e.target.value })} className="rounded-xl h-10" placeholder="Exchange rate (₹/$)" />
                          </>
                        )}
                      </div>

                      <Input value={line.notes} onChange={e => updateBuyLine(bi, idx, { notes: e.target.value })} className="rounded-xl h-10" placeholder="Notes (optional)" />

                      <p className="text-xs text-muted-foreground text-right">
                        {!!Number(line.discountPct) && (
                          <span className="mr-2">{discountLabel(Number(line.discountPct))} · </span>
                        )}
                        Line total: <span className="font-semibold text-foreground">{fmtMoneyInr(buyLineTotalInr(line))}</span>
                      </p>
                    </div>
                  ))}

                  <Button type="button" variant="outline" onClick={() => addBuyLine(bi)} className="rounded-xl gap-2 w-full bg-white">
                    <Plus className="h-4 w-4" /> Another stone on this bill{supplierName ? ` (${supplierName})` : ""}
                  </Button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                    <div>
                      <Label className="text-[11px]">Round off ₹ (this bill)</Label>
                      <Input type="number" step="1" value={bill.roundOff} onChange={e => updateBill(bi, { roundOff: e.target.value })}
                        className="rounded-xl h-10 mt-1 bg-white" placeholder="e.g. -3" />
                    </div>
                    {linesInr > 0 && roInr === 0 && linesInr % 10 !== 0 && (
                      <button type="button" onClick={() => updateBill(bi, { roundOff: String(-(linesInr % 10)) })}
                        className="text-xs text-primary hover:underline text-left h-10 flex items-end pb-2.5">
                        Round {fmtMoneyInr(linesInr)} down to {fmtMoneyInr(linesInr - (linesInr % 10))}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    {buyBills.length > 1 ? `Bill ${bi + 1} total` : "Bill total"}
                    {roInr !== 0 && <> ({fmtMoneyInr(linesInr)} {roInr < 0 ? "less" : "plus"} {fmtMoneyInr(Math.abs(roInr))} rounding)</>}
                    : <span className="font-semibold text-foreground">{fmtMoneyInr(billTotalInr(bill))}</span>
                  </p>
                </div>
                );
              })}

              {/* Stones for one order often come from two or three dealers. Each
                  dealer's bill is entered on its own — its own supplier, bill
                  number and round-off — and all are saved together. */}
              <button type="button" onClick={addBuyBill}
                className="w-full rounded-2xl border-2 border-dashed border-primary/30 hover:border-primary/60 hover:bg-primary/5 p-3 text-sm font-medium text-primary inline-flex items-center justify-center gap-2 transition-colors">
                <Plus className="h-4 w-4" /> Add another supplier's bill
              </button>

              <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
                <span className="text-sm text-muted-foreground">
                  Grand Total (INR)
                  {buyBills.length > 1 && (
                    <span className="block text-xs">
                      {buyBills.map((b, i) => `${db.suppliers.find(s => s.id === b.supplierId)?.name ?? `Bill ${i + 1}`} ${fmtMoneyInr(billTotalInr(b))}`).join(" + ")}
                    </span>
                  )}
                </span>
                <span className="font-display text-lg font-bold text-brand-dark">{fmtMoneyInr(buyGrandTotalInr)}</span>
              </div>

              <div className="flex gap-2.5">
                <AsyncButton onClick={recordPurchaseForOrder} disabled={buying} className="btn-hero rounded-xl h-10">
                  {buying ? "Saving…" : buyBills.length > 1 ? `Save ${buyBills.length} Bills (${buyLineCount} items)` : buyLineCount > 1 ? `Save ${buyLineCount} Purchases` : "Save Purchase"}
                </AsyncButton>
                <Button variant="outline" onClick={() => { setShowDiamond(false); setShowBuyForm(false); resetBuyForm(); }} className="rounded-xl h-10">Cancel</Button>
              </div>
            </div>
          )}

          {showIssueForm && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <p className="text-sm font-medium text-brand-dark">{isOtherMaterial(issueMaterial) ? "Other material" : "Diamond"} from stock → {db.factories.find(f => f.id === order.assignedFactoryId)?.name || "factory"}</p>
              {isOtherMaterial(issueMaterial) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <OtherMaterialSelect value={issueMaterial} onChange={v => { setIssueMaterial(v as MaterialKey); setIssueGrade(""); }} />
                  <GradeInput material={issueMaterial} value={issueGrade} onChange={setIssueGrade} />
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">
                    In stock{hasCompanies(db.settings) ? ` (${companyById(db.settings, workCo).name})` : ""}: {fmtQty(deriveStockBalances(db.stockMovements, issueMaterial, workCo)[issueGrade.trim() || "—"] ?? 0, materialUnit(db.settings, issueMaterial))} of {issueGrade.trim() || "—"}
                  </p>
                </div>
              ) : (
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
              )}

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
                  className="rounded-xl h-10" placeholder={issueMaterial === "gold" ? "Weight used (g)" : isOtherMaterial(issueMaterial) ? `Quantity used (${materialUnit(db.settings, issueMaterial)})` : "Carat used"}
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
                <Button variant="outline" onClick={() => { setShowDiamond(false); setShowIssueForm(false); resetIssueForm(); }} className="rounded-xl h-10">Cancel</Button>
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
                      <span className="truncate">{p.material === "gold" ? `${p.gold?.weightGrams}g ${p.gold?.purity}` : p.material === "diamond" ? `${p.diamond?.carat}ct` : purchaseText(db.settings, p)} from {supplier?.name || "supplier"}{p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`font-medium ${pending > 0 ? "text-destructive" : "text-success"}`}>{fmtMoneyInr(p.totalInr)}{pending > 0 ? ` · ${fmtMoneyInr(pending)} due` : ""}</span>
                      {isStaffUser && (
                        <>
                        <RowAction icon={Pencil} label="Correct this purchase (wrong carat / rate / invoice)" why={purchaseWhy(p, "edit")} onRun={() => openEditPurchase(p)} />
                        <RowAction icon={Trash2} danger label="Remove this purchase (e.g. entered twice) — reverses the supplier due, stock and factory issue"
                          why={purchaseWhy(p, "remove")} busy={removingPurchaseId === p.id} onRun={() => removeLinkedPurchase(p)} />
                        </>
                      )}
                    </span>
                  </Link>
                );
              })}
              {linkedIssuances.map(mi => {
                const pending = issuancePending(mi);
                const factory = db.factories.find(f => f.id === mi.factoryId);
                const used = issuanceUsed(mi);
                const unit = materialUnit(db.settings, mi.material);
                const certPackets = mi.diamondKind === "certified"
                  ? (db.diamondPackets ?? []).filter(p => mi.diamondPacketIds?.includes(p.id))
                  : [];
                const srcPurchase = mi.source === "purchase" && mi.sourcePurchaseId ? linkedPurchases.find(p => p.id === mi.sourcePurchaseId) : undefined;
                const srcSupplier = srcPurchase ? db.suppliers.find(s => s.id === srcPurchase.supplierId) : undefined;
                const srcInfo = srcPurchase ? ` · bought from ${srcSupplier?.name || "supplier"}${srcPurchase.invoiceNumber ? ` (bill ${srcPurchase.invoiceNumber})` : ""}` : mi.source === "stock" ? " · from stock" : "";
                const label = (mi.diamondKind === "certified"
                  ? `${certPackets.length} certified diamond${certPackets.length !== 1 ? "s" : ""} (${mi.quantityIssued}ct) — ${certPackets.map(p => `${p.shape} ${p.carat}ct, Cert ${p.certificateNumber}`).join("; ")}`
                  : `${materialName(db.settings, mi.material)} — ${mi.purityOrQuality}, ${used}${unit} used${Math.abs(used - mi.quantityIssued) > 0.001 ? ` (${mi.quantityIssued}${unit} issued)` : ""}`) + srcInfo;
                const srcCost = srcPurchase ? purchasePending(srcPurchase) : 0;
                const isGold = mi.material === "gold";
                const liveLabour = labourValue({
                  perGramRate: rcvPerGram ? Number(rcvPerGram) : undefined,
                  diamondHandlingRate: rcvDiaHandling ? Number(rcvDiaHandling) : undefined,
                  cadCharge: rcvCad ? Number(rcvCad) : undefined,
                  otherCharges: rcvOther ? Number(rcvOther) : undefined,
                  metalByFactoryGrams: rcvMetalG ? Number(rcvMetalG) : undefined,
                  metalByFactoryRate: rcvMetalRate ? Number(rcvMetalRate) : undefined,
                }, Math.round(((Number(rcvNetW) || 0)
                  + (order.otherMetal ? (order.otherMetalWeight || 0) : 0)) * 1000) / 1000,
                  order.actualDiamondWeight || order.diamondWeight || 0);
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
                        {!srcPurchase && isStockIssuance(mi) && isStaffUser && (() => {
                          // The same reasons the page gives on a click, shown before it.
                          const check = canEditIssuance(db, mi);
                          const why = orderEditAccess(db, user, can, order) ?? (check.ok ? undefined : check.reason);
                          return (
                            <>
                            <RowAction icon={Pencil} label="Correct what was taken from stock (wrong carat / shape)" why={why} onRun={() => openEditIssuance(mi)} />
                            <RowAction icon={Trash2} danger label="Cancel this issue — the material goes back into stock" why={why} busy={removingIssuanceId === mi.id} onRun={() => removeIssuance(mi)} />
                            </>
                          );
                        })()}
                        {srcPurchase && isStaffUser && (
                          <>
                          <RowAction icon={Pencil} label="Correct this purchase (wrong carat / rate / invoice)" why={purchaseWhy(srcPurchase, "edit")} onRun={() => openEditPurchase(srcPurchase)} />
                          <RowAction icon={Trash2} danger label="Remove this purchase (e.g. entered twice) — reverses the supplier due, stock and factory issue"
                            why={purchaseWhy(srcPurchase, "remove")} busy={removingPurchaseId === srcPurchase.id} onRun={() => removeLinkedPurchase(srcPurchase)} />
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rework / Alteration — a delivered piece came back for changes */}
          {!diamondOnly && canEditStage() && (
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
                  <p className="text-xs text-muted-foreground">Added gold comes from what the factory holds of ours; removed material goes back to stock.</p>
                  <div>
                    <Label className="text-xs">Factory</Label>
                    <Select value={rwFactoryId || order.assignedFactoryId || ""} onValueChange={addNew("factory", setRwFactoryId)}>
                      <SelectTrigger className="rounded-xl mt-1 h-10"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                      <SelectContent>{db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}<AddNewItem kind="factory" /></SelectContent>
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
                    {rwGoldDir === "add" && (
                      <div>
                        <Label className="text-xs">Gold taken from</Label>
                        <div className="inline-flex rounded-lg bg-white border border-border p-0.5 mt-1 w-full">
                          {([["factory", "Factory’s holding"], ["stock", "Our stock"]] as const).map(([v, lbl]) => (
                            <button key={v} onClick={() => setRwGoldFrom(v)}
                              className={`flex-1 px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${rwGoldFrom === v ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {rwGoldFrom === "factory"
                            ? "The factory uses gold it already holds of ours — their gold ledger drops by the pure (24KT) equivalent and our stock is untouched."
                            : "Drawn from our own stock and sent to the factory — their gold ledger is unchanged."}
                        </p>
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
          <SectionTitle className="mb-5" title="Manufacturing Log" />
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
                      <span className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/\bSept\b/, "Sep")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {entry.amountMaterial !== undefined && `${entry.amountMaterial}${materialUnit(db.settings, entry.material ?? "gold")} ${entry.material ? (isOtherMaterial(entry.material) ? materialName(db.settings, entry.material) : entry.material) : ""}`}
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

      {/* ── Delivery date popup (from the timeline "Mark complete") ── */}
      <Dialog open={deliverModalIdx !== null} onOpenChange={v => { if (!v) setDeliverModalIdx(null); }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-brand-dark">Delivered — {order.orderNumber}</DialogTitle>
            <DialogDescription className="text-xs">The day it reached the client, which need not be today.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Delivery Date *</Label>
            <Input type="date" value={deliverDay} max={todayLocal()} onChange={e => setDeliverDay(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverModalIdx(null)} className="rounded-xl">Cancel</Button>
            <AsyncButton onClick={async () => {
              const idx = deliverModalIdx;
              if (idx === null) return;
              updateDb(d => { const o = d.orders.find(x => x.id === order.id)!; o.deliveredAt = stampFor(deliverDay); });
              if (await advanceStep(idx, false, stampFor(deliverDay))) setDeliverModalIdx(null);
            }} className="btn-hero rounded-xl px-5">Mark Delivered</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dispatch Details popup (from the timeline "Mark complete") ── */}
      <Dialog open={dispatchModalIdx !== null} onOpenChange={v => { if (!v && !dispatchSaving) setDispatchModalIdx(null); }}>
        <DialogContent className="max-w-3xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-brand-dark">Dispatch Details — {order.orderNumber}</DialogTitle>
            <DialogDescription className="text-xs">Enter the courier details. On confirm, the order is marked dispatched and the client is emailed automatically.</DialogDescription>
          </DialogHeader>
            <div className="grid sm:grid-cols-2 gap-3 sm:[&>*:last-child]:col-span-2">
              <div><Label className="text-xs">Courier Company *</Label><Input value={courierName} onChange={e => setCourierName(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. FedEx, DHL" /></div>
              <div><Label className="text-xs">Tracking Number *</Label><Input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. 1234567890" /></div>
              <div><Label className="text-xs">Dispatch Date *</Label><Input type="date" value={dispatchDay} max={todayLocal()} onChange={e => setDispatchDay(e.target.value)} className="rounded-xl h-10 mt-1" /></div>
              <div><Label className="text-xs">Tracking Link (optional)</Label><Input value={trackingLink} onChange={e => setTrackingLink(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="https://..." /></div>
              <ShippingCostFields value={dispShipCost} onChange={setDispShipCost} pieces={1} />
            </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchModalIdx(null)} disabled={dispatchSaving} className="rounded-xl">Cancel</Button>
            <AsyncButton onClick={confirmDispatch} disabled={dispatchSaving} className="btn-hero rounded-xl px-5">{dispatchSaving ? "Sending…" : "Confirm Dispatch & Notify"}</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        const usedDiaCtRaw = faOpenDia.reduce((s, i) => {
          if (i.diamondKind === "certified") return s + ((faDia[i.id] ?? "used") === "used" ? i.quantityIssued : 0);
          const ret = Math.min(Math.max(Number(faDiaReturnedCt[i.id]) || 0, 0), i.quantityIssued);
          return s + (i.quantityIssued - ret);
        }, 0);
        // The factory bills on ITS weight, so the adjustment is part of the total
        // everything downstream uses — handling charges included.
        const diaAdjust = Number(faDiaAdjust) || 0;
        const usedDiaCt = Math.round((usedDiaCtRaw + diaAdjust) * 1000) / 1000;
        const faLabour = {
          perGramRate: faPerGram ? Number(faPerGram) : undefined,
          minimumLabour: faMinLabour ? Number(faMinLabour) : undefined,
          diamondHandlingRate: faDiaHandling ? Number(faDiaHandling) : undefined,
          cadCharge: faCad ? Number(faCad) : undefined,
          otherCharges: faOther ? Number(faOther) : undefined,
          metalByFactoryGrams: faMetalG ? Number(faMetalG) : undefined,
          metalByFactoryRate: faMetalRate ? Number(faMetalRate) : undefined,
        };
        const faX = faXIssues();
        const faXG = faXGrams();
        const faNetW = Math.round(((Number(faGoldNet) || 0)
          + (faOtherMetal.trim() ? (Number(faOtherNet) || 0) : 0) + faXG.metal) * 1000) / 1000;
        const faLive = labourValue(faLabour, faNetW, usedDiaCt);
        const faMinInUse = minimumLabourApplies(faLabour, faNetW);
        const faFactory = db.factories.find(f => f.id === order.assignedFactoryId);
        return (
          <Dialog open onOpenChange={v => { if (!v && !faSaving) setFaIdx(null); }}>
            <DialogContent className="max-w-6xl rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl text-brand-dark">Final Approval — {order.orderNumber}</DialogTitle>
                <DialogDescription className="text-xs">Enter the real details now: gold used, each diamond used or returned, the labour, and the final order value.</DialogDescription>
              </DialogHeader>
              <div className="dlg-cols">

              {/* The factory's own bill number. One of their bills covers several
                  pieces while each comes back on its own, so this is what ties
                  our entries to the bill being checked against — and what finds
                  a single wrong one. */}
              <div className="mb-4">
                <Label className="text-[11px]">Factory bill no.</Label>
                <Input value={faBillNo} onChange={e => setFaBillNo(e.target.value)}
                  className="rounded-lg h-9 mt-1" placeholder="e.g. JS4677 — from the factory's bill" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  The same number on every piece of one bill.
                </p>
              </div>

              {/* Always offered. A piece ordered as platinum or silver can still
                  have gold in it, and this was the only place to record it. */}
              {(
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Gold used{needsGold ? "" : " (optional)"}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div><Label className="text-[11px]">Net Weight (g)</Label><Input type="number" min={0} step="0.001" value={faGoldNet} onChange={e => setFaGoldNet(e.target.value)} className="rounded-lg h-9 mt-1" /></div>
                    <div>
                      <Label className="text-[11px]">Purity (‰)</Label>
                      {/* One tap per karat — a factory works to a set purity and
                          retyping 595 on every order is how a 559 gets in. Typing
                          a different figure still wins, for a factory that
                          works to its own. */}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(FACTORY_PURITY).map(([kt, pu]) => (
                          <button key={kt} type="button" onClick={() => setFaGoldPurity(String(pu))}
                            className={`h-7 px-2 rounded-lg text-[11px] font-medium border transition-colors ${
                              Number(faGoldPurity) === pu
                                ? "bg-primary text-white border-primary"
                                : "bg-white border-border text-muted-foreground hover:border-primary/40"}`}>
                            {kt} · {pu}
                          </button>
                        ))}
                      </div>
                      <Input type="number" min={0} step="0.1" value={faGoldPurity}
                        onChange={e => setFaGoldPurity(e.target.value)}
                        className="rounded-lg h-9 mt-1.5" placeholder="or type the factory’s own" />
                    </div>
                  </div>
                  {Number(faGoldNet) > 0 && Number(faGoldPurity) > 0 && <p className="text-[11px] text-muted-foreground mt-1">= {pureFromPurity(Number(faGoldNet), Number(faGoldPurity))}g fine (24KT) deducted from {faFactory?.name || "the factory"}</p>}
                </div>
              )}

              {/* Other metal — two-tone pieces (platinum bezel on gold, gold + silver, …) */}
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Other metal (optional)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-[11px]">Metal</Label>
                    <Select value={faOtherMetal || "__none"} onValueChange={v => setFaOtherMetal(v === "__none" ? "" : v)}>
                      <SelectTrigger className="h-9 rounded-lg mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">None</SelectItem>
                        {["Platinum", "Silver", "White Gold", "Rose Gold", "Yellow Gold", "Other"].map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Net Weight (g)</Label>
                    <Input type="number" min={0} step="0.001" value={faOtherNet} disabled={!faOtherMetal}
                      onChange={e => setFaOtherNet(e.target.value)} className="rounded-lg h-9 mt-1 disabled:opacity-60" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Purity (‰)</Label>
                    <Input type="number" min={0} step="0.1" value={faOtherPurity} disabled={!faOtherMetal}
                      onChange={e => setFaOtherPurity(e.target.value)} className="rounded-lg h-9 mt-1 disabled:opacity-60" placeholder="e.g. 950" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Two-tone pieces only — added to the gross weight.
                </p>
              </div>

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
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-muted-foreground">Pcs</span>
                              <Input type="number" min={0} step="1" value={faDiaReturnedPcs[i.id] ?? ""}
                                onChange={e => setFaDiaReturnedPcs(m => ({ ...m, [i.id]: e.target.value }))}
                                placeholder={i.piecesIssued != null ? String(i.piecesIssued) : "pcs"}
                                title="How many stones came back"
                                className="h-8 w-20 rounded-lg" />
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">Used <span className="font-medium text-foreground">{usedCt} ct</span>{ret > 0 ? <> · Returned <span className="font-medium text-amber-600">{ret} ct</span> → stock</> : null}{i.piecesIssued != null ? <> · {i.piecesIssued} pcs issued</> : null}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Carats that came back go to stock; the rest is used in the piece.</p>
                  {/* The factory weighs on its own scale and bills handling on ITS
                      figure. Without a way to match it, our ledger and their bill
                      can never agree over a 0.02ct difference. */}
                  <div className="grid grid-cols-2 gap-2.5 mb-4">
                    <div>
                      <Label className="text-xs">Weight adjustment (ct)</Label>
                      <Input type="number" step="0.001" value={faDiaAdjust} onChange={e => setFaDiaAdjust(e.target.value)}
                        className="rounded-xl mt-1 h-9" placeholder="e.g. 0.02 or -0.01" />
                    </div>
                    <div>
                      <Label className="text-xs">Total diamond pcs</Label>
                      <Input type="number" min={0} step="1" value={faDiaPcs} onChange={e => setFaDiaPcs(e.target.value)}
                        className="rounded-xl mt-1 h-9" placeholder="stones on the bill" />
                    </div>
                    <p className="text-[11px] text-muted-foreground col-span-2 -mt-1">
                      When their scale differs (issued 6.58ct, billed 6.60ct), enter 0.02 so both ledgers match.
                    </p>
                  </div>
                </div>
              )}

              {/* Other materials issued for this order — used or returned? */}
              {faX.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Other materials — used or returned?</p>
                  <div className="space-y-1.5">
                    {faX.map(i => {
                      const u = materialUnit(db.settings, i.material);
                      const retStr = faXReturned[i.id] ?? "0";
                      const ret = faXReturnedOf(i);
                      const used = Math.round((i.quantityIssued - ret) * 1000) / 1000;
                      return (
                        <div key={i.id} className="p-2 rounded-lg bg-secondary text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate min-w-0">{materialName(db.settings, i.material)} · {i.purityOrQuality} · {i.quantityIssued}{u} issued</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-muted-foreground">Returned ({u})</span>
                              <Input type="number" min={0} max={i.quantityIssued} step={u === "pcs" ? "1" : "0.001"} value={retStr}
                                onChange={e => setFaXReturned(m => ({ ...m, [i.id]: e.target.value }))}
                                className="h-8 w-24 rounded-lg" aria-label={`${materialName(db.settings, i.material)} returned`} />
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">Used <span className="font-medium text-foreground">{used} {u}</span>{ret > 0 ? <> · Returned <span className="font-medium text-amber-600">{ret} {u}</span>{i.source === "stock" ? " → stock" : ""}</> : null}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Used counts in the weight below; returned goes back to stock.</p>
                </div>
              )}

              {/* Auto totals — diamond used (ct → g) and gross = gold net + diamond */}
              {(() => {
                const diaG = Math.round(usedDiaCt * CARAT_TO_GRAM * 1000) / 1000;
                const netG = Number(faGoldNet) || 0;
                const otherG = faOtherMetal ? (Number(faOtherNet) || 0) : 0;
                const gross = Math.round((netG + otherG + faXG.metal + faXG.stone + diaG) * 1000) / 1000;
                return (
                  <div className="mb-4 rounded-lg bg-secondary/60 p-3 text-xs space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Issued to the factory</span><span className="font-semibold text-foreground">{usedDiaCtRaw} ct</span></div>
                    {diaAdjust !== 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Scale adjustment</span><span className={`font-semibold ${diaAdjust > 0 ? "text-warning" : "text-destructive"}`}>{diaAdjust > 0 ? "+" : ""}{diaAdjust} ct</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-muted-foreground">Total diamond weight</span><span className="font-semibold text-foreground">{usedDiaCt} ct ({diaG} g)</span></div>
                    {Number(faDiaPcs) > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Total diamond pcs</span><span className="font-semibold text-foreground">{Math.round(Number(faDiaPcs))}</span></div>
                    )}
                    {netG > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Gold net weight</span><span className="font-semibold text-foreground">{netG} g</span></div>}
                    {otherG > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{faOtherMetal} net weight</span><span className="font-semibold text-foreground">{otherG} g</span></div>}
                    {faXG.metal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Other metal from stock</span><span className="font-semibold text-foreground">{faXG.metal} g</span></div>}
                    {faXG.stone > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Other stones</span><span className="font-semibold text-foreground">{faXG.stone} g</span></div>}
                    <div className="flex justify-between border-t border-border/50 pt-1"><span className="font-medium text-brand-dark">Gross weight (metal + diamond{faX.length ? " + other" : ""})</span><span className="font-bold text-brand-dark">{gross} g</span></div>
                  </div>
                );
              })()}

              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Labour (factory payable, ₹)</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div><Label className="text-[11px]">Labour / gram</Label><Input type="number" min={0} step="0.01" value={faPerGram} onChange={e => setFaPerGram(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ /g" /></div>
                  <div>
                    <Label className="text-[11px]">Minimum labour</Label>
                    <Input type="number" min={0} step="0.01" value={faMinLabour} onChange={e => setFaMinLabour(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ for a light piece" />
                  </div>
                  <div><Label className="text-[11px]">CAD charge</Label><Input type="number" min={0} step="0.01" value={faCad} onChange={e => setFaCad(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹" /></div>
                  <div><Label className="text-[11px]">Diamond handling / ct</Label><Input type="number" min={0} step="0.01" value={faDiaHandling} onChange={e => setFaDiaHandling(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ /ct" /></div>
                  <div><Label className="text-[11px]">Other charges</Label><Input type="number" min={0} step="0.01" value={faOther} onChange={e => setFaOther(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹" /></div>
                  <div><Label className="text-[11px]">Metal by factory (g)</Label><Input type="number" min={0} step="0.001" value={faMetalG} onChange={e => setFaMetalG(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="g" /></div>
                  <div><Label className="text-[11px]">Metal rate ₹ / g</Label><Input type="number" min={0} step="0.01" value={faMetalRate} onChange={e => setFaMetalRate(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="₹ /g" /></div>
                </div>
                {/* A light piece is charged the factory's minimum instead of the
                    per-gram rate, so the total will not equal rate × weight — say
                    which one is being charged rather than leave it unexplained. */}
                {faMinInUse ? (
                  <p className="text-[11px] mt-1.5 text-warning">
                    Making charged at the minimum {fmtMoneyInr(Number(faMinLabour) || 0)}, not {fmtMoneyInr((Number(faPerGram) || 0) * faNetW)} ({faNetW} g × {fmtMoneyInr(Number(faPerGram) || 0)}).
                  </p>
                ) : faNetW > 0 && faNetW < 2 && !faMinLabour ? (
                  <p className="text-[11px] mt-1.5 text-muted-foreground">
                    This piece is {faNetW} g. If the factory charges a minimum on light pieces, enter it above.
                  </p>
                ) : null}
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

              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setFaIdx(null)} disabled={faSaving} className="rounded-xl">Cancel</Button>
                <AsyncButton onClick={saveFinalApproval} disabled={faSaving} className="btn-hero rounded-xl px-5">{faSaving ? "Saving…" : "Save & Approve"}</AsyncButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </AnimatePresence>

    {rsOffice !== null && (
        <Dialog open onOpenChange={o => { if (!o) setRsOffice(null); }}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Add to Ready Stock</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">Which office will keep {order.orderNumber}? It shows there on the Ready Stock page.</p>
            <Select value={rsOffice} onValueChange={setRsOffice}>
              <SelectTrigger aria-label="Office" className="rounded-xl"><SelectValue placeholder="Choose the office" /></SelectTrigger>
              <SelectContent>{readyStockOffices(db.settings).map(l => <SelectItem key={l} value={l}>{officeLabel(l)}</SelectItem>)}</SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRsOffice(null)} className="rounded-xl">Cancel</Button>
              <AsyncButton disabled={!rsOffice} className="btn-hero rounded-xl px-6" onClick={async () => {
                const office = rsOffice; setRsOffice(null);
                try { localStorage.setItem("rs-build-office", office); } catch { /* ignore */ }
                await addToReadyStock(office);
              }}>Add to Ready Stock</AsyncButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

    {meltOpen && <MeltDialog order={order} onClose={() => setMeltOpen(false)} />}
    {editOpen && <OrderEditDialog order={order} onClose={() => setEditOpen(false)} />}
    {editingPay && <OrderPaymentEditDialog order={order} advance={editingPay} onClose={() => setEditingPayId(null)} />}
    {returnOpen && <ReturnDialog orders={[order]} invoice={findInvoiceForOrder(db.invoices, order.id)} onClose={() => setReturnOpen(false)} />}

    {/* ── Barcode band print/download modal ── */}
    <BandDialog
      open={bandOpen}
      onOpenChange={setBandOpen}
      presets={labelPresets(db.settings)}
      showPrice={db.settings.barcodeBandShowPrice !== false}
      onGenerate={(preset, mode, copies) => generateBand(order, db.settings, { style: preset.style, width: preset.widthMm, height: preset.heightMm, mode, copies })}
    />

    {/* ── Correct material taken from our own stock ── */}
    <Dialog open={!!editingIssuance} onOpenChange={o => { if (!o) setEditingIssuance(null); }}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-xl">Correct what was taken from stock</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          {editingIssuance?.diamondKind === "certified"
            ? "These are specific certified stones, so the weight is the stones' own — only the charge and the note can change here. To swap the stones, cancel this and issue again."
            : "Stock moves by the difference only: correcting 0.2ct to 0.13ct puts 0.07ct back, it does not re-issue the lot."}
        </p>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <Label className="text-xs">{editingIssuance?.material === "gold" ? "Weight (g)" : editingIssuance?.material === "diamond" ? "Carat (ct)" : `Quantity (${materialUnit(db.settings, editingIssuance?.material)})`}</Label>
            <Input type="number" min={0} step="0.001" value={isf.qty}
              disabled={editingIssuance?.diamondKind === "certified"}
              onChange={e => setIsf({ ...isf, qty: e.target.value })}
              className="rounded-xl h-10 mt-1 disabled:opacity-60" />
          </div>
          <div>
            <Label className="text-xs">{editingIssuance?.material === "gold" ? "Purity" : editingIssuance?.material === "diamond" ? "Shape" : "Grade"}</Label>
            {isOtherMaterial(editingIssuance?.material) ? (
              // Its grade is its stock bucket — fixed, like a diamond's shape once issued from stock.
              <div className="rounded-xl h-10 px-3 mt-1 flex items-center bg-secondary/60 text-sm text-muted-foreground">{editingIssuance?.purityOrQuality} · {materialName(db.settings, editingIssuance?.material)}</div>
            ) : editingIssuance?.material === "gold" ? (
              <Select value={isf.bucket} onValueChange={v => setIsf({ ...isf, bucket: v })}>
                <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{GOLD_PURITIES.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            ) : editingIssuance?.diamondKind === "certified" ? (
              <div className="rounded-xl h-10 px-3 mt-1 flex items-center bg-secondary/60 text-sm text-muted-foreground">Certified</div>
            ) : (
              <Select value={isf.bucket} onValueChange={v => setIsf({ ...isf, bucket: v })}>
                <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{DIAMOND_SHAPES.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>
        <div>
          <Label className="text-xs">Making charge (₹)</Label>
          <Input type="number" min={0} step="0.01" value={isf.charge}
            onChange={e => setIsf({ ...isf, charge: e.target.value })}
            className="rounded-xl h-10 mt-1" placeholder="0" />
        </div>
        <div>
          <Label className="text-xs">Note</Label>
          <Input value={isf.notes} onChange={e => setIsf({ ...isf, notes: e.target.value })}
            className="rounded-xl h-10 mt-1" placeholder="Optional" />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Button variant="outline" onClick={() => editingIssuance && removeIssuance(editingIssuance)}
            disabled={!!removingIssuanceId}
            className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
            Cancel this issue
          </Button>
          <Button variant="outline" onClick={() => setEditingIssuance(null)} className="rounded-xl ml-auto">Close</Button>
          <AsyncButton onClick={saveIssuance} disabled={savingIssuance} className="btn-hero rounded-xl">
            {savingIssuance ? "Saving…" : "Save"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Correct a purchase entered wrong ── */}
    <EditPurchaseDialog
      purchase={editingPurchase}
      onClose={() => setEditingPurchase(null)}
      onSave={saveEditPurchase}
      lockQuantity={!!editingPurchase && !purchaseEditScope(db, editingPurchase).quantity}
      lockNote={editingPurchase ? purchaseEditScope(db, editingPurchase).reason : undefined}
    />
    </>
  );
}
