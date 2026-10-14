import { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { countRecords, startupStats } from "@/lib/db";
import { Button } from "@/components/ui/button";

/** Where the app's design — every order and client held on the device — stops being comfortable. */
const COMFORT = 10_000;
const REWRITE = 20_000;

/**
 * Settings → Data & Backup, admin only: how big the database is and how fast
 * the app opens on this device — so the larger rewrite (pages fetching their
 * own records in batches) is started when the data calls for it, not by guess.
 * Counting runs on the server: nothing is downloaded to count.
 */
export function DataSizePanel() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const st = startupStats();
  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null;
  const level = total === null ? null : total < COMFORT ? "ok" : total < REWRITE ? "plan" : "due";

  const count = async () => {
    setBusy(true);
    try { setCounts(await countRecords()); }
    catch (e) { toast.error(`Could not count: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const top = counts ? Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8) : [];

  return (
    <div className="card-luxe p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-2">
        <Gauge className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <h3 className="font-semibold">Data size &amp; speed</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            How many records the business holds, and how fast the app opened on this device. Up to about {COMFORT.toLocaleString()} records
            the app is comfortable as it is; past {REWRITE.toLocaleString()} it is time for pages to fetch their records in batches.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div className="rounded-xl p-3 bg-secondary/60 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Opened in</p>
          <p className="text-base font-semibold text-brand-dark tabular-nums">{st.openedMs ? `${(st.openedMs / 1000).toFixed(1)} s` : "—"}</p>
        </div>
        <div className="rounded-xl p-3 bg-secondary/60 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Everything at sign-in</p>
          <p className="text-base font-semibold text-brand-dark tabular-nums">{st.loadedMs ? `${(st.loadedMs / 1000).toFixed(1)} s` : "—"}</p>
        </div>
        <div className={`rounded-xl p-3 text-center col-span-2 sm:col-span-1 ${level === "due" ? "bg-destructive/10 text-destructive" : level === "plan" ? "bg-warning/10 text-warning-foreground" : "bg-success/10 text-success"}`}>
          <p className="text-[10px] uppercase tracking-wider opacity-80">Records in the database</p>
          <p className="text-base font-semibold tabular-nums">{total === null ? "—" : total.toLocaleString()}</p>
          {level && <p className="text-[10px] opacity-80">{level === "ok" ? "Comfortable" : level === "plan" ? "Plan the next step" : "Time for the rewrite"}</p>}
        </div>
      </div>
      {st.lazy && <p className="text-[11px] text-muted-foreground">Purchases, factory issues, account entries and stock movements load when a page needs them, not at sign-in.</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" onClick={count} disabled={busy} className="rounded-xl gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />} Count records
        </Button>
        {top.length > 0 && (
          <p className="text-[11px] text-muted-foreground">Largest: {top.map(([c, n]) => `${c} ${n.toLocaleString()}`).join(" · ")}</p>
        )}
      </div>
    </div>
  );
}
