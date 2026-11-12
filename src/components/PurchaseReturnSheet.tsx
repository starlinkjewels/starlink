// Return goods to a supplier on a debit note — the side panel, and the note's PDF.
// The books: lib/purchaseReturns.ts.
import { useEffect, useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { todayLocal, stampFor, fmtDate, type DB, type SupplierSale } from "@/lib/db";
import { fmtMoneyInr, lockerBalance } from "@/lib/manufacturing";
import { fmtCcy } from "@/lib/currency";
import { brandFor } from "@/lib/companies";
import { downloadLedgerPdf } from "@/lib/ledgerExport";
import { returnableLines, returnProblem, recordPurchaseReturn } from "@/lib/purchaseReturns";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Segmented, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openMin } from "@/lib/openMin";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const q3 = (n: number) => Math.round(n * 1000) / 1000;

/** The debit note as a PDF: what went back, against which bills, for how much. */
export function printDebitNote(db: DB, sale: SupplierSale): void {
  if (!sale.returnOf) return;
  const supplier = db.suppliers.find(s => s.id === sale.supplierId);
  const brand = brandFor(db.settings, sale.companyId || "main");
  const bills = sale.returnOf.purchaseIds.map(id => (db.purchases ?? []).find(p => p.id === id)).filter(Boolean);
  downloadLedgerPdf({
    title: `DEBIT NOTE ${sale.returnOf.noteNo}`,
    subjectLines: [
      `To: ${supplier?.name ?? "Supplier"}`,
      `Date: ${fmtDate(sale.createdAt)}`,
      `Against bill${bills.length === 1 ? "" : "s"}: ${bills.map(p => `${p!.invoiceNumber || "(no bill no.)"} of ${fmtDate(p!.invoiceDate || p!.createdAt)}`).join(", ") || "—"}`,
      ...(sale.returnOf.reason ? [`Reason: ${sale.returnOf.reason}`] : []),
      "The goods below are returned to you; their value is debited to your account.",
    ],
    summary: [{ label: "Lines", value: String(sale.lines.length) }, { label: "Debited", value: fmtMoneyInr(sale.totalInr) }],
    columns: [{ header: "#", x: 14 }, { header: "Goods returned", x: 24 }, { header: "Quantity", x: 126 }, { header: "Rate", x: 150 }, { header: "Amount", x: 174 }],
    rows: sale.lines.map((l, i) => [String(i + 1), l.label, `${q3(l.qty)} ${l.unit}${l.pieces ? ` · ${l.pieces} pcs` : ""}`, l.rateInr ? fmtMoneyInr(l.rateInr) : "", fmtMoneyInr(l.amountInr)]),
    totalsRow: ["", "Total", "", "", fmtMoneyInr(sale.totalInr)],
    filename: `Debit-note-${sale.returnOf.noteNo}`,
    company: brand.companyName,
  });
}

