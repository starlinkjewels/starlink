import { ClientCreateDialog } from "@/components/create/ClientCreateDialog";
import { ClientEditDialog } from "@/components/ClientEditDialog";
import { companiesOf, companiesForUser, companyById, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { useCan, useMayExport } from "@/hooks/useCan";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadDb, updateDbAs, fmtMoney, fmtDate, clientAccount, isOnline, timeAgo, currentUserClients, hasOpeningBalance, cashbackPercentFor, giftMaxRedeemPctFor, type Client, type Order } from "@/lib/db";
import { filled, refLink, noteText, type Detail } from "@/components/rowDetails";
import { AccountSummary } from "@/components/AccountSummary";
import { useDb } from "@/hooks/useDb";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Package, History, Printer, UserCog, KeyRound, Rows3, LayoutGrid, Camera, Pencil, Building2, Power, Eye } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { IfExport } from "@/components/IfExport";
import { clientDeleteBlocker, deleteClientFlow, toggleClientActive } from "@/lib/clientActions";
import { needsAccess } from "@/lib/actionHints";

const PAGE_SIZE = 9;

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

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Clients</h1>
          <p className="text-sm text-muted-foreground">{total} client{total !== 1 ? "s" : ""}</p>
        </div>
        {user!.role !== "client" && can("clients", "add") && (
          <>
            <Button onClick={() => setOpen(true)} className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Client</Button>
            <ClientCreateDialog open={open} onOpenChange={setOpen} />
          </>
        )}
      </div>

      <ClientEditDialog clientId={editingId} onClose={() => setEditingId(null)} />

      <AccountSummary
        receivable={totals.receivable}
        payable={totals.payable}
        fmt={fmtMoney}
        receivableSub="clients owe us · ughrani"
        payableSub="client advances held · chukavni"
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients..." className="pl-9 h-11 rounded-xl" />
        </div>
        {multiCo && (
          <Select value={coFilter} onValueChange={setCoFilter}>
            <SelectTrigger className="w-40 sm:w-52 h-11 rounded-xl text-sm shrink-0" aria-label="Company"><Building2 className="h-4 w-4 mr-1.5 shrink-0 text-primary" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companiesOf(dbNow.settings).map(co => <SelectItem key={co.id} value={co.id}>{co.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
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
          The search and company filter above narrow it, as they do the grid. ── */}
      {view === "list" && (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable
            id="clients"
            noun="client"
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
            rowActions={c => {
              const noEdit = mayEdit ? undefined : needsAccess("clients", "edit");
              const delWhy = staff ? deleteWhy(c) : undefined;
              return [
                { label: "View", icon: Eye, hint: "Their page — account, invoices, orders", onSelect: () => navigate(`/clients/${c.id}`) },
                { label: "Print shipping label", icon: Printer, onSelect: () => printLabel(c), show: mayExport },
                { label: c.status === "active" ? "Deactivate" : "Activate", icon: Power, onSelect: () => toggle(c), show: staff,
                  disabled: !mayEdit, hint: noEdit ?? (c.status === "active" ? "They can no longer sign in; their history stays" : undefined) },
                { label: c.productPhotoAccess ? "Revoke photo access" : "Grant photo access", icon: Camera,
                  hint: noEdit ?? (c.productPhotoAccess ? "Product Photos access is on" : "Product Photos access is off"),
                  onSelect: () => togglePhotoAccess(c), show: staff, disabled: !mayEdit },
                { label: "Edit details", icon: Pencil, onSelect: () => openEdit(c), show: staff, disabled: !mayEdit, hint: noEdit },
                { label: "Send password reset", icon: KeyRound, onSelect: () => resetPw(c), show: staff, disabled: !mayEdit, hint: noEdit },
                { label: "Delete client", icon: Trash2, danger: true, onSelect: () => del(c.id), show: staff, disabled: !!delWhy, hint: delWhy },
              ];
            }}
            emptyText="No clients found."
          />
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
            <div key={c.id} className="card-luxe card-hover p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/15 to-brand-light/20 text-primary font-display text-lg grid place-items-center ring-1 ring-primary/10">
                    {(c.companyName || "?").charAt(0).toUpperCase()}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${online ? "bg-success" : "bg-muted-foreground/40"}`} />
                </div>
                <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                  <div className="min-w-0">
                    <p className="font-display text-lg text-brand-dark truncate leading-tight">{c.companyName}</p>
                    {multiCo && <p className="text-[10px] font-semibold text-primary truncate inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{companyById(dbNow.settings, companyIdOfClient(c)).name}</p>}
                    <p className="text-sm text-muted-foreground truncate">{c.ownerName}</p>
                    {clientUser && (
                      <p className={`text-[11px] mt-0.5 ${online ? "text-success font-medium" : "text-muted-foreground"}`}>
                        {online ? "Online now" : `Last seen ${timeAgo(clientUser.lastActiveAt)}`}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              </div>

              {user!.role === "admin" && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                  <UserCog className="h-3.5 w-3.5" />
                  {manager ? <>Handled by <span className="font-medium text-foreground">{manager.name}</span></> : "Handled by Admin"}
                </p>
              )}

              <div className="mt-4 space-y-2 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground truncate">
                  <Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{c.email || "—"}</span>
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />{c.phone || "—"}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground truncate">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{[c.country, c.zip].filter(Boolean).join(" · ") || "—"}</span>
                </p>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary px-2.5 py-1 rounded-full">
                  <Package className="h-3.5 w-3.5" /> {orderCount} total
                </span>
                {activeCount > 0 && (
                  <span className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                    {activeCount} active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-border/50">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Total</p>
                  <p className="text-xs font-semibold text-brand-dark">{fmtMoney(acc.billed)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Received</p>
                  <p className="text-xs font-semibold text-success">{fmtMoney(acc.received)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Pending</p>
                  <p className={`text-xs font-semibold ${acc.outstanding > 0 ? "text-destructive" : "text-success"}`}>
                    {acc.outstanding > 0 ? fmtMoney(acc.outstanding) : "Cleared"}
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <Button asChild variant="outline" size="sm" className="w-full rounded-xl gap-2 font-medium">
                  <Link to={`/clients/${c.id}`}>
                    <History className="h-4 w-4 text-primary" />
                    View Order History
                  </Link>
                </Button>

                {/* Print shipping label */}
                <IfExport>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => printLabel(c)}
                  className="w-full rounded-xl gap-2 font-medium text-muted-foreground hover:text-foreground"
                >
                  <Printer className="h-4 w-4" />
                  Print Shipping Label
                </Button>
                </IfExport>
              </div>

              {user!.role !== "client" && (() => {
                // Greyed (not hidden) when access doesn't reach them, the reason
                // in the tooltip; Delete also when this client has anything on record.
                const noEdit = mayEdit ? undefined : needsAccess("clients", "edit");
                const delWhy = deleteWhy(c);
                return (
                // Fits a 360px phone: the label button may shrink, the icons are a
                // touch smaller there. It did not, and pushed the card off-screen.
                <div className="mt-2 space-y-1">
                <div className="flex gap-1.5 sm:gap-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(c)} disabled={!mayEdit} title={noEdit} className="rounded-lg flex-1 min-w-0 px-2">
                    {c.status === "active" ? "Deactivate" : "Activate"}
                  </AsyncButton>
                  <AsyncButton
                    size="sm" variant="outline" onClick={() => togglePhotoAccess(c)} disabled={!mayEdit}
                    className={`rounded-lg w-8 sm:w-9 shrink-0 px-0 ${c.productPhotoAccess
                      ? "text-success border-success/40 bg-success/5 hover:text-success hover:bg-success/10"
                      : "text-destructive border-destructive/40 bg-destructive/5 hover:text-destructive hover:bg-destructive/10"}`}
                    title={noEdit ?? (c.productPhotoAccess ? "Product Photos access ON — click to revoke" : "Product Photos access OFF — click to grant")}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => openEdit(c)} disabled={!mayEdit} className="rounded-lg w-8 sm:w-9 shrink-0 px-0" title={noEdit ?? "Edit client details"}>
                    <Pencil className="h-3.5 w-3.5" />
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => resetPw(c)} disabled={!mayEdit} className="rounded-lg w-8 sm:w-9 shrink-0 px-0" title={noEdit ?? "Send password reset email"}>
                    <KeyRound className="h-3.5 w-3.5" />
                  </AsyncButton>
                  {/* Kept clickable when blocked: a disabled button can't show
                      its tooltip everywhere, and the click says why. */}
                  <AsyncButton size="sm" variant="outline" onClick={() => (delWhy ? toast.error(delWhy) : del(c.id))} aria-disabled={!!delWhy}
                    className={`rounded-lg w-8 sm:w-9 shrink-0 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive ${delWhy ? "opacity-50" : ""}`}
                    title={delWhy ? `Delete client — ${delWhy}` : "Delete client"}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>
                </div>
                {noEdit && <p className="text-[10px] text-muted-foreground">{noEdit}</p>}
                </div>
                );
              })()}
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
