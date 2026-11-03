// Who a campaign goes to: every active client (as they are on the day it
// starts) or the ones ticked — found by name, country, company or account
// manager — and/or the team. Counted the way the server will count them:
// each address once, no email or a broken one left out, and an address that
// unsubscribed never sent to (the server checks again at Start, and before each email).
import { useMemo, useState } from "react";
import { Building2, Search, UserRound, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "@/components/SectionTitle";
import { useDb } from "@/hooks/useDb";
import { companiesOf, hasCompanies } from "@/lib/companies";
import type { Audience, Suppressed } from "@/lib/campaigns";

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const addresses = (v?: string) => String(v ?? "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
const ALL = "__all__";

export interface AudienceCount { people: number; emails: number; noEmail: number; badEmail: number; unsubscribed: number; twice: number; clients: number; team: number }

/** The same count the server makes at Start. */
export function countAudience(a: Audience, clients: { id: string; email?: string; status?: string }[], users: { id: string; email?: string; status?: string; role?: string }[], suppressed: Set<string>): AudienceCount {
  const out: AudienceCount = { people: 0, emails: 0, noEmail: 0, badEmail: 0, unsubscribed: 0, twice: 0, clients: 0, team: 0 };
  const seen = new Set<string>();
  const take = (email: string | undefined, client: boolean) => {
    out.people++;
    const list = addresses(email), good = list.filter(e => EMAIL_RE.test(e));
    if (!list.length) { out.noEmail++; return; }
    if (!good.length) { out.badEmail++; return; }
    for (const e of good) {
      if (seen.has(e)) { out.twice++; continue; }
      seen.add(e);
      if (client && suppressed.has(e)) { out.unsubscribed++; continue; }
      out.emails++;
      client ? out.clients++ : out.team++;
    }
  };
  const cIds = new Set(a.clientIds ?? []), uIds = new Set(a.userIds ?? []);
  for (const c of clients) if (a.allClients ? c.status !== "inactive" : cIds.has(c.id)) take(c.email, true);
  for (const u of users) if ((u.role === "admin" || u.role === "employee") && (a.allEmployees ? u.status !== "inactive" : uIds.has(u.id))) take(u.email, false);
  return out;
}

export function AudiencePicker({ audience, onChange, suppressed, disabled }: { audience: Audience; onChange: (a: Audience) => void; suppressed: Suppressed[]; disabled?: boolean }) {
  const db = useDb();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState(ALL);
  const [manager, setManager] = useState(ALL);
  const [company, setCompany] = useState(ALL);
  const [tq, setTq] = useState("");
  const supp = useMemo(() => new Set(suppressed.map(s => s.email.toLowerCase())), [suppressed]);
  const staff = db.users.filter(u => (u.role === "admin" || u.role === "employee"));
  const countries = useMemo(() => [...new Set(db.clients.map(c => c.country).filter(Boolean))].sort(), [db.clients]);
  const multiCo = hasCompanies(db.settings);
  const cIds = new Set(audience.clientIds ?? []), uIds = new Set(audience.userIds ?? []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...db.clients].filter(c => c.status !== "inactive")
      .filter(c => country === ALL || c.country === country)
      .filter(c => manager === ALL || c.accountManagerId === manager)
      .filter(c => company === ALL || (c.companyId ?? "main") === company)
      .filter(c => !t || `${c.companyName} ${c.ownerName} ${c.email} ${c.country}`.toLowerCase().includes(t))
      .sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
  }, [db.clients, q, country, manager, company]);
  const team = staff.filter(u => u.status !== "inactive").filter(u => !tq.trim() || `${u.name} ${u.email}`.toLowerCase().includes(tq.trim().toLowerCase()));
  const n = countAudience(audience, db.clients, db.users, supp);
  const setIds = (key: "clientIds" | "userIds", ids: string[]) => onChange({ ...audience, [key]: [...new Set(ids)] });
  const tagFor = (email?: string) => {
    const list = addresses(email);
    if (!list.length) return <span className="text-[11px] text-amber-700">No email</span>;
    if (!list.some(e => EMAIL_RE.test(e))) return <span className="text-[11px] text-destructive">Email not valid</span>;
    if (list.every(e => supp.has(e))) return <span className="text-[11px] text-muted-foreground">Unsubscribed</span>;
    return <span className="text-[11px] text-muted-foreground truncate">{list.join(", ")}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="font-semibold text-brand-dark">{n.emails.toLocaleString()} email{n.emails === 1 ? "" : "s"} will go out{n.clients && n.team ? ` — ${n.clients} to clients, ${n.team} to the team` : ""}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {[n.noEmail && `${n.noEmail} without an email`, n.badEmail && `${n.badEmail} with an email that isn't valid`, n.unsubscribed && `${n.unsubscribed} unsubscribed`, n.twice && `${n.twice} listed twice (sent once)`].filter(Boolean).join(" · ") || "Each address gets it once."}
        </p>
      </div>

      <section className="space-y-3">
        <SectionTitle title="Clients" icon={Building2} sub="They get a one-click unsubscribe in every email" actions={
          <label className="inline-flex items-center gap-2 text-sm"><Switch checked={!!audience.allClients} disabled={disabled} onCheckedChange={v => onChange({ ...audience, allClients: v })} />All active clients</label>} />
        {audience.allClients ? (
          <p className="text-xs text-muted-foreground rounded-lg bg-secondary/40 px-3 py-2">Every active client with an email, as they are on the day it starts — {db.clients.filter(c => c.status !== "inactive").length} now.</p>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[12rem]"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9 h-9 rounded-xl" placeholder="Search clients" value={q} onChange={e => setQ(e.target.value)} /></div>
              {countries.length > 1 && <Select value={country} onValueChange={setCountry}><SelectTrigger aria-label="Country" className="h-9 rounded-xl w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Every country</SelectItem>{countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>}
              <Select value={manager} onValueChange={setManager}><SelectTrigger aria-label="Account manager" className="h-9 rounded-xl w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Any account manager</SelectItem>{staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
              {multiCo && <Select value={company} onValueChange={setCompany}><SelectTrigger aria-label="Company" className="h-9 rounded-xl w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Every company</SelectItem>{companiesOf(db.settings).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{shown.length} shown · {cIds.size} ticked</span>
              <span className="flex gap-3">
                <button type="button" className="text-primary font-medium disabled:opacity-50" disabled={disabled} onClick={() => setIds("clientIds", [...cIds, ...shown.map(c => c.id)])}>Tick all shown</button>
                <button type="button" className="text-muted-foreground disabled:opacity-50" disabled={disabled} onClick={() => setIds("clientIds", [...cIds].filter(id => !shown.some(c => c.id === id)))}>Untick shown</button>
              </span>
            </div>
            <ul className="max-h-80 overflow-y-auto rounded-xl border border-border divide-y divide-border/60 bg-white">
              {shown.map(c => (
                <li key={c.id}><Label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary/40 font-normal">
                  <Checkbox checked={cIds.has(c.id)} disabled={disabled} onCheckedChange={v => setIds("clientIds", v ? [...cIds, c.id] : [...cIds].filter(x => x !== c.id))} />
                  <span className="min-w-0 flex-1"><span className="block text-sm truncate">{c.companyName || c.ownerName}{c.companyName && c.ownerName ? <span className="text-muted-foreground"> · {c.ownerName}</span> : null}</span>{tagFor(c.email)}</span>
                  {c.country && <span className="text-[11px] text-muted-foreground shrink-0">{c.country}</span>}
                </Label></li>
              ))}
              {!shown.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No client matches.</li>}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle title="Team" icon={Users} sub="An internal email — no unsubscribe link" actions={
          <label className="inline-flex items-center gap-2 text-sm"><Switch checked={!!audience.allEmployees} disabled={disabled} onCheckedChange={v => onChange({ ...audience, allEmployees: v })} />Everyone in the team</label>} />
        {audience.allEmployees ? (
          <p className="text-xs text-muted-foreground rounded-lg bg-secondary/40 px-3 py-2">Every active employee and admin with an email — {staff.filter(u => u.status !== "inactive").length} now.</p>
        ) : (
          <div className="space-y-2.5">
            <div className="relative"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9 h-9 rounded-xl" placeholder="Search the team" value={tq} onChange={e => setTq(e.target.value)} /></div>
            <ul className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border/60 bg-white">
              {team.map(u => (
                <li key={u.id}><Label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary/40 font-normal">
                  <Checkbox checked={uIds.has(u.id)} disabled={disabled} onCheckedChange={v => setIds("userIds", v ? [...uIds, u.id] : [...uIds].filter(x => x !== u.id))} />
                  <UserRound className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block text-sm truncate">{u.name} <span className="text-[11px] text-muted-foreground">· {u.role === "admin" ? "Admin" : "Employee"}</span></span>{tagFor(u.email)}</span>
                </Label></li>
              ))}
              {!team.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nobody matches.</li>}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
