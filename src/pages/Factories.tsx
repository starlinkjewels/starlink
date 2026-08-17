import { useState } from "react";
import { Link } from "react-router-dom";
import { updateDb, uid, fmtDate, type Factory } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { factoryAccount, factoryPoolBuckets, factoryFineGoldBalance, fmtMoneyInr } from "@/lib/manufacturing";
import { AccountSummary } from "@/components/AccountSummary";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Factory as FactoryIcon, History, Rows3, LayoutGrid, Package, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

const PAGE_SIZE = 9;

export function FactoriesPage() {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("factories-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("factories-view", v); } catch { /* ignore */ } };
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Factory>>({ name: "", contactPerson: "", phone: "", address: "" });

  const list = db.factories.filter(fac =>
    fac.name.toLowerCase().includes(q.toLowerCase()) || (fac.contactPerson || "").toLowerCase().includes(q.toLowerCase()),
  );
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  // Grand totals across ALL factories: charges we still owe (payable) vs charges
  // we overpaid and the factory owes us back (receivable).
  const totals = db.factories.reduce((acc, fac) => {
    const a = factoryAccount(db.materialIssuances.filter(i => i.factoryId === fac.id), fac);
    acc.payable += a.chargesPending;
    acc.receivable += a.chargesOverpaid;
    return acc;
  }, { payable: 0, receivable: 0 });

  const create = () => {
    if (!f.name?.trim()) { toast.error("Enter a factory name"); return; }
    setSaving(true);
    try {
      updateDb(d => {
        if (!d.factories) d.factories = [];
        d.factories.unshift({ ...f, name: f.name!.trim(), id: uid("fac_"), active: true, createdAt: new Date().toISOString() } as Factory);
      });
      toast.success("Factory added");
      setOpen(false);
      setF({ name: "", contactPerson: "", phone: "", address: "" });
    } finally { setSaving(false); }
  };

  const toggle = (fac: Factory) => {
    updateDb(d => { const x = d.factories.find(x => x.id === fac.id); if (x) x.active = !x.active; });
    toast.success("Status updated");
  };

  const del = (id: string) => {
    if (!confirm("Delete factory? This does not delete its gold issuance history.")) return;
    updateDb(d => { d.factories = d.factories.filter(f => f.id !== id); });
    toast.success("Deleted");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Factories</h1>
          <p className="text-sm text-muted-foreground">{total} factory{total !== 1 ? "ies" : ""}</p>
        </div>
        {isAdmin && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Factory</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Add Factory</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {(["name", "contactPerson", "phone", "address"] as const).map(k => (
                <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
                  <Label className="text-xs capitalize">{k === "contactPerson" ? "Contact Person / Karigar" : k.replace(/([A-Z])/g, " $1")}</Label>
                  <Input value={(f as Record<string, string>)[k] || ""} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" />
                </div>
              ))}
              <OpeningBalanceFields
                amount={f.openingBalance != null ? String(f.openingBalance) : ""}
                dir={f.openingDir || "credit"}
                date={f.openingDate || ""}
                onAmount={v => setF({ ...f, openingBalance: v === "" ? undefined : Number(v) })}
                onDir={v => setF({ ...f, openingDir: v })}
                onDate={v => setF({ ...f, openingDate: v || undefined })}
                debitLabel="Factory owes us (Debit)"
                creditLabel="We owe factory (Credit)"
                title="Opening Making-Charge Balance"
                hint="Unpaid labour / making charges with this factory when you started using this app (₹)."
              />
              <div className="col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-amber-700">Opening Gold Stock (optional)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <Label className="text-[11px]">Fine gold at factory (24KT grams)</Label>
                    <Input type="number" min={0} step="0.001" value={f.openingFineGold != null ? String(f.openingFineGold) : ""}
                      onChange={e => setF({ ...f, openingFineGold: e.target.value === "" ? undefined : Number(e.target.value) })}
                      placeholder="0.000" className="rounded-lg mt-1 h-9" />
                  </div>
                  <div>
                    <Label className="text-[11px]">As of date</Label>
                    <Input type="date" value={f.openingFineGoldDate || ""}
                      onChange={e => setF({ ...f, openingFineGoldDate: e.target.value || undefined })}
                      className="rounded-lg mt-1 h-9" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Pure (24KT) gold already lying with this factory. Added onto their Fine Gold balance.</p>
              </div>
            </div>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl mt-3">{saving ? "Creating…" : "Create Factory"}</Button>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <AccountSummary
        receivable={totals.receivable}
        payable={totals.payable}
        fmt={fmtMoneyInr}
        receivableSub="factories owe us · ughrani"
        payableSub="charges due · chukavni"
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search factories..." className="pl-9 h-11 rounded-xl" />
        </div>
        <div className="shrink-0 inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60">
          <button onClick={() => saveView("list")} aria-label="List view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span>
          </button>
          <button onClick={() => saveView("grid")} aria-label="Grid view"
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs font-medium transition-colors ${view === "grid" ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            <LayoutGrid className="h-3.5 w-3.5" /><span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* ── List view — name + gold held + charges due ── */}
      {view === "list" && (
        <div className="card-luxe divide-y divide-border/50 overflow-hidden">
          {paged.map(fac => {
            const issuances = db.materialIssuances.filter(i => i.factoryId === fac.id);
            const account = factoryAccount(issuances, fac);
            const fineGold = factoryFineGoldBalance(db.materialIssuances, fac.id, fac.openingFineGold);
            return (
              <Link key={fac.id} to={`/factories/${fac.id}`} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/40 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-orange-500/15 text-orange-600 grid place-items-center shrink-0"><FactoryIcon className="h-4.5 w-4.5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-dark truncate">{fac.name}{fac.active === false && <span className="ml-2 text-[10px] text-muted-foreground">(inactive)</span>}</p>
                  {/* Two boxes — reserved Fine Gold (24KT) + Diamond, matching the details page */}
                  <div className="flex gap-2 mt-1.5">
                    <div className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <span className="block text-[8.5px] uppercase tracking-wide text-muted-foreground leading-none">Fine Gold 24KT</span>
                      <span className="text-xs font-semibold text-amber-700 tabular-nums">{fineGold.toLocaleString()} g</span>
                    </div>
                    <div className="px-2.5 py-1 rounded-lg bg-secondary border border-border/60">
                      <span className="block text-[8.5px] uppercase tracking-wide text-muted-foreground leading-none">Diamond</span>
                      <span className={`text-xs font-semibold tabular-nums ${account.diamondOutstanding < 0 ? "text-destructive" : ""}`}>{account.diamondOutstanding.toLocaleString()} ct</span>
                    </div>
                  </div>
                </div>
                {/* Charges ledger — Charged / Paid / Balance, segmented panel */}
                <div className="hidden sm:flex items-stretch rounded-xl border border-border/60 bg-secondary/30 overflow-hidden shrink-0 text-right">
                  <div className="px-3.5 py-1.5 min-w-[84px]"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Charged</p><p className="text-xs font-medium tabular-nums">{fmtMoneyInr(account.chargesTotal)}</p></div>
                  <div className="px-3.5 py-1.5 min-w-[72px] border-l border-border/50"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Paid</p><p className="text-xs font-medium tabular-nums text-success">{fmtMoneyInr(account.chargesPaid)}</p></div>
                  <div className="px-3.5 py-1.5 min-w-[84px] border-l border-border/50"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Balance</p>
                    {account.chargesPending > 0
                      ? <p className="text-xs font-semibold tabular-nums text-destructive">{fmtMoneyInr(account.chargesPending)}</p>
                      : account.chargesOverpaid > 0
                      ? <p className="text-xs font-semibold tabular-nums text-blue-600">+{fmtMoneyInr(account.chargesOverpaid)}</p>
                      : <p className="text-xs font-semibold text-success">✓ Cleared</p>}
                  </div>
                </div>
                {/* Mobile — balance only */}
                <div className="sm:hidden text-right shrink-0">
                  {account.chargesPending > 0
                    ? <><p className="text-sm font-semibold text-destructive">{fmtMoneyInr(account.chargesPending)}</p><p className="text-[10px] text-muted-foreground">charges due</p></>
                    : account.chargesOverpaid > 0
                    ? <><p className="text-sm font-semibold text-blue-600">{fmtMoneyInr(account.chargesOverpaid)}</p><p className="text-[10px] text-muted-foreground">advance paid</p></>
                    : <p className="text-sm font-semibold text-success">✓ Cleared</p>}
                </div>
                <ChevronRight className="hidden sm:block h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
              </Link>
            );
          })}
          {total === 0 && <div className="p-12 text-center text-muted-foreground">No factories found.</div>}
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(fac => {
          const issuances = db.materialIssuances.filter(i => i.factoryId === fac.id);
          const account = factoryAccount(issuances);
          const goldPool = factoryPoolBuckets(issuances, fac.id, "gold").reduce((s, b) => s + b.balance, 0);
          const diaPool = factoryPoolBuckets(issuances, fac.id, "diamond").reduce((s, b) => s + b.balance, 0);
          return (
            <div key={fac.id} className="card-luxe card-hover p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-500/15 to-orange-400/20 text-orange-600 grid place-items-center shrink-0 ring-1 ring-orange-500/10">
                  <FactoryIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg text-brand-dark truncate leading-tight">{fac.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{fac.contactPerson || "—"}</p>
                </div>
                {fac.active === false && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">Inactive</span>}
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" />{fac.phone || "—"}</p>
                {fac.address && <p className="flex items-center gap-2 text-muted-foreground truncate"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{fac.address}</span></p>}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-secondary text-center">
                  <p className="text-[10px] text-muted-foreground">Gold Out</p>
                  <p className="text-xs font-semibold">{account.goldOutstanding.toLocaleString()} g</p>
                </div>
                <div className="p-2.5 rounded-xl bg-secondary text-center">
                  <p className="text-[10px] text-muted-foreground">Diamond Out</p>
                  <p className="text-xs font-semibold">{account.diamondOutstanding.toLocaleString()} ct</p>
                </div>
                <div className={`p-2.5 rounded-xl text-center ${account.chargesPending > 0 ? "bg-destructive/5" : account.chargesOverpaid > 0 ? "bg-blue-500/5" : "bg-success/8"}`}>
                  <p className="text-[10px] text-muted-foreground">{account.chargesOverpaid > 0 && account.chargesPending === 0 ? "Advance Paid" : "Charges Due"}</p>
                  <p className={`text-xs font-semibold ${account.chargesPending > 0 ? "text-destructive" : account.chargesOverpaid > 0 ? "text-blue-600" : "text-success"}`}>
                    {account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : account.chargesOverpaid > 0 ? fmtMoneyInr(account.chargesOverpaid) : "✓ Cleared"}
                  </p>
                </div>
              </div>

              {(goldPool > 0 || diaPool > 0) && (
                <p className="mt-2 text-[11px] text-orange-600 flex items-center gap-1"><Package className="h-3 w-3" />Pool stock: {goldPool.toLocaleString()} g gold · {diaPool.toLocaleString()} ct dia</p>
              )}

              <p className="text-[11px] text-muted-foreground mt-2">Added {fmtDate(fac.createdAt)}</p>

              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
                  <Link to={`/factories/${fac.id}`}><History className="h-4 w-4 text-primary" />View Ledger</Link>
                </Button>
                {isAdmin && (
                <div className="flex gap-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(fac)} className="rounded-lg flex-1">
                    {fac.active === false ? "Activate" : "Deactivate"}
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => del(fac.id)} className="rounded-lg w-9 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>
                </div>
                )}
              </div>
            </div>
          );
        })}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No factories found.</div>}
      </div>
      )}

      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} factories` : undefined} />
    </div>
  );
}
