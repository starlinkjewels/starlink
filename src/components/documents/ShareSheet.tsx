import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, Copy, Download, Eye, EyeOff, KeyRound, Link2, Loader2, MessageCircle, RefreshCw, Share2, Trash2 } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { MoreMenu } from "@/components/MoreMenu";
import { SectionTitle } from "@/components/SectionTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmBox } from "@/lib/confirm";
import { fmtDate, timeAgo } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { SHARE_PASSWORD_MIN, suggestSharePassword, type DocFolder, type DocItem, type DocShare } from "@/lib/documentsModel";
import {
  createShare, dayEnd, daysFromToday, deleteShare, setShareActive, setShareDownload, setShareExpiry,
  shareExpired, shareUrl, useDocShares,
} from "@/lib/documents";

/**
 * Sharing a document or a folder outside: always a link AND a password. The
 * password is shown once, here, when the link is made — only its hash is
 * kept, so it can't be looked up later (a new link is made instead). The
 * person gets the link one way and the password another.
 */

async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
  catch { toast.error(`Couldn't copy the ${what.toLowerCase()}`); }
}

type Ends = "none" | "7" | "30" | "date";
const ENDS: { value: Ends; label: string }[] = [
  { value: "none", label: "No end" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "date", label: "On a date" },
];
/** The link's end, as kept: the last moment of that day, or null for none. */
function endOf(ends: Ends, day: string): string | null | "missing" {
  if (ends === "none") return null;
  if (ends === "7") return daysFromToday(7);
  if (ends === "30") return daysFromToday(30);
  return day ? dayEnd(day) : "missing";
}
/** "2026-11-30", by this device's calendar. */
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => dayOf(new Date());

/** The end of a link as words. */
function endsText(s: DocShare): string {
  if (!s.expiresAt) return "No end date";
  return `${shareExpired(s) ? "Ended" : "Ends"} ${fmtDate(s.expiresAt)}`;
}

/** Choosing when a link stops: none, a week, a month or a day. */
function EndsPicker({ ends, day, onEnds, onDay, id }: { ends: Ends; day: string; onEnds: (e: Ends) => void; onDay: (d: string) => void; id: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select value={ends} onValueChange={v => onEnds(v as Ends)}>
        <SelectTrigger className="h-10 rounded-xl" aria-label="Link ends"><SelectValue /></SelectTrigger>
        <SelectContent>{ENDS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}</SelectContent>
      </Select>
      {ends === "date"
        ? <Input id={id} type="date" min={today()} value={day} onChange={e => onDay(e.target.value)} className="h-10 rounded-xl" aria-label="Last day" />
        : <span className="self-center text-xs text-muted-foreground">{ends === "none" ? "Works until turned off" : `Until ${fmtDate(endOf(ends, "") as string)}`}</span>}
    </div>
  );
}

/**
 * One link: its title, when it was made and ends, how often it was opened,
 * an on/off switch, and its ⋯ (copy, end date, downloads, delete).
 */
