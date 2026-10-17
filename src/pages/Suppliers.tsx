import { supplierFigures } from "@/lib/partyTotals";
import { SupplierCreateDialog } from "@/components/create/SupplierCreateDialog";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, hasOpeningBalance, openingCreditAmt, openingDebitAmt, type Supplier } from "@/lib/db";
import { supplierDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { SupplierEditDialog } from "@/components/SupplierEditDialog";
import type { MoreAction } from "@/components/MoreMenu";
import { filled, noteText, type Detail } from "@/components/rowDetails";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { supplierAccount, fmtMoneyInr } from "@/lib/manufacturing";
import { AccountSummary } from "@/components/AccountSummary";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Truck, History, Hash, Rows3, LayoutGrid, Power, Pencil } from "lucide-react";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";

const PAGE_SIZE = 9;

export function SuppliersPage() {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("suppliers-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("suppliers-view", v); } catch { /* ignore */ } };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const navigate = useNavigate();

  // Every supplier's account, worked out once: the rows, the sort and the grand
  // totals all read the same figures instead of each recomputing their own.
  // From the records when they are loaded, else the server's totals (this list
  // is light in pageData.ts and does not download the supplier books for them).
  const accounts = new Map(db.suppliers.map(s => [s.id, supplierFigures(db, s)]));
  const netOf = (s: Supplier) => accounts.get(s.id)?.net ?? 0;

  // Whoever there is most money to settle with comes first — either way round,
  // since an overpaid supplier needs chasing as much as an unpaid one. Settled
  // suppliers fall to the bottom, alphabetically.
  const list = db.suppliers
    .filter(s =>
      s.name.toLowerCase().includes(q.toLowerCase()) || (s.contactPerson || "").toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => Math.abs(netOf(b)) - Math.abs(netOf(a)) || a.name.localeCompare(b.name));
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  // Grand totals across ALL suppliers (not just the search/current page):
  // net > 0 → we still owe them (payable); net < 0 → they owe us (receivable).
  const totals = db.suppliers.reduce((acc, s) => {
    const net = netOf(s);
    if (net > 0) acc.payable += net; else acc.receivable += -net;
    return acc;
  }, { payable: 0, receivable: 0 });


  const toggle = (s: Supplier) => {
    updateDb(d => { const x = d.suppliers.find(x => x.id === s.id); if (x) x.active = !x.active; });
    toast.success("Status updated");
  };

  // Only a supplier nothing hangs off may be deleted — one with purchases or
  // payments is deactivated instead, or those records point at nobody. The
  // menu greys Delete out with the reason (from the totals on this light
  // page); the delete itself loads the books and counts before it asks.
  const guardOf = (s: Supplier) => supplierDeleteGuard(db, s, accounts.get(s.id));
  const del = async (s: Supplier) => {
    const refused = await deleteRefusal("supplier", s);
    if (refused) { toast.error(refused); return; }
    const opening = hasOpeningBalance(s) ? openingCreditAmt(s) || openingDebitAmt(s) : 0;
    if (!(await confirmBox([
      `Delete ${s.name}?`,
      "",
      "• they have no purchases, payments or refunds, so no other record changes",
      ...(opening ? [`• their opening balance of ${fmtMoneyInr(opening)} goes with them`] : []),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    let gone = false;
    updateDb(d => {
      // Counted again on the live records: a purchase or payment may have
      // been recorded while the question was open.
      const live = d.suppliers.find(x => x.id === s.id);
      if (!live || !supplierDeleteGuard(d, live).ok) return;
      d.suppliers = d.suppliers.filter(x => x.id !== s.id);
      gone = true;
    });
    if (!gone) { toast.error("Could not delete — something was recorded for them meanwhile"); return; }
    toast.success("Deleted");
  };

  // View first, then the changes — each greyed out with the reason when it
  // can't be done, never left out. Changing a supplier is an admin's job.
  const ADMIN_ONLY = "Only an admin can change suppliers";
  const actionsFor = (s: Supplier): MoreAction[] => {
    const guard = guardOf(s);
    return [
      { label: "View ledger", icon: History, hint: "Purchases, payments and the account statement", onSelect: () => navigate(`/suppliers/${s.id}`) },
      { label: "Edit details", icon: Pencil, onSelect: () => setEditing(s), disabled: !isAdmin, hint: isAdmin ? "Name, contact, GSTIN, address" : ADMIN_ONLY },
      { label: s.active === false ? "Activate" : "Deactivate", icon: Power, onSelect: () => toggle(s), disabled: !isAdmin, hint: isAdmin ? undefined : ADMIN_ONLY },
      { label: "Delete supplier", icon: Trash2, danger: true, onSelect: () => del(s),
        disabled: !isAdmin || !guard.ok, hint: !isAdmin ? ADMIN_ONLY : guard.reason },
    ];
  };

  // ── List view: the shared table ──
  const accountOf = (s: Supplier) => accounts.get(s.id)!;
  const columns: DataColumn<Supplier>[] = [
    { key: "supplier", header: "Supplier", always: true, sortValue: s => s.name, csv: s => s.name,
      cell: s => <CellMain
        title={<>{s.name}{s.active === false && <span className="ml-2 align-middle"><CellTag>Inactive</CellTag></span>}</>}
        sub={s.gstin ? `GSTIN ${s.gstin}` : undefined} /> },
    { key: "contact", header: "Contact", sortValue: s => s.contactPerson || s.phone || s.email || "",
      cell: s => s.contactPerson || s.phone || s.email
        ? <CellMain title={s.contactPerson || s.phone || s.email} sub={s.contactPerson ? [s.phone, s.email].filter(Boolean).join(" · ") || undefined : undefined} />
        : <span className="text-muted-foreground/50">—</span> },
    { key: "purchased", header: "Purchased", align: "right", kind: "number", sortValue: s => accountOf(s).totalPurchased,
      cell: s => <CellAmount>{fmtMoneyInr(accountOf(s).totalPurchased)}</CellAmount> },
    { key: "paid", header: "Paid", align: "right", kind: "number", sortValue: s => accountOf(s).totalPaid,
      cell: s => <CellAmount tone="in">{fmtMoneyInr(accountOf(s).totalPaid)}</CellAmount> },
    // Sorts by the money to settle either way — the page's own order. In Excel
    // the signed net: plus, we owe them; minus, they owe us.
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: s => Math.abs(netOf(s)), csv: s => netOf(s),
      cell: s => {
        const net = netOf(s);
        if (net > 0) return <div><CellAmount tone="out">{fmtMoneyInr(net)}</CellAmount><p className="text-[10px] text-muted-foreground whitespace-nowrap">you owe</p></div>;
        if (net < 0) return <div><span className="tabular-nums whitespace-nowrap font-semibold text-blue-600">+{fmtMoneyInr(-net)}</span><p className="text-[10px] text-muted-foreground whitespace-nowrap">owes you</p></div>;
        return <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Settled</span>;
      } },
  ];

  // What an opened row adds: the contact details the Contact column leaves out,
  // and the parts of the balance. From the same figures as the row — this page
  // never downloads the supplier books, so nothing here reads them either.
  const supplierDetails = (s: Supplier): Detail[] => {
    const a = accountOf(s);
    return filled([
      // The Contact column shows the phone or the email, not both, when no one is named.
      !s.contactPerson && !!s.phone && !!s.email && { label: "Email", value: <a href={`mailto:${s.email}`} className="text-primary hover:underline break-all">{s.email}</a> },
      { label: "Address", value: noteText(s.address) },
      { label: "Supplier since", value: fmtDate(s.createdAt) },
      a.balanceOwed > 0 && Math.abs(a.balanceOwed - a.net) > 0.5 && { label: "Unpaid bills", value: fmtMoneyInr(a.balanceOwed) },
      a.overpaid > 0 && { label: "Overpaid on bills", value: fmtMoneyInr(a.overpaid) },
      a.advanced > 0 && { label: "Advances / loans paid", value: fmtMoneyInr(a.advanced) },
      a.received > 0 && { label: "Received back", value: fmtMoneyInr(a.received) },
      hasOpeningBalance(s) && { label: "Opening balance", value: `${fmtMoneyInr(s.openingBalance || 0)} ${s.openingDir === "debit" ? "debit (they owed us)" : "credit (we owed them)"}${s.openingDate ? ` · as of ${fmtDate(s.openingDate)}` : ""}` },
    ]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Suppliers</h1>
          <p className="text-sm text-muted-foreground">{total} supplier{total !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
          <>
            <Button onClick={() => setOpen(true)} className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Supplier</Button>
            <SupplierCreateDialog open={open} onOpenChange={setOpen} />
          </>
        )}
      </div>

      <AccountSummary
        receivable={totals.receivable}
        payable={totals.payable}
        fmt={fmtMoneyInr}
        receivableSub="suppliers owe us · ughrani"
        payableSub="we owe suppliers · chukavni"
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search suppliers..." className="pl-9 h-11 rounded-xl" />
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

      {/* ── List view — the shared table: sort by any heading, Excel, pages.
          The search above narrows it, as it does the grid. ── */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="suppliers"
            noun="supplier"
            rows={list}
            columns={columns}
            rowKey={s => s.id}
            defaultSort={{ key: "balance", dir: "desc" }}
            rowHref={s => `/suppliers/${s.id}`}
            details={supplierDetails}
            exportName="Suppliers"
            totals={{
              purchased: rows => fmtMoneyInr(rows.reduce((t, s) => t + accountOf(s).totalPurchased, 0)),
              paid: rows => <span className="text-success">{fmtMoneyInr(rows.reduce((t, s) => t + accountOf(s).totalPaid, 0))}</span>,
              // Each way on its own: what we owe, and what suppliers owe us.
              balance: rows => {
                const owe = rows.reduce((t, s) => t + Math.max(0, netOf(s)), 0);
                const owed = rows.reduce((t, s) => t + Math.max(0, -netOf(s)), 0);
                return <><span className="text-destructive">{fmtMoneyInr(owe)}</span>{owed > 0 && <span className="text-blue-600"> · +{fmtMoneyInr(owed)}</span>}</>;
              },
            }}
            rowActions={actionsFor}
            emptyText="No suppliers found."
          />
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-auto-cards">
        {paged.map(s => {
          const account = accounts.get(s.id)!;
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
                {/* The NET position, the same figure the list and the ledger show.
                    This used to read balanceOwed, which only counts unpaid bills:
                    a supplier holding an advance has no unpaid bill, so the card
                    said "Cleared" while their ledger said they owed us money. */}
                <div className={`p-2.5 rounded-xl text-center ${account.net > 0 ? "bg-destructive/5" : account.net < 0 ? "bg-blue-500/5" : "bg-success/8"}`}>
                  <p className="text-[10px] text-muted-foreground">{account.net < 0 ? "Owes you" : "Owed"}</p>
                  <p className={`text-xs font-semibold ${account.net > 0 ? "text-destructive" : account.net < 0 ? "text-blue-600" : "text-success"}`}>
                    {account.net > 0 ? fmtMoneyInr(account.net)
                      : account.net < 0 ? fmtMoneyInr(-account.net)
                      : "✓ Cleared"}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground mt-2">Supplier since {fmtDate(s.createdAt)}</p>

              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
                  <Link to={`/suppliers/${s.id}`}><History className="h-4 w-4 text-primary" />View Ledger</Link>
                </Button>
                {isAdmin && (() => {
                  const guard = guardOf(s);
                  return (
                    <>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(s)} aria-label="Edit supplier" title="Edit details" className="rounded-lg w-9 px-0">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AsyncButton size="sm" variant="outline" onClick={() => toggle(s)} className="rounded-lg flex-1">
                          {s.active === false ? "Activate" : "Deactivate"}
                        </AsyncButton>
                        <AsyncButton size="sm" variant="outline" onClick={() => del(s)} disabled={!guard.ok} aria-label="Delete supplier"
                          title={guard.reason ?? "Delete supplier"}
                          className="rounded-lg w-9 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </AsyncButton>
                      </div>
                      {/* Why Delete is greyed, said on the card rather than only on hover. */}
                      {!guard.ok && <p className="text-[11px] text-muted-foreground leading-snug">Delete: {guard.reason}</p>}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No suppliers found.</div>}
      </div>
      )}

      {/* The list pages itself; these pages are the grid's. */}
      {view === "grid" && <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} suppliers` : undefined} />}

      <SupplierEditDialog supplier={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
