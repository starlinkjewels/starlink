import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Undo2, PackageCheck, Truck, Wallet, Gift, Coins, Warehouse, FileText, Minus, Plus, AlertTriangle, Printer, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  loadDb, updateDbAs, uid, fmtMoney, fmtDate, keptQty, ensureCollections, mainDiamondShape, READY_STOCK_LOCATIONS,
  type Order, type Invoice, type OrderReturn,
} from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { reserveCreditNoteNumber, releaseCreditNoteNumber } from "@/lib/counters";
import { planReturn, applyReturn, receiveReturn, cancelReturn, cancelReturnBlocker, returnBlocker, returnsComing, RETURN_REASONS, type ReturnPlan } from "@/lib/salesReturn";
import { printCreditNote } from "@/lib/invoicePrint";
import { orderCost, rateOn, saleDate } from "@/lib/orderCost";
import { COST } from "@/lib/pageData";
import { confirmBox } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IfExport } from "@/components/IfExport";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** May this person record, receive or cancel returns? (Billing changes: Invoices → Edit.) */
export function useMayReturn(): boolean {
  const can = useCan();
  const { user } = useAuth();
  return !!user && user.role !== "client" && can("invoices", "edit");
}

const thumb = (o: Order) => o.cadImage || o.productPhotos?.[0] || o.images?.[0];
const describe = (o: Order) => [o.productKarats, o.metal !== "None (Diamond only)" ? o.metal : "", o.jewelleryType, o.designNumber ? `#${o.designNumber}` : ""].filter(Boolean).join(" · ");
const shapes = (orderIds: string[]) => Object.fromEntries(orderIds.map(id => [id, mainDiamondShape(loadDb(), id) ?? ""]));

/**
 * What one returned piece cost, in dollars at the rate of its sale — for the
 * Ready Stock card. Admin only (cost is private); undefined when not known.
 */
async function pieceCostUsd(orderId: string, isAdmin: boolean): Promise<number | undefined> {
  if (!isAdmin) return undefined;
  try {
    await ensureCollections(COST);
    const db = loadDb();
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return undefined;
    const c = orderCost(db, o);
    const fx = rateOn(db, saleDate(o));
    if (!fx || !(c.pieceInr > 0)) return undefined;
    return Math.round((c.pieceInr / (o.quantity || 1) / fx.rate) * 100) / 100;
  } catch { return undefined; }
}

/** Print the credit note a return belongs to. */
export function printNote(noteId: string) {
  const db = loadDb();
  const ids = db.orders.filter(o => o.returns?.some(r => r.noteId === noteId)).map(o => o.id);
  printCreditNote(db, noteId, shapes(ids));
}

/**
 * Record pieces a client sent back (lib/salesReturn.ts) — from one order, or
 * any of the orders on an invoice. The left side says what came back and on
 * what terms; the right side says exactly what that does before it is done.
 */
