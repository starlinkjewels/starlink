import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Coins, Gem, Layers, Package, Plus, Tag, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { todayLocal, stampFor } from "@/lib/db";
import { deriveStockBalances, fmtMoneyInr } from "@/lib/manufacturing";
import { lotBalances, lotLabel } from "@/lib/diamondLots";
import { materialName, materialUnit, fmtQty } from "@/lib/materials";
import { billBrokerageInr, type BillBrokerage } from "@/lib/brokers";
import { lineCostInr, recordSupplierSale, saleProblem, type SupplierSaleInput } from "@/lib/supplierSales";
import type { SupplierSaleKind, SupplierSaleLine } from "@/lib/db";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { MoreMenu } from "@/components/MoreMenu";
import { BillBrokerFields } from "@/components/BillBrokerFields";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { LotPicker } from "@/components/LotFields";
import { OtherMaterialSelect } from "@/components/MaterialFields";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A line as the form holds it — every figure a string, as typed. */
interface Draft {
  key: string;
  kind: SupplierSaleKind;
  material: string;
  bucket: string;
  pcs: string;
  packetId: string;
  itemId: string;
  qty: string;
  rate: string;
  /** Typed amount; empty = qty × rate. */
  amount: string;
}
const KINDS: { kind: SupplierSaleKind; label: string; icon: LucideIcon }[] = [
  { kind: "diamond", label: "Loose diamond", icon: Gem },
  { kind: "certified", label: "Certified", icon: BadgeCheck },
  { kind: "gold", label: "Gold", icon: Coins },
  { kind: "material", label: "Other material", icon: Layers },
  { kind: "piece", label: "Jewellery piece", icon: Package },
];
const newDraft = (kind: SupplierSaleKind): Draft => ({
  key: Math.random().toString(36).slice(2), kind, material: kind === "diamond" ? "diamond" : kind === "gold" ? "gold" : kind, bucket: "", pcs: "", packetId: "", itemId: "", qty: kind === "piece" ? "1" : "", rate: "", amount: "",
});
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

/**
 * Sell to a supplier — loose diamonds, a certified stone, gold, other materials,
 * a Ready Stock piece, in one sale. Optional broker and brokerage. The money: off
 * what we owe them, received now into an account, or collected by the broker.
 * (lib/supplierSales.ts says what each does.)
 */
