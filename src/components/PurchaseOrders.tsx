// Suppliers → Purchase orders: what we asked suppliers for, what came, what is late (lib/purchaseOrders.ts).
// Receive opens the Buy form filled in from the PO — that bill is the goods receipt and the supplier's bill.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock, ClipboardList, Eye, FileText, MessageCircle, PackageCheck, Pencil, Plus, RotateCcw, Trash2, XCircle, Ban,
} from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useHas } from "@/hooks/useCan";
import { useAuth } from "@/lib/auth";
import { ensureCollections, fmtDate, stampFor, todayLocal, type PurchaseCurrency, type PurchaseOrder } from "@/lib/db";
import { fmtCcy } from "@/lib/currency";
import {
  PO_STATE_LABEL, cancelPo, closePoShort, createPo, deletePo, downloadPoPdf, lineOpenQty, lineReceived, liveReceipts,
  poDeleteBlocker, poEditBlocker, poOverdueDays, poProblem, poState, poText, poValue, qtyUnit, recordPoReceipt, reopenPo,
  setPoExpected, updatePo, type PoInput, type PoState,
} from "@/lib/purchaseOrders";
import { openWhatsApp, hasWhatsApp } from "@/lib/whatsapp";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented, Stat, Stats } from "@/components/BillLayout";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { DataTable, type DataColumn } from "@/components/DataTable";
import { BuyMaterialForm } from "@/components/BuyMaterialForm";
import { draftOf, memoInBuyLines, newIn, useInLines } from "@/components/MemoInSheets";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TONE: Record<PoState, string> = {
  open: "bg-blue-500/10 text-blue-700", part: "bg-amber-500/10 text-amber-700", received: "bg-success/10 text-success",
  short: "bg-secondary text-muted-foreground", cancelled: "bg-secondary text-muted-foreground line-through",
};
export function PoBadge({ po }: { po: PurchaseOrder }) {
  const db = useDb();
  const st = poState(db, po);
  const late = poOverdueDays(db, po);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${TONE[st]}`}>{PO_STATE_LABEL[st]}</span>
      {late > 0 && <span className="text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap bg-destructive/10 text-destructive">{late} day{late === 1 ? "" : "s"} late</span>}
    </span>
  );
}

/** New purchase order, or one changed while nothing has come. */
export function PoSheet({ open, onOpenChange, po, supplierId: fixedSupplier }: {
  open: boolean; onOpenChange: (v: boolean) => void; po?: PurchaseOrder; supplierId?: string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const multiCo = useMultiCo();
  const defaultCo = useDefaultCompany();
  const [supplierId, setSupplierId] = useState("");
  const [companyId, setCompanyId] = useState(defaultCo);
  const [date, setDate] = useState(todayLocal());
  const [expected, setExpected] = useState("");
  const [currency, setCurrency] = useState<PurchaseCurrency>("INR");
  const [notes, setNotes] = useState("");
  const goods = useInLines(currency, "What we are ordering");
  useEffect(() => {
    if (!open) return;
    setSupplierId(po?.supplierId ?? fixedSupplier ?? "");
    setCompanyId(po?.companyId ?? defaultCo);
    setDate(po ? po.at.slice(0, 10) : todayLocal());
    setExpected(po?.expectedAt ? po.expectedAt.slice(0, 10) : "");
    setCurrency(po?.currency ?? "INR");
    setNotes(po?.notes ?? "");
    goods.setLines(po ? po.lines.map(draftOf) : [newIn("diamond")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id, fixedSupplier]);
  const suppliers = db.suppliers.filter(s => s.active !== false || s.id === supplierId).sort((a, b) => a.name.localeCompare(b.name));

  const save = async () => {
    if (goods.built.some(l => !l)) { toast.error("Finish every line — or remove the empty one"); return; }
    const input: PoInput = {
      supplierId, companyId: companyId === "main" ? undefined : companyId, at: stampFor(date),
      ...(expected ? { expectedAt: stampFor(expected) } : {}), currency,
      lines: goods.built.map(l => ({ ...l!, amount: l!.amount })) as PoInput["lines"], notes,
    };
    const why = poProblem(db, input);
    if (why) { toast.error(why); return; }
    try {
      if (po) { updatePo(po.id, input); toast.success(`${po.no} saved`); onOpenChange(false); return; }
      const made = await createPo(db, input, user!);
      const s = db.suppliers.find(x => x.id === made.supplierId);
      toast.success(`Purchase order ${made.no} — ${s?.name ?? "supplier"}`, {
        action: { label: "Send on WhatsApp", onClick: () => openWhatsApp(s?.phone, poText({ ...db, purchases: db.purchases ?? [] }, made)) },
      });
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "It wasn't saved"); }
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} size="lg" icon={ClipboardList} title={po ? `Purchase order ${po.no}` : "New purchase order"}
      description="What we are asking the supplier for. Nothing moves in stock or money until the goods come — Receive then records the bill."
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat big label="Order value" value={goods.total > 0 ? fmtCcy(goods.total, currency) : "—"} sub="at the rates expected — the bill says what it really costs" />
            <Stat label="Lines" value={String(goods.built.filter(Boolean).length)} />
          </Stats>
          <PanelActions onCancel={() => onOpenChange(false)}>
            <AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">{po ? "Save" : "Make purchase order"}</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier" className="col-span-2 @md:col-span-1">{id => (
              <Select value={supplierId} onValueChange={setSupplierId} disabled={!!fixedSupplier}>
                <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Supplier"><SelectValue placeholder={suppliers.length ? "Choose" : "None yet"} /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            )}</Field>
            <Field label="Prices in" className="col-span-2 @md:col-span-1">{id => (
              <Select value={currency} onValueChange={v => setCurrency(v as PurchaseCurrency)}>
                <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Prices in"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INR">Rupees (₹)</SelectItem><SelectItem value="USD">Dollars ($)</SelectItem></SelectContent>
              </Select>
            )}</Field>
            <Field label="Order date">{id => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
            <Field label="Expected by" hint="Optional — late ones are flagged">{id => <Input id={id} type="date" min={date} value={expected} onChange={e => setExpected(e.target.value)} className="rounded-xl h-10" aria-label="Expected by" />}</Field>
            {multiCo && <div className="col-span-2"><CompanyPicker value={companyId} onChange={setCompanyId} label="Company — whose stock it comes into" /></div>}
          </div>
        </Group>
        {goods.editor}
        <Field label="Note to the supplier">{id => <Input id={id} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-xl h-10" placeholder="Optional — e.g. send with the lab reports" />}</Field>
      </div>
    </ActionSheet>
  );
}

/** The goods came: pick what (all that is still to come, to start), then the Buy form fills the bill in. */
function PoReceiveSheet({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const open = po.lines.filter(l => lineOpenQty(db, po, l) > 1e-6);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(open.map(l => [l.id, true])));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map(l => [l.id, String(lineOpenQty(db, po, l))])));
  const [buying, setBuying] = useState<{ lineId: string; qty: number }[] | null>(null);

  const go = () => {
    const picks = open.filter(l => on[l.id]).map(l => ({ lineId: l.id, qty: l.kind === "certified" ? l.qty : Number(qty[l.id] ?? "") || 0 }));
    if (!picks.length) { toast.error("Tick what came"); return; }
    for (const p of picks) {
      const l = po.lines.find(x => x.id === p.lineId)!;
      if (!(p.qty > 0)) { toast.error(`Enter how much came — ${l.label}`); return; }
    }
    setBuying(picks);
  };

  if (buying) {
    return (
      <BuyMaterialForm open onOpenChange={v => { if (!v) onClose(); }} supplierId={po.supplierId}
        memoIn={{
          // The PO's lines fill the bill (memo-in's own filling); the bill can still be changed before it is saved.
          lines: memoInBuyLines(po, buying), currency: po.currency, notes: `PO ${po.no}`,
          onSaved: (ids, qtys) => {
            try {
              const final = qtys.length === buying.length ? buying.map((p, i) => ({ ...p, qty: qtys[i] > 0 ? qtys[i] : p.qty })) : buying;
              recordPoReceipt(po.id, final, ids, user!);
            } catch (e) {
              toast.error(`The bill is saved, but ${po.no} could not be marked${e instanceof Error ? ` (${e.message})` : ""}`);
            }
          },
        }} />
    );
  }
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={PackageCheck} title={`Receive — ${po.no}`}
      description="Tick what came and how much. The purchase bill opens next, filled in — check the rates and the bill number, then save."
      footer={<PanelActions onCancel={onClose}><Button onClick={go} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Next — the bill</Button></PanelActions>}>
      <div className="space-y-2">
        {open.length === 0 && <p className="text-sm text-muted-foreground">Everything on it has come.</p>}
        {open.map(l => {
          const left = lineOpenQty(db, po, l), got = lineReceived(db, po, l.id);
          return (
            <label key={l.id} className="flex items-start gap-3 rounded-xl border border-border/70 p-3 cursor-pointer">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={!!on[l.id]} onChange={e => setOn({ ...on, [l.id]: e.target.checked })} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{l.label}</span>
                <span className="block text-xs text-muted-foreground">Ordered {qtyUnit(l.qty, l.unit)}{got > 0 ? ` · came ${qtyUnit(got, l.unit)}` : ""} · {qtyUnit(left, l.unit)} to come</span>
              </span>
              {l.kind !== "certified" && (
                <Input type="number" inputMode="decimal" min={0} step="0.001" value={qty[l.id] ?? ""} onChange={e => setQty({ ...qty, [l.id]: e.target.value })}
                  className="rounded-xl h-9 w-24 shrink-0" aria-label={`How much came — ${l.label}`} />
              )}
            </label>
          );
        })}
        <p className="text-[11px] text-muted-foreground">More than ordered is fine — the bill is what counts. Less, and the rest stays on the order until it comes or you close it short.</p>
      </div>
    </ActionSheet>
  );
}

/** Suppliers → Purchase orders (or one supplier's). */
export function PurchaseOrdersPanel({ supplierId, newFor, onNewDone }: { supplierId?: string; newFor?: boolean; onNewDone?: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const has = useHas();
  const may = has("suppliers.purchase");
  const [ready, setReady] = useState(false);
  useEffect(() => { ensureCollections(["purchaseOrders", "purchases"]).then(() => setReady(true)).catch(() => setReady(true)); }, []);
  const [show, setShow] = useState<"awaited" | "all">("awaited");
  const [making, setMaking] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [dueEdit, setDueEdit] = useState<{ id: string; day: string } | null>(null);
  const [closing, setClosing] = useState<{ id: string; mode: "short" | "cancel"; note: string } | null>(null);
  useEffect(() => { if (newFor) setMaking(true); }, [newFor]);

  const all = useMemo(() => (db.purchaseOrders ?? []).filter(p => !supplierId || p.supplierId === supplierId), [db.purchaseOrders, supplierId]);
  const rows = show === "awaited" ? all.filter(p => { const s = poState(db, p); return s === "open" || s === "part"; }) : all;
  const supplierName = (id: string) => db.suppliers.find(s => s.id === id)?.name ?? "—";
  const find = (id: string | null) => (id ? all.find(p => p.id === id) ?? (db.purchaseOrders ?? []).find(p => p.id === id) : undefined);
  const send = (po: PurchaseOrder) => {
    const s = db.suppliers.find(x => x.id === po.supplierId);
    openWhatsApp(s?.phone, poText({ ...db, purchases: db.purchases ?? [] }, po));
  };

  const actions = (po: PurchaseOrder): MoreAction[] => {
    const st = poState(db, po);
    const awaited = st === "open" || st === "part";
    const editWhy = poEditBlocker(db, po);
    const delWhy = poDeleteBlocker(db, po);
    const phone = db.suppliers.find(s => s.id === po.supplierId)?.phone;
    const noAccess = "Your access does not include purchases";
    return [
      { label: "View", icon: Eye, onSelect: () => setViewId(po.id) },
      { label: "Receive", icon: PackageCheck, show: awaited, disabled: !may, hint: may ? "The goods came — the bill opens filled in" : noAccess, onSelect: () => setReceiveId(po.id) },
      { label: "Send on WhatsApp", icon: MessageCircle, hint: hasWhatsApp(phone) ? "The order to the supplier — to confirm" : "No phone for the supplier — WhatsApp asks which chat", onSelect: () => send(po) },
      { label: "Purchase order — PDF", icon: FileText, onSelect: () => downloadPoPdf({ ...db, purchases: db.purchases ?? [] }, po) },
      { label: "Edit", icon: Pencil, disabled: !may || !!editWhy, hint: !may ? noAccess : editWhy ?? "Supplier, lines, rates, dates", onSelect: () => setEditId(po.id) },
      { label: "Change expected day", icon: CalendarClock, show: awaited, disabled: !may, hint: may ? (po.expectedAt ? `Now ${fmtDate(po.expectedAt)}` : "None set") : noAccess, onSelect: () => setDueEdit({ id: po.id, day: po.expectedAt?.slice(0, 10) ?? "" }) },
      { label: "Close short", icon: XCircle, show: st === "part", disabled: !may, hint: may ? "The rest won't come — keeps what came" : noAccess, onSelect: () => setClosing({ id: po.id, mode: "short", note: "" }) },
      { label: "Cancel order", icon: Ban, danger: true, show: st === "open", disabled: !may, hint: may ? "Nothing came — kept on the list as cancelled" : noAccess, onSelect: () => setClosing({ id: po.id, mode: "cancel", note: "" }) },
      { label: "Re-open", icon: RotateCcw, show: st === "short" || st === "cancelled", disabled: !may, hint: may ? "The supplier will send after all" : noAccess, onSelect: () => { try { reopenPo(po.id); toast.success(`${po.no} is open again`); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't re-open it"); } } },
      { label: "Delete", icon: Trash2, danger: true, disabled: !may || !!delWhy, hint: !may ? noAccess : delWhy ?? "Taken off the list for good",
        onSelect: async () => {
          if (!(await confirmBox(`Delete purchase order ${po.no}?\n\nIt is taken off the list for good. Nothing came against it, so no stock or money changes.`))) return;
          try { deletePo(po.id); toast.success(`${po.no} deleted`); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete it"); }
        } },
    ];
  };

  const columns: DataColumn<PurchaseOrder>[] = [
    { key: "no", header: "PO", always: true, sortValue: p => p.no, cell: p => <span className="font-semibold text-brand-dark whitespace-nowrap">{p.no}</span> },
    { key: "supplier", header: "Supplier", hidden: !!supplierId, sortValue: p => supplierName(p.supplierId), cell: p => <span className="whitespace-nowrap">{supplierName(p.supplierId)}</span> },
    { key: "goods", header: "Goods", sortValue: p => p.lines.map(l => l.label).join(", "), cell: p => <span className="line-clamp-2 min-w-[12rem]">{p.lines.map(l => `${l.label} ${qtyUnit(l.qty, l.unit)}`).join(" · ")}</span> },
    { key: "status", header: "Status", sortValue: p => PO_STATE_LABEL[poState(db, p)], cell: p => <PoBadge po={p} /> },
    { key: "value", header: "Value", align: "right", kind: "number", sortValue: p => poValue(p), cell: p => <span className="tabular-nums whitespace-nowrap">{poValue(p) > 0 ? fmtCcy(poValue(p), p.currency) : "—"}</span> },
    { key: "expected", header: "Expected", kind: "date", sortValue: p => p.expectedAt ?? "", cell: p => <span className="whitespace-nowrap">{p.expectedAt ? fmtDate(p.expectedAt) : "—"}</span> },
    { key: "at", header: "Ordered", kind: "date", sortValue: p => p.at, cell: p => <span className="whitespace-nowrap">{fmtDate(p.at)}</span> },
  ];

  const view = find(viewId), edit = find(editId), receive = find(receiveId);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={show} onChange={setShow} options={[["awaited", "Awaited"], ["all", "All"]] as const} className="w-48 shrink-0" />
        <p className="text-xs text-muted-foreground flex-1 min-w-[12rem]">What we asked suppliers for. Receive records the bill — the stock and the supplier's account move then, not before.</p>
        {may && <Button onClick={() => setMaking(true)} className="btn-hero rounded-xl h-10 gap-1.5"><Plus className="h-4 w-4" /> New purchase order</Button>}
      </div>
      <DataTable id={supplierId ? "supplier-pos" : "purchase-orders"} noun="purchase order" rows={rows} columns={columns} rowKey={p => p.id}
        loading={!ready} defaultSort={{ key: "at", dir: "desc" }} onRowClick={p => setViewId(p.id)} rowActions={actions} details={false}
        resetKey={show} searchText={p => `${p.no} ${supplierName(p.supplierId)} ${p.lines.map(l => l.label).join(" ")} ${p.notes ?? ""}`}
        searchPlaceholder="Search PO, supplier or goods"
        emptyText={show === "awaited" ? "Nothing awaited from suppliers." : "No purchase orders yet."} exportName="Purchase-orders" />

      {(making || edit) && <PoSheet open onOpenChange={v => { if (!v) { setMaking(false); setEditId(null); onNewDone?.(); } }} po={edit} supplierId={supplierId} />}
      {receive && <PoReceiveSheet po={receive} onClose={() => setReceiveId(null)} />}
      {dueEdit && (() => {
        const po = find(dueEdit.id);
        if (!po) return null;
        return (
          <ActionSheet open onOpenChange={o => { if (!o) setDueEdit(null); }} size="md" icon={CalendarClock} title={`Expected day — ${po.no}`}
            description={`${supplierName(po.supplierId)} · ordered ${fmtDate(po.at)}`}
            footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDueEdit(null)} className="rounded-xl">Cancel</Button>
              <Button className="btn-hero rounded-xl px-6" onClick={() => { try { setPoExpected(po.id, dueEdit.day ? stampFor(dueEdit.day) : undefined, user!); toast.success("Expected day changed"); setDueEdit(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); } }}>Save</Button></div>}>
            <div className="space-y-2">
              <Input type="date" min={po.at.slice(0, 10)} value={dueEdit.day} onChange={e => setDueEdit({ ...dueEdit, day: e.target.value })} className="rounded-xl h-10" aria-label="Expected by" />
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setDueEdit({ ...dueEdit, day: "" })}>No expected day</button>
              <p className="text-[11px] text-muted-foreground">Kept in its history. Past the new day, the team is alerted again.</p>
            </div>
          </ActionSheet>
        );
      })()}
      {closing && (() => {
        const po = find(closing.id);
        if (!po) return null;
        const short = closing.mode === "short";
        return (
          <ActionSheet open onOpenChange={o => { if (!o) setClosing(null); }} size="md" icon={short ? XCircle : Ban} title={`${short ? "Close short" : "Cancel"} — ${po.no}`}
            description={short ? "What came stays as it is; the rest is no longer awaited." : "Nothing came against it. It stays on the list as cancelled."}
            footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setClosing(null)} className="rounded-xl">Back</Button>
              <Button className={short ? "btn-hero rounded-xl px-6" : "rounded-xl px-6 bg-destructive text-white hover:bg-destructive/90"} onClick={() => {
                try { (short ? closePoShort : cancelPo)(po.id, closing.note, user!); toast.success(short ? `${po.no} closed short` : `${po.no} cancelled`); setClosing(null); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
              }}>{short ? "Close short" : "Cancel order"}</Button></div>}>
            <div className="space-y-1.5">
              <Input value={closing.note} onChange={e => setClosing({ ...closing, note: e.target.value })} className="rounded-xl h-10" placeholder={short ? "Why — e.g. the supplier is out of the size" : "Why — optional"} aria-label="Why" />
            </div>
          </ActionSheet>
        );
      })()}
      {view && (
        <ActionSheet open onOpenChange={o => { if (!o) setViewId(null); }} size="lg" icon={ClipboardList} title={`Purchase order ${view.no}`}
          description={`${supplierName(view.supplierId)} · ordered ${fmtDate(view.at)}${view.expectedAt ? ` · expected ${fmtDate(view.expectedAt)}` : ""}`}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => send(view)} className="rounded-xl h-10 gap-1.5"><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
              {may && (poState(db, view) === "open" || poState(db, view) === "part") && <Button onClick={() => { setReceiveId(view.id); setViewId(null); }} className="btn-hero rounded-xl h-10 gap-1.5"><PackageCheck className="h-4 w-4" /> Receive</Button>}
              <MoreMenu title={view.no} actions={actions(view).filter(a => a.label !== "View" && a.label !== "Receive" && a.label !== "Send on WhatsApp")} />
            </div>
          )}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><PoBadge po={view} />{view.closedNote && <span className="text-xs text-muted-foreground">— {view.closedNote}</span>}</div>
            <div className="rounded-xl border border-border/70 divide-y divide-border/60">
              {view.lines.map(l => {
                const got = lineReceived(db, view, l.id), left = lineOpenQty(db, view, l);
                return (
                  <div key={l.id} className="px-3 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                    <span className="font-medium flex-1 min-w-[10rem]">{l.label}</span>
                    <span className="tabular-nums text-muted-foreground">Ordered {qtyUnit(l.qty, l.unit)}{l.rate ? ` @ ${fmtCcy(l.rate, view.currency)}` : ""}</span>
                    <span className={`tabular-nums ${got >= l.qty - 1e-6 ? "text-success" : got > 0 ? "text-amber-700" : "text-muted-foreground"}`}>came {qtyUnit(got, l.unit)}</span>
                    {left > 0 && <span className="tabular-nums text-blue-700">{qtyUnit(left, l.unit)} to come</span>}
                    {poState(db, view) === "short" && got < l.qty - 1e-6 && <span className="tabular-nums text-muted-foreground">short {qtyUnit(l.qty - got, l.unit)}</span>}
                  </div>
                );
              })}
            </div>
            {liveReceipts(db, view).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Received</p>
                <ul className="text-sm space-y-1">
                  {liveReceipts(db, view).map(r => {
                    const l = view.lines.find(x => x.id === r.lineId);
                    const bill = r.purchaseId ? (db.purchases ?? []).find(p => p.id === r.purchaseId) : undefined;
                    return <li key={r.id} className="tabular-nums">{fmtDate(r.at)} · {l?.label ?? "—"} · {qtyUnit(r.qty, l?.unit ?? "")}{bill?.invoiceNumber ? ` · bill ${bill.invoiceNumber}` : ""}</li>;
                  })}
                </ul>
              </div>
            )}
            {view.notes && <p className="text-sm text-muted-foreground">Note: {view.notes}</p>}
          </div>
        </ActionSheet>
      )}
    </div>
  );
}
