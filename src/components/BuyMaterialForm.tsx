import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { useStudio } from "@/lib/studio";
import { useId, useState } from "react";
import { useAuth } from "@/lib/auth";
import { BillBrokerFields } from "@/components/BillBrokerFields";
import { ListSelect, LooseLotFields, CertGradeFields } from "@/components/LotFields";
import { lotKey, lotLabel, type LotSpec } from "@/lib/diamondLots";
import { billBrokerageProblem, brokerageForLines, brokerageWePay, emptyBillBrokerage, landedInr, type BillBrokerage } from "@/lib/brokers";
import { useDb } from "@/hooks/useDb";
import {
  updateDb, uid, nextDiamondStockNumber, todayLocal, stampFor,
  isDiamondOnlyOrder, type Order, type Purchase, type PurchaseCurrency,
  loadDb,
} from "@/lib/db";
import { increaseStock, logOrderDirectPurchase } from "@/lib/stock";
import { fmtMoneyInr, applyDiscountPct, discountLabel } from "@/lib/manufacturing";
import { fmtCcy, ccySymbol } from "@/lib/currency";
import { AsyncButton } from "@/components/AsyncButton";
import { ActionSheet } from "@/components/ActionSheet";
import { MoreMenu } from "@/components/MoreMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Coins, Gem, BadgeCheck, Plus, X, Layers, ShoppingCart, ChevronDown, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { OtherMaterialSelect, GradeInput } from "@/components/MaterialFields";
import { materialDef, materialName, materialUnit, type MaterialKey, type MaterialUnit } from "@/lib/materials";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { coField, companyById, workCompanyOf } from "@/lib/companies";
import { confirmBox } from "@/lib/confirm";
import { Field, Group, PanelActions, Stat, UnitInput } from "@/components/BillLayout";

const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];
/** Gold, loose or certified diamonds, or any other material (Settings → Materials). */
type BuyKind = "gold" | "loose" | "certified" | "other";
/** Each kind of line: what it is called and its badge. */
const KIND: Record<BuyKind, { label: string; icon: LucideIcon }> = {
  gold: { label: "Gold", icon: Coins },
  loose: { label: "Loose diamond", icon: Gem },
  certified: { label: "Certified diamond", icon: BadgeCheck },
  other: { label: "Other material", icon: Layers },
};
const KIND_ORDER: BuyKind[] = ["gold", "loose", "certified", "other"];

/*
 * Every line, whatever it buys, is the same grid: what it is in the first
 * three columns, then quantity · rate · discount in the last three — so the
 * figures line up down the bill. Two to a row on a phone.
 */
const LINE_GRID = "grid grid-cols-2 gap-2.5 @md:grid-cols-3 @xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.75fr)]";

/** One line of a supplier's bill — a size, a rate and its own discount. */
interface Line {
  kind: BuyKind;
  purity: string;
  shape: string;
  /** Loose: the lot's sieve size and mm size (lib/diamondLots.ts); its colour and clarity are below. */
  size: string;
  mm: string;
  qty: string;      // grams (gold) or carats (diamond)
  rate: string;     // per gram / per carat
  quality: string;
  pcs: string;
  discountPct: string;
  color: string; clarity: string; cut: string; polish: string; sym: string;
  fluor: string; measure: string; lab: string; certNo: string;
  /** kind "other": which material, and its grade. */
  materialId: string; grade: string;
}

const emptyLine = (): Line => ({
  kind: "loose", purity: "22K", shape: "Round", size: "", mm: "", qty: "", rate: "", quality: "", pcs: "", discountPct: "",
  color: "", clarity: "", cut: "", polish: "", sym: "", fluor: "", measure: "", lab: "", certNo: "",
  materialId: "", grade: "",
});

/** A loose line's lot: shape · sieve · mm · colour · clarity. */
const lotOfLine = (l: Line): LotSpec => ({ shape: l.shape || "Round", size: l.size || undefined, mm: l.mm || undefined, color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined });

/** The stock material a line buys. */
const lineMaterial = (l: Line): MaterialKey => (l.kind === "gold" ? "gold" : l.kind === "other" ? (l.materialId as MaterialKey) : "diamond");

/** Weight × rate, less this line's own discount. */
function lineBase(l: Line): number {
  const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
  return applyDiscountPct(gross, l.discountPct);
}

/** "Starlink Jewels' stock", "Paresh's account". */
const whose = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** What a line measures in: grams, carats, or the other material's own unit. */
const lineUnit = (l: Line, settings: Parameters<typeof materialUnit>[0]): MaterialUnit =>
  (l.kind === "gold" ? "g" : l.kind === "other" ? materialUnit(settings, l.materialId) : "ct");

/** "18K gold", "Round · 1.3 mm · G-H · VS", "Certified Oval GIA 2141…", "950 Platinum" — a line in a word or two. */
const lineText = (l: Line, settings: Parameters<typeof materialName>[0]): string =>
  l.kind === "gold" ? `${l.purity} gold`
    : l.kind === "loose" ? lotLabel(lotKey(lotOfLine(l)))
    : l.kind === "certified" ? `Certified ${l.shape}${l.certNo.trim() ? ` · ${l.certNo.trim()}` : ""}`
    : `${l.grade.trim() ? `${l.grade.trim()} ` : ""}${materialName(settings, l.materialId)}`;

/**
 * Buying material into stock, a whole bill at a time — in a panel over the
 * page, so the history stays where it was.
 *
 * A supplier's chitthi is one bill with a line per size — seven rounds at seven
 * rates, each less the same 6%, adding to one figure at the bottom. This used
 * to take one line per save, so a seven-line bill became seven unconnected
 * purchases and there was nothing to check the chitthi's total against. The
 * lines are still separate purchases, because stock is counted per size; what
 * is shared — supplier, date, bill number, currency and the rounding — is
 * entered once, and the lines saved together are one bill afterwards.
 */
/**
 * A purchase planned while an order is being placed (New Order's production
 * plan): checked now, recorded when the order is submitted — by `execute`,
 * with the order as saved (its number, its factory).
 */
export interface PlannedBuy {
  supplierName: string;
  billNo: string;
  lines: { kind: BuyKind; text: string; qty: number; unit: string; inr: number; materialId?: string }[];
  totalInr: number;
  execute: (order: Order) => Promise<void>;
}

