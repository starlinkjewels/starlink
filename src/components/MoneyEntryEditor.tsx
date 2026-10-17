import { useState } from "react";
import { Lock, Pencil, PencilLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { dayOf, type DB } from "@/lib/db";
import { ccy, ccySymbol, fmtCcy, rateOf } from "@/lib/currency";
import { deleteEntry, editEntry, entryDeleteQuestion, moveToDay, transferLegs, type MoneyEntry } from "@/lib/moneyEntries";
import { confirmBox } from "@/lib/confirm";
import type { MoreAction } from "@/components/MoreMenu";
import { CHECKING } from "@/lib/actionHints";
import { ActionSheet } from "@/components/ActionSheet";
import { RateInput } from "@/components/CurrencyFields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Correcting or cancelling one money entry — the same panel and the same
 * menu wherever an entry is listed: Payments' ledgers, the day book and the
 * Locker page. Both sides move together (see src/lib/moneyEntries.ts); what a
 * cancel changes is spelled out before it is confirmed; and a row that is
 * corrected somewhere else says where, greyed, rather than vanishing.
 */

/** The ⋯ items for one entry. `e` undefined: what it belongs to is still
 *  loading, so nothing is offered yet — greyed "Checking…" until it is here. */
export function entryRowActions(e: MoneyEntry | undefined, o: {
  mayEdit: boolean; mayDelete: boolean;
  /** Why not, when the person's access doesn't reach it. */
  editNeeds: string; deleteNeeds: string;
  onEdit: (e: MoneyEntry) => void;
  onDelete: (e: MoneyEntry) => void;
}): MoreAction[] {
  if (!e) return [
    { label: "Edit", icon: Pencil, disabled: true, hint: CHECKING, onSelect: () => {} },
    { label: "Delete", icon: Trash2, danger: true, disabled: true, hint: CHECKING, onSelect: () => {} },
  ];
  // Owned by another tab: say where it is corrected instead.
  if (e.locked) {
    return [{ label: e.lockedLabel ?? (e.lockedWhere ? `Edit in ${e.lockedWhere}` : "Locked"), hint: e.locked, icon: Lock, disabled: true, onSelect: () => {} }];
  }
  const alone = e.orphan ? "Changes the account only" : e.noTxn ? "Changes their books only — no account movement found" : undefined;
  return [
    { label: "Edit", icon: Pencil, onSelect: () => o.onEdit(e), disabled: !o.mayEdit, hint: o.mayEdit ? alone : o.editNeeds },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => o.onDelete(e), disabled: !o.mayDelete, hint: o.mayDelete ? alone : o.deleteNeeds },
  ];
}

/** Ask, with what it changes, then cancel the entry. True once it is gone. */
export async function confirmDeleteEntry(db: DB, e: MoneyEntry): Promise<boolean> {
  if (e.locked) { toast.error(e.locked); return false; }
  const lockerName = db.lockers.find(l => l.id === e.lockerId)?.name;
  // An account row merely not linked to its payment says so, and is deleted
  // only once that has been read and confirmed.
  if (!(await confirmBox(entryDeleteQuestion(e, lockerName)))) return false;
  const refused = deleteEntry(e, { unlinkedConfirmed: true });
  if (refused) { toast.error(refused); return false; }
  toast.success("Entry cancelled");
  return true;
}

/** The correction panel. Opens for `entry`; closed while it is null. */
export function MoneyEntryEditor({ entry, onClose, mayDelete }: {
  entry: MoneyEntry | null;
  onClose: () => void;
  /** Offer "Cancel entry" in the panel too. */
  mayDelete: boolean;
}) {
  if (!entry) return null;
  // Keyed, so each entry opens with its own figures.
  return <EntrySheet key={entry.id} entry={entry} onClose={onClose} mayDelete={mayDelete} />;
}

