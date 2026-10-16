import { useState } from "react";
import { updateDb, fmtDate, fmtMoney, orderTotal, type Expense } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { ccySymbol, fmtCcy } from "@/lib/currency";
import { parcelsWithoutFreight, recordShippingCost, recordNoFreight, linkExpenseToShipment, type Parcel } from "@/lib/dispatch";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Truck, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";

/**
 * Shipments that went out before freight was recorded at dispatch — or after,
 * with the boxes left blank. ADMIN ONLY; the caller gates it.
 *
 * Each one leaves its orders' profit reading as an upper bound, because a cost
 * that was paid is missing. Nothing here invents a number. Each parcel gets
 * what it really cost, or a bill already in Expenses attached to it, or the
 * plain statement that it cost nothing — and for a long backlog, an estimate
 * can be applied to the lot, written down as an estimate so nobody mistakes it
 * for a bill later.
 */
export function FreightBacklog() {
  // Live: each parcel drops off the list the moment it is dealt with.
  const db = useDb();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [entry, setEntry] = useState<Record<string, { freight: string; insurance: string; link: string }>>({});
  const [estimate, setEstimate] = useState("");

  // Worked out fresh each render — the store is edited in place, so a memo
  // keyed on it would keep showing parcels that have just been dealt with.
  const parcels = parcelsWithoutFreight(db);
  // Bills already entered as ordinary expenses that could be this freight.
  const loose = (db.expenses ?? []).filter(e => !(e.orderIds && e.orderIds.length) && e.amount > 0);

  if (!parcels.length) return null;

  const me = { id: user!.id };
  const sym = ccySymbol(currency);
  const ref = (p: Parcel) => `${p.courierName} ${p.trackingNumber}`.trim();
  const field = (p: Parcel) => entry[p.key] ?? { freight: "", insurance: "", link: "" };
  const set = (p: Parcel, patch: Partial<{ freight: string; insurance: string; link: string }>) =>
    setEntry(prev => ({ ...prev, [p.key]: { ...field(p), ...patch } }));

  const nearby = (p: Parcel): Expense[] => {
    const t = +new Date(p.dispatchedAt);
    return loose
      .filter(e => Math.abs(+new Date(e.createdAt) - t) <= 45 * 86400000)
      .sort((a, b) => Math.abs(+new Date(a.createdAt) - t) - Math.abs(+new Date(b.createdAt) - t))
      .slice(0, 12);
  };

  const save = (p: Parcel) => {
    const f = field(p);
    const ids = p.orders.map(o => o.id);
    if (f.link) {
      let ok = false;
      updateDb(d => { ok = linkExpenseToShipment(d, f.link, ids, ref(p)); });
      if (ok) toast.success("Bill attached — it now counts as this shipment's cost, not an overhead");
      return;
    }
    const freight = Number(f.freight) || 0, insurance = Number(f.insurance) || 0;
    if (!(freight > 0 || insurance > 0)) { toast.error("Enter the freight or insurance, or mark it as no charge"); return; }
    updateDb(d => {
      recordShippingCost(d, ids, { freight, insurance, currency }, { courierName: p.courierName, trackingNumber: p.trackingNumber }, me, p.dispatchedAt);
    });
    toast.success(`Freight recorded for ${p.orders.length} order${p.orders.length !== 1 ? "s" : ""}`);
  };

  const none = (p: Parcel) => {
    updateDb(d => {
      recordNoFreight(d, p.orders.map(o => o.id), "no shipping charge", { courierName: p.courierName, trackingNumber: p.trackingNumber }, me, p.dispatchedAt);
    });
    toast.success("Marked as costing nothing to send");
  };

  const applyEstimate = async () => {
    const each = Number(estimate);
    if (!(each > 0)) { toast.error("Enter the estimate per parcel"); return; }
    if (!(await confirmBox(
      `Record ${fmtCcy(each, currency)} of estimated freight against each of the ${parcels.length} shipments listed?\n\n`
      + "Each is written as an ESTIMATE in Expenses, dated the day it shipped, and not taken from any account. "
      + "Replace any of them with the real bill whenever you have it.",
    ))) return;
    updateDb(d => {
      for (const p of parcels) {
        recordShippingCost(d, p.orders.map(o => o.id), { freight: each, insurance: 0, currency },
          { courierName: `${p.courierName} (estimated)`.trim(), trackingNumber: p.trackingNumber }, me, p.dispatchedAt);
      }
    });
    setEstimate("");
    toast.success(`Estimated freight recorded on ${parcels.length} shipments`);
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 text-xs">
          <Truck className="h-4 w-4 text-amber-600 shrink-0" />
          <span>
            <span className="font-semibold text-amber-800">{parcels.length} shipment{parcels.length !== 1 ? "s" : ""} with no freight recorded</span>
            <span className="text-muted-foreground"> — their orders&rsquo; profit is an upper bound until each is filled in</span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-amber-700 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="text-muted-foreground">Amounts in</span>
            {(["INR", "USD"] as const).map(c => (
              <label key={c} className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={currency === c} onChange={() => setCurrency(c)} />
                {c === "INR" ? "₹ rupees" : "$ dollars"}
              </label>
            ))}
            <span className="text-muted-foreground">
              · If a bill is already in Expenses, attach it rather than typing it again, or it is counted twice.
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-white p-2">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Clear the backlog with an estimate ({sym} per parcel)</p>
              <Input type="number" min={0} value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="e.g. 1500" className="h-8 w-32 rounded-lg" />
            </div>
            <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={applyEstimate}>Apply to all {parcels.length}</Button>
            <p className="text-[10px] text-muted-foreground basis-full">Written down as an estimate, so it is never mistaken for a real bill.</p>
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-border/50 rounded-lg border border-border/60 bg-white">
            {parcels.map(p => {
              const f = field(p);
              const value = p.orders.reduce((s, o) => s + orderTotal(o), 0);
              const options = nearby(p);
              return (
                <div key={p.key} className="p-2.5 space-y-2">
                  <div className="text-xs">
                    <span className="font-semibold text-brand-dark">{ref(p) || "No tracking number"}</span>
                    <span className="text-muted-foreground">
                      {" · "}{p.orders.map(o => o.orderNumber).join(", ")}{" · shipped "}{fmtDate(p.dispatchedAt)}{" · "}{fmtMoney(value)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="number" min={0} value={f.freight} placeholder={`Freight ${sym}`} disabled={!!f.link}
                      onChange={e => set(p, { freight: e.target.value })} className="h-8 w-28 rounded-lg" />
                    <Input type="number" min={0} value={f.insurance} placeholder={`Insurance ${sym}`} disabled={!!f.link}
                      onChange={e => set(p, { insurance: e.target.value })} className="h-8 w-28 rounded-lg" />
                    {options.length > 0 && (
                      <select value={f.link} onChange={e => set(p, { link: e.target.value })}
                        className="h-8 rounded-lg border border-input bg-background px-2 text-xs max-w-[16rem]">
                        <option value="">or attach a bill already in Expenses…</option>
                        {options.map(e => (
                          <option key={e.id} value={e.id}>
                            {e.title} · {fmtCcy(e.amount, e.currency)} · {fmtDate(e.createdAt)}
                          </option>
                        ))}
                      </select>
                    )}
                    <Button size="sm" className="h-8 rounded-lg btn-hero" onClick={() => save(p)}>{f.link ? "Attach" : "Save"}</Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => none(p)}>No charge</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
