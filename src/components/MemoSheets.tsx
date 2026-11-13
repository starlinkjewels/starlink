// Memo (goods on approval) — the side panels: send goods out, and take them back
import { keptForOrder } from "@/lib/orderStock";
// or sell them to whoever holds them. The books: lib/memos.ts.
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Coins, FileOutput, Gem, Layers, Package, Plus, Trash2, Undo2, BadgeDollarSign, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useHas } from "@/hooks/useCan";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { todayLocal, stampFor, fmtDate, worksOnClientId, type Memo, type MemoLine, type PurchaseCurrency, type SupplierSaleKind } from "@/lib/db";
import { deriveStockBalances } from "@/lib/manufacturing";
import { fmtCcy } from "@/lib/currency";
import { lotBalances, lotLabel } from "@/lib/diamondLots";
import { materialName, materialUnit, fmtQty, materialDef } from "@/lib/materials";
import { rateOn } from "@/lib/orderCost";
import {
  recordMemoOut, memoProblem, returnMemoGoods, sellMemoGoods, memoSaleProblem, lineOpen, linePiecesOpen, memoPartyName, PARTY_WORD,
  memoOpenValue,
  type MemoOutInput, type MemoParty,
} from "@/lib/memos";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { MoreMenu } from "@/components/MoreMenu";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { LotPicker } from "@/components/LotFields";
import { OtherMaterialSelect } from "@/components/MaterialFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openMin } from "@/lib/openMin";

interface Draft { key: string; kind: SupplierSaleKind; material: string; bucket: string; pcs: string; packetId: string; itemId: string; qty: string; rate: string; amount: string }
const KINDS: { kind: SupplierSaleKind; label: string; icon: LucideIcon }[] = [
  { kind: "diamond", label: "Loose diamond", icon: Gem },
  { kind: "certified", label: "Certified", icon: BadgeCheck },
  { kind: "piece", label: "Jewellery piece", icon: Package },
  { kind: "material", label: "Gems / other", icon: Layers },
  { kind: "gold", label: "Gold", icon: Coins },
];
const newDraft = (kind: SupplierSaleKind): Draft => ({
  key: Math.random().toString(36).slice(2), kind, material: kind === "diamond" ? "diamond" : kind === "gold" ? "gold" : kind, bucket: "", pcs: "", packetId: "", itemId: "", qty: kind === "piece" ? "1" : "", rate: "", amount: "",
});
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const SYM: Record<string, string> = { INR: "₹", USD: "$" };
/** "1.25 ct", "2 pcs" — a memo line keeps its unit as text. */
export const qu = (n: number, unit: string) => `${Math.round(n * 1000) / 1000} ${unit}`;

