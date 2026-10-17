import { useState } from "react";
import { Link } from "react-router-dom";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { useCan } from "@/hooks/useCan";
import { collectionsLoaded, ensureCollections, fmtMoney, fmtDate, loadDb, type AdvancePayment, type ClientReceipt, type DB } from "@/lib/db";
import { ccy, roundCcy } from "@/lib/currency";
import { editReceipt, deleteReceipt, deleteImpact, receiptApplied } from "@/lib/receipts";
import { needsAccess } from "@/lib/actionHints";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { RateInput } from "@/components/CurrencyFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Every way a payment is taken across the app (Payments, the client page), so
// a receipt's own mode is always one of the choices.
const METHODS = ["Cash", "Bank Transfer", "UPI", "Venmo", "Zelle", "Cheque", "Card", "Other"];

/**
 * Receipts are a heavy record, loaded only by the pages that list them. Any
 * other page asks for them before it corrects or cancels one, so the change is
 * worked out against the real receipt book — never an empty one.
 */
export function loadReceipts(): Promise<void> {
  return ensureCollections(["clientReceipts"]);
}

/**
 * Why a payment (the advances of one receipt) can't be corrected or cancelled
 * as a receipt; undefined when it can. Payments are only ever changed through
 * their receipt — the receipt also holds the locker deposit and any credit
 * left over, so changing the advance alone left those behind.
 */
export function paymentLockReason(db: DB, a: Pick<AdvancePayment, "receiptId" | "fromCredit">): string | undefined {
  if (a.fromCredit && !a.receiptId) return "Credit already on their account, moved onto this bill — correct the receipt that brought it in";
  if (!a.receiptId) return "Recorded before receipt numbers — number it first";
  // Only checked once the receipt book is here (reading it earlier would fetch
  // it for every row drawn); otherwise it is checked at the moment of use.
  if (collectionsLoaded(["clientReceipts"]) && !(db.clientReceipts ?? []).some(r => r.id === a.receiptId)) return "Its receipt is no longer on record";
  return undefined;
}

/**
 * Cancel a receipt after showing, line by line, everything it takes back: the
 * money off the orders, any unused credit, the locker deposit. Returns whether
 * it was cancelled.
 */
export async function cancelReceiptFlow(receiptId: string, userId: string): Promise<boolean> {
  await loadReceipts();
  const db = loadDb();
  const rec = (db.clientReceipts ?? []).find(x => x.id === receiptId);
  if (!rec) { toast.error("That receipt is no longer on record"); return false; }
  if (!(await confirmBox(
    `Cancel receipt ${rec.receiptNo}?\n\n${deleteImpact(db, receiptId).join("\n")}\n\nThis cannot be undone.`,
  ))) return false;
  deleteReceipt(receiptId, userId);
  toast.success(`Receipt ${rec.receiptNo} cancelled`);
  return true;
}

type Form = { amount: string; date: string; method: string; remarks: string; lockerId: string; rate: number | "" };

/**
 * Correct a client receipt, in the side panel — the same correction the
 * Payments → Received book makes. The old allocation and deposit come back out
 * and the corrected figures are applied fresh (src/lib/receipts.ts). Opened
 * from wherever a payment is shown: the Passbook, a client's statement, an
 * invoice. Load the receipts (loadReceipts) before opening it.
 */
