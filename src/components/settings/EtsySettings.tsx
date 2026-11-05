import { brandShort } from "@/lib/brand";
// Settings → Etsy: the Etsy shops connected to our order board — connect one
// (its own Etsy app, approved by the shop owner on Etsy), map what its listings
// say onto our orders (the same rules as a Shopify store, with a preview on a
// real order), and see each shop's health. The app's secret and the shop's
// tokens stay on the server; everything here is done through it (lib/etsy.ts).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, Link2, Pause, Play, Plug, RefreshCw, Store, Unplug, Webhook } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { SectionTitle } from "@/components/SectionTitle";
import { CellTag } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabBar } from "@/components/PageHeader";
import { MappingFields } from "@/components/settings/ShopifySettings";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { timeAgo } from "@/lib/db";
import { companiesOf, hasCompanies } from "@/lib/companies";
import { rulesOf, type StoreRules } from "@/lib/shopify";
import { etsyInfo, shopAction, startShop, useEtsyJobProblems, useEtsyShops, type EtsyShop } from "@/lib/etsy";

const NONE = "__none__";

function StatusTag({ s }: { s: EtsyShop }) {
  if (s.status === "connected") return s.lastError ? <CellTag tone="amber">Needs a look</CellTag> : <CellTag tone="green">Connected</CellTag>;
  if (s.status === "paused") return <CellTag tone="amber">Paused</CellTag>;
  if (s.status === "error") return <CellTag tone="red">Not working</CellTag>;
  return <CellTag>Disconnected</CellTag>;
}

const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error("Couldn't copy — select it and copy by hand")); };

/** The addresses the shop's Etsy app needs, read from the server (they differ per app). */
function useEtsyUrls() {
  const [u, set] = useState<{ callbackUrl: string; webhookUrl: string } | null>(null);
  useEffect(() => { etsyInfo().then(set, () => set(null)); }, []);
  return u;
}

function CopyRow({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-white px-2.5 py-2 text-xs">{value ?? "Reading…"}</code>
        <Button size="sm" variant="outline" className="h-8 gap-1 shrink-0" disabled={!value} onClick={() => value && copy(value, label)}><Copy className="h-3.5 w-3.5" />Copy</Button>
      </div>
    </div>
  );
}

/* ─────────────── Connect ─────────────── */

