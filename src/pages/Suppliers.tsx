import { useState } from "react";
import { Link } from "react-router-dom";
import { updateDb, uid, fmtDate, type Supplier } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { supplierAccount, fmtMoneyInr } from "@/lib/manufacturing";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Truck, History, Hash } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

const PAGE_SIZE = 9;

export function SuppliersPage() {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Supplier>>({ name: "", contactPerson: "", phone: "", email: "", address: "", gstin: "" });

  const list = db.suppliers.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) || (s.contactPerson || "").toLowerCase().includes(q.toLowerCase()),
  );
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  const create = () => {
    if (!f.name?.trim()) { toast.error("Enter a supplier name"); return; }
    setSaving(true);
    try {
      updateDb(d => {
        if (!d.suppliers) d.suppliers = [];
        d.suppliers.unshift({ ...f, name: f.name!.trim(), id: uid("sup_"), active: true, createdAt: new Date().toISOString() } as Supplier);
      });
      toast.success("Supplier added");
      setOpen(false);
      setF({ name: "", contactPerson: "", phone: "", email: "", address: "", gstin: "" });
    } finally { setSaving(false); }
  };

  const toggle = (s: Supplier) => {
    updateDb(d => { const x = d.suppliers.find(x => x.id === s.id); if (x) x.active = !x.active; });
    toast.success("Status updated");
  };

  const del = (id: string) => {
    if (!confirm("Delete supplier? This does not delete their purchase history.")) return;
    updateDb(d => { d.suppliers = d.suppliers.filter(s => s.id !== id); });
    toast.success("Deleted");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Suppliers</h1>
          <p className="text-sm text-muted-foreground">{total} supplier{total !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Supplier</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">Add Supplier</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {(["name", "contactPerson", "phone", "email", "address", "gstin"] as const).map(k => (
                <div key={k} className={k === "address" || k === "name" ? "col-span-2" : ""}>
                  <Label className="text-xs capitalize">
                    {k === "gstin" ? "GSTIN" : k === "contactPerson" ? "Contact Person" : k.replace(/([A-Z])/g, " $1")}
                  </Label>
                  <Input
                    value={(f as Record<string, string>)[k] || ""}
                    onChange={e => setF({ ...f, [k]: e.target.value })}
                    className="rounded-xl mt-1"
                  />
                </div>
              ))}
            </div>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl mt-3">{saving ? "Creating…" : "Create Supplier"}</Button>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search suppliers..." className="pl-9 h-11 rounded-xl" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(s => {
          const purchases = db.purchases.filter(p => p.supplierId === s.id);
          const account = supplierAccount(purchases, (db.supplierReceipts ?? []).filter(r => r.supplierId === s.id));
          return (
            <div key={s.id} className="card-luxe card-hover p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-400/20 text-amber-600 grid place-items-center shrink-0 ring-1 ring-amber-500/10">
                  <Truck className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg text-brand-dark truncate leading-tight">{s.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{s.contactPerson || "—"}</p>
                </div>
                {s.active === false && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">Inactive</span>}
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground truncate"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s.email || "—"}</span></p>
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" />{s.phone || "—"}</p>
                {s.gstin && <p className="flex items-center gap-2 text-muted-foreground"><Hash className="h-3.5 w-3.5" />{s.gstin}</p>}
                {s.address && <p className="flex items-center gap-2 text-muted-foreground truncate"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s.address}</span></p>}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-secondary text-center">
                  <p className="text-[10px] text-muted-foreground">Purchased</p>
                  <p className="text-xs font-semibold">{fmtMoneyInr(account.totalPurchased)}</p>
                </div>
                <div className={`p-2.5 rounded-xl text-center ${account.balanceOwed > 0 ? "bg-destructive/5" : "bg-success/8"}`}>
                  <p className="text-[10px] text-muted-foreground">Owed</p>
                  <p className={`text-xs font-semibold ${account.balanceOwed > 0 ? "text-destructive" : "text-success"}`}>
                    {account.balanceOwed > 0 ? fmtMoneyInr(account.balanceOwed) : "✓ Cleared"}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground mt-2">Supplier since {fmtDate(s.createdAt)}</p>

              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
                  <Link to={`/suppliers/${s.id}`}><History className="h-4 w-4 text-primary" />View Ledger</Link>
                </Button>
                {isAdmin && (
                <div className="flex gap-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(s)} className="rounded-lg flex-1">
                    {s.active === false ? "Activate" : "Deactivate"}
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => del(s.id)} className="rounded-lg w-9 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>
                </div>
                )}
              </div>
            </div>
          );
        })}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No suppliers found.</div>}
      </div>

      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} suppliers` : undefined} />
    </div>
  );
}