export function BuyMaterialForm({ open, onOpenChange, supplierId: fixedSupplier, order: givenOrder, plan }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** Planning for an order not yet placed: `stub` stands in for it; Save hands back a PlannedBuy. */
  plan?: { stub: Order; onPlanned: (p: PlannedBuy) => void };
  /** Opened from a supplier's page: the bill is theirs, already chosen. */
  supplierId?: string;
  /** Opened from an order's "Buy new": the bill is for that order, and what is
   *  bought goes straight to the order's factory (no separate issue step). */
  order?: Order;
}) {
  const { user } = useAuth();
  const db = useDb();
  const studio = useStudio();
  // Planning for an order being placed behaves as its own "Buy new".
  const fixedOrder = givenOrder ?? plan?.stub;
  const planning = !!plan;
  const addNew = useAddNew();
  const [supplierChosen, setSupplierId] = useState("");
  const supplierId = fixedSupplier ?? supplierChosen;
  // What the bill is for: stock (the usual), or one order — bought for it, kept off stock.
  const [forWhatChosen, setForWhat] = useState<"stock" | "order">("stock");
  const [orderChosen, setOrderId] = useState("");
  const forWhat = fixedOrder ? "order" : forWhatChosen;
  const orderId = fixedOrder ? fixedOrder.id : orderChosen;
  // Whose stock the bill goes into — each company holds its own.
  const defaultCompany = useDefaultCompany();
  const [companyId, setCompanyId] = useState(defaultCompany);
  const [date, setDate] = useState(todayLocal());
  const [billNo, setBillNo] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [xrate, setXrate] = useState("");
  const [roundOff, setRoundOff] = useState("");
  const [notes, setNotes] = useState("");
  // The broker who brought the bill, if any, and the brokerage (lib/brokers.ts).
  const [brokerage, setBrokerage] = useState<BillBrokerage>(emptyBillBrokerage());
  // An order's purchase is nearly always its stones, so it starts on a loose diamond.
  const firstKind: BuyKind = fixedOrder ? "loose" : "gold";
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine(), kind: firstKind }]);
  const [saving, setSaving] = useState(false);

  const suppliers = db.suppliers.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  // A line is added as one material; another material of the same kind starts
  // on the material the last such line was.
  const addLine = (kind: BuyKind) => setLines(ls => [...ls, {
    ...emptyLine(), kind,
    materialId: kind === "other" ? ([...ls].reverse().find(l => l.kind === "other")?.materialId ?? "") : "",
  }]);
  const removeLine = (i: number) => setLines(ls => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls));

  const lineInr = (l: Line) => (currency === "USD"
    ? Math.round(lineBase(l) * (Number(xrate) || 0))
    : Math.round(lineBase(l)));
  const linesTotalInr = lines.reduce((s, l) => s + lineInr(l), 0);
  const roundOffInr = Math.round(Number(roundOff) || 0);
  const billTotalInr = linesTotalInr + roundOffInr;

  // The footer's figures, in the bill's currency. Display only: what is saved
  // is still each line's lineInr and the bill's billTotalInr.
  const multiCo = useMultiCo();
  const roundId = useId();
  const usd = currency === "USD";
  const fmtBill = (n: number) => (usd ? fmtCcy(Math.round(n * 100) / 100, "USD") : fmtMoneyInr(n));
  const gross = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  // In rupees each line is rounded as it is saved, so the subtotal is of rounded
  // lines too — subtotal less discount then comes to exactly the lines' total.
  const subtotal = lines.reduce((s, l) => s + (usd ? gross(l) : Math.round(gross(l))), 0);
  const netBill = usd ? lines.reduce((s, l) => s + lineBase(l), 0) : linesTotalInr;
  const discount = subtotal - netBill;
  const hasDiscount = Math.abs(discount) >= (usd ? 0.005 : 0.5);
  const chosenSupplier = db.suppliers.find(s => s.id === supplierId);
  const certifiedLines = lines.filter(l => l.kind === "certified").length;

  const reset = () => {
    setLines([{ ...emptyLine(), kind: firstKind }]);
    setForWhat("stock"); setOrderId("");
    setBillNo(""); setXrate(""); setRoundOff(""); setNotes(""); setBrokerage(emptyBillBrokerage());
  };

  // For an order: open orders, newest first; the bill goes on the order's own company.
  const openOrders = db.orders.filter(o => !["Delivered", "Rejected", "Cancelled"].includes(o.status) && !o.melted)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const forOrder = forWhat === "order" ? (planning ? plan!.stub : db.orders.find(o => o.id === orderId)) : undefined;

  const submit = async () => {
    if (!supplierId) { toast.error("Choose a supplier"); return; }
    if (forWhat === "order" && !forOrder) { toast.error("Choose the order this bill is for"); return; }
    // Bought for an order: the order's company, not the stock picker's.
    const co = forOrder ? workCompanyOf(db, forOrder) : companyId;
    // From the order's own "Buy new": what is bought goes straight to its factory —
    // so the factory comes first (a diamond-only order has none: its stones are bought for the client).
    const sendTo = fixedOrder ? (fixedOrder.assignedFactoryId || "") : "";
    if (!planning && fixedOrder && !sendTo && !isDiamondOnlyOrder(fixedOrder)) { toast.error("Assign a factory first (step ① on the order) — the material goes straight to it."); return; }
    // The same bill entered twice is the same bill paid twice.
    if (fixedOrder && billNo.trim()) {
      const key = billNo.trim().toLowerCase();
      if ((db.purchases ?? []).some(p => p.supplierId === supplierId && (p.invoiceNumber ?? "").trim().toLowerCase() === key)
        && !(await confirmBox(`Bill ${billNo.trim()} from ${db.suppliers.find(x => x.id === supplierId)?.name ?? "this supplier"} is already recorded.\n\nSave these lines against it as well? Cancel if it is the same purchase being entered again.`))) return;
    }
    // The bill number is optional: not every purchase comes with one.
    const brokerProblem = billBrokerageProblem(brokerage);
    if (brokerProblem) { toast.error(brokerProblem); return; }
    if (currency === "USD" && !xrate) { toast.error("Enter the exchange rate"); return; }
    for (const [i, l] of lines.entries()) {
      const q = Number(l.qty);
      if (l.kind === "other" && !materialDef(db.settings, l.materialId)) { toast.error(`Item ${i + 1}: choose the material`); return; }
      if (!q || q <= 0) { toast.error(`Item ${i + 1}: enter the ${l.kind === "gold" ? "weight" : l.kind === "other" ? "quantity" : "carat"}`); return; }
      if (l.kind === "certified" && !l.certNo.trim()) { toast.error(`Item ${i + 1}: enter the report number`); return; }
      if (lineInr(l) <= 0) { toast.error(`Item ${i + 1}: comes to ₹0 — check the rate`); return; }
    }
    // Recording the bill: now, or — planned with a new order — when the order is placed.
    const record = async (target: Order | undefined, asFixed: boolean, co: string, sendTo: string) => {
    const db = loadDb();
    const supplier = db.suppliers.find(s => s.id === supplierId);
    const now = stampFor(date);
    const ids = lines.map(() => uid("pur_"));
    // The bill's brokerage, shared over its lines by amount (lib/brokers.ts).
    const brokerShares = brokerageForLines(brokerage, lines.map((l, i) => lineInr(l) + (i === 0 ? roundOffInr : 0)));
    setSaving(true);
    try {
      // Gold and loose pool into Stock; a certified stone never pools — it
      // becomes its own packet below.
      // From the order's own Buy: material goes straight to the factory and never into the
      // stock pool, but a paired in + out (netting to zero) keeps it on the Stock report.
      // Both legs carry the purchase's own timestamp (see logOrderDirectPurchase).
      if (asFixed && target) {
        for (const [i, l] of lines.entries()) {
          if (l.kind === "certified") continue;
          const lot = l.kind === "loose" ? lotOfLine(l) : undefined;
          await logOrderDirectPurchase({
            companyId: co, material: lineMaterial(l),
            purityOrQuality: l.kind === "gold" ? l.purity : l.kind === "other" ? (l.grade.trim() || "—") : lotKey(lot!),
            quantity: Number(l.qty), lot, pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
            purchaseId: ids[i], orderId: target.id, createdBy: user!.id, createdAt: now,
          });
        }
      }
      // Bought for an order, nothing goes into stock — the order's factory takes it from the bill.
      for (const [i, l] of (target ? [] : lines).entries()) {
        if (l.kind === "certified") continue;
        // Loose stones go into their lot (its bag): shape · sieve · mm · colour · clarity (lib/diamondLots.ts).
        const lot = l.kind === "loose" ? lotOfLine(l) : undefined;
        await increaseStock({
          material: lineMaterial(l), companyId: co,
          purityOrQuality: l.kind === "gold" ? l.purity : l.kind === "other" ? (l.grade.trim() || "—") : lotKey(lot!),
          quantity: Number(l.qty), refType: "purchase", refId: ids[i], createdBy: user!.id,
          lot, pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
        });
      }
      const packetIds: (string | undefined)[] = lines.map(() => undefined);
      updateDb(d => {
        if (!d.purchases) d.purchases = [];
        lines.forEach((l, i) => {
          const q = Number(l.qty);
          const disc = Math.min(Math.max(Number(l.discountPct) || 0, -100), 100);
          const isGold = l.kind === "gold";
          const isOther = l.kind === "other";
          const total = lineInr(l) + (i === 0 ? roundOffInr : 0);
          const purchase: Purchase = {
            id: ids[i], supplierId, material: lineMaterial(l), ...coField(co),
            gold: isGold ? { weightGrams: q, purity: l.purity, ratePerGram: Number(l.rate) || 0 } : undefined,
            other: isOther ? {
              qty: q, grade: l.grade.trim() || "—", ratePerUnit: Number(l.rate) || 0,
              pieces: Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
            } : undefined,
            diamond: !isGold && !isOther ? {
              // Loose: its colour and clarity read as its quality, where older screens show one.
              carat: q, quality: (l.kind === "loose" ? [l.color, l.clarity].map(x => x.trim()).filter(Boolean).join(" ") : l.quality.trim()) || undefined, ratePerCarat: Number(l.rate) || 0,
              pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
              kind: l.kind === "certified" ? "certified" : "loose", shape: l.shape,
              ...(l.kind === "loose" ? { size: l.size || undefined, mm: l.mm || undefined, color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined }
                : { color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined }),
              certificateNumber: l.kind === "certified" ? l.certNo.trim() : undefined,
              certificateLab: l.kind === "certified" ? (l.lab.trim() || undefined) : undefined,
            } : undefined,
            purpose: target ? "order" : "stock", ...(target ? { orderId: target.id } : {}), currency,
            totalUsd: currency === "USD" ? Math.round(lineBase(l) * 100) / 100 : undefined,
            exchangeRate: currency === "USD" ? Number(xrate) : undefined,
            totalInr: total, payments: [],
            discountPct: disc !== 0 ? disc : undefined,
            // The bill is rounded once, so it rides on its first line.
            roundOffInr: i === 0 && roundOffInr !== 0 ? roundOffInr : undefined,
            invoiceNumber: billNo.trim() || undefined,
            ...brokerShares[i],
            notes: notes.trim() || undefined,
            createdBy: user!.id, createdAt: now,
          };
          d.purchases.unshift(purchase);
          if (l.kind === "certified") {
            if (!d.diamondPackets) d.diamondPackets = [];
            packetIds[i] = uid("dp_");
            d.diamondPackets.unshift({
              id: packetIds[i], stockNumber: nextDiamondStockNumber(d), shape: l.shape, carat: q,
              quality: l.quality.trim() || undefined,
              color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined,
              cut: l.cut.trim() || undefined, polish: l.polish.trim() || undefined,
              symmetry: l.sym.trim() || undefined, fluorescence: l.fluor.trim() || undefined,
              measurement: l.measure.trim() || undefined,
              certificateNumber: l.certNo.trim(), certificateLab: l.lab.trim() || undefined,
              // What the stone cost us: the bill line plus any brokerage we pay on it.
              ratePerCaratInr: q > 0 ? Math.round((landedInr(purchase) / q) * 100) / 100 : undefined,
              supplierId, purchaseId: ids[i], ...coField(co),
              // From the order's own Buy it goes straight to the order ("issued", below).
              // For an order chosen elsewhere: kept in stock, reserved to it, for the normal issue to the factory.
              status: asFixed ? "issued" : "in_stock",
              ...(target ? { orderId: target.id } : {}),
              createdBy: user!.id, createdAt: now,
            });
          }
        });
        // The order: its purchases, and a line in its manufacturing log for each.
        if (target) {
          const o = d.orders.find(x => x.id === target.id);
          if (o) {
            if (!o.linkedPurchaseIds) o.linkedPurchaseIds = [];
            if (!o.manufacturingLog) o.manufacturingLog = [];
            if (!o.materialIssuanceIds) o.materialIssuanceIds = [];
            if (!d.materialIssuances) d.materialIssuances = [];
            const factory = sendTo ? db.factories.find(f => f.id === sendTo) : undefined;
            lines.forEach((l, i) => {
              o.linkedPurchaseIds!.push(ids[i]);
              const q = Number(l.qty);
              const unit = lineUnit(l, db.settings);
              const bucket = l.kind === "gold" ? l.purity : l.kind === "certified" ? "Certified" : l.kind === "other" ? (l.grade.trim() || "—") : lotKey(lotOfLine(l));
              const what = l.kind === "gold" ? `${q}g ${l.purity} gold`
                : l.kind === "other" ? `${q} ${unit} ${l.grade.trim() ? `${l.grade.trim()} ` : ""}${materialName(db.settings, l.materialId)}`
                : l.kind === "certified" ? `${q}ct ${l.shape} diamond (Certified ${l.certNo.trim()})`
                : `${q}ct ${bucket} diamond`;
              const p = d.purchases.find(x => x.id === ids[i]);
              const amt = p?.totalInr ?? lineInr(l) + (i === 0 ? roundOffInr : 0);
              const brk = p ? brokerageWePay(p) : 0;
              o.manufacturingLog!.push({
                id: uid("mlog_"), type: "material_purchased", at: now, employeeId: user!.id,
                material: lineMaterial(l), amountMaterial: q, amountInr: amt,
                remarks: `Purchased ${what} from ${supplier?.name || "supplier"}${billNo.trim() ? ` (bill ${billNo.trim()})` : ""} for this order — ${fmtMoneyInr(amt)}${brk > 0 ? ` + brokerage ${fmtMoneyInr(brk)}` : ""}`,
              });
              // From the order's own Buy: issued straight to its factory (source "purchase" —
              // the stock pool is untouched). A diamond-only order has no factory, so nothing is issued.
              if (!sendTo) return;
              const issuanceId = uid("mi_");
              d.materialIssuances.unshift({
                id: issuanceId, factoryId: sendTo, orderId: o.id, material: lineMaterial(l), ...coField(co),
                purityOrQuality: bucket, quantityIssued: q, source: "purchase", sourcePurchaseId: ids[i],
                diamondKind: l.kind === "loose" || l.kind === "certified" ? l.kind : undefined,
                piecesIssued: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
                diamondPacketIds: packetIds[i] ? [packetIds[i]!] : undefined,
                issuedAt: now, issuedBy: user!.id, status: "open",
                finishedPieces: [{ id: uid("fp_"), quantityUsed: q, piecesCount: 1, recordedAt: now, recordedBy: user!.id }],
                makingCharges: { amountInr: 0, payments: [] },
              });
              o.materialIssuanceIds!.push(issuanceId);
              o.manufacturingLog!.push({
                id: uid("mlog_"), type: "material_issued", at: now, employeeId: user!.id, factoryId: sendTo,
                material: lineMaterial(l), amountMaterial: q,
                remarks: `${q}${unit} ${l.kind === "certified" ? `certified ${l.shape}` : bucket} ${l.kind === "gold" ? "gold" : l.kind === "other" ? materialName(db.settings, l.materialId) : "diamond"} sent to ${factory?.name || "factory"} (bought for this order)`,
              });
            });
          }
        }
      });
      toast.success(asFixed && sendTo
        ? `${lines.length > 1 ? `${lines.length} items` : "Item"} bought (${fmtMoneyInr(billTotalInr)}) & sent to ${db.factories.find(f => f.id === sendTo)?.name || "the factory"}`
        : `${lines.length > 1 ? `${lines.length} items` : "Item"} bought → ${target ? `order ${target.orderNumber}` : `${co !== "main" ? `${companyById(db.settings, co).name}'s ` : ""}stock`} · ${fmtMoneyInr(billTotalInr)} to ${supplier?.name || "supplier"}`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to buy");
    } finally { setSaving(false); }
    };

    if (planning) {
      // Checked; recorded when the order is placed, against the order as saved.
      plan!.onPlanned({
        supplierName: db.suppliers.find(x => x.id === supplierId)?.name ?? "Supplier",
        billNo: billNo.trim(),
        lines: lines.map(l => ({ kind: l.kind, text: lineText(l, db.settings), qty: Number(l.qty), unit: lineUnit(l, db.settings), inr: lineInr(l),
          ...(l.kind === "other" && l.materialId ? { materialId: l.materialId } : {}) })),
        totalInr: billTotalInr,
        execute: async (o: Order) => record(o, true, workCompanyOf(loadDb(), o), o.assignedFactoryId || ""),
      });
      onOpenChange(false);
      return;
    }
    await record(forOrder, !!fixedOrder, co, sendTo);
  };

  const footer = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 min-w-0">
          <Stat label={`Subtotal · ${lines.length} item${lines.length !== 1 ? "s" : ""}`} value={fmtBill(subtotal)} />
          {hasDiscount && <Stat label={discount > 0 ? "Discount" : "Added"} value={`${discount > 0 ? "−" : "+"}${fmtBill(Math.abs(discount))}`} />}
          {usd && (
            <Stat label={Number(xrate) > 0 ? `In ₹ at ${xrate} / $` : "In ₹"}
              value={Number(xrate) > 0 ? fmtMoneyInr(linesTotalInr) : <span className="text-xs text-amber-700">Enter the rate ₹/$</span>} />
          )}
          <div>
            <Label htmlFor={roundId} className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Round off ₹</Label>
            <div className="mt-0.5 flex items-center gap-2">
              <Input id={roundId} type="number" step="1" value={roundOff} onChange={e => setRoundOff(e.target.value)} className="h-8 w-24 rounded-lg text-right tabular-nums" placeholder="e.g. -3" />
              {linesTotalInr > 0 && roundOffInr === 0 && linesTotalInr % 10 !== 0 && (
                <button type="button" onClick={() => setRoundOff(String(-(linesTotalInr % 10)))}
                  title={`Round ${fmtMoneyInr(linesTotalInr)} down to ${fmtMoneyInr(linesTotalInr - (linesTotalInr % 10))}`}
                  className="text-xs text-primary hover:underline whitespace-nowrap">
                  Round to {fmtMoneyInr(linesTotalInr - (linesTotalInr % 10))}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="text-right ml-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{usd ? "Total (USD)" : "Total"}</p>
          <p className="font-display text-2xl sm:text-3xl font-bold text-brand-dark tabular-nums leading-tight">{usd ? fmtBill(netBill) : fmtMoneyInr(billTotalInr)}</p>
          {usd && <p className="text-[11px] text-muted-foreground tabular-nums">{fmtMoneyInr(billTotalInr)} payable in ₹</p>}
        </div>
      </div>
      <PanelActions onCancel={() => onOpenChange(false)}
        note={!chosenSupplier ? "Choose the supplier the bill is from."
          : fixedOrder
            ? `${lines.length} purchase${lines.length !== 1 ? "s" : ""} onto ${whose(chosenSupplier.name)} account, for ${fixedOrder.orderNumber} — ${fixedOrder.assignedFactoryId ? `straight to ${db.factories.find(f => f.id === fixedOrder.assignedFactoryId)?.name ?? "its factory"}` : "held against the order"}.`
          : forWhat === "order"
            ? (forOrder ? `${lines.length} purchase${lines.length !== 1 ? "s" : ""} onto ${whose(chosenSupplier.name)} account, for order ${forOrder.orderNumber} — not into stock${certifiedLines ? "; certified stones kept for the order" : ""}.` : "Choose the order this bill is for.")
            : `${lines.length} purchase${lines.length !== 1 ? "s" : ""} onto ${whose(chosenSupplier.name)} account, into ${multiCo ? `${whose(companyById(db.settings, companyId).name)} ` : ""}stock${certifiedLines ? " — each certified stone as its own packet" : ""}.`}>
        <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-52">
          {saving ? "Saving…" : fixedOrder ? (lines.length > 1 ? `Save ${lines.length} Purchases` : "Save Purchase") : forWhat === "order" ? (forOrder ? `Buy for ${forOrder.orderNumber}` : "Buy for the order") : lines.length > 1 ? `Buy ${lines.length} Items → Stock` : (studio ? (lines.length > 1 ? `Save ${lines.length} purchases` : "Save purchase") : "Buy → Stock")}
        </AsyncButton>
      </PanelActions>
    </div>
  );

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={ShoppingCart} title={fixedOrder ? `Buy for ${fixedOrder.orderNumber}` : "New purchase"}
      description={fixedOrder
        ? (fixedOrder.assignedFactoryId
          ? `Goes straight to ${db.factories.find(f => f.id === fixedOrder.assignedFactoryId)?.name || "the order's factory"} and onto the supplier's account.`
          : "Held against this order and billed to the supplier — no factory involved.")
        : forWhat === "order"
        ? "A supplier's bill for one order: kept off stock, on the order's cost, and the total onto the supplier's account."
        : "A supplier's bill into stock: a line for each size, quality or material, and the total onto the supplier's account."}
      footer={footer}>
      <div className="@container space-y-5">
        {/* The bill's head: who it is from, its number and date, the currency, whose stock. */}
        <Group title="Bill">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier" required className="col-span-2 @md:col-span-1">{id => fixedSupplier ? (
              <div id={id} className="h-10 rounded-xl px-3 flex items-center bg-secondary/60 text-sm font-medium truncate">{chosenSupplier?.name ?? "Supplier"}</div>
            ) : (
              <Select value={supplierId} onValueChange={addNew("supplier", setSupplierId)}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}<AddNewItem kind="supplier" /></SelectContent>
              </Select>
            )}</Field>
            <Field label="Bill no.">{id => (
              <Input id={id} value={billNo} onChange={e => setBillNo(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />
            )}</Field>
            <Field label="Date">{id => (
              <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />
            )}</Field>
            <Field label="Billed in" className="col-span-2 @md:col-span-1">{id => (
              <div className="flex gap-2">
                <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
                  <SelectTrigger id={id} className={`h-10 rounded-xl ${usd ? "w-[6.5rem] shrink-0" : ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="INR">INR (₹)</SelectItem><SelectItem value="USD">USD ($)</SelectItem></SelectContent>
                </Select>
                {usd && (
                  <div className="flex-1 min-w-0">
                    <UnitInput min={0} step="0.01" value={xrate} onChange={e => setXrate(e.target.value)} unit="₹/$" placeholder="Rate" aria-label="Exchange rate, ₹ per $" />
                  </div>
                )}
              </div>
            )}</Field>
            {/* What the bill is for: stock, or one order (kept off stock, on the order's own cost). */}
            {fixedOrder ? (
              <Field label="For" className="col-span-2 @md:col-span-1">{id => (
                <div id={id} className="h-10 rounded-xl px-3 flex items-center bg-secondary/60 text-sm font-medium truncate">
                  {fixedOrder.orderNumber}{fixedOrder.assignedFactoryId ? ` → ${db.factories.find(f => f.id === fixedOrder.assignedFactoryId)?.name ?? "factory"}` : ""}
                </div>
              )}</Field>
            ) : <Field label="For" className="col-span-2 @md:col-span-1">{id => (
              <div id={id} className="grid grid-cols-2 gap-1 p-1 bg-secondary rounded-xl h-10">
                {(["stock", "order"] as const).map(k => (
                  <button key={k} type="button" onClick={() => setForWhat(k)} aria-pressed={forWhat === k}
                    className={`rounded-lg text-xs font-medium transition-colors ${forWhat === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>
                    {k === "stock" ? "Stock" : "An order"}
                  </button>
                ))}
              </div>
            )}</Field>}
            {forWhat === "order" && !fixedOrder && (
              <Field label="Order" required className="col-span-2 @md:col-span-1">{id => (
                <OrderPick id={id} value={orderId} onChange={setOrderId} orders={openOrders} clientName={cid => db.clients.find(c => c.id === cid)?.companyName ?? ""} />
              )}</Field>
            )}
            {multiCo && forWhat === "stock" && (
              <div className="col-span-2 @md:col-span-1">
                <CompanyPicker value={companyId} onChange={setCompanyId} label="Company — whose stock this is" />
              </div>
            )}
            <Field label="Remark" className={multiCo ? "col-span-2 @md:col-span-1" : "col-span-2"}>{id => (
              <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />
            )}</Field>
          </div>
          <BillBrokerFields value={brokerage} onChange={setBrokerage} billTotalInr={billTotalInr} supplierId={supplierId} className="mt-3" />
        </Group>

        <Group title="Items" aside={<span className="text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? "s" : ""}</span>}>
          <div className="space-y-2.5">
            {lines.map((l, i) => (
              <LineCard key={i} line={l} n={i + 1} currency={currency} removable={lines.length > 1}
                onChange={patch => set(i, patch)} onRemove={() => removeLine(i)} base={lineBase(l)} inr={lineInr(l)} />
            ))}
          </div>
          {/* Each line is added as its material, so it only ever shows that material's fields. */}
          {/* A phone: two by two, rather than three and one left over. */}
          <div className="mt-3 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <span className="col-span-2 text-xs text-muted-foreground mr-1">Add a line:</span>
            {KIND_ORDER.map(k => {
              const Icon = KIND[k].icon;
              return (
                <Button key={k} type="button" variant="outline" size="sm" onClick={() => addLine(k)} className="h-8 rounded-lg gap-1.5 text-xs px-2.5">
                  <Plus className="h-3.5 w-3.5" /><Icon className="h-3.5 w-3.5 text-muted-foreground" />{KIND[k].label}
                </Button>
              );
            })}
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}

