import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { fmtMoneyInr, applyDiscountPct } from "@/lib/manufacturing";
import { useDb } from "@/hooks/useDb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import type { Purchase } from "@/lib/db";
import type { PurchaseEdit } from "@/lib/purchaseVoid";
import { toast } from "sonner";
import { BillBrokerFields } from "@/components/BillBrokerFields";
import { billBrokerageProblem, brokerageForLines, emptyBillBrokerage, type BillBrokerage } from "@/lib/brokers";
import { materialDef, materialUnit, materialName, purchaseBucket, purchaseQty, purchaseRate, UNIT_LABEL, type MaterialKey } from "@/lib/materials";
import { loadDb } from "@/lib/db";
import { lotKey, lotParts } from "@/lib/diamondLots";
import { bagNoOf } from "@/lib/diamondBags";
import { purchaseStockMoveProblem, refilePurchaseLot, refilePurchaseStock } from "@/lib/openingStock";
import { CertGradeFields, ListSelect, LooseLotFields, lotFromDraft, type CertGradeDraft, type LooseLotDraft } from "@/components/LotFields";
import { GradeInput, OtherMaterialSelect } from "@/components/MaterialFields";
import { useAuth } from "@/lib/auth";
import { Checkbox } from "@/components/ui/checkbox";
import { cleanGstPct, defaultPurchaseGstPct, gstOn, pctText, usdWithGst } from "@/lib/purchaseGst";

/** Gold purities, as the purchase form offers them. */
const GOLD_PURITIES = ["9K", "10K", "14K", "18K", "22K", "24K"];

/**
 * Correct a purchase that was entered wrong (wrong carat, rate, invoice no.) —
 * every detail asked when it was bought can be corrected here too: a certified
 * stone's shape and grading, gold's purity, another material's grade (a gem's
 * whole lot) and pieces, as well as the loose diamonds' bag.
 * Saving carries the change through the supplier's due, the factory issue, the
 * certified packet and the stock trail — see editPurchase() in purchaseVoid.ts.
 */