function ConnectSheet({ open, onClose, again }: { open: boolean; onClose: () => void; again?: EtsyShop | null }) {
  const db = useDb();
  const urls = useEtsyUrls();
  const blank = { keystring: "", secret: "", name: "", clientId: "", companyId: "", handlerId: "", importDays: "0" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setLink(null);
    setF(again ? { ...blank, name: again.name, clientId: again.clientId, companyId: again.companyId ?? "", handlerId: again.handlerId ?? "" } : blank);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = [...db.clients].sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
  const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive");
  const multiCo = hasCompanies(db.settings);
  const go = async () => {
    if (!f.keystring.trim() || !f.secret.trim()) { toast.error("Paste the app's Keystring and Shared secret"); return; }
    if (!f.clientId) { toast.error("Choose the client this shop's orders are for"); return; }
    setBusy(true);
    try {
      const r = await startShop({ keystring: f.keystring.trim(), secret: f.secret.trim(), name: f.name || undefined, clientId: f.clientId,
        companyId: f.companyId || undefined, handlerId: f.handlerId || undefined, importDays: Number(f.importDays) || 0 });
      setLink(r.url);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} icon={Store} size="lg" title={again ? `Connect ${again.name} again` : "Connect an Etsy shop"}
      description="Its paid orders come onto our board; our shipment and tracking go back to it."
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{link ? "Done" : "Cancel"}</Button>
        {!link && <Button onClick={() => void go()} disabled={busy}>{busy ? "Making the link…" : "Make the approval link"}</Button>}</div>}>
      {link ? (
        <div className="space-y-4 text-sm">
          <p className="rounded-xl border border-success/30 bg-success/5 p-4">
            <CheckCircle2 className="h-4 w-4 inline mr-1 text-success" />The approval link is ready. <b>The shop owner</b> opens it, signs in to Etsy and presses <b>Grant access</b>.
            The shop then shows up here by itself. The link works <b>once</b>, for <b>two hours</b>.
          </p>
          <CopyRow label="Approval link" value={link} />
          <div className="flex flex-wrap gap-2">
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium"><ExternalLink className="h-4 w-4" />Open it (I'm the shop owner)</a>
          </div>
          <p className="text-xs text-muted-foreground">Sending it to a client? Copy it and share it on WhatsApp or email — they approve on their own phone or computer.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <ol className="space-y-2 text-sm rounded-xl border border-border bg-secondary/30 p-4 list-decimal pl-8">
            <li>Signed in to Etsy as the <b>shop owner</b>, go to <a className="text-primary underline" href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noreferrer">etsy.com/developers/your-apps</a> → <b>Create a new app</b>. Choose a <b>Seller app</b> (for your own shop — Etsy approves it quickly); name it e.g. “{brandShort()} orders”.</li>
            <li>In the app, add this <b>Callback URL</b> (Redirect URI) — exactly as it is:
              <div className="mt-2"><CopyRow label="Callback URL" value={urls?.callbackUrl} /></div></li>
            <li>Copy the app's <b>Keystring</b> and <b>Shared secret</b> here. The secret is kept encrypted on our server and never shown again.</li>
            <li>Press <b>Make the approval link</b> and open it as the shop owner (or send it to them).</li>
          </ol>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="et-key">Keystring</Label><Input id="et-key" className="mt-1 rounded-xl font-mono" autoComplete="off" value={f.keystring} onChange={e => setF({ ...f, keystring: e.target.value })} /></div>
            <div><Label htmlFor="et-sec">Shared secret</Label><Input id="et-sec" type="password" className="mt-1 rounded-xl font-mono" autoComplete="new-password" value={f.secret} onChange={e => setF({ ...f, secret: e.target.value })} /></div>
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
            <div><Label htmlFor="et-name">Name here (optional)</Label><Input id="et-name" className="mt-1 rounded-xl" placeholder="The shop's own name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div><Label>Orders already on the shop</Label>
              <Select value={f.importDays} onValueChange={v => setF({ ...f, importDays: v })}>
                <SelectTrigger aria-label="Bring in" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="0">Only new orders from now</SelectItem><SelectItem value="7">Also the last 7 days</SelectItem><SelectItem value="30">Also the last 30 days</SelectItem></SelectContent>
              </Select></div>
          </div>
        </div>
      )}
    </ActionSheet>
  );
}

/* ─────────────── One shop ─────────────── */

type Preview = { order: { name: string; financialStatus?: string; currency: string; cancelled: boolean }; problem: string | null;
  lines: { title: string; variant?: string | null; sku?: string | null; options: { name: string; value: string }[]; image?: string | null;
    mapped: { jewelleryType: string; metal: string; productKarats?: string; productSize?: string; diamondType: string; designNumber?: string; quantity: number; amount: number; instructions: string; review: string[] } }[] };

