import { useState } from "react";
import { InfoTip } from "@/components/SectionTitle";
import { Check, Globe2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs, fmtDate, todayLocal } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { confirmBox } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencySelect } from "@/components/CurrencyFields";
import { ccy, ccyInfo, fetchLiveRates, fmtRate, inrPerUnit, withRates, type CurrencyRate } from "@/lib/currency";

/**
 * Settings → Exchange rates: rupees for one unit of every other currency the
 * business holds, by date. Transfers between accounts, money received into a
 * foreign account and expenses paid from one start from these rates (and can
 * still be typed differently each time). "Get today's rates" fills a row for
 * every currency in use from the live market.
 *
 * `onSaved` hands the new table to the page's form, so its next save can't put
 * the old one back.
 */
export function CurrencyRatesSettings({ onSaved }: { onSaved?: (next: CurrencyRate[]) => void }) {
  const db = useDb();
  const table = db.settings.currencyRates ?? [];
  const inUse = [...new Set([
    "USD",
    ...(db.lockers ?? []).map(l => ccy(l.currency)),
    ...table.map(r => ccy(r.code)),
  ])].filter(c => c !== "INR").sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  const missing = [...new Set((db.lockers ?? []).filter(l => l.active !== false).map(l => ccy(l.currency)))]
    .filter(c => c !== "INR" && inrPerUnit(table, c) === undefined);
  const [code, setCode] = useState(missing[0] ?? "USD");
  const [from, setFrom] = useState(todayLocal());
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // One dated rate being corrected in place.
  const [editing, setEditing] = useState<{ code: string; from: string; inr: string } | null>(null);

  const save = async (next: CurrencyRate[], summary: string) => {
    await updateDbAs({ summary }, d => { d.settings = { ...d.settings, currencyRates: next }; });
    onSaved?.(next);
  };
  const fetchToday = async () => {
    setBusy(true);
    try {
      const live = await fetchLiveRates(inUse);
      const got = Object.keys(live);
      if (!got.length) throw new Error("No rates came back — type them instead.");
      await save(withRates(table, todayLocal(), live), `Exchange rates for ${fmtDate(todayLocal())}: ${got.join(", ")}`);
      const left = inUse.filter(c => !got.includes(c));
      toast.success(`Today's rates saved for ${got.join(", ")}${left.length ? ` · none found for ${left.join(", ")}` : ""}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't get the rates"); }
    setBusy(false);
  };
  const add = async () => {
    const r = Number(rate);
    if (!from) { toast.error("Pick the date the rate applies from"); return; }
    if (!(r > 0)) { toast.error("Enter how many rupees one unit is"); return; }
    await save(withRates(table, from, { [code]: r }), `Exchange rate: 1 ${code} = ₹${r} from ${fmtDate(from)}`);
    setRate("");
    toast.success(`1 ${code} = ₹${fmtRate(r)} from ${fmtDate(from)} saved`);
  };
  const saveEdit = async () => {
    if (!editing) return;
    const r = Number(editing.inr);
    if (!(r > 0)) { toast.error("Enter how many rupees one unit is"); return; }
    await save(withRates(table, editing.from, { [editing.code]: r }), `Exchange rate corrected: 1 ${editing.code} = ₹${r} from ${fmtDate(editing.from)}`);
    toast.success(`1 ${editing.code} = ₹${fmtRate(r)} from ${fmtDate(editing.from)} saved`);
    setEditing(null);
  };
  const remove = async (row: CurrencyRate) => {
    if (!(await confirmBox(`Remove 1 ${row.code} = ₹${fmtRate(row.inr)} from ${fmtDate(row.from)}?\n\nFrom that day the rate before it is used instead, until the next one.`))) return;
    await save(table.filter(x => !(ccy(x.code) === ccy(row.code) && x.from === row.from)), `Exchange rate removed: ${row.code} from ${fmtDate(row.from)}`);
  };

  return (
    <div className="space-y-3 col-span-2 rounded-xl border border-border/60 bg-white/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand-dark flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5 text-primary" />Exchange rates (₹ for one unit)
            <InfoTip text="Transfers, foreign receipts and expenses start from these rates; each can be changed at the time. A rate holds from its date until the next." /></p>
        </div>
        <Button size="sm" variant="outline" onClick={fetchToday} disabled={busy} className="rounded-xl h-9 gap-1.5 shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />Get today's rates
        </Button>
      </div>
      {missing.length > 0 && (
        <p className="text-[11px] text-amber-700">No rate yet for {missing.join(", ")} — the accounts in {missing.length === 1 ? "it" : "them"} can't be added into totals in rupees until there is one.</p>
      )}
      <div className="rounded-lg border border-border/60 bg-white divide-y divide-border/50">
        {inUse.map(c => {
          const rows = table.filter(r => ccy(r.code) === c).sort((a, b) => b.from.localeCompare(a.from));
          const now = inrPerUnit(table, c);
          return (
            <div key={c} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0"><span className="font-semibold text-brand-dark">{c}</span> <span className="text-muted-foreground">· {ccyInfo(c).name}</span></span>
                <span className="flex items-center gap-3 shrink-0">
                  {now ? <span className="tabular-nums font-semibold">1 {c} = ₹{fmtRate(now)}</span> : <span className="text-amber-700">no rate</span>}
                  {rows.length > 0 && (
                    <button type="button" onClick={() => setOpen(open === c ? null : c)} className="text-primary hover:underline">{open === c ? "Hide" : `${rows.length} date${rows.length !== 1 ? "s" : ""}`}</button>
                  )}
                </span>
              </div>
              {open === c && (
                <div className="mt-1.5 space-y-1">
                  {rows.map((r, i) => (
                    <div key={r.from} className="flex items-center justify-between gap-3 pl-3 text-[11px]">
                      <span>From {fmtDate(r.from)}{i === 0 && <span className="ml-1.5 font-semibold text-success">current</span>}</span>
                      {editing && editing.code === c && editing.from === r.from ? (
                        <span className="flex items-center gap-1.5">
                          <Input type="number" min={0} step="any" value={editing.inr} autoFocus aria-label={`Rupees for 1 ${c} from ${r.from}`}
                            onChange={e => setEditing({ ...editing, inr: e.target.value })}
                            onKeyDown={e => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditing(null); }}
                            className="h-7 w-24 rounded-lg text-[11px]" />
                          <button type="button" onClick={() => void saveEdit()} aria-label="Save the rate" className="text-success"><Check className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => setEditing(null)} aria-label="Keep the rate" className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">₹{fmtRate(r.inr)}</span>
                          <button type="button" onClick={() => setEditing({ code: c, from: r.from, inr: String(r.inr) })} aria-label={`Edit ${c} rate from ${r.from}`} className="text-muted-foreground hover:text-primary"><Pencil className="h-3 w-3" /></button>
                          <button type="button" onClick={() => remove(r)} aria-label={`Remove ${c} rate from ${r.from}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-52">
          <p className="text-[10px] text-muted-foreground mb-0.5">Currency</p>
          <CurrencySelect value={code} onChange={setCode} className="rounded-xl h-9" />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">From</p>
          <Input type="date" value={from} max={todayLocal()} onChange={e => setFrom(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">₹ for 1 {code}</p>
          <Input type="number" min={0} step="any" value={rate} placeholder="e.g. 55.20" aria-label={`Rupees for 1 ${code}`}
            onChange={e => setRate(e.target.value)} className="rounded-xl h-9 w-28" />
        </div>
        <Button size="sm" variant="outline" className="rounded-xl h-9" onClick={add}>Add rate</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Live rates by <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer" className="underline">ExchangeRate-API</a> — nothing about the business is sent.</p>
    </div>
  );
}
