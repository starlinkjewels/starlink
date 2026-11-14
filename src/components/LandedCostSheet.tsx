// A purchase's ⋯ Landed cost: freight, insurance, duty, lab fees on its bill — into the goods' cost
// (lib/landedCost.ts). Paid from an account, that account's entry too; the supplier's bill never changes.
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, Truck } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtDate, stampFor, todayLocal, type LandedCostKind } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { landedInr } from "@/lib/brokers";
import { purchaseQty } from "@/lib/materials";
import { LANDED_KINDS, addLandedCost, billCharges, billLines, landedKindLabel, landedProblem, removeLandedCost, takesLanded } from "@/lib/landedCost";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions } from "@/components/BillLayout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_ACCOUNT = "__none";

export function LandedCostSheet({ purchaseId, onClose, mayChange, describe }: {
  purchaseId: string;
  onClose: () => void;
  mayChange: boolean;
  /** What a line is, as the supplier's page writes it. */
  describe: (id: string) => string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const p = (db.purchases ?? []).find(x => x.id === purchaseId);
  const lines = p ? billLines(db, p) : [];
  const material = lines.filter(takesLanded);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(material.map(l => [l.id, true])));
  const [kind, setKind] = useState<LandedCostKind>("freight");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [lockerId, setLockerId] = useState(NO_ACCOUNT);
  const [note, setNote] = useState("");
  if (!p) return null;
  const charges = billCharges(lines);
  const accounts = db.lockers.filter(l => l.active !== false && (l.currency ?? "INR") === "INR");
  const billInr = lines.reduce((t, l) => t + (l.totalInr || 0), 0);
  const extraInr = charges.reduce((t, c) => t + c.inr, 0);
  const picked = material.filter(l => on[l.id]);

  const save = async () => {
    const input = { kind, inr: Number(amount) || 0, note, at: stampFor(date), ...(lockerId !== NO_ACCOUNT ? { lockerId } : {}) };
    const why = landedProblem(db, picked, input);
    if (why) { toast.error(why); return; }
    try {
      await addLandedCost(picked.map(l => l.id), input, user!);
      toast.success(`${landedKindLabel(kind)} ${fmtMoneyInr(input.inr)} — in the goods' cost${input.lockerId ? ", and out of the account" : ""}`);
      setAmount(""); setNote("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "It wasn't saved"); }
  };
  const remove = async (id: string, label: string) => {
    if (!(await confirmBox(`Take off ${label}?\n\nIt comes out of the goods' cost${charges.find(c => c.id === id)?.lockerTxnId ? ", and its entry comes out of the account" : ""}.`))) return;
    try { await removeLandedCost(id); toast.success("Taken off"); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't take it off"); }
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="lg" icon={Truck} title={`Landed cost${p.invoiceNumber ? ` — bill ${p.invoiceNumber}` : ""}`}
      description="Freight, insurance, customs duty, lab fees — what it took to get these goods, besides the supplier's bill. It goes into what the goods cost us (stock, orders, a stone's rate); the supplier's bill and account don't change."
      footer={mayChange && material.length > 0 ? (
        <PanelActions onCancel={onClose}>
          <AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-48">Add to the cost</AsyncButton>
        </PanelActions>
      ) : undefined}>
      <div className="@container space-y-5">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-xl border border-border/70 p-3"><p className="text-[11px] text-muted-foreground">Supplier's bill</p><p className="font-semibold tabular-nums">{fmtMoneyInr(billInr)}</p></div>
          <div className="rounded-xl border border-border/70 p-3"><p className="text-[11px] text-muted-foreground">Landed costs</p><p className="font-semibold tabular-nums">{fmtMoneyInr(extraInr)}{billInr > 0 && extraInr > 0 ? <span className="text-xs font-normal text-muted-foreground"> · {Math.round(extraInr / billInr * 1000) / 10}%</span> : null}</p></div>
          <div className="rounded-xl border border-border/70 p-3"><p className="text-[11px] text-muted-foreground">What it cost us</p><p className="font-semibold tabular-nums">{fmtMoneyInr(lines.reduce((t, l) => t + landedInr(l), 0))}</p></div>
        </div>

        <Group title="The lines">
          <ul className="rounded-xl border border-border/70 divide-y divide-border/60 text-sm">
            {lines.map(l => {
              const q = purchaseQty(l);
              const ok = takesLanded(l);
              return (
                <li key={l.id} className="flex items-start gap-3 px-3 py-2.5">
                  {mayChange && ok && <input type="checkbox" className="mt-1 h-4 w-4" checked={!!on[l.id]} onChange={e => setOn({ ...on, [l.id]: e.target.checked })} aria-label={`Spread onto ${describe(l.id)}`} />}
                  <span className="min-w-0 flex-1">
                    <span className="block">{describe(l.id)}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {fmtMoneyInr(l.totalInr)}{landedInr(l) > (l.totalInr || 0) + 0.004 ? ` + ${fmtMoneyInr(landedInr(l) - (l.totalInr || 0))} landed & brokerage` : ""}
                      {q > 0 ? ` · ${fmtMoneyInr(Math.round(landedInr(l) / q * 100) / 100)} a unit` : ""}
                      {!ok ? " · a ready piece — its cost is set on the piece in Ready Stock" : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-1">A cost is spread over the ticked lines by their value.</p>
        </Group>

        {charges.length > 0 && (
          <Group title="On this bill">
            <ul className="rounded-xl border border-border/70 divide-y divide-border/60 text-sm">
              {charges.map(c => (
                <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{landedKindLabel(c.kind)} · <span className="tabular-nums">{fmtMoneyInr(c.inr)}</span></span>
                    <span className="block text-xs text-muted-foreground">{fmtDate(c.at)}{c.lockerId ? ` · paid from ${db.lockers.find(l => l.id === c.lockerId)?.name ?? "an account"}` : " · not from an account"}{c.note ? ` · ${c.note}` : ""}</span>
                  </span>
                  {mayChange && (
                    <button type="button" onClick={() => remove(c.id, `${landedKindLabel(c.kind)} ${fmtMoneyInr(c.inr)}`)} aria-label={`Take off ${landedKindLabel(c.kind)}`}
                      className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                  )}
                </li>
              ))}
            </ul>
          </Group>
        )}

        {mayChange && material.length > 0 && (
          <Group title="Add a cost">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What it was">
                {LANDED_KINDS.map(k => (
                  <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}
                    className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${kind === k.key ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-secondary"}`}>{k.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)">{id => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10" aria-label="Amount" />}</Field>
                <Field label="Date">{id => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
                <Field label="Paid from" className="col-span-2" hint="Paid from one of our accounts: it comes out of it too. Owed to someone, or paid outside the app: cost only.">{id => (
                  <Select value={lockerId} onValueChange={setLockerId}>
                    <SelectTrigger id={id} className="h-10 rounded-xl" aria-label="Paid from"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ACCOUNT}>Not from an account — cost only</SelectItem>
                      {accounts.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}</Field>
                <Field label="Note" className="col-span-2" hint={kind === "other" ? "Needed for Other" : "Optional"}>{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="e.g. BlueDart AWB 12345" aria-label="Note" />}</Field>
              </div>
            </div>
          </Group>
        )}
      </div>
    </ActionSheet>
  );
}
