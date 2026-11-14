import { studioOn } from "@/lib/studio";
import { PageViewsButton } from "@/components/SavedViews";
import { customColumns } from "@/components/CustomFields";
import { fieldsFor, filledPairs, searchWords, valuesOf } from "@/lib/customFields";
import { supplierFigures } from "@/lib/partyTotals";
import { SupplierCreateDialog } from "@/components/create/SupplierCreateDialog";
import { useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateDb, uid, fmtDate, hasOpeningBalance, openingCreditAmt, openingDebitAmt, type Supplier } from "@/lib/db";
import { supplierDeleteGuard, deleteRefusal } from "@/lib/partyGuards";
import { SupplierEditDialog } from "@/components/SupplierEditDialog";
import { MoreMenu, useRightClickMenu, type MoreAction } from "@/components/MoreMenu";
import { chatAction } from "@/lib/whatsapp";
import { filled, noteText, type Detail } from "@/components/rowDetails";
import { useDb } from "@/hooks/useDb";
import { useCan, useHas } from "@/hooks/useCan";
import { useAuth } from "@/lib/auth";
import { supplierAccount, fmtMoneyInr } from "@/lib/manufacturing";
import { AccountSummary } from "@/components/AccountSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Truck, History, Hash, Rows3, LayoutGrid, Power, Pencil, Handshake, CalendarClock, ClipboardList } from "lucide-react";
import { DataTable, CellMain, CellTag, CellAmount, type DataColumn } from "@/components/DataTable";
import { PageHeader, TabBar, ViewSwitch } from "@/components/PageHeader";
import { PurchaseOrdersPanel } from "@/components/PurchaseOrders";
import { SuppliersToPay } from "@/components/SuppliersToPay";
import { BrokersPanel } from "@/components/BrokersPanel";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";
import { useUrlState } from "@/hooks/useUrlState";
import { useSupplierGoldOwed } from "@/hooks/useSupplierGold";
import { fmtG } from "@/lib/supplierGold";

const PAGE_SIZE = 9;

/** Fine grams owed back to a supplier in gold — none to show for one without a gold account. */
function GoldOwedCell({ g }: { g: number | undefined }) {
  if (g === undefined) return <span className="text-muted-foreground/50">—</span>;
  if (Math.abs(g) <= 0.0005) return <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Returned</span>;
  return <div><span className={`tabular-nums whitespace-nowrap font-semibold ${g > 0 ? "text-destructive" : "text-blue-600"}`}>{fmtG(g)}</span>
    <p className="text-[10px] text-muted-foreground whitespace-nowrap">fine · to give back</p></div>;
}

/** A click inside a card that does its own thing (its menu, its link), so it
 *  must not also open the supplier. The menu is portalled, but React still
 *  bubbles its clicks up through the card. */
const OWN_CLICK = "button,a,input,label,[role=menu],[role=menuitem],[data-no-row]";

