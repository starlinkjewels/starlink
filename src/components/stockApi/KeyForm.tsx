// A Ready Stock API key, made or changed: who it is for, which pieces it shows,
// its price rule, its limits and the websites it may be used from
// (lib/apiKeys.ts). The key itself is never here — it is shown once, after.
import { useEffect, useState } from "react";
import { KeyRound, Check } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDb } from "@/hooks/useDb";
import { listOf } from "@/lib/optionLists";
import { readyStockOffices } from "@/lib/offices";
import { companiesOf, hasCompanies } from "@/lib/companies";
import { blankKey, createKey, keyProblem, updateKey, type KeyInput, type Who } from "@/lib/apiKeys";
import { cleanOrigins, DEFAULT_PER_DAY, DEFAULT_PER_MINUTE, MAX_PER_MINUTE, type ApiKeyDoc } from "@/lib/apiKeysModel";

const NO_CLIENT = "__none__";

/** Chips to tick — none ticked means all of them. */
function Chips({ label, all, value, onChange }: { label: string; all: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const on = new Set(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-[11px] text-muted-foreground">{value.length ? `${value.length} chosen` : "All"}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {all.map(o => {
          const sel = on.has(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={sel}
              onClick={() => onChange(sel ? value.filter(x => x !== o.value) : [...value, o.value])}
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-xs font-medium transition-colors
                ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-white border-border text-foreground hover:bg-secondary"}`}>
              {sel && <Check className="h-3 w-3" />}{o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function KeyForm({ open, editing, who, onClose, onMade }: {
  open: boolean;
  /** Changing this key; null = a new one. */
  editing: ApiKeyDoc | null;
  who: Who;
  onClose: () => void;
  /** A new key: its id and the key itself (shown once). */
  onMade: (id: string, secret: string) => void;
}) {
  const db = useDb();
  const [f, setF] = useState<KeyInput>(blankKey());
  const [origins, setOrigins] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setF({ name: editing.name, clientId: editing.clientId, clientName: editing.clientName, note: editing.note, scope: { ...editing.scope },
        price: { ...editing.price }, share3d: editing.share3d === true, limits: { ...editing.limits }, origins: [...(editing.origins ?? [])] });
      setOrigins((editing.origins ?? []).join("\n"));
    } else { setF(blankKey()); setOrigins(""); }
  }, [open, editing]);

  const types = listOf("jewelleryTypes", db.settings).filter(t => t !== "Diamond Only");
  const metals = listOf("metals", db.settings).filter(m => !/^None/.test(m));
  const offices = readyStockOffices(db.settings);
  const multiCo = hasCompanies(db.settings);
  const companies = multiCo ? companiesOf(db.settings) : [];
  const clients = [...db.clients].sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
  const keep = (list: string[], chosen: string[] = []) => [...list, ...chosen.filter(x => !list.includes(x))].map(v => ({ value: v, label: v }));
  const scope = f.scope;

  const save = async () => {
    const o = cleanOrigins(origins);
    if (o.bad.length) { toast.error(`Not a website address: ${o.bad.join(", ")}`); return; }
    const input = { ...f, origins: o.list };
    const problem = keyProblem(input);
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      if (editing) { await updateKey(editing, input, who); toast.success("Key saved — it takes effect within a minute"); onClose(); }
      else { const r = await createKey(input, who); onClose(); onMade(r.id, r.secret); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the key");
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} icon={KeyRound} size="lg"
      title={editing ? `Edit ${editing.name}` : "New API key"}
      description={editing ? "What it shows, its price and limits. The key itself stays the same." : "For one client's website. The key is shown once, when it is made."}
      footer={<div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save" : "Make key"}</Button>
      </div>}>
      <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ak-name">Name</Label>
            <Input id="ak-name" className="mt-1 rounded-xl" value={f.name} maxLength={80} placeholder="e.g. Acme Jewels — website"
              onChange={e => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <Label>Client</Label>
            <Select value={f.clientId || NO_CLIENT} onValueChange={v => {
              const c = clients.find(x => x.id === v);
              setF({ ...f, clientId: c?.id, clientName: c?.companyName, name: f.name || (c ? `${c.companyName} — website` : "") });
            }}>
              <SelectTrigger aria-label="Client" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>Not linked to a client</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName || c.ownerName || c.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ak-note">Note</Label>
            <Input id="ak-note" className="mt-1 rounded-xl" value={f.note ?? ""} maxLength={200} placeholder="Optional"
              onChange={e => setF({ ...f, note: e.target.value })} />
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-brand-dark">Pieces it shows</h3>
            <p className="text-xs text-muted-foreground">Only pieces in stock. Tick nothing in a row for all of them.</p>
          </div>
          <Chips label="Categories" all={keep(types, scope.types)} value={scope.types ?? []} onChange={v => setF({ ...f, scope: { ...scope, types: v } })} />
          <Chips label="Metals" all={keep(metals, scope.metals)} value={scope.metals ?? []} onChange={v => setF({ ...f, scope: { ...scope, metals: v } })} />
          <Chips label="Offices" all={keep(offices, scope.offices)} value={scope.offices ?? []} onChange={v => setF({ ...f, scope: { ...scope, offices: v } })} />
          {multiCo && <Chips label="Companies" all={companies.map(c => ({ value: c.id, label: c.name }))} value={scope.companies ?? []}
            onChange={v => setF({ ...f, scope: { ...scope, companies: v } })} />}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-brand-dark">Price</h3>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3.5 py-3">
            <span><span className="text-sm font-medium">Share prices</span>
              <span className="block text-xs text-muted-foreground">Off: every price is sent as null</span></span>
            <Switch checked={f.price.show} onCheckedChange={v => setF({ ...f, price: { ...f.price, show: v } })} aria-label="Share prices" />
          </label>
          {f.price.show && (
            <div className="grid gap-3 sm:grid-cols-2 items-end">
              <div>
                <Label htmlFor="ak-mk">Markup on our price (%)</Label>
                <Input id="ak-mk" type="number" inputMode="decimal" className="mt-1 rounded-xl" value={String(f.price.markupPct)} step="0.5"
                  onChange={e => setF({ ...f, price: { ...f.price, markupPct: Number(e.target.value) } })} />
              </div>
              <p className="text-xs text-muted-foreground pb-2">
                {f.price.markupPct ? `$1,000 shows as $${(1000 * (1 + (Number(f.price.markupPct) || 0) / 100)).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Our Ready Stock price, as it is"}
                {f.price.markupPct < 0 ? " (lower — a discount)" : ""}
              </p>
            </div>
          )}
        </section>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3.5 py-3">
          <span><span className="text-sm font-medium">Share 3D CAD files</span>
            <span className="block text-xs text-muted-foreground">Our own design files (.3dm), where a piece has one — off unless you choose</span></span>
          <Switch checked={f.share3d} onCheckedChange={v => setF({ ...f, share3d: v })} aria-label="Share 3D CAD files" />
        </label>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-brand-dark">Limits</h3>
            <p className="text-xs text-muted-foreground">Over a limit, calls are refused. Called on in a loop, the key is blocked for an hour; three blocks in a day pause it.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ak-pm">Calls a minute</Label>
              <Input id="ak-pm" type="number" inputMode="numeric" className="mt-1 rounded-xl" min={1} max={MAX_PER_MINUTE} value={String(f.limits.perMinute)}
                onChange={e => setF({ ...f, limits: { ...f.limits, perMinute: Number(e.target.value) } })} />
              <p className="text-[11px] text-muted-foreground mt-1">Usual: {DEFAULT_PER_MINUTE} · most {MAX_PER_MINUTE}</p>
            </div>
            <div>
              <Label htmlFor="ak-pd">Calls a day</Label>
              <Input id="ak-pd" type="number" inputMode="numeric" className="mt-1 rounded-xl" min={1} value={String(f.limits.perDay)}
                onChange={e => setF({ ...f, limits: { ...f.limits, perDay: Number(e.target.value) } })} />
              <p className="text-[11px] text-muted-foreground mt-1">Usual: {DEFAULT_PER_DAY.toLocaleString("en-IN")} · starts again 00:00 UTC</p>
            </div>
          </div>
        </section>

        <section>
          <Label htmlFor="ak-or">Websites it may be used from</Label>
          <Textarea id="ak-or" className="mt-1 rounded-xl font-mono text-sm" rows={3} value={origins} placeholder={"acmejewels.com\n*.acmejewels.com"}
            onChange={e => setOrigins(e.target.value)} />
          <p className="text-[11px] text-muted-foreground mt-1">
            One a line. Empty: any. A browser on any other website is refused; calls from the client's own server always work.
          </p>
        </section>
      </form>
    </ActionSheet>
  );
}
