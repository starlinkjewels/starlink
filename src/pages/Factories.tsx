import { studioOn } from "@/lib/studio";
import { factoryFigures } from "@/lib/partyTotals";
import { FactoryCreateDialog } from "@/components/create/FactoryCreateDialog";
import { useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, hasOpeningBalance, openingCreditAmt, openingDebitAmt, type Factory } from "@/lib/db";
import { factoryDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { FactoryEditDialog } from "@/components/FactoryEditDialog";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { filled, noteText, type Detail } from "@/components/rowDetails";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { factoryAccount, factoryPoolBuckets, factoryFineGoldBalance, fmtMoneyInr } from "@/lib/manufacturing";
import { AccountSummary } from "@/components/AccountSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Factory as FactoryIcon, History, Rows3, LayoutGrid, Package, Power, Pencil } from "lucide-react";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { PageHeader, ViewSwitch } from "@/components/PageHeader";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";

const PAGE_SIZE = 9;

/** A click inside a card that does its own thing (its menu, its link), so it
 *  must not also open the factory. The menu is portalled, but React still
 *  bubbles its clicks up through the card. */
const OWN_CLICK = "button,a,input,label,[role=menu],[role=menuitem],[data-no-row]";

export function FactoriesPage() {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => {
    // The new look opens on the list (slim rows on a phone); a choice made with the switch is kept.
    try { return (localStorage.getItem("factories-view") as "list" | "grid") || (studioOn() ? "list" : "grid"); } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("factories-view", v); } catch { /* ignore */ } };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Factory | null>(null);
  const navigate = useNavigate();

  // Every factory's figures, worked out once — rows, sort and totals share it.
  // From the records when they are loaded, else the server's totals (this list
  // is light in pageData.ts and does not download the factory books for them).
  const accounts = new Map(db.factories.map(fac => [fac.id, factoryFigures(db, fac)]));
  // The largest labour bill outstanding comes first, whichever way it runs.
  const weight = (fac: Factory) => {
    const a = accounts.get(fac.id);
    return a ? Math.max(a.chargesPending, a.chargesOverpaid) : 0;
  };
  const list = db.factories
    .filter(fac =>
      fac.name.toLowerCase().includes(q.toLowerCase()) || (fac.contactPerson || "").toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name));
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  // Grand totals across ALL factories: charges we still owe (payable) vs charges
  // we overpaid and the factory owes us back (receivable).
  const totals = db.factories.reduce((acc, fac) => {
    const a = accounts.get(fac.id)!;
    acc.payable += a.chargesPending;
    acc.receivable += a.chargesOverpaid;
    return acc;
  }, { payable: 0, receivable: 0 });


  const toggle = (fac: Factory) => {
    updateDb(d => { const x = d.factories.find(x => x.id === fac.id); if (x) x.active = !x.active; });
    toast.success("Status updated");
  };

  // Only a factory nothing hangs off may be deleted — one with material
  // issued, payments or an order assigned is deactivated instead. The menu
  // greys Delete out with the reason (from the totals on this light page);
  // the delete itself loads the books and counts before it asks.
  const guardOf = (fac: Factory) => factoryDeleteGuard(db, fac, accounts.get(fac.id));
  const del = async (fac: Factory) => {
    const refused = await deleteRefusal("factory", fac);
    if (refused) { toast.error(refused); return; }
    const opening = hasOpeningBalance(fac) ? openingCreditAmt(fac) || openingDebitAmt(fac) : 0;
    if (!(await confirmBox([
      `Delete ${fac.name}?`,
      "",
      "• it has no material issued, no payments and no order assigned, so no other record changes",
      ...(opening ? [`• its opening balance of ${fmtMoneyInr(opening)} goes with it`] : []),
      ...(fac.openingFineGold ? [`• its opening fine gold of ${fac.openingFineGold} g goes with it`] : []),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    let gone = false;
    updateDb(d => {
      // Counted again on the live records: something may have been issued or
      // paid while the question was open.
      const live = d.factories.find(f => f.id === fac.id);
      if (!live || !factoryDeleteGuard(d, live).ok) return;
      d.factories = d.factories.filter(f => f.id !== fac.id);
      gone = true;
    });
    if (!gone) { toast.error("Could not delete — something was recorded for it meanwhile"); return; }
    toast.success("Deleted");
  };

  // View first, then the changes — each greyed out with the reason when it
  // can't be done, never left out. Changing a factory is an admin's job.
  const ADMIN_ONLY = "Only an admin can change factories";
  const actionsFor = (fac: Factory): MoreAction[] => {
    const guard = guardOf(fac);
    return [
      { label: "View ledger", icon: History, hint: "Material issued, labour and payments", onSelect: () => navigate(`/factories/${fac.id}`) },
      { label: "Edit details", icon: Pencil, onSelect: () => setEditing(fac), disabled: !isAdmin, hint: isAdmin ? "Name, contact, phone, address" : ADMIN_ONLY },
      { label: fac.active === false ? "Activate" : "Deactivate", icon: Power, onSelect: () => toggle(fac), disabled: !isAdmin, hint: isAdmin ? undefined : ADMIN_ONLY },
      { label: "Delete factory", icon: Trash2, danger: true, onSelect: () => del(fac),
        disabled: !isAdmin || !guard.ok, hint: !isAdmin ? ADMIN_ONLY : guard.reason },
    ];
  };

  // ── List view: the shared table ──
  const accountOf = (fac: Factory) => accounts.get(fac.id)!;
  // A card opens the factory, as a row does (Ctrl/⌘-click: a new tab).
  const openCard = (href: string) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
    else navigate(href);
  };
  const grams = (n: number) => `${n.toLocaleString()} g`;
  const carats = (n: number) => `${n.toLocaleString()} ct`;
  const columns: DataColumn<Factory>[] = [
    { key: "factory", header: "Factory", always: true, sortValue: fac => fac.name, csv: fac => fac.name,
      cell: fac => <CellMain
        title={<>{fac.name}{fac.active === false && <span className="ml-2 align-middle"><CellTag>Inactive</CellTag></span>}</>}
        sub={fac.contactPerson || fac.phone || undefined} /> },
    // Reserved fine gold (24KT, opening included) and diamond — the figures the
    // factory's own page shows.
    { key: "gold", header: "Fine gold 24KT", align: "right", kind: "number", sortValue: fac => accountOf(fac).fineGold,
      cell: fac => { const g = accountOf(fac).fineGold; return <span className={`tabular-nums whitespace-nowrap font-semibold ${g < 0 ? "text-destructive" : "text-amber-700"}`}>{grams(g)}</span>; } },
    { key: "diamond", header: "Diamond", align: "right", kind: "number", sortValue: fac => accountOf(fac).diamondOutstanding,
      cell: fac => { const d = accountOf(fac).diamondOutstanding; return <span className={`tabular-nums whitespace-nowrap font-semibold ${d < 0 ? "text-destructive" : "text-brand-dark"}`}>{carats(d)}</span>; } },
    { key: "charged", header: "Charged", align: "right", kind: "number", sortValue: fac => accountOf(fac).chargesTotal,
      cell: fac => <CellAmount>{fmtMoneyInr(accountOf(fac).chargesTotal)}</CellAmount> },
    { key: "paid", header: "Paid", align: "right", kind: "number", sortValue: fac => accountOf(fac).chargesPaid,
      cell: fac => <CellAmount tone="in">{fmtMoneyInr(accountOf(fac).chargesPaid)}</CellAmount> },
    // Sorts by the labour bill to settle either way — the page's own order. In
    // Excel one signed figure: plus, charges due; minus, advance paid.
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: weight,
      csv: fac => Math.round((accountOf(fac).chargesPending - accountOf(fac).chargesOverpaid) * 100) / 100,
      cell: fac => {
        const a = accountOf(fac);
        if (a.chargesPending > 0) return <div><CellAmount tone="out">{fmtMoneyInr(a.chargesPending)}</CellAmount><p className="text-[10px] text-muted-foreground whitespace-nowrap">charges due</p></div>;
        if (a.chargesOverpaid > 0) return <div><span className="tabular-nums whitespace-nowrap font-semibold text-blue-600">+{fmtMoneyInr(a.chargesOverpaid)}</span><p className="text-[10px] text-muted-foreground whitespace-nowrap">advance paid</p></div>;
        return <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Cleared</span>;
      } },
  ];

  // What an opened row adds: the phone and address, the pool stock the grid
  // card shows, the diamond flow and the opening balances. From the same
  // figures as the row — this page never downloads the factory books.
  const factoryDetails = (fac: Factory): Detail[] => {
    const a = accountOf(fac);
    return filled([
      // The Factory column shows the contact person or the phone, not both.
      !!fac.contactPerson && !!fac.phone && { label: "Phone", value: <a href={`tel:${fac.phone}`} className="text-primary hover:underline">{fac.phone}</a> },
      { label: "Address", value: noteText(fac.address) },
      { label: "Added", value: fmtDate(fac.createdAt) },
      (a.goldPool > 0 || a.diaPool > 0) && { label: "Pool stock", value: `${grams(a.goldPool)} gold · ${carats(a.diaPool)} diamond` },
      a.diamondIssued > 0 && { label: "Diamond issued", value: `${carats(a.diamondIssued)} · ${carats(a.diamondUsed)} accounted for` },
      hasOpeningBalance(fac) && { label: "Opening balance", value: `${fmtMoneyInr(fac.openingBalance || 0)} ${fac.openingDir === "debit" ? "debit (they owed us)" : "credit (charges we owed)"}${fac.openingDate ? ` · as of ${fmtDate(fac.openingDate)}` : ""}` },
      !!fac.openingFineGold && { label: "Opening fine gold", value: `${grams(fac.openingFineGold)}${fac.openingFineGoldDate ? ` · as of ${fmtDate(fac.openingFineGoldDate)}` : ""}` },
    ]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* How many there are is the table's (or the grid's) own count. */}
      <PageHeader
        title="Factories"
        subtitle="Material, labour and payments"
        primary={isAdmin ? { label: "New Factory", icon: Plus, onClick: () => setOpen(true) } : null}
        actions={<ViewSwitch view={view} onChange={saveView} />}
      />
      {isAdmin && <FactoryCreateDialog open={open} onOpenChange={setOpen} />}

      <AccountSummary
        receivable={totals.receivable}
        payable={totals.payable}
        fmt={fmtMoneyInr}
        receivableSub="factories owe us · ughrani"
        payableSub="charges due · chukavni"
      />

      {/* ── List view — the shared table: sort by any heading, Excel, pages.
          The page's own search (the same one the grid uses) sits in its
          toolbar; a new search starts it on page 1. ── */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="factories"
            // The table makes a plural by adding "s"; it counts exactly these rows.
            noun="factory"
            plural="factories"
            search={{ value: q, onChange: setQ, placeholder: "Search factories..." }}
            resetKey={q}
            rows={list}
            columns={columns}
            rowKey={fac => fac.id}
            defaultSort={{ key: "balance", dir: "desc" }}
            rowHref={fac => `/factories/${fac.id}`}
            details={factoryDetails}
            exportName="Factories"
            totals={{
              gold: rows => <span className="text-amber-700">{grams(rows.reduce((t, fac) => t + accountOf(fac).fineGold, 0))}</span>,
              diamond: rows => carats(rows.reduce((t, fac) => t + accountOf(fac).diamondOutstanding, 0)),
              charged: rows => fmtMoneyInr(rows.reduce((t, fac) => t + accountOf(fac).chargesTotal, 0)),
              paid: rows => <span className="text-success">{fmtMoneyInr(rows.reduce((t, fac) => t + accountOf(fac).chargesPaid, 0))}</span>,
              // Each way on its own: charges we owe, and advances factories hold.
              balance: rows => {
                const due = rows.reduce((t, fac) => t + accountOf(fac).chargesPending, 0);
                const advance = rows.reduce((t, fac) => t + accountOf(fac).chargesOverpaid, 0);
                return <><span className="text-destructive">{fmtMoneyInr(due)}</span>{advance > 0 && <span className="text-blue-600"> · +{fmtMoneyInr(advance)}</span>}</>;
              },
            }}
            rowActions={actionsFor}
            emptyText="No factories found."
            emptyAction={!db.factories.length && isAdmin ? { label: "Add a factory", onClick: () => setOpen(true) } : undefined}
          />
        </div>
      )}

      {/* The grid's one toolbar row, laid out like the table's. */}
      {view === "grid" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search factories..." aria-label="Search factories..." className="h-9 pl-9 rounded-xl bg-white" />
          </div>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums whitespace-nowrap">{total} {total !== 1 ? "factories" : "factory"}</span>
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-auto-cards">
        {paged.map(fac => {
          const account = accounts.get(fac.id)!;
          // Fine (24KT) gold with the opening balance — the figure the factory's
          // own page shows. Raw grams in minus grams out mixed karats and left
          // the opening gold out, so the card could read −144 g for 18 g held.
          const { fineGold, goldPool, diaPool } = account;
          return (
            // The whole card opens the factory; what can be done to it is in
            // its one ⋯ — the same menu as a list row, each item greyed with
            // its reason when it can't be done.
            <div key={fac.id} onClick={openCard(`/factories/${fac.id}`)} className="card-luxe card-hover p-5 flex flex-col min-w-0 cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-500/15 to-orange-400/20 text-orange-600 grid place-items-center shrink-0 ring-1 ring-orange-500/10">
                  <FactoryIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg text-brand-dark truncate leading-tight" title={fac.name}>{fac.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{fac.contactPerson || "—"}</p>
                </div>
                {fac.active === false && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0 mt-1">Inactive</span>}
                <MoreMenu size="sm" label={`Actions for ${fac.name}`} actions={actionsFor(fac)} className="relative after:absolute after:-inset-1" />
              </div>

              <div className="mt-4 space-y-2 text-sm min-w-0">
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5 shrink-0" />{fac.phone || "—"}</p>
                {fac.address && <p className="flex items-center gap-2 text-muted-foreground min-w-0"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={fac.address}>{fac.address}</span></p>}
              </div>

              {/* Figures: colour on the figure only, a zero in grey. */}
              <div className="mt-4 pt-3 grid grid-cols-3 gap-1.5 border-t border-border/50 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Fine Gold</p>
                  <p className={`text-xs font-semibold tabular-nums ${fineGold < 0 ? "text-destructive" : fineGold ? "text-brand-dark" : "text-muted-foreground"}`}>{fineGold.toLocaleString()} g</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Diamond</p>
                  <p className={`text-xs font-semibold tabular-nums ${account.diamondOutstanding < 0 ? "text-destructive" : account.diamondOutstanding ? "text-brand-dark" : "text-muted-foreground"}`}>{account.diamondOutstanding.toLocaleString()} ct</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">{account.chargesOverpaid > 0 && account.chargesPending === 0 ? "Advance Paid" : "Charges Due"}</p>
                  <p className={`text-xs font-semibold tabular-nums ${account.chargesPending > 0 ? "text-destructive" : account.chargesOverpaid > 0 ? "text-blue-600" : "text-success"}`}>
                    {account.chargesPending > 0 ? fmtMoneyInr(account.chargesPending) : account.chargesOverpaid > 0 ? fmtMoneyInr(account.chargesOverpaid) : "✓ Cleared"}
                  </p>
                </div>
              </div>

              {(goldPool > 0 || diaPool > 0) && (
                <p className="mt-2 text-[11px] text-orange-600 flex items-center gap-1"><Package className="h-3 w-3" />Pool stock: {goldPool.toLocaleString()} g gold · {diaPool.toLocaleString()} ct dia</p>
              )}

              <div className="mt-auto pt-3 flex items-center gap-2">
                <p className="text-[11px] text-muted-foreground truncate">Added {fmtDate(fac.createdAt)}</p>
                <Button asChild variant="outline" size="sm" className="ml-auto h-8 rounded-lg gap-1.5 shrink-0 relative after:absolute after:-inset-1">
                  <Link to={`/factories/${fac.id}`}><History className="h-3.5 w-3.5 text-primary" />View Ledger</Link>
                </Button>
              </div>
            </div>
          );
        })}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No factories found.</div>}
      </div>
      )}

      {/* The list pages itself; these pages are the grid's. */}
      {view === "grid" && <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} factories` : undefined} />}

      <FactoryEditDialog factory={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