export function ReturnDialog({ orders, invoice, start, onClose }: {
  orders: Order[]; invoice?: Invoice; start?: Record<string, number>; onClose: () => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const live = orders.map(o => db.orders.find(x => x.id === o.id) ?? o);
  const open = live.filter(o => !returnBlocker(o));
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(live.map(o => [o.id, start?.[o.id] ?? (live.length === 1 && !returnBlocker(o) ? keptQty(o) : 0)])));
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState(false);
  const [location, setLocation] = useState<string>("US");
  const [refundShipping, setRefundShipping] = useState(false);
  const [fee, setFee] = useState("");
  const [chargeSpent, setChargeSpent] = useState(true);
  const [price, setPrice] = useState<Record<string, string>>({});
  const client = db.clients.find(c => c.id === live[0]?.clientId);

  const input = live.map(o => ({ orderId: o.id, qty: qty[o.id] || 0 }));
  const opts = {
    reason, received, location, refundShipping, feeUsd: Number(fee) || 0, chargeSpentCashback: chargeSpent,
    priceUsd: Object.fromEntries(Object.entries(price).filter(([, v]) => v !== "" && Number(v) >= 0).map(([k, v]) => [k, Number(v)])),
  };
  const plan: ReturnPlan = useMemo(() => planReturn(db, input, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, JSON.stringify(input), JSON.stringify(opts)]);
  const t = plan.totals;
  const closing = plan.lines.some(l => l.qty === l.kept && ((l.order.shippingCharge || 0) > 0 || (l.order.certificateFee || 0) > 0));
  const spent = plan.lines.reduce((s, l) => s + l.cashbackSpentUsd, 0);
  const owedBefore = plan.lines.reduce((s, l) => s + l.owedBefore, 0);
  const owedAfter = plan.lines.reduce((s, l) => s + l.owedAfter, 0);

  const save = async () => {
    if (!user) return;
    if (plan.blocked) { toast.error(plan.blocked); return; }
    let no = "";
    try { no = await reserveCreditNoteNumber(loadDb().orders); }
    catch { toast.error("Could not get a credit note number — check the connection and try again."); return; }
    const noteId = uid("cn_");
    let applied: ReturnPlan | undefined;
    try {
      const costUsd: Record<string, number> = {};
      if (received) {
        await ensureCollections(["materialIssuances"]);
        for (const l of plan.lines) { const c = await pieceCostUsd(l.order.id, user.role === "admin"); if (c != null) costUsd[l.order.id] = c; }
      }
      updateDbAs({ summary: `Return ${no} — ${t.qty} pc${t.qty !== 1 ? "s" : ""} from ${client?.companyName ?? "client"}, ${fmtMoney(t.creditUsd)} credit` }, d => {
        applied = applyReturn(d, input, opts, { noteId, creditNoteNo: no, by: user.id, byName: user.name, at: new Date().toISOString(), costUsd });
      });
    } catch (e) {
      await releaseCreditNoteNumber(no).catch(() => {});
      toast.error(e instanceof Error ? e.message : "Could not record the return");
      return;
    }
    if (!applied || applied.blocked) {
      await releaseCreditNoteNumber(no).catch(() => {});
      toast.error(applied?.blocked ?? "Nothing was returned");
      return;
    }
    toast.success(`${no} recorded — ${fmtMoney(applied.totals.creditUsd)} off the bill${received ? `, ${applied.totals.qty} pc${applied.totals.qty !== 1 ? "s" : ""} into Ready Stock` : ""}`, {
      action: { label: "Print credit note", onClick: () => printNote(noteId) },
      duration: 9000,
    });
    onClose();
  };

  const choice = (on: boolean, pick: () => void, icon: React.ReactNode, title: string, sub: string) => (
    <button type="button" role="radio" aria-checked={on} onClick={pick}
      className={`text-left rounded-xl border p-3 transition-all ${on ? "border-primary ring-2 ring-primary/25 bg-primary/5" : "border-border/70 hover:border-primary/40 bg-card"}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-dark">{icon}{title}</span>
      <span className="block text-[11px] text-muted-foreground mt-1 leading-snug">{sub}</span>
    </button>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-6xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2"><Undo2 className="h-5 w-5 text-primary" /> Return from {client?.companyName ?? "client"}</DialogTitle>
          <DialogDescription className="text-xs">
            {invoice ? `Invoice ${invoice.number} stays as it was issued. ` : ""}A credit note takes the returned pieces off what the client owes; the pieces go into Ready Stock when they reach you.
          </DialogDescription>
        </DialogHeader>
        <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 text-sm">
          {/* ── Left: what came back, and on what terms ── */}
          <div className="space-y-4 min-w-0">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Pieces coming back</p>
              <div className="space-y-2">
                {live.map(o => {
                  const why = returnBlocker(o);
                  const kept = keptQty(o);
                  const n = qty[o.id] || 0;
                  const set = (v: number) => setQty(q => ({ ...q, [o.id]: Math.max(0, Math.min(kept, v)) }));
                  const img = thumb(o);
                  const unit = Math.round(((o.amount || 0) / (o.quantity || 1)) * 100) / 100;
                  return (
                    <div key={o.id} className={`rounded-xl border p-2.5 flex flex-wrap items-center gap-3 ${n > 0 ? "border-primary/50 bg-primary/5" : "border-border/60"} ${why ? "opacity-60" : ""}`}>
                      <div className="h-12 w-12 rounded-lg bg-secondary/60 overflow-hidden shrink-0 grid place-items-center">
                        {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <PackageCheck className="h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1 basis-[55%]">
                        <p className="font-semibold text-brand-dark text-sm truncate">{o.orderNumber} <span className="font-normal text-muted-foreground">· {describe(o)}</span></p>
                        <p className="text-[11px] text-muted-foreground">
                          {why ?? `${fmtMoney(unit)} a piece · client has ${kept} of ${o.quantity || 1}`}
                        </p>
                        {n > 0 && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Label className="text-[11px] text-muted-foreground font-normal whitespace-nowrap" htmlFor={`rp_${o.id}`}>Ready Stock price</Label>
                            <Input id={`rp_${o.id}`} type="number" inputMode="decimal" min="0" value={price[o.id] ?? String(unit)} onChange={e => setPrice(p => ({ ...p, [o.id]: e.target.value }))}
                              className="h-7 w-28 rounded-lg text-xs" aria-label={`Ready Stock price for ${o.orderNumber}`} />
                          </div>
                        )}
                      </div>
                      {!why && (
                        kept === 1 ? (
                          <Button type="button" size="sm" variant={n ? "default" : "outline"} className="rounded-lg shrink-0 ml-auto" onClick={() => set(n ? 0 : 1)} aria-pressed={!!n}>
                            {n ? "Returning" : "Return it"}
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0 ml-auto" role="group" aria-label={`Pieces back of ${o.orderNumber}`}>
                            <Button type="button" size="icon" variant="outline" className="h-8 w-8 rounded-lg" onClick={() => set(n - 1)} aria-label="One less"><Minus className="h-3.5 w-3.5" /></Button>
                            <span className="w-14 text-center text-sm tabular-nums"><span className="font-semibold">{n}</span> of {kept}</span>
                            <Button type="button" size="icon" variant="outline" className="h-8 w-8 rounded-lg" onClick={() => set(n + 1)} aria-label="One more"><Plus className="h-3.5 w-3.5" /></Button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
              {live.length > 1 && open.length > 1 && (
                <button type="button" className="text-xs text-primary hover:underline mt-1.5"
                  onClick={() => setQty(Object.fromEntries(live.map(o => [o.id, returnBlocker(o) ? 0 : keptQty(o)])))}>Everything on this invoice came back</button>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Why</p>
              <div className="flex flex-wrap gap-1.5">
                {RETURN_REASONS.map(r => (
                  <button key={r} type="button" onClick={() => setReason(reason === r ? "" : r)}
                    className={`h-8 px-3 rounded-lg border text-xs ${reason === r ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-secondary"}`}>{r}</button>
                ))}
              </div>
              <Input value={RETURN_REASONS.includes(reason) ? "" : reason} onChange={e => setReason(e.target.value)} placeholder="or write the reason" className="mt-2 h-9 rounded-lg text-sm" />
            </div>

            <div className="rounded-2xl border border-border/60 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">Where are the pieces?</p>
              <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Where the pieces are">
                {choice(!received, () => setReceived(false), <Truck className="h-4 w-4 text-primary" />, "On their way back", "Mark them received when the parcel arrives")}
                {choice(received, () => setReceived(true), <Warehouse className="h-4 w-4 text-primary" />, "Here already", "Into Ready Stock now")}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Comes back to</Label>
                  <Select value={location} onValueChange={setLocation}>
                    <SelectTrigger className="h-10 rounded-xl" aria-label="Comes back to"><SelectValue /></SelectTrigger>
                    <SelectContent>{READY_STOCK_LOCATIONS.map(l => <SelectItem key={l} value={l}>{l === "US" ? "US office" : l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="ret_fee">Return charge, $ <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="ret_fee" type="number" inputMode="decimal" min="0" value={fee} onChange={e => setFee(e.target.value)} placeholder="0" className="h-10 rounded-xl" />
                </div>
              </div>
              {closing && (
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={refundShipping} onChange={e => setRefundShipping(e.target.checked)} />
                  <span>Refund the shipping and certificate fee too <span className="text-muted-foreground">(on an order whose every piece is back)</span></span>
                </label>
              )}
              {spent > 0 && (
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={chargeSpent} onChange={e => setChargeSpent(e.target.checked)} />
                  <span>Keep the {fmtMoney(spent)} cashback they already spent on their bill <span className="text-muted-foreground">(it was earned on these pieces)</span></span>
                </label>
              )}
            </div>
          </div>

          {/* ── Right: exactly what will happen ── */}
          <div className="min-w-0">
            <div className="lg:sticky lg:top-0 rounded-2xl bg-secondary/50 border border-border/60 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What happens</p>
              {plan.blocked ? (
                <p className="text-xs rounded-xl bg-card ring-1 ring-border/60 p-3 flex gap-2"><AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />{plan.blocked}</p>
              ) : (
                <>
                  <div className="rounded-xl bg-card ring-1 ring-border/60 p-3">
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> A credit note (numbered on save){invoice ? ` against invoice ${invoice.number}` : ""}</p>
                    <p className="font-display text-2xl text-brand-dark mt-0.5">{fmtMoney(t.creditUsd)} <span className="text-sm font-sans text-muted-foreground">off the bill</span></p>
                    <p className="text-xs text-muted-foreground mt-1">Owed {fmtMoney(owedBefore)} → <span className="font-semibold text-brand-dark">{fmtMoney(owedAfter)}</span></p>
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {plan.lines.map(l => (
                        <li key={l.order.id} className="flex justify-between gap-2"><span className="truncate">{l.order.orderNumber} · {l.qty} of {l.kept} pc{l.kept !== 1 ? "s" : ""}</span><span className="tabular-nums">−{fmtMoney(l.creditUsd)}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl bg-card ring-1 ring-border/60 p-3 space-y-1.5 text-xs">
                    {t.toCreditUsd > 0
                      ? <p className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-primary" /> <span><span className="font-semibold">{fmtMoney(t.toCreditUsd)}</span> already paid moves to {client?.companyName ?? "the client"}'s credit — for their next bills</span></p>
                      : <p className="flex items-center gap-1.5 text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Nothing paid on these is freed — no credit to hold</p>}
                    {t.giftBackUsd > 0 && <p className="flex items-center gap-1.5"><Gift className="h-3.5 w-3.5 text-primary" /> {fmtMoney(t.giftBackUsd)} of the gift card goes back on the card</p>}
                    {t.cashbackBackUsd > 0 && <p className="flex items-center gap-1.5"><Coins className="h-3.5 w-3.5 text-amber-600" /> {fmtMoney(t.cashbackBackUsd)} cashback earned on them is taken back</p>}
                    {t.cashbackChargedUsd > 0 && <p className="flex items-center gap-1.5"><Coins className="h-3.5 w-3.5 text-amber-600" /> {fmtMoney(t.cashbackChargedUsd)} cashback already spent stays on the bill</p>}
                    {t.feeUsd > 0 && <p className="flex items-center gap-1.5"><Coins className="h-3.5 w-3.5 text-muted-foreground" /> Return charge {fmtMoney(t.feeUsd)} stays on the bill</p>}
                    {t.shippingBackUsd > 0 && <p className="flex items-center gap-1.5"><Truck className="h-3.5 w-3.5 text-primary" /> {fmtMoney(t.shippingBackUsd)} shipping &amp; certificate refunded</p>}
                  </div>
                  <div className="rounded-xl bg-card ring-1 ring-border/60 p-3 flex items-center gap-2.5 text-xs">
                    <Warehouse className="h-5 w-5 text-primary shrink-0" />
                    <p><span className="font-semibold text-brand-dark text-sm">{t.qty} pc{t.qty !== 1 ? "s" : ""}</span> into Ready Stock ({location === "US" ? "US office" : location}) {received ? "now" : "when they arrive"} — with their photos, weights and cost</p>
                  </div>
                </>
              )}
              <p className="text-[11px] text-muted-foreground">Recorded by mistake? "Cancel return" on the order puts everything back while the piece is unsold and the credit unused.</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} disabled={!!plan.blocked} className="rounded-xl btn-hero gap-1.5"><Undo2 className="h-4 w-4" /> Record return</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The parcel arrived: into Ready Stock, at a place and price. */
export function ReceiveReturnDialog({ order, ret, onClose }: { order: Order; ret: OrderReturn; onClose: () => void }) {
  const { user } = useAuth();
  const [location, setLocation] = useState(ret.location || "US");
  const [price, setPrice] = useState(String(ret.priceUsd ?? Math.round(((order.amount || 0) / (order.quantity || 1)) * 100) / 100));
  const go = async () => {
    if (!user) return;
    await ensureCollections(["materialIssuances"]);
    const costUsd = await pieceCostUsd(order.id, user.role === "admin");
    updateDbAs({ summary: `Received return ${ret.creditNoteNo} — ${order.orderNumber}, ${ret.qty} pc${ret.qty !== 1 ? "s" : ""} into Ready Stock` }, d => {
      receiveReturn(d, order.id, ret.id, { by: user.id, at: new Date().toISOString(), location, priceUsd: Number(price) >= 0 ? Number(price) : undefined, costUsd });
    });
    toast.success(`${order.orderNumber}: ${ret.qty} pc${ret.qty !== 1 ? "s" : ""} in Ready Stock (${location})`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" /> Received — {order.orderNumber}</DialogTitle>
          <DialogDescription className="text-xs">{ret.qty} piece{ret.qty !== 1 ? "s" : ""} back on {ret.creditNoteNo}. They go into Ready Stock with the order's photos and weights.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Where it is now</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Where it is now"><SelectValue /></SelectTrigger>
              <SelectContent>{READY_STOCK_LOCATIONS.map(l => <SelectItem key={l} value={l}>{l === "US" ? "US office" : l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="rr_price">Selling price per piece, $</Label>
            <Input id="rr_price" type="number" inputMode="decimal" min="0" value={price} onChange={e => setPrice(e.target.value)} className="h-10 rounded-xl" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={go} className="rounded-xl btn-hero gap-1.5"><Warehouse className="h-4 w-4" /> Into Ready Stock</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take back a return recorded by mistake. */
export async function cancelReturnFlow(order: Order, ret: OrderReturn, by: { id: string }) {
  const why = cancelReturnBlocker(loadDb(), order.id, ret.id);
  if (why) { toast.error(why); return; }
  const lines = [
    `Cancel ${ret.creditNoteNo} for ${order.orderNumber}?`,
    `The ${ret.qty} piece${ret.qty !== 1 ? "s" : ""} count as the client's again and ${fmtMoney(ret.creditUsd)} goes back on their bill.`,
  ];
  if (ret.status === "received") lines.push("The piece comes out of Ready Stock.");
  if (ret.toCreditUsd) lines.push(`${fmtMoney(ret.toCreditUsd)} moves from their credit back onto this order.`);
  if (!(await confirmBox(lines, { title: "Cancel return", confirmText: "Cancel return", cancelText: "Keep it", danger: true }))) return;
  let ok = false;
  updateDbAs({ summary: `Cancelled return ${ret.creditNoteNo} — ${order.orderNumber}` }, d => { ok = cancelReturn(d, order.id, ret.id, { by: by.id, at: new Date().toISOString() }); });
  if (ok) toast.success(`${ret.creditNoteNo} cancelled — ${order.orderNumber} is as it was`);
  else toast.error("Could not cancel — it changed meanwhile");
}

/** The returns on one order, with what can be done about each. */
export function OrderReturns({ order }: { order: Order }) {
  const { user } = useAuth();
  const may = useMayReturn();
  const [receiving, setReceiving] = useState<OrderReturn | null>(null);
  const rets = order.returns ?? [];
  if (!rets.length) return null;
  return (
    <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm space-y-2">
      <p className="font-semibold text-amber-800 flex items-center gap-1.5"><Undo2 className="h-4 w-4" /> Returned by the client — {rets.reduce((s, r) => s + r.qty, 0)} of {order.quantity || 1} pc{(order.quantity || 1) !== 1 ? "s" : ""}</p>
      {rets.map(r => (
        <div key={r.id} className="rounded-lg bg-card ring-1 ring-border/60 p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs"><span className="font-semibold text-brand-dark">{r.creditNoteNo}</span> · {fmtDate(r.at)} · {r.qty} pc{r.qty !== 1 ? "s" : ""} · <span className="font-semibold">−{fmtMoney(r.creditUsd)}</span>{r.reason ? ` · ${r.reason}` : ""}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {r.status === "coming" ? <span className="text-amber-700">On its way back to {r.location === "US" || !r.location ? "the US office" : r.location}</span> : <>In Ready Stock ({r.location ?? "US"}) since {fmtDate(r.receivedAt ?? r.at)}</>}
              {r.toCreditUsd ? ` · ${fmtMoney(r.toCreditUsd)} paid moved to credit` : ""}
              {r.feeUsd ? ` · return charge ${fmtMoney(r.feeUsd)}` : ""}
              {r.cashbackBackUsd ? ` · cashback ${fmtMoney(r.cashbackBackUsd)} taken back` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <IfExport module="invoices"><Button size="sm" variant="outline" className="rounded-lg h-8 gap-1" onClick={() => printNote(r.noteId)}><Printer className="h-3.5 w-3.5" /> Credit note</Button></IfExport>
            {may && r.status === "coming" && <Button size="sm" className="rounded-lg h-8 gap-1 btn-hero" onClick={() => setReceiving(r)}><PackageCheck className="h-3.5 w-3.5" /> Mark received</Button>}
            {may && <Button size="sm" variant="ghost" className="rounded-lg h-8 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => user && cancelReturnFlow(order, r, user)}><XCircle className="h-3.5 w-3.5" /> Cancel return</Button>}
          </div>
        </div>
      ))}
      {receiving && <ReceiveReturnDialog order={order} ret={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

/** Pieces clients are sending back — for whoever opens the parcels (Ready Stock page). */
export function ReturnsComingPanel() {
  const db = useDb();
  const may = useMayReturn();
  const [receiving, setReceiving] = useState<{ order: Order; ret: OrderReturn } | null>(null);
  const coming = returnsComing(db);
  if (!coming.length) return null;
  return (
    <div className="card-luxe p-4 border border-amber-500/30">
      <p className="font-semibold text-brand-dark flex items-center gap-1.5"><Truck className="h-4 w-4 text-amber-700" /> Coming back from clients — {coming.reduce((s, c) => s + c.ret.qty, 0)} pc{coming.reduce((s, c) => s + c.ret.qty, 0) !== 1 ? "s" : ""}</p>
      <p className="text-xs text-muted-foreground mt-0.5">Mark each one received when the parcel arrives — it then joins Ready Stock below.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {coming.map(({ order, ret }) => {
          const img = thumb(order);
          return (
            <div key={ret.id} className="rounded-xl border border-border/60 p-2.5 flex items-center gap-3">
              <div className="h-11 w-11 rounded-lg bg-secondary/60 overflow-hidden shrink-0 grid place-items-center">
                {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <PackageCheck className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <Link to={`/orders/${order.id}`} className="text-sm font-semibold text-primary hover:underline">{order.orderNumber}</Link>
                <p className="text-[11px] text-muted-foreground truncate">{describe(order)} · {ret.qty} pc{ret.qty !== 1 ? "s" : ""} · {db.clients.find(c => c.id === order.clientId)?.companyName ?? ""} · {ret.creditNoteNo} · to {ret.location === "US" || !ret.location ? "US office" : ret.location}</p>
              </div>
              {may && <Button size="sm" className="rounded-lg h-8 gap-1 btn-hero shrink-0" onClick={() => setReceiving({ order, ret })}><PackageCheck className="h-3.5 w-3.5" /> Received</Button>}
            </div>
          );
        })}
      </div>
      {receiving && <ReceiveReturnDialog order={receiving.order} ret={receiving.ret} onClose={() => setReceiving(null)} />}
    </div>
  );
}