/** Send goods out on memo — to a client, a dealer or a broker. `party` fixes who (opened from their page). */
export function MemoOutSheet({ open, onOpenChange, party: fixed }: { open: boolean; onOpenChange: (v: boolean) => void; party?: MemoParty }) {
  const db = useDb();
  const { user } = useAuth();
  const multiCo = useMultiCo();
  const defaultCo = useDefaultCompany();
  const [companyId, setCompanyId] = useState(defaultCo);
  const [kind, setKind] = useState<MemoParty["kind"]>(fixed?.kind ?? "client");
  const [partyId, setPartyId] = useState(fixed?.id ?? "");
  const [date, setDate] = useState(todayLocal());
  const [due, setDue] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>(fixed?.kind === "client" || !fixed ? "USD" : "INR");
  const [lines, setLines] = useState<Draft[]>([newDraft("diamond")]);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind(fixed?.kind ?? "client"); setPartyId(fixed?.id ?? ""); setDate(todayLocal()); setDue(""); setLines([newDraft("diamond")]); setNotes("");
    setCurrency((fixed?.kind ?? "client") === "client" ? "USD" : "INR"); setCompanyId(defaultCo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixed?.kind, fixed?.id]);

  const parties = kind === "client"
    ? db.clients.filter(c => worksOnClientId(db, user, c.id)).map(c => ({ id: c.id, name: c.companyName }))
    : kind === "supplier" ? db.suppliers.filter(s => s.active !== false || s.id === partyId).map(s => ({ id: s.id, name: s.name }))
    : (db.brokers ?? []).map(b => ({ id: b.id, name: b.name }));
  parties.sort((a, b) => a.name.localeCompare(b.name));
  const goldBal = deriveStockBalances(db.stockMovements ?? [], "gold", companyId);
  const lots = lotBalances(db.stockMovements ?? [], companyId);
  // Not a stone kept for an order (lib/orderStock.ts keptForOrder) — that one is the order's.
  const packets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && !keptForOrder(p) && (p.companyId || "main") === companyId).sort((a, b) => (a.stockNumber || "").localeCompare(b.stockNumber || ""));
  const pieces = (db.readyStock ?? []).filter(i => i.quantity > 0 && (i.companyId || "main") === companyId).sort((a, b) => a.name.localeCompare(b.name));
  const sym = SYM[currency] ?? "";

  const toLine = (d: Draft): MemoOutInput["lines"][number] | null => {
    const rate = num(d.rate);
    const stone = d.kind === "certified" ? packets.find(x => x.id === d.packetId) : undefined;
    const qty = stone ? stone.carat : num(d.qty);
    const amount = d.amount.trim() !== "" ? r2(num(d.amount)) : r2(qty * rate);
    if (d.kind === "certified") {
      if (!stone) return null;
      return { kind: "certified", material: "certified", packetId: stone.id, qty: stone.carat, unit: "ct", amount, ...(rate ? { rate } : {}),
        label: `${stone.stockNumber ? `${stone.stockNumber} · ` : ""}${stone.shape} ${stone.carat}ct certified${stone.certificateNumber ? ` (${stone.certificateNumber})` : ""}` };
    }
    if (d.kind === "piece") {
      const it = pieces.find(x => x.id === d.itemId);
      if (!it) return null;
      return { kind: "piece", material: "piece", readyStockItemId: it.id, qty: qty || 1, unit: "pcs", amount, ...(rate ? { rate } : {}),
        label: `${it.name || it.jewelleryType}${it.sku ? ` (${it.sku})` : ""}` };
    }
    if (!d.bucket || !(qty > 0)) return null;
    const unit = d.kind === "diamond" ? "ct" : d.kind === "gold" ? "g" : materialUnit(db.settings, d.material);
    const pcs = Math.round(num(d.pcs));
    const label = d.kind === "diamond" ? lotLabel(d.bucket) : d.kind === "gold" ? `${d.bucket} gold`
      : `${materialName(db.settings, d.material)}${d.bucket && d.bucket !== "—" ? ` ${d.bucket}` : ""}`;
    return { kind: d.kind, material: d.material, bucket: d.bucket, qty, unit, amount, label, ...(rate ? { rate } : {}), ...(d.kind === "diamond" && pcs > 0 ? { pieces: pcs } : {}) };
  };
  const built = lines.map(toLine);
  const total = r2(built.reduce((t, l) => t + (l?.amount ?? 0), 0));
  const set = (key: string, patch: Partial<Draft>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (built.some(l => !l)) { toast.error("Finish every line — or remove the empty one"); return; }
    const input: MemoOutInput = {
      companyId: companyId === "main" ? undefined : companyId, party: { kind, id: partyId }, at: stampFor(date),
      ...(due ? { dueAt: stampFor(due) } : {}), currency, lines: built as MemoOutInput["lines"], notes,
    };
    const problem = memoProblem(db, input);
    if (problem) { toast.error(problem); return; }
    try {
      const memo = await recordMemoOut(db, input, user!);
      toast.success(`Memo ${memo.no} — out to ${memoPartyName(db, memo.party)}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The memo wasn't recorded");
    }
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={FileOutput} title="Send goods on memo"
      description="On approval — still ours until they buy. Out of available stock until it comes back."
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat big label="Memo value" value={total > 0 ? fmtCcy(total, currency) : "—"} sub="at the prices agreed — nothing is owed yet" />
            <Stat label="Lines" value={String(built.filter(Boolean).length)} />
          </Stats>
          <PanelActions onCancel={() => onOpenChange(false)}>
            <AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Send on memo</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group>
          <div className="grid grid-cols-2 gap-3">
            {!fixed && (
              <div className="col-span-2">
                <Segmented value={kind} onChange={k => { setKind(k); setPartyId(""); setCurrency(k === "client" ? "USD" : "INR"); }}
                  options={[["client", "Client"], ["supplier", "Dealer"], ["broker", "Broker"]] as const} />
              </div>
            )}
            <Field label={PARTY_WORD[kind]} className="col-span-2 @md:col-span-1">{id => (
              <Select value={partyId} onValueChange={setPartyId} disabled={!!fixed}>
                <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Who takes the goods"><SelectValue placeholder={parties.length ? `Choose ${PARTY_WORD[kind].toLowerCase()}` : `No ${PARTY_WORD[kind].toLowerCase()}s yet`} /></SelectTrigger>
                <SelectContent>{parties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )}</Field>
            <Field label="Prices in" className="col-span-2 @md:col-span-1" hint={kind !== "client" ? "A sale to a dealer is in rupees" : undefined}>{id => (
              <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)} disabled={kind !== "client"}>
                <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Prices in"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">Dollars ($)</SelectItem><SelectItem value="INR">Rupees (₹)</SelectItem></SelectContent>
              </Select>
            )}</Field>
            <Field label="Date out">{id => <Input id={id} type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
            <Field label="Due back" hint="Optional">{id => <Input id={id} type="date" min={date} value={due} onChange={e => setDue(e.target.value)} className="rounded-xl h-10" aria-label="Due back" />}</Field>
            {multiCo && (
              <div className="col-span-2">
                <CompanyPicker value={companyId} onChange={v => { setCompanyId(v); setLines([newDraft("diamond")]); }} label="Company — whose stock goes out" />
              </div>
            )}
          </div>
        </Group>

        <Group title="The goods">
          <div className="space-y-3">
            {lines.map((d, i) => {
              const k = KINDS.find(x => x.kind === d.kind)!;
              const unit = d.kind === "diamond" ? "ct" : d.kind === "gold" ? "g" : d.kind === "material" ? materialUnit(db.settings, d.material) : d.kind === "piece" ? "pcs" : "ct";
              const matBal = d.kind === "material" && d.material && d.material !== "material" ? deriveStockBalances(db.stockMovements ?? [], d.material, companyId) : {};
              const have = d.kind === "diamond" ? lots.find(l => l.key === d.bucket)?.ct : d.kind === "gold" ? goldBal[d.bucket] : d.kind === "material" ? matBal[d.bucket] : undefined;
              const line = built[i];
              const piece = d.kind === "piece" ? pieces.find(x => x.id === d.itemId) : undefined;
              return (
                <div key={d.key} className="rounded-xl border border-border/70 bg-white p-3 space-y-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><k.icon className="h-3.5 w-3.5" /></span>
                    <span className="text-sm font-medium text-foreground truncate">{k.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">#{i + 1}</span>
                    <span className="ml-auto text-sm font-semibold text-brand-dark tabular-nums shrink-0 pl-2">{line?.amount ? fmtCcy(line.amount, currency) : "—"}</span>
                    <MoreMenu size="sm" label={`Line ${i + 1}: change what it is`} title="Change this line to" className="border-transparent shadow-none text-muted-foreground"
                      actions={KINDS.filter(x => x.kind !== d.kind).map(x => ({ label: x.label, icon: x.icon, onSelect: () => setLines(ls => ls.map(l => (l.key === d.key ? { ...newDraft(x.kind), key: l.key } : l))) }))} />
                    <button type="button" aria-label="Remove this line" title="Remove this line" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== d.key) : [newDraft("diamond")])}
                      className="h-8 w-8 -mr-1 grid place-items-center rounded-lg shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {d.kind === "diamond" && <Field label="Bag" className="col-span-2">{id => <LotPicker id={id} value={d.bucket} onChange={key => set(d.key, { bucket: key })} companyId={companyId} />}</Field>}
                    {d.kind === "gold" && (
                      <Field label="Purity" className="col-span-2">{id => (
                        <Select value={d.bucket} onValueChange={v => set(d.key, { bucket: v })}>
                          <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder={Object.values(goldBal).some(v => v > 0) ? "Choose purity in stock" : "No gold in stock"} /></SelectTrigger>
                          <SelectContent>{Object.entries(goldBal).filter(([, v]) => v > 0).map(([p, v]) => <SelectItem key={p} value={p}>{p} — {fmtQty(v, "g")} in stock</SelectItem>)}</SelectContent>
                        </Select>
                      )}</Field>
                    )}
                    {d.kind === "material" && (
                      <>
                        <Field label="Material">{() => <OtherMaterialSelect value={d.material === "material" ? "" : d.material} onChange={v => set(d.key, { material: v, bucket: "" })} />}</Field>
                        <Field label={materialDef(db.settings, d.material)?.kind === "stone" ? "Stones in stock" : "Grade"}>{id => (
                          <Select value={d.bucket} onValueChange={v => set(d.key, { bucket: v })}>
                            <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose from stock" /></SelectTrigger>
                            <SelectContent>{Object.entries(matBal).filter(([, v]) => v > 0).map(([g, v]) => <SelectItem key={g} value={g}>{g === "—" ? "No grade" : g} — {fmtQty(v, unit)}</SelectItem>)}</SelectContent>
                          </Select>
                        )}</Field>
                      </>
                    )}
                    {d.kind === "certified" && (
                      <Field label="Certified diamond" className="col-span-2" hint={packets.length ? undefined : "No certified diamonds in stock."}>{id => (
                        <Select value={d.packetId} onValueChange={v => set(d.key, { packetId: v })}>
                          <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose a diamond in stock" /></SelectTrigger>
                          <SelectContent>{packets.filter(p => p.id === d.packetId || !lines.some(x => x.packetId === p.id)).map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.stockNumber ? `${p.stockNumber} · ` : ""}{p.shape} {p.carat}ct{p.certificateNumber ? ` · Report ${p.certificateNumber}` : ""}</SelectItem>
                          ))}</SelectContent>
                        </Select>
                      )}</Field>
                    )}
                    {d.kind === "piece" && (
                      <Field label="Ready Stock piece" className="col-span-2" hint={piece ? `${piece.quantity} in stock · list price $${piece.price.toLocaleString("en-US")}` : pieces.length ? undefined : "Nothing in Ready Stock."}>{id => (
                        <Select value={d.itemId} onValueChange={v => set(d.key, { itemId: v })}>
                          <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose a piece" /></SelectTrigger>
                          <SelectContent>{pieces.map(it => <SelectItem key={it.id} value={it.id}>{it.name || it.jewelleryType}{it.sku ? ` · ${it.sku}` : ""} · {it.quantity} in stock</SelectItem>)}</SelectContent>
                        </Select>
                      )}</Field>
                    )}
                    {d.kind !== "certified" && (
                      <Field label={d.kind === "piece" ? "How many" : `Quantity (${unit})`} hint={have != null ? `In stock: ${fmtQty(have, unit)}` : undefined}>{id => (
                        <UnitInput id={id} min={0} step={d.kind === "piece" ? "1" : "0.001"} unit={unit} value={d.qty} onChange={e => set(d.key, { qty: e.target.value })} />
                      )}</Field>
                    )}
                    {d.kind === "diamond" && <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={d.pcs} onChange={e => set(d.key, { pcs: e.target.value })} placeholder="Optional" />}</Field>}
                    <Field label={`Rate (${sym} / ${unit})`}>{id => <UnitInput id={id} min={0} unit={`${sym}/${unit}`} value={d.rate} onChange={e => set(d.key, { rate: e.target.value, amount: "" })} />}</Field>
                    <Field label={`Amount (${sym})`} hint={d.amount.trim() === "" && line?.amount ? "quantity × rate" : "Optional — the price if they keep it"}>{id => (
                      <UnitInput id={id} min={0} unit={sym} value={d.amount} placeholder={line?.amount ? String(line.amount) : "0"} onChange={e => set(d.key, { amount: e.target.value })} />
                    )}</Field>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map(k => (
                <Button key={k.kind} type="button" variant="outline" size="sm" className="rounded-lg h-9" onClick={() => setLines(ls => [...ls, newDraft(k.kind)])}>
                  <Plus className="h-3.5 w-3.5" />{k.label}
                </Button>
              ))}
            </div>
          </div>
        </Group>
        <Field label="Remark">{id => <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
      </div>
    </ActionSheet>
  );
}

/** Goods of a memo come back — or are sold to whoever holds them. */
export function MemoBackSheet({ memo, mode, onClose }: { memo: Memo; mode: "return" | "sold"; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const nav = useNavigate();
  const sold = mode === "sold";
  const openLines = memo.lines.filter(l => lineOpen(memo, l) > 1e-6);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(openLines.map(l => [l.id, true])));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(openLines.map(l => [l.id, String(lineOpen(memo, l))])));
  const [pcs, setPcs] = useState<Record<string, string>>(() => Object.fromEntries(openLines.map(l => [l.id, linePiecesOpen(memo, l) ? String(linePiecesOpen(memo, l)) : ""])));
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const isBroker = memo.party.kind === "broker";
  const [buyerKind, setBuyerKind] = useState<"client" | "supplier">(memo.party.kind === "client" ? "client" : "supplier");
  const [buyerId, setBuyerId] = useState(isBroker ? "" : memo.party.id);
  const fx0 = useMemo(() => rateOn(db, stampFor(date))?.rate, [db, date]);
  const [xrate, setXrate] = useState("");
  const sym = SYM[memo.currency] ?? "";
  const who = memoPartyName(db, memo.party);

  const picked = openLines.filter(l => on[l.id]);
  const q = (l: MemoLine) => (l.kind === "certified" ? l.qty : num(qty[l.id] ?? ""));
  const priceOf = (l: MemoLine) => (amount[l.id]?.trim() ? r2(num(amount[l.id])) : r2(l.qty > 0 ? l.amount * (q(l) / l.qty) : l.amount));
  const total = r2(picked.reduce((t, l) => t + priceOf(l), 0));
  const buyers = buyerKind === "client"
    ? db.clients.filter(c => worksOnClientId(db, user, c.id)).map(c => ({ id: c.id, name: c.companyName }))
    : db.suppliers.filter(s => s.active !== false).map(s => ({ id: s.id, name: s.name }));
  buyers.sort((a, b) => a.name.localeCompare(b.name));
  const toBill = sold && buyerKind === "client" ? picked.filter(l => !["diamond", "certified"].includes(l.kind)) : [];
  const needsRate = sold && buyerKind === "client" && memo.currency === "USD" && picked.some(l => ["diamond", "certified"].includes(l.kind));

  const save = async () => {
    const picks = picked.map(l => ({ lineId: l.id, qty: q(l), ...(l.kind === "diamond" && num(pcs[l.id] ?? "") > 0 ? { pieces: Math.round(num(pcs[l.id])) } : {}) }));
    try {
      if (!sold) {
        await returnMemoGoods(memo.id, picks, user!, { at: stampFor(date), note });
        toast.success(`Back from ${who} — in stock again`);
        onClose();
        return;
      }
      const input = { picks: picked.map((l, i) => ({ ...picks[i], amount: priceOf(l) })), buyer: { kind: buyerKind, id: buyerId }, exchangeRate: num(xrate) || fx0, at: stampFor(date), note };
      const problem = memoSaleProblem(db, memo, input);
      if (problem) { toast.error(problem); return; }
      const res = await sellMemoGoods(memo.id, input, user!);
      if (res.sold.length) toast.success(`Sold — ${fmtCcy(r2(res.sold.reduce((t, l) => t + priceOf(l), 0)), memo.currency)} on ${buyers.find(b => b.id === buyerId)?.name ?? "their"} account`);
      const pcsBack = res.toBill.filter(l => l.kind === "piece" && l.readyStockItemId);
      if (res.toBill.length) toast.message(`${res.toBill.map(l => l.label).join(", ")} — back in stock, to be billed on an order`, { duration: 9000 });
      onClose();
      // The pieces a client keeps are billed the way every piece is: an order from Ready Stock.
      if (pcsBack.length) nav(`/orders/new?readyStock=${encodeURIComponent([...new Set(pcsBack.map(l => l.readyStockItemId!))].join(","))}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — check the memo");
    }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={sold ? BadgeDollarSign : Undo2}
      title={sold ? `Sold from memo ${memo.no}` : `Back from memo ${memo.no}`}
      description={sold ? `${who} keeps these — they become a sale` : `${who} gives these back — into stock again, at the cost they left at`}
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat big label={sold ? "Sale" : "Coming back"} value={sold ? fmtCcy(total, memo.currency) : `${picked.length} line${picked.length === 1 ? "" : "s"}`} sub={sold ? "owed by the buyer — receive it like any sale" : "nothing is owed"} />
          </Stats>
          <PanelActions onCancel={onClose}>
            <AsyncButton onClick={save} disabled={!picked.length} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">{sold ? "Record sale" : "Take back"}</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group title={sold ? "What was sold" : "What came back"}>
          <div className="space-y-2">
            {openLines.map(l => {
              const open = lineOpen(memo, l);
              return (
                <div key={l.id} className={`rounded-xl border p-3 ${on[l.id] ? "border-primary/40 bg-primary/5" : "border-border/70"}`}>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!on[l.id]} onChange={e => setOn(s => ({ ...s, [l.id]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[var(--primary)]" aria-label={`Include ${l.label}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground break-words">{l.label}</span>
                      <span className="block text-[11px] text-muted-foreground">Still out: {qu(open, l.unit)}{linePiecesOpen(memo, l) ? ` · ${linePiecesOpen(memo, l)} pcs` : ""}{l.amount ? ` · ${fmtCcy(l.amount, memo.currency)} for ${qu(l.qty, l.unit)}` : ""}</span>
                    </span>
                  </label>
                  {on[l.id] && (
                    <div className="grid grid-cols-2 @md:grid-cols-3 gap-2.5 mt-2.5">
                      {l.kind !== "certified" && (
                        <Field label={`Quantity (${l.unit})`}>{id => <UnitInput id={id} min={0} step={l.kind === "piece" ? "1" : "0.001"} unit={l.unit} value={qty[l.id] ?? ""} onChange={e => setQty(s => ({ ...s, [l.id]: e.target.value }))} />}</Field>
                      )}
                      {l.kind === "diamond" && <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={pcs[l.id] ?? ""} onChange={e => setPcs(s => ({ ...s, [l.id]: e.target.value }))} placeholder="Optional" />}</Field>}
                      {sold && <Field label={`Price (${sym})`}>{id => <UnitInput id={id} min={0} unit={sym} value={amount[l.id] ?? ""} placeholder={String(priceOf(l) || 0)} onChange={e => setAmount(s => ({ ...s, [l.id]: e.target.value }))} />}</Field>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Group>

        {sold && isBroker && (
          <Group title="Who bought it">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Segmented value={buyerKind} onChange={k => { setBuyerKind(k); setBuyerId(""); }} options={[["supplier", "A dealer"], ["client", "A client"]] as const} /></div>
              <Field label="Buyer" className="col-span-2">{id => (
                <Select value={buyerId} onValueChange={setBuyerId}>
                  <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Buyer"><SelectValue placeholder="Choose the buyer" /></SelectTrigger>
                  <SelectContent>{buyers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              )}</Field>
            </div>
          </Group>
        )}
        {sold && buyerKind === "supplier" && memo.currency !== "INR" && <p className="text-xs text-destructive">A sale to a dealer is in rupees — this memo is in dollars. Take the goods back and sell them from Buy &amp; Assign.</p>}
        {toBill.length > 0 && (
          <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-amber-800">
            {toBill.map(l => l.label).join(", ")}: a client is billed for {toBill.some(l => l.kind === "piece") ? "a piece" : "these"} on an order — {toBill.length === 1 ? "it comes" : "they come"} back to stock now{toBill.some(l => l.kind === "piece") ? ", and New Order opens with the piece" : ""}.
          </p>
        )}

        <Group>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">{id => <Input id={id} type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
            {needsRate && <Field label="₹ for $1" hint={fx0 ? `Today's: ${fx0}` : undefined}>{id => <UnitInput id={id} min={0} unit="₹" value={xrate} placeholder={fx0 ? String(fx0) : ""} onChange={e => setXrate(e.target.value)} />}</Field>}
            <Field label="Remark" className="col-span-2">{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
          </div>
        </Group>
        <p className="text-[11px] text-muted-foreground">Out since {fmtDate(memo.at)}{memo.dueAt ? ` · due back ${fmtDate(memo.dueAt)}` : ""}.</p>
      </div>
    </ActionSheet>
  );
}

/**
 * A client's, dealer's or broker's goods on memo, on their own page: what they
 * hold now, with Send on memo. Nothing is drawn for someone who has no memo
 * (and for staff without Memo in their access).
 */
export function PartyMemos({ party }: { party: MemoParty }) {
  const db = useDb();
  const { user } = useAuth();
  const has = useHas();
  const [adding, setAdding] = useState(false);
  const may = user?.role === "admin" || has("stock.memo");
  const mine = (db.memos ?? []).filter(m => m.party.kind === party.kind && m.party.id === party.id);
  const open = mine.filter(m => m.lines.some(l => lineOpen(m, l) > 1e-6));
  if (!may || user?.role === "client") return null;
  if (!mine.length) return null;
  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-display text-lg text-brand-dark">On memo</p>
          <p className="text-xs text-muted-foreground">{open.length ? `${open.length} open memo${open.length === 1 ? "" : "s"}` : "Nothing open now"} · {mine.length} in all</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-lg h-9" onClick={() => setAdding(true)}><FileOutput className="h-4 w-4" /> Send on memo</Button>
          <Button asChild variant="outline" size="sm" className="rounded-lg h-9"><Link to="/memo">All memos</Link></Button>
        </div>
      </div>
      {open.length > 0 && (
        <div className="px-5 py-2">
          {open.map(m => (
            <div key={m.id} className="py-2 border-t border-border/50 first:border-t-0 flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm"><span className="font-mono text-xs font-semibold">{m.no}</span> <span className="text-muted-foreground">· {m.dir === "in" ? "their goods with us since" : "ours with them since"} {fmtDate(m.at)}{m.dueAt ? ` · due ${fmtDate(m.dueAt)}` : ""}</span></p>
                <p className="text-[11px] text-muted-foreground break-words">{m.lines.filter(l => lineOpen(m, l) > 1e-6).map(l => `${l.label} — ${qu(lineOpen(m, l), l.unit)}`).join(" · ")}</p>
              </div>
              <p className="text-sm tabular-nums shrink-0">{fmtCcy(memoOpenValue(m), m.currency)}</p>
            </div>
          ))}
        </div>
      )}
      {adding && <MemoOutSheet open onOpenChange={v => { if (!v) setAdding(false); }} party={party} />}
    </div>
  );
}
