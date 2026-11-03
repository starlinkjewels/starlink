// Settings → Shopify: the stores connected to our order board — connect one
// (its own app's keys), map what its products say onto our orders (with a
// preview on a real order), and see each store's health. The keys stay on the
// server; everything here is done through it (lib/shopify.ts).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Eye, Link2, Pause, Play, Plug, RefreshCw, ShoppingBag, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { SectionTitle } from "@/components/SectionTitle";
import { CellTag } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabBar } from "@/components/PageHeader";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { timeAgo } from "@/lib/db";
import { listOf } from "@/lib/optionLists";
import { companiesOf, hasCompanies } from "@/lib/companies";
import {
  connectStore, NEEDED_SCOPES, rulesOf, storeAction, useShopifyJobProblems, useShopifyStores,
  type ShopifyStore, type StoreRules,
} from "@/lib/shopify";

const NONE = "__none__";

function StatusTag({ s }: { s: ShopifyStore }) {
  if (s.status === "connected") return s.lastError ? <CellTag tone="amber">Needs a look</CellTag> : <CellTag tone="green">Connected</CellTag>;
  if (s.status === "paused") return <CellTag tone="amber">Paused</CellTag>;
  if (s.status === "error") return <CellTag tone="red">Not working</CellTag>;
  return <CellTag>Disconnected</CellTag>;
}

const list = (v?: string[]) => (v ?? []).join(", ");
const unlist = (v: string) => v.split(",").map(s => s.trim()).filter(Boolean);

/* ─────────────── Connect ─────────────── */

function ConnectSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const db = useDb();
  const [f, setF] = useState({ shop: "", appClientId: "", appSecret: "", name: "", clientId: "", companyId: "", handlerId: "", importDays: "0" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ shop: "", appClientId: "", appSecret: "", name: "", clientId: "", companyId: "", handlerId: "", importDays: "0" }); }, [open]);
  const clients = [...db.clients].sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
  const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive");
  const multiCo = hasCompanies(db.settings);
  const go = async () => {
    if (!f.shop.trim() || !f.appClientId.trim() || !f.appSecret.trim()) { toast.error("Fill in the store address, Client ID and Client secret"); return; }
    if (!f.clientId) { toast.error("Choose the client this store's orders are for"); return; }
    setBusy(true);
    try {
      const r = await connectStore({ shop: f.shop, appClientId: f.appClientId, appSecret: f.appSecret, name: f.name || undefined, clientId: f.clientId,
        companyId: f.companyId || undefined, handlerId: f.handlerId || undefined, importDays: Number(f.importDays) || 0 });
      toast.success(`${r.name} is connected — its new orders come onto the board`);
      onClose(); onDone(r.storeId);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} icon={ShoppingBag} size="lg" title="Connect a Shopify store"
      description="Its orders come onto our board; our dispatches and stages go back to it."
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void go()} disabled={busy}>{busy ? "Checking…" : "Connect"}</Button></div>}>
      <div className="space-y-6">
        <ol className="space-y-2 text-sm rounded-xl border border-border bg-secondary/30 p-4 list-decimal pl-8">
          <li>In the store's Shopify admin: <b>Settings → Apps and sales channels → Develop apps → Build apps in Dev Dashboard</b> (the store owner, or staff with “Develop apps”).</li>
          <li><b>Create app</b>, name it (e.g. “Starlink orders”). In <b>Versions</b> tick these access scopes: <code className="text-xs">{NEEDED_SCOPES.join(", ")}</code>. Under protected customer data allow <b>name and address</b> (for the ship-to). Release the version.</li>
          <li><b>Install</b> the app on this store (the Home / Installs card).</li>
          <li>Open the app's <b>Settings</b> and copy its <b>Client ID</b> and <b>Client secret</b> here. The secret is kept encrypted on our server and never shown again.</li>
        </ol>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="sh-shop">Store address</Label>
            <Input id="sh-shop" className="mt-1 rounded-xl" placeholder="acme-jewels.myshopify.com" value={f.shop} onChange={e => setF({ ...f, shop: e.target.value })} /></div>
          <div><Label htmlFor="sh-cid">Client ID</Label><Input id="sh-cid" className="mt-1 rounded-xl font-mono" autoComplete="off" value={f.appClientId} onChange={e => setF({ ...f, appClientId: e.target.value })} /></div>
          <div><Label htmlFor="sh-sec">Client secret</Label><Input id="sh-sec" type="password" className="mt-1 rounded-xl font-mono" autoComplete="new-password" value={f.appSecret} onChange={e => setF({ ...f, appSecret: e.target.value })} /></div>
          <div><Label>Its orders are for</Label>
            <Select value={f.clientId || NONE} onValueChange={v => setF({ ...f, clientId: v === NONE ? "" : v })}>
              <SelectTrigger aria-label="Client" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Choose a client…</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName || c.ownerName}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label>Who has its orders</Label>
            <Select value={f.handlerId || NONE} onValueChange={v => setF({ ...f, handlerId: v === NONE ? "" : v })}>
              <SelectTrigger aria-label="Handler" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>The client's account manager</SelectItem>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
            </Select></div>
          {multiCo && <div><Label>Company</Label>
            <Select value={f.companyId || NONE} onValueChange={v => setF({ ...f, companyId: v === NONE ? "" : v })}>
              <SelectTrigger aria-label="Company" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>The client's company</SelectItem>{companiesOf(db.settings).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select></div>}
          <div><Label htmlFor="sh-name">Name here (optional)</Label><Input id="sh-name" className="mt-1 rounded-xl" placeholder="The store's own name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
          <div><Label>Orders already on the store</Label>
            <Select value={f.importDays} onValueChange={v => setF({ ...f, importDays: v })}>
              <SelectTrigger aria-label="Bring in" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="0">Only new orders from now</SelectItem><SelectItem value="7">Also the last 7 days</SelectItem><SelectItem value="30">Also the last 30 days</SelectItem></SelectContent>
            </Select></div>
        </div>
      </div>
    </ActionSheet>
  );
}

