import { ClientCreateDialog } from "@/components/create/ClientCreateDialog";
import { ClientEditDialog } from "@/components/ClientEditDialog";
import { companiesOf, companiesForUser, companyById, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { useCan, useMayExport } from "@/hooks/useCan";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { PageHeader, ViewSwitch } from "@/components/PageHeader";
import { FilterChips, FiltersButton, type TableFilter } from "@/components/TableToolbar";
import { useEffect, useState, type MouseEvent } from "react";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { Link, useNavigate } from "react-router-dom";
import { loadDb, updateDbAs, fmtMoney, fmtDate, clientAccount, isOnline, timeAgo, currentUserClients, hasOpeningBalance, cashbackPercentFor, giftMaxRedeemPctFor, type Client, type Order } from "@/lib/db";
import { filled, refLink, noteText, type Detail } from "@/components/rowDetails";
import { AccountSummary } from "@/components/AccountSummary";
import { useDb } from "@/hooks/useDb";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Package, History, Printer, UserCog, KeyRound, Rows3, LayoutGrid, Camera, Pencil, Building2, Power, Eye } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { clientDeleteBlocker, deleteClientFlow, toggleClientActive } from "@/lib/clientActions";
import { needsAccess } from "@/lib/actionHints";

const PAGE_SIZE = 9;

/** A click inside a card that does its own thing (its menu, its link), so it
 *  must not also open the client. The menu is portalled, but React still
 *  bubbles its clicks up through the card. */
const OWN_CLICK = "button,a,input,label,[role=menu],[role=menuitem],[data-no-row]";