function ShopSheet({ shop, onClose, onReconnect }: { shop: EtsyShop | null; onClose: () => void; onReconnect: (s: EtsyShop) => void }) {
  const db = useDb();
  const { user } = useAuth();
  const urls = useEtsyUrls();
  const [tab, setTab] = useState<"mapping" | "health" | "connection">("mapping");
  const [rules, setRules] = useState<Required<StoreRules>>(rulesOf() as Required<StoreRules>);
  const [meta, setMeta] = useState({ name: "", clientId: "", companyId: "", handlerId: "" });
  const [busy, setBusy] = useState("");
  const [receipt, setReceipt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [whsec, setWhsec] = useState("");
  const problems = useEtsyJobProblems(user?.role === "admin").filter(j => j.storeId === shop?.id);
  useEffect(() => {
    if (!shop) return;
    setRules(rulesOf(shop.rules) as Required<StoreRules>);
    setMeta({ name: shop.name, clientId: shop.clientId, companyId: shop.companyId ?? "", handlerId: shop.handlerId ?? "" });
    setPreview(null); setTab("mapping"); setWhsec(""); setReceipt("");
  }, [shop?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shop) return null;
  const clients = [...db.clients].sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
  const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee") && u.status !== "inactive");
  const multiCo = hasCompanies(db.settings);
  const run = async <T,>(label: string, f: () => Promise<T>, ok?: (r: T) => string | void) => {
    setBusy(label);
    try { const r = await f(); const msg = ok?.(r); if (msg) toast.success(msg); return r; }
    catch (e) { toast.error((e as Error).message); return undefined; }
    finally { setBusy(""); }
  };
  const num = receipt.replace(/^#/, "").trim();
  const save = () => run("save", () => shopAction("save", shop.id, { ...meta, companyId: meta.companyId || null, handlerId: meta.handlerId || null, rules }), () => "Saved — the next orders follow these rules");
  const doPreview = () => run("preview", () => shopAction<Preview>("preview", shop.id, { receipt: num, rules }), r => { setPreview(r); });

  return (
    <ActionSheet open={!!shop} onOpenChange={o => { if (!o) onClose(); }} icon={Store} size="xl" title={shop.name}
      description={<span className="inline-flex flex-wrap items-center gap-2"><StatusTag s={shop} /> <span className="text-xs">Etsy shop {shop.shopId}</span> · {shop.currency}</span>}
      footer={tab === "mapping" ? <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => void save()} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</Button></div> : undefined}>
      <TabBar label="Shop" value={tab} onChange={setTab} tabs={[{ key: "mapping", label: "Mapping" }, { key: "health", label: "Health" }, { key: "connection", label: "Connection" }]} />
      {tab === "mapping" && (
        <div className="space-y-7 mt-5">
          <section className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="es-name">Name</Label><Input id="es-name" className="mt-1 rounded-xl" value={meta.name} onChange={e => setMeta({ ...meta, name: e.target.value })} /></div>
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
            <div><Label htmlFor="es-lead">Due in (days)</Label><Input id="es-lead" type="number" className="mt-1 rounded-xl" value={String(rules.leadDays)} onChange={e => setRules({ ...rules, leadDays: Number(e.target.value) })} /></div>
          </section>
          <p className="text-xs text-muted-foreground -mt-3">Only paid orders come in (Etsy collects the payment first). Digital items are left out.</p>

          <MappingFields rules={rules} setRules={setRules} source="Etsy" />

          <section className="space-y-3 rounded-xl border border-border p-4">
            <SectionTitle title="Try it on a real order" sub="These rules (saved or not), on one of the shop's orders — nothing is brought in" icon={Eye} />
            <div className="flex flex-wrap gap-2">
              <Input className="w-56 rounded-xl" placeholder="Etsy order no. (or empty: latest)" value={receipt} onChange={e => setReceipt(e.target.value)} />
              <Button variant="outline" onClick={() => void doPreview()} disabled={!!busy}>{busy === "preview" ? "Reading…" : "Preview"}</Button>
            </div>
            {preview && (
              <div className="space-y-2">
                <p className="text-sm"><b>{preview.order.name}</b> · {preview.order.financialStatus?.toLowerCase()} · {preview.order.currency}
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
            <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Last order seen</p><p className="font-semibold">{timeAgo(shop.lastEventAt)}</p>
              <p className="text-xs text-muted-foreground">{shop.webhooks ? "Etsy's messages on" : "No messages — the 5-minute check"}</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Last check (every 5 min)</p><p className="font-semibold">{timeAgo(shop.lastSyncAt)}</p>{shop.lastSyncCount !== undefined && <p className="text-xs text-muted-foreground">{shop.lastSyncCount} order{shop.lastSyncCount === 1 ? "" : "s"} changed</p>}</div>
            <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Shipments needing a look</p><p className={`font-semibold ${problems.length ? "text-destructive" : "text-success"}`}>{problems.length || "None"}</p></div>
          </div>
          {shop.lastError && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900"><AlertTriangle className="h-4 w-4 inline mr-1" />{shop.lastError}</p>}
          {problems.map(j => (
            <p key={j.id} className="rounded-lg border border-border p-2.5 text-xs">Shipment for Etsy #{j.receiptId} (order {db.orders.find(o => o.id === j.orderId)?.orderNumber ?? j.orderId}) — {j.status === "failed" ? "not sent" : `trying again ${timeAgo(j.nextAt).replace(" ago", "")}`}: {j.error}</p>
          ))}
          {problems.length > 0 && (
            <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void run("retry", () => shopAction<{ count: number }>("retryShipments", shop.id), r => `Trying ${r.count} shipment${r.count === 1 ? "" : "s"} again now`)}>
              <RefreshCw className="h-4 w-4" />{busy === "retry" ? "Starting…" : "Try these shipments again now"}</Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void run("sync", () => shopAction<{ checked: number; created: string[]; more?: boolean }>("syncNow", shop.id, { days: 7 }), r => `Checked ${r.checked} order${r.checked === 1 ? "" : "s"} from the last 7 days${r.created.length ? ` — brought in ${r.created.join(", ")}` : " — nothing new"}${r.more ? ". More changed than one check reads — the rest carries on in the background" : ""}`)}>
              <RefreshCw className="h-4 w-4" />{busy === "sync" ? "Checking…" : "Check the last 7 days now"}</Button>
            <div className="flex gap-2">
              <Input className="w-44 rounded-xl" placeholder="Etsy order no." value={receipt} onChange={e => setReceipt(e.target.value)} />
              <Button variant="outline" disabled={!!busy || !num} onClick={() => void run("import", () => shopAction<{ created: string[]; skipped?: string }>("importOrder", shop.id, { receipt: num }), r => r.created.length ? `Brought in: ${r.created.join(", ")}` : `Nothing new${r.skipped ? ` — ${r.skipped}` : " — it is on the board already"}`)}>
                {busy === "import" ? "Bringing in…" : "Bring in this order"}</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "connection" && (
        <div className="space-y-5 mt-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" disabled={!!busy || shop.status === "disconnected"} onClick={() => void run("test", () => shopAction<{ ms: number; name: string }>("test", shop.id), r => `Working — ${r.name} answered in ${r.ms} ms`)}>
              <CheckCircle2 className="h-4 w-4" />{busy === "test" ? "Testing…" : "Test the connection"}</Button>
            {shop.status === "paused"
              ? <Button variant="outline" className="gap-1.5" onClick={() => void run("p", () => shopAction("resume", shop.id), () => "Running again — orders come in")}><Play className="h-4 w-4" />Resume</Button>
              : shop.status !== "disconnected" && <Button variant="outline" className="gap-1.5" onClick={() => void run("p", () => shopAction("pause", shop.id), () => "Paused — no new orders come in, nothing is sent")}><Pause className="h-4 w-4" />Pause</Button>}
            <Button variant="outline" className="gap-1.5" onClick={() => onReconnect(shop)}><Link2 className="h-4 w-4" />Connect again (new approval or keys)</Button>
            {shop.url && <a className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm" href={shop.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open the shop</a>}
          </div>
          <div className="rounded-xl border border-border p-4 space-y-3">
            <SectionTitle title="Etsy's order messages (optional)" sub="Orders arrive in seconds instead of within 5 minutes" icon={Webhook} />
            <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
              <li>In the shop's app on <a className="text-primary underline" href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noreferrer">etsy.com/developers</a> open <b>Webhooks</b> and add this endpoint, for the order events (paid, canceled, shipped):</li>
            </ol>
            <CopyRow label="Webhook endpoint" value={urls?.webhookUrl} />
            <p className="text-xs text-muted-foreground">2. Copy the endpoint's <b>signing secret</b> (starts with whsec_) here. Every message is checked against it.</p>
            <div className="flex flex-wrap gap-2">
              <Input type="password" className="w-72 rounded-xl font-mono" placeholder={shop.webhooks ? "Saved — paste a new one to replace" : "whsec_…"} autoComplete="new-password" value={whsec} onChange={e => setWhsec(e.target.value)} />
              <Button variant="outline" disabled={!!busy || !whsec.trim()} onClick={() => void run("wh", () => shopAction("webhookSecret", shop.id, { webhookSecret: whsec.trim() }), () => { setWhsec(""); return "Signing secret saved — Etsy's messages are on"; })}>Save</Button>
              {shop.webhooks && <Button variant="ghost" disabled={!!busy} onClick={() => void run("wh", () => shopAction("webhookSecret", shop.id, { webhookSecret: "" }), () => "Messages off — the 5-minute check carries on")}>Turn off</Button>}
            </div>
          </div>
          {shop.status !== "disconnected" && (
            <Button variant="outline" className="gap-1.5 text-destructive" onClick={async () => {
              if (!(await confirmBox(`Disconnect ${shop.name}?\n\nNo more orders come in and nothing is sent to it. Its keys and Etsy's approval are deleted from our server. Orders already on our board stay as they are.`, { danger: true, confirmText: "Disconnect" }))) return;
              await run("d", () => shopAction("disconnect", shop.id), () => "Disconnected");
              onClose();
            }}><Unplug className="h-4 w-4" />Disconnect</Button>
          )}
        </div>
      )}
    </ActionSheet>
  );
}

/* ─────────────── The section ─────────────── */

export function EtsySettings() {
  const db = useDb();
  const { user } = useAuth();
  const shops = useEtsyShops();
  const [connecting, setConnecting] = useState<{ again: EtsyShop | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useMemo(() => shops.rows.find(s => s.id === openId) ?? null, [shops.rows, openId]);
  const shown = [...shops.rows].sort((a, b) => (a.status === "disconnected" ? 1 : 0) - (b.status === "disconnected" ? 1 : 0) || a.name.localeCompare(b.name));
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of db.orders) if (o.etsy && !o.deletedAt) m.set(o.etsy.storeId, (m.get(o.etsy.storeId) ?? 0) + 1);
    return m;
  }, [db.orders]);
  if (user?.role !== "admin") return <p className="text-sm text-muted-foreground">Only an admin can connect Etsy shops.</p>;
  return (
    // In a card, as every other Settings section.
    <div className="card-luxe p-6 space-y-5">
      <SectionTitle title="Etsy shops" sub="Their paid orders come onto our board; our shipment and tracking go back"
        info="Each shop is connected with its own Etsy app, approved by the shop owner on Etsy (OAuth with PKCE). Its secret and tokens are kept encrypted on our server. Every 5 minutes the server checks each shop for new or changed orders; Etsy's order messages make it near-instant. Once every piece of an Etsy order is dispatched, one shipment with the tracking goes to Etsy, and Etsy emails the buyer."
        icon={Store} actions={<Button className="gap-1.5" onClick={() => setConnecting({ again: null })}><Plug className="h-4 w-4" />Connect a shop</Button>} />
      {shops.error && <p className="text-sm text-destructive">Shops could not be read ({shops.error}).</p>}
      {!shops.loading && !shown.length && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Etsy shop connected yet. Connect your own shop or a client's — each with its own Etsy app.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map(s => (
          <button key={s.id} type="button" onClick={() => setOpenId(s.id)} className={`text-left rounded-2xl border border-border bg-white p-4 hover:border-primary/40 transition-colors ${s.status === "disconnected" ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#F1641E]/12 text-[#D5581A] grid place-items-center shrink-0"><Store className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-brand-dark truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">Etsy shop {s.shopId}{s.country ? ` · ${s.country}` : ""}</p>
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
      <ConnectSheet open={!!connecting} again={connecting?.again} onClose={() => setConnecting(null)} />
      <ShopSheet shop={open} onClose={() => setOpenId(null)} onReconnect={s => { setOpenId(null); setConnecting({ again: s }); }} />
    </div>
  );
}
