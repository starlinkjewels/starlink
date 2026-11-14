// Memo IN — a dealer's goods with us on approval: the side panels. Take goods in,
// send them back, or keep them (the Buy form opens filled in from the slip).
// The books: lib/memos.ts — a memo in never touches our stock.
import { GOLD_KARATS } from "@/lib/pure/basics";
import { useEffect, useState } from "react";
import { BadgeCheck, Coins, FileInput, Gem, Layers, Package, Plus, Trash2, Undo2, BadgeDollarSign, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useHas } from "@/hooks/useCan";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { todayLocal, stampFor, fmtDate, type Memo, type MemoLine, type PurchaseCurrency, type SupplierSaleKind } from "@/lib/db";
import { fmtCcy } from "@/lib/currency";
import { lotLabel, lotKey } from "@/lib/diamondLots";
import { materialName, materialUnit, materialDef } from "@/lib/materials";
import { recordMemoIn, memoInProblem, noteMemoIn, lineOpen, memoPartyName, memoInOpenLines, type MemoInInput, type MemoParty } from "@/lib/memos";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { LooseLotFields } from "@/components/LotFields";
import { OtherMaterialSelect } from "@/components/MaterialFields";
import { BuyMaterialForm, type MemoInBuy } from "@/components/BuyMaterialForm";
import { qu } from "@/components/MemoSheets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openMin } from "@/lib/openMin";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const SYM: Record<string, string> = { INR: "₹", USD: "$" };

export interface InDraft {
  key: string; kind: SupplierSaleKind;
  shape: string; type: string; variety: string; size: string; mm: string; color: string; clarity: string;
  certNo: string; lab: string; purity: string; materialId: string; grade: string; name: string;
  qty: string; pcs: string; rate: string; amount: string;
}
export const newIn = (kind: SupplierSaleKind): InDraft => ({
  key: Math.random().toString(36).slice(2), kind, shape: "Round", type: "", variety: "", size: "", mm: "", color: "", clarity: "",
  certNo: "", lab: "", purity: "22K", materialId: "", grade: "", name: "", qty: kind === "piece" ? "1" : "", pcs: "", rate: "", amount: "",
});
const IN_KINDS: { kind: SupplierSaleKind; label: string; icon: LucideIcon }[] = [
  { kind: "diamond", label: "Loose diamond", icon: Gem },
  { kind: "certified", label: "Certified", icon: BadgeCheck },
  { kind: "piece", label: "Jewellery piece", icon: Package },
  { kind: "material", label: "Gems / other", icon: Layers },
  { kind: "gold", label: "Gold", icon: Coins },
];
// The one karat list (lib/pure/basics.ts GOLD_KARATS) — every gold dropdown offers the same.
const GOLD_PURITIES = GOLD_KARATS;

/** A line as written (a memo-in slip's, a purchase order's) back as a draft to change. */
export function draftOf(l: MemoLine): InDraft {
  const s = l.spec ?? {};
  return {
    ...newIn(l.kind), shape: s.shape ?? "Round", type: s.type ?? "", variety: s.variety ?? "", size: s.size ?? "", mm: s.mm ?? "",
    color: s.color ?? "", clarity: s.clarity ?? "", certNo: s.certNo ?? "", lab: s.lab ?? "", purity: s.purity ?? l.bucket ?? "22K",
    materialId: s.materialId ?? (l.kind === "material" ? l.material : ""), grade: s.grade ?? "", name: s.pieceName ?? (l.kind === "piece" ? l.label : ""),
    qty: String(l.qty), pcs: l.pieces ? String(l.pieces) : "", rate: l.rate != null ? String(l.rate) : "",
    amount: l.rate != null && Math.abs(l.rate * l.qty - l.amount) < 0.01 ? "" : String(l.amount),
  };
}

/**
 * The goods of a slip, line by line — a loose lot, a certified stone, gold, a piece, gems or another
 * material, with quantity, rate and amount. Taking goods in on memo and a purchase order use the same
 * lines (each built as a memo line), so keeping or receiving them fills the purchase bill in.
 */
