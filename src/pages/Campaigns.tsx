// Campaigns — emails to our clients and our team, written (with AI if wanted),
// previewed on a laptop and a phone, tested, then sent from our own mailbox a
// few at a time inside a safe daily budget (functions-campaigns). The list of
// every campaign and how it went, the addresses that unsubscribed, and the
// sender's settings. Admins only.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Copy, Mail, MailCheck, Plus, Send, Settings2, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { SectionTitle } from "@/components/SectionTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MoreAction } from "@/components/MoreMenu";
import { useAuth } from "@/lib/auth";
import { useUrlState } from "@/hooks/useUrlState";
import { confirmBox } from "@/lib/confirm";
import { fmtDate, timeAgo } from "@/lib/db";
import { useBrand, BUILTIN } from "@/lib/brand";
import { uploadDataUrl } from "@/lib/storage";
import {
  control, createDraft, saveCampaignSettings, STATUS_LABEL, STATUS_TONE, useCampaigns, useCampaignSettings, useSendInfo, useSuppressed,
  type Campaign, type CampaignSettings, type Suppressed,
} from "@/lib/campaigns";

type Tab = "campaigns" | "unsubscribed" | "settings";
const nf = (n: number) => n.toLocaleString("en-IN");

function SettingsPanel() {
  const saved = useCampaignSettings();
  const info = useSendInfo();
  const brand = useBrand();
  const [f, setF] = useState<CampaignSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const v = f ?? saved ?? {};
  const set = (p: Partial<CampaignSettings>) => setF({ ...v, ...p });
  const logo = v.logoUrl || info?.logoUrl || `${location.origin}${BUILTIN.wide ?? BUILTIN.logo}`;
  const save = async () => {
    setBusy(true);
    try {
      const budget = Math.round(Number(v.dailyBudget ?? info?.dailyBudget ?? 0));
      await saveCampaignSettings({
        fromName: (v.fromName ?? "").trim().slice(0, 60), replyTo: (v.replyTo ?? "").trim().slice(0, 120), address: (v.address ?? "").trim().slice(0, 300),
        contact: (v.contact ?? "").trim().slice(0, 200), logoUrl: v.logoUrl ?? "", logoWidth: Number(v.logoWidth) || 170,
        dailyBudget: info ? Math.min(info.maxBudget, Math.max(1, budget || info.defaultBudget)) : budget,
      });
      setF(null); toast.success("Saved — the next emails use these");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  // The Brand Studio's logo is kept as a small picture inside a record; email programs need an https address — so a copy is stored once.
  const useBrandLogo = async () => {
    if (!brand.logo) { toast.error("No logo is set in Brand Studio — the app's own logo is used"); return; }
    setBusy(true);
    try { set({ logoUrl: /^https:/.test(brand.logo) ? brand.logo : await uploadDataUrl(brand.logo, "campaigns/brand") }); toast.success("Brand Studio's logo ready — press Save"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  if (saved === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-6 max-w-3xl">
      <section className="space-y-3">
        <SectionTitle title="Who it's from" icon={Mail} sub={info ? `Sent from ${info.sender}` : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="cs-from">Sender name</Label><Input id="cs-from" className="mt-1 rounded-xl" placeholder={info?.fromName} value={v.fromName ?? ""} onChange={e => set({ fromName: e.target.value })} /></div>
          <div><Label htmlFor="cs-reply">Replies go to (optional)</Label><Input id="cs-reply" type="email" className="mt-1 rounded-xl" placeholder={info?.sender} value={v.replyTo ?? ""} onChange={e => set({ replyTo: e.target.value })} /></div>
        </div>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Footer of every email" sub="The law in most countries asks for the sender's address" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="cs-addr">Business address</Label><Textarea id="cs-addr" rows={3} className="mt-1 rounded-xl" value={v.address ?? ""} onChange={e => set({ address: e.target.value })} /></div>
          <div><Label htmlFor="cs-contact">Contact line</Label><Input id="cs-contact" className="mt-1 rounded-xl" placeholder="+91 … · sales@…" value={v.contact ?? ""} onChange={e => set({ contact: e.target.value })} /></div>
        </div>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Logo" sub="At the top of every email" />
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-xl border border-border bg-white p-4"><img src={logo} alt="Logo" style={{ width: Math.min(260, Number(v.logoWidth) || 170) }} className="h-auto" /></div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void useBrandLogo()} disabled={busy}>Use Brand Studio's logo</Button>
              {v.logoUrl && <Button variant="ghost" size="sm" onClick={() => set({ logoUrl: "" })}>Use the app's logo</Button>}
            </div>
            <div className="flex items-center gap-2 text-sm"><Label htmlFor="cs-lw" className="text-xs">Width</Label>
              <Input id="cs-lw" type="number" min={60} max={300} className="h-8 w-20 rounded-lg" value={String(v.logoWidth ?? 170)} onChange={e => set({ logoWidth: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">px</span></div>
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Daily budget" sub="Campaign emails a day" info="The mailbox also sends your order emails and Autopilot. Campaigns stay under a safe share of its daily limit, so those are never stopped. A bigger campaign simply carries on the next day." />
        <div className="flex flex-wrap items-center gap-3">
          <Input type="number" min={1} max={info?.maxBudget} className="h-9 w-28 rounded-xl" value={String(v.dailyBudget ?? info?.dailyBudget ?? "")} onChange={e => set({ dailyBudget: Number(e.target.value) })} />
          <span className="text-sm text-muted-foreground">{info ? `a day — up to ${info.maxBudget} for this mailbox · ${info.sentToday} sent today` : ""}</span>
        </div>
      </section>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {f && <Button variant="outline" onClick={() => setF(null)}>Discard</Button>}
        <Button onClick={() => void save()} disabled={busy || !f}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

function UnsubscribedPanel({ rows }: { rows: Suppressed[] }) {
  const [email, setEmail] = useState("");
  const columns: DataColumn<Suppressed>[] = [
    { key: "email", header: "Email", always: true, sortValue: r => r.email, cell: r => <CellMain title={r.email} /> },
    { key: "why", header: "Why", sortValue: r => r.reason, cell: r => <CellTag tone={r.reason === "bounced" ? "red" : "neutral"}>{r.reason === "bounced" ? "Bounced" : r.reason === "added" ? "Added by an admin" : "Unsubscribed"}</CellTag> },
    { key: "at", header: "When", sortValue: r => r.at, cell: r => <span className="text-sm whitespace-nowrap">{fmtDate(r.at)}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="un-add" className="text-xs">Someone asked not to get campaigns</Label>
          <Input id="un-add" type="email" className="mt-1 h-9 w-72 rounded-xl" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <Button variant="outline" className="h-9" disabled={!email.trim()} onClick={async () => {
          try { await control("unsubscribe", undefined, email.trim()); toast.success("Added — no campaign goes to them"); setEmail(""); } catch (e) { toast.error((e as Error).message); }
        }}>Add</Button>
      </div>
      <DataTable id="campaign-unsub" noun="address" rows={rows} columns={columns} rowKey={r => r.id} searchText={r => r.email} searchPlaceholder="Search addresses"
        exportName="Unsubscribed" emptyText="Nobody has unsubscribed."
        rowActions={r => [{
          label: "Take off this list", icon: MailCheck, hint: "Only when they asked to get campaigns again", onSelect: async () => {
            if (!(await confirmBox(`Send campaigns to ${r.email} again?\n\nOnly do this when they asked for it.`, { confirmText: "Yes, they asked" }))) return;
            try { await control("resubscribe", undefined, r.email); toast.success("They get campaigns again"); } catch (e) { toast.error((e as Error).message); }
          },
        }]} />
    </div>
  );
}

export default function CampaignsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const brand = useBrand();
  const [tab, setTab] = useUrlState("tab", "campaigns") as [Tab, (v: string) => void];
  const list = useCampaigns();
  const supp = useSuppressed();
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => [...list.rows].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)), [list.rows]);
  const month = new Date().toISOString().slice(0, 7);
  const sentMonth = rows.filter(c => (c.startedAt ?? "").startsWith(month)).reduce((t, c) => t + (c.counts?.sent ?? 0), 0);

  const create = async () => {
    setBusy(true);
    try { const id = await createDraft(user!.id, undefined, brand.color); nav(`/campaigns/${id}`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const duplicate = async (c: Campaign) => {
    try { const id = await createDraft(user!.id, { name: `${c.name} (copy)`, subject: c.frozen?.subject ?? c.subject, preheader: c.frozen?.preheader ?? c.preheader, design: c.frozen?.design ?? c.design, audience: c.audience }); nav(`/campaigns/${id}`); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (c: Campaign) => {
    if (!(await confirmBox(`Delete “${c.name}”?\n\n${c.status === "draft" ? "The draft and its saved versions are deleted." : "Its report (who got it) is deleted too. Emails already sent stay in people's inboxes."}`, { danger: true, confirmText: "Delete" }))) return;
    try { await control("delete", c.id); toast.success("Deleted"); } catch (e) { toast.error((e as Error).message); }
  };

  const columns: DataColumn<Campaign>[] = [
    { key: "name", header: "Campaign", always: true, sortValue: r => r.name, cell: r => <CellMain title={r.name} sub={r.frozen?.subject ?? r.subject ?? "No subject yet"} /> },
    { key: "status", header: "Status", sortValue: r => r.status, cell: r => <div><CellTag tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</CellTag>{r.pauseReason && r.status === "sending" && <p className="text-[11px] text-amber-700 mt-1 max-w-[14rem]">{r.pauseReason}</p>}</div> },
    { key: "to", header: "To", align: "right", kind: "number", sortValue: r => r.counts?.total ?? 0, cell: r => <span className="tabular-nums">{r.counts ? nf(r.counts.total) : "—"}</span> },
    { key: "sent", header: "Sent", align: "right", kind: "number", card: "figure", sortValue: r => r.counts?.sent ?? 0,
      cell: r => r.counts ? <div className="text-right whitespace-nowrap"><span className="tabular-nums font-medium">{nf(r.counts.sent)}</span>{r.counts.failed + r.counts.unsure > 0 && <p className="text-[11px] text-destructive">{r.counts.failed + r.counts.unsure} not sent</p>}</div> : <span className="text-muted-foreground">—</span> },
    { key: "when", header: "When", sortValue: r => r.startedAt ?? r.updatedAt ?? r.createdAt,
      cell: r => <span className="text-sm whitespace-nowrap">{r.status === "scheduled" && r.scheduleAt ? `Sends ${fmtDate(r.scheduleAt)}` : r.finishedAt ? fmtDate(r.finishedAt) : r.startedAt ? `Started ${timeAgo(r.startedAt).toLowerCase()}` : `Edited ${timeAgo(r.updatedAt ?? r.createdAt).toLowerCase()}`}</span> },
  ];
  const actions = (c: Campaign): MoreAction[] => [
    { label: "Open", icon: c.status === "draft" ? Send : MailCheck, onSelect: () => nav(`/campaigns/${c.id}`) },
    { label: "Copy as a new draft", icon: Copy, onSelect: () => void duplicate(c) },
    { label: "Delete", icon: Trash2, danger: true, disabled: ["sending", "scheduled", "paused", "starting"].includes(c.status), hint: ["sending", "scheduled", "paused", "starting"].includes(c.status) ? "Cancel it first" : undefined, onSelect: () => void remove(c) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Campaigns" subtitle="Emails to your clients and your team"
        info="Write an email (with AI if you like), see it on a laptop and a phone, send yourself a test, then send it. It goes out from your own mailbox a few at a time, inside a safe daily budget — each person once, with a one-click unsubscribe for clients."
        primary={{ label: "New campaign", icon: Plus, onClick: () => void create(), disabled: busy }} />
      <TabBar label="Campaigns" value={tab} onChange={setTab} tabs={[
        { key: "campaigns", label: "Campaigns", icon: Mail, count: rows.length },
        { key: "unsubscribed", label: "Unsubscribed", icon: UserX, count: supp.rows.length },
        { key: "settings", label: "Settings", icon: Settings2 },
      ]} />
      {tab === "campaigns" && (<>
        <StatStrip items={[
          { label: "Drafts", value: nf(rows.filter(c => c.status === "draft").length), icon: Mail },
          { label: "Going out", value: nf(rows.filter(c => ["sending", "scheduled", "paused"].includes(c.status)).length), icon: Send },
          { label: "Sent this month", value: nf(sentMonth), icon: MailCheck, tone: "in" },
          { label: "Unsubscribed", value: nf(supp.rows.length), icon: Ban, sub: `${supp.rows.filter(s => s.reason === "bounced").length} bounced` },
        ]} />
        {list.error && <p className="text-sm text-destructive">Campaigns could not be read ({list.error}).</p>}
        <DataTable id="campaigns" noun="campaign" rows={rows} columns={columns} rowKey={r => r.id} rowHref={r => `/campaigns/${r.id}`} rowActions={actions}
          searchText={r => [r.name, r.subject, r.frozen?.subject, STATUS_LABEL[r.status]].filter(Boolean).join(" ")} searchPlaceholder="Search campaigns"
          loading={list.loading} emptyText="No campaign yet — press New campaign: say what it is about and let AI write it, or build it block by block." exportName="Campaigns" />
      </>)}
      {tab === "unsubscribed" && <UnsubscribedPanel rows={[...supp.rows].sort((a, b) => b.at.localeCompare(a.at))} />}
      {tab === "settings" && <SettingsPanel />}
    </div>
  );
}
