// Settings → Live gold & $ rates: what the rates are now and where each came
// from, the rate per gram of every karat (in ₹ for India, in $ for export), the
// sources and their health, rates by hand (pinned for a while, or manual mode
// with live switched off), the rules the rates are checked by, and today's
// movements. The server calls the sources a few times a day, at the times set
// here (or at once with Refresh now), and checks every reading (functions-rates).
import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock, Hand, Pin, PinOff, RefreshCw, Save, TrendingUp, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { CellTag } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/db";
import { checkSources, refreshRates, saveRateSettings, STATUS_TEXT, useRateDay, useRateEvents, useRates, useRateSettings } from "@/lib/liveRates";
import { FIELD_LABEL, karatRates, SOURCE_LABEL, type Field, type ManualRates, type RateSettings } from "@/lib/pure/liveRates";

const inr = (n?: number, d = 0) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const usd = (n?: number, d = 2) => (n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const fmt = (f: Field, v?: number) => (v == null ? "—" : f === "usdInr" ? `₹${v.toFixed(3)}` : f.endsWith("UsdOz") ? usd(v) : inr(v));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HAND: { f: keyof ManualRates; label: string; hint: string }[] = [
  { f: "gold999Inr10g", label: "Gold 999 (₹ per 10 g)", hint: "India prices" },
  { f: "goldUsdOz", label: "Gold spot ($ per oz)", hint: "Export prices" },
  { f: "usdInr", label: "₹ per $", hint: "" },
  { f: "platinumUsdOz", label: "Platinum ($ per oz)", hint: "" },
  { f: "silverUsdOz", label: "Silver ($ per oz)", hint: "" },
];

function HandRates({ value, onChange, base }: { value: ManualRates; onChange: (v: ManualRates) => void; base: ManualRates }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {HAND.map(h => (
        <div key={h.f} className="min-w-0">
          <Label className="text-xs">{h.label}</Label>
          <Input type="number" inputMode="decimal" min={0} step="any" className="mt-1 h-9 rounded-lg" placeholder={base[h.f] != null ? String(base[h.f]) : ""}
            value={value[h.f] ?? ""} onChange={e => onChange({ ...value, [h.f]: e.target.value === "" ? undefined : Number(e.target.value) })} />
          {h.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{h.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function LiveRatesSettings() {
  const { user } = useAuth();
  const rates = useRates();
  const saved = useRateSettings();
  const events = useRateEvents();
  const today = useRateDay(istToday());
  const [f, setF] = useState<RateSettings | null>(null);
  const [busy, setBusy] = useState("");
  const [check, setCheck] = useState<Awaited<ReturnType<typeof checkSources>> | null>(null);
  const [pin, setPin] = useState<ManualRates>({});
  const [pinFor, setPinFor] = useState("eod");
  const v = f ?? saved;
  useEffect(() => { if (saved && !f) setPin({}); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = rates?.live ?? {};
  const nowVals: ManualRates = useMemo(() => Object.fromEntries(Object.entries(live).map(([k, x]) => [k, x!.value])), [live]);
  const perGram = useMemo(() => (rates?.price && v ? karatRates(rates.price, v) : []), [rates?.price, v]);
  if (!v) return <div className="card-luxe p-6"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  const set = (p: Partial<RateSettings>) => setF({ ...v, ...p });
  const st = STATUS_TEXT[rates?.status ?? "stale"];

  const save = async (next: RateSettings, msg: string) => {
    setBusy("save");
    try { await saveRateSettings(next, user!.id); setF(null); toast.success(msg); void refreshRates().catch(() => undefined); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  const pinUntil = () => {
    const d = new Date();
    if (pinFor === "1h") return new Date(Date.now() + 3600_000).toISOString();
    if (pinFor === "4h") return new Date(Date.now() + 4 * 3600_000).toISOString();
    // End of today / tomorrow in India time (23:59 IST).
    const ist = new Date(d.getTime() + 5.5 * 3600_000);
    ist.setUTCHours(23, 59, 0, 0);
    if (pinFor === "eot") ist.setUTCDate(ist.getUTCDate() + 1);
    return new Date(ist.getTime() - 5.5 * 3600_000).toISOString();
  };

  return (
    <div className="card-luxe p-6 space-y-7">
      <SectionTitle icon={TrendingUp} title="Live gold & $ rates" sub={rates?.asOf ? `Checked ${timeAgo(rates.asOf).toLowerCase()} · daily at ${v.times.join(", ") || "—"}` : "Waiting for the first check"}
        info="The server calls the rate sources only at the times you set (a few a day), or at once with Refresh now — never your phone. Each reading is checked before it is used (no zero, no sudden jump, not frozen, agreeing with a second source); if the dealer's feed is down, backup sources take over by themselves, and a check that found no good rates is tried again each hour. Prices change only on a real move."
        actions={<div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={!!busy} onClick={async () => { setBusy("check"); try { setCheck(await checkSources()); } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); } }}>
            <Activity className="h-4 w-4" />{busy === "check" ? "Checking…" : "Check sources"}</Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={!!busy} onClick={async () => { setBusy("refresh"); try { const r = await refreshRates(); toast.success(`Rates checked — ${STATUS_TEXT[r.status as keyof typeof STATUS_TEXT]?.label ?? r.status}`); } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); } }}>
            <RefreshCw className="h-4 w-4" />{busy === "refresh" ? "…" : "Refresh now"}</Button>
        </div>} />

      {/* Now */}
      <div className="space-y-3">
        <div className={`rounded-xl border px-4 py-3 text-sm flex flex-wrap items-start gap-3 ${st.tone === "green" ? "border-success/30 bg-success/5" : st.tone === "red" ? "border-destructive/30 bg-destructive/5" : st.tone === "amber" ? "border-amber-300 bg-amber-50" : "border-border bg-secondary/30"}`}>
          <CellTag tone={st.tone === "neutral" ? "neutral" : st.tone}>{st.label}</CellTag>
          <div className="min-w-0 flex-1 space-y-0.5">
            {(rates?.reasons?.length ? rates.reasons : ["All rates from their first source, checked"]).slice(0, 4).map(r => <p key={r} className="text-xs text-foreground/80">{r}</p>)}
          </div>
        </div>
        <StatStrip items={(["gold999Inr10g", "goldUsdOz", "usdInr", "platinumUsdOz", "silverInrKg"] as Field[]).map(k => ({
          label: FIELD_LABEL[k], value: fmt(k, live[k]?.value), sub: live[k] ? SOURCE_LABEL[live[k]!.source] : "—",
        }))} />
      </div>

      {/* Per gram */}
      <section className="space-y-3">
        <SectionTitle title="Per gram, as prices use them" sub={rates?.price ? `Smoothed rates · last changed ${timeAgo(rates.price.at).toLowerCase()}` : "—"}
          info={"₹ for India: the Mumbai bar rate (without GST — GST is added on the bill) × purity. $ for export: world spot ÷ 31.1035 × purity — export gold pays no Indian import duty, so it is never priced from the ₹ rate."} />
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground"><tr><th className="text-left px-3 py-2 font-medium">Metal</th><th className="text-right px-3 py-2 font-medium">Purity</th><th className="text-right px-3 py-2 font-medium">₹ per g (India)</th><th className="text-right px-3 py-2 font-medium">$ per g (export)</th></tr></thead>
            <tbody>{perGram.map(k => (
              <tr key={k.key} className="border-t border-border/60"><td className="px-3 py-2 font-medium">{k.key === "PT950" ? "Platinum 950" : k.key === "AG925" ? "Silver 925" : `Gold ${k.key}`}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{k.purity.toFixed(3)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(k.inrPerG, 2)}</td><td className="px-3 py-2 text-right tabular-nums">{usd(k.usdPerG)}</td></tr>
            ))}{!perGram.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No rates yet.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      {/* By hand */}
      <section className="space-y-4 rounded-2xl border border-border p-4">
        <SectionTitle title="Rates by hand" icon={Hand} sub="When a source is down, or whenever you want" />
        <div className="inline-flex rounded-xl border border-border bg-white p-0.5" role="tablist" aria-label="Rates from">
          {([["live", "Live (from the sources)"], ["manual", "Manual (live off)"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={v.mode === k} onClick={() => set({ mode: k, ...(k === "manual" && !v.manual ? { manual: { ...nowVals } } : {}) })}
              className={`h-8 px-3 rounded-lg text-xs font-medium ${v.mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
        {v.mode === "manual" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Only these rates are used — the live sources are still checked and shown above, never used. Change them any time; prices follow at once.</p>
            <HandRates value={v.manual ?? {}} base={nowVals} onChange={m => set({ manual: m })} />
          </div>
        ) : (
          <div className="space-y-3">
            {v.override ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm flex flex-wrap items-center gap-3">
                <Pin className="h-4 w-4 text-blue-700" />
                <p className="flex-1 min-w-0">Pinned by hand until <b>{new Date(v.override.until).toLocaleString()}</b>: {HAND.filter(h => v.override![h.f] != null).map(h => `${h.label} ${v.override![h.f]}`).join(" · ")}</p>
                <Button size="sm" variant="outline" className="gap-1.5 bg-white" disabled={!!busy} onClick={() => void save({ ...v, override: undefined }, "Back to live rates")}><PinOff className="h-3.5 w-3.5" />Back to live now</Button>
              </div>
            ) : <p className="text-xs text-muted-foreground">Type only the rates to pin (the rest stay live). They are used until the time you choose, then it goes back to live by itself.</p>}
            <HandRates value={pin} base={nowVals} onChange={setPin} />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={pinFor} onValueChange={setPinFor}><SelectTrigger className="h-9 w-44 rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1h">For 1 hour</SelectItem><SelectItem value="4h">For 4 hours</SelectItem><SelectItem value="eod">Until end of today</SelectItem><SelectItem value="eot">Until end of tomorrow</SelectItem></SelectContent></Select>
              <Button className="gap-1.5" disabled={!!busy || !Object.values(pin).some(x => x != null)} onClick={() => void save({ ...v, override: { ...pin, until: pinUntil() } }, "Pinned — prices use these now")}><Pin className="h-4 w-4" />Pin these rates</Button>
            </div>
          </div>
        )}
      </section>

      {/* Sources */}
      <section className="space-y-3">
        <SectionTitle title="Sources" sub="In this order; the next takes over when one is down" />
        <div className="rounded-xl border border-border divide-y divide-border/60">
          {([["ronakOn", "ronak", "The dealer's live board — gold 999/995, spot, ₹/$, silver"], ["goldApiOn", "goldapi", "World spot price — gold, silver, platinum"], ["fxDailyOn", "fxdaily", "Once a day — ₹/$ and other currencies"], ["ibjaOn", "ibja", "Official Indian rate, twice a business day"]] as const).map(([key, id, what]) => {
            const s = rates?.sources?.[id];
            return (
              <div key={id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <Switch checked={v[key]} onCheckedChange={x => set({ [key]: x } as Partial<RateSettings>)} aria-label={SOURCE_LABEL[id]} />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{SOURCE_LABEL[id]}</p><p className="text-xs text-muted-foreground">{what}</p></div>
                {s ? (s.ok ? <span className="text-xs text-success inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />answering · {s.ms} ms · {timeAgo(s.at).toLowerCase()}</span>
                  : <span className="text-xs text-destructive inline-flex items-center gap-1 max-w-[18rem]"><XCircle className="h-3.5 w-3.5 shrink-0" />{s.error}</span>) : <span className="text-xs text-muted-foreground">—</span>}
              </div>
            );
          })}
        </div>
        <div><Label htmlFor="lr-url" className="text-xs">Ronak Gold feed address</Label><Input id="lr-url" className="mt-1 h-9 rounded-lg font-mono text-xs" value={v.ronakUrl} onChange={e => set({ ronakUrl: e.target.value })} /></div>
        {check && (
          <div className="rounded-xl border border-border p-3 space-y-1.5 text-xs">
            <p className="font-medium text-sm">Each source's own answer now</p>
            {(["ronak", "goldapi", "fxdaily", "ibja"] as const).map(k => { const r = check[k]; return (
              <p key={k}><b>{SOURCE_LABEL[k]}:</b> {!r ? "off" : r.ok ? Object.entries(r.reading ?? {}).filter(([x]) => x !== "fx").map(([x, n]) => `${FIELD_LABEL[x as Field] ?? x} ${fmt(x as Field, n as number)}`).join(" · ") : <span className="text-destructive">{r.error}</span>}</p>
            ); })}
          </div>
        )}
      </section>

      {/* Rules */}
      <section className="space-y-4">
        <SectionTitle title="Rules" sub="How rates are checked and used" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label className="text-xs">India karat rates made from</Label>
            <Select value={v.base} onValueChange={x => set({ base: x as "999" | "995" })}><SelectTrigger className="mt-1 h-9 rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="999">999 rate × purity (the trade's way)</SelectItem><SelectItem value="995">995 bar ÷ 0.995 × purity</SelectItem></SelectContent></Select></div>
          <div><Label className="text-xs">Hold a reading that jumps more than (%)</Label><Input type="number" step="0.1" className="mt-1 h-9 rounded-lg" value={v.jumpPct} onChange={e => set({ jumpPct: Number(e.target.value) })} /></div>
          <div><Label className="text-xs">Prices change on a move of (%)</Label><Input type="number" step="0.05" className="mt-1 h-9 rounded-lg" value={v.stepPct} onChange={e => set({ stepPct: Number(e.target.value) })} /></div>
          <div><Label className="text-xs">Platinum in ₹: premium over spot (%)</Label><Input type="number" step="0.5" className="mt-1 h-9 rounded-lg" value={v.platinumInrPremiumPct} onChange={e => set({ platinumInrPremiumPct: Number(e.target.value) })} /></div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm self-end"><span>Tell admins when a source is down</span><Switch checked={v.alerts} onCheckedChange={x => set({ alerts: x })} /></label>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Check the rates at (India time, each day)</Label>
          <div className="flex flex-wrap items-center gap-2">
            {v.times.map(t => (
              <span key={t} className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 pl-2.5 pr-1 h-8 text-sm font-medium text-primary">{t}
                <button type="button" aria-label={`Remove ${t}`} className="h-6 w-6 grid place-items-center rounded-md hover:bg-primary/10" onClick={() => set({ times: v.times.filter(x => x !== t) })}><XCircle className="h-3.5 w-3.5" /></button></span>
            ))}
            <Input type="time" aria-label="Add a time" className="h-8 w-28 rounded-lg" onChange={e => { const t = e.target.value; if (/^\d\d:\d\d$/.test(t) && !v.times.includes(t)) set({ times: [...v.times, t].sort() }); e.target.value = ""; }} />
            <span className="text-xs text-muted-foreground">{v.times.length ? `${v.times.length} check${v.times.length === 1 ? "" : "s"} a day — and Refresh now any time` : "No set times: only Refresh now"}</span>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Market open (India time)</Label>
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((d, i) => (
              <button key={d} type="button" onClick={() => set({ market: { ...v.market, days: v.market.days.includes(i) ? v.market.days.filter(x => x !== i) : [...v.market.days, i].sort() } })}
                className={`h-8 w-11 rounded-lg border text-xs font-medium ${v.market.days.includes(i) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{d}</button>
            ))}
            <Input type="time" className="h-8 w-28 rounded-lg" value={v.market.open} onChange={e => set({ market: { ...v.market, open: e.target.value } })} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="time" className="h-8 w-28 rounded-lg" value={v.market.close} onChange={e => set({ market: { ...v.market, close: e.target.value } })} />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Purity</Label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(v.purity).map(([k, p]) => (
              <div key={k} className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1"><span className="text-xs font-medium w-12">{k}</span>
                <Input type="number" step="0.001" className="h-7 w-20 rounded-md text-xs" value={p} onChange={e => set({ purity: { ...v.purity, [k]: Number(e.target.value) } })} /></div>
            ))}
          </div>
        </div>
      </section>

      {/* Today */}
      <section className="space-y-3">
        <SectionTitle title="Today" icon={Clock} sub="Open, high, low and now — and what happened" />
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground"><tr><th className="text-left px-3 py-2 font-medium">Rate</th>{["Open", "High", "Low", "Now"].map(h => <th key={h} className="text-right px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{(["gold999Inr10g", "goldUsdOz", "usdInr", "platinumUsdOz"] as Field[]).map(k => { const d = today?.[k]; return (
              <tr key={k} className="border-t border-border/60"><td className="px-3 py-2">{FIELD_LABEL[k]}</td>
                {d ? [d.o, d.h, d.l, d.c].map((n, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{fmt(k, n)}</td>) : <td colSpan={4} className="px-3 py-2 text-right text-muted-foreground">—</td>}</tr>
            ); })}</tbody>
          </table>
        </div>
        {events.length > 0 && (
          <ul className="space-y-1 text-xs">
            {events.slice(0, 12).map(e => <li key={e.id} className="flex gap-2"><span className="text-muted-foreground shrink-0 w-24">{timeAgo(e.at)}</span><span>{e.text}</span></li>)}
          </ul>
        )}
      </section>

      {f && (
        <div className="sticky bottom-3 flex justify-end gap-2 rounded-xl border border-border bg-white/95 p-3 shadow-lg backdrop-blur">
          <Button variant="outline" onClick={() => setF(null)}>Discard</Button>
          <Button className="gap-1.5" disabled={!!busy} onClick={() => void save(v, v.mode === "manual" ? "Saved — manual rates in use" : "Saved")}><Save className="h-4 w-4" />{busy === "save" ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </div>
  );
}