/**
 * One line of the bill: its material as a badge, then only that material's
 * fields, in the same grid as every other line so the figures line up.
 */
function LineCard({ line: l, n, currency, removable, onChange, onRemove, base, inr, opening = false }: {
  line: Line; n: number; currency: PurchaseCurrency; removable: boolean;
  /** Opening stock: no discount, and the rate is optional — it only values the stock. */
  opening?: boolean;
  onChange: (patch: Partial<Line>) => void; onRemove: () => void;
  /** This line in the bill's currency, after its discount — and in rupees, as saved. */
  base: number; inr: number;
}) {
  const db = useDb();
  const unit = lineUnit(l, db.settings);
  const usd = currency === "USD";
  const disc = Number(l.discountPct) || 0;
  const Icon = KIND[l.kind].icon;
  const name = l.kind === "other" && l.materialId ? materialName(db.settings, l.materialId) : KIND[l.kind].label;
  const qtyLabel = l.kind === "gold" ? "Weight (g)" : l.kind === "loose" || l.kind === "certified" ? "Carat" : `Quantity (${unit})`;
  const qtyStep = l.kind === "gold" ? "0.001" : l.kind === "other" ? (unit === "pcs" ? "1" : "0.001") : "0.01";
  const sub = [disc !== 0 ? discountLabel(disc) : "", usd && inr > 0 ? fmtMoneyInr(inr) : ""].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 mb-2.5 min-w-0">
        <span className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Icon className="h-3.5 w-3.5" /></span>
        <span className="text-sm font-medium text-foreground truncate">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">#{n}</span>
        <span className="ml-auto text-right shrink-0 pl-2">
          <span className="block text-sm font-semibold text-brand-dark tabular-nums leading-tight">{usd ? fmtCcy(Math.round(base * 100) / 100, "USD") : fmtMoneyInr(inr)}</span>
          {sub && <span className="block text-[10px] text-muted-foreground tabular-nums leading-tight">{sub}</span>}
        </span>
        <MoreMenu size="sm" label={`Line ${n}: change material`} title="Change this line to"
          className="border-transparent shadow-none text-muted-foreground"
          actions={KIND_ORDER.filter(k => k !== l.kind).map(k => ({ label: KIND[k].label, icon: KIND[k].icon, onSelect: () => onChange({ kind: k }) }))} />
        {removable && (
          <button type="button" onClick={onRemove} aria-label={`Remove item ${n}`} title="Remove this line"
            className="h-8 w-8 -mr-1 rounded-lg grid place-items-center shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {l.kind === "loose" ? (
        // A loose lot: what it is (it names the bag), then how much at what.
        <div className="space-y-2.5">
          <LooseLotFields idPrefix={`line${n}`} compact
            value={{ shape: l.shape, mm: l.mm, size: l.size, color: l.color, clarity: l.clarity }}
            onChange={p => onChange(p)} />
          <div className="grid grid-cols-2 @md:grid-cols-4 gap-2.5">
            <Field label="Pcs">{id => (
              <UnitInput id={id} min={0} step="1" value={l.pcs} onChange={e => onChange({ pcs: e.target.value })} placeholder="Optional" />
            )}</Field>
        <Field label={qtyLabel}>{id => (
          <UnitInput id={id} min={0} step={qtyStep} unit={unit} value={l.qty} onChange={e => onChange({ qty: e.target.value })} />
        )}</Field>
        <Field label={`Rate / ${unit} (${currency})`}>{id => (
          <UnitInput id={id} min={0} unit={`${ccySymbol(currency)}/${unit}`} value={l.rate} onChange={e => onChange({ rate: e.target.value })} placeholder={opening ? "Optional" : undefined} />
        )}</Field>
        {!opening && <Field label="Discount %">{id => (
          <UnitInput id={id} min={-100} max={100} step="0.01" unit="%" value={l.discountPct} onChange={e => onChange({ discountPct: e.target.value })}
            placeholder="0" title="A minus figure adds instead — −2 adds 2%" />
        )}</Field>}
          </div>
        </div>
      ) : l.kind === "certified" ? (
        // A certified stone: shape and weight at a rate, then its report.
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 @md:grid-cols-4 gap-2.5">
            <Field label="Shape">{id => (
              <ListSelect id={id} list="diamondShapes" value={l.shape} onChange={v => onChange({ shape: v || "Round" })} optional={false} />
            )}</Field>
        <Field label={qtyLabel}>{id => (
          <UnitInput id={id} min={0} step={qtyStep} unit={unit} value={l.qty} onChange={e => onChange({ qty: e.target.value })} />
        )}</Field>
        <Field label={`Rate / ${unit} (${currency})`}>{id => (
          <UnitInput id={id} min={0} unit={`${ccySymbol(currency)}/${unit}`} value={l.rate} onChange={e => onChange({ rate: e.target.value })} placeholder={opening ? "Optional" : undefined} />
        )}</Field>
        {!opening && <Field label="Discount %">{id => (
          <UnitInput id={id} min={-100} max={100} step="0.01" unit="%" value={l.discountPct} onChange={e => onChange({ discountPct: e.target.value })}
            placeholder="0" title="A minus figure adds instead — −2 adds 2%" />
        )}</Field>}
          </div>
          <CertGradeFields idPrefix={`line${n}`} compact
            value={{ color: l.color, clarity: l.clarity, cut: l.cut, polish: l.polish, symmetry: l.sym, fluorescence: l.fluor, measurement: l.measure, lab: l.lab, certNo: l.certNo }}
            onChange={p => onChange({
              ...(p.color !== undefined ? { color: p.color } : {}), ...(p.clarity !== undefined ? { clarity: p.clarity } : {}),
              ...(p.cut !== undefined ? { cut: p.cut } : {}), ...(p.polish !== undefined ? { polish: p.polish } : {}),
              ...(p.symmetry !== undefined ? { sym: p.symmetry } : {}), ...(p.fluorescence !== undefined ? { fluor: p.fluorescence } : {}),
              ...(p.measurement !== undefined ? { measure: p.measurement } : {}), ...(p.lab !== undefined ? { lab: p.lab } : {}),
              ...(p.certNo !== undefined ? { certNo: p.certNo } : {}),
            })} />
        </div>
      ) : (
      <div className={LINE_GRID}>
          {/* What it is — the first three columns. */}
          {l.kind === "gold" ? (
            <Field label="Purity">{id => (
              <Select value={l.purity} onValueChange={v => onChange({ purity: v })}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            )}</Field>
          ) : (
            <>
              <Field label="Material"><OtherMaterialSelect value={l.materialId} onChange={v => onChange({ materialId: v, grade: "" })} /></Field>
              <Field label="Grade"><GradeInput material={l.materialId} value={l.grade} onChange={v => onChange({ grade: v })} /></Field>
              {/* A purchase keeps the piece count on its bill; opening stock has no bill to keep it on. */}
              {unit !== "pcs"
                ? (opening ? <span /> : <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={l.pcs} onChange={e => onChange({ pcs: e.target.value })} placeholder="Optional" />}</Field>)
                : <p className="self-end pb-1 text-[11px] leading-snug text-muted-foreground">{l.materialId ? `Counted in pieces — stock of ${materialName(db.settings, l.materialId)} per grade.` : ""}</p>}
            </>
          )}
  
          {/* How much, at what, less what — always the last three columns. */}
          <Field label={qtyLabel} className="@xl:col-start-4">{id => (
            <UnitInput id={id} min={0} step={qtyStep} unit={unit} value={l.qty} onChange={e => onChange({ qty: e.target.value })} />
          )}</Field>
          <Field label={`Rate / ${unit} (${currency})`}>{id => (
            <UnitInput id={id} min={0} unit={`${ccySymbol(currency)}/${unit}`} value={l.rate} onChange={e => onChange({ rate: e.target.value })} placeholder={opening ? "Optional" : undefined} />
          )}</Field>
          {!opening && <Field label="Discount %">{id => (
            <UnitInput id={id} min={-100} max={100} step="0.01" unit="%" value={l.discountPct} onChange={e => onChange({ discountPct: e.target.value })}
              placeholder="0" title="A minus figure adds instead — −2 adds 2%" />
          )}</Field>}
        </div>
  
      )}
    </div>
  );
}