function EntrySheet({ entry, onClose, mayDelete }: { entry: MoneyEntry; onClose: () => void; mayDelete: boolean }) {
  const { user } = useAuth();
  const db = useDb();
  const lockerCcy = (id?: string) => ccy(db.lockers.find(l => l.id === id)?.currency);
  /** The rate a transfer was recorded at, as 1 from = ? to, for this pair of accounts. */
  const recordedRate = (fromId: string, toId: string): string => {
    const legs = transferLegs(db, entry.id);
    const f = lockerCcy(fromId), t = lockerCcy(toId);
    const r = legs && f !== t ? rateOf(legs.out, f, t) ?? rateOf(legs.inn, f, t) : undefined;
    return r ? String(r) : "";
  };

  const [ef, setEf] = useState(() => {
    // A transfer opens with both sides, so the destination can be corrected —
    // sending money to the wrong account is the single most common slip. It
    // opens the money's way round (from the account it left, for the amount
    // that left it) whichever of its two rows was clicked; one whose other
    // row is gone opens as itself, as before.
    const legs = entry.transfer ? transferLegs(db, entry.id) : undefined;
    const row = entry.transfer && !legs ? db.lockerTransactions.find(t => t.id === entry.id) : undefined;
    const fromId = legs ? legs.out.lockerId : entry.lockerId ?? "";
    const toId = legs ? legs.inn.lockerId : row?.pairedLockerId ?? "";
    const orphanRate = row && rateOf(row, lockerCcy(fromId), lockerCcy(toId));
    return {
      amount: String(legs ? legs.out.amountInr : entry.amount), date: dayOf(entry.date), note: entry.note ?? "",
      lockerId: fromId,
      toLockerId: toId,
      rate: legs ? recordedRate(fromId, toId) : orphanRate && orphanRate !== 1 ? String(orphanRate) : "",
    };
  });

  /** A transfer's account changed: a rate for another pair of currencies means
   *  nothing for this one, so it starts again from what the transfer was
   *  recorded at between these two, else the rate field offers Settings' rate. */
  const pickTransferSide = (side: "lockerId" | "toLockerId", v: string) => setEf(f => {
    const next = { ...f, [side]: v };
    const samePair = lockerCcy(f.lockerId) === lockerCcy(next.lockerId) && lockerCcy(f.toLockerId) === lockerCcy(next.toLockerId);
    return samePair ? next : { ...next, rate: recordedRate(next.lockerId, next.toLockerId) };
  });

  // Several bills, or an old payment written one account row per bill: no
  // saying which part took a different total.
  const amountFixed = !!entry.legIds || (entry.txnIds?.length ?? 0) > 1;

  const save = () => {
    const amt = Number(ef.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const refused = editEntry(entry, {
      amount: amt,
      // The time of day is kept; only the day moves (and nothing, when it didn't).
      date: moveToDay(entry.date, ef.date),
      note: ef.note,
      lockerId: ef.lockerId || undefined,
      userId: user!.id,
      toLockerId: ef.toLockerId || undefined,
      exchangeRate: Number(ef.rate) || undefined,
    });
    // Nothing was written — say why and leave the panel open to fix it.
    if (refused) { toast.error(refused); return; }
    toast.success("Entry corrected");
    onClose();
  };

  const remove = async () => {
    if (await confirmDeleteEntry(db, entry)) onClose();
  };

  const acctName = db.lockers.find(l => l.id === entry.lockerId)?.name ?? "its account";

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={PencilLine}
      title="Correct this entry"
      description={<>{entry.party}{entry.against ? ` · ${entry.against}` : ""}.{" "}
        {entry.orphan || entry.noTxn ? "" : "The account it came from moves with it, so the balance and what is owed stay in step."}</>}
      footer={
        <div className="flex gap-2 flex-wrap">
          {mayDelete && (
            <Button variant="outline" onClick={remove}
              className="rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10">
              Cancel entry
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="rounded-xl ml-auto">Close</Button>
          <Button onClick={save} className="btn-hero rounded-xl">Save</Button>
        </div>
      }>
      <div className="space-y-3">
        {entry.legIds && (
          <p className="text-[11px] text-muted-foreground rounded-xl bg-secondary/60 p-2.5">
            This one payment settled {entry.legLabels?.length} bills — {entry.legLabels?.join(", ")}.
            The date, account and remarks can be corrected and all of them move together.
            <span className="font-medium text-foreground"> The total cannot be changed here</span>, because there
            is no saying which bill should get more or less — cancel it and enter it again instead.
          </p>
        )}
        {entry.txnAmount !== undefined && (
          <p className="text-[11px] rounded-xl bg-amber-500/10 text-amber-800 p-2.5">
            {acctName} shows {fmtCcy(entry.txnAmount, entry.currency)} for this payment, but it adds up to{" "}
            {fmtCcy(entry.amount, entry.currency)} here.{" "}
            {amountFixed
              ? "Cancel it and enter it again to put the two right."
              : "Leave the amount as it is and neither changes; enter the right one and both are set to it."}
          </p>
        )}
        {entry.noTxn && (
          <p className="text-[11px] rounded-xl bg-amber-500/10 text-amber-800 p-2.5">
            No movement for this payment was found in {acctName}. Correcting it here changes {entry.party}&rsquo;s
            books only — the account&rsquo;s balance stays as it is.
          </p>
        )}
        {entry.orphan && (
          <p className="text-[11px] rounded-xl bg-amber-500/10 text-amber-800 p-2.5">{entry.orphan}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {/* A transfer's amount is what left the FROM account, in its currency. */}
            <Label className="text-xs">Amount ({ccySymbol(entry.transfer ? lockerCcy(ef.lockerId) : entry.currency).trim()})</Label>
            <Input type="number" min={0} step="0.01" value={ef.amount} disabled={amountFixed}
              onChange={e => setEf({ ...ef, amount: e.target.value })}
              className="rounded-xl h-10 mt-1 disabled:opacity-60" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={ef.date}
              onChange={e => setEf({ ...ef, date: e.target.value })} className="rounded-xl h-10 mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">{entry.transfer ? "From account" : "Account"}</Label>
          <Select value={ef.lockerId || "none"}
            onValueChange={v => (entry.transfer ? pickTransferSide("lockerId", v === "none" ? "" : v) : setEf({ ...ef, lockerId: v === "none" ? "" : v }))}>
            <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No account</SelectItem>
              {/* Anything but a transfer can only move to an account in its own
                  currency — the amount would otherwise be read as another
                  currency's money. Its current account is always listed. */}
              {db.lockers.filter(l => (l.active !== false || l.id === entry.lockerId)
                && (entry.transfer || ccy(l.currency) === ccy(entry.currency) || l.id === entry.lockerId)).map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!entry.transfer && db.lockers.some(l => l.active !== false && ccy(l.currency) !== ccy(entry.currency)) && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Only {ccy(entry.currency)} accounts — this entry is in {ccy(entry.currency)}. Money that changed currency is a transfer.
            </p>
          )}
        </div>
        {entry.transfer && (
          <>
            <div>
              <Label className="text-xs">To account</Label>
              <Select value={ef.toLockerId} onValueChange={v => pickTransferSide("toLockerId", v)}>
                <SelectTrigger className="h-10 rounded-xl mt-1"><SelectValue placeholder="Choose the destination" /></SelectTrigger>
                <SelectContent>
                  {db.lockers.filter(l => (l.active !== false || l.id === ef.toLockerId) && l.id !== ef.lockerId).map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({ccy(l.currency)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(() => {
              const from = db.lockers.find(l => l.id === ef.lockerId);
              const to = db.lockers.find(l => l.id === ef.toLockerId);
              if (!from || !to || ccy(from.currency) === ccy(to.currency)) return null;
              // Always 1 FROM-currency = rate TO-currency, however it is shown.
              return (
                <RateInput id="ledger-transfer-rate" from={ccy(from.currency)} to={ccy(to.currency)}
                  value={Number(ef.rate) > 0 ? Number(ef.rate) : ""}
                  onChange={r => setEf(f => ({ ...f, rate: r === "" ? "" : String(r) }))}
                  amount={Number(ef.amount) || undefined} at={ef.date} />
              );
            })()}
            <p className="text-[11px] text-muted-foreground">
              Both sides move together — the money leaves the first account and arrives in the second, converted at
              this rate when the two are in different currencies.
            </p>
          </>
        )}

        <div>
          <Label className="text-xs">Remarks</Label>
          <Input value={ef.note} onChange={e => setEf({ ...ef, note: e.target.value })} className="rounded-xl h-10 mt-1" />
        </div>
      </div>
    </ActionSheet>
  );
}
