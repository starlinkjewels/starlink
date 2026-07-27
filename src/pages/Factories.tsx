import { useState } from "react";
import { Link } from "react-router-dom";
import { updateDb, uid, fmtDate, type Factory } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { factoryAccount, fmtMoneyInr } from "@/lib/manufacturing";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Factory as FactoryIcon, History } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

const PAGE_SIZE = 9;

export function FactoriesPage() {
  const db = useDb();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Factory>>({ name: "", contactPerson: "", phone: "", address: "" });

  const list = db.factories.filter(fac =>
    fac.name.toLowerCase().includes(q.toLowerCase()) || (fac.contactPerson || "").toLowerCase().includes(q.toLowerCase()),
  );
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

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
            </div>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl mt-3">{saving ? "Creating…" : "Create Factory"}</Button>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search factories..." className="pl-9 h-11 rounded-xl" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(fac => {
          const issuances = db.goldIssuances.filter(i => i.factoryId === fac.id);
          const account = factoryAccount(issuances);
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

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-secondary text-center">
                  <p className="text-[10px] text-muted-foreground">Gold Out</p>
                  <p className="text-xs font-semibold">{account.goldOutstanding.toLocaleString()} g</p>
                </div>
                <div className={`p-2.5 rounded-xl text-center ${account.chargesPending > 0 ? "bg-destructive/5" : "bg-success/8"}`}>
                  <p className="text-[10px] text-muted-foreground">Charges Due</p>
                  <p className={`text-xs font-semibold ${account.chargesPending > 0 ? "text-destructive" : "text-success"}`}>
                    {account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : "✓ Cleared"}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground mt-2">Added {fmtDate(fac.createdAt)}</p>

              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
                  <Link to={`/factories/${fac.id}`}><History className="h-4 w-4 text-primary" />View Ledger</Link>
                </Button>
                <div className="flex gap-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(fac)} className="rounded-lg flex-1">
                    {fac.active === false ? "Activate" : "Deactivate"}
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => del(fac.id)} className="rounded-lg w-9 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>
                </div>
              </div>
            </div>
          );
        })}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No factories found.</div>}
      </div>

      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} factories` : undefined} />
    </div>
  );
}