/** Return goods to a supplier — from their page; `purchaseId` opens on one bill line. */
export function PurchaseReturnSheet({ supplierId, purchaseId, onClose }: { supplierId: string; purchaseId?: string; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const supplier = db.suppliers.find(s => s.id === supplierId);
  const lines = useMemo(() => returnableLines(db, supplierId), [db, supplierId]);
  const can = lines.filter(l => l.canReturn > 1e-6);
  const [on, setOn] = useState<Record<string, boolean>>(() => (purchaseId ? { [purchaseId]: true } : {}));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState("");
  const [money, setMoney] = useState<"account" | "refund">("account");
  const [lockerId, setLockerId] = useState("");
  const [refund, setRefund] = useState("");
  useEffect(() => {
    // Each line starts on all that can go back.
    setQty(q => { const n = { ...q }; for (const l of can) if (n[l.purchase.id] == null) n[l.purchase.id] = String(q3(l.canReturn)); return n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can.length]);
  const lockers = db.lockers.filter(l => l.active !== false && (l.currency || "INR") === "INR");
  const picked = can.filter(l => on[l.purchase.id]);
  const qOf = (id: string, l = can.find(x => x.purchase.id === id)!) => (l.kind === "certified" ? l.canReturn : num(qty[id] ?? ""));
  const valueOf = (id: string) => {
    const l = can.find(x => x.purchase.id === id)!;
    return amt[id]?.trim() ? r2(num(amt[id])) : r2(l.unitInr * qOf(id, l));
  };
  const total = r2(picked.reduce((t, l) => t + valueOf(l.purchase.id), 0));

  const save = async () => {
    const input = {
      supplierId, at: stampFor(date), reason,
      picks: picked.map(l => ({ purchaseId: l.purchase.id, qty: qOf(l.purchase.id, l), amountInr: valueOf(l.purchase.id) })),
      ...(money === "refund" ? { refund: { amountInr: refund.trim() ? num(refund) : total, lockerId } } : {}),
    };
    const problem = returnProblem(db, input);
    if (problem) { toast.error(problem); return; }
    try {
      const sale = await recordPurchaseReturn(db, input, user!);
      toast.success(`Debit note ${sale.returnOf!.noteNo} — ${fmtMoneyInr(sale.totalInr)} back to ${supplier?.name ?? "the supplier"}`);
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "The return wasn't recorded"); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={Undo2} title={`Return goods to ${supplier?.name ?? "the supplier"}`}
      description="On a debit note against the bill — out of stock, off what we owe them"
      footer={(
        <div className="space-y-3">
          <Stats>
            <Stat big label="Debit note" value={total > 0 ? fmtMoneyInr(total) : "—"} sub={money === "refund" ? "refunded to us now" : "comes off what we owe them"} />
            <Stat label="Lines" value={String(picked.length)} />
          </Stats>
          <PanelActions onCancel={onClose}>
            <AsyncButton onClick={save} disabled={!picked.length} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Return on debit note</AsyncButton>
          </PanelActions>
        </div>
      )}>
      <div className="@container space-y-5">
        <Group title="What goes back">
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">No bills from {supplier?.name ?? "them"} into stock.</p> : (
            <div className="space-y-2">
              {lines.map(l => {
                const id = l.purchase.id, open = l.canReturn > 1e-6;
                return (
                  <div key={id} className={`rounded-xl border p-3 ${on[id] && open ? "border-primary/40 bg-primary/5" : "border-border/70"} ${open ? "" : "opacity-60"}`}>
                    <label className={`flex items-start gap-2.5 ${open ? "cursor-pointer" : ""}`}>
                      <input type="checkbox" disabled={!open} checked={!!on[id] && open} onChange={e => setOn(s => ({ ...s, [id]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[var(--primary)]" aria-label={`Return ${l.label}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground break-words">{l.label}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          Bill {l.purchase.invoiceNumber || "(no no.)"} · {fmtDate(l.purchase.invoiceDate || l.purchase.createdAt)} · {q3(l.bought)} {l.unit} for {fmtMoneyInr(l.purchase.totalInr)}
                          {l.returned > 0 ? ` · ${q3(l.returned)} ${l.unit} returned already` : ""}
                          {open ? ` · can go back: ${q3(l.canReturn)} ${l.unit}` : ` · ${l.why}`}
                        </span>
                      </span>
                    </label>
                    {on[id] && open && (
                      <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                        {l.kind !== "certified" && (
                          <Field label={`Quantity (${l.unit})`}>{fid => <UnitInput id={fid} min={0} step={l.kind === "piece" ? "1" : "0.001"} unit={l.unit} value={qty[id] ?? ""} onChange={e => setQty(s => ({ ...s, [id]: e.target.value }))} aria-label={`Quantity of ${l.label}`} />}</Field>
                        )}
                        <Field label="Value (₹)" hint={amt[id]?.trim() ? undefined : `at the bill's price — ${fmtMoneyInr(l.unitInr)} / ${l.unit}`}>{fid => (
                          <UnitInput id={fid} min={0} unit="₹" value={amt[id] ?? ""} placeholder={String(valueOf(id))} onChange={e => setAmt(s => ({ ...s, [id]: e.target.value }))} aria-label={`Value of ${l.label}`} />
                        )}</Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Group>
        <Group title="Money">
          <div className="space-y-3">
            <Segmented value={money} onChange={setMoney} options={[["account", "Off their account"], ["refund", "Refund received now"]] as const} />
            <p className="text-xs text-muted-foreground">{money === "account"
              ? <>The {total > 0 ? fmtMoneyInr(total) : "value"} comes off what we owe {supplier?.name ?? "them"} — or, if their bills are paid, they owe it to us (it settles their next bill).</>
              : <>They paid it back now, into the account below. Any brokerage on the bill stays as it was.</>}</p>
            {money === "refund" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Into account">{id => (
                  <Select value={lockerId} onValueChange={setLockerId}>
                    <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Into account"><SelectValue placeholder="Choose account" /></SelectTrigger>
                    <SelectContent>{lockers.map(l => <SelectItem key={l.id} value={l.id}>{l.name} · {fmtCcy(lockerBalance(l, db.lockerTransactions), l.currency)}</SelectItem>)}</SelectContent>
                  </Select>
                )}</Field>
                <Field label="Refund (₹)" hint="Less than the note? The rest stays on their account.">{id => <UnitInput id={id} min={0} unit="₹" value={refund} placeholder={total ? String(total) : "0"} onChange={e => setRefund(e.target.value)} aria-label="Refund" />}</Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">{id => <Input id={id} type="date" min={openMin()} value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
              <Field label="Reason">{id => <Input id={id} value={reason} onChange={e => setReason(e.target.value)} className="rounded-xl h-10" placeholder="Optional — e.g. wrong colour" aria-label="Reason" />}</Field>
            </div>
          </div>
        </Group>
      </div>
    </ActionSheet>
  );
}