export function SellToSupplierSheet({ open, onOpenChange, supplierId: fixedSupplier }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  /** Opened from a supplier's page: that supplier, fixed. */
  supplierId?: string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const addNew = useAddNew();
  const multiCo = useMultiCo();
  const defaultCo = useDefaultCompany();
  const isAdmin = user?.role === "admin";
  const [companyId, setCompanyId] = useState(defaultCo);
  const [date, setDate] = useState(todayLocal());
  const [supplierId, setSupplierId] = useState(fixedSupplier ?? "");
  const [lines, setLines] = useState<Draft[]>([newDraft("diamond")]);
  const [broker, setBroker] = useState<BillBrokerage>({ brokerId: "", pct: "", amount: "", paidBy: "us" });
  const [money, setMoney] = useState<"account" | "locker" | "broker">("account");
  const [lockerId, setLockerId] = useState("");
  const [received, setReceived] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setSupplierId(fixedSupplier ?? ""); setLines([newDraft("diamond")]); setBroker({ brokerId: "", pct: "", amount: "", paidBy: "us" });
    setMoney("account"); setLockerId(""); setReceived(""); setNotes(""); setDate(todayLocal()); setCompanyId(defaultCo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedSupplier]);

  const suppliers = db.suppliers.filter(s => s.active !== false || s.id === supplierId).sort((a, b) => a.name.localeCompare(b.name));
  const supplier = db.suppliers.find(s => s.id === supplierId);
  const lockers = db.lockers.filter(l => l.active && (l.currency || "INR") === "INR");
  const co = companyId === "main" ? undefined : companyId;
  const goldBal = deriveStockBalances(db.stockMovements ?? [], "gold", companyId);
  const lots = lotBalances(db.stockMovements ?? [], companyId);
  const packets = (db.diamondPackets ?? []).filter(p => p.status === "in_stock" && (p.companyId || "main") === companyId)
    .sort((a, b) => (a.stockNumber || "").localeCompare(b.stockNumber || ""));
  const pieces = (db.readyStock ?? []).filter(i => i.quantity > 0 && (i.companyId || "main") === companyId).sort((a, b) => a.name.localeCompare(b.name));

  /** A draft as a sale line — or null while it isn't filled in enough to be one. */
  const toLine = (d: Draft): Omit<SupplierSaleLine, "costInr"> | null => {
    const rate = num(d.rate);
    // A certified stone's weight is the stone's own (its carat), never typed.
    const stone = d.kind === "certified" ? packets.find(x => x.id === d.packetId) : undefined;
    const qty = stone ? stone.carat : num(d.qty);
    const amountInr = d.amount.trim() !== "" ? r2(num(d.amount)) : r2(qty * rate);
    if (d.kind === "certified") {
      const p = stone;
      if (!p) return null;
      return { kind: "certified", material: "certified", packetId: p.id, qty: p.carat, unit: "ct", amountInr,
        ...(rate ? { rateInr: rate } : {}),
        label: `${p.stockNumber ? `${p.stockNumber} · ` : ""}${p.shape} ${p.carat}ct certified${p.certificateNumber ? ` (${p.certificateNumber})` : ""}` };
    }
    if (d.kind === "piece") {
      const it = pieces.find(x => x.id === d.itemId);
      if (!it) return null;
      return { kind: "piece", material: "piece", readyStockItemId: it.id, qty: qty || 1, unit: "pcs", amountInr,
        label: `${qty > 1 ? `${qty} × ` : ""}${it.name || it.jewelleryType}${it.sku ? ` (${it.sku})` : ""}` };
    }
    if (!d.bucket || !(qty > 0)) return null;
    const unit = d.kind === "diamond" ? "ct" : d.kind === "gold" ? "g" : materialUnit(db.settings, d.material);
    const pcs = Math.round(num(d.pcs));
    const label = d.kind === "diamond" ? `${qty}ct ${lotLabel(d.bucket)}${pcs > 0 ? ` · ${pcs} pcs` : ""}`
      : d.kind === "gold" ? `${qty}g ${d.bucket} gold`
      : `${fmtQty(qty, unit)} ${materialName(db.settings, d.material)}${d.bucket && d.bucket !== "—" ? ` ${d.bucket}` : ""}`;
    return { kind: d.kind, material: d.material, bucket: d.bucket, qty, unit, amountInr, label,
      ...(rate ? { rateInr: rate } : {}), ...(d.kind === "diamond" && pcs > 0 ? { pieces: pcs } : {}) };
  };
  const built = lines.map(toLine);
  const total = r2(built.reduce((t, l) => t + (l?.amountInr ?? 0), 0));
  const brokerage = billBrokerageInr(broker, total);
  const at = stampFor(date);
  const cost = useMemo(() => {
    if (!isAdmin) return null;
    let sum = 0;
    for (const l of built) { if (!l) continue; const c = lineCostInr(db, l, companyId, at); if (c == null) return null; sum += c; }
    return r2(sum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, JSON.stringify(built), companyId, at, db]);
  const profit = cost == null ? null : r2(total - cost - (broker.brokerId && broker.paidBy === "us" ? brokerage : 0));

  const set = (key: string, patch: Partial<Draft>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (built.some(l => !l)) { toast.error("Finish every line — or remove the empty one"); return; }
    const input: SupplierSaleInput = {
      companyId: co, supplierId, lines: built as Omit<SupplierSaleLine, "costInr">[], at, notes,
      ...(broker.brokerId ? { brokerId: broker.brokerId, brokeragePct: num(broker.pct) || undefined, brokerageInr: brokerage, brokeragePaidBy: broker.paidBy } : {}),
      ...(money !== "account" ? { received: { amountInr: received.trim() === "" ? total : num(received), lockerId: money === "locker" ? lockerId : undefined, byBroker: money === "broker" } } : {}),
    };
    const problem = saleProblem(db, input);
    if (problem) { toast.error(problem); return; }
    try {
      const sale = await recordSupplierSale(db, input, user!);
      toast.success(`Sold to ${supplier?.name ?? "the supplier"} — ${fmtMoneyInr(sale.totalInr)}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The sale wasn't recorded");
    }
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={Tag} title="Sell to a supplier"
      description="Out of stock, off what we owe them"
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat big label="Sale" value={total > 0 ? fmtMoneyInr(total) : "—"} sub={supplier ? `${supplier.name} owes this` : "choose the supplier"} />
            {broker.brokerId && <Stat label="Brokerage" value={brokerage > 0 ? fmtMoneyInr(brokerage) : "—"} sub={broker.paidBy === "us" ? "we pay" : "supplier pays"} />}
            {isAdmin && <Stat label="Profit" value={profit == null || total <= 0 ? "—" : fmtMoneyInr(profit)} sub={total <= 0 ? "after cost and brokerage" : cost == null ? "cost not known for a line" : `cost ${fmtMoneyInr(cost)}`} />}
          </Stats>
          <PanelActions onCancel={() => onOpenChange(false)}>
            <AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Record sale</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier" className="col-span-2 @md:col-span-1">{id => (
              <Select value={supplierId} onValueChange={addNew("supplier", setSupplierId)} disabled={!!fixedSupplier}>
                <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}<AddNewItem kind="supplier" /></SelectContent>
              </Select>
            )}</Field>
            <Field label="Date" className="col-span-2 @md:col-span-1">{id => (
              <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />
            )}</Field>
            {multiCo && (
              <div className="col-span-2">
                <CompanyPicker value={companyId} onChange={v => { setCompanyId(v); setLines([newDraft("diamond")]); }} label="Company — whose stock it is sold from" />
              </div>
            )}
          </div>
        </Group>

        <Group title="What you sold">
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
                    <span className="ml-auto text-sm font-semibold text-brand-dark tabular-nums shrink-0 pl-2">{line?.amountInr ? fmtMoneyInr(line.amountInr) : "—"}</span>
                    {/* What this line is — a loose diamond, a certified stone, gold… — changed here, as on a purchase. */}
                    <MoreMenu size="sm" label={`Line ${i + 1}: change what it is`} title="Change this line to"
                      className="border-transparent shadow-none text-muted-foreground"
                      actions={KINDS.filter(x => x.kind !== d.kind).map(x => ({ label: x.label, icon: x.icon, onSelect: () => setLines(ls => ls.map(l => (l.key === d.key ? { ...newDraft(x.kind), key: l.key } : l))) }))} />
                    <button type="button" aria-label="Remove this line" title="Remove this line" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== d.key) : [newDraft("diamond")])}
                      className="h-8 w-8 -mr-1 grid place-items-center rounded-lg shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {d.kind === "diamond" && (
                      <Field label="Lot" className="col-span-2">{id => <LotPicker id={id} value={d.bucket} onChange={key => set(d.key, { bucket: key })} companyId={companyId} />}</Field>
                    )}
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
                        <Field label="Grade">{id => (
                          <Select value={d.bucket} onValueChange={v => set(d.key, { bucket: v })}>
                            <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose grade in stock" /></SelectTrigger>
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
                    {d.kind === "diamond" && (
                      <Field label="Pcs">{id => <UnitInput id={id} min={0} step="1" value={d.pcs} onChange={e => set(d.key, { pcs: e.target.value })} placeholder="Optional" />}</Field>
                    )}
                    {d.kind !== "piece" && (
                      <Field label={`Rate (₹ / ${unit})`}>{id => <UnitInput id={id} min={0} unit={`₹/${unit}`} value={d.rate} onChange={e => set(d.key, { rate: e.target.value, amount: "" })} />}</Field>
                    )}
                    <Field label="Amount (₹)" hint={d.amount.trim() === "" && line?.amountInr ? (d.kind === "certified" && line.qty ? `${line.qty}ct × rate` : "quantity × rate") : undefined}>{id => (
                      <UnitInput id={id} min={0} unit="₹" value={d.amount} placeholder={line?.amountInr ? String(line.amountInr) : "0"} onChange={e => set(d.key, { amount: e.target.value })} />
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

        <Group title="Broker">
          <BillBrokerFields sale value={broker} onChange={v => { setBroker(v); if (!v.brokerId && money === "broker") setMoney("account"); }} billTotalInr={total} supplierId={supplierId} />
        </Group>

        <Group title="Money">
          <div className="space-y-3">
            <Segmented value={money} onChange={setMoney} options={[
              ["account", "Off their account"],
              ["locker", "Received now"],
              ...(broker.brokerId ? [["broker", "Broker collected"] as const] : []),
            ] as const} />
            <p className="text-xs text-muted-foreground">
              {money === "account" ? <>The {total > 0 ? fmtMoneyInr(total) : "sale"} comes off what we owe {supplier?.name ?? "them"}.</>
                : money === "locker" ? <>The supplier paid us now — into the account below. Their account is square for what they paid.</>
                : <>The broker collected it from the supplier for us — he holds it until he hands it over (his page shows it).</>}
            </p>
            {money !== "account" && (
              <div className="grid grid-cols-2 gap-3">
                {money === "locker" && (
                  <Field label="Into account">{id => (
                    <Select value={lockerId} onValueChange={addNew("locker", setLockerId)}>
                      <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose account" /></SelectTrigger>
                      <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<AddNewItem kind="locker" /></SelectContent>
                    </Select>
                  )}</Field>
                )}
                <Field label="Amount received (₹)" hint="Less than the sale? The rest stays on their account.">{id => (
                  <UnitInput id={id} min={0} unit="₹" value={received} placeholder={total ? String(total) : "0"} onChange={e => setReceived(e.target.value)} />
                )}</Field>
              </div>
            )}
            <Field label="Remark">{id => <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}