export function useInLines(currency: PurchaseCurrency, title = "The goods") {
  const db = useDb();
  const [lines, setLines] = useState<InDraft[]>([newIn("diamond")]);
  const sym = SYM[currency] ?? "";
  const set = (key: string, patch: Partial<InDraft>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const isGem = (d: InDraft) => d.kind === "material" && materialDef(db.settings, d.materialId)?.kind === "stone";
  const unitOf = (d: InDraft): string => d.kind === "gold" ? "g" : d.kind === "piece" ? "pcs" : d.kind === "material" ? (d.materialId ? materialUnit(db.settings, d.materialId) : "") : "ct";

  const toLine = (d: InDraft): MemoInInput["lines"][number] | null => {
    const qty = num(d.qty), rate = num(d.rate);
    if (!(qty > 0)) return null;
    const amount = d.amount.trim() !== "" ? r2(num(d.amount)) : r2(qty * rate);
    const base = { qty, unit: unitOf(d), amount, ...(rate ? { rate } : {}) };
    const lot = {
      shape: d.shape || "Round", ...(d.type.trim() ? { type: d.type.trim() } : {}), ...(d.variety.trim() ? { variety: d.variety.trim() } : {}),
      ...(d.size ? { size: d.size } : {}), ...(d.mm ? { mm: d.mm } : {}), ...(d.color.trim() ? { color: d.color.trim() } : {}), ...(d.clarity.trim() ? { clarity: d.clarity.trim() } : {}),
    };
    const pcs = Math.round(num(d.pcs));
    if (d.kind === "diamond") return { ...base, kind: "diamond", material: "diamond", bucket: lotKey(lot), label: lotLabel(lotKey(lot)), spec: lot, ...(pcs > 0 ? { pieces: pcs } : {}) };
    if (d.kind === "certified") {
      if (!d.certNo.trim()) return null;
      return {
        ...base, kind: "certified", material: "certified", label: `${d.shape} ${qty}ct certified (${d.certNo.trim()})`,
        spec: { shape: d.shape, certNo: d.certNo.trim(), ...(d.lab.trim() ? { lab: d.lab.trim() } : {}), ...(d.type.trim() ? { type: d.type.trim() } : {}), ...(d.color.trim() ? { color: d.color.trim() } : {}), ...(d.clarity.trim() ? { clarity: d.clarity.trim() } : {}) },
      };
    }
    if (d.kind === "gold") return { ...base, kind: "gold", material: "gold", bucket: d.purity, label: `${d.purity} gold`, spec: { purity: d.purity } };
    if (d.kind === "piece") {
      if (!d.name.trim()) return null;
      return { ...base, kind: "piece", material: "piece", label: d.name.trim(), spec: { pieceName: d.name.trim() } };
    }
    if (!d.materialId) return null;
    const gem = isGem(d);
    return {
      ...base, kind: "material", material: d.materialId, bucket: gem ? lotKey(lot) : (d.grade.trim() || "—"),
      label: `${materialName(db.settings, d.materialId)}${gem ? ` ${lotLabel(lotKey(lot))}` : d.grade.trim() ? ` ${d.grade.trim()}` : ""}`,
      spec: { materialId: d.materialId, ...(gem ? lot : d.grade.trim() ? { grade: d.grade.trim() } : {}) }, ...(gem && pcs > 0 ? { pieces: pcs } : {}),
    };
  };
  const built = lines.map(toLine);
  const total = r2(built.reduce((t, l) => t + (l?.amount ?? 0), 0));

  const editor = (
        <Group title={title}>
          <div className="space-y-3">
            {lines.map((d, i) => {
              const k = IN_KINDS.find(x => x.kind === d.kind)!;
              const unit = unitOf(d), line = built[i], gem = isGem(d);
              return (
                <div key={d.key} className="rounded-xl border border-border/70 bg-white p-3 space-y-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><k.icon className="h-3.5 w-3.5" /></span>
                    <span className="text-sm font-medium text-foreground truncate">{k.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">#{i + 1}</span>
                    <span className="ml-auto text-sm font-semibold text-brand-dark tabular-nums shrink-0 pl-2">{line?.amount ? fmtCcy(line.amount, currency) : "—"}</span>
                    <button type="button" aria-label="Remove this line" title="Remove this line" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== d.key) : [newIn("diamond")])}
                      className="h-8 w-8 -mr-1 grid place-items-center rounded-lg shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {d.kind === "material" && (
                    <Field label="Material">{() => <OtherMaterialSelect value={d.materialId} onChange={v => set(d.key, { materialId: v })} />}</Field>
                  )}
                  {(d.kind === "diamond" || gem) && (
                    <LooseLotFields idPrefix={`mi-${d.key}`} showBag={false} bagPicker={false} compact gem={gem} showStone={gem}
                      value={{ shape: d.shape, type: d.type, variety: d.variety, mm: d.mm, size: d.size, color: d.color, clarity: d.clarity }}
                      onChange={patch => set(d.key, patch as Partial<InDraft>)} />
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    {d.kind === "material" && !gem && <Field label="Grade">{id => <Input id={id} value={d.grade} onChange={e => set(d.key, { grade: e.target.value })} className="rounded-xl h-10" placeholder="Optional" />}</Field>}
                    {d.kind === "certified" && (
                      <>
                        <Field label="Shape">{id => <Input id={id} value={d.shape} onChange={e => set(d.key, { shape: e.target.value })} className="rounded-xl h-10" />}</Field>
                        <Field label="Report no.">{id => <Input id={id} value={d.certNo} onChange={e => set(d.key, { certNo: e.target.value })} className="rounded-xl h-10" aria-label="Report number" />}</Field>
                        <Field label="Lab">{id => <Input id={id} value={d.lab} onChange={e => set(d.key, { lab: e.target.value })} className="rounded-xl h-10" placeholder="GIA, IGI…" />}</Field>
                        <Field label="Colour · clarity">{id => (
                          <div className="flex gap-1.5">
                            <Input id={id} value={d.color} onChange={e => set(d.key, { color: e.target.value })} className="rounded-xl h-10" placeholder="G" aria-label="Colour" />
                            <Input value={d.clarity} onChange={e => set(d.key, { clarity: e.target.value })} className="rounded-xl h-10" placeholder="VS1" aria-label="Clarity" />
                          </div>
                        )}</Field>
                      </>
                    )}
                    {d.kind === "gold" && (
                      <Field label="Purity">{id => (
                        <Select value={d.purity} onValueChange={v => set(d.key, { purity: v })}>
                          <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent>{GOLD_PURITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                        </Select>
                      )}</Field>
                    )}
                    {d.kind === "piece" && <Field label="The piece" className="col-span-2">{id => <Input id={id} value={d.name} onChange={e => set(d.key, { name: e.target.value })} className="rounded-xl h-10" placeholder="e.g. Ring 18K, 1.2 ct" aria-label="The piece" />}</Field>}
                    <Field label={d.kind === "piece" ? "How many" : d.kind === "certified" ? "Carat" : `Quantity${unit ? ` (${unit})` : ""}`}>{id => (
                      <UnitInput id={id} min={0} step={d.kind === "piece" ? "1" : "0.001"} unit={unit} value={d.qty} onChange={e => set(d.key, { qty: e.target.value })} aria-label="Quantity" />
                    )}</Field>
                    {(d.kind === "diamond" || gem) && <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={d.pcs} onChange={e => set(d.key, { pcs: e.target.value })} placeholder="Optional" />}</Field>}
                    <Field label={`Rate (${sym}${unit ? ` / ${unit}` : ""})`}>{id => <UnitInput id={id} min={0} unit={sym} value={d.rate} onChange={e => set(d.key, { rate: e.target.value, amount: "" })} aria-label="Rate" />}</Field>
                    <Field label={`Amount (${sym})`} hint={d.amount.trim() === "" && line?.amount ? "quantity × rate" : undefined}>{id => (
                      <UnitInput id={id} min={0} unit={sym} value={d.amount} placeholder={line?.amount ? String(line.amount) : "0"} onChange={e => set(d.key, { amount: e.target.value })} />
                    )}</Field>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1.5">
              {IN_KINDS.map(k => <Button key={k.kind} type="button" variant="outline" size="sm" className="rounded-lg h-9" onClick={() => setLines(ls => [...ls, newIn(k.kind)])}><Plus className="h-3.5 w-3.5" />{k.label}</Button>)}
            </div>
          </div>
        </Group>
  );
  return { lines, setLines, built, total, editor };
}

/** Take a dealer's (or a broker's) goods in on memo. Our stock is untouched — the slip is the record. */
export function MemoInSheet({ open, onOpenChange, party: fixed }: { open: boolean; onOpenChange: (v: boolean) => void; party?: MemoParty }) {
  const db = useDb();
  const { user } = useAuth();
  const multiCo = useMultiCo();
  const defaultCo = useDefaultCompany();
  const [companyId, setCompanyId] = useState(defaultCo);
  const [kind, setKind] = useState<"supplier" | "broker">(fixed?.kind === "broker" ? "broker" : "supplier");
  const [partyId, setPartyId] = useState(fixed?.id ?? "");
  const [date, setDate] = useState(todayLocal());
  const [due, setDue] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const goods = useInLines(currency);
  const { built, total } = goods;
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind(fixed?.kind === "broker" ? "broker" : "supplier"); setPartyId(fixed?.id ?? ""); setDate(todayLocal()); setDue("");
    goods.setLines([newIn("diamond")]); setNotes(""); setCurrency("INR"); setCompanyId(defaultCo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixed?.kind, fixed?.id]);
  const parties = (kind === "supplier"
    ? db.suppliers.filter(s => s.active !== false || s.id === partyId).map(s => ({ id: s.id, name: s.name }))
    : (db.brokers ?? []).map(b => ({ id: b.id, name: b.name }))).sort((a, b) => a.name.localeCompare(b.name));
  const save = async () => {
    if (built.some(l => !l)) { toast.error("Finish every line — or remove the empty one"); return; }
    const input: MemoInInput = {
      companyId: companyId === "main" ? undefined : companyId, party: { kind, id: partyId }, at: stampFor(date),
      ...(due ? { dueAt: stampFor(due) } : {}), currency, lines: built as MemoInInput["lines"], notes,
    };
    const problem = memoInProblem(db, input);
    if (problem) { toast.error(problem); return; }
    try {
      const memo = await recordMemoIn(db, input, user!);
      toast.success(`Memo ${memo.no} — ${memoPartyName(db, memo.party)}'s goods are with us`);
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "The memo wasn't recorded"); }
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={FileInput} title="Take goods in on memo"
      description="A dealer's goods with us on approval — not ours, and not in our stock, until we keep them."
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat big label="Memo value" value={total > 0 ? fmtCcy(total, currency) : "—"} sub="what we would owe if we kept it all — nothing is owed yet" />
            <Stat label="Lines" value={String(built.filter(Boolean).length)} />
          </Stats>
          <PanelActions onCancel={() => onOpenChange(false)}>
            <AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Take in on memo</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group>
          <div className="grid grid-cols-2 gap-3">
            {!fixed && <div className="col-span-2"><Segmented value={kind} onChange={k => { setKind(k); setPartyId(""); }} options={[["supplier", "Dealer"], ["broker", "Broker"]] as const} /></div>}
            <Field label={kind === "supplier" ? "Dealer" : "Broker"} className="col-span-2 @md:col-span-1">{id => (
              <Select value={partyId} onValueChange={setPartyId} disabled={!!fixed}>
                <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Whose goods"><SelectValue placeholder={parties.length ? "Choose" : "None yet"} /></SelectTrigger>
                <SelectContent>{parties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )}</Field>
            <Field label="Prices in" className="col-span-2 @md:col-span-1">{id => (
              <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
                <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Prices in"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INR">Rupees (₹)</SelectItem><SelectItem value="USD">Dollars ($)</SelectItem></SelectContent>
              </Select>
            )}</Field>
            <Field label="Date in">{id => <Input id={id} type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
            <Field label="Due back" hint="Optional">{id => <Input id={id} type="date" min={date} value={due} onChange={e => setDue(e.target.value)} className="rounded-xl h-10" aria-label="Due back" />}</Field>
            {multiCo && <div className="col-span-2"><CompanyPicker value={companyId} onChange={setCompanyId} label="Company — who holds them" /></div>}
          </div>
        </Group>
        {goods.editor}
        <Field label="Remark">{id => <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
      </div>
    </ActionSheet>
  );
}

type Pick = { lineId: string; qty: number; pieces?: number };

/** A memo-in slip's goods as the Buy form's lines — what "Keep" fills the bill with. */
export function memoInBuyLines(memo: { lines: MemoLine[] }, picks: Pick[]): MemoInBuy["lines"] {
  return picks.map(p => {
    const l = memo.lines.find(x => x.id === p.lineId)!;
    const s = l.spec ?? {};
    const rate = l.rate != null ? String(l.rate) : l.qty > 0 && l.amount ? String(r2(l.amount / l.qty)) : "";
    const lot = { shape: s.shape ?? "Round", type: s.type ?? "", variety: s.variety, size: s.size ?? "", mm: s.mm ?? "", color: s.color ?? "", clarity: s.clarity ?? "" };
    const base = { qty: String(p.qty), rate, pcs: p.pieces ? String(p.pieces) : "" };
    if (l.kind === "diamond") return { ...base, ...lot, kind: "loose" as const };
    if (l.kind === "certified") return { ...base, kind: "certified" as const, shape: s.shape ?? "Round", type: s.type ?? "", color: s.color ?? "", clarity: s.clarity ?? "", certNo: s.certNo ?? "", lab: s.lab ?? "" };
    if (l.kind === "gold") return { ...base, kind: "gold" as const, purity: s.purity ?? l.bucket ?? "22K" };
    if (l.kind === "piece") return { ...base, kind: "ready" as const, pieceName: s.pieceName ?? l.label };
    return { ...base, ...lot, kind: "other" as const, materialId: s.materialId ?? l.material, grade: s.grade ?? "" };
  });
}

/** A memo in: goods go back to the dealer — or we keep them (the Buy form opens, filled in from the slip). */
export function MemoInBackSheet({ memo, mode, onClose }: { memo: Memo; mode: "return" | "keep"; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const keep = mode === "keep";
  const openLines = memo.lines.filter(l => lineOpen(memo, l) > 1e-6);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(openLines.map(l => [l.id, true])));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(openLines.map(l => [l.id, String(lineOpen(memo, l))])));
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [buying, setBuying] = useState<Pick[] | null>(null);
  const who = memoPartyName(db, memo.party);
  const picked = openLines.filter(l => on[l.id]);
  const picks = (): Pick[] => picked.map(l => {
    const q = l.kind === "certified" ? l.qty : num(qty[l.id] ?? "");
    return { lineId: l.id, qty: q, ...(l.pieces && Math.abs(q - l.qty) < 1e-6 ? { pieces: l.pieces } : {}) };
  });

  const go = async () => {
    const ps = picks();
    for (const p of ps) {
      const l = memo.lines.find(x => x.id === p.lineId)!;
      if (!(p.qty > 0)) { toast.error(`Enter how much — ${l.label}`); return; }
      if (p.qty > lineOpen(memo, l) + 1e-6) { toast.error(`Only ${qu(lineOpen(memo, l), l.unit)} of ${l.label} is still with us`); return; }
    }
    if (keep) { setBuying(ps); return; }
    try { noteMemoIn(memo.id, ps, user!, { kind: "return", at: stampFor(date), note }); toast.success(`Returned to ${who}`); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
  };

  if (buying) {
    return (
      <BuyMaterialForm open onOpenChange={v => { if (!v) onClose(); }}
        supplierId={memo.party.kind === "supplier" ? memo.party.id : undefined}
        memoIn={{
          lines: memoInBuyLines(memo, buying), currency: memo.currency, notes: `Memo ${memo.no}`,
          ...(memo.party.kind === "broker" ? { brokerId: memo.party.id } : {}),
          onSaved: (ids, qtys) => {
            try {
              // What the bill was saved for (its lines can be changed) — line for line when they still match.
              const final = qtys.length === buying.length ? buying.map((p, i) => ({ ...p, qty: qtys[i] > 0 ? qtys[i] : p.qty })) : buying;
              noteMemoIn(memo.id, final, user!, { kind: "kept", purchaseIds: ids });
            } catch (e) {
              toast.error(`The bill is saved, but the memo could not be marked${e instanceof Error ? ` (${e.message})` : ""} — mark it kept by hand.`);
            }
          },
        }} />
    );
  }

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={keep ? BadgeDollarSign : Undo2}
      title={keep ? `Keep from memo ${memo.no}` : `Return memo ${memo.no}`}
      description={keep ? `We buy these from ${who} — the purchase bill opens next, filled in` : `These go back to ${who} — nothing is owed`}
      footer={(
        <PanelActions onCancel={onClose}>
          <AsyncButton onClick={go} disabled={!picked.length} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">{keep ? "Next — the purchase bill" : "Mark returned"}</AsyncButton>
        </PanelActions>
      )}>
      <div className="@container space-y-5">
        <Group title={keep ? "What we keep" : "What goes back"}>
          <div className="space-y-2">
            {openLines.map(l => (
              <div key={l.id} className={`rounded-xl border p-3 ${on[l.id] ? "border-primary/40 bg-primary/5" : "border-border/70"}`}>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={!!on[l.id]} onChange={e => setOn(s => ({ ...s, [l.id]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[var(--primary)]" aria-label={`Include ${l.label}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground break-words">{l.label}</span>
                    <span className="block text-[11px] text-muted-foreground">With us: {qu(lineOpen(memo, l), l.unit)}{l.amount ? ` · ${fmtCcy(l.amount, memo.currency)} for ${qu(l.qty, l.unit)}` : ""}</span>
                  </span>
                </label>
                {on[l.id] && l.kind !== "certified" && (
                  <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                    <Field label={`Quantity (${l.unit})`}>{id => <UnitInput id={id} min={0} step={l.kind === "piece" ? "1" : "0.001"} unit={l.unit} value={qty[l.id] ?? ""} onChange={e => setQty(s => ({ ...s, [l.id]: e.target.value }))} />}</Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Group>
        {!keep && (
          <Group>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">{id => <Input id={id} type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
              <Field label="Remark">{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
            </div>
          </Group>
        )}
        {keep && <p className="text-[11px] text-muted-foreground">The bill is an ordinary purchase: the goods go into stock (their bag, a certified stone, Ready Stock) and the amount onto the dealer&rsquo;s account. Any line can be changed on it before saving.</p>}
      </div>
    </ActionSheet>
  );
}

/**
 * On the Stock page: a dealer's goods with us on memo — beside our stock, marked
 * as theirs, and never in the stock figures (lib/memos.ts). Nothing is drawn when
 * none is here, or for staff without Memo in their access.
 */
export function MemoInStock({ companyId }: { companyId?: string }) {
  const db = useDb();
  const { user } = useAuth();
  const has = useHas();
  if (user?.role !== "admin" && !has("stock.memo")) return null;
  const rows = memoInOpenLines(db, companyId);
  if (!rows.length) return null;
  return (
    <div className="card-luxe overflow-hidden border-amber-500/30">
      <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-display text-lg text-brand-dark">On memo — a dealer&rsquo;s goods with us</p>
          <p className="text-xs text-muted-foreground">Not ours, and not in the stock figures above, until we keep them.</p>
        </div>
        <Button asChild variant="outline" size="sm" className="rounded-lg h-9"><Link to="/memo">Open Memo</Link></Button>
      </div>
      <div className="px-5 py-2">
        {rows.map(({ memo, line, open }) => (
          <div key={line.id} className="py-2 border-t border-border/50 first:border-t-0 flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground break-words">{line.label} <span className="ml-1 inline-block rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 align-middle">On memo</span></p>
              <p className="text-[11px] text-muted-foreground">{memoPartyName(db, memo.party)} · <span className="font-mono">{memo.no}</span> · since {fmtDate(memo.at)}{memo.dueAt ? ` · due back ${fmtDate(memo.dueAt)}` : ""}</p>
            </div>
            <p className="text-sm tabular-nums shrink-0">{qu(open, line.unit)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