export function SuppliersPage() {
  const db = useDb();
  const { user } = useAuth();
  // Custom fields on suppliers this person sees (lib/customFields.ts).
  const cfDefs = fieldsFor(db.settings, "suppliers", user);
  const can = useCan();
  // Suppliers and brokers: added, changed and removed by an admin, or by access
  // that gives Suppliers → Add / Edit / Delete (before 2026-11 an admin's alone).
  const mayAdd = can("suppliers", "add"), mayEdit = can("suppliers", "edit"), mayDelete = can("suppliers", "delete");
  // What we owe them (and gold owed): only with fig.payables — an admin always.
  const showOwed = useHas()("fig.payables");
  // Kept in the address: Back from a record returns to the list as it was left.
  const [q, setQ] = useUrlState("q");
  const [view, setView] = useState<"list" | "grid">(() => {
    // Opens on the list — what each owes and is owed, side by side; a choice made with the switch is kept.
    try { return (localStorage.getItem("suppliers-view") as "list" | "grid") || "list"; } catch { return "list"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("suppliers-view", v); } catch { /* ignore */ } };
  // A saved view keeps how the list was shown — list or grid (components/SavedViews.tsx).
  const layoutPart = { get: () => ({ layout: view }), set: (p: Record<string, string>) => { if (p.layout === "list" || p.layout === "grid") saveView(p.layout); } };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  // Suppliers, or the brokers (dalals) who bring purchases — remembered on this device.
  // Suppliers, the bills to pay (lib/supplierDue.ts), or the brokers — remembered on this device.
  const [tabPick, setTab] = useState<"suppliers" | "topay" | "po" | "brokers">(() => {
    try { const t = localStorage.getItem("suppliers-tab"); return t === "brokers" || t === "topay" || t === "po" ? t : "suppliers"; } catch { return "suppliers"; }
  });
  // "To pay" is what we owe: only for those who may see it.
  const tab = tabPick === "topay" && !showOwed ? "suppliers" : tabPick;
  const pickTab = (t: "suppliers" | "topay" | "po" | "brokers") => { setTab(t); try { localStorage.setItem("suppliers-tab", t); } catch { /* ignore */ } };
  const [newBroker, setNewBroker] = useState(false);
  const navigate = useNavigate();

  // Every supplier's account, worked out once: the rows, the sort and the grand
  // totals all read the same figures instead of each recomputing their own.
  // From the records when they are loaded, else the server's totals (this list
  // is light in pageData.ts and does not download the supplier books for them).
  const accounts = new Map(db.suppliers.map(s => [s.id, supplierFigures(db, s)]));
  const netOf = (s: Supplier) => accounts.get(s.id)?.net ?? 0;
  // Gold taken from them on loan, in fine grams — only for a supplier who has a
  // gold account; the column and the card's figure are there only then.
  const goldOwed = useSupplierGoldOwed(db.suppliers);
  const goldOf = (s: Supplier) => goldOwed?.get(s.id);

  // Whoever there is most money to settle with comes first — either way round,
  // since an overpaid supplier needs chasing as much as an unpaid one. Settled
  // suppliers fall to the bottom, alphabetically.
  const list = db.suppliers
    .filter(s =>
      s.name.toLowerCase().includes(q.toLowerCase()) || (s.contactPerson || "").toLowerCase().includes(q.toLowerCase())
      || (!!q.trim() && cfDefs.length > 0 && searchWords(cfDefs, valuesOf(db, "suppliers", s.id, s)).toLowerCase().includes(q.trim().toLowerCase())),
    )
    .sort((a, b) => Math.abs(netOf(b)) - Math.abs(netOf(a)) || a.name.localeCompare(b.name));
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE, "page", q);

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
  const ADMIN_ONLY = "Your access does not include changing suppliers";
  // Right-click on a card: its ⋯, where the mouse is (components/MoreMenu).
  const rightClick = useRightClickMenu();
  const actionsFor = (s: Supplier): MoreAction[] => {
    const guard = guardOf(s);
    return [
      { label: "View ledger", icon: History, hint: "Purchases, payments, statement", onSelect: () => navigate(`/suppliers/${s.id}`) },
      chatAction(s.name, s.phone),
      { label: "Edit details", icon: Pencil, onSelect: () => setEditing(s), disabled: !mayEdit, hint: mayEdit ? "Name, contact, GSTIN, address" : ADMIN_ONLY },
      { label: s.active === false ? "Activate" : "Deactivate", icon: Power, onSelect: () => toggle(s), disabled: !mayEdit, hint: mayEdit ? undefined : ADMIN_ONLY },
      { label: "Delete supplier", icon: Trash2, danger: true, onSelect: () => del(s),
        disabled: !mayDelete || !guard.ok, hint: !mayDelete ? "Your access does not include deleting suppliers" : guard.reason },
    ];
  };

  // A card opens the supplier, as a row does (Ctrl/⌘-click: a new tab).
  const openCard = (href: string) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
    else navigate(href);
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
    ...(goldOwed?.size ? [{ key: "gold", header: "Gold owed", align: "right" as const, kind: "number" as const,
      sortValue: (s: Supplier) => goldOf(s), csv: (s: Supplier) => goldOf(s) ?? "",
      cell: (s: Supplier) => <GoldOwedCell g={goldOf(s)} /> }] : []),
    // The business's own fields — a column each, shown from View.
    ...customColumns<Supplier>(cfDefs, s => valuesOf(db, "suppliers", s.id, s)),
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
      showOwed && a.balanceOwed > 0 && Math.abs(a.balanceOwed - a.net) > 0.5 && { label: "Unpaid bills", value: fmtMoneyInr(a.balanceOwed) },
      showOwed && a.overpaid > 0 && { label: "Overpaid on bills", value: fmtMoneyInr(a.overpaid) },
      showOwed && a.advanced > 0 && { label: "Advances / loans paid", value: fmtMoneyInr(a.advanced) },
      showOwed && a.received > 0 && { label: "Received back", value: fmtMoneyInr(a.received) },
      showOwed && hasOpeningBalance(s) && { label: "Opening balance", value: `${fmtMoneyInr(s.openingBalance || 0)} ${s.openingDir === "debit" ? "debit (they owed us)" : "credit (we owed them)"}${s.openingDate ? ` · as of ${fmtDate(s.openingDate)}` : ""}` },
      ...filledPairs(cfDefs, valuesOf(db, "suppliers", s.id, s)).map(([label, value]) => ({ label, value })),
    ]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {rightClick.menu}
      {/* How many there are is the table's (or the grid's) own count. */}
      <PageHeader
        title="Suppliers"
        subtitle={tab === "brokers" ? "Brokers who bring purchases, and their brokerage" : tab === "po" ? "What we asked suppliers for — and what came" : "Purchases, payments and balances"}
        primary={!mayAdd || tab === "po" ? null : tab === "brokers"
          ? { label: "New Broker", icon: Plus, onClick: () => setNewBroker(true) }
          : { label: "New Supplier", icon: Plus, onClick: () => setOpen(true) }}
        actions={tab === "suppliers" ? <ViewSwitch view={view} onChange={saveView} /> : undefined}
      />
      {mayAdd && <SupplierCreateDialog open={open} onOpenChange={setOpen} />}

      <TabBar label="Suppliers and brokers" value={tab} onChange={pickTab} tabs={[
        { key: "suppliers", label: "Suppliers", icon: Truck, count: db.suppliers.length },
        ...(showOwed ? [{ key: "topay" as const, label: "To pay", icon: CalendarClock }] : []),
        // What we asked suppliers for, before the goods came (components/PurchaseOrders).
        { key: "po" as const, label: "Purchase orders", icon: ClipboardList },
        { key: "brokers", label: "Brokers", icon: Handshake, count: (db.brokers ?? []).length },
      ]} />

      {tab === "topay" && <SuppliersToPay mayPay={can("payments", "add")} />}
      {tab === "po" && <PurchaseOrdersPanel />}

      {tab === "brokers" && <BrokersPanel mayAdd={mayAdd} mayEdit={mayEdit} mayDelete={mayDelete} creating={newBroker} onCreating={setNewBroker} />}

      {tab === "suppliers" && showOwed && <AccountSummary
        receivable={totals.receivable}
        payable={totals.payable}
        fmt={fmtMoneyInr}
        receivableSub="suppliers owe us · ughrani"
        payableSub="we owe suppliers · chukavni"
      />}

      {/* ── List view — the shared table: sort by any heading, Excel, pages.
          The page's own search (the same one the grid uses) sits in its
          toolbar; a new search starts it on page 1. ── */}
      {tab === "suppliers" && view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="suppliers"
            viewExtra={layoutPart}
            noun="supplier"
            search={{ value: q, onChange: setQ, placeholder: "Search suppliers..." }}
            resetKey={q}
            rows={list}
            columns={showOwed ? columns : columns.filter(c => c.key !== "balance" && c.key !== "gold")}
            rowKey={s => s.id}
            defaultSort={showOwed ? { key: "balance", dir: "desc" } : { key: "supplier", dir: "asc" }}
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
              gold: rows => `${fmtG(rows.reduce((t, s) => t + (goldOf(s) ?? 0), 0))} fine`,
            }}
            rowActions={actionsFor}
            emptyText="No suppliers found."
            emptyAction={!db.suppliers.length && mayAdd ? { label: "Add a supplier", onClick: () => setOpen(true) } : undefined}
          />
        </div>
      )}

      {/* The grid's one toolbar row, laid out like the table's. */}
      {tab === "suppliers" && view === "grid" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[9rem] sm:max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search suppliers..." aria-label="Search suppliers..." className="h-9 pl-9 rounded-xl bg-white" />
          </div>
          <span className="ml-auto" aria-hidden />
          <PageViewsButton table="suppliers" search={{ value: q, onChange: setQ }} extra={layoutPart} />
        </div>
      )}

      {tab === "suppliers" && view === "grid" && (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-auto-cards">
        {paged.map(s => {
          const account = accounts.get(s.id)!;
          const gold = goldOf(s);
          return (
            // The whole card opens the supplier; what can be done to them is in
            // its one ⋯ — the same menu as a list row, each item greyed with
            // its reason when it can't be done.
            <div key={s.id} onClick={openCard(`/suppliers/${s.id}`)} onContextMenu={rightClick.bind(() => actionsFor(s), s.name, `/suppliers/${s.id}`)} className="card-luxe card-hover p-5 flex flex-col min-w-0 cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-400/20 text-amber-600 grid place-items-center shrink-0 ring-1 ring-amber-500/10">
                  <Truck className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg text-brand-dark truncate leading-tight" title={s.name}>{s.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{s.contactPerson || "—"}</p>
                </div>
                {s.active === false && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0 mt-1">Inactive</span>}
                <MoreMenu size="sm" label={`Actions for ${s.name}`} actions={actionsFor(s)} className="relative after:absolute after:-inset-1" />
              </div>

              <div className="mt-4 space-y-2 text-sm min-w-0">
                <p className="flex items-center gap-2 text-muted-foreground min-w-0"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={s.email || undefined}>{s.email || "—"}</span></p>
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5 shrink-0" />{s.phone || "—"}</p>
                {s.gstin && <p className="flex items-center gap-2 text-muted-foreground min-w-0"><Hash className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s.gstin}</span></p>}
                {s.address && <p className="flex items-center gap-2 text-muted-foreground min-w-0"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={s.address}>{s.address}</span></p>}
              </div>

              {/* Figures: colour on the figure only, a zero in grey. The owed
                  figure is the NET position, the same one the list and the
                  ledger show. It used to read balanceOwed, which only counts
                  unpaid bills: a supplier holding an advance has no unpaid
                  bill, so the card said "Cleared" while their ledger said they
                  owed us money. */}
              <div className={`mt-4 pt-3 grid ${!showOwed ? "grid-cols-1" : gold === undefined ? "grid-cols-2" : "grid-cols-3"} gap-1.5 border-t border-border/50 text-center`}>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Purchased</p>
                  <p className={`text-xs font-semibold tabular-nums ${account.totalPurchased ? "text-brand-dark" : "text-muted-foreground"}`}>{fmtMoneyInr(account.totalPurchased)}</p>
                </div>
                {showOwed && <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">{account.net < 0 ? "Owes you" : "Owed"}</p>
                  <p className={`text-xs font-semibold tabular-nums ${account.net > 0 ? "text-destructive" : account.net < 0 ? "text-blue-600" : "text-success"}`}>
                    {account.net > 0 ? fmtMoneyInr(account.net)
                      : account.net < 0 ? fmtMoneyInr(-account.net)
                      : "✓ Cleared"}
                  </p>
                </div>}
                {showOwed && gold !== undefined && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Gold owed</p>
                    <p className={`text-xs font-semibold tabular-nums ${gold > 0.0005 ? "text-destructive" : gold < -0.0005 ? "text-blue-600" : "text-success"}`}>
                      {Math.abs(gold) > 0.0005 ? `${fmtG(gold)} fine` : "✓ Returned"}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-auto pt-3 flex items-center gap-2">
                <p className="text-[11px] text-muted-foreground truncate">Supplier since {fmtDate(s.createdAt)}</p>
                <Button asChild variant="outline" size="sm" className="ml-auto h-8 rounded-lg gap-1.5 shrink-0 relative after:absolute after:-inset-1">
                  <Link to={`/suppliers/${s.id}`}><History className="h-3.5 w-3.5 text-primary" />View Ledger</Link>
                </Button>
              </div>
            </div>
          );
        })}
        {total === 0 && <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No suppliers found.</div>}
      </div>
      )}

      {/* The list pages itself; these pages are the grid's. */}
      {tab === "suppliers" && view === "grid" && <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} label={total > 0 ? `Showing ${start + 1}–${end} of ${total} suppliers` : undefined} />}

      <SupplierEditDialog supplier={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