export function ReceiptEditSheet({ receiptId, onClose }: { receiptId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const can = useCan();
  const db = useDb();
  const [shown, setShown] = useState<string | null>(null);
  const [ef, setEf] = useState<Form>({ amount: "", date: "", method: "Cash", remarks: "", lockerId: "", rate: "" });
  const rec = receiptId ? (db.clientReceipts ?? []).find(x => x.id === receiptId) : undefined;

  // The currency a receipt's deposit is in. Older receipts may not name it;
  // their account does (unset is rupees).
  const depositCcy = (r: ClientReceipt) =>
    ccy(r.lockerCurrency ?? (r.lockerId ? db.lockers.find(l => l.id === r.lockerId)?.currency : undefined));

  // Fill the form from the receipt each time a (different) one is opened —
  // once it is actually here.
  if (receiptId !== shown && (!receiptId || rec)) {
    setShown(receiptId);
    if (rec) {
      // A deposit typed straight in (an order's advance) has no rate on record.
      // Start from the one it actually landed at, so saving a corrected remark
      // leaves the deposit exactly as it was.
      const c = depositCcy(rec);
      const landedAt = rec.lockerId && c !== "USD" && rec.lockerAmount && rec.amountUsd > 0 ? rec.lockerAmount / rec.amountUsd : undefined;
      setEf({
        amount: String(rec.amountUsd), date: rec.date.slice(0, 10), method: rec.method,
        remarks: rec.remarks ?? "", lockerId: rec.lockerId ?? "", rate: rec.exchangeRate || landedAt || "",
      });
    }
  }

  const locker = db.lockers.find(l => l.id === ef.lockerId);
  const lockerCcy = ccy(locker?.currency);
  const client = rec ? db.clients.find(c => c.id === rec.clientId) : undefined;
  const landed = rec ? db.orders.flatMap(o => (o.advances ?? []).filter(a => a.receiptId === rec.id).map(a => ({ o, a }))) : [];
  const asCredit = rec ? Math.round((rec.amountUsd - receiptApplied(db, rec.id)) * 100) / 100 : 0;
  const methods = rec && ef.method && !METHODS.includes(ef.method) ? [ef.method, ...METHODS] : METHODS;
  const mayEdit = can("payments", "edit");
  const mayDelete = can("payments", "delete");

  const save = () => {
    if (!rec || !mayEdit) return;
    const amt = Number(ef.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const rate = Number(ef.rate) || 0;
    if (locker && lockerCcy !== "USD" && rate <= 0) { toast.error("Enter the exchange rate for that account"); return; }
    // Keep the original time of day so the day's entries stay in the same order.
    const date = `${ef.date}T${rec.date.slice(11) || "00:00:00.000Z"}`;
    editReceipt(rec.id, {
      amountUsd: amt, date, method: ef.method, remarks: ef.remarks,
      lockerId: ef.lockerId || undefined,
      // Billed in USD; what lands is that × the account's currency for $1.
      lockerAmount: locker ? (lockerCcy === "USD" ? amt : roundCcy(amt * rate, lockerCcy)) : undefined,
      lockerCurrency: locker ? lockerCcy : undefined,
      exchangeRate: locker && lockerCcy !== "USD" ? rate : undefined,
      userId: user!.id,
    });
    toast.success(`Receipt ${rec.receiptNo} corrected`);
    onClose();
  };

  const cancelIt = async () => {
    if (!rec || !mayDelete) return;
    if (await cancelReceiptFlow(rec.id, user!.id)) onClose();
  };

  return (
    <ActionSheet
      open={!!receiptId && !!rec}
      onOpenChange={o => { if (!o) onClose(); }}
      title={rec ? `Correct receipt ${rec.receiptNo}` : "Correct receipt"}
      description={<>The old allocation and deposit are taken back out and the corrected figures applied fresh, so the client&rsquo;s bills, their credit and the account balance all end up right. The receipt number never changes.</>}
      icon={ReceiptText}
      footer={
        <div className="flex gap-2 flex-wrap items-center">
          <Button variant="outline" onClick={cancelIt} disabled={!mayDelete}
            title={mayDelete ? undefined : needsAccess("payments", "delete")}
            className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
            Cancel receipt
          </Button>
          <Button variant="outline" onClick={onClose} className="rounded-xl ml-auto">Close</Button>
          <Button onClick={save} disabled={!mayEdit} title={mayEdit ? undefined : needsAccess("payments", "edit")} className="btn-hero rounded-xl">Save</Button>
        </div>
      }
    >
      {rec && (
        <div className="space-y-4">
          {/* One receipt can settle several orders — say so, so nobody thinks
              they are changing just the line they clicked. */}
          <div className="rounded-xl bg-secondary/50 p-3 text-xs space-y-1">
            <p><span className="text-muted-foreground">From </span><span className="font-medium text-brand-dark">{client?.companyName ?? "Client"}</span> · {fmtDate(rec.date)} · {fmtMoney(rec.amountUsd)}</p>
            {landed.length > 0 && (
              <p className="text-muted-foreground">
                Applied to{" "}
                {landed.map(({ o, a }, i) => (
                  <span key={a.id}>
                    <Link to={`/orders/${o.id}`} className="text-primary hover:underline font-mono">{o.orderNumber}</Link> {fmtMoney(a.amount)}{i < landed.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
            {asCredit > 0.009 && <p className="text-muted-foreground">{fmtMoney(asCredit)} held as credit</p>}
            {landed.length > 1 && <p className="text-amber-700">This corrects the whole receipt, on every order it settled.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="rcpt-edit-amount">Amount received ($)</Label>
              <Input id="rcpt-edit-amount" type="number" min={0} step="0.01" value={ef.amount} disabled={!mayEdit}
                onChange={e => setEf({ ...ef, amount: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
            <div>
              <Label className="text-xs" htmlFor="rcpt-edit-date">Date</Label>
              <Input id="rcpt-edit-date" type="date" value={ef.date} disabled={!mayEdit}
                onChange={e => setEf({ ...ef, date: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Deposited to account</Label>
            <Select value={ef.lockerId || "none"} disabled={!mayEdit} onValueChange={v => {
              const lockerId = v === "none" ? "" : v;
              const next = db.lockers.find(l => l.id === lockerId);
              // A rate belongs to one currency: an account in another starts afresh
              // (from Settings) rather than carrying ₹83 into an AUD account.
              const same = !!locker && !!next && ccy(next.currency) === lockerCcy;
              setEf(p => ({ ...p, lockerId, rate: same ? p.rate : "" }));
            }}>
              <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Deposited to account"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No account</SelectItem>
                {db.lockers.filter(l => l.active !== false || l.id === ef.lockerId).map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locker && lockerCcy !== "USD" && (
            <RateInput id="receipt-sheet-rate" from="USD" to={lockerCcy} value={ef.rate}
              onChange={rate => setEf(p => ({ ...p, rate }))}
              amount={Number(ef.amount) || undefined} at={ef.date || undefined} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={ef.method} disabled={!mayEdit} onValueChange={v => setEf({ ...ef, method: v })}>
                <SelectTrigger className="h-10 rounded-xl mt-1" aria-label="Mode"><SelectValue /></SelectTrigger>
                <SelectContent>{methods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="rcpt-edit-remarks">Remarks</Label>
              <Input id="rcpt-edit-remarks" value={ef.remarks} disabled={!mayEdit} onChange={e => setEf({ ...ef, remarks: e.target.value })} className="rounded-xl h-10 mt-1" />
            </div>
          </div>
        </div>
      )}
    </ActionSheet>
  );
}
