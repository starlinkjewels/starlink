import { useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, AlertTriangle, RefreshCw, Server, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db as fsdb, functions, DATABASE_ID } from "@/lib/firebase";
import { loadDb } from "@/lib/db";
import { factoryAccount, factoryFineGoldBalance, factoryPoolBuckets, supplierAccount, lockerBalance } from "@/lib/manufacturing";
import { Button } from "@/components/ui/button";

/** Databases whose server totals are running (functions/src/summaries.ts). */
const LIVE: Record<string, string> = { ssdiamdemo: "sumDemo-rebuild", diamondflow: "sumProd-rebuild" };
export const serverTotalsLive = () => DATABASE_ID in LIVE;

interface Row { party: string; field: string; app: number; server: number | null }

/** Every figure the server keeps, worked out here from the records on screen. */
function appFigures() {
  const d = loadDb();
  const out: { id: string; name: string; fig: Record<string, number> }[] = [];
  for (const f of d.factories) {
    const iss = d.materialIssuances.filter(i => i.factoryId === f.id);
    const a = factoryAccount(iss, f, (d.factoryPayments ?? []).filter(x => x.factoryId === f.id));
    out.push({ id: `factory_${f.id}`, name: `Factory · ${f.name}`, fig: {
      ...a, fineGold: factoryFineGoldBalance(d.materialIssuances, f.id, f.openingFineGold),
      goldPool: factoryPoolBuckets(iss, f.id, "gold").reduce((t, x) => t + x.balance, 0),
      diaPool: factoryPoolBuckets(iss, f.id, "diamond").reduce((t, x) => t + x.balance, 0),
    } });
  }
  for (const s of d.suppliers) {
    const a = supplierAccount(
      d.purchases.filter(p => p.supplierId === s.id),
      (d.supplierReceipts ?? []).filter(r => r.supplierId === s.id), s,
      (d.supplierPayments ?? []).filter(x => x.supplierId === s.id),
      (d.supplierSales ?? []).filter(x => x.supplierId === s.id),
    );
    out.push({ id: `supplier_${s.id}`, name: `Supplier · ${s.name}`, fig: a });
  }
  for (const l of d.lockers) out.push({ id: `locker_${l.id}`, name: `Locker · ${l.name}`, fig: { balance: lockerBalance(l, d.lockerTransactions ?? []) } });
  return out;
}

/**
 * Settings → Data & Backup, admin only, and only where server totals run:
 * fill the server's totals from scratch, and compare every one of them with
 * the figure this app works out from the records. Reads and compares; changes
 * nothing in the books.
 */
export function ServerTotalsCheck() {
  const [busy, setBusy] = useState<"" | "rebuild" | "check">("");
  const [result, setResult] = useState<{ parties: number; figures: number; bad: Row[]; at: Date } | null>(null);
  if (!serverTotalsLive()) return null;

  const rebuild = async () => {
    setBusy("rebuild");
    try {
      const r = await httpsCallable<unknown, { factories: number; suppliers: number; lockers: number; failed: string[] }>(functions, LIVE[DATABASE_ID], { timeout: 540_000 })({});
      const { factories, suppliers, lockers, failed } = r.data;
      if (failed.length) toast.error(`Rebuilt with ${failed.length} failure(s): ${failed[0]}`);
      else toast.success(`Server totals rebuilt — ${factories} factories, ${suppliers} suppliers, ${lockers} lockers`);
    } catch (e) {
      toast.error(`Rebuild failed: ${(e as Error).message}`);
    } finally { setBusy(""); }
  };

  const check = async () => {
    setBusy("check");
    try {
      const snap = await getDocs(collection(fsdb, "summaries"));
      const server = new Map(snap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));
      const bad: Row[] = [];
      let figures = 0;
      const mine = appFigures();
      for (const p of mine) {
        const s = server.get(p.id);
        for (const [field, app] of Object.entries(p.fig)) {
          figures++;
          const v = s?.[field];
          // A supplier's total from before sales to suppliers existed has no "sold": nothing sold, 0.
          const sv = typeof v === "number" ? v : field === "sold" && v === undefined && s ? 0 : null;
          // Gold and diamonds run to three decimals; money is whole rupees.
          if (sv === null || Math.abs(sv - app) > 0.0015) bad.push({ party: p.name, field, app, server: sv });
        }
      }
      // A total on the server for something this app no longer has.
      const known = new Set(mine.map(p => p.id));
      for (const id of server.keys()) if (!known.has(id)) bad.push({ party: id, field: "(no such record in the app)", app: 0, server: null });
      setResult({ parties: mine.length, figures, bad, at: new Date() });
    } catch (e) {
      toast.error(`Check failed: ${(e as Error).message}`);
    } finally { setBusy(""); }
  };

  return (
    <div className="card-luxe p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-2">
        <Server className="h-4 w-4 text-primary mt-0.5" />
        <div>
          <h3 className="font-semibold">Server totals</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every factory, supplier and locker's totals, kept on the server so screens can read them without downloading
            every record. Check compares each one with the figure this app works out — nothing in the books changes.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={rebuild} disabled={!!busy} className="rounded-xl gap-2">
          {busy === "rebuild" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Rebuild totals
        </Button>
        <Button onClick={check} disabled={!!busy} className="btn-hero rounded-xl gap-2">
          {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Check against the app
        </Button>
      </div>
      {result && (
        result.bad.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success" data-testid="totals-ok">
            <CheckCircle2 className="h-4 w-4" /> All {result.figures} figures match, across {result.parties} factories, suppliers and lockers.
          </p>
        ) : (
          <div className="space-y-2" data-testid="totals-bad">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> {result.bad.length} of {result.figures} figures differ
            </p>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border/60">
              <table className="w-full text-xs">
                <thead><tr><th className="text-left px-3 py-2">Where</th><th className="text-left px-3 py-2">Figure</th><th className="text-right px-3 py-2">App</th><th className="text-right px-3 py-2">Server</th></tr></thead>
                <tbody>
                  {result.bad.map((r, i) => (
                    <tr key={i}><td className="px-3 py-1.5">{r.party}</td><td className="px-3 py-1.5">{r.field}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.app.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.server === null ? "missing" : r.server.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