/** Pick an open order by number or client — searchable, newest first. */
function OrderPick({ id, value, onChange, orders, clientName }: {
  id?: string; value: string; onChange: (id: string) => void;
  orders: { id: string; orderNumber: string; clientId: string; jewelleryType?: string }[]; clientName: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = orders.find(o => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button type="button" id={id} role="combobox" aria-expanded={open}
          className="flex w-full h-10 items-center justify-between gap-2 rounded-xl border border-input bg-transparent px-3 text-sm shadow-sm">
          <span className={chosen ? "truncate" : "text-muted-foreground"}>{chosen ? `${chosen.orderNumber} · ${clientName(chosen.clientId)}` : "Choose the order"}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[16rem]">
        <Command>
          <CommandInput placeholder="Order no. or client…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No open order matches.</CommandEmpty>
            {orders.map(o => (
              <CommandItem key={o.id} value={`${o.orderNumber} ${clientName(o.clientId)} ${o.jewelleryType ?? ""}`} onSelect={() => { onChange(o.id); setOpen(false); }}>
                <span className="font-mono text-xs font-semibold text-primary shrink-0">{o.orderNumber}</span>
                <span className="truncate text-muted-foreground">{clientName(o.clientId)}{o.jewelleryType ? ` · ${o.jewelleryType}` : ""}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Opening stock — material owned before the app, into Stock with no supplier
 * and no dues (ughrani). The same line cards as a purchase, so gold, loose
 * diamonds (into their bag), certified stones and other materials are entered
 * exactly as they are bought; several at once. The rate is optional: it values
 * the stock (carats × rate), as an opening figure always has.
 */
export function OpeningStockForm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const db = useDb();
  const multiCo = useMultiCo();
  const defaultCompany = useDefaultCompany();
  const [companyId, setCompanyId] = useState(defaultCompany);
  const [asOf, setAsOf] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine(), kind: "gold" }]);
  const [saving, setSaving] = useState(false);
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const addLine = (kind: BuyKind) => setLines(ls => [...ls, {
    ...emptyLine(), kind,
    materialId: kind === "other" ? ([...ls].reverse().find(l => l.kind === "other")?.materialId ?? "") : "",
  }]);
  const removeLine = (i: number) => setLines(ls => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls));
  // The value of a line: quantity × rate, when a rate is given.
  const valueOf = (l: Line) => Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0));
  const total = lines.reduce((t, l) => t + valueOf(l), 0);

  const submit = async () => {
    for (const [i, l] of lines.entries()) {
      if (l.kind === "other" && !materialDef(db.settings, l.materialId)) { toast.error(`Item ${i + 1}: choose the material`); return; }
      if (!(Number(l.qty) > 0)) { toast.error(`Item ${i + 1}: enter the opening ${l.kind === "gold" ? "weight (g)" : l.kind === "other" ? "quantity" : "carats"}`); return; }
      if (l.kind === "certified" && !l.certNo.trim()) { toast.error(`Item ${i + 1}: enter the report / certificate number`); return; }
    }
    // Carries the time of day, so several entries on one date keep the order they were typed in.
    const createdAt = stampFor(asOf);
    setSaving(true);
    let done = 0;
    try {
      for (const l of lines) {
        const q = Number(l.qty);
        const val = valueOf(l) > 0 ? valueOf(l) : undefined;
        if (l.kind === "certified") {
          // A certified stone is its own packet — never pooled — with no supplier or purchase.
          updateDb(d => {
            if (!d.diamondPackets) d.diamondPackets = [];
            d.diamondPackets.unshift({
              id: uid("dp_"), stockNumber: nextDiamondStockNumber(d), shape: l.shape, carat: q, ...coField(companyId),
              color: l.color.trim() || undefined, clarity: l.clarity.trim() || undefined,
              cut: l.cut.trim() || undefined, polish: l.polish.trim() || undefined, symmetry: l.sym.trim() || undefined,
              fluorescence: l.fluor.trim() || undefined, measurement: l.measure.trim() || undefined,
              certificateNumber: l.certNo.trim(), certificateLab: l.lab.trim() || undefined,
              ratePerCaratInr: Number(l.rate) > 0 ? Math.round(Number(l.rate) * 100) / 100 : undefined,
              note: note.trim() || undefined,
              status: "in_stock", createdBy: user!.id, createdAt,
            });
          });
        } else {
          // Gold, a loose lot (its bag) or another material pools into Stock.
          const lot = l.kind === "loose" ? lotOfLine(l) : undefined;
          await increaseStock({
            material: lineMaterial(l), companyId,
            purityOrQuality: l.kind === "gold" ? l.purity : l.kind === "other" ? (l.grade.trim() || "—") : lotKey(lot!),
            quantity: q, refType: "opening", valueInr: val,
            lot, pieces: l.kind === "loose" && Number(l.pcs) > 0 ? Math.round(Number(l.pcs)) : undefined,
            createdBy: user!.id, createdAt, note: note.trim() || undefined,
          });
        }
        done++;
      }
      toast.success(`Opening stock added — ${lines.length} item${lines.length !== 1 ? "s" : ""}${total > 0 ? ` · valued ${fmtMoneyInr(total)}` : ""}`);
      setLines([{ ...emptyLine(), kind: "gold" }]); setNote(""); setAsOf(todayLocal());
      onOpenChange(false);
    } catch (e) {
      // Say how far it got: the items before the failure are saved and must not be entered again.
      toast.error(`${done ? `${done} of ${lines.length} saved — ` : ""}${e instanceof Error ? e.message : "Couldn't add opening stock"}`);
      if (done) setLines(ls => ls.slice(done));
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={Layers} title="Opening stock"
      description={<>Owned before this app — into Stock with <span className="font-medium text-foreground">no supplier and no dues (ughrani)</span>. The same items as a purchase, several at once.</>}
      footer={
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <Stat label="Items" value={String(lines.length)} />
            <div className="text-right ml-auto">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Valued at</p>
              <p className="font-display text-2xl font-bold text-brand-dark tabular-nums leading-tight">{total > 0 ? fmtMoneyInr(total) : "No value"}</p>
            </div>
          </div>
          <PanelActions onCancel={() => onOpenChange(false)}
            note={`Into ${multiCo ? `${whose(companyById(db.settings, companyId).name)} ` : ""}stock as of ${asOf ? new Date(`${asOf}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep") : "today"} — no supplier, no dues.`}>
            <AsyncButton onClick={submit} disabled={saving} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-52">
              {saving ? "Saving…" : "Add Opening Stock"}
            </AsyncButton>
          </PanelActions>
        </div>
      }>
      <div className="@container space-y-5">
        <Group title="Opening">
          <div className="grid grid-cols-2 gap-3">
            <Field label="As of date">{id => (
              <Input id={id} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="rounded-xl h-10" />
            )}</Field>
            <Field label="Note">{id => (
              <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="e.g. carried forward" />
            )}</Field>
            {multiCo && (
              <div className="col-span-2">
                <CompanyPicker value={companyId} onChange={setCompanyId} label="Company — whose stock this is" />
              </div>
            )}
          </div>
        </Group>
        <Group title="Items" aside={<span className="text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? "s" : ""}</span>}>
          <div className="space-y-2.5">
            {lines.map((l, i) => (
              <LineCard key={i} line={l} n={i + 1} currency="INR" removable={lines.length > 1} opening
                onChange={patch => set(i, patch)} onRemove={() => removeLine(i)} base={valueOf(l)} inr={valueOf(l)} />
            ))}
          </div>
          {/* A phone: two by two, rather than three and one left over. */}
          <div className="mt-3 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <span className="col-span-2 text-xs text-muted-foreground mr-1">Add a line:</span>
            {KIND_ORDER.map(k => {
              const Icon = KIND[k].icon;
              return (
                <Button key={k} type="button" variant="outline" size="sm" onClick={() => addLine(k)} className="h-8 rounded-lg gap-1.5 text-xs px-2.5">
                  <Plus className="h-3.5 w-3.5" /><Icon className="h-3.5 w-3.5 text-muted-foreground" />{KIND[k].label}
                </Button>
              );
            })}
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}