export function EditPurchaseDialog({ purchase, onClose, onSave, lockQuantity, lockNote }: {
  purchase: Purchase | null;
  onClose: () => void;
  onSave: (edit: PurchaseEdit) => Promise<void>;
  /** True once the material has been made into a finished piece — the weight is
   *  fixed from then on, but the rate can still be corrected. */
  lockQuantity?: boolean;
  lockNote?: string;
}) {
  const db = useDb();
  const addNew = useAddNew();
  const isGold = purchase?.material === "gold";
  const isCertified = purchase?.material === "diamond" && purchase?.diamond?.kind === "certified";
  // Ready jewellery: its pieces and rate are fixed (purchaseVoid.ts) — the bill no., note, supplier and broker are not.
  const isReady = purchase?.material === "readyPiece";
  const unit = materialUnit(db.settings, purchase?.material);

  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [discount, setDiscount] = useState("");
  const [inv, setInv] = useState("");
  const [notes, setNotes] = useState("");
  const [quality, setQuality] = useState("");
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  // Loose diamonds: the bag (shape · mm · sieve · colour · clarity) and the pieces.
  const [lot, setLot] = useState<LooseLotDraft>({ shape: "Round", mm: "", size: "", color: "", clarity: "" });
  const [pcs, setPcs] = useState("");
  // A certified stone: its shape and grading (on its packet), as asked when it was bought.
  const [certShape, setCertShape] = useState("Round");
  const [grade, setGrade] = useState<CertGradeDraft>({ type: "", color: "", clarity: "", cut: "", polish: "", symmetry: "", fluorescence: "", measurement: "", lab: "", certNo: "" });
  // Gold: its purity. Another material: which one, its grade (a gem: its lot) and pieces.
  const [purity, setPurity] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [otherGrade, setOtherGrade] = useState("");
  const [gemLot, setGemLot] = useState<LooseLotDraft>({ shape: "Round", mm: "", size: "", color: "", clarity: "" });
  // The gem's lot as it was read in: only a change from it moves anything (a label read back may not match its text exactly).
  const [gemStart, setGemStart] = useState("");
  // The broker on this line (lib/brokers.ts).
  const [brokerage, setBrokerage] = useState<BillBrokerage>(emptyBillBrokerage());
  // In bill (GST) — on or off, and its % (lib/purchaseGst.ts).
  const [gstBill, setGstBill] = useState(false);
  const [gstPctText, setGstPctText] = useState("");

  // Reload the form whenever a different purchase is opened.
  useEffect(() => {
    if (!purchase) return;
    setSupplierId(purchase.supplierId);
    setQty(String(purchaseQty(purchase)));
    setRate(String(purchaseRate(purchase)));
    setDiscount(purchase.discountPct ? String(purchase.discountPct) : "");
    setInv(purchase.invoiceNumber ?? "");
    setNotes(purchase.notes ?? "");
    setQuality(purchase.diamond?.quality ?? "");
    setGstBill(purchase.gstBill === true);
    setGstPctText(pctText(purchase.gstBill ? purchase.gstPct : defaultPurchaseGstPct(loadDb().settings)));
    if (purchase.material === "diamond" && purchase.diamond?.kind !== "certified") {
      const lp = lotParts(purchaseBucket(purchase), { shape: purchase.diamond?.shape ?? "", type: purchase.diamond?.type, size: purchase.diamond?.size, mm: purchase.diamond?.mm, color: purchase.diamond?.color, clarity: purchase.diamond?.clarity });
      setLot({ shape: lp.shape, type: lp.type ?? "", mm: lp.mm ?? "", size: lp.size ?? "", color: lp.color ?? "", clarity: lp.clarity ?? "" });
      setPcs(purchase.diamond?.pieces != null ? String(purchase.diamond.pieces) : "");
    }
    if (purchase.material === "diamond" && purchase.diamond?.kind === "certified") {
      const pk = (loadDb().diamondPackets ?? []).find(x => x.purchaseId === purchase.id);
      setCertShape(pk?.shape || purchase.diamond?.shape || "Round");
      setGrade({
        type: pk?.type ?? purchase.diamond?.type ?? "", color: pk?.color ?? purchase.diamond?.color ?? "", clarity: pk?.clarity ?? purchase.diamond?.clarity ?? "",
        cut: pk?.cut ?? "", polish: pk?.polish ?? "", symmetry: pk?.symmetry ?? "", fluorescence: pk?.fluorescence ?? "", measurement: pk?.measurement ?? "",
        lab: purchase.diamond?.certificateLab ?? pk?.certificateLab ?? "", certNo: purchase.diamond?.certificateNumber ?? pk?.certificateNumber ?? "",
      });
    }
    setPurity(purchase.gold?.purity ?? "");
    if (purchase.material !== "gold" && purchase.material !== "diamond" && purchase.material !== "readyPiece") {
      setMaterialId(purchase.material);
      setOtherGrade(purchase.other?.grade && purchase.other.grade !== "—" ? purchase.other.grade : "");
      const gp = lotParts(purchase.other?.grade ?? "");
      const draft = { shape: gp.shape || "Round", variety: gp.variety ?? "", type: gp.type ?? "", mm: gp.mm ?? "", size: gp.size ?? "", color: gp.color ?? "", clarity: gp.clarity ?? "" };
      setGemLot(draft);
      setGemStart(lotKey(lotFromDraft(draft)));
      setPcs(purchase.other?.pieces != null ? String(purchase.other.pieces) : "");
    }
    setBrokerage(purchase.brokerId ? {
      brokerId: purchase.brokerId, pct: purchase.brokeragePct != null ? String(purchase.brokeragePct) : "",
      amount: purchase.brokerageInr != null ? String(purchase.brokerageInr) : "", paidBy: purchase.brokeragePaidBy ?? "us",
    } : emptyBillBrokerage());
  }, [purchase]);

  if (!purchase) return null;

  const q = Number(qty) || 0;
  const r = Number(rate) || 0;
  // Keep the original billing currency. For a USD purchase the stored exchange
  // rate still applies, so ₹ = qty × rate × fx.
  const isUsd = purchase.currency === "USD";
  const fx = purchase.exchangeRate ?? 0;
  // A supplier discount ("less 5%") comes off before the currency conversion,
  // exactly as it does when the purchase is first recorded.
  const disc = Math.min(Math.max(Number(discount) || 0, -100), 100);
  const net = applyDiscountPct(q * r, disc);
  // GST is fixed with the bill on a ready piece and on a bill made from borrowed gold.
  const gstLocked = isReady || !!purchase.fromGoldLoan;
  const gstPct = gstBill ? cleanGstPct(gstPctText) : 0;
  // The line in rupees before GST, its GST, and the bill's rounding when this is its first line.
  const lineInr = isUsd ? Math.round(net * fx) : Math.round(net);
  const gstInr = gstOn(lineInr, gstPct);
  const roundOff = purchase.roundOffInr ?? 0;
  // A ready piece's amount never changes here — kept exactly as billed (with any rounding on it).
  const totalUsd = isReady ? purchase.totalUsd : isUsd ? usdWithGst(net, gstPct) : undefined;
  const totalInr = isReady ? purchase.totalInr : lineInr + gstInr + roundOff;
  // The GST fields to save: always once a purchase says in bill or not; an older one only if ticked now.
  const gstEdit = gstLocked || (purchase.gstBill === undefined && !gstBill) ? {}
    : gstBill ? { gstBill: true, gstPct, gstInr } : { gstBill: false };

  const loose = purchase.material === "diamond" && !isCertified;
  const forOrder = purchase.purpose === "order" || !!purchase.orderId;
  const oldKey = loose ? purchaseBucket(purchase) : "";
  const newKey = loose ? lotKey(lotFromDraft(lot)) : "";
  const lotChanged = loose && !forOrder && (newKey !== oldKey || pcs !== (purchase.diamond?.pieces != null ? String(purchase.diamond.pieces) : "")
    || JSON.stringify(lotFromDraft(lot)) !== JSON.stringify(lotParts(oldKey, { shape: purchase.diamond?.shape ?? "", type: purchase.diamond?.type, size: purchase.diamond?.size, mm: purchase.diamond?.mm, color: purchase.diamond?.color, clarity: purchase.diamond?.clarity })));

  // Gold's purity, or another material (which, its grade or a gem's lot, its pieces): where it is counted in stock.
  const isOther = !isGold && purchase.material !== "diamond" && !isReady;
  const gem = isOther && materialDef(db.settings, materialId)?.kind === "stone";
  const otherUnit = isOther ? materialUnit(db.settings, materialId || purchase.material) : unit;
  const newOtherKey = !isOther ? "" : gem ? lotKey(lotFromDraft(gemLot)) : (otherGrade.trim() || "—");
  const goldMoved = isGold && !!purity && purity !== (purchase.gold?.purity ?? "");
  const otherMoved = isOther && (materialId !== purchase.material || (gem ? newOtherKey !== gemStart : newOtherKey !== (purchase.other?.grade || "—")));
  const otherPcsChanged = isOther && pcs !== (purchase.other?.pieces != null ? String(purchase.other.pieces) : "");
  const stockMoves = goldMoved || otherMoved || otherPcsChanged;
  // A report no. it was bought with can't be cleared; an older purchase saved without one can still be corrected.
  const hadReport = !!(purchase.diamond?.certificateNumber || (db.diamondPackets ?? []).find(x => x.purchaseId === purchase.id)?.certificateNumber);

  const submit = async () => {
    const brokerProblem = billBrokerageProblem(brokerage);
    if (brokerProblem) { toast.error(brokerProblem); return; }
    if (gstBill && !gstLocked && !(gstPct > 0)) { toast.error("Enter the GST % — or untick In bill"); return; }
    // A move to another purity / grade / material is checked first: refused, nothing is saved.
    if (goldMoved || otherMoved) {
      const problem = purchaseStockMoveProblem(loadDb(), purchase.id);
      if (problem) { toast.error(problem); return; }
    }
    setSaving(true);
    try {
      await onSave({
        supplierId,
        quantity: q,
        ratePerUnit: r,
        discountPct: disc,
        totalInr,
        totalUsd,
        exchangeRate: isUsd ? fx : undefined,
        invoiceNumber: inv,
        notes,
        // Loose: its colour and clarity read as its quality, as when it was bought.
        quality: purchase.material === "diamond" ? (loose ? [lot.color, lot.clarity].filter(Boolean).join(" ") || quality : quality) : undefined,
        certificateNumber: isCertified ? grade.certNo : undefined,
        certificateLab: isCertified ? grade.lab : undefined,
        ...(isCertified ? { cert: { shape: certShape, type: grade.type ?? "", color: grade.color, clarity: grade.clarity, cut: grade.cut, polish: grade.polish, symmetry: grade.symmetry, fluorescence: grade.fluorescence, measurement: grade.measurement } } : {}),
        // Brokerage on the line before GST, as when it was bought.
        brokerage: brokerage.brokerId ? brokerageForLines(brokerage, [isReady ? totalInr : lineInr + roundOff])[0] : null,
        ...gstEdit,
      });
      // Then the bag, worked out from the purchase as it now stands.
      if (lotChanged) {
        const fresh = (loadDb().purchases ?? []).find(x => x.id === purchase.id);
        if (!fresh || Math.abs(purchaseQty(fresh) - q) > 0.0005) { toast.error("The other changes didn't save, so the stones weren't moved to another bag."); return; }
        try {
          await refilePurchaseLot(purchase.id, lotFromDraft(lot), Number(pcs) > 0 ? Number(pcs) : undefined, { userId: user?.id });
          if (newKey !== oldKey) toast.success(`Stones moved into ${bagNoOf(loadDb(), newKey) ?? "their bag"} · ${newKey}`);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't move the stones to that bag."); return; }
      }
      // Gold's purity, another material's grade (a gem's lot), which material, its pieces: moved where it is counted.
      if (stockMoves) {
        const fresh = (loadDb().purchases ?? []).find(x => x.id === purchase.id);
        if (!fresh || Math.abs(purchaseQty(fresh) - q) > 0.0005) { toast.error("The other changes didn't save, so the stock wasn't moved."); return; }
        // A gem whose lot wasn't changed keeps its label exactly as it was.
        const key = isGold ? purity : gem && newOtherKey === gemStart ? (purchase.other?.grade || "—") : newOtherKey;
        const mat = (isGold ? "gold" : materialId || purchase.material) as MaterialKey;
        const pieces = isOther && Number(pcs) > 0 ? Math.round(Number(pcs)) : undefined;
        try {
          await refilePurchaseStock(purchase.id, { material: mat, key, lot: gem ? lotFromDraft(gemLot) : undefined, pieces }, row => {
            if (row.gold && isGold) row.gold.purity = purity;
            if (row.other && isOther) {
              row.other.grade = key;
              if (pieces) row.other.pieces = pieces; else delete row.other.pieces;
              row.material = mat as typeof row.material;
            }
          }, { userId: user?.id });
          if (goldMoved || otherMoved) toast.success(`Moved to ${isGold ? `${purity} gold` : `${materialName(db.settings, mat)} · ${key}`}`);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't move it in stock."); return; }
      }
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!purchase} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Correct this purchase</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          The change carries through to the supplier&rsquo;s dues, the material issued to the factory and the stock entry.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-1">
          <div>
            <Label className="text-xs">{isGold ? "Weight (g)" : purchase.material === "diamond" ? "Carat (ct)" : isReady ? "Pieces" : `${materialName(db.settings, purchase.material)} (${UNIT_LABEL[unit]})`}</Label>
            <Input type="number" min={0} step="0.001" value={qty} onChange={e => setQty(e.target.value)} disabled={lockQuantity} className="rounded-xl h-10 mt-1 disabled:opacity-60" />
          </div>
          <div>
            <Label className="text-xs">Rate / {unit} ({purchase.currency})</Label>
            <Input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} disabled={isReady} className="rounded-xl h-10 mt-1 disabled:opacity-60" />
          </div>
          <div>
            <Label className="text-xs">Discount %</Label>
            <Input type="number" min={-100} max={100} step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} disabled={isReady} className="rounded-xl h-10 mt-1 disabled:opacity-60" placeholder="0 — minus adds" />
          </div>
        </div>
        {lockQuantity && lockNote && (
          <p className="text-[11px] text-muted-foreground -mt-1">{lockNote}</p>
        )}

        {/* Gold: its purity — where it is counted in stock, and the fine gold a factory gets. */}
        {isGold && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Purity</Label>
              <Select value={purity} onValueChange={setPurity} disabled={lockQuantity}>
                <SelectTrigger aria-label="Purity" className="h-10 rounded-xl mt-1"><SelectValue placeholder="Purity" /></SelectTrigger>
                <SelectContent>{[...new Set([...GOLD_PURITIES, purchase.gold?.purity ?? ""].filter(Boolean))].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {goldMoved && <p className="col-span-2 self-end text-[11px] font-medium text-primary">Moves from {purchase.gold?.purity} to {purity} gold in stock{purchase.orderId || forOrder ? " (and on the order's factory issue)" : ""} — only if none of it has gone out since.</p>}
          </div>
        )}

        {/* Another material: which one, its grade — a gem: its whole lot — and its pieces. */}
        {isOther && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="min-w-0"><Label className="text-xs">Material</Label><OtherMaterialSelect value={materialId} onChange={v => { setMaterialId(v); setOtherGrade(""); }} className="h-10 rounded-xl mt-1" /></div>
              {!gem && <div className="min-w-0"><Label className="text-xs">Grade</Label><GradeInput material={materialId} value={otherGrade} onChange={setOtherGrade} className="h-10 rounded-xl mt-1" /></div>}
              {otherUnit !== "pcs" && (
                <div>
                  <Label htmlFor="edit-pur-opcs" className="text-xs">Pcs</Label>
                  <Input id="edit-pur-opcs" type="number" min={0} step="1" value={pcs} onChange={e => setPcs(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" />
                </div>
              )}
            </div>
            {gem && <LooseLotFields idPrefix="edit-pur-gem" compact gem showStone showBag={false} value={gemLot} onChange={p => setGemLot(l => ({ ...l, ...p }))} />}
            {otherMoved && <p className="text-[11px] font-medium text-primary">Moves from {materialName(db.settings, purchase.material)} · {purchase.other?.grade || "—"} to {materialName(db.settings, materialId)} · {newOtherKey} in stock — only if none of it has gone out since.</p>}
            {lockQuantity && <p className="text-[11px] text-muted-foreground">It's in a finished piece now — its grade can't move in stock.</p>}
          </div>
        )}

        {loose && (forOrder ? (
          <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
            Bought for an order: {oldKey}{purchase.diamond?.pieces ? ` · ${purchase.diamond.pieces} pcs` : ""} — its stones are corrected on the order.
          </p>
        ) : (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
            <p className="text-xs font-semibold text-brand-dark">Bag · now {bagNoOf(db, oldKey) ?? "no bag no."} · {oldKey}</p>
            <LooseLotFields idPrefix="edit-pur" compact bagPicker={false} companyId={purchase.companyId || "main"} value={lot} onChange={p => setLot(l => ({ ...l, ...p }))} />
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="edit-pur-pcs" className="text-xs">Pcs</Label>
                <Input id="edit-pur-pcs" type="number" min={0} step="1" value={pcs} onChange={e => setPcs(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="Optional" />
              </div>
            </div>
            {newKey !== oldKey && <p className="text-[11px] font-medium text-primary">These stones move out of {oldKey} into {newKey} — only if none of them has gone out since.</p>}
          </div>
        ))}

        {/* A certified stone: its shape and its full grading — everything asked when it was bought. */}
        {isCertified && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="edit-pur-shape" className="text-xs">Shape</Label>
                <ListSelect id="edit-pur-shape" list="diamondShapes" value={certShape} onChange={v => setCertShape(v || "Round")} optional={false} className="h-10 rounded-xl mt-1" />
              </div>
            </div>
            <CertGradeFields idPrefix="edit-pur-cert" compact requireReport={hadReport} value={grade} onChange={p => setGrade(g => ({ ...g, ...p }))} />
          </div>
        )}

        {/* The wrong supplier is one click away in a long list. Correcting it
            here moves the due from one to the other; removing the purchase and
            entering it again would unwind the factory issue and the stock trail
            with it. */}
        <div>
          <Label className="text-xs">Supplier</Label>
          <Select value={supplierId} onValueChange={addNew("supplier", setSupplierId)}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
            <SelectContent>
              {db.suppliers.filter(s => s.active !== false || s.id === purchase.supplierId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              <AddNewItem kind="supplier" />
            </SelectContent>
          </Select>
          {supplierId !== purchase.supplierId && (
            <p className="text-[11px] text-warning mt-1">
              {fmtMoneyInr(purchase.totalInr)} moves off {db.suppliers.find(s => s.id === purchase.supplierId)?.name ?? "the old supplier"}
              {" "}and onto {db.suppliers.find(s => s.id === supplierId)?.name ?? "the new one"}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Invoice # (optional)</Label>
            <Input value={inv} onChange={e => setInv(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
        </div>

        {/* Ready jewellery: the broker is part of the piece's cost — fixed with the bill. */}
        {isReady
          ? (purchase.brokerId ? <p className="text-xs text-muted-foreground">The broker is part of what the piece cost — to change it, void the purchase and enter it again.</p> : null)
          : <BillBrokerFields value={brokerage} onChange={setBrokerage} billTotalInr={lineInr + roundOff} />}

        {/* In bill (GST): on or off, at what % — the total below carries it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
          <label className={`flex items-center gap-2 text-sm font-medium text-brand-dark ${gstLocked ? "opacity-60" : "cursor-pointer"}`}>
            <Checkbox checked={gstBill} disabled={gstLocked} onCheckedChange={v => setGstBill(v === true)} aria-label="In bill (GST)" />
            In bill (GST)
          </label>
          {gstBill && (
            <div className="w-24"><Input type="number" min={0} max={100} step="0.01" value={gstPctText} onChange={e => setGstPctText(e.target.value)} disabled={gstLocked} aria-label="GST %" className="rounded-xl h-9 text-right disabled:opacity-60" /></div>
          )}
          <span className="text-xs text-muted-foreground">
            {gstLocked ? "Fixed with the bill." : gstBill ? `GST ${pctText(gstPct)}% · ${fmtMoneyInr(gstInr)} on this line` : purchase.gstBill === false ? "No bill — no GST." : "Tick if it was bought on a GST bill."}
          </span>
        </div>

        <div className="rounded-xl bg-secondary/60 border border-border/60 px-4 py-3 text-sm flex items-center justify-between">
          <span className="text-muted-foreground">New total</span>
          <span className="font-semibold text-brand-dark">
            {isUsd ? `$${(totalUsd ?? 0).toFixed(2)} · ` : ""}{fmtMoneyInr(totalInr)}
          </span>
        </div>
        {totalInr !== purchase.totalInr && (
          <p className="text-[11px] text-muted-foreground -mt-1">
            Was {fmtMoneyInr(purchase.totalInr)} — the supplier&rsquo;s balance moves by {fmtMoneyInr(Math.abs(totalInr - purchase.totalInr))}
            {totalInr > purchase.totalInr ? " up" : " down"}.
          </p>
        )}

        <div className="flex gap-2 mt-1">
          <Button variant="outline" onClick={onClose} className="rounded-xl flex-1">Cancel</Button>
          <AsyncButton onClick={submit} disabled={saving || q <= 0 || (isCertified && hadReport && !grade.certNo.trim()) ||(isOther && !materialId)} className="btn-hero rounded-xl flex-1">
            {saving ? "Saving…" : "Save correction"}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