/** Open a new window with an A5 shipping label and auto-print it */
function printLabel(c: Client) {
  const win = window.open("", "_blank", "width=620,height=880");
  if (!win) { alert("Allow popups to print labels."); return; }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Shipping Label – ${c.companyName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    /* No size + margin:0 → browser prints no date/title/url headers or footers,
       on whatever paper the printer is set to (A4/A5/Letter). */
    @page { margin: 0; }
    html, body { background: #fff; font-family: Arial, Helvetica, sans-serif; }
    body {
      min-height: 100vh;
      padding: 14mm;
      display: flex; align-items: flex-start; justify-content: center;
    }
    .label {
      width: 100%; max-width: 150mm; min-height: 130mm;
      border: 2.5px solid #1a1a2e;
      border-radius: 6px;
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    /* ── SHIP TO ── */
    .ship-to-banner {
      background: #f0f0f0;
      padding: 3mm 8mm;
      font-size: 8pt; font-weight: 700;
      color: #555; letter-spacing: 2px; text-transform: uppercase;
      border-bottom: 1px solid #ddd;
    }
    /* ── fields ── */
    .body {
      flex: 1;
      padding: 7mm 8mm 6mm;
      display: flex; flex-direction: column; gap: 5.5mm;
    }
    .field { display: flex; align-items: baseline; gap: 3mm; }
    .field-label {
      font-size: 9pt; font-weight: 700; color: #666;
      min-width: 36mm; flex-shrink: 0;
    }
    .field-value {
      font-size: 12.5pt; font-weight: 600; color: #1a1a2e;
      line-height: 1.35;
    }
    /* ── footer ── */
    .footer {
      border-top: 1.5px solid #e0e0e0;
      padding: 3.5mm 8mm;
      font-size: 7.5pt; color: #999;
      display: flex; justify-content: space-between; align-items: center;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="ship-to-banner">Ship To</div>
    <div class="body">
      <div class="field">
        <div class="field-label">Name :</div>
        <div class="field-value">${c.companyName}${c.ownerName ? "<br><span style='font-size:10pt;font-weight:400;color:#555'>" + c.ownerName + "</span>" : ""}</div>
      </div>
      <div class="field">
        <div class="field-label">Address :</div>
        <div class="field-value">${(c.address || "—").replace(/\n/g, "<br>")}</div>
      </div>
      <div class="field">
        <div class="field-label">Zip :</div>
        <div class="field-value">${c.zip || "—"}</div>
      </div>
      <div class="field">
        <div class="field-label">Contact Number :</div>
        <div class="field-value">${c.phone || "—"}</div>
      </div>
    </div>
  </div>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

export function ClientsPage() {
  const { user } = useAuth();
  // Our companies — asked about only once there is more than one.
  const dbNow = loadDb();
  const multiCo = hasCompanies(dbNow.settings);
  const meUser = dbNow.users.find(u => u.id === user!.id) ?? user!;
  const myCompanies = companiesForUser(dbNow.settings, meUser);
  const [coFilter, setCoFilter] = useState("all");
  const can = useCan();
  const mayExport = useMayExport();
  const db = useDb();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("clients-view") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const saveView = (v: "list" | "grid") => { setView(v); try { localStorage.setItem("clients-view", v); } catch { /* ignore */ } };

  // Online/"last seen" is time-relative, not just data-relative — force a
  // re-render every 30s so it keeps ticking forward even with no db changes.
  const [, bumpClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => bumpClock(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const [open, setOpen] = useState(false);

  // Editing an existing client — the shared form (ClientEditDialog), the same
  // one the client's own page opens.
  const [editingId, setEditingId] = useState<string | null>(null);
  const openEdit = (c: Client) => setEditingId(c.id);

  const employees = db.users.filter(u => u.role === "employee");

  // Employee: the clients within their work (their own, or all when their
  // role reaches every client). Admin: everyone.
  const scoped = user!.role === "employee" ? currentUserClients(db, user!) : db.clients;

  // Every client's account, worked out once — the rows, the sort and the grand
  // totals all read the same figures.
  const accounts = new Map(scoped.map(c => [
    c.id,
    clientAccount(db.orders.filter(o => o.clientId === c.id && o.status !== "Rejected"), c.creditBalance || 0, c),
  ]));
  // The biggest account to settle comes first, whichever way it runs: money a
  // client owes us, or credit we are holding for them. Square accounts sink to
  // the bottom, alphabetically.
  const weight = (c: Client) => {
    const a = accounts.get(c.id);
    return a ? Math.max(a.outstanding, a.credit) : 0;
  };
  const list = scoped
    .filter(c => coFilter === "all" || companyIdOfClient(c) === coFilter)
    .filter(c =>
      c.companyName.toLowerCase().includes(q.toLowerCase()) ||
      c.ownerName.toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => weight(b) - weight(a) || a.companyName.localeCompare(b.companyName));

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  // The company filter, behind one Filters button in the table's (or the
  // grid's) toolbar — only once there is more than one company. "All" is the
  // page's own "all", so it narrows exactly as it did.
  const filters: TableFilter[] = multiCo ? [
    { kind: "select", label: "Company", value: coFilter === "all" ? "" : coFilter, onChange: v => setCoFilter(v || "all"),
      options: companiesOf(dbNow.settings).map(co => ({ value: co.id, label: co.name })), allLabel: "All companies" },
  ] : [];
  const clearFilters = () => setCoFilter("all");
  const countText = `${total} client${total !== 1 ? "s" : ""}`;

  // Grand totals across all clients this user can see: outstanding = money
  // clients owe us (receivable · ughrani); credit = advances we hold for them,
  // i.e. money we'd owe back (payable · chukavni). Rejected orders aren't billed.
  const totals = scoped.reduce((acc, c) => {
    const a = accounts.get(c.id)!;
    acc.receivable += a.outstanding;
    acc.payable += a.credit;
    return acc;
  }, { payable: 0, receivable: 0 });


  const resetPw = async (c: Client) => {
    const u = loadDb().users.find(x => x.clientId === c.id);
    const email = u?.email || c.email;
    if (!email) { toast.error("No login email on file for this client"); return; }
    try { await sendPasswordResetEmail(auth, email); toast.success(`Password reset email sent to ${email}`); }
    catch (e) { toast.error(authErrorMessage(e)); }
  };

  const toggle = (c: Client) => toggleClientActive(c.id);

  const togglePhotoAccess = (c: Client) => {
    updateDbAs({ summary: `${c.productPhotoAccess ? "Revoked" : "Granted"} Product Photos access — ${c.companyName}` }, d => {
      const x = d.clients.find(x => x.id === c.id)!;
      x.productPhotoAccess = !x.productPhotoAccess;
    });
    toast.success(c.productPhotoAccess ? "Photo access revoked" : "Photo access granted");
  };

  // Only a client with nothing on record can be deleted — anyone with orders,
  // invoices, receipts or gift cards is deactivated instead (clientActions.ts).
  const del = (id: string) => deleteClientFlow(id);
  const mayEdit = staffCan("edit");
  const mayDelete = staffCan("delete");
  function staffCan(action: "edit" | "delete") { return user!.role !== "client" && can("clients", action); }
  /** Why Delete is greyed for this client, if it is. */
  const deleteWhy = (c: Client) => (!mayDelete ? needsAccess("clients", "delete") : clientDeleteBlocker(db, c.id));

  // ── List view: the shared table ──
  // Order counts and each client's login, gathered in one pass — the table
  // reads them for every row it shows and sorts.
  const orderStats = new Map<string, { total: number; active: number }>();
  for (const o of db.orders) {
    const s = orderStats.get(o.clientId) ?? { total: 0, active: 0 };
    s.total++;
    if (!["Delivered", "Rejected"].includes(o.status)) s.active++;
    orderStats.set(o.clientId, s);
  }
  const statsOf = (c: Client) => orderStats.get(c.id) ?? { total: 0, active: 0 };
  // Each client's newest order, for an opened row.
  const lastOrder = new Map<string, Order>();
  for (const o of db.orders) {
    const prev = lastOrder.get(o.clientId);
    if (o.clientId && (!prev || o.createdAt > prev.createdAt)) lastOrder.set(o.clientId, o);
  }
  const loginOf = new Map<string, (typeof db.users)[number]>();
  for (const u of db.users) if (u.clientId && !loginOf.has(u.clientId)) loginOf.set(u.clientId, u);
  const accountOf = (c: Client) => accounts.get(c.id)!;
  const staff = user!.role !== "client";
  const columns: DataColumn<Client>[] = [
    { key: "client", header: "Client", always: true, sortValue: c => c.companyName, csv: c => c.companyName,
      cell: c => <CellMain
        title={<>{c.companyName}{c.status !== "active" && <span className="ml-2 align-middle"><CellTag>Inactive</CellTag></span>}</>}
        sub={c.ownerName || c.email || c.phone || "—"} /> },
    ...(multiCo ? [{ key: "company", header: "Company", sortValue: (c: Client) => companyById(dbNow.settings, companyIdOfClient(c)).name,
      cell: (c: Client) => <CellTag tone="blue">{companyById(dbNow.settings, companyIdOfClient(c)).name}</CellTag> }] : []),
    ...(user!.role === "admin" ? [{ key: "manager", header: "Handled by", hidden: true,
      sortValue: (c: Client) => employees.find(e => e.id === c.accountManagerId)?.name ?? "Admin",
      cell: (c: Client) => <span className="whitespace-nowrap">{employees.find(e => e.id === c.accountManagerId)?.name ?? "Admin"}</span> }] : []),
    { key: "orders", header: "Orders", align: "right", kind: "number", sortValue: c => statsOf(c).total,
      cell: c => {
        const s = statsOf(c);
        return <span className="tabular-nums whitespace-nowrap">{s.total}{s.active > 0 && <span className="text-[11px] font-medium text-primary"> · {s.active} active</span>}</span>;
      } },
    { key: "billed", header: "Billed", align: "right", kind: "number", sortValue: c => accountOf(c).billed,
      cell: c => <CellAmount>{fmtMoney(accountOf(c).billed)}</CellAmount> },
    { key: "received", header: "Received", align: "right", kind: "number", sortValue: c => accountOf(c).received,
      cell: c => <CellAmount tone="in">{fmtMoney(accountOf(c).received)}</CellAmount> },
    // Sorts by the money to settle either way — the page's own order. In Excel
    // one signed figure: plus, they owe us; minus, we hold their credit.
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: weight,
      csv: c => Math.round((accountOf(c).outstanding - accountOf(c).credit) * 100) / 100,
      cell: c => {
        const a = accountOf(c);
        if (a.outstanding > 0) return (
          <div>
            <CellAmount tone="out">{fmtMoney(a.outstanding)}</CellAmount>
            {a.credit > 0 && <p className="text-[10px] text-success tabular-nums whitespace-nowrap">+{fmtMoney(a.credit)} credit</p>}
          </div>
        );
        if (a.credit > 0) return <div><CellAmount tone="in">{fmtMoney(a.credit)}</CellAmount><p className="text-[10px] text-muted-foreground whitespace-nowrap">credit held</p></div>;
        return <span className="text-xs font-semibold text-success whitespace-nowrap">✓ Clear</span>;
      } },
    { key: "seen", header: "Last seen", kind: "date", sortValue: c => loginOf.get(c.id)?.lastActiveAt,
      csv: c => { const u = loginOf.get(c.id); return !u ? "" : isOnline(u.lastActiveAt) ? "Online" : timeAgo(u.lastActiveAt); },
      cell: c => {
        const u = loginOf.get(c.id);
        if (!u) return <span className="text-muted-foreground/50">—</span>;
        return isOnline(u.lastActiveAt) ? <CellTag tone="green">Online</CellTag> : <CellDate>{timeAgo(u.lastActiveAt)}</CellDate>;
      } },
  ];

  // What an opened row adds: how to reach them, where they are, and the
  // account facts the grid card and the client's page show. Gift cards are the
  // admin's (as on the client's page); photo access and the opening balance staff's.
  const clientDetails = (c: Client): Detail[] => {
    const sub = c.ownerName || c.email || c.phone;
    const last = lastOrder.get(c.id);
    return filled([
      !!c.email && c.email !== sub && { label: "Email", value: <a href={`mailto:${c.email}`} className="text-primary hover:underline break-all">{c.email}</a> },
      !!c.phone && c.phone !== sub && { label: "Phone", value: <a href={`tel:${c.phone}`} className="text-primary hover:underline">{c.phone}</a> },
      { label: "Address", value: noteText(c.address) },
      { label: "Country", value: [c.country, c.zip].filter(Boolean).join(" · ") },
      { label: "GST / VAT", value: c.gstVat },
      { label: "Client since", value: fmtDate(c.createdAt) },
      !!last && { label: "Last order", value: <>{refLink(`/orders/${last.id}`, last.orderNumber)} · {fmtDate(last.createdAt)} · {last.status}</> },
      staff && { label: "Username", value: c.username && <span className="font-mono text-xs">{c.username}</span> },
      staff && hasOpeningBalance(c) && { label: "Opening balance", value: `${fmtMoney(c.openingBalance || 0)} ${c.openingDir === "credit" ? "credit (their advance)" : "debit (they owed us)"}${c.openingDate ? ` · as of ${fmtDate(c.openingDate)}` : ""}` },
      user!.role === "admin" && !!c.giftCardEnabled && { label: "Gift card & cashback", value: `On · ${cashbackPercentFor(db, c)}% cashback · a card covers up to ${Math.round(giftMaxRedeemPctFor(db, c) * 100)}% of an order` },
      staff && { label: "Product Photos", value: c.productPhotoAccess ? "Access on" : "Access off" },
    ]);
  };

  // Everything that can be done to one client — the same in a row's ⋯ and a
  // card's ⋯. An action someone's access doesn't reach, or that this client
  // can't take (Delete for a client with anything on record), is greyed with
  // the reason under it.
  const clientActions = (c: Client): MoreAction[] => {
    const noEdit = mayEdit ? undefined : needsAccess("clients", "edit");
    const delWhy = staff ? deleteWhy(c) : undefined;
    return [
      { label: "View", icon: Eye, hint: "Account, invoices and orders", onSelect: () => navigate(`/clients/${c.id}`) },
      { label: "Print shipping label", icon: Printer, onSelect: () => printLabel(c), show: mayExport },
      { label: c.status === "active" ? "Deactivate" : "Activate", icon: Power, onSelect: () => toggle(c), show: staff,
        disabled: !mayEdit, hint: noEdit ?? (c.status === "active" ? "Stops sign-in; history stays" : undefined) },
      { label: c.productPhotoAccess ? "Revoke photo access" : "Grant photo access", icon: Camera,
        hint: noEdit ?? (c.productPhotoAccess ? "Access is on" : "Access is off"),
        onSelect: () => togglePhotoAccess(c), show: staff, disabled: !mayEdit },
      { label: "Edit details", icon: Pencil, onSelect: () => openEdit(c), show: staff, disabled: !mayEdit, hint: noEdit },
      { label: "Send password reset", icon: KeyRound, onSelect: () => resetPw(c), show: staff, disabled: !mayEdit, hint: noEdit },
      { label: "Delete client", icon: Trash2, danger: true, onSelect: () => del(c.id), show: staff, disabled: !!delWhy, hint: delWhy },
    ];
  };

  // A card opens the client, as a row does (Ctrl/⌘-click: a new tab).
  const openCard = (href: string) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
    else navigate(href);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* How many there are is the table's (or the grid's) own count. */}
      <PageHeader
        title="Clients"
        subtitle="Orders, bills and payments"
        primary={user!.role !== "client" && can("clients", "add") ? { label: "New Client", icon: Plus, onClick: () => setOpen(true) } : null}
        actions={<ViewSwitch view={view} onChange={saveView} />}
      />
      {user!.role !== "client" && can("clients", "add") && <ClientCreateDialog open={open} onOpenChange={setOpen} />}

      <ClientEditDialog clientId={editingId} onClose={() => setEditingId(null)} />

      <AccountSummary
        receivable={totals.receivable}
        payable={totals.payable}
        fmt={fmtMoney}
        receivableSub="clients owe us · ughrani"
        payableSub="client advances held · chukavni"
      />

      {/* ── List view — the shared table: sort by any heading, Excel, pages.
          The page's own search and company filter (the same ones the grid
          uses) sit in its toolbar; a change starts it on page 1. ── */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="clients"
            noun="client"
            search={{ value: q, onChange: setQ, placeholder: "Search clients..." }}
            filters={filters}
            onClearFilters={clearFilters}
            resetKey={`${q}|${coFilter}`}
            rows={list}
            columns={columns}
            rowKey={c => c.id}
            defaultSort={{ key: "balance", dir: "desc" }}
            rowHref={c => `/clients/${c.id}`}
            details={clientDetails}
            exportName="Clients"
            totals={{
              orders: rows => rows.reduce((s, c) => s + statsOf(c).total, 0),
              billed: rows => fmtMoney(rows.reduce((s, c) => s + accountOf(c).billed, 0)),
              received: rows => <span className="text-success">{fmtMoney(rows.reduce((s, c) => s + accountOf(c).received, 0))}</span>,
              balance: rows => {
                const due = rows.reduce((s, c) => s + accountOf(c).outstanding, 0);
                const held = rows.reduce((s, c) => s + accountOf(c).credit, 0);
                return <><span className="text-destructive">{fmtMoney(due)}</span>{held > 0 && <span className="text-success"> · +{fmtMoney(held)}</span>}</>;
              },
            }}
            // The grid card's buttons, plus View. An action someone's access
            // doesn't reach, or that this client can't take (Delete for a client
            // with anything on record), is greyed with the reason under it.
            rowActions={clientActions}
            emptyText="No clients found."
          />
        </div>
      )}

      {/* The grid's one toolbar row, laid out like the table's. */}
      {view === "grid" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem] sm:max-w-sm max-sm:basis-full">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients..." aria-label="Search clients..." className="h-9 pl-9 rounded-xl bg-white" />
            </div>
            {filters.length > 0 && <FiltersButton filters={filters} onClear={clearFilters} count={countText} />}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums whitespace-nowrap">{countText}</span>
          </div>
          <FilterChips filters={filters} onClear={clearFilters} />
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-auto-cards">
        {paged.map(c => {
          const orderCount = db.orders.filter(o => o.clientId === c.id).length;
          const activeCount = db.orders.filter(o => o.clientId === c.id && !["Delivered","Rejected"].includes(o.status)).length;
          const acc = accounts.get(c.id)!;
          const manager = employees.find(e => e.id === c.accountManagerId);
          const clientUser = db.users.find(u => u.clientId === c.id);
          const online = isOnline(clientUser?.lastActiveAt);
          return (
            // The whole card opens the client; what can be done to them is in
            // its one ⋯ — the same menu as a list row, each item greyed with
            // its reason when it can't be done.
            <div key={c.id} onClick={openCard(`/clients/${c.id}`)} className="card-luxe card-hover p-5 flex flex-col min-w-0 cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-light/20 text-primary font-display text-lg grid place-items-center ring-1 ring-primary/10">
                    {(c.companyName || "?").charAt(0).toUpperCase()}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${online ? "bg-success" : "bg-muted-foreground/40"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg text-brand-dark truncate leading-tight" title={c.companyName}>{c.companyName}</p>
                  {multiCo && <p className="text-[10px] font-semibold text-primary truncate inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{companyById(dbNow.settings, companyIdOfClient(c)).name}</p>}
                  <p className="text-sm text-muted-foreground truncate">{c.ownerName}</p>
                  {clientUser && (
                    <p className={`text-[11px] mt-0.5 ${online ? "text-success font-medium" : "text-muted-foreground"}`}>
                      {online ? "Online now" : `Last seen ${timeAgo(clientUser.lastActiveAt)}`}
                    </p>
                  )}
                </div>
                <StatusBadge status={c.status} />
                <MoreMenu size="sm" label={`Actions for ${c.companyName}`} actions={clientActions(c)} className="relative after:absolute after:-inset-1" />
              </div>

              {user!.role === "admin" && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2 min-w-0">
                  <UserCog className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{manager ? <>Handled by <span className="font-medium text-foreground">{manager.name}</span></> : "Handled by Admin"}</span>
                </p>
              )}

              <div className="mt-4 space-y-2 text-sm min-w-0">
                <p className="flex items-center gap-2 text-muted-foreground min-w-0">
                  <Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={c.email || undefined}>{c.email || "—"}</span>
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />{c.phone || "—"}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground min-w-0">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{[c.country, c.zip].filter(Boolean).join(" · ") || "—"}</span>
                </p>
              </div>

              {/* Figures: colour on the figure only, a zero in grey. */}
              <div className="grid grid-cols-3 gap-1.5 mt-4 pt-3 border-t border-border/50 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Total</p>
                  <p className={`text-xs font-semibold tabular-nums ${acc.billed ? "text-brand-dark" : "text-muted-foreground"}`}>{fmtMoney(acc.billed)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Received</p>
                  <p className={`text-xs font-semibold tabular-nums ${acc.received ? "text-success" : "text-muted-foreground"}`}>{fmtMoney(acc.received)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Pending</p>
                  <p className={`text-xs font-semibold tabular-nums ${acc.outstanding > 0 ? "text-destructive" : "text-success"}`}>
                    {acc.outstanding > 0 ? fmtMoney(acc.outstanding) : "Cleared"}
                  </p>
                </div>
              </div>

              <div className="mt-auto pt-3 flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary px-2.5 py-1 rounded-full shrink-0">
                  <Package className="h-3.5 w-3.5" /> {orderCount} total
                </span>
                {activeCount > 0 && (
                  <span className="text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full shrink-0">
                    {activeCount} active
                  </span>
                )}
                <Button asChild variant="outline" size="sm" className="ml-auto h-8 rounded-lg gap-1.5 shrink-0 relative after:absolute after:-inset-1">
                  <Link to={`/clients/${c.id}`}><History className="h-3.5 w-3.5 text-primary" />View Order History</Link>
                </Button>
              </div>
            </div>
          );
        })}
        {total === 0 && (
          <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No clients found.</div>
        )}
      </div>
      )}

      {/* The list pages itself; these pages are the grid's. */}
      {view === "grid" && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          label={total > 0 ? `Showing ${start + 1}–${end} of ${total} clients` : undefined}
        />
      )}
    </div>
  );
}