/* ─────────────── One store ─────────────── */

type Preview = { order: { name: string; financialStatus?: string; currency: string; test: boolean; cancelled: boolean }; problem: string | null;
  lines: { title: string; variant?: string | null; sku?: string | null; options: { name: string; value: string }[]; image?: string | null;
    mapped: { jewelleryType: string; metal: string; productKarats?: string; productSize?: string; diamondType: string; designNumber?: string; quantity: number; amount: number; instructions: string; review: string[] } }[] };

function RulePairs<K extends "type" | "metal">({ label, k, rows, options, onChange }: { label: string; k: K; rows: ({ word: string } & Record<K, string>)[]; options: string[]; onChange: (r: ({ word: string } & Record<K, string>)[]) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="h-9 rounded-lg" value={r.word} placeholder="word" onChange={e => onChange(rows.map((x, j) => (j === i ? { ...x, word: e.target.value } : x)))} />
            <span className="text-muted-foreground text-xs">→</span>
            <Select value={options.includes(r[k]) ? r[k] : NONE} onValueChange={v => onChange(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)))}>
              <SelectTrigger className="h-9 rounded-lg"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => onChange([...rows, { word: "", [k]: options[0] ?? "" } as { word: string } & Record<K, string>])}>Add a word</Button>
      </div>
    </div>
  );
}

