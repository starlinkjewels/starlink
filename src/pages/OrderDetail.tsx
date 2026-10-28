import { ProductionInfo } from "@/components/ProductionInfo";
import { requestPlayable } from "@/lib/webVideo";
import { orderSectionRank } from "@/lib/orderLayout";
import { ProductVideo } from "@/components/ProductVideo";
import { productionTrack } from "@/lib/production";
import { stageLabel } from "@/lib/stages";
import { issuePick, type StockPick } from "@/lib/orderStock";
import { otherChargesTotal, writeStockCost } from "@/lib/db";
import { OtherChargesEditor, chargeDrafts, chargesOf, type ChargeDraft } from "@/components/OtherCharges";
import { hasDiamonds, orderTitle, stoneOf } from "@/lib/orderText";
import { ChangeClientSheet } from "@/components/ChangeClientSheet";
import { clientChangeBlocker, deleteHint, deleteOrderFlow, orderDeleteBlocker, restoreOrderFlow } from "@/lib/orderAdmin";
import { useStudio } from "@/lib/studio";
import { BuyMaterialForm } from "@/components/BuyMaterialForm";
import { choicesOf } from "@/lib/optionLists";
import { LotPicker, BagSelect } from "@/components/LotFields";
import { bagNoOf, bagNoOfPurchase } from "@/lib/diamondBags";
import { lotBalances, lotParts } from "@/lib/diamondLots";
import { orderCost, rateOn, stockAverageRate, stockFineGoldRate } from "@/lib/orderCost";
import { clientMaterialBalance, deliveryFine, diaBack, fmtCt, fmtFine, orderClientSends, orderUse, recordClientUse, shortfallChargeId, undoClientSend, undoClientSendBlocker } from "@/lib/clientMaterial";
import { ShareProductsSheet } from "@/components/ShareProductsSheet";
import { engravingFontCss, engravingFontLabel } from "@/components/order/EngravingField";
import { ClientMaterialSheet } from "@/components/ClientMaterialSheet";
import { ClientSuppliedSheet } from "@/components/ClientSuppliedSheet";
import { inrPerUnit } from "@/lib/currency";
import { factoryRatesFor } from "@/components/FactoryLabourFields";
import { isNonGoldMetal, metalLabel } from "@/lib/metals";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { SectionTitle } from "@/components/SectionTitle";
import { WeightCheck } from "@/components/WeightCheck";
import { weightProblem, pieceWeights, fmtG } from "@/lib/weights";
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { OrderProfitCard } from "@/components/OrderProfitCard";
import { ShippingCostFields } from "@/components/BulkDispatchDialog";
import { recordShippingCost, EMPTY_SHIPPING_COST, type ShippingCost } from "@/lib/dispatch";
import { collectionLoaded,
  loadDb, updateDb, updateDbAs, fmtMoney, fmtDate, totalAdvance, orderTotal, orderGrossTotal, balanceDue, returnedCredit, uid, capOrderAdvances, toPureGold, pureFromPurity, CARAT_TO_GRAM, KARAT_PURITY, FACTORY_PURITY, findInvoiceForOrder, invoiceOrderIds, activeGiftCardsFor, maxGiftRedeem, giftMaxRedeemPctFor, cashbackPercentFor, issueGiftCard,
  type Order, type Purchase, type MaterialIssuance,
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
import { Share2, ArrowLeft, CheckCircle2, Users, Circle, Loader2, Printer, DollarSign, Plus, TrendingUp, AlertCircle, Wallet, ImagePlus, Truck, ExternalLink, Eye, Scale, Calculator, Minimize2, Maximize2, RotateCcw, Factory as FactoryIcon, Coins, Gem, X, Box, Camera, Video, Download, Trash2, Pencil, PackageCheck, Gift, Tag, Flame, Undo2, XCircle, ShoppingCart, Copy, type LucideIcon } from "lucide-react";
import { copyBlocker, copyHref } from "@/lib/orderCopy";
import { MeltDialog } from "@/components/MeltDialog";
import { OtherMaterialSelect, StockGradeInput, useOtherMaterials } from "@/components/MaterialFields";
import { coField, companyOf, companyOfOrder, workCompanyOf, companyById, companiesOf, hasCompanies } from "@/lib/companies";
import { CompanyBadge } from "@/components/CompanyFields";
import { OrderLabels } from "@/components/autopilot/OrderLabels";
import { isOtherMaterial, materialName, materialUnit, fmtQty, purchaseQty, diamondSpec, type MaterialKey } from "@/lib/materials";
import { ActionSheet } from "@/components/ActionSheet";
import { DataTable, CellMain, CellAmount, CellTag, type DataColumn } from "@/components/DataTable";
import { StatStrip } from "@/components/TableToolbar";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { printInvoice, printBatchInvoice } from "@/lib/invoicePrint";
import { generateBand, labelPresets } from "@/lib/band";
import { BandDialog } from "@/components/BandDialog";
import { AsyncButton } from "@/components/AsyncButton";
import {
  fmtMoneyInr, purchasePending, issuancePending, manufacturingReadiness,
  factoryPoolBalance, estimatedPureGoldNeeded, orderMaterialRequirements, issuanceUsed, labourValue, minimumLabourApplies, factoryFineGoldBalance,
  deriveStockBalances,
} from "@/lib/manufacturing";
import { decreaseStockSelfHealing, increaseStock, transferStock } from "@/lib/stock";
import { canVoidPurchase, voidPurchase as voidPurchaseCascade, purchaseLabel, voidImpact, canEditPurchase, purchaseEditScope, editPurchase, type PurchaseEdit } from "@/lib/purchaseVoid";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import { canEditIssuance, editIssuance, deleteIssuance, issuanceVoidImpact, isStockIssuance } from "@/lib/issuanceEdit";
import { receiptForAdvance, deleteReceipt, deleteImpact, receiptCancelBlocker } from "@/lib/receipts";
import { ccy, ccySymbol, fmtCcy, rateText, roundCcy, tableRate } from "@/lib/currency";
import { compressImage as compressImg, canUploadOriginal, imageForUpload, PRODUCT_PHOTO_MAX, PRODUCT_PHOTO_QUALITY } from "@/lib/images";
import { downloadAsZip } from "@/lib/zipDownload";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";
import { ReturnDialog, OrderReturns, useMayReturn } from "@/components/SalesReturn";
import { returnBlocker } from "@/lib/salesReturn";

const GOLD_PURITIES = ["9K", "14K", "18K", "22K", "24K"];


/**
 * The page waits for its record before drawing anything that holds state. The
 * data behind the first screen arrives a moment after the page opens, and a
 * page that returned early on its first draw and then ran all its hooks on the
 * next crashed (React #310) whenever it was opened or refreshed directly.
 */
/** One fact about the piece, as a tile; nothing at all when there is no value. */
/** A section of the order card: edge to edge, a hairline above it. */
const ORDER_SECTION = "-mx-4 sm:-mx-6 px-4 sm:px-6 py-4 sm:py-5 border-t border-border/60";

/** One detail of the order: a quiet label over its value — no box around it. */
function OrderSpec({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  if (value == null || value === "") return null;
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-[15px] font-medium text-foreground mt-0.5 break-words">{value}</p>
    </div>
  );
}

/** A fact in the order's header (due, placed, design, stones). */
function HeaderFact({ label, value, note, noteTone }: { label: string; value: ReactNode; note?: string; noteTone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-medium text-foreground tabular-nums">
        {value}
        {note && <span className={`block sm:inline sm:ml-1.5 text-xs font-medium ${noteTone ?? "text-muted-foreground"}`}>{note}</span>}
      </p>
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

/** One step of making the piece: a number, a name, where it stands, and what it holds. */
function MfgStep({ n, title, state, children }: { n: number; title: string; state: "done" | "ready" | "todo" | "blocked"; children: ReactNode }) {
  const tone = state === "done" ? "border-success/30 bg-success/[0.04]"
    : state === "ready" ? "border-primary/30 bg-primary/[0.03]"
    : state === "blocked" ? "border-border/70 bg-white" : "border-border/70 bg-white";
  return (
    <div className={`rounded-2xl border p-3.5 ${tone}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-6 w-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${state === "done" ? "bg-success text-white" : state === "ready" ? "bg-primary text-white" : "bg-secondary text-muted-foreground"}`}>
          {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-brand-dark">{title}</span>
      </div>
      {children}
    </div>
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
  const studio = useStudio();
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
  const [priceCharges, setPriceCharges] = useState<ChargeDraft[]>([]);

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

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueMaterial, setIssueMaterial] = useState<MaterialKey>("gold");
  const [issueGrade, setIssueGrade] = useState("");
  const otherMaterials = useOtherMaterials();
  /** "gold", "diamond", or the other material's own name — for messages. */
  const matWord = (k: string) => (k === "gold" || k === "diamond" ? k : materialName(db.settings, k));
  const [issueFactoryId, setIssueFactoryId] = useState("");
  const [issuePurity, setIssuePurity] = useState("22K");
  // Loose diamonds: the stock LOT they come out of (its bucket — lib/diamondLots.ts), and how many stones.
  const [issueQuality, setIssueQuality] = useState("");
  // The company a loose lot is taken from, when it is not this order's own ("" = the order's).
  const [issueFromCo, setIssueFromCo] = useState("");
  const [issueDiaPcs, setIssueDiaPcs] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueChargeAmount, setIssueChargeAmount] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  // Loose diamonds from stock: what the stones were, and their price — for the
  // record and the order's cost. The stock itself is counted by shape.
  const [issueDiaMm, setIssueDiaMm] = useState("");
  const [issueDiaColor, setIssueDiaColor] = useState("");
  const [issueDiaClarity, setIssueDiaClarity] = useState("");
  const [issueDiaRate, setIssueDiaRate] = useState("");
  const [issueDiaAmount, setIssueDiaAmount] = useState("");
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
  const [rwDiaPcs, setRwDiaPcs] = useState("");
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
  const [clientOpen, setClientOpen] = useState(false);
  const [editingPayId, setEditingPayId] = useState<string | null>(null);
  const mayReturn = useMayReturn();
  const mayExport = useMayExport();
  // An in-house build going into Ready Stock: which office will keep it.
  const [rsOffice, setRsOffice] = useState<string | null>(null);
  const [rsPrice, setRsPrice] = useState("");
  const [sharingPiece, setSharingPiece] = useState(false);
  const [rsCost, setRsCost] = useState("");

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
  // Placed with "Use from stock" / "Buy new for this order": open that step at once.
  const [params, setParams] = useSearchParams();
  const nextStep = params.get("next");
  useEffect(() => {
    if (!order || (nextStep !== "stock" && nextStep !== "buy")) return;
    setParams(p => { p.delete("next"); return p; }, { replace: true });
    if (user!.role === "client" || order.materialSourcing === "readyStock") return;
    const dOnly = isDiamondOnlyOrder(order);
    if (!order.assignedFactoryId && !dOnly) {
      toast.info("Choose the factory for this order first (Manufacturing → Factory) — then add its material.");
      return;
    }
    if (nextStep === "buy") { setShowBuyForm(true); setShowIssueForm(false); return; }
    setDiaSource("stock"); setShowDiamond(true); setShowBuyForm(false);
    setIssueMaterial("diamond"); setIssueFactoryId(order.assignedFactoryId ?? ""); setShowIssueForm(true);
  }, [!!order, nextStep]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // "Buy new" opens New purchase (components/BuyMaterialForm) set to this order: the
  // same form as every purchase, and what is bought goes straight to the order's factory.

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
    setIssuePurity("22K"); setIssueQuality(""); setIssueFromCo(""); setIssueDiaPcs(""); setIssueQuantity(""); setIssueChargeAmount(""); setIssueNotes("");
    setIssueDiaMm(""); setIssueDiaColor(""); setIssueDiaClarity(""); setIssueDiaRate(""); setIssueDiaAmount("");
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
    const diaPcs = rwDiaDir !== "none" && Number(rwDiaPcs) > 0 ? Math.round(Number(rwDiaPcs)) : undefined;
    const charge = Number(rwCharge) || 0;
    if (goldG <= 0 && diaCt <= 0 && charge <= 0) { toast.error("Enter a gold/diamond change or a rework charge"); return; }
    // Stones added come out of a lot in stock — checked before anything moves.
    if (diaCt > 0 && rwDiaDir === "add" && !lotBalances(db.stockMovements, workCo).some(l => l.key === rwDiaShape && l.ct > 0)) { toast.error("Choose the lot the stones come from"); return; }
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
        await decreaseStockSelfHealing({ material: "diamond", companyId: workCo, purityOrQuality: rwDiaShape, quantity: diaCt, pieces: diaPcs, type: "order_direct_use", refType: "order", refId: order.id, createdBy: user!.id, note: `Rework +${diaCt}ct ${rwDiaShape} for ${order.orderNumber}` }, db.stockMovements);
      } else if (diaCt > 0 && rwDiaDir === "remove") {
        await increaseStock({ material: "diamond", companyId: workCo, purityOrQuality: rwDiaShape, quantity: diaCt, pieces: diaPcs, refType: "manual", createdBy: user!.id, note: `Rework −${diaCt}ct ${rwDiaShape} from ${order.orderNumber} → stock` });
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
            quantityIssued: diaCt, ...(diaPcs ? { piecesIssued: diaPcs } : {}), source: "stock", diamondKind: "loose", finishReturnedCt: 0,
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
      setRwGoldDir("none"); setRwGoldG(""); setRwDiaDir("none"); setRwDiaCt(""); setRwDiaPcs(""); setRwCharge(""); setRwNote("");
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
  // The piece on the scale. Entered, the gold's net is worked out from it:
  // gross − diamonds (1 ct = 0.2 g) − other stones − a second metal.
  const [faGrossIn, setFaGrossIn] = useState("");
  // Purity: "Other" picked, to type a figure no karat has.
  const [faPurityOther, setFaPurityOther] = useState(false);
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
  const [faMinUnder, setFaMinUnder] = useState(""); // grams: the minimum applies under this
  const [faOtherPurity, setFaOtherPurity] = useState("");
  const [faPerGram, setFaPerGram] = useState("");
  const [faCad, setFaCad] = useState("");
  const [faDiaHandling, setFaDiaHandling] = useState("");
  const [faOther, setFaOther] = useState("");
  const [faMetalG, setFaMetalG] = useState("");
  const [faMetalRate, setFaMetalRate] = useState("");
  // Where the labour and metal rate were filled in from, said under them (first approval only).
  const [faFilledFrom, setFaFilledFrom] = useState<string[]>([]);
  const [faOrderValue, setFaOrderValue] = useState("");
  const [faShipping, setFaShipping] = useState("");
  // The client's own gold ran short: what our added gold is billed at ($).
  const [faShortUsd, setFaShortUsd] = useState("");
  // The client's own material: a send / receive panel, and whose material the piece is.
  const [cmSheet, setCmSheet] = useState<{ mode: "send" | "receive"; material?: "gold" | "diamond" } | null>(null);
  const [csEdit, setCsEdit] = useState(false);
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
    // The issue itself is lib/orderStock.ts — the same one New Order's production plan uses.
    const certified = issueMaterial === "diamond" && issueDiaKind === "certified";
    const looseDia = issueMaterial === "diamond" && issueDiaKind === "loose";
    const qty = Number(issueQuantity);
    if (!issueFactoryId && !isDiamondOnlyOrder(order)) { toast.error("Choose a factory"); return; }
    if (certified && issueCertPacketIds.length === 0) { toast.error("Select at least one certified packet"); return; }
    if (!certified) {
      if (isOtherMaterial(issueMaterial) && !otherMaterials.some(m => m.id === issueMaterial)) { toast.error("Choose the material"); return; }
      if (!qty || qty <= 0) { toast.error(`Enter the ${matWord(issueMaterial)} ${isOtherMaterial(issueMaterial) ? "quantity" : "weight/carat"} used`); return; }
      if (looseDia && !issueQuality.trim()) { toast.error("Choose the lot the stones come from"); return; }
    }
    const key = certified ? "" : issueMaterial === "gold" ? issuePurity : isOtherMaterial(issueMaterial) ? (issueGrade.trim() || "—") : (issueQuality.trim() || "unspecified");
    const pick: StockPick = {
      id: "panel", material: issueMaterial, kind: certified ? "certified" : looseDia ? "loose" : "bulk", key, qty: certified ? 0 : qty,
      pcs: looseDia && Number(issueDiaPcs) > 0 ? Math.round(Number(issueDiaPcs)) : undefined,
      packetIds: certified ? issueCertPacketIds.filter(id => inStockPackets.some(p => p.id === id)) : undefined,
      rateInr: looseDia ? Number(issueDiaRate) || undefined : undefined,
      amountInr: looseDia && issueDiaAmount.trim() !== "" ? Number(issueDiaAmount) || 0 : undefined,
    };
    const factory = db.factories.find(f => f.id === issueFactoryId);
    const chargeAmount = Number(issueChargeAmount) || 0;
    setIssuing(true);
    try {
      // A lot held by another of our companies: moved across first (at its cost), then used here.
      if (looseDia && issueFromCo && issueFromCo !== workCo) {
        const avg = stockAverageRate(db, "diamond", key, new Date().toISOString(), issueFromCo);
        await transferStock({
          material: "diamond", purityOrQuality: key, quantity: qty, fromCompany: issueFromCo, toCompany: workCo,
          valueInr: avg ? Math.round(avg * qty) : undefined, pieces: pick.pcs, createdBy: user!.id,
          note: `For ${order.orderNumber}: ${qty} ct moved from ${companyById(db.settings, issueFromCo).name} to ${companyById(db.settings, workCo).name}`,
        });
      }
      await issuePick({ order, factoryId: issueFactoryId, companyId: workCo, pick, userId: user!.id, chargeInr: chargeAmount, notes: issueNotes });
      toast.success(certified
        ? `${pick.packetIds!.length} certified packet${pick.packetIds!.length !== 1 ? "s" : ""} recorded for ${factory?.name || "factory"}`
        : `Recorded ${qty}${materialUnit(db.settings, issueMaterial)} ${key} ${isOtherMaterial(issueMaterial) ? `${matWord(issueMaterial)} ` : ""}used${chargeAmount ? ` — ${fmtMoneyInr(chargeAmount)} charge` : ""}`);
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
      if (clientUser) d.notifications.unshift({ id: "n" + Date.now(), userId: clientUser.id, title: "Timeline updated", body: `${o.orderNumber}: ${stageLabel(o.timeline[idx].step, d.settings)}`, type: "info", read: false, createdAt: new Date().toISOString() });
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
  /**
   * The piece on the scale, split into its parts — one rule for the screen and
   * the save. Diamonds (1 ct = 0.2 g), other stones and metal issued from stock
   * come off first. Then:
   *  • a gold piece: the rest is its gold (a second metal's weight is entered,
   *    else the save stops — the rest would wrongly all count as gold);
   *  • a platinum or silver piece: the rest is ITS metal, never gold — so its
   *    metal must be the one under Other metal (else needSelf, and the save
   *    stops); gold is only what is typed.
   * null = no gross entered: the weights are typed as before.
   */
  const faWeigh = (usedDiaCt: number, xG: { metal: number; stone: number }) => {
    const gross = parseFloat(faGrossIn);
    if (!(gross > 0)) return null;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const other = faOtherMetal.trim();
    const fixed = usedDiaCt * CARAT_TO_GRAM + xG.stone + xG.metal;
    const nonGold = isNonGoldMetal(order.metal);
    const selfMetal = nonGold && !!other && other.toLowerCase() === order.metal.trim().toLowerCase();
    if (selfMetal) {
      const gold = Math.max(0, Number(faGoldNet) || 0);
      const rest = r3(gross - fixed - gold);
      return { gross: r3(gross), selfMetal, gold, other: Math.max(0, rest), short: rest < -0.0005, needOther: false, needSelf: false };
    }
    const otherW = other ? (Number(faOtherNet) || 0) : 0;
    if (nonGold) {
      // Nowhere to put the scale's weight but gold — refused, nothing worked out.
      return { gross: r3(gross), selfMetal, gold: Math.max(0, Number(faGoldNet) || 0), other: otherW, short: false, needOther: false, needSelf: true };
    }
    const rest = r3(gross - fixed - otherW);
    return { gross: r3(gross), selfMetal, gold: Math.max(0, rest), other: otherW, short: rest < -0.0005, needOther: !!other && otherW <= 0, needSelf: false };
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
    setFaPurityOther(false);
    setFaPerGram(finish?.labour?.perGramRate != null ? String(finish.labour.perGramRate) : "");
    setFaMinLabour(finish?.labour?.minimumLabour != null ? String(finish.labour.minimumLabour) : "");
    setFaMinUnder(finish?.labour?.minimumUnderGrams != null ? String(finish.labour.minimumUnderGrams) : "");
    setFaCad(finish?.labour?.cadCharge != null ? String(finish.labour.cadCharge) : "");
    setFaDiaHandling(finish?.labour?.diamondHandlingRate != null ? String(finish.labour.diamondHandlingRate) : "");
    setFaOther(finish?.labour?.otherCharges != null ? String(finish.labour.otherCharges) : "");
    setFaMetalG(finish?.labour?.metalByFactoryGrams != null ? String(finish.labour.metalByFactoryGrams) : "");
    setFaMetalRate(finish?.labour?.metalByFactoryRate != null ? String(finish.labour.metalByFactoryRate) : "");
    // The first approval starts from the factory's own rates for this kind of piece
    // (Factory → Labour rates), and the metal rate from the gold in stock — each
    // still changeable here. A re-edit keeps what was saved.
    const from: string[] = [];
    if (!finish?.labour) {
      const fac = db.factories.find(x => x.id === order.assignedFactoryId);
      const r = factoryRatesFor(fac?.labour, order.jewelleryType);
      if (r.perGram) setFaPerGram(String(r.perGram));
      if (r.minimum) setFaMinLabour(String(r.minimum));
      if (r.minimumUnder) setFaMinUnder(String(r.minimumUnder));
      if (r.perGram || r.minimum) from.push(`Labour from ${fac!.name}'s rates${r.perGram ? ` for a ${order.jewelleryType}` : ""}`);
    }
    if (finish?.labour?.metalByFactoryRate == null) {
      const purity = finish?.finishedPurity ?? defaultPurity;
      const fg = purity ? stockFineGoldRate(db, new Date().toISOString(), workCompanyOf(db, order)) : null;
      if (fg && purity) {
        setFaMetalRate(String(Math.round(fg.rate * purity / 10) / 100));
        from.push(`Metal rate: gold in stock at ₹${fg.rate.toLocaleString("en-IN")}/g fine × ${purity}`);
      }
    }
    setFaFilledFrom(from);
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
    // Only before anything is booked: re-opening an approved piece keeps its
    // saved net (and the factory's gold) unless a new gross is typed.
    const approvedBefore = finish?.finishedNetWeight != null || order.timeline.some(t => t.step === "Final Approval" && t.status === "done");
    setFaGrossIn(!approvedBefore && order.actualGrossWeight ? String(order.actualGrossWeight) : "");
    setFaBillNo(order.factoryBillNo ?? "");
    // A platinum or silver piece IS that metal — it is not a second metal added
    // to a gold one. The field starts on the order's own metal so its weight can
    // be entered at once; leaving it blank disabled the weight box, which is
    // also the weight labour per gram is charged on.
    const selfMetal = isNonGoldMetal(order.metal) ? order.metal : "";
    setFaOtherMetal(order.otherMetal ?? selfMetal);
    setFaOtherNet(order.otherMetalWeight != null ? String(order.otherMetalWeight) : "");
    setFaOtherPurity(order.otherMetalPurity != null ? String(order.otherMetalPurity) : "");
    setFaOrderValue(order.amount ? String(order.amount) : "");
    setFaShipping(order.shippingCharge ? String(order.shippingCharge) : "");
    const shortCharge = (order.otherCharges ?? []).find(c => c.id === shortfallChargeId(order.id));
    setFaShortUsd(shortCharge?.amountUsd ? String(shortCharge.amountUsd) : "");
    setFaIdx(idx);
  };

  const saveFinalApproval = async () => {
    if (faIdx === null) return;
    if (order.melted) { toast.error("This piece was melted — its actual details are kept as they were."); return; }
    const needsGold = orderMaterialRequirements(order).needsGold;
    const netTyped = parseFloat(faGoldNet);
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
      minimumUnderGrams: faMinLabour && Number(faMinUnder) > 0 ? Math.round(Number(faMinUnder) * 1000) / 1000 : undefined,
      diamondHandlingRate: faDiaHandling ? Number(faDiaHandling) : undefined,
      cadCharge: faCad ? Number(faCad) : undefined,
      otherCharges: faOther ? Number(faOther) : undefined,
      metalByFactoryGrams: faMetalG ? Number(faMetalG) : undefined,
      metalByFactoryRate: faMetalRate ? Number(faMetalRate) : undefined,
    };
    // Labour per gram is charged on the whole piece, not only its gold. A
    // platinum or silver piece has no gold net weight, so charging on gold
    // alone silently dropped the per-gram labour from the factory's bill.
    // Metal issued from stock as another material (platinum, silver) is in the piece too.
    const xG = faXGrams();
    const xIssues = faXIssues();
    // Weighed: the scale less everything else in the piece (faWeigh).
    const w = faWeigh(usedDiaCt, xG);
    const weighed = !!w;
    if (w?.short) { toast.error("The gross weight is less than the stones and other metal in the piece — check it."); return; }
    if (w?.needSelf) { toast.error(`A ${order.metal} piece: choose ${order.metal} under Other metal, so the scale's weight goes to it — not to gold.`); return; }
    if (w?.needOther) { toast.error(`Enter the ${faOtherMetal.trim()} weight under Other metal — otherwise the rest of the piece is counted as gold.`); return; }
    const faOtherW = w ? w.other : faOtherMetal.trim() ? (Number(faOtherNet) || 0) : 0;
    const netW = w ? w.gold : netTyped;
    // A weight typed here is gold that went into the piece, whatever metal the
    // order was raised as. This was gated on needsGold, so on a platinum or
    // silver order the figure was taken, ignored and silently thrown away — and
    // a two-tone piece is platinum AND gold.
    const hasNet = !isNaN(netW) && netW > 0;
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
        // The stones as well as the carats, when counted — so the lot's pieces stay right.
        const pcsRaw = (faDiaReturnedPcs[i.id] ?? "").trim();
        const pcsDelta = pcsRaw === "" ? 0 : Math.max(0, Math.round(Number(pcsRaw) || 0)) - (i.finishReturnedPcs ?? 0);
        if (delta > 0) {
          await increaseStock({ material: "diamond", companyId: companyOf(i), purityOrQuality: i.purityOrQuality, quantity: delta, refType: "manual", createdBy: user!.id, note: `${delta}ct diamond returned on final approval for ${order.orderNumber}`, pieces: pcsDelta > 0 ? pcsDelta : undefined });
        } else if (delta < 0) {
          await decreaseStockSelfHealing({ material: "diamond", companyId: companyOf(i), purityOrQuality: i.purityOrQuality, quantity: -delta, type: "issuance_out", refType: "materialIssuance", refId: i.id, createdBy: user!.id, note: `Diamond re-used (un-returned) on final approval edit for ${order.orderNumber}`, pieces: pcsDelta < 0 ? -pcsDelta : undefined }, db.stockMovements);
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
          if (i.diamondKind === "certified") {
            // Whole stones — used or returned. Ours are packets; a client's own
            // certified stone has none, but its Used / Returned counts just the same.
            const disp = faDia[i.id] ?? "used";
            mi.finishDisposition = disp;
            for (const p of d.diamondPackets) if (i.diamondPacketIds?.includes(p.id)) {
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
        const otherW = w ? w.other : parseFloat(faOtherNet);
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
        // What the scale said, when it was weighed; else worked out from the parts.
        if (weighed) o.actualGrossWeight = w!.gross;
        else if (hasNet || faOtherW > 0 || xG.metal > 0) o.actualGrossWeight = faGross;
        const diaPcsN = Math.round(Number(faDiaPcs) || 0);
        o.actualDiamondPcs = diaPcsN > 0 ? diaPcsN : undefined;

        // Client billing.
        if (!isNaN(orderVal) && orderVal > 0) o.amount = orderVal;
        if (faShipping.trim() !== "" && !isNaN(ship) && ship >= 0) o.shippingCharge = ship;
        // The client's own material: what this piece took from it. Gold — the
        // fine gold in the piece plus the agreed loss, from their gold; any
        // shortfall is ours and goes on the bill. Diamonds — what their stones
        // lost to the piece. Replaces what an earlier save recorded.
        // Also when an earlier save recorded something the order no longer
        // calls for (its switches changed after a revert) — so it is cleared.
        const hadUse = !!d.clients.find(c => c.id === o.clientId)?.materialLedger?.some(e => e.kind === "use" && e.orderId === o.id);
        const hadCharge = !!o.otherCharges?.some(c => c.id === shortfallChargeId(o.id));
        if (o.clientSupplied?.gold || hadUse || hadCharge || d.materialIssuances.some(i => i.orderId === o.id && i.source === "client")) {
          const fineInPiece = o.clientSupplied?.gold && hasNet ? (purity > 0 ? pureFromPurity(netW, purity) : toPureGold(netW, karat)) : 0;
          const used = recordClientUse(d, o, o.clientSupplied?.gold ? { fineInPiece, lossPct: o.clientSupplied.goldLossPct ?? 0 } : null, { id: user!.id, name: user!.name });
          o.otherCharges = (o.otherCharges ?? []).filter(c => c.id !== shortfallChargeId(o.id));
          if (used.shortfallFine > 0) {
            const amt = parseFloat(faShortUsd);
            o.otherCharges.push({ id: shortfallChargeId(o.id), name: `Gold supplied by us — ${used.shortfallFine} g fine`, amountUsd: amt > 0 ? Math.round(amt * 100) / 100 : 0 });
          }
          if (!o.otherCharges.length) delete o.otherCharges;
        }
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
      o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");
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
      if (o.status !== "Rejected") return; // re-opened already (another tab, a second click)
      o.timeline.forEach((t, i) => { if (i > 0) { t.status = "pending"; t.date = undefined; } });
      o.timeline[0].status = "done";
      o.status = statusFromTimeline(o.timeline, o.forReadyStock, o.materialSourcing === "readyStock");
      // Re-opening a Ready-Stock sale re-reserves the piece from inventory (it was
      // returned on cancel/reject).
      if (o.materialSourcing === "readyStock" && o.readyStockItemId) {
        const item = d.readyStock?.find(x => x.id === o.readyStockItemId);
        if (item) {
          const had = item.quantity;
          // No more than is on the shelf now — and the order remembers what it really took.
          const took = Math.min(had, o.readyStockQty ?? 1);
          item.quantity = had - took;
          o.readyStockQty = took;
          delete o.readyStockBackAt;
          logItem(item, { ...whoOf(user), kind: "sold", text: `Order ${o.orderNumber} re-opened — sold on it again · ${had} → ${item.quantity}`, ref: { orderId: o.id } });
        }
      }
    });
    toast.success("Order re-opened");
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
      // The CAD sheet as drawn — its fine lines and measurements stay sharp.
      const cadUrl = await uploadDataUrl(await imageForUpload(file), `orders/${order.id}/cad`);
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
      const urls = await Promise.all(incoming.slice(0, room).map(async f => uploadDataUrl(await imageForUpload(f), `orders/${order.id}`)));
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
      // A copy every browser and device plays (an iPhone video often doesn't) — made on the server.
      requestPlayable(url);
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
      const charges = chargesOf(priceCharges);
      if (charges.length) o.otherCharges = charges; else delete o.otherCharges;
      // The client is not told: a price set or changed here sends no notice.
    });
    toast.success("Pricing saved");
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
  // What one piece of the build cost, in dollars at today's rate — the stock piece's cost.
  const buildPieceCostUsd = () => {
    try {
      const c = orderCost(db, order);
      const rate = rateOn(db, new Date().toISOString())?.rate ?? 0;
      return c.totalInr > 0 && rate > 0 ? Math.round(c.totalInr / (order.quantity || 1) / rate * 100) / 100 : 0;
    } catch { return 0; }
  };
  const openAddToStock = () => {
    let o = ""; try { o = localStorage.getItem("rs-build-office") || ""; } catch { /* ignore */ }
    const list = readyStockOffices(db.settings);
    const cost = buildPieceCostUsd();
    setRsCost(cost ? String(cost) : ""); setRsPrice("");
    setRsOffice(list.includes(o) ? o : list[0] ?? "");
  };
  const addToReadyStock = async (office: string, priceUsd = 0, costUsd = 0): Promise<boolean> => {
    if (order.readyStockCreatedId) { nav(`/ready-stock/${order.readyStockCreatedId}`); return true; }
    // Cancelled or melted: its gold and stones went back already — the piece can't go on the shelf too.
    if (order.status === "Rejected" || order.deletedAt || order.melted) { toast.error("This build is cancelled — it can't go into Ready Stock."); return false; }
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
    ].join("\n")))) return false;
    const itemId = uid("rs_");
    const imgs = [order.cadImage, ...(order.productPhotos || []), ...(order.images || [])].filter(Boolean).slice(0, 3) as string[];
    const pw = pieceWeights(order, db.materialIssuances);
    if (pw.problem) { toast.error(`Fix the weights first — ${pw.problem}`); return false; }
    const diaWt = pw.diamondCt || undefined;
    let added = false;
    updateDb(d => {
      const o = d.orders.find(x => x.id === order.id)!;
      if (o.readyStockCreatedId || o.status === "Rejected" || o.deletedAt || o.melted) return;
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
        // The selling price and cost per piece, when given here; else set in Ready Stock.
        // (The cost is never written on the piece — every client can read Ready Stock.)
        price: priceUsd > 0 ? priceUsd : 0,
        // Every piece the build made goes onto the shelf.
        quantity: Math.max(1, Math.round(o.quantity || 1)),
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
      // Its cost: admin-only, kept apart from the piece.
      if (costUsd > 0) writeStockCost(d, itemId, costUsd);
      added = true;
    });
    if (!added) { toast.error("Not added — this build changed meanwhile. Reload the page."); return false; }
    toast.success(priceUsd > 0 ? "Added to Ready Stock — on sale now." : "Added to Ready Stock — set its selling price there.");
    nav("/ready-stock");
    return true;
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
  const changeClientWhy = editWhy ?? clientChangeBlocker(db, order);
  const deleteWhy = orderDeleteBlocker(db, user, order);
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
    { label: "Share this piece", icon: Share2, hint: "A product PDF or a link — photos, video, details, a price you set", onSelect: () => setSharingPiece(true),
      show: isStaffUser && !isDiamondOnlyOrder(order) },
    { label: "Duplicate", icon: Copy, hint: copyBlocker(user, can) ?? "A new order with these details filled in — change what's different, then place it",
      disabled: !!copyBlocker(user, can), onSelect: () => nav(copyHref(order)), show: isStaffUser },
    { label: "Change client", icon: Users, hint: changeClientWhy ?? "Picked the wrong client? Move it — while nothing is billed or paid", disabled: !!changeClientWhy, onSelect: () => setClientOpen(true), show: isStaffUser },
    { label: "Print band", icon: Tag, hint: order.melted ? "Melted — the piece no longer exists" : !mayExport ? needsAccess("orders", "export") : "The barcode jewellery tag",
      disabled: !!order.melted || !mayExport, onSelect: () => setBandOpen(true),
      show: db.settings.barcodeBandEnabled !== false && isStaffUser },
    { label: "Return pieces", icon: Undo2, hint: returnWhy ?? "The client sent pieces back — credit note, pieces into Ready Stock", disabled: !!returnWhy, onSelect: () => setReturnOpen(true),
      show: isStaffUser },
    { label: "Melt", icon: Flame, danger: true, hint: meltReason ?? "Gold back to a factory or stock, stones back to stock", disabled: !!meltReason, onSelect: () => setMeltOpen(true),
      show: isStaffUser },
    { label: "Cancel order", icon: XCircle, danger: true, hint: cancelWhy ?? "Close it as rejected — it can be re-opened", onSelect: cancelOrder, disabled: cancelling || !!cancelWhy,
      show: isStaffUser },
    { label: "Delete", icon: Trash2, danger: true, hint: deleteWhy ?? deleteHint(db, order), disabled: !!deleteWhy,
      onSelect: async () => { if (await deleteOrderFlow(order.id, user!)) nav("/orders"); }, show: isStaffUser },
  ];
  // A deleted order is only looked at — or brought back by the admin.
  const shownActions: MoreAction[] = order.deletedAt
    ? [{ label: "Restore", icon: Undo2, hint: "Back as a cancelled order — re-open it to carry on", onSelect: () => { void restoreOrderFlow(order.id, user!); }, show: user!.role === "admin" }]
    : orderActions;

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

  // Where each section sits — the admin's order (Settings → Order page); the header stays on top.
  const secRank = orderSectionRank(db.settings);
  return (
    <>
    <div className="max-w-7xl mx-auto flex flex-col gap-4">
      <Link to="/orders" style={{ order: -2 }} className="ui-back self-start inline-flex items-center gap-1 h-9 -ml-2 px-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"><ArrowLeft className="h-4 w-4" />Orders</Link>

      <div style={{ order: -1 }} className="card-luxe p-0 overflow-hidden">
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
          : daysLeft < 0 ? { text: `${-daysLeft} day${daysLeft !== -1 ? "s" : ""} late`, tone: "text-destructive" }
          : daysLeft <= 3 ? { text: daysLeft === 0 ? "due today" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`, tone: "text-amber-700" }
          : { text: `${daysLeft} days left`, tone: "text-muted-foreground" };
        // One main action as a button; the rest in the ⋯ menu beside it.
        // A build goes into Ready Stock once it is made — Final Approval done (its
        // real weights recorded); before that the timeline is the way forward.
        const buildMade = !order.timeline.some(t => t.step === "Final Approval") || order.timeline.some(t => t.step === "Final Approval" && t.status === "done");
        const mainAction = order.forReadyStock
          ? (user!.role === "admin" && ((order.status !== "Rejected" && !order.deletedAt && !order.melted) || !!order.readyStockCreatedId) && (
              order.readyStockCreatedId
                ? <Button onClick={() => nav(`/ready-stock/${order.readyStockCreatedId}`)} className="h-11 sm:h-10 rounded-xl px-4 gap-2 max-sm:flex-1"><PackageCheck className="h-4 w-4" />In Ready Stock ✓</Button>
                : buildMade
                  ? <Button onClick={openAddToStock} className="h-11 sm:h-10 rounded-xl px-4 gap-2 max-sm:flex-1"><PackageCheck className="h-4 w-4" />Add to Ready Stock</Button>
                  : null
            ))
          : (order.status !== "Rejected" || findInvoiceForOrder(db.invoices, order.id)) && <IfExport><Button onClick={handlePrintInvoice} className="h-11 sm:h-10 rounded-xl px-4 gap-2 max-sm:flex-1"><Printer className="h-4 w-4" />{findInvoiceForOrder(db.invoices, order.id) ? "Print / Download Bill" : "Proforma Bill"}</Button></IfExport>;
        const closed = order.status === "Rejected";
        return (
          <div className="p-4 sm:p-6">
            {order.deletedAt && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                <Trash2 className="h-4 w-4 text-destructive shrink-0" />
                <p className="flex-1 min-w-0 text-foreground/90">
                  <span className="font-semibold text-destructive">Deleted</span> on {fmtDate(order.deletedAt)}{(() => { const by = db.users.find(u => u.id === order.deletedBy)?.name; return by ? ` by ${by}` : ""; })()} — off every list. Everything on it was undone first, as a cancel.
                </p>
                {user!.role === "admin" && <Button size="sm" variant="outline" className="rounded-lg gap-1.5" onClick={() => { void restoreOrderFlow(order.id, user!); }}><Undo2 className="h-3.5 w-3.5" />Restore</Button>}
              </div>
            )}
            <div className="flex items-start gap-4 sm:gap-5">
              {heroImg && (
                <div className="h-[72px] w-[72px] sm:h-24 sm:w-24 rounded-xl overflow-hidden bg-white ring-1 ring-border/70 shrink-0">
                  <img src={heroImg} alt={order.orderNumber} className="w-full h-full object-contain" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground tabular-nums">{order.orderNumber}</span>
                  <StatusBadge status={order.status} />
                  {order.priority && order.priority !== "Normal" && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800">{order.priority}</span>
                  )}
                  {order.melted && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive inline-flex items-center gap-1"><Flame className="h-3 w-3" />Melted</span>}
                  {user!.role !== "client" && <CompanyBadge id={companyOfOrder(db, order)} />}
                  {user!.role !== "client" && <OrderLabels orderId={order.id} />}
                  {!!order.returns?.length && (() => {
                    const back = order.returns.reduce((s, r) => s + r.qty, 0), of = order.quantity || 1;
                    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />{back >= of ? "Returned" : `${back} of ${of} returned`}</span>;
                  })()}
                </div>
                <h1 className="text-[22px] sm:text-[28px] leading-tight text-foreground mt-2 break-words">{orderTitle(order)}</h1>
                <p className="text-sm text-muted-foreground mt-1 break-words">
                  {order.forReadyStock ? "Ready Stock — in-house build" : client ? <span className="font-medium text-foreground/80">{client.companyName}</span> : null}
                  {order.materialSourcing === "readyStock" ? (() => {
                    const it = order.readyStockItemId ? db.readyStock.find(i => i.id === order.readyStockItemId) : undefined;
                    return ` · Sold from Ready Stock${it && officeOf(it) ? ` — ${officeLabel(officeOf(it))}` : ""}`;
                  })() : ""}
                  {order.contactPerson ? ` · ${order.contactPerson}` : ""}
                  {(() => {
                    const from = order.copiedFromId ? db.orders.find(o => o.id === order.copiedFromId) : undefined;
                    return from ? <> · copied from <Link to={`/orders/${from.id}`} className="text-primary hover:underline">{from.orderNumber}</Link></> : null;
                  })()}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {mainAction}
                <MoreMenu title="This order" actions={shownActions} />
              </div>
            </div>

            {/* The facts people look for first, as plain label → value. */}
            <div className="mt-5 pt-4 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
              <HeaderFact label="Due" value={fmtDate(order.expectedDelivery)} note={due?.text} noteTone={due?.tone} />
              <HeaderFact label="Placed" value={fmtDate(order.createdAt)} />
              {order.designNumber && <HeaderFact label="Design" value={order.designNumber} />}
              {order.diamondWeight > 0 && <HeaderFact label="Diamonds" value={`${order.diamondWeight} ct`} note={[order.diamondShape, order.diamondType].filter(Boolean).join(" · ")} />}
            </div>

            <div className="mt-5">
              <div className="flex items-baseline justify-between gap-3">
                {closed
                  ? <span className="text-sm font-medium text-destructive">Order closed — {order.melted ? "melted" : "rejected"}</span>
                  : <span className="text-sm font-medium text-foreground">{stageLabel(stage)}</span>}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {closed
                    ? <>stopped at {doneSteps} of {order.timeline.length}</>
                    : <>{doneSteps} of {order.timeline.length} steps done · {pct}%</>}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${closed ? "bg-destructive/50" : "bg-primary"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* Staff: days in production and whether its diamonds have gone out. */}
            {isStaffUser && (() => {
              const t = productionTrack(order, db.materialIssuances ?? [], db.settings);
              return t ? <div className="mt-4 max-w-sm"><ProductionInfo t={t} /></div> : null;
            })()}

            {/* On a phone the main action spans the width, under the facts. */}
            <div className="sm:hidden mt-5 flex items-center gap-2">
              {mainAction}
              <MoreMenu title="This order" actions={shownActions} />
            </div>
          </div>
        );
      })()}

        {/* Details, grouped: the piece · its stones and weight · design and team. */}
        <div className="border-t border-border/60 grid lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border/60">
          {diamondOnly ? (
          <div className="p-4 sm:p-6">
            <p className="text-sm font-semibold text-foreground mb-3">{stoneOf(order) === "Diamond" ? "The diamonds" : "The stones"}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {stoneOf(order) !== "Diamond" && <OrderSpec label="Stone" value={stoneOf(order)} />}
              {hasDiamonds(stoneOf(order)) ? <OrderSpec label="Diamond type" value={order.diamondType} /> : <OrderSpec label="Type" value={order.stoneSpec?.type} />}
              <OrderSpec label="Stones" value={`${order.quantity} ${order.quantity === 1 ? "pc" : "pcs"}`} />
              <OrderSpec label="Shape" value={order.stoneSpec?.shape} />
              <OrderSpec label="Size" value={[order.stoneSpec?.mm, order.stoneSpec?.size].filter(Boolean).join(" · ") || undefined} />
              <OrderSpec label="Colour" value={order.stoneSpec?.color} />
              <OrderSpec label={hasDiamonds(stoneOf(order)) ? "Clarity" : "Grade"} value={order.stoneSpec?.clarity} />
              <OrderSpec label="Delivery time" value={order.deliveryTime} wide />
            </div>
          </div>
          ) : (
          <div className="p-4 sm:p-6">
            <p className="text-sm font-semibold text-foreground mb-3">The piece</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <OrderSpec label="Type" value={order.jewelleryType} />
              <OrderSpec label="Metal" value={metalLabel(order.metal)} />
              <OrderSpec label="Karats" value={order.productKarats} />
              <OrderSpec label="Color" value={order.productColor} />
              <OrderSpec label="Quantity" value={`${order.quantity} ${order.quantity === 1 ? "pc" : "pcs"}`} />
              <OrderSpec label="Rhodium" value={order.rhodium} />
              <OrderSpec label="Product size" value={order.productSize} wide />
              <OrderSpec label="Stamping" value={order.stamping} wide />
              {order.engraving?.text && (
                <div className="col-span-2 min-w-0">
                  <p className="text-xs text-muted-foreground">Engraving · {engravingFontLabel(order.engraving.font)} letters · final sale</p>
                  <p className="text-xl text-foreground mt-0.5 break-words" style={{ fontFamily: engravingFontCss(order.engraving.font) }}>“{order.engraving.text}”</p>
                </div>
              )}
              <OrderSpec label="Delivery time" value={order.deliveryTime} wide />
            </div>
          </div>
          )}
          <div className="p-4 sm:p-6">
            <p className="text-sm font-semibold text-foreground mb-3">{diamondOnly ? "Carats" : <>Stones &amp; weight</>}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <OrderSpec label={diamondOnly ? "Estimated" : "Est. diamonds"} value={`${order.diamondWeight} ct`} />
              {!diamondOnly && <OrderSpec label="Diamond type" value={order.diamondType} />}
              {!diamondOnly && <OrderSpec label="Diamond shape" value={order.diamondShape} />}
              {!diamondOnly && <OrderSpec label="Est. gross weight" value={order.estimatedGrossWeight ? `${fmtG(order.estimatedGrossWeight)} g` : undefined} />}
              {!diamondOnly && <OrderSpec label="Est. net weight" value={order.estimatedNetWeight ? `${fmtG(order.estimatedNetWeight)} g` : undefined} />}
              {!diamondOnly && <OrderSpec label="Actual net weight" value={order.actualNetWeight ? `${fmtG(order.actualNetWeight)} g` : undefined} />}
              <OrderSpec label={diamondOnly ? "Actual" : "Actual diamonds"} value={order.actualDiamondWeight ? `${order.actualDiamondWeight} ct` : undefined} />
              {diamondOnly && <OrderSpec label="Certificate" value={order.certificate ? "Yes" : "No"} />}
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <p className="text-sm font-semibold text-foreground mb-3">Design &amp; team</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* Design Number — editable inline (staff), and addable when missing */}
              <div className="col-span-2 min-w-0">
                <p className="text-xs text-muted-foreground">Design number</p>
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
                    <button onClick={saveDesignNumber} className="h-8 px-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium shrink-0">Save</button>
                    <button onClick={() => setEditDesign(null)} className="h-8 w-8 rounded-lg border border-border grid place-items-center text-muted-foreground shrink-0"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <p className="text-[15px] font-medium text-foreground mt-0.5 flex items-center gap-1.5">
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
            </div>
            <div className="mt-2"><AssignOrderField order={order} /></div>
          </div>
        </div>

        <div className="px-4 sm:px-6 pb-4 sm:pb-6">

        {/* ── Pricing — set/edited by admin & employee only, never by the client.
              Not on an in-house build: nothing is sold or billed on it. ── */}
        {user!.role !== "client" && !order.forReadyStock && (
          <div className={ORDER_SECTION}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-foreground">Price</p>
              {canEditStage() && (
                <button
                  type="button"
                  className="h-8 -mr-2 px-2 rounded-lg text-sm font-medium text-primary hover:bg-primary/[0.07] transition-colors"
                  onClick={() => {
                    setPriceValue(order.amount ? String(order.amount) : "");
                    setPriceShipping(order.shippingCharge ? String(order.shippingCharge) : "");
                    setPriceCharges(chargeDrafts(order.otherCharges));
                    setShowPricing(v => !v);
                  }}
                >
                  {order.amount ? "Edit" : "Set price"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Order value</p>
                <p className={`mt-0.5 tabular-nums ${order.amount ? "text-xl font-semibold text-foreground" : "text-[15px] font-medium text-muted-foreground"}`}>
                  {order.amount ? fmtMoney(order.amount) : "Not priced yet"}
                </p>
                {returnedCredit(order) > 0 && <p className="text-xs font-medium text-amber-800 mt-0.5">−{fmtMoney(returnedCredit(order))} returned</p>}
                {/* Its invoice right under the price — or plainly none. */}
                {(() => {
                  const inv = findInvoiceForOrder(db.invoices, order.id);
                  if (inv || needsInvoice(order)) return <div className="mt-1.5"><InvoiceBadge invoice={inv} dispatched={needsInvoice(order)} size="md" onOpen={n => nav(`/invoices?q=${encodeURIComponent(n)}`)} /></div>;
                  return order.forReadyStock ? null : <p className="text-xs text-muted-foreground mt-1">Not invoiced yet</p>;
                })()}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Shipping</p>
                <p className="mt-0.5 text-xl font-semibold text-foreground tabular-nums">{(order.shippingCharge || 0) > 0 ? fmtMoney(order.shippingCharge) : "—"}</p>
              </div>
              {(order.otherCharges?.length ?? 0) > 0 && (
                <div className="min-w-0 col-span-2">
                  <p className="text-xs text-muted-foreground">Other charges · {fmtMoney(otherChargesTotal(order))}</p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {order.otherCharges!.map(c => <li key={c.id} className="flex justify-between gap-3"><span className="truncate">{c.name}</span><span className="tabular-nums font-medium">{fmtMoney(c.amountUsd)}</span></li>)}
                  </ul>
                </div>
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
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Other charges ($)</Label>
                      <OtherChargesEditor rows={priceCharges} onChange={setPriceCharges} />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <AsyncButton size="sm" onClick={savePricing} className="rounded-xl">Save</AsyncButton>
                    <Button size="sm" variant="outline" onClick={() => setShowPricing(false)} className="rounded-xl">Cancel</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Reference images — staff can add them after the order was placed */}
        {((order.images?.length ?? 0) > 0 || (user!.role !== "client" && canEditStage() && !order.melted)) && (
          <div className={ORDER_SECTION}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-foreground">Reference images</p>
              {user!.role !== "client" && canEditStage() && !order.melted && <span className="text-xs text-muted-foreground tabular-nums">{order.images?.length ?? 0} of 3</span>}
            </div>
            <div className="flex gap-3 flex-wrap">
              {(order.images ?? []).map((src, i) => (
                <div key={src} className="relative group">
                  <button type="button" onClick={() => setLightboxSrc(src)}
                    className="h-24 w-24 rounded-xl overflow-hidden bg-white ring-1 ring-border/70 hover:ring-primary/40 transition relative block">
                    <img src={src} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Eye className="h-4 w-4 text-white" />
                    </div>
                  </button>
                  {user!.role !== "client" && canEditStage() && (
                    <button type="button" onClick={() => removeRefImage(src)} aria-label="Remove reference image" title="Remove"
                      className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/55 text-white grid place-items-center backdrop-blur-sm hover:bg-destructive transition-colors opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {user!.role !== "client" && canEditStage() && !order.melted && (order.images?.length ?? 0) < 3 && (
                <button type="button" onClick={() => refImageRef.current?.click()} disabled={refUploading}
                  className="h-24 w-24 rounded-xl border border-dashed border-border bg-secondary/30 hover:bg-secondary/70 hover:border-primary/40 transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground disabled:opacity-60">
                  {refUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  <span className="text-xs font-medium">{refUploading ? "Uploading…" : "Add"}</span>
                </button>
              )}
              <input ref={refImageRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => { if (e.target.files?.length) addRefImages(e.target.files); e.target.value = ""; }} />
            </div>
          </div>
        )}

        {(order.instructions || (isStaffUser && !editWhy)) && (
          <div className={ORDER_SECTION}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-foreground">Special instructions</p>
              {/* Changed with the rest of the details, in the side panel. */}
              {isStaffUser && (
                <button type="button" onClick={() => (editWhy ? toast.error(editWhy) : setEditOpen(true))} title={editWhy ?? "Edit the instructions and other details"}
                  aria-label="Edit instructions" aria-disabled={!!editWhy}
                  className={`h-8 -mr-2 px-2 rounded-lg text-sm font-medium transition-colors ${editWhy ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-primary hover:bg-primary/[0.07]"}`}>
                  Edit
                </button>
              )}
            </div>
            <p className={`text-[15px] whitespace-pre-wrap break-words ${order.instructions ? "text-foreground" : "text-muted-foreground"}`}>{order.instructions || "None"}</p>
          </div>
        )}

        {canEditStage() && order.status === "Waiting" && (
          <div className={`${ORDER_SECTION} flex gap-3`}>
            <AsyncButton onClick={() => approve(true)} className="rounded-xl">Approve Order</AsyncButton>
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
        <div style={{ order: secRank.cad }} className="card-luxe p-4 sm:p-6 space-y-4">
          {/* Title on the left, its buttons pinned top right — on a phone too
              (the line under the title gives way, never the buttons). One
              main button; the rest under ⋯. */}
          {(() => {
            const edit = canEditStage();
            const busy = cadUploading || model3dmUploading;
            const uploadCad: MoreAction = { label: cadUploading ? "Uploading…" : order.cadImage ? "Replace CAD image" : "Upload CAD image", icon: ImagePlus, disabled: busy, onSelect: () => cadRef.current?.click() };
            const upload3dm: MoreAction = { label: model3dmUploading ? "Uploading…" : order.cad3dmUrl ? "Replace 3D model" : "Upload 3D model (.3dm)", icon: Box, disabled: busy, onSelect: () => model3dmRef.current?.click() };
            // Visible to everyone (incl. client) once a 3D model is on file; else the first thing missing.
            const main: (MoreAction & { short: string }) | null = order.cad3dmUrl ? { label: "View 360°", short: "360°", icon: Box, onSelect: () => setShow360(true) }
              : !edit ? null : !order.cadImage ? { ...uploadCad, short: cadUploading ? "…" : "Add CAD" } : { ...upload3dm, short: model3dmUploading ? "…" : "Add 3D" };
            const rest = edit ? [uploadCad, upload3dm].filter(a => a.label !== main?.label) : [];
            const MainIcon = main?.icon;
            return (
              <>
                {edit && (
                  <>
                    <input ref={cadRef} type="file" accept="image/*" className="hidden"
                      onChange={async e => { const file = e.target.files?.[0]; if (file) await saveCadImage(file); e.target.value = ""; }} />
                    <input ref={model3dmRef} type="file" accept=".3dm" className="hidden"
                      onChange={async e => { const file = e.target.files?.[0]; if (file) await save3dmModel(file); e.target.value = ""; }} />
                  </>
                )}
                <SectionTitle icon={ImagePlus} title="CAD Design" sub={order.cadImage ? "On file · the client sees it" : "Not uploaded yet"}
                  actions={(main || rest.length > 0) && (
                    <>
                      {main && (
                        <Button onClick={() => main.onSelect()} disabled={main.disabled} aria-label={main.label}
                          className={`h-10 px-3 sm:px-4 rounded-xl gap-1.5 whitespace-nowrap ${order.cad3dmUrl ? "btn-hero" : ""}`} variant={order.cad3dmUrl ? "default" : "outline"}>
                          {MainIcon && <MainIcon className="h-4 w-4" />}
                          <span className="sm:hidden">{main.short}</span><span className="max-sm:hidden">{main.label}</span>
                        </Button>
                      )}
                      {rest.length > 0 && <MoreMenu title="CAD design" label="More CAD actions" actions={rest} />}
                    </>
                  )} />
              </>
            );
          })()}

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
        <div style={{ order: secRank.dispatch }} className="card-luxe p-6 space-y-4">
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
        <div style={{ order: secRank.photos }} className="card-luxe p-6 space-y-4">
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
              <ProductVideo src={order.productVideo} poster={order.productPhotos?.[0]} maxH="max-h-[26rem]"
                onUnplayable={user!.role !== "client" ? () => requestPlayable(order.productVideo) : undefined}
                onDownload={() => downloadOne(order.productVideo!, "product-video.mp4")} />
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
              {order.forReadyStock
                ? <>Add 4–5 photos and a short video — they go with the piece into Ready Stock.</>
                : <>Add 4–5 photos and a short video. The client finds them under design <span className="font-medium text-foreground">{order.designNumber || order.orderNumber}</span>.</>}
            </div>
          )}
        </div>
      )}

      {/* ── Cost & Profit — the admin's eyes only. Employees can open this
          page, and the client portal renders it too, so the gate is the role
          itself, never the page. */}
      {user!.role === "admin" && <div style={{ order: secRank.profit }} className="min-w-0 empty:hidden"><OrderProfitCard db={db} order={order} /></div>}

      {/* ── Advance Payment Card — not on an in-house build (no client, no bill) ── */}
      {(!order.forReadyStock || advances.length > 0) && (
      <div style={{ order: secRank.payments }} className="card-luxe p-6 space-y-4">
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
          const extras   = otherChargesTotal(order);
          const total    = orderTotal(order);
          const returned = returnedCredit(order);
          const extraCols = (shipping > 0 ? 1 : 0) + (certFee > 0 ? 1 : 0) + (extras > 0 ? 1 : 0) + (returned > 0 ? 1 : 0);
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
              {extras > 0 && (
                <div className="p-3 rounded-xl bg-secondary text-center">
                  <p className="text-xs text-muted-foreground mb-1">Other charges</p>
                  <p className="font-semibold text-sm">{fmtMoney(extras)}</p>
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
      )}

      {/* Production Timeline. A diamond-only order is not produced, so it shows
          only the stages it really has — order, dispatch, delivery. */}
      <div style={{ order: secRank.timeline }} className="card-luxe p-6">
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
                    <p className={`font-medium text-sm ${isDone || isActive ? "text-foreground" : "text-muted-foreground"}`}>{stageLabel(t.step)}</p>
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
                            // A build is closed by putting its pieces on the shelf — never by a bare tick.
                            : t.step === "Ready for Stock"
                              ? order.readyStockCreatedId
                                ? <Button size="sm" variant="outline" onClick={() => nav(`/ready-stock/${order.readyStockCreatedId}`)} className="mt-2 h-8 rounded-lg text-xs gap-1.5"><PackageCheck className="h-3.5 w-3.5" />In Ready Stock — open the piece</Button>
                                : order.status === "Rejected" || order.deletedAt || order.melted
                                  ? <p className="text-[11px] text-muted-foreground mt-1.5">Cancelled — it doesn't go into Ready Stock.</p>
                                  : user!.role === "admin"
                                    ? <Button size="sm" onClick={openAddToStock} className="mt-2 h-8 rounded-lg text-xs gap-1.5"><PackageCheck className="h-3.5 w-3.5" />Add to Ready Stock</Button>
                                    : <p className="text-[11px] text-muted-foreground mt-1.5">An admin adds it to Ready Stock — with its price.</p>
                              : <AsyncButton size="sm" variant="outline" onClick={() => advanceStep(idx)} className="mt-2 h-7 rounded-lg text-xs">Mark complete</AsyncButton>
                      : <p className="text-[10px] text-muted-foreground/60 mt-1.5 select-none">⏳ Complete previous step first</p>
                  )}
                  {isDone && t.step === "Ready for Stock" && order.readyStockCreatedId && (
                    <button type="button" onClick={() => nav(`/ready-stock/${order.readyStockCreatedId}`)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                      <PackageCheck className="h-3 w-3" /> In Ready Stock — open the piece
                    </button>
                  )}
                  {/* Once its pieces are on the shelf, a build's steps stay done — the piece is changed in Ready Stock. */}
                  {canEditStage() && isDone && !order.readyStockCreatedId && (
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
        <div style={{ order: secRank.manufacturing }} className="card-luxe p-6 space-y-5">
          {(() => {
            const editable = canEditStage();
            const needsDia = orderMaterialRequirements(order).needsDiamond;
            // Diamonds can always be added to a piece unless someone said it has none —
            // an order saved without an estimated weight (0 ct) still gets its stones.
            const mayAddDia = needsDia || !order.noDiamond;
            // "Mount Only": made to take stones later — no diamonds asked of it.
            const mountOnly = /mount only/i.test(order.diamondType ?? "");
            const noDiaWeight = !needsDia && !order.noDiamond && !mountOnly && !linkedIssuances.some(i => i.material === "diamond");
            // Other materials we actually hold (for this order's company) — none, and the form would open empty.
            const othersInStock = otherMaterials.filter(m => Object.values(deriveStockBalances(db.stockMovements, m.id, workCompanyOf(db, order))).some(q => q > 0));
            const noFactoryWhy = !order.assignedFactoryId ? "Choose the factory first" : undefined;
            const afterFaWhy = faDone ? "Final Approval is done — use Rework for changes" : undefined;
            const blockWhy = afterFaWhy ?? noFactoryWhy;
            const openDiamond = (s: "stock" | "buy") => {
              setDiaSource(s); setShowDiamond(true);
              if (s === "stock") { setShowIssueForm(true); setShowBuyForm(false); setIssueMaterial("diamond"); setIssueFactoryId(order.assignedFactoryId ?? ""); }
              else { setShowBuyForm(true); setShowIssueForm(false); }
            };
            const openOther = () => {
              setShowIssueForm(true); setShowBuyForm(false); setShowDiamond(false);
              setIssueMaterial(otherMaterials[0].id); setIssueGrade(""); setIssueFactoryId(order.assignedFactoryId ?? "");
            };
            const openRework = () => {
              setRwFactoryId(order.assignedFactoryId || "");
              // Stones taken out go back into this order's own bag unless another is chosen.
              setRwDiaShape(linkedIssuances.find(i => i.material === "diamond" && i.diamondKind !== "certified")?.purityOrQuality || "Round");
              setShowRework(true);
            };
            // The client's own material, offered first when the piece is made of it.
            const csOk = !!order.clientId && !order.forReadyStock;
            // Cancelled or deleted: what is there can be undone, nothing new is taken in or sent.
            const cmLive = order.status !== "Rejected" && !order.deletedAt;
            const addActions: MoreAction[] = [
              { label: "Client's diamonds", icon: Gem, show: csOk && cmLive && (needsDia || !!order.clientSupplied?.diamonds) && !!order.clientSupplied?.diamonds, disabled: !!blockWhy, hint: blockWhy ?? "Their own stones, to the factory — no cost to us", onSelect: () => setCmSheet({ mode: "send", material: "diamond" }) },
              { label: "Client's gold", icon: Coins, show: csOk && cmLive && !!order.clientSupplied?.gold, disabled: !!blockWhy, hint: blockWhy ?? "Their own gold, to the factory", onSelect: () => setCmSheet({ mode: "send", material: "gold" }) },
              { label: "Diamond from stock", icon: Gem, show: mayAddDia, disabled: !!blockWhy, hint: blockWhy ?? "A lot or a certified stone we hold", onSelect: () => openDiamond("stock") },
              // Buying for the order is always open — diamonds, gold, gems, findings.
              { label: "Buy new from a supplier", icon: ShoppingCart, disabled: !!blockWhy, hint: blockWhy ?? "Bought for this order, sent to the factory", onSelect: () => openDiamond("buy") },
              { label: "Other material from stock", icon: Box, show: otherMaterials.length > 0, disabled: !!blockWhy || othersInStock.length === 0,
                hint: blockWhy ?? (othersInStock.length === 0 ? `None in stock (${otherMaterials.map(m => m.name).slice(0, 3).join(", ")}) — buy new instead` : `${othersInStock.map(m => m.name).slice(0, 4).join(", ")}${othersInStock.length > 4 ? "…" : ""}`), onSelect: openOther },
            ];
            const hasEstimate = order.estimatedMakingCharges != null || order.estimatedGrossWeight != null;
            const moreActions: MoreAction[] = [
              { label: hasEstimate ? "Edit estimate" : "Add estimate", icon: Calculator, show: !faDone, onSelect: openEstimate },
              { label: faDone || hasActuals ? "Edit actual details" : "Record actual details", icon: PackageCheck, show: faDone || faStepIdx < 0,
                onSelect: () => openFinalApproval(faDone ? faStepIdx : -1) },
              { label: "Client's own material…", icon: Coins, show: csOk && cmLive && editable,
                hint: faDone ? "Final Approval is done — the piece's material is settled" : order.clientSupplied ? `Client gives ${[order.clientSupplied.gold && "gold", order.clientSupplied.diamonds && "diamonds"].filter(Boolean).join(" + ")}` : "If the client gives their gold or diamonds",
                disabled: faDone, onSelect: () => setCsEdit(true) },
              { label: "No diamond in this piece", icon: XCircle, show: !faDone && !order.noDiamond && !linkedIssuances.some(i => i.material === "diamond"), hint: "Gold only", onSelect: () => setNoDiamond(true) },
              { label: "This piece has diamond", icon: Gem, show: !faDone && !!order.noDiamond, onSelect: () => setNoDiamond(false) },
              { label: "Rework / Alteration", icon: RotateCcw, show: !faDone, hint: "The piece came back for changes", onSelect: openRework },
            ];

            // ① factory · ② material · ③ Final Approval — what is done and what is next.
            const diaIssues = linkedIssuances.filter(i => i.material === "diamond");
            const diaCt = Math.round(diaIssues.reduce((t, i) => t + (i.quantityIssued || 0), 0) * 1000) / 1000;
            const otherIssues = linkedIssuances.filter(i => isOtherMaterial(i.material));
            const diaMissing = readiness.missing.includes("diamond");
            const faActive = faStepIdx >= 0 && order.timeline[faStepIdx].status === "in_progress";
            const blockedText = `${readiness.missing.includes("gold") && !order.assignedFactoryId ? "assign a factory" : ""}${readiness.missing.includes("gold") && !order.assignedFactoryId && diaMissing ? " and " : ""}${diaMissing ? "add the diamond" : ""}`;
            const finish = faDone ? finishRecord() : undefined;
            const est = (v: number | undefined | null, unit: string) => (v ? `${v} ${unit}` : "—");

            return (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <SectionTitle title={diamondOnly ? "Diamond" : "Manufacturing"}
                    sub={diamondOnly ? "Bought for this order — nothing is made"
                      : order.clientSupplied ? `Client gives ${[order.clientSupplied.gold && `gold${order.clientSupplied.goldLossPct ? ` (${order.clientSupplied.goldLossPct}% loss)` : ""}`, order.clientSupplied.diamonds && "diamonds"].filter(Boolean).join(" + ")}`
                      : order.materialSourcing === "stock" ? "Plan: use from stock"
                      : order.materialSourcing === "purchase" ? "Plan: buy new for this order"
                      : "No sourcing plan"} />
                  {editable && (
                    <div className="flex items-center gap-2">
                      {diamondOnly ? (
                        <>
                          {otherMaterials.length > 0 ? (
                            <MoreMenu button={{ label: "From stock", icon: Gem }} label="From stock" actions={[
                              { label: "Diamonds from stock", icon: Gem, hint: "A bag or certified stones", onSelect: () => openDiamond("stock") },
                              { label: "Other material from stock", icon: Box, hint: otherMaterials.map(m => m.name).slice(0, 4).join(", "), onSelect: openOther },
                            ]} />
                          ) : (
                            <Button variant="outline" onClick={() => openDiamond("stock")} className="rounded-xl h-10 gap-2">
                              <Gem className="h-4 w-4" /> From stock
                            </Button>
                          )}
                          <Button onClick={() => { setShowBuyForm(true); setShowIssueForm(false); setShowDiamond(false); }}
                            className="btn-hero rounded-xl h-10 gap-2">
                            <Plus className="h-4 w-4" /> Buy Diamond
                          </Button>
                        </>
                      ) : faDone ? (
                        <Button onClick={openRework} className="btn-hero rounded-xl h-10 gap-2"><RotateCcw className="h-4 w-4" /> Rework / Alteration</Button>
                      ) : addActions.some(a => a.show !== false) ? (
                        <MoreMenu button={{ label: "Add material", icon: Plus, primary: true }} actions={addActions} label="Add material" />
                      ) : null}
                      {!diamondOnly && <MoreMenu actions={moreActions} label="More manufacturing actions" />}
                    </div>
                  )}
                </div>

                {/* The client's own material on this piece — one line per material:
                    where it stands, and the one thing to do next. */}
                {csOk && (order.clientSupplied || orderClientSends(db, order).length > 0) && (() => {
                  const cl = db.clients.find(c => c.id === order.clientId);
                  const bal = cl ? clientMaterialBalance(db, cl) : null;
                  const sends = orderClientSends(db, order);
                  const rows = (["gold", "diamond"] as const).filter(m =>
                    (m === "gold" ? order.clientSupplied?.gold : order.clientSupplied?.diamonds) || sends.some(i => i.material === m));
                  const r3 = (n: number) => Math.round(n * 1000) / 1000;
                  return (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5"><Coins className="h-4 w-4 text-amber-600" /> The client's own material</p>
                        {editable && !faDone && cmLive && <button type="button" onClick={() => setCsEdit(true)} className="text-xs font-medium text-primary hover:underline">Change who gives what</button>}
                      </div>
                      {rows.map(m => {
                        const gold = m === "gold";
                        const mine = sends.filter(i => i.material === m);
                        const received = r3((cl?.materialLedger ?? []).filter(e => e.kind === "in" && e.orderId === order.id && e.material === m).reduce((t, e) => t + ((gold ? e.fine : e.ct) ?? 0), 0));
                        const sent = r3(mine.reduce((t, i) => t + (gold ? deliveryFine(i) : i.quantityIssued - diaBack(i)), 0));
                        const used = orderUse(cl, order.id, m);
                        const withUs = bal ? (gold ? bal.goldInHand : bal.diaInHand) : 0;
                        const unit = (n: number) => (gold ? `${n} g fine` : `${n} ct`);
                        const state = used ? { t: `Used in the piece — ${unit(gold ? used.fine ?? 0 : used.ct ?? 0)}${gold && used.shortfallFine ? ` (+ ${used.shortfallFine} g fine ours, billed)` : ""}`, tone: "text-success" }
                          : sent > 0 ? { t: `At the factory — ${unit(sent)}`, tone: "text-sky-700" }
                          : withUs > 0 ? { t: `With us — ${unit(withUs)} of theirs, not sent yet`, tone: "text-amber-800" }
                          : { t: `Waiting for their ${gold ? "gold" : "diamonds"}`, tone: "text-destructive" };
                        const open = !used && editable && !faDone && cmLive;
                        const next = !open ? null
                          : sent === 0 && withUs > 0 ? { label: "Send to factory", onClick: () => setCmSheet({ mode: "send", material: m }) }
                          : sent === 0 ? { label: `Receive their ${gold ? "gold" : "diamonds"}`, onClick: () => setCmSheet({ mode: "receive", material: m }) }
                          : null;
                        const more = !open ? null
                          : sent > 0 ? { label: withUs > 0 ? "Send more" : "Receive more", mode: withUs > 0 ? "send" as const : "receive" as const }
                          : withUs > 0 ? { label: "Receive more", mode: "receive" as const } : null;
                        // Theirs not coming after all (nothing of theirs at the factory for this piece): the piece takes ours.
                        const flagged = gold ? !!order.clientSupplied?.gold : !!order.clientSupplied?.diamonds;
                        const oursInstead = open && sent === 0 && flagged ? async () => {
                          const what = gold ? "gold" : "diamonds";
                          const keep = received > 0 ? `

The ${unit(received)} of theirs received for this order stays on their account — hand it back from the client's page.` : "";
                          if (!(await confirmBox(`The client is not giving the ${what} for ${order.orderNumber}?

The piece then takes ours — add them from stock or buy them, as for any order.${keep}`, { title: `Our ${what} instead`, confirmText: `Use our ${what}` }))) return;
                          updateDbAs({ summary: `${order.orderNumber}: our ${what} instead of the client's` }, d => {
                            const o = d.orders.find(x => x.id === order.id);
                            if (!o?.clientSupplied) return;
                            if (gold) { delete o.clientSupplied.gold; delete o.clientSupplied.goldLossPct; } else delete o.clientSupplied.diamonds;
                            if (!o.clientSupplied.gold && !o.clientSupplied.diamonds) delete o.clientSupplied;
                          });
                          toast.success(`Our ${what} now — add them with Add material`);
                        } : null;
                        return (
                          <div key={m} className="rounded-lg bg-white border border-border/60 px-3 py-2.5 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              {gold ? <Coins className="h-4 w-4 text-amber-600 shrink-0" /> : <Gem className="h-4 w-4 text-sky-600 shrink-0" />}
                              <p className="text-sm font-medium text-brand-dark">{gold ? "Gold" : "Diamonds"}{gold && order.clientSupplied?.goldLossPct ? <span className="text-xs font-normal text-muted-foreground"> · {order.clientSupplied.goldLossPct}% loss agreed</span> : null}</p>
                              <span className={`text-xs font-medium ${state.tone}`}>{state.t}</span>
                              <span className="ml-auto flex items-center gap-3">
                                {oursInstead && <button type="button" onClick={() => void oursInstead()} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">Ours instead</button>}
                                {more && <button type="button" onClick={() => setCmSheet({ mode: more.mode, material: m })} className="text-xs font-medium text-primary hover:underline">{more.label}</button>}
                                {next && <Button size="sm" onClick={next.onClick} className="h-8 rounded-lg btn-hero">{next.label}</Button>}
                              </span>
                            </div>
                            {(received > 0 || sent > 0 || withUs > 0) && (
                              <p className="text-[11px] text-muted-foreground">
                                {[received > 0 && `Received for this order: ${unit(received)}`, sent > 0 && `sent: ${unit(sent)}`, withUs > 0 && `theirs with us now: ${unit(withUs)}`].filter(Boolean).join(" · ")}
                              </p>
                            )}
                            {mine.length > 0 && (
                              <ul className="divide-y divide-border/50 border-t border-border/50">
                                {mine.map(i => {
                                  const why = undoClientSendBlocker(db, i);
                                  return (
                                    <li key={i.id} className="flex items-center gap-2 py-1.5 text-xs">
                                      <span className="flex-1 min-w-0 truncate text-muted-foreground">
                                        {gold ? `${i.quantityIssued} g ${i.purityOrQuality} (${deliveryFine(i)} g fine)` : `${fmtCt(i.quantityIssued, i.piecesIssued)}${i.diamondKind === "certified" ? " · certified" : ""}${i.purityOrQuality && i.purityOrQuality !== "Client's" ? ` · ${i.purityOrQuality}` : ""}`} → {db.factories.find(x => x.id === i.factoryId)?.name ?? "factory"} · {fmtDate(i.issuedAt)}
                                      </span>
                                      {editable && !why && (
                                        <button type="button" onClick={async () => {
                                          if (!(await confirmBox("Undo this send? It goes back to the client's material with us."))) return;
                                          try { updateDbAs({ summary: `${order.orderNumber}: undid a send of the client's ${gold ? "gold" : "diamonds"}` }, d => undoClientSend(d, i.id)); toast.success("Undone"); }
                                          catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't undo"); }
                                        }} className="text-muted-foreground hover:text-destructive font-medium">Undo</button>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {!diamondOnly && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <MfgStep n={1} title="Factory" state={order.assignedFactoryId ? "done" : "todo"}>
                      <Select disabled={!editable} value={order.assignedFactoryId || "__none"} onValueChange={addNew("factory", v => assignFactory(v === "__none" ? "" : v))}>
                        <SelectTrigger className="h-9 w-full rounded-lg text-sm bg-white" aria-label="Factory"><SelectValue placeholder="Choose factory" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Not assigned</SelectItem>
                          {db.factories.filter(f => f.active !== false).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        <AddNewItem kind="factory" /></SelectContent>
                      </Select>
                      {order.assignedFactoryId && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                          <Coins className="h-3 w-3 text-amber-600 shrink-0" /> Our gold there:
                          <span className="font-semibold text-amber-700">{factoryFineGoldBalance(db.materialIssuances, order.assignedFactoryId, db.factories.find(f => f.id === order.assignedFactoryId)?.openingFineGold).toLocaleString()} g fine</span>
                        </p>
                      )}
                    </MfgStep>
                    <MfgStep n={2} title="Material" state={diaMissing || noDiaWeight ? "todo" : "done"}>
                      {order.noDiamond ? (
                        <p className="text-sm font-medium text-brand-dark">Gold only</p>
                      ) : diaIssues.length > 0 ? (
                        <p className="text-sm font-medium text-brand-dark">{diaIssues.length} diamond {diaIssues.length === 1 ? "entry" : "entries"} · {diaCt} ct</p>
                      ) : needsDia ? (
                        <p className="text-sm font-medium text-destructive">{order.clientSupplied?.diamonds ? "Their diamonds to come" : "Diamond still needed"}</p>
                      ) : noDiaWeight ? (
                        <p className="text-sm font-medium text-amber-700">No diamond weight on the order</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Nothing to add</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {order.noDiamond ? "No diamond in this piece"
                          : diaMissing && needsDia && order.clientSupplied?.diamonds ? "Waiting for the client's diamonds — see above"
                          : diaMissing && needsDia ? (studio ? "Add the diamonds — from stock or bought new" : "Add material → from stock or buy new")
                          : noDiaWeight ? "Add its diamonds (Add material), or ⋯ → No diamond in this piece"
                          : otherIssues.length ? `+ ${otherIssues.length} other material${otherIssues.length === 1 ? "" : "s"}`
                          : order.diamondWeight ? `Estimate ${order.diamondWeight} ct` : "\u00a0"}
                      </p>
                    </MfgStep>
                    <MfgStep n={3} title="Final Approval" state={faDone ? "done" : readiness.ready ? "ready" : "blocked"}>
                      {faDone ? (
                        <>
                          <p className="text-sm font-medium text-success">Done</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Actual details recorded</p>
                        </>
                      ) : readiness.ready ? (
                        <>
                          <p className="text-sm font-medium text-success">Ready</p>
                          {editable && faActive ? (
                            <AsyncButton size="sm" onClick={() => openFinalApproval(faStepIdx)} className="btn-hero mt-1.5 h-8 rounded-lg text-xs">Final Approval — enter actuals</AsyncButton>
                          ) : (
                            <p className="text-[11px] text-muted-foreground mt-0.5">{faStepIdx >= 0 ? "Comes after the earlier steps on the timeline" : "Factory assigned and material in place"}</p>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-destructive">Not yet</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">First {blockedText || "add the material"}</p>
                        </>
                      )}
                    </MfgStep>
                  </div>
                )}

                {!diamondOnly && !faDone && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estimate</p>
                      {editable && <button type="button" onClick={openEstimate} className="text-xs font-medium text-primary hover:underline">{hasEstimate ? "Edit" : "Add estimate"}</button>}
                    </div>
                    <StatStrip items={[
                      { label: "Gross weight", value: est(order.estimatedGrossWeight, "g"), icon: Scale },
                      { label: "Net (gold)", value: est(order.estimatedNetWeight || order.metalWeight, "g"), icon: Coins },
                      { label: "Diamond", value: est(order.diamondWeight, "ct"), icon: Gem },
                      { label: "Making", value: order.estimatedMakingCharges != null ? fmtMoney(order.estimatedMakingCharges) : "—", icon: FactoryIcon },
                    ]} />
                  </div>
                )}

                {!diamondOnly && faDone && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actual — from Final Approval</p>
                      {editable && <button type="button" onClick={() => openFinalApproval(faStepIdx)} className="text-xs font-medium text-primary hover:underline">Edit</button>}
                    </div>
                    <StatStrip items={[
                      { label: "Gold used", icon: Coins,
                        value: finish?.finishedNetWeight != null ? `${finish.finishedNetWeight} g` : "—",
                        sub: finish?.finishedNetWeight != null
                          ? `${finish.finishedPurity != null ? `@ ${finish.finishedPurity}‰` : (finish.finishedKarat || "")} · ${finish.finishedPurity != null ? pureFromPurity(finish.finishedNetWeight, finish.finishedPurity) : toPureGold(finish.finishedNetWeight, finish.finishedKarat || "24K")} g fine`
                          : undefined },
                      { label: "Labour", icon: FactoryIcon, value: finish?.makingCharges?.amountInr ? fmtMoneyInr(finish.makingCharges.amountInr) : "—" },
                      { label: "Factory bill", icon: Tag, value: order.factoryBillNo || "—" },
                    ]} />
                    {/* The figure the factory bills handling on — their scale, not
                        ours — with the stone count from the same bill. Editable here
                        so it can be set without reopening Final Approval. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2.5 text-xs">
                      <span className="text-muted-foreground">Total diamond weight</span>
                      {editable ? (
                        <Input type="number" step="0.001" min={0} value={diaTotW} aria-label="Total diamond weight"
                          onChange={e => setDiaTotW(e.target.value)} onBlur={saveDiamondTotals}
                          className="h-8 w-24 rounded-lg text-xs bg-white" placeholder="ct" />
                      ) : (
                        <span className="font-semibold text-foreground">{order.actualDiamondWeight ? `${order.actualDiamondWeight} ct` : "—"}</span>
                      )}
                      <span className="text-muted-foreground">Total diamond pcs</span>
                      {editable ? (
                        <Input type="number" step="1" min={0} value={diaTotPcs} aria-label="Total diamond pcs"
                          onChange={e => setDiaTotPcs(e.target.value)} onBlur={saveDiamondTotals}
                          className="h-8 w-20 rounded-lg text-xs bg-white" placeholder="pcs" />
                      ) : (
                        <span className="font-semibold text-foreground">{order.actualDiamondPcs ?? "—"}</span>
                      )}
                      {issuedDiaCt > 0 && <span className="text-[11px] text-muted-foreground">issued {issuedDiaCt} ct</span>}
                      {hasActuals && (
                        <span className="ml-auto inline-flex items-center gap-1 font-semibold text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Job finish — the factory’s actual details are recorded
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* Everything bought or issued for this order, in one table. */}
          {(linkedPurchases.length > 0 || linkedIssuances.length > 0) && (() => {
            type MatRow = { id: string; href: string; gold: boolean; title: string; detail?: string; qty: string;
              /** Stones (or pieces) — beside the carats, not lost in the detail line. */
              pcs?: number; source: string; sourceSub?: string;
              costInr?: number; dueInr: number; labourDueInr: number; status: string; tone: "blue" | "green" | "amber" | "neutral"; actions: MoreAction[] };
            const rowAct = (icon: LucideIcon, label: string, hint: string, why: string | undefined, busy: boolean, onRun: () => unknown, danger = false): MoreAction =>
              ({ label, icon, danger, disabled: !!why || busy, hint: why ?? hint, onSelect: () => { void onRun(); } });
            const purchaseActs = (p: Purchase): MoreAction[] => isStaffUser ? [
              rowAct(Pencil, "Edit purchase", "Wrong carat, rate or bill no.", purchaseWhy(p, "edit"), false, () => openEditPurchase(p)),
              rowAct(Trash2, "Remove purchase", "Reverses the supplier due, stock and factory issue", purchaseWhy(p, "remove"), removingPurchaseId === p.id, () => removeLinkedPurchase(p), true),
            ] : [];
            const supplierText = (p: Purchase) => `${db.suppliers.find(s => s.id === p.supplierId)?.name || "Supplier"}${p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}`;
            const brokerText = (p: Purchase) => {
              const br = p.brokerId ? (db.brokers ?? []).find(x => x.id === p.brokerId) : undefined;
              return br && p.brokerageInr ? `brokerage ${fmtMoneyInr(p.brokerageInr)} to ${br.name}${p.brokeragePaidBy === "supplier" ? " (supplier pays)" : ""}` : undefined;
            };
            const kindTitle = (material: string, kind: string | undefined, grade: string) =>
              material === "gold" ? `Gold ${grade}`.trim()
              : material === "diamond" ? (kind === "certified" ? "Certified diamond" : "Loose diamond")
              : materialName(db.settings, material as MaterialKey);
            const rows: MatRow[] = [];
            // Purchases not yet shown as an issue below — a bought diamond is one row, not two.
            for (const p of linkedPurchases.filter(x => !linkedIssuances.some(i => i.sourcePurchaseId === x.id))) {
              rows.push({
                id: p.id, href: `/suppliers/${p.supplierId}`, gold: p.material === "gold",
                title: kindTitle(p.material, p.diamond?.kind, p.gold?.purity ?? ""),
                detail: p.material === "diamond" ? [bagNoOfPurchase(db, p), diamondSpec(p.diamond && { ...p.diamond, pieces: undefined }, (db.diamondPackets ?? []).find(x => x.purchaseId === p.id))].filter(Boolean).join(" · ") || undefined
                  : isOtherMaterial(p.material) && p.other?.grade && p.other.grade !== "—" ? p.other.grade : undefined,
                qty: fmtQty(purchaseQty(p), materialUnit(db.settings, p.material)),
                pcs: p.material === "diamond" ? (p.diamond?.kind === "certified" ? 1 : p.diamond?.pieces) : materialUnit(db.settings, p.material) === "pcs" ? undefined : p.other?.pieces,
                source: supplierText(p), sourceSub: brokerText(p),
                costInr: p.totalInr, dueInr: purchasePending(p), labourDueInr: 0,
                status: "Bought", tone: "neutral", actions: purchaseActs(p),
              });
            }
            for (const mi of linkedIssuances) {
              const unit = materialUnit(db.settings, mi.material);
              const used = issuanceUsed(mi);
              const packs = mi.diamondKind === "certified" ? (db.diamondPackets ?? []).filter(x => mi.diamondPacketIds?.includes(x.id)) : [];
              const srcPurchase = mi.source === "purchase" && mi.sourcePurchaseId ? linkedPurchases.find(x => x.id === mi.sourcePurchaseId) : undefined;
              const factory = db.factories.find(f => f.id === mi.factoryId);
              const spec = mi.diamondSpec;
              const lot = mi.material === "diamond" && mi.diamondKind !== "certified" ? mi.purityOrQuality : "";
              const detail = mi.diamondKind === "certified"
                ? packs.map(x => [x.shape, `${x.carat}ct`, x.color, x.clarity, `${x.certificateLab || "Cert"} ${x.certificateNumber}`].filter(Boolean).join(" · ")).join("; ")
                : mi.material === "diamond"
                ? [bagNoOf(db, lot), lot, spec?.type && !lot.includes(spec.type) ? spec.type : undefined,
                    spec?.mm && !lot.includes(spec.mm) ? (/mm$/i.test(spec.mm) ? spec.mm : `${spec.mm} mm`) : undefined, spec?.size && !lot.includes(spec.size) ? spec.size : undefined,
                    spec?.color && !lot.includes(spec.color) ? spec.color : undefined, spec?.clarity && !lot.includes(spec.clarity) ? spec.clarity : undefined,
                    spec?.ratePerCaratInr ? `${fmtMoneyInr(spec.ratePerCaratInr)}/ct` : undefined].filter(Boolean).join(" · ")
                : isOtherMaterial(mi.material) ? mi.purityOrQuality : undefined;
              // After Final Approval a stone was either set in the piece or went back to stock.
              const returnedCt = mi.finishReturnedCt ?? 0;
              const [status, tone]: [string, MatRow["tone"]] = faDone && mi.material === "diamond"
                ? (mi.diamondKind !== "certified" && returnedCt > 0
                    ? [`${Math.round((mi.quantityIssued - returnedCt) * 1000) / 1000} ct used · ${returnedCt} ct back`, "amber"]
                    : mi.finishDisposition === "returned" ? [mi.source === "client" ? "Back to the client" : "Back to stock", "amber"] : ["Used in piece", "green"])
                : mi.status === "open" ? ["In progress", "blue"] : ["Closed", "green"];
              const check = !srcPurchase && isStockIssuance(mi) && isStaffUser ? canEditIssuance(db, mi) : undefined;
              const issueWhy = check ? (orderEditAccess(db, user, can, order) ?? (check.ok ? undefined : check.reason)) : undefined;
              rows.push({
                // Stones a diamond-only order sold straight from stock have no factory: the row opens the bags.
                id: mi.id, href: mi.factoryId ? `/factories/${mi.factoryId}` : "/stock/diamond", gold: mi.material === "gold",
                title: mi.diamondKind === "certified" && packs.length > 1 ? `${packs.length} certified diamonds` : kindTitle(mi.material, mi.diamondKind, mi.purityOrQuality),
                detail: detail || undefined,
                qty: `${used}${unit}${Math.abs(used - mi.quantityIssued) > 0.001 ? ` of ${mi.quantityIssued}${unit}` : ""}`,
                // Loose: the stones issued, less any counted back at Final Approval; certified: the stones.
                pcs: mi.diamondKind === "certified" ? (packs.length || undefined)
                  : mi.piecesIssued ? Math.max(0, mi.piecesIssued - (mi.finishReturnedPcs ?? 0)) : undefined,
                source: srcPurchase ? supplierText(srcPurchase) : mi.source === "stock" ? "Our stock" : mi.source === "factoryPool" ? "Factory's holding" : mi.source === "melt" ? "Melted piece" : mi.source === "transfer" ? "Transfer" : "—",
                sourceSub: [srcPurchase ? brokerText(srcPurchase) : undefined, mi.factoryId ? `to ${factory?.name || "factory"}` : "sold with the order"].filter(Boolean).join(" · "),
                costInr: srcPurchase?.totalInr ?? spec?.amountInr, dueInr: srcPurchase ? purchasePending(srcPurchase) : 0, labourDueInr: issuancePending(mi),
                status, tone,
                actions: srcPurchase ? purchaseActs(srcPurchase) : check ? [
                  rowAct(Pencil, "Edit", "Wrong carat or shape taken from stock", issueWhy, false, () => openEditIssuance(mi)),
                  rowAct(Trash2, "Cancel this issue", "The material goes back into stock", issueWhy, removingIssuanceId === mi.id, () => removeIssuance(mi), true),
                ] : [],
              });
            }
            const columns: DataColumn<MatRow>[] = [
              { key: "material", header: "Material", always: true, sortValue: r => r.title, csv: r => [r.title, r.detail].filter(Boolean).join(" · "),
                cell: r => (
                  <div className="flex items-start gap-2 min-w-0 max-w-[340px]">
                    {r.gold ? <Coins className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" /> : <Gem className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
                    <CellMain title={r.title} sub={r.detail} />
                  </div>
                ) },
              { key: "pcs", header: "Pcs", align: "right", kind: "number", sortValue: r => r.pcs ?? null, csv: r => (r.pcs != null ? String(r.pcs) : ""),
                cell: r => (r.pcs != null ? <span className="tabular-nums whitespace-nowrap font-medium">{r.pcs.toLocaleString()}</span> : <span className="text-muted-foreground/50">—</span>) },
              { key: "qty", header: "Qty", align: "right", sortValue: r => r.qty, cell: r => <span className="tabular-nums whitespace-nowrap font-medium">{r.qty}</span> },
              { key: "from", header: "From", sortValue: r => r.source, csv: r => [r.source, r.sourceSub].filter(Boolean).join(" · "),
                cell: r => <div className="max-w-[260px]"><CellMain title={<span className="text-sm font-normal text-foreground">{r.source}</span>} sub={r.sourceSub} /></div> },
              { key: "cost", header: "Cost", align: "right", kind: "number", sortValue: r => r.costInr ?? 0,
                cell: r => (
                  <div className="text-right whitespace-nowrap">
                    {r.costInr != null ? <CellAmount>{fmtMoneyInr(r.costInr)}</CellAmount> : <span className="text-muted-foreground">—</span>}
                    {r.dueInr > 0 && <p className="text-[11px] font-medium text-destructive">{fmtMoneyInr(r.dueInr)} to supplier</p>}
                    {r.labourDueInr > 0 && <p className="text-[11px] font-medium text-destructive">{fmtMoneyInr(r.labourDueInr)} labour due</p>}
                  </div>
                ) },
              { key: "status", header: "Status", sortValue: r => r.status, cell: r => <CellTag tone={r.tone}>{r.status}</CellTag> },
            ];
            return (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Material for this order · {rows.length}</p>
                {/* The same table as everywhere: search, count, View and Export in its one toolbar row. */}
                <DataTable id="order-materials" noun="material" rows={rows} columns={columns} rowKey={r => r.id}
                  searchText={r => [r.title, r.detail, r.source, r.sourceSub, r.status].filter(Boolean).join(" ")} searchPlaceholder="Search materials"
                  exportName={`Materials-${order.orderNumber}`} rowHref={r => r.href} details={false} rowActions={r => r.actions} />
              </div>
            );
          })()}

          {/* Estimate — before the piece is made. */}
          <ActionSheet open={showEstimate && !faDone} onOpenChange={o => { if (!o) setShowEstimate(false); }} icon={Calculator}
            title="Estimate" description={`What ${order.orderNumber} should weigh and cost to make`}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowEstimate(false)} className="rounded-xl h-10">Cancel</Button>
                <Button onClick={saveEstimate} className="btn-hero rounded-xl h-10 px-6">Save Estimate</Button>
              </div>
            }>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="est-gross" className="text-xs">Gross weight (g)</Label>
                <Input id="est-gross" type="number" min={0} step="0.001" value={estGold} onChange={e => setEstGold(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
              </div>
              <div>
                <Label htmlFor="est-net" className="text-xs">Net weight — gold (g)</Label>
                <Input id="est-net" type="number" min={0} step="0.001" value={estNet} onChange={e => setEstNet(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
              </div>
              <div>
                <Label htmlFor="est-dia" className="text-xs">Diamond (ct)</Label>
                <Input id="est-dia" type="number" min={0} step="0.01" value={estDia} onChange={e => setEstDia(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
              </div>
              <div>
                <Label htmlFor="est-making" className="text-xs">Making charge ($)</Label>
                <Input id="est-making" type="number" min={0} step="0.01" value={estMaking} onChange={e => setEstMaking(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="0" />
              </div>
              <WeightCheck className="sm:col-span-2" gross={Number(estGold)} net={Number(estNet)} diamondCt={Number(estDia || order.diamondWeight)} />
            </div>
          </ActionSheet>

          {/* Buy for this order — New purchase, set to this order; goes straight to its factory. */}
          <BuyMaterialForm open={showBuyForm} onOpenChange={o => { setShowBuyForm(o); if (!o) setShowDiamond(false); }} order={order} />

          {/* From our stock to the factory — a diamond lot, certified stones, or another material. */}
          <ActionSheet open={showIssueForm} onOpenChange={o => { if (!o) { setShowIssueForm(false); setShowDiamond(false); } }} size="lg" icon={isOtherMaterial(issueMaterial) ? Box : Gem}
            title={`${isOtherMaterial(issueMaterial) ? "Other material" : "Diamond"} from stock`}
            description={isDiamondOnlyOrder(order) && !order.assignedFactoryId ? `Out of stock, sold on ${order.orderNumber}` : `To ${db.factories.find(f => f.id === order.assignedFactoryId)?.name || "the factory"}, for ${order.orderNumber}`}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setShowDiamond(false); setShowIssueForm(false); resetIssueForm(); }} className="rounded-xl h-10">Cancel</Button>
                <AsyncButton onClick={issueMaterialToFactory} disabled={issuing} className="btn-hero rounded-xl h-10 px-6">{issuing ? "Saving…" : isDiamondOnlyOrder(order) && !order.assignedFactoryId ? "Save" : "Save Usage & Charge"}</AsyncButton>
              </div>
            }>
            <div className="space-y-3">
              {isOtherMaterial(issueMaterial) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <OtherMaterialSelect value={issueMaterial} onChange={v => { setIssueMaterial(v as MaterialKey); setIssueGrade(""); }} />
                  <StockGradeInput material={issueMaterial} companyId={workCo} value={issueGrade} onChange={setIssueGrade} />
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">
                    In stock{hasCompanies(db.settings) ? ` (${companyById(db.settings, workCo).name})` : ""}: {fmtQty(deriveStockBalances(db.stockMovements, issueMaterial, workCo)[issueGrade.trim() || "—"] ?? 0, materialUnit(db.settings, issueMaterial))} of {issueGrade.trim() || "—"}
                  </p>
                </div>
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Select value={issueDiaKind} onValueChange={v => setIssueDiaKind(v as "loose" | "certified")}>
                  <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loose">Loose — from a bag</SelectItem>
                    <SelectItem value="certified" disabled={inStockPackets.length === 0}>
                      Certified packet{inStockPackets.length === 0 ? " (none in stock)" : ""}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {issueDiaKind === "loose" && (
                  // A lot that is in stock; its size, colour and clarity fill the details below.
                  <LotPicker value={issueQuality} companyId={workCo} fromCompany={issueFromCo}
                    others={hasCompanies(db.settings) ? companiesOf(db.settings).filter(c => c.id !== workCo).map(c => ({ id: c.id, name: c.name })) : undefined}
                    onChange={(k, lot, fromCo) => {
                    setIssueQuality(k); setIssueFromCo(fromCo ?? "");
                    const spec = lot?.spec ?? lotParts(k);
                    setIssueDiaColor(spec.color ?? ""); setIssueDiaClarity(spec.clarity ?? "");
                    setIssueDiaMm(spec.size && /mm$/i.test(spec.size) ? spec.size.replace(/\s*mm$/i, "") : "");
                    setIssueDiaRate(""); setIssueDiaAmount("");
                  }} />
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

              {/* Loose stones: what they were and their price — all optional. The
                  amount is ct × price/ct unless typed; when given it is what the
                  order's cost uses for these stones. Stock is still counted by shape. */}
              {issueMaterial === "diamond" && issueDiaKind === "loose" && (() => {
                const ct = Number(issueQuantity) || 0;
                // The lot's own average cost per carat — what the stones are valued at unless a price is typed.
                const lotCo = issueFromCo || workCo;
                const lotAvg = issueQuality ? stockAverageRate(db, "diamond", issueQuality, new Date().toISOString(), lotCo) : null;
                const auto = (Number(issueDiaRate) || lotAvg || 0) * ct;
                const inLot = issueQuality ? lotBalances(db.stockMovements ?? [], lotCo).find(l => l.key === issueQuality) : undefined;
                const parts = issueQuality ? (inLot?.spec ?? lotParts(issueQuality)) : undefined;
                const bagNo = issueQuality ? bagNoOf(db, issueQuality) : undefined;
                return (
                  <div className="space-y-2.5">
                  {/* The bag's own details — what these stones are. */}
                  {parts && (
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-2.5 text-xs">
                      {([["Bag", bagNo ?? "—"], ["Shape", parts.shape], ["Type", parts.type ?? "—"], ["MM", parts.mm ?? "—"], ["Sieve", parts.size ?? "—"], ["Colour", parts.color ?? "—"], ["Clarity", parts.clarity ?? "—"]] as const).map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                          <p className={`font-semibold truncate ${k === "Bag" ? "text-primary" : "text-foreground"}`}>{v}</p>
                        </div>
                      ))}
                      {inLot && <p className="col-span-4 sm:col-span-7 text-[11px] text-muted-foreground">In this bag now: {inLot.ct} ct{inLot.pcs != null ? ` · ${inLot.pcs} pcs` : ""}{lotAvg ? ` · average ${fmtMoneyInr(lotAvg)}/ct` : ""}{issueFromCo && issueFromCo !== workCo ? ` · held by ${companyById(db.settings, issueFromCo).name} — moved to ${companyById(db.settings, workCo).name} when saved` : ""}</p>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Pcs</span>
                      <Input type="number" min={0} step="1" value={issueDiaPcs} onChange={e => setIssueDiaPcs(e.target.value)} className="rounded-xl h-10" placeholder="Optional" /></label>
                    <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground"><span>Price/ct (₹)</span>
                      <Input type="number" min={0} value={issueDiaRate} onChange={e => { setIssueDiaRate(e.target.value); setIssueDiaAmount(""); }} className="rounded-xl h-10" placeholder={lotAvg ? String(Math.round(lotAvg)) : "0"} title={lotAvg ? "The lot's average cost per carat" : undefined} /></label>
                    <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground col-span-2 sm:col-span-1"><span>Amount (₹)</span>
                      <Input type="number" min={0} value={issueDiaAmount} onChange={e => setIssueDiaAmount(e.target.value)} className="rounded-xl h-10" placeholder={auto > 0 ? String(Math.round(auto * 100) / 100) : "0"} /></label>
                  </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Stones sold straight from stock (a diamond-only order, no factory) have no making charge. */}
                {!(isDiamondOnlyOrder(order) && !order.assignedFactoryId) && <Input
                  type="number" min={0} value={issueChargeAmount} onChange={e => setIssueChargeAmount(e.target.value)}
                  className="rounded-xl h-10" placeholder="Making charge (₹, optional)"
                />}
                <Input value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="rounded-xl h-10" placeholder="Notes (optional)" />
              </div>

            </div>
          </ActionSheet>

          {/* Rework / Alteration — a delivered piece came back for changes */}
          <ActionSheet open={showRework && !diamondOnly} onOpenChange={o => { if (!o) setShowRework(false); }} icon={RotateCcw}
            title="Rework / Alteration" description="The piece came back for changes"
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowRework(false)} className="rounded-xl h-10">Cancel</Button>
                <AsyncButton onClick={recordRework} disabled={rwSaving} className="btn-hero rounded-xl h-10 px-6">{rwSaving ? "Saving…" : "Record rework"}</AsyncButton>
              </div>
            }>
            <div className="space-y-3">
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
                        {/* Added: out of a bag in stock. Removed: back into the bag it came from (this job's bags first). */}
                        <div className="col-span-2">
                          {rwDiaDir === "add"
                            ? <><Label className="text-xs">From bag</Label><LotPicker value={rwDiaShape} onChange={setRwDiaShape} companyId={workCo} className="rounded-xl mt-1 h-9" /></>
                            : <><Label className="text-xs">Back into bag</Label><BagSelect value={rwDiaShape} onChange={setRwDiaShape} companyId={workCo} className="rounded-xl mt-1 h-9"
                                prefer={linkedIssuances.filter(i => i.material === "diamond" && i.diamondKind !== "certified").map(i => i.purityOrQuality)} /></>}
                        </div>
                        <div><Label htmlFor="rw-dia-ct" className="text-xs">Carats to {rwDiaDir}</Label><Input id="rw-dia-ct" type="number" step="0.001" min={0} value={rwDiaCt} onChange={e => setRwDiaCt(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="e.g. 0.5" /></div>
                        <div><Label htmlFor="rw-dia-pcs" className="text-xs">Pcs</Label><Input id="rw-dia-pcs" type="number" step="1" min={0} value={rwDiaPcs} onChange={e => setRwDiaPcs(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="Optional" /></div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Rework charge (₹)</Label><Input type="number" min={0} value={rwCharge} onChange={e => setRwCharge(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="factory labour" /></div>
                    <div><Label className="text-xs">Note (optional)</Label><Input value={rwNote} onChange={e => setRwNote(e.target.value)} className="rounded-xl mt-1 h-9" placeholder="e.g. resize, add stone" /></div>
                  </div>
            </div>
          </ActionSheet>
        </div>
      )}

      {/* Manufacturing Log — a separate, append-only array from `timeline` on
          purpose (see src/lib/db.ts ManufacturingLogEntry comment): these are
          immutable facts, not progression steps, so they never touch the
          index-based advance/revert logic above. Shown in the same visual
          style so it reads as one continuous story. */}
      {user!.role !== "client" && !!order.manufacturingLog?.length && (
        <div style={{ order: secRank.log }} className="card-luxe p-6">
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
    </AnimatePresence>

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
      {cmSheet && order.clientId && (
        <ClientMaterialSheet clientId={order.clientId} mode={cmSheet.mode} material={cmSheet.material} order={order} onClose={() => setCmSheet(null)} />
      )}
      {csEdit && <ClientSuppliedSheet order={order} onClose={() => setCsEdit(false)} />}
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
          minimumUnderGrams: faMinLabour && Number(faMinUnder) > 0 ? Math.round(Number(faMinUnder) * 1000) / 1000 : undefined,
          diamondHandlingRate: faDiaHandling ? Number(faDiaHandling) : undefined,
          cadCharge: faCad ? Number(faCad) : undefined,
          otherCharges: faOther ? Number(faOther) : undefined,
          metalByFactoryGrams: faMetalG ? Number(faMetalG) : undefined,
          metalByFactoryRate: faMetalRate ? Number(faMetalRate) : undefined,
        };
        const faX = faXIssues();
        const faXG = faXGrams();
        const faW = faWeigh(usedDiaCt, faXG);
        const faGrossN = faW?.gross ?? 0;
        const faOtherG = faW ? faW.other : faOtherMetal.trim() ? (Number(faOtherNet) || 0) : 0;
        // Gross entered on a gold piece: its gold net is worked out (shown, not typed).
        const faAutoNet = faW && !faW.selfMetal && !faW.needSelf ? faW.gold : null;
        const faEffNet = faW ? faW.gold : (Number(faGoldNet) || 0);
        const faNetW = Math.round((faEffNet + faOtherG + faXG.metal) * 1000) / 1000;
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
                    <div className="space-y-2">
                      <div>
                        <Label className="text-[11px]">Gross weight (g) — the whole piece</Label>
                        <Input type="number" min={0} step="0.001" value={faGrossIn} onChange={e => setFaGrossIn(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="from the scale" />
                      </div>
                      <div>
                        <Label className="text-[11px]">Net Weight (g){faAutoNet != null ? " — auto" : ""}</Label>
                        {faAutoNet != null ? (
                          <Input type="number" readOnly tabIndex={-1} value={fmtG(faAutoNet)} className="rounded-lg h-9 mt-1 bg-secondary/60 text-muted-foreground cursor-default" aria-label="Net weight (worked out)" />
                        ) : (
                          <Input type="number" min={0} step="0.001" value={faGoldNet} onChange={e => setFaGoldNet(e.target.value)} className="rounded-lg h-9 mt-1" placeholder="or enter the gross above" />
                        )}
                        {faAutoNet != null && <p className="text-[10px] text-muted-foreground mt-1">{fmtG(faGrossN)} g − diamonds {usedDiaCt} ct ({fmtG(usedDiaCt * CARAT_TO_GRAM)} g){faXG.stone ? ` − other stones ${fmtG(faXG.stone)} g` : ""}{faOtherG ? ` − ${faOtherMetal.trim()} ${fmtG(faOtherG)} g` : ""}{faXG.metal ? ` − other metal ${fmtG(faXG.metal)} g` : ""}</p>}
                        {faW?.selfMetal && <p className="text-[10px] text-muted-foreground mt-1">A {order.metal} piece: the scale's weight goes to {order.metal} below. Enter gold only if the piece has some.</p>}
                        {faW?.needSelf && <p className="text-[10px] font-semibold text-destructive mt-1">A {order.metal} piece: choose {order.metal} under Other metal below — the scale's weight goes to it, not to gold.</p>}
                        {faW?.needOther && <p className="text-[10px] font-semibold text-destructive mt-1">Enter the {faOtherMetal.trim()} weight below — otherwise the rest of the piece counts as gold.</p>}
                      </div>
                    </div>
                    <div>
                      <Label className="text-[11px]">Purity (‰)</Label>
                      {/* Picked per karat — a factory works to a set purity and
                          retyping 595 on every order is how a 559 gets in.
                          "Other" takes a typed figure, for a factory that
                          works to its own. */}
                      {(() => {
                        const preset = Object.entries(FACTORY_PURITY).find(([, pu]) => Number(faGoldPurity) === pu)?.[0];
                        const other = !preset && (faPurityOther || faGoldPurity.trim() !== "");
                        return (
                          <>
                            <Select value={preset ?? (other ? "__other" : "")}
                              onValueChange={v => { if (v === "__other") { setFaPurityOther(true); setFaGoldPurity(""); } else { setFaPurityOther(false); setFaGoldPurity(String(FACTORY_PURITY[v as keyof typeof FACTORY_PURITY])); } }}>
                              <SelectTrigger className="h-9 rounded-lg mt-1" aria-label="Gold purity"><SelectValue placeholder="Choose karat…" /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(FACTORY_PURITY).map(([kt, pu]) => <SelectItem key={kt} value={kt}>{kt} · {pu}</SelectItem>)}
                                <SelectItem value="__other">Other — type the factory’s own</SelectItem>
                              </SelectContent>
                            </Select>
                            {other && (
                              <Input type="number" min={0} step="0.1" value={faGoldPurity} autoFocus={faPurityOther && !faGoldPurity}
                                onChange={e => setFaGoldPurity(e.target.value)} aria-label="Gold purity (‰), typed"
                                className="rounded-lg h-9 mt-1.5" placeholder="Purity ‰, e.g. 585" />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {faEffNet > 0 && Number(faGoldPurity) > 0 && <p className="text-[11px] text-muted-foreground mt-1">= {fmtG(pureFromPurity(faEffNet, Number(faGoldPurity)))}g fine (24KT) deducted from {faFactory?.name || "the factory"}</p>}
                  {order.clientSupplied?.gold && (() => {
                    // The client gives the gold: what the piece takes from theirs.
                    const cl = db.clients.find(c => c.id === order.clientId);
                    const loss = order.clientSupplied.goldLossPct ?? 0;
                    const inPiece = faEffNet > 0 && Number(faGoldPurity) > 0 ? pureFromPurity(faEffNet, Number(faGoldPurity)) : 0;
                    const need = Math.round(inPiece * (1 + loss / 100) * 1000) / 1000;
                    const have = cl ? Math.round((clientMaterialBalance(db, cl).goldFine + (orderUse(cl, order.id, "gold")?.fine ?? 0)) * 1000) / 1000 : 0;
                    const from = Math.min(need, Math.max(0, have));
                    const short = Math.round((need - from) * 1000) / 1000;
                    const fg = stockFineGoldRate(db, new Date().toISOString(), workCompanyOf(db, order));
                    const usdInr = inrPerUnit(db.settings.currencyRates ?? [], "USD");
                    const suggest = fg && usdInr ? Math.round(short * fg.rate / usdInr * 100) / 100 : 0;
                    return (
                      <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1 text-[11px]">
                        <p className="font-semibold text-amber-800">The client's gold</p>
                        <p className="text-muted-foreground">Theirs with us: <span className="font-medium text-foreground">{have} g fine</span> · this piece takes <span className="font-medium text-foreground">{need} g fine</span>{loss ? ` (${inPiece} + ${loss}% loss)` : ""}</p>
                        {need > 0 && (short > 0 ? (
                          <div className="space-y-1">
                            <p className="text-destructive font-medium">{short} g fine short — that gold is ours, billed as "Gold supplied by us"</p>
                            <div className="flex items-center gap-2">
                              <Input type="number" min={0} step="0.01" value={faShortUsd} onChange={e => setFaShortUsd(e.target.value)} className="h-8 w-32 rounded-lg" placeholder={suggest ? String(suggest) : "$ amount"} aria-label="Gold supplied by us ($)" />
                              {suggest > 0 && <button type="button" className="text-primary font-medium hover:underline" onClick={() => setFaShortUsd(String(suggest))}>Use {fmtMoney(suggest)} (our fine-gold rate)</button>}
                            </div>
                          </div>
                        ) : <p className="text-success font-medium">All from their gold — {Math.round((have - need) * 1000) / 1000} g fine stays with them</p>)}
                      </div>
                    );
                  })()}
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
                        {[...choicesOf("metals", faOtherMetal === "Other" ? undefined : faOtherMetal, undefined, { builtIn: false }), "Other"].map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Net Weight (g){faW?.selfMetal ? " — auto" : ""}</Label>
                    {faW?.selfMetal ? (
                      <>
                        <Input type="number" readOnly tabIndex={-1} value={faW.other} aria-label={`${order.metal} net weight (worked out)`}
                          className="rounded-lg h-9 mt-1 bg-secondary/60 text-muted-foreground cursor-default" />
                        <p className="text-[10px] text-muted-foreground mt-1">{faW.gross} g − diamonds {Math.round(usedDiaCt * CARAT_TO_GRAM * 1000) / 1000} g{faXG.stone ? ` − stones ${faXG.stone} g` : ""}{faXG.metal ? ` − metal ${faXG.metal} g` : ""}{faW.gold ? ` − gold ${faW.gold} g` : ""}</p>
                      </>
                    ) : (
                      <Input type="number" min={0} step="0.001" value={faOtherNet} disabled={!faOtherMetal}
                        onChange={e => setFaOtherNet(e.target.value)} className="rounded-lg h-9 mt-1 disabled:opacity-60" />
                    )}
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
                                  className={`h-7 px-2.5 rounded text-xs font-medium ${(faDia[i.id] ?? "used") === dd ? (dd === "used" ? "bg-primary text-white" : "bg-foreground text-background") : "text-muted-foreground"}`}>
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
                const netG = faEffNet;
                const otherG = faOtherG;
                // Weighed: the scale's figure; else the parts added up.
                const gross = faGrossN > 0 ? Math.round(faGrossN * 1000) / 1000 : Math.round((netG + otherG + faXG.metal + faXG.stone + diaG) * 1000) / 1000;
                return (
                  <div className="mb-4 rounded-lg bg-secondary/60 p-3 text-xs space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Issued to the factory</span><span className="font-semibold text-foreground">{usedDiaCtRaw} ct</span></div>
                    {diaAdjust !== 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Scale adjustment</span><span className={`font-semibold ${diaAdjust > 0 ? "text-warning" : "text-destructive"}`}>{diaAdjust > 0 ? "+" : ""}{diaAdjust} ct</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-muted-foreground">Total diamond weight</span><span className="font-semibold text-foreground">{usedDiaCt} ct ({fmtG(diaG)} g)</span></div>
                    {Number(faDiaPcs) > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Total diamond pcs</span><span className="font-semibold text-foreground">{Math.round(Number(faDiaPcs))}</span></div>
                    )}
                    {netG > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Gold net weight</span><span className="font-semibold text-foreground">{fmtG(netG)} g</span></div>}
                    {otherG > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{faOtherMetal} net weight</span><span className="font-semibold text-foreground">{fmtG(otherG)} g</span></div>}
                    {faXG.metal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Other metal from stock</span><span className="font-semibold text-foreground">{fmtG(faXG.metal)} g</span></div>}
                    {faXG.stone > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Other stones</span><span className="font-semibold text-foreground">{fmtG(faXG.stone)} g</span></div>}
                    <div className="flex justify-between border-t border-border/50 pt-1"><span className="font-medium text-brand-dark">Gross weight (metal + diamond{faX.length ? " + other" : ""})</span><span className="font-bold text-brand-dark">{fmtG(gross)} g</span></div>
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
                  <div>
                    <Label className="text-[11px]">Minimum for pieces under (g)</Label>
                    <Input type="number" min={0} step="0.001" value={faMinUnder} onChange={e => setFaMinUnder(e.target.value)} disabled={!faMinLabour}
                      className="rounded-lg h-9 mt-1" placeholder="blank = when gram × rate is less" />
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
                    Making charged at the minimum {fmtMoneyInr(Number(faMinLabour) || 0)}{Number(faMinUnder) > 0 ? ` — the piece is ${faNetW.toFixed(3)} g, under ${Number(faMinUnder).toFixed(3)} g` : ""}, not {fmtMoneyInr((Number(faPerGram) || 0) * faNetW)} ({faNetW.toFixed(3)} g × {fmtMoneyInr(Number(faPerGram) || 0)}).
                  </p>
                ) : faNetW > 0 && faNetW < 2 && !faMinLabour ? (
                  <p className="text-[11px] mt-1.5 text-muted-foreground">
                    This piece is {faNetW} g. If the factory charges a minimum on light pieces, enter it above.
                  </p>
                ) : null}
                {faFilledFrom.length > 0 && <p className="text-[11px] mt-1.5 text-muted-foreground">{faFilledFrom.join(" · ")} — change any of it for this piece.</p>}
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

    {rsOffice !== null && (
        <Dialog open onOpenChange={o => { if (!o) setRsOffice(null); }}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Add to Ready Stock</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">{order.orderNumber} — {Math.max(1, order.quantity || 1)} piece{(order.quantity || 1) > 1 ? "s" : ""} onto the shelf.</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Office — where it is kept</Label>
              <Select value={rsOffice} onValueChange={setRsOffice}>
                <SelectTrigger aria-label="Office" className="rounded-xl"><SelectValue placeholder="Choose the office" /></SelectTrigger>
                <SelectContent>{readyStockOffices(db.settings).map(l => <SelectItem key={l} value={l}>{officeLabel(l)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rs-cost" className="text-xs">Cost per piece (USD)</Label>
                <Input id="rs-cost" type="number" min={0} step="0.01" value={rsCost} onChange={e => setRsCost(e.target.value)} className="rounded-xl" placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-price" className="text-xs">Selling price (USD)</Label>
                <Input id="rs-price" type="number" min={0} step="0.01" value={rsPrice} onChange={e => setRsPrice(e.target.value)} className="rounded-xl" placeholder="Set later" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              {Number(rsCost) > 0 ? "The cost is what this build cost — gold, diamonds and labour — per piece." : "No cost worked out yet — enter it, or set it in Ready Stock."}
              {Number(rsCost) > 0 && Number(rsPrice) > 0 ? ` Margin ${Math.round((1 - Number(rsCost) / Number(rsPrice)) * 1000) / 10}%.` : ""}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRsOffice(null)} className="rounded-xl">Cancel</Button>
              <AsyncButton disabled={!rsOffice} className="btn-hero rounded-xl px-6" onClick={async () => {
                const office = rsOffice;
                const price = Number(rsPrice) || 0, cost = Number(rsCost) || 0;
                if (price < 0 || cost < 0) { toast.error("Prices can't be negative"); return; }
                try { localStorage.setItem("rs-build-office", office); } catch { /* ignore */ }
                if (await addToReadyStock(office, price, cost)) setRsOffice(null);
              }}>Add to Ready Stock</AsyncButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

    {meltOpen && <MeltDialog order={order} onClose={() => setMeltOpen(false)} />}
    {sharingPiece && <ShareProductsSheet orders={[order]} onClose={() => setSharingPiece(false)} />}
    {editOpen && <OrderEditDialog order={order} onClose={() => setEditOpen(false)} />}
    {user!.role !== "client" && <ChangeClientSheet order={order} open={clientOpen} onOpenChange={setClientOpen} />}
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
              // Loose: a lot in stock — or the one it already came from.
              <LotPicker value={isf.bucket} onChange={v => setIsf({ ...isf, bucket: v })} companyId={editingIssuance?.companyId || "main"} className="h-10 rounded-xl mt-1" />
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
