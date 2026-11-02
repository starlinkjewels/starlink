import { useEffect, useRef, useState } from "react";
import { useDb } from "@/hooks/useDb";
import { ccy, fmtCcy } from "@/lib/currency";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { RateInput } from "@/components/CurrencyFields";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Paying a party whose account is kept in rupees — a supplier, a factory, a
 * designer, a broker — from any of our accounts. From a rupee account, as always:
 * the amount is rupees. From an account in another currency (a dollar bank
 * account), the amount is in that currency and the rate turns it into the
 * rupees that go on their books (lib/partyPayments.ts payInRupees). Every
 * payment form uses this one piece, so they all ask and book it the same way.
 *
 *   const fx = useRupeePay(lockerId, amount);
 *   …{fx.box}…                       // the rate, under the account
 *   if (fx.problem) refuse(fx.problem)
 *   write…({ …, amount, ...fx.args }) // rate passed only from a non-rupee account
 *
 * `onNewCurrency`: the form clears its amount — a number typed for a rupee
 * account must never be read again as dollars (or the other way round).
 */
export function useRupeePay(lockerId: string | undefined, amountIn: number | ((rate: number) => number), party = "their", onNewCurrency?: () => void) {
  const db = useDb();
  const locker = lockerId ? db.lockers.find(l => l.id === lockerId) : undefined;
  const cur = ccy(locker?.currency);
  const foreign = !!locker && cur !== "INR";
  const [rate, setRate] = useState<number | "">("");
  // The amount, in the account's currency — or worked out from the rate (a form
  // whose sum is in rupees, like the broker's bills, shown in dollars).
  const amount = typeof amountIn === "function" ? amountIn(foreign ? Number(rate) || 0 : 1) : amountIn;
  // Another account: the rate starts again — set here, while drawing, so the rate
  // box (drawn afresh for each account, below) then fills in Settings → Exchange rates.
  const [rateFor, setRateFor] = useState(lockerId);
  if (rateFor !== lockerId) { setRateFor(lockerId); setRate(""); }
  // Another currency: the amount typed was meant in the old one.
  const lastCur = useRef(cur);
  useEffect(() => {
    if (lastCur.current === cur) return;
    lastCur.current = cur;
    onNewCurrency?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);
  const inr = foreign ? (Number(rate) > 0 ? r2(amount * Number(rate)) : 0) : amount;
  const problem = foreign && !(Number(rate) > 0) ? `Enter the rate — ₹ for 1 ${cur}` : undefined;
  const box = foreign ? (
    <div className="p-3 rounded-xl bg-secondary space-y-1">
      {/* No amount preview inside: the line below says what it comes to, and whose account. */}
      <RateInput key={lockerId} from={cur} to="INR" value={rate} onChange={setRate} />
      <p className="text-[11px] text-muted-foreground">
        {inr > 0 ? `${fmtCcy(amount, cur)} = ${fmtMoneyInr(inr)} on ${party} account — ` : ""}kept in rupees; {locker!.name} goes down in {cur}.
      </p>
    </div>
  ) : null;
  return {
    /** The account's currency ("INR" for a rupee account). */
    cur,
    /** The amount, in the account's currency. */
    amount,
    /** Paid from an account in another currency. */
    foreign,
    /** The rupees it settles on their books. */
    inr,
    /** ₹ for 1 of the account's currency (0 until entered; 1 for a rupee account). */
    rate: foreign ? Number(rate) || 0 : 1,
    /** Why it can't be saved yet, or undefined. */
    problem,
    /** The rate and what it comes to — shown only for a non-rupee account. */
    box,
    /** Passed to the write function: the rate, only for a non-rupee account. */
    args: foreign && Number(rate) > 0 ? { rate: Number(rate) } : {},
    /** "$1,000 (₹84,200)" for a message, or "₹84,200". */
    text: foreign ? `${fmtCcy(amount, cur)} (${fmtMoneyInr(inr)})` : fmtMoneyInr(amount),
  };
}
