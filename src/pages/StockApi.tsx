// API — our Ready Stock for B2B clients' websites: the keys (made, changed,
// paused, replaced, deleted), the health board (who called, from where, on
// what, how fast, what was refused) and the documentation. Admins only.
// The API itself: functions-api/. Its records: lib/apiKeysModel.ts.
import { useMemo, useState } from "react";
import { Activity, Ban, BookOpen, Copy, Download, FileCode2, FileText, Globe, History, KeyRound, Pause, Pencil, Play, Plus, RefreshCw, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { SectionTitle } from "@/components/SectionTitle";
import type { MoreAction } from "@/components/MoreMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { KeyForm } from "@/components/stockApi/KeyForm";
import { BarList, UsageBoard } from "@/components/stockApi/UsageBoard";
import { copyText, DocsPanel, downloadDocs } from "@/components/stockApi/DocsPanel";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { useUrlState } from "@/hooks/useUrlState";
import { confirmBox } from "@/lib/confirm";
import { fmtDate, timeAgo } from "@/lib/db";
import { companyById } from "@/lib/companies";
import { apiBaseUrl, deleteKey, pauseKey, regenerateKey, resumeKey, unblockKey, useApiEvents, useApiKeys, useApiQuotas, type Who } from "@/lib/apiKeys";
import { BLOCKS_TO_PAUSE, keyState, maskedKey, type ApiKeyDoc, type ApiQuotaDoc } from "@/lib/apiKeysModel";
import { countryName, flag } from "@/lib/apiStats";

type Tab = "keys" | "health" | "docs";
const nf = (n: number) => n.toLocaleString("en-IN");
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** "Rings, Earrings · US" — what a key shows. */
function scopeLine(k: ApiKeyDoc, coName: (id: string) => string): string {
  const s = k.scope ?? {};
  const parts = [s.types?.join(", "), s.metals?.join(", "), s.offices?.join(", "), s.companies?.map(coName).join(", ")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All pieces in stock";
}
const priceLine = (k: ApiKeyDoc) => (!k.price.show ? "Hidden" : k.price.markupPct ? `Our price ${k.price.markupPct > 0 ? "+" : ""}${k.price.markupPct}%` : "Our price");

function StateTag({ k }: { k: ApiKeyDoc }) {
  const s = keyState(k);
  if (s === "active") return <CellTag tone="green">Active</CellTag>;
  if (s === "blocked") return <span title={`Called in a loop — refused until ${new Date(k.blockedUntil!).toLocaleString()}`}><CellTag tone="amber">Blocked till {new Date(k.blockedUntil!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</CellTag></span>;
  if (s === "paused") return <span title={k.pausedReason}><CellTag tone="red">{k.pausedBy === "system" ? "Paused · loop" : "Paused"}</CellTag></span>;
  return <CellTag>Deleted</CellTag>;
}

export function StockApiPage() {
  const db = useDb();
  const { user } = useAuth();
  const who: Who = { id: user!.id, name: user!.name || user!.email || "Admin" };
  const [tabRaw, setTab] = useUrlState("tab", "keys");
  const tab = (["keys", "health", "docs"].includes(tabRaw) ? tabRaw : "keys") as Tab;
  const keys = useApiKeys();
  const quotas = useApiQuotas();
  const events = useApiEvents(80);
  const [showDeleted, setShowDeleted] = useState(false);
  const [form, setForm] = useState<{ open: boolean; editing: ApiKeyDoc | null }>({ open: false, editing: null });
  const [secret, setSecret] = useState<{ key: ApiKeyDoc | null; id: string; secret: string; replaced?: boolean } | null>(null);
  const [usage, setUsage] = useState<ApiKeyDoc | null>(null);
  const base = apiBaseUrl();
  const coName = (id: string) => companyById(db.settings, id).name;

  const quotaOf = useMemo(() => new Map(quotas.rows.map(q => [q.keyId || q.id, q as ApiQuotaDoc])), [quotas.rows]);
  const today = todayUtc();
  const callsToday = (k: ApiKeyDoc) => { const q = quotaOf.get(k.id); return q?.day === today ? q.dayCount ?? 0 : 0; };
  const live = keys.rows.filter(k => !k.deletedAt);
  const shown = (showDeleted ? keys.rows : live).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const states = live.map(k => keyState(k));
  const allCalls = live.reduce((n, k) => n + callsToday(k), 0);

  // Once the new key's record arrives, it is the one the docs are for.
  const secretKey = secret ? keys.rows.find(k => k.id === secret.id) ?? secret.key : null;

  const actionsFor = (k: ApiKeyDoc): MoreAction[] => {
    const s = keyState(k);
    const gone = s === "deleted";
    return [
      { label: "View usage", icon: Activity, hint: "Calls, places, devices, the latest calls", onSelect: () => setUsage(k) },
      { label: "Edit", icon: Pencil, hint: "What it shows, price, limits, websites", onSelect: () => setForm({ open: true, editing: k }), disabled: gone },
      { label: "Docs — PDF", icon: FileText, onSelect: () => downloadDocs("pdf", { base, key: k, companyName: coName }) },
      { label: "Docs — web page", icon: Globe, onSelect: () => downloadDocs("html", { base, key: k, companyName: coName }) },
      { label: "OpenAPI file", icon: FileCode2, hint: "For Postman, Swagger…", onSelect: () => downloadDocs("openapi", { base, key: k, companyName: coName }) },
      { label: "Unblock", icon: Unlock, show: s === "blocked", hint: "Let it call again now", onSelect: async () => { await unblockKey(k, who); toast.success("Unblocked — it can call again within a minute"); } },
      { label: s === "paused" ? "Turn on" : "Pause", icon: s === "paused" ? Play : Pause, disabled: gone,
        hint: s === "paused" ? (k.pausedReason ?? "Its calls work again") : "Its calls are refused until turned on",
        onSelect: async () => {
          if (s === "paused") { await resumeKey(k, who); toast.success("Turned on — it works again within a minute"); }
          else { await pauseKey(k, who); toast.success("Paused — its calls are refused within a minute"); }
        } },
      { label: "Replace key", icon: RefreshCw, disabled: gone, hint: "A new key; the old one stops", onSelect: async () => {
        if (!(await confirmBox(`Replace the key "${k.name}"?\n\nA new key is made and shown once. The old one stops working within a minute — the client's website needs the new one.`))) return;
        const sec = await regenerateKey(k, who);
        setSecret({ key: k, id: k.id, secret: sec, replaced: true });
      } },
      { label: "Delete", icon: Trash2, danger: true, disabled: gone, hint: gone ? "Already deleted" : "Stops at once; its counts stay", onSelect: async () => {
        if (!(await confirmBox(`Delete the key "${k.name}"?\n\nIt stops working within a minute and leaves the list. Its counts stay on the health board.\n\nThis cannot be undone — a new key can be made any time.`))) return;
        await deleteKey(k, who);
        toast.success("Deleted");
      } },
    ];
  };

  const columns: DataColumn<ApiKeyDoc>[] = [
    { key: "name", header: "Key", always: true, sortValue: k => k.name,
      cell: k => <CellMain title={k.name} sub={[k.clientName, k.note].filter(Boolean).join(" · ") || undefined} /> },
    { key: "secret", header: "Key starts", sortValue: k => k.prefix, cell: k => <code className="text-xs text-muted-foreground whitespace-nowrap">{maskedKey(k)}</code> },
    { key: "state", header: "Status", sortValue: k => keyState(k), cell: k => <StateTag k={k} /> },
    { key: "shows", header: "Shows", sortValue: k => scopeLine(k, coName), cell: k => <span className="text-sm">{scopeLine(k, coName)}</span> },
    { key: "price", header: "Price", sortValue: k => priceLine(k), cell: k => <span className="whitespace-nowrap">{priceLine(k)}</span> },
    { key: "today", header: "Today", align: "right", kind: "number", sortValue: k => callsToday(k),
      cell: k => <span className="tabular-nums whitespace-nowrap">{nf(callsToday(k))}<span className="text-[11px] text-muted-foreground"> / {nf(k.limits.perDay)}</span></span> },
    { key: "last", header: "Last call", kind: "date", sortValue: k => quotaOf.get(k.id)?.lastAt ?? "",
      cell: k => { const q = quotaOf.get(k.id); return q?.lastAt
        ? <CellMain title={timeAgo(q.lastAt)} sub={[q.lastCity, q.lastCountry ? `${flag(q.lastCountry)} ${countryName(q.lastCountry)}` : "", q.lastOrigin].filter(Boolean).join(" · ") || undefined} />
        : <span className="text-muted-foreground">Never</span>; } },
    { key: "limits", header: "Limits", hidden: true, sortValue: k => k.limits.perMinute, cell: k => <span className="whitespace-nowrap">{k.limits.perMinute}/min · {nf(k.limits.perDay)}/day</span> },
    { key: "websites", header: "Websites", hidden: true, sortValue: k => k.origins.join(","), cell: k => k.origins.length ? k.origins.join(", ") : "Any" },
    { key: "total", header: "All calls", align: "right", kind: "number", hidden: true, sortValue: k => quotaOf.get(k.id)?.total ?? 0, cell: k => nf(quotaOf.get(k.id)?.total ?? 0) },
    { key: "made", header: "Made", kind: "date", hidden: true, sortValue: k => k.createdAt, cell: k => <CellMain title={fmtDate(k.createdAt)} sub={k.createdByName} /> },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader title="API" subtitle="Our Ready Stock on clients' websites"
        info="Each client gets their own key. It shows only pieces in stock — with every detail, photos, video and their price — never costs or notes."
        primary={{ label: "New key", icon: Plus, onClick: () => setForm({ open: true, editing: null }) }} />

      <TabBar label="API" value={tab} onChange={k => setTab(k)} tabs={[
        { key: "keys", label: "Keys", icon: KeyRound, count: live.length },
        { key: "health", label: "Health", icon: Activity },
        { key: "docs", label: "Docs", icon: BookOpen },
      ]} />

      {tab === "keys" && (
        <>
          <StatStrip items={[
            { label: "Active", value: nf(states.filter(s => s === "active").length), icon: ShieldCheck, tone: "in", sub: `${nf(live.length)} keys in all` },
            { label: "Blocked now", value: nf(states.filter(s => s === "blocked").length), icon: Ban, tone: states.includes("blocked") ? "out" : undefined, sub: "Called in a loop · 1 hour" },
            { label: "Paused", value: nf(states.filter(s => s === "paused").length), icon: Pause, tone: states.includes("paused") ? "out" : undefined, sub: `By an admin, or after ${BLOCKS_TO_PAUSE} blocks` },
            { label: "Calls today", value: nf(allCalls), icon: Activity, sub: "Since 00:00 UTC" },
          ]} />
          {keys.error && <p className="text-sm text-destructive">Keys could not be read ({keys.error}).</p>}
          <div className="card-luxe p-3 sm:p-4">
            <DataTable id="api-keys" noun="key" rows={shown} columns={columns} rowKey={k => k.id} loading={keys.loading}
              defaultSort={{ key: "name", dir: "asc" }} rowActions={actionsFor} exportName="API-keys"
              searchText={k => [k.name, k.clientName, k.note, k.prefix, scopeLine(k, coName), ...k.origins].filter(Boolean).join(" ")}
              rowClassName={k => (k.deletedAt ? "opacity-60" : "")}
              emptyText="No keys yet."
              emptyAction={{ label: "Make the first key", onClick: () => setForm({ open: true, editing: null }) }} />
            {keys.rows.some(k => k.deletedAt) && (
              <button type="button" className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setShowDeleted(v => !v)}>
                {showDeleted ? "Hide deleted keys" : `Show deleted keys (${keys.rows.filter(k => k.deletedAt).length})`}
              </button>
            )}
          </div>
        </>
      )}

      {tab === "health" && (
        <UsageBoard keys={keys.rows} extra={b => (
          <div className="grid gap-4 lg:grid-cols-2">
            <BarList title="Keys" rows={[...b.byKey.entries()].map(([id, t]) => [id, t.calls] as [string, number]).sort((x, y) => y[1] - x[1])}
              label={id => keys.rows.find(k => k.id === id)?.name ?? id} empty="No calls yet" />
            <div className="card-luxe p-4 min-w-0">
              <SectionTitle title="What happened" sub="Blocks, pauses and changes" icon={History} />
              {!events.rows.length ? <p className="text-xs text-muted-foreground py-3">Nothing yet.</p> : (
                <ul className="mt-2 divide-y divide-border/60 max-h-80 overflow-auto">
                  {events.rows.map(e => (
                    <li key={e.id} className="py-2.5 text-sm flex gap-3">
                      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${e.kind === "blocked" || e.kind === "paused" ? "bg-destructive" : e.kind === "deleted" ? "bg-muted-foreground" : "bg-primary"}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="block">{e.text}</span>
                        <span className="block text-xs text-muted-foreground">{timeAgo(e.at)}{e.where ? ` · from ${e.where}` : ""}{e.ip ? ` · ${e.ip}` : ""}{e.device ? ` · ${e.device}` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )} />
      )}

      {tab === "docs" && <DocsPanel />}

      <KeyForm open={form.open} editing={form.editing} who={who} onClose={() => setForm({ open: false, editing: null })}
        onMade={(id, sec) => setSecret({ key: null, id, secret: sec })} />

      {/* The key itself — shown this once. */}
      <Dialog open={!!secret} onOpenChange={o => { if (!o) setSecret(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{secret?.replaced ? "The new key" : "Your new key"}</DialogTitle>
            <DialogDescription>Copy it now and give it to the client — it is shown only this once. We keep no copy.</DialogDescription>
          </DialogHeader>
          {secret && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <code className="block text-sm break-all font-mono select-all" data-testid="new-api-key">{secret.secret}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="gap-1.5" onClick={() => void copyText(secret.secret, "Key copied")}><Copy className="h-4 w-4" />Copy key</Button>
                <Button variant="outline" className="gap-1.5" disabled={!secretKey}
                  onClick={() => secretKey && void downloadDocs("pdf", { base, key: secretKey, secret: secret.secret, companyName: coName })}>
                  <Download className="h-4 w-4" />Docs with the key (PDF)
                </Button>
                <Button variant="outline" className="gap-1.5" disabled={!secretKey}
                  onClick={() => secretKey && void downloadDocs("html", { base, key: secretKey, secret: secret.secret, companyName: coName })}>
                  <Globe className="h-4 w-4" />Web page
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                It works within a few seconds. {secret.replaced ? "The old key stops within a minute. " : ""}If it is lost, use Replace key — the old one stops.
              </p>
              <div className="flex justify-end"><Button variant="outline" onClick={() => setSecret(null)}>Done</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ActionSheet open={!!usage} onOpenChange={o => { if (!o) setUsage(null); }} icon={Activity} size="xl"
        title={usage ? `${usage.name} — usage` : "Usage"} description={usage ? `${maskedKey(usage)} · ${scopeLine(usage, coName)} · ${priceLine(usage)}` : undefined}>
        {usage && <UsageBoard keyId={usage.id} keys={keys.rows} />}
      </ActionSheet>
    </div>
  );
}