export function ShareLinkRow({ s, what }: { s: DocShare; /** What it shares, when the list mixes them. */ what?: string }) {
  const [editEnd, setEditEnd] = useState(false);
  const [ends, setEnds] = useState<Ends>("none");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const ended = shareExpired(s);
  const run = async (fn: () => Promise<void>, ok?: string): Promise<boolean> => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); return false; }
    finally { setBusy(false); }
  };
  const saveEnd = () => {
    const at = endOf(ends, day);
    if (at === "missing") { toast.error("Pick the last day"); return; }
    run(() => setShareExpiry(s.id, at), at ? `Link now ends ${fmtDate(at)}` : "Link has no end date now").then(ok => { if (ok) setEditEnd(false); });
  };
  const status = !s.active ? { t: "Off", c: "bg-secondary text-muted-foreground" }
    : ended ? { t: "Ended", c: "bg-amber-500/15 text-amber-700" }
    : { t: "On", c: "bg-emerald-500/15 text-emerald-700" };
  return (
    <div className="rounded-xl border border-border/70 bg-white p-3 space-y-2 min-w-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-brand-dark flex items-center gap-2 min-w-0">
            <span className="truncate">{s.title}</span>
            <span className={`shrink-0 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${status.c}`}>{status.t}</span>
          </p>
          {what && <p className="text-xs text-muted-foreground truncate">{what}</p>}
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Made {fmtDate(s.createdAt)} · {endsText(s)} · {s.allowDownload ? "Can download" : "View only"}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {s.opens ? `Opened ${s.opens} time${s.opens === 1 ? "" : "s"} · last ${timeAgo(s.lastOpenedAt)}` : "Not opened yet"}
            {s.lockedUntil && new Date(s.lockedUntil).getTime() > Date.now() && " · locked for now after wrong passwords"}
          </p>
        </div>
        <Switch checked={s.active} disabled={busy} aria-label={s.active ? "Turn this link off" : "Turn this link on"}
          onCheckedChange={on => run(() => setShareActive(s.id, on), on ? "Link turned on" : "Link turned off — it stops working at once")} />
        <MoreMenu size="sm" label={`${s.title}: link actions`} actions={[
          { label: "Copy link", icon: Copy, onSelect: () => copy(shareUrl(s.id), "Link") },
          { label: "Change end date", icon: CalendarClock, onSelect: () => { setEnds(s.expiresAt ? "date" : "none"); setDay(s.expiresAt ? dayOf(new Date(s.expiresAt)) : ""); setEditEnd(true); } },
          s.allowDownload
            ? { label: "Stop downloads", icon: Eye, hint: "They can look, not save", onSelect: () => run(() => setShareDownload(s.id, false), "Downloads stopped on this link") }
            : { label: "Allow downloads", icon: Download, onSelect: () => run(() => setShareDownload(s.id, true), "Downloads allowed on this link") },
          { label: "Delete link", icon: Trash2, danger: true, onSelect: async () => {
            if (!(await confirmBox(`Delete the link "${s.title}"?\n\nIt stops working at once. The document itself stays.`))) return;
            await run(() => deleteShare(s.id), "Link deleted");
          } },
        ]} />
      </div>
      {editEnd && (
        <div className="rounded-lg bg-secondary/40 p-2.5 space-y-2">
          <EndsPicker id={`end-${s.id}`} ends={ends} day={day} onEnds={setEnds} onDay={setDay} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg h-9" onClick={() => setEditEnd(false)}>Cancel</Button>
            <Button size="sm" className="rounded-lg h-9" disabled={busy} onClick={saveEnd}>Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Make a link to one document or folder, and see the links it already has. */
export function ShareSheet({ target, name, onClose }: {
  /** What is being shared; null = closed. */
  target: DocShare["target"] | null;
  name: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const shares = useDocShares();
  const [title, setTitle] = useState(name);
  const [password, setPassword] = useState(suggestSharePassword);
  const [show, setShow] = useState(true);
  const [ends, setEnds] = useState<Ends>("30");
  const [day, setDay] = useState("");
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ share: DocShare; password: string } | null>(null);
  const key = target ? `${target.kind}:${target.id}` : "";

  // A new form for each thing shared.
  useEffect(() => {
    if (!target) return;
    setTitle(name); setPassword(suggestSharePassword()); setShow(true);
    setEnds("30"); setDay(""); setAllowDownload(true); setMade(null); setBusy(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = useMemo(() => shares.rows
    .filter(s => target && s.target.kind === target.kind && s.target.id === target.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [shares.rows, target]);

  const make = async () => {
    if (!target || !user) return;
    if (password.length < SHARE_PASSWORD_MIN) { toast.error(`The password needs at least ${SHARE_PASSWORD_MIN} characters`); return; }
    const at = endOf(ends, day);
    if (at === "missing") { toast.error("Pick the last day the link works"); return; }
    setBusy(true);
    try {
      const share = await createShare({ target, title: title || name, password, expiresAt: at, allowDownload, by: user.id });
      setMade({ share, password });
    } catch (e) {
      toast.error(e instanceof Error ? `Couldn't make the link — ${e.message}` : "Couldn't make the link");
    } finally { setBusy(false); }
  };

  const link = made ? shareUrl(made.share.id) : "";
  const wa = made ? `https://wa.me/?text=${encodeURIComponent(`${made.share.title}: ${link}`)}` : "";

  return (
    <ActionSheet open={!!target} onOpenChange={o => { if (!o && !busy) onClose(); }} size="md" icon={Share2}
      title={target?.kind === "folder" ? "Share folder" : "Share document"}
      description={<>{name}{target?.kind === "folder" ? " — with everything in it" : ""}. Opens only with its password.</>}
      footer={made ? (
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="rounded-xl h-10 gap-2" onClick={() => { setMade(null); setPassword(suggestSharePassword()); }}><RefreshCw className="h-4 w-4" />Another link</Button>
          <Button onClick={onClose} className="btn-hero rounded-xl h-10 px-8">Done</Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="rounded-xl h-10">Cancel</Button>
          <Button onClick={make} disabled={busy} className="btn-hero rounded-xl h-10 px-6 gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Create link
          </Button>
        </div>
      )}>
      <div className="space-y-6">
        {made ? (
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 space-y-3">
            <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5"><Check className="h-4 w-4" />Link ready</p>
            <div>
              <Label className="text-xs">Link</Label>
              <div className="mt-1 flex gap-2 min-w-0">
                <Input readOnly value={link} onFocus={e => e.currentTarget.select()} className="h-10 rounded-xl min-w-0 flex-1 bg-white text-xs" />
                <Button variant="outline" className="rounded-xl h-10 gap-2 shrink-0" onClick={() => copy(link, "Link")}><Copy className="h-4 w-4" /><span className="max-sm:hidden">Copy link</span></Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Password</Label>
              <div className="mt-1 flex gap-2 min-w-0">
                <Input readOnly value={made.password} onFocus={e => e.currentTarget.select()} className="h-10 rounded-xl min-w-0 flex-1 bg-white font-mono tracking-wide" />
                <Button variant="outline" className="rounded-xl h-10 gap-2 shrink-0" onClick={() => copy(made.password, "Password")}><KeyRound className="h-4 w-4" /><span className="max-sm:hidden">Copy password</span></Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">Send the password separately — a call or another message, not with the link. It isn't kept, so it can't be shown again.</p>
            </div>
            <Button asChild variant="outline" className="w-full rounded-xl h-10 gap-2">
              <a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />Share link on WhatsApp</a>
            </Button>
          </section>
        ) : (
          <section className="space-y-4">
            <div>
              <Label htmlFor="sh-title" className="text-xs">Title they see</Label>
              <Input id="sh-title" value={title} onChange={e => setTitle(e.target.value)} className="h-10 rounded-xl mt-1" />
            </div>
            <div>
              <Label htmlFor="sh-pass" className="text-xs">Password · at least {SHARE_PASSWORD_MIN} characters</Label>
              <div className="mt-1 flex gap-2 min-w-0">
                <div className="relative min-w-0 flex-1">
                  <Input id="sh-pass" type={show ? "text" : "password"} autoComplete="new-password" value={password}
                    onChange={e => setPassword(e.target.value.trim())} className="h-10 rounded-xl pr-11 font-mono tracking-wide" />
                  <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" className="rounded-xl h-10 gap-2 shrink-0" onClick={() => setPassword(suggestSharePassword())} title="Another password">
                  <RefreshCw className="h-4 w-4" /><span className="max-sm:hidden">New</span>
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Link ends</Label>
              <div className="mt-1"><EndsPicker id="sh-day" ends={ends} day={day} onEnds={setEnds} onDay={setDay} /></div>
            </div>
            <div className="rounded-xl border border-border/70 p-3.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Label htmlFor="sh-dl" className="text-sm font-semibold text-brand-dark">Allow download</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">Off: they can look, with no download button.</p>
              </div>
              <Switch id="sh-dl" checked={allowDownload} onCheckedChange={setAllowDownload} className="mt-0.5" />
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionTitle title="Links to this" sub={shares.loading ? "Loading…" : links.length ? `${links.length} link${links.length === 1 ? "" : "s"}` : "None yet"} />
          {shares.error && <p className="text-xs text-destructive">Couldn't read the links ({shares.error}).</p>}
          {links.map(s => <ShareLinkRow key={s.id} s={s} />)}
        </section>
      </div>
    </ActionSheet>
  );
}

/** Every link made, newest first — the Documents page's ⋯ → Shared links. */
export function SharedLinksSheet({ open, onClose, folders, items }: {
  open: boolean;
  onClose: () => void;
  folders: DocFolder[];
  items: DocItem[];
}) {
  const shares = useDocShares();
  const [only, setOnly] = useState<"all" | "on" | "off">("all");
  const list = useMemo(() => shares.rows
    .filter(s => only === "all" || (only === "on" ? s.active && !shareExpired(s) : !s.active || shareExpired(s)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [shares.rows, only]);
  const what = (s: DocShare) => {
    if (s.target.kind === "folder") {
      const f = folders.find(x => x.id === s.target.id);
      return f ? `Folder · ${f.name}${f.deletedAt ? " (in the Trash)" : ""}` : "Folder · no longer there";
    }
    const i = items.find(x => x.id === s.target.id);
    return i ? `${i.name}${i.deletedAt ? " (in the Trash)" : ""}` : "Document · no longer there";
  };
  const working = shares.rows.filter(s => s.active && !shareExpired(s)).length;
  return (
    <ActionSheet open={open} onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Link2}
      title="Shared links"
      description={shares.loading ? "Loading…" : `${shares.rows.length} link${shares.rows.length === 1 ? "" : "s"} · ${working} working`}>
      <div className="space-y-3">
        <Select value={only} onValueChange={v => setOnly(v as typeof only)}>
          <SelectTrigger className="h-10 rounded-xl w-44" aria-label="Show"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All links</SelectItem>
            <SelectItem value="on">Working</SelectItem>
            <SelectItem value="off">Off or ended</SelectItem>
          </SelectContent>
        </Select>
        {shares.error && <p className="text-xs text-destructive">Couldn't read the links ({shares.error}).</p>}
        {!shares.loading && list.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {shares.rows.length ? "No links like that." : "No links yet. Share a document or folder from its ⋯ → Share…"}
          </p>
        )}
        {list.map(s => <ShareLinkRow key={s.id} s={s} what={what(s)} />)}
      </div>
    </ActionSheet>
  );
}