function StoreSheet({ store, onClose }: { store: ShopifyStore | null; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const [tab, setTab] = useState<"mapping" | "health" | "connection">("mapping");
  const [rules, setRules] = useState<Required<StoreRules>>(rulesOf() as Required<StoreRules>);
  const [meta, setMeta] = useState({ name: "", clientId: "", companyId: "", handlerId: "" });
  const [busy, setBusy] = useState("");
  const [orderName, setOrderName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [keys, setKeys] = useState({ appClientId: "", appSecret: "" });
  const problems = useShopifyJobProblems(user?.role === "admin").filter(j => j.storeId === store?.id);
  useEffect(() => {
    if (!store) return;
    setRules(rulesOf(store.rules) as Required<StoreRules>);
    setMeta({ name: store.name, clientId: store.clientId, companyId: store.companyId ?? "", handlerId: store.handlerId ?? "" });
    setPreview(null); setTab("mapping"); setKeys({ appClientId: "", appSecret: "" });
  }, [store?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!store) return null;
  const types = listOf("jewelleryTypes", db.settings), metals = listOf("metals", db.settings);
  const clients = [...db.clients].sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
  const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive");
  const multiCo = hasCompanies(db.settings);
  const run = async <T,>(label: string, f: () => Promise<T>, ok?: (r: T) => string | void) => {
    setBusy(label);
    try { const r = await f(); const msg = ok?.(r); if (msg) toast.success(msg); return r; }
    catch (e) { toast.error((e as Error).message); return undefined; }
    finally { setBusy(""); }
  };
  const save = () => run("save", () => storeAction("save", store.id, { ...meta, companyId: meta.companyId || null, handlerId: meta.handlerId || null, rules }), () => "Saved — the next orders follow these rules");
  const doPreview = () => run("preview", () => storeAction<Preview>("preview", store.id, { orderName, rules }), r => { setPreview(r); });

  return (
    <ActionSheet open={!!store} onOpenChange={o => { if (!o) onClose(); }} icon={ShoppingBag} size="xl" title={store.name}
      description={<span className="inline-flex flex-wrap items-center gap-2"><StatusTag s={store} /> <span className="font-mono text-xs">{store.shop}</span> · {store.currency}</span>}
      footer={tab === "mapping" ? <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => void save()} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</Button></div> : undefined}>
      <TabBar label="Store" value={tab} onChange={setTab} tabs={[{ key: "mapping", label: "Mapping" }, { key: "health", label: "Health" }, { key: "connection", label: "Connection" }]} />
      {tab === "mapping" && (
        <div className="space-y-7 mt-5">
          <section className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="st-name">Name</Label><Input id="st-name" className="mt-1 rounded-xl" value={meta.name} onChange={e => setMeta({ ...meta, name: e.target.value })} /></div>
            <div><Label>Its orders are for</Label>
              <Select value={meta.clientId || NONE} onValueChange={v => setMeta({ ...meta, clientId: v === NONE ? "" : v })}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName || c.ownerName}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Who has its orders</Label>
              <Select value={meta.handlerId || NONE} onValueChange={v => setMeta({ ...meta, handlerId: v === NONE ? "" : v })}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>The client's account manager</SelectItem>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select></div>
            {multiCo && <div><Label>Company</Label>
              <Select value={meta.companyId || NONE} onValueChange={v => setMeta({ ...meta, companyId: v === NONE ? "" : v })}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>The client's company</SelectItem>{companiesOf(db.settings).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select></div>}
          </section>

          <section className="space-y-3">
            <SectionTitle title="Which orders come in" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Bring an order in</Label>
                <Select value={rules.importWhen} onValueChange={v => setRules({ ...rules, importWhen: v as "paid" | "any" })}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="paid">When it is paid (or authorised)</SelectItem><SelectItem value="any">As soon as it is placed</SelectItem></SelectContent>
                </Select></div>
              <div><Label htmlFor="st-lead">Due in (days)</Label><Input id="st-lead" type="number" className="mt-1 rounded-xl" value={String(rules.leadDays)} onChange={e => setRules({ ...rules, leadDays: Number(e.target.value) })} /></div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3.5 py-3 text-sm">
              <span>Test orders too <span className="block text-xs text-muted-foreground">Shopify's test orders (Bogus Gateway) — for trying the connection</span></span>
              <Switch checked={rules.importTest} onCheckedChange={v => setRules({ ...rules, importTest: v })} /></label>
          </section>

          <section className="space-y-3">
            <SectionTitle title="Price on our order" sub="Shopify's price is the customer's; ours is the client's" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={rules.priceMode} onValueChange={v => setRules({ ...rules, priceMode: v as "approval" | "percent" })}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="approval">Set at approval (recommended)</SelectItem><SelectItem value="percent">A share of the Shopify price</SelectItem></SelectContent>
              </Select>
              {rules.priceMode === "percent" && <div className="flex items-center gap-2"><Input type="number" className="rounded-xl" value={String(rules.pricePct ?? "")} onChange={e => setRules({ ...rules, pricePct: Number(e.target.value) })} /><span className="text-sm text-muted-foreground shrink-0">% of the price (USD stores)</span></div>}
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle title="What its products say" sub="The option names this store uses, and the words that tell the type and metal" />
            <div className="grid gap-3 sm:grid-cols-2">
              {([["metalOptions", "Metal option names"], ["karatOptions", "Karat option names"], ["sizeOptions", "Size option names"], ["stoneOptions", "Stone option names"]] as const).map(([k, l]) => (
                <div key={k}><Label>{l}</Label><Input className="mt-1 rounded-xl" value={list(rules[k])} onChange={e => setRules({ ...rules, [k]: unlist(e.target.value) })} /></div>
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <RulePairs label="Words → jewellery type" k="type" rows={rules.typeRules} options={types} onChange={r => setRules({ ...rules, typeRules: r })} />
              <RulePairs label="Words → metal" k="metal" rows={rules.metalRules} options={metals} onChange={r => setRules({ ...rules, metalRules: r })} />
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle title="Back to Shopify" />
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3.5 py-3 text-sm">
              <span>Show our stage as a tag <span className="block text-xs text-muted-foreground">“{rules.tagPrefix}: In Production” on the Shopify order</span></span>
              <Switch checked={rules.stageTags} onCheckedChange={v => setRules({ ...rules, stageTags: v })} /></label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3.5 py-3 text-sm">
              <span>Email the customer when we ship <span className="block text-xs text-muted-foreground">Shopify's shipping email, with the tracking</span></span>
              <Switch checked={rules.notifyCustomer} onCheckedChange={v => setRules({ ...rules, notifyCustomer: v })} /></label>
          </section>

          <section className="space-y-3 rounded-xl border border-border p-4">
            <SectionTitle title="Try it on a real order" sub="These rules (saved or not), on one of the store's orders — nothing is brought in" icon={Eye} />
            <div className="flex flex-wrap gap-2">
              <Input className="w-40 rounded-xl" placeholder="#1001 (or empty: latest)" value={orderName} onChange={e => setOrderName(e.target.value)} />
              <Button variant="outline" onClick={() => void doPreview()} disabled={!!busy}>{busy === "preview" ? "Reading…" : "Preview"}</Button>
            </div>
            {preview && (
              <div className="space-y-2">
                <p className="text-sm"><b>{preview.order.name}</b> · {preview.order.financialStatus?.toLowerCase().replace(/_/g, " ")} · {preview.order.currency}{preview.order.test ? " · test" : ""}
                  {preview.problem ? <span className="text-amber-700"> — wouldn't come in: {preview.problem}</span> : <span className="text-success"> — would come in</span>}</p>
                {preview.lines.map((l, i) => (
                  <div key={i} className="rounded-xl border border-border bg-white p-3 text-sm grid gap-1 sm:grid-cols-[1fr_1fr]">
                    <div><p className="font-medium">{l.title}</p><p className="text-xs text-muted-foreground">{l.variant} {l.sku ? `· ${l.sku}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{l.options.map(o => `${o.name}: ${o.value}`).join(" · ")}</p></div>
                    <div className="text-xs space-y-0.5">
                      {([["Type", l.mapped.jewelleryType, "type"], ["Metal", l.mapped.metal, "metal"], ["Karat", l.mapped.productKarats ?? "—", "karat"], ["Size", l.mapped.productSize ?? "—", ""],
                        ["Stone", l.mapped.diamondType || "—", ""], ["Design no.", l.mapped.designNumber ?? "—", ""], ["Qty", String(l.mapped.quantity), ""], ["Price", l.mapped.amount ? `$${l.mapped.amount}` : "at approval", "price"]] as const).map(([k, v, r]) => (
                        <p key={k}><span className="text-muted-foreground">{k}:</span> <b className={r && l.mapped.review.includes(r) ? "text-amber-700" : ""}>{v}</b>{r && l.mapped.review.includes(r) ? " (check)" : ""}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "health" && (
        <div className="space-y-4 mt-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Last message</p><p className="font-semibold">{timeAgo(store.lastEventAt)}</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Last check (every 15 min)</p><p className="font-semibold">{timeAgo(store.lastSyncAt)}</p>{store.lastSyncCount !== undefined && <p className="text-xs text-muted-foreground">{store.lastSyncCount} order{store.lastSyncCount === 1 ? "" : "s"} changed</p>}</div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Sends to Shopify needing a look</p><p className={`font-semibold ${problems.length ? "text-destructive" : "text-success"}`}>{problems.length || "None"}</p></div>
          </div>
          {store.lastError && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900"><AlertTriangle className="h-4 w-4 inline mr-1" />{store.lastError}</p>}
          {problems.map(j => (
            <p key={j.id} className="rounded-lg border border-border p-2.5 text-xs">{j.kind === "fulfil" ? "Fulfilment" : `Stage tag (${j.stage})`} for order {db.orders.find(o => o.id === j.orderId)?.orderNumber ?? j.orderId} — {j.status === "failed" ? "gave up after 12 tries" : `trying again ${timeAgo(j.nextAt).replace(" ago", "")}`}: {j.error}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void run("sync", () => storeAction<{ checked: number; created: string[] }>("syncNow", store.id, { days: 7 }), r => `Checked ${r.checked} order${r.checked === 1 ? "" : "s"} from the last 7 days${r.created.length ? ` — brought in ${r.created.join(", ")}` : " — nothing new"}`)}>
              <RefreshCw className="h-4 w-4" />{busy === "sync" ? "Checking…" : "Check the last 7 days now"}</Button>
            <div className="flex gap-2">
              <Input className="w-32 rounded-xl" placeholder="#1001" value={orderName} onChange={e => setOrderName(e.target.value)} />
              <Button variant="outline" disabled={!!busy || !orderName.trim()} onClick={() => void run("import", () => storeAction<{ created: string[]; skipped?: string }>("importOrder", store.id, { orderName }), r => r.created.length ? `Brought in: ${r.created.join(", ")}` : `Nothing new${r.skipped ? ` — ${r.skipped}` : " — it is on the board already"}`)}>
                {busy === "import" ? "Bringing in…" : "Bring in this order"}</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "connection" && (
        <div className="space-y-5 mt-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void run("test", () => storeAction<{ ms: number; name: string; missing: string[]; webhooksAdded: string[] }>("test", store.id), r => r.missing.length ? `Connected, but the app is missing: ${r.missing.join(", ")}` : `Working — ${r.name} answered in ${r.ms} ms${r.webhooksAdded.length ? `; messages set up again: ${r.webhooksAdded.join(", ")}` : ""}`)}>
              <CheckCircle2 className="h-4 w-4" />{busy === "test" ? "Testing…" : "Test the connection"}</Button>
            {store.status === "paused"
              ? <Button variant="outline" className="gap-1.5" onClick={() => void run("p", () => storeAction("resume", store.id), () => "Running again — orders come in")}><Play className="h-4 w-4" />Resume</Button>
              : store.status !== "disconnected" && <Button variant="outline" className="gap-1.5" onClick={() => void run("p", () => storeAction("pause", store.id), () => "Paused — no new orders come in, nothing is sent")}><Pause className="h-4 w-4" />Pause</Button>}
            <a className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm" href={`https://admin.shopify.com/store/${store.shop.replace(/\.myshopify\.com$/, "")}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open the store's admin</a>
          </div>
          <div className="rounded-xl border border-border p-4 space-y-3">
            <SectionTitle title="New keys" sub="When the app's secret was rotated, or the store is connected again" icon={Link2} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input className="rounded-xl font-mono" placeholder="Client ID" autoComplete="off" value={keys.appClientId} onChange={e => setKeys({ ...keys, appClientId: e.target.value })} />
              <Input type="password" className="rounded-xl font-mono" placeholder="Client secret" autoComplete="new-password" value={keys.appSecret} onChange={e => setKeys({ ...keys, appSecret: e.target.value })} />
            </div>
            <Button variant="outline" disabled={!!busy || !keys.appClientId || !keys.appSecret} onClick={() => void run("keys", () => storeAction("credentials", store.id, keys), () => "New keys saved and checked")}>{busy === "keys" ? "Checking…" : "Save new keys"}</Button>
          </div>
          {store.status !== "disconnected" && (
            <Button variant="outline" className="gap-1.5 text-destructive" onClick={async () => {
              if (!(await confirmBox(`Disconnect ${store.name}?\n\nNo more orders come in and nothing is sent to it. Its keys are deleted from our server. Orders already on our board stay as they are.`, { danger: true, confirmText: "Disconnect" }))) return;
              await run("d", () => storeAction("disconnect", store.id), () => "Disconnected");
              onClose();
            }}><Unplug className="h-4 w-4" />Disconnect</Button>
          )}
        </div>
      )}
    </ActionSheet>
  );
}

/* ─────────────── The section ─────────────── */

export function ShopifySettings() {
  const db = useDb();
  const { user } = useAuth();
  const stores = useShopifyStores();
  const [connecting, setConnecting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useMemo(() => stores.rows.find(s => s.id === openId) ?? null, [stores.rows, openId]);
  const shown = [...stores.rows].sort((a, b) => (a.status === "disconnected" ? 1 : 0) - (b.status === "disconnected" ? 1 : 0) || a.name.localeCompare(b.name));
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of db.orders) if (o.shopify && !o.deletedAt) m.set(o.shopify.storeId, (m.get(o.shopify.storeId) ?? 0) + 1);
    return m;
  }, [db.orders]);
  if (user?.role !== "admin") return <p className="text-sm text-muted-foreground">Only an admin can connect Shopify stores.</p>;
  return (
    <div className="space-y-5">
      <SectionTitle title="Shopify stores" sub="Their orders come onto our board; our dispatches and stages go back"
        info="Each store is connected with its own app (made in its Shopify Dev Dashboard). Orders are checked with Shopify's signature and brought in once; every 15 minutes the server also checks for anything missed."
        icon={ShoppingBag} actions={<Button className="gap-1.5" onClick={() => setConnecting(true)}><Plug className="h-4 w-4" />Connect a store</Button>} />
      {stores.error && <p className="text-sm text-destructive">Stores could not be read ({stores.error}).</p>}
      {!stores.loading && !shown.length && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No store connected yet. Connect your own store or a client's — each with its own app's keys.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map(s => (
          <button key={s.id} type="button" onClick={() => setOpenId(s.id)} className={`text-left rounded-2xl border border-border bg-white p-4 hover:border-primary/40 transition-colors ${s.status === "disconnected" ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#95BF47]/15 text-[#5E8E3E] grid place-items-center shrink-0"><ShoppingBag className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-brand-dark truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">{s.shop}</p>
              </div>
              <StatusTag s={s} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><p className="text-muted-foreground">For</p><p className="font-medium truncate">{db.clients.find(c => c.id === s.clientId)?.companyName ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Orders here</p><p className="font-medium">{counts.get(s.id) ?? 0}</p></div>
              <div><p className="text-muted-foreground">Last check</p><p className="font-medium">{timeAgo(s.lastSyncAt)}</p></div>
            </div>
            {s.lastError && <p className="mt-2 text-xs text-amber-700 line-clamp-2">{s.lastError}</p>}
          </button>
        ))}
      </div>
      <ConnectSheet open={connecting} onClose={() => setConnecting(false)} onDone={id => setOpenId(id)} />
      <StoreSheet store={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
