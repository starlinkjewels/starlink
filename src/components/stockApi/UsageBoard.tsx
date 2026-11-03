// The API's health and use, from its own counts (lib/apiStats.ts): calls over
// time, how fast it answered, and who called — by key, country, city, website,
// device, address and endpoint — with the latest calls one by one. Every key's
// (the health board) or one key's (its usage panel).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from "recharts";
import { Activity, AlertTriangle, Ban, Gauge, KeyRound, RefreshCw, ShieldAlert, Timer } from "lucide-react";
import { StatStrip } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { DataTable, CellTag, type DataColumn } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { C, ChartTip } from "@/components/reports/ui";
import { timeAgo } from "@/lib/db";
import { fetchCalls, fetchStats } from "@/lib/apiKeys";
import { buildBoard, cityName, countryName, flag, PATH_LABEL, pct, RANGE_LABEL, rangeStart, type Board, type Range } from "@/lib/apiStats";
import type { ApiCallDoc, ApiKeyDoc, ApiStatsDoc } from "@/lib/apiKeysModel";

const nf = (n: number) => n.toLocaleString("en-IN");

/** Ranked counts with a thin bar for each — the biggest first. */
export function BarList({ title, rows, label = x => x, empty = "None yet", max = 8 }: {
  title: string; rows: [string, number][]; label?: (k: string) => React.ReactNode; empty?: string; max?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, max);
  const top = rows[0]?.[1] ?? 0, total = rows.reduce((n, r) => n + r[1], 0);
  return (
    <div className="card-luxe p-4 min-w-0">
      <p className="text-sm font-semibold text-brand-dark mb-3">{title}</p>
      {!rows.length ? <p className="text-xs text-muted-foreground py-3">{empty}</p> : (
        <ul className="space-y-2.5">
          {shown.map(([k, n]) => (
            <li key={k} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate min-w-0" title={typeof label(k) === "string" ? (label(k) as string) : k}>{label(k)}</span>
                <span className="tabular-nums text-foreground shrink-0">{nf(n)} <span className="text-[11px] text-muted-foreground">{pct(n, total)}</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${top ? Math.max(2, (n / top) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > max && (
        <button type="button" className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setAll(a => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function RangePick({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-white p-0.5" role="group" aria-label="Time range">
      {(Object.keys(RANGE_LABEL) as Range[]).map(r => (
        <button key={r} type="button" aria-pressed={value === r} onClick={() => onChange(r)}
          className={`h-8 px-3 rounded-lg text-xs font-medium ${value === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {r === "24h" ? "24 hours" : r === "7d" ? "7 days" : "30 days"}
        </button>
      ))}
    </div>
  );
}

const STATUS_TONE = (s: number): "green" | "amber" | "red" | "neutral" => (s < 400 ? "green" : s === 429 ? "amber" : s >= 500 ? "red" : "red");
const STATUS_WORD: Record<number, string> = { 200: "OK", 304: "Not changed", 400: "Bad request", 401: "Wrong key", 403: "Refused", 404: "Not found", 429: "Too many", 500: "Error", 503: "Busy" };

/** The latest calls, one by one (kept 30 days). */
function RecentCalls({ calls, keys, oneKey }: { calls: ApiCallDoc[]; keys: Map<string, ApiKeyDoc>; oneKey: boolean }) {
  const columns: DataColumn<ApiCallDoc>[] = [
    { key: "at", header: "When", kind: "date", sortValue: c => c.at, always: true,
      cell: c => <span className="whitespace-nowrap" title={new Date(c.at).toLocaleString()}>{timeAgo(c.at)}</span> },
    ...(oneKey ? [] : [{ key: "key", header: "Key", sortValue: (c: ApiCallDoc) => keys.get(c.keyId)?.name ?? c.keyName ?? c.keyId,
      cell: (c: ApiCallDoc) => <span className="truncate">{c.keyId === "_invalid" ? <span className="text-muted-foreground">Wrong key</span> : keys.get(c.keyId)?.name ?? c.keyName ?? c.keyId}</span> }]),
    { key: "call", header: "Call", sortValue: c => c.path,
      cell: c => <span className="font-mono text-xs break-all">{PATH_LABEL[c.path] ?? c.path}{c.query ? `?${decodeURIComponent(c.query).slice(0, 80)}` : ""}</span> },
    { key: "status", header: "Answer", sortValue: c => c.status,
      cell: c => <CellTag tone={STATUS_TONE(c.status)}>{c.status} {STATUS_WORD[c.status] ?? ""}</CellTag> },
    { key: "ms", header: "Time", align: "right", kind: "number", sortValue: c => c.ms, cell: c => <span className="tabular-nums whitespace-nowrap">{nf(c.ms)} ms</span> },
    { key: "returned", header: "Pieces", align: "right", kind: "number", hidden: true, sortValue: c => c.returned ?? null, cell: c => c.returned ?? "—" },
    { key: "where", header: "Where", sortValue: c => `${c.country} ${c.city}`,
      cell: c => <span className="whitespace-nowrap">{flag(c.country)} {c.city ? `${c.city}, ` : ""}{countryName(c.country)}</span> },
    { key: "origin", header: "Website", sortValue: c => c.origin || "", cell: c => c.origin || <span className="text-muted-foreground">Server</span> },
    { key: "device", header: "Device", sortValue: c => c.device, cell: c => <span className="whitespace-nowrap">{c.device}</span> },
    { key: "ip", header: "Address", sortValue: c => c.ip, cell: c => <span className="font-mono text-xs">{c.ip}</span> },
    { key: "ua", header: "User agent", hidden: true, sortValue: c => c.ua ?? "", cell: c => <span className="text-xs break-all">{c.ua}</span> },
  ];
  return (
    <DataTable id={oneKey ? "api-calls-key" : "api-calls"} noun="call" rows={calls} columns={columns} rowKey={c => c.id}
      defaultSort={{ key: "at", dir: "desc" }} exportName="API-calls" emptyText="No calls yet."
      searchText={c => [c.path, c.query, c.ip, c.city, countryName(c.country), c.origin, c.device, c.code, String(c.status), keys.get(c.keyId)?.name].filter(Boolean).join(" ")} />
  );
}

/** Calls and speed, every key's or one key's. */
export function UsageBoard({ keyId, keys, extra }: { keyId?: string; keys: ApiKeyDoc[]; extra?: (b: Board) => React.ReactNode }) {
  const [range, setRange] = useState<Range>("24h");
  const [stats, setStats] = useState<ApiStatsDoc[] | null>(null);
  const [calls, setCalls] = useState<ApiCallDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<string>("");
  const byId = useMemo(() => new Map(keys.map(k => [k.id, k])), [keys]);
  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchStats(rangeStart("30d"), keyId), fetchCalls(keyId, 100)]);
      setStats(s); setCalls(c); setError(null); setAt(new Date().toISOString());
    } catch (e) {
      setError((e as { code?: string })?.code ?? (e instanceof Error ? e.message : "Could not read"));
    }
  }, [keyId]);
  useEffect(() => {
    void load();
    // Fresh every minute while it is open.
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const b = useMemo(() => buildBoard(stats ?? [], range, keyId), [stats, range, keyId]);
  const t = b.totals;
  const refused = t.limited, errors = t.c4xx + t.c5xx;
  const avg = t.calls ? Math.round(t.ms / t.calls) : 0;
  // Addresses come from the calls themselves (the hourly counts keep none).
  const ips = useMemo(() => {
    const from = rangeStart(range);
    const m = new Map<string, number>();
    for (const c of calls) if (c.ip && c.at.slice(0, 13) >= from) m.set(c.ip, (m.get(c.ip) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [calls, range]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RangePick value={range} onChange={setRange} />
        <span className="ml-auto text-xs text-muted-foreground">{at ? `Updated ${timeAgo(at).toLowerCase()} · every minute` : "Loading…"}</span>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
      </div>
      {error && <p className="text-sm text-destructive">Could not read the counts ({error}).</p>}

      <StatStrip items={[
        { label: "Calls", value: nf(t.calls), icon: Activity, sub: RANGE_LABEL[range] },
        { label: "Answered", value: pct(t.ok, t.calls), icon: Gauge, tone: t.calls && t.ok / t.calls >= 0.95 ? "in" : undefined, sub: `${nf(t.ok)} OK` },
        { label: "Refused · limits", value: nf(refused), icon: Ban, tone: refused ? "out" : undefined, sub: refused ? pct(refused, t.calls) : "None" },
        { label: "Errors", value: nf(errors), icon: AlertTriangle, tone: errors ? "out" : undefined, sub: t.c5xx ? `${nf(t.c5xx)} on our side` : "None on our side" },
        { label: "Avg answer", value: t.calls ? `${nf(avg)} ms` : "—", icon: Timer, sub: t.slow ? `${nf(t.slow)} over 1 s` : "None slow" },
        ...(!keyId ? [{ label: "Wrong keys", value: nf(b.invalid), icon: ShieldAlert, tone: b.invalid ? "out" as const : undefined, sub: "Calls with no or a bad key" }] : []),
      ]} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-luxe p-4 lg:col-span-2 min-w-0">
          <SectionTitle title="Calls" sub={range === "24h" ? "By the hour" : "By the day"} />
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={b.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                <Tooltip content={<ChartTip format={v => nf(v)} />} cursor={{ fill: "oklch(0.95 0.01 260)" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ok" name="Answered" stackId="a" fill={C.primary} maxBarSize={28} />
                <Bar dataKey="limited" name="Refused · limits" stackId="a" fill={C.gold} maxBarSize={28} />
                <Bar dataKey="errors" name="Errors" stackId="a" fill={C.rose} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card-luxe p-4 min-w-0">
          <SectionTitle title="Answer time" sub="Average, ms" />
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={b.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.9 0.01 260)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                <Tooltip content={<ChartTip format={v => `${nf(v)} ms`} />} />
                <Line type="monotone" dataKey="avgMs" name="Average" stroke={C.primary} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {extra?.(b)}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <BarList title="Countries" rows={b.countries} label={k => <>{flag(k)} {countryName(k)}</>} />
        <BarList title="Cities" rows={b.cities} label={k => <>{flag(k.split("|")[0])} {cityName(k)}</>} />
        <BarList title="Websites" rows={b.origins} label={k => (k === "(server)" ? "Servers (no website)" : k)} />
        <BarList title="Devices" rows={b.devices} />
        <BarList title="Endpoints" rows={b.paths} label={k => PATH_LABEL[k] ?? k} />
        <BarList title="Addresses (IP) · latest calls" rows={ips} label={k => <span className="font-mono text-xs">{k}</span>} />
      </div>

      <div className="card-luxe p-3 sm:p-4">
        <SectionTitle title="Latest calls" sub={`The last ${calls.length} · each call is kept ${30} days`} icon={KeyRound} />
        <div className="mt-2"><RecentCalls calls={calls} keys={byId} oneKey={!!keyId} /></div>
      </div>
      {stats && !stats.length && !error && <p className="text-xs text-muted-foreground">No calls yet{keyId ? " with this key" : ""} — the counts start with the first call.</p>}
    </div>
  );
}
