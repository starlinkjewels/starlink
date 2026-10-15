import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { ClientCreateDialog } from "@/components/create/ClientCreateDialog";
import { MAIN_COMPANY_ID, companiesOf, companiesForUser, companyById, companyIdOfClient, hasCompanies, worksFor } from "@/lib/companies";
import { useCan } from "@/hooks/useCan";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadDb, updateDb, fmtMoney, clientAccount, isOnline, timeAgo, currentUserClients, type Client } from "@/lib/db";
import { AccountSummary } from "@/components/AccountSummary";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { useDb } from "@/hooks/useDb";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Package, History, Printer, UserCog, KeyRound, Rows3, LayoutGrid, Camera, Pencil, ChevronRight, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { confirmBox } from "@/lib/confirm";
import { IfExport } from "@/components/IfExport";

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
  const db = useDb();
  const addNew = useAddNew();
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

  // Editing an existing client — login email/password aren't included here:
  // email is the Firebase Auth identifier (changing it needs a privileged
  // Admin SDK operation, not a plain Firestore write) and password already has
  // its own "Reset Password" email-link flow just below.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ef, setEf] = useState<Partial<Client>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const openEdit = (c: Client) => {
    setEf({
      companyName: c.companyName, ownerName: c.ownerName, phone: c.phone,
      country: c.country, zip: c.zip, gstVat: c.gstVat, address: c.address,
      accountManagerId: c.accountManagerId,
      companyId: companyIdOfClient(c),
      openingBalance: c.openingBalance, openingDir: c.openingDir, openingDate: c.openingDate,
    });
    setEditingId(c.id);
  };
  const saveEdit = async () => {
    if (!editingId) return;
    if (!ef.companyName?.trim()) { toast.error("Company name is required"); return; }
    setSavingEdit(true);
    try {
      updateDb(d => {
        const c = d.clients.find(x => x.id === editingId)!;
        c.companyName = ef.companyName!.trim();
        c.ownerName = ef.ownerName?.trim() || "";
        c.phone = ef.phone?.trim() || "";
        c.country = ef.country?.trim() || "";
        c.zip = ef.zip?.trim() || undefined;
        c.gstVat = ef.gstVat?.trim() || "";
        c.address = ef.address?.trim() || "";
        // Opening balance (migration) — clear direction/date when amount is blank/0.
        c.openingBalance = ef.openingBalance || undefined;
        c.openingDir = ef.openingBalance ? (ef.openingDir || "debit") : undefined;
        c.openingDate = ef.openingBalance ? (ef.openingDate || undefined) : undefined;
        if (user!.role === "admin") c.accountManagerId = ef.accountManagerId;
        // Moving a client to another company changes who bills them from now
        // on; every invoice already raised keeps the company that issued it.
        if (user!.role === "admin" && ef.companyId) {
          if (ef.companyId === MAIN_COMPANY_ID) delete c.companyId; else c.companyId = ef.companyId;
        }
        const u = d.users.find(u => u.clientId === c.id);
        if (u) { u.name = c.ownerName || c.companyName; u.phone = c.phone; }
      });
      toast.success("Client details updated");
      setEditingId(null);
    } finally { setSavingEdit(false); }
  };

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

  const toggle = (c: Client) => {
    updateDb(d => {
      const x = d.clients.find(x => x.id === c.id)!;
      x.status = x.status === "active" ? "inactive" : "active";
      const u = d.users.find(u => u.clientId === c.id);
      if (u) u.status = x.status;
    });
    toast.success("Status updated");
  };

  const togglePhotoAccess = (c: Client) => {
    updateDb(d => {
      const x = d.clients.find(x => x.id === c.id)!;
      x.productPhotoAccess = !x.productPhotoAccess;
    });
    toast.success(c.productPhotoAccess ? "Photo access revoked" : "Photo access granted");
  };

  const del = async (id: string) => {
    if (!(await confirmBox("Delete client?"))) return;
    updateDb(d => {
      d.clients = d.clients.filter(c => c.id !== id);
      d.users = d.users.filter(u => u.clientId !== id);
    });
    toast.success("Deleted");
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

      <Dialog open={!!editingId} onOpenChange={v => !v && setEditingId(null)}>
        <DialogContent className="max-w-4xl rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit Client</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Login email and password aren't editable here — use "Reset Password" for credentials.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
            {(["companyName", "ownerName", "phone", "country", "zip", "gstVat", "address"] as const).map(k => (
              <div key={k} className={k === "address" || k === "companyName" ? "col-span-2" : ""}>
                <Label className="text-xs capitalize">
                  {k === "zip" ? "ZIP / Postal Code" : k === "gstVat" ? "GST / VAT" : k.replace(/([A-Z])/g, " $1")}
                </Label>
                <Input
                  value={(ef as Record<string, string>)[k] || ""}
                  onChange={e => setEf({ ...ef, [k]: e.target.value })}
                  className="rounded-xl mt-1"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <OpeningBalanceFields
              amount={ef.openingBalance != null ? String(ef.openingBalance) : ""}
              dir={ef.openingDir || "debit"}
              date={ef.openingDate || ""}
              onAmount={v => setEf({ ...ef, openingBalance: v === "" ? undefined : Number(v) })}
              onDir={v => setEf({ ...ef, openingDir: v })}
              onDate={v => setEf({ ...ef, openingDate: v || undefined })}
              debitLabel="Client owes us (Debit)"
              creditLabel="We owe client / advance (Credit)"
              hint="Adjust the balance carried in from your previous system. Shown as the first line of their ledger."
            />
          </div>
          {user!.role === "admin" && multiCo && (
            <div className="mt-3">
              <Label className="text-xs">Our company — who bills this client</Label>
              <Select value={ef.companyId || MAIN_COMPANY_ID} onValueChange={addNew("company", v => setEf(prev => ({ ...prev, companyId: v })))}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {companiesOf(dbNow.settings).filter(co => co.active !== false || co.id === ef.companyId).map(co => <SelectItem key={co.id} value={co.id}>{co.name}{co.country ? ` · ${co.country}` : ""}</SelectItem>)}
                <AddNewItem kind="company" /></SelectContent>
              </Select>
              {editingId && ef.companyId !== companyIdOfClient(dbNow.clients.find(x => x.id === editingId)) && (
                <p className="text-[11px] text-amber-700 mt-1">From now on their new invoices come from this company. Invoices already raised keep the company that issued them.</p>
              )}
            </div>
          )}
          {user!.role === "admin" && (
            <div className="mt-3">
              <Label className="text-xs">Assign Employee</Label>
              <Select
                value={ef.accountManagerId || "__none"}
                onValueChange={addNew("employee", v => setEf(prev => ({ ...prev, accountManagerId: v === "__none" ? undefined : v })))}
              >
                <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Not selected — Admin handles this client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not selected — Admin handles this client</SelectItem>
                  {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                <AddNewItem kind="employee" /></SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end"><Button onClick={saveEdit} disabled={savingEdit} className="btn-hero rounded-xl max-sm:w-full sm:min-w-40">{savingEdit ? "Saving…" : "Save Changes"}</Button></div>
        </DialogContent>
      </Dialog>

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

      {/* ── List view — avatar, company/owner, status + order counts, quick link ── */}
      {view === "list" && (
        <div className="card-luxe divide-y divide-border/50 overflow-hidden">
          {paged.map(c => {
            const orderCount = db.orders.filter(o => o.clientId === c.id).length;
            const activeCount = db.orders.filter(o => o.clientId === c.id && !["Delivered","Rejected"].includes(o.status)).length;
            const acc = accounts.get(c.id)!;
            const clientUser = db.users.find(u => u.clientId === c.id);
            return (
              <Link key={c.id} to={`/clients/${c.id}`} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/40 transition-colors">
                <div className="relative shrink-0">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/15 to-brand-light/20 text-primary font-display grid place-items-center ring-1 ring-primary/10">
                    {(c.companyName || "?").charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${isOnline(clientUser?.lastActiveAt) ? "bg-success" : "bg-muted-foreground/40"}`}
                    title={isOnline(clientUser?.lastActiveAt) ? "Online" : `Last seen ${timeAgo(clientUser?.lastActiveAt)}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-brand-dark truncate">{c.companyName}{c.status !== "active" && <span className="ml-2 text-[10px] text-muted-foreground">(inactive)</span>}{multiCo && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{companyById(dbNow.settings, companyIdOfClient(c)).name}</span>}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.ownerName || c.email || c.phone || "—"}
                    {clientUser && (
                      <span className={isOnline(clientUser.lastActiveAt) ? "text-success" : ""}>
                        {" · "}{isOnline(clientUser.lastActiveAt) ? "Online" : `Last seen ${timeAgo(clientUser.lastActiveAt)}`}
                      </span>
                    )}
                  </p>
                </div>
                {/* Billed / Received / Balance — segmented ledger panel */}
                <div className="hidden sm:flex items-stretch rounded-xl border border-border/60 bg-secondary/30 overflow-hidden shrink-0 text-right">
                  <div className="px-3.5 py-1.5 min-w-[84px]"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Billed</p><p className="text-xs font-medium tabular-nums text-brand-dark">{fmtMoney(acc.billed)}</p></div>
                  <div className="px-3.5 py-1.5 min-w-[84px] border-l border-border/50"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Received</p><p className="text-xs font-medium tabular-nums text-success">{fmtMoney(acc.received)}</p></div>
                  <div className="px-3.5 py-1.5 min-w-[92px] border-l border-border/50"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Balance</p>
                    {acc.outstanding > 0
                      ? <p className="text-xs font-semibold tabular-nums text-destructive">{fmtMoney(acc.outstanding)}</p>
                      : <p className="text-xs font-semibold text-success">✓ Clear</p>}
                    <p className="text-[9px] text-muted-foreground leading-tight">{orderCount} order{orderCount !== 1 ? "s" : ""}{activeCount > 0 ? ` · ${activeCount} active` : ""}</p>
                  </div>
                </div>
                {/* Mobile — billed + balance */}
                <div className="sm:hidden text-right shrink-0">
                  <p className="text-sm font-semibold text-brand-dark">{fmtMoney(acc.billed)}</p>
                  <p className="text-[10px]">
                    <span className="text-success font-medium">{fmtMoney(acc.received)} recv</span>
                    {acc.outstanding > 0 && <span className="text-destructive font-medium"> · {fmtMoney(acc.outstanding)} due</span>}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {orderCount} order{orderCount !== 1 ? "s" : ""}{activeCount > 0 ? ` · ${activeCount} active` : ""}
                  </p>
                </div>
                <ChevronRight className="hidden sm:block h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
              </Link>
            );
          })}
          {total === 0 && <div className="p-12 text-center text-muted-foreground">No clients found.</div>}
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

              {user!.role !== "client" && (
                // Fits a 360px phone: the label button may shrink, the icons are a
                // touch smaller there. It did not, and pushed the card off-screen.
                <div className="flex gap-1.5 sm:gap-2 mt-2">
                  {can("clients", "edit") && <AsyncButton size="sm" variant="outline" onClick={() => toggle(c)} className="rounded-lg flex-1 min-w-0 px-2">
                    {c.status === "active" ? "Deactivate" : "Activate"}
                  </AsyncButton>}
                  {can("clients", "edit") && <AsyncButton
                    size="sm" variant="outline" onClick={() => togglePhotoAccess(c)}
                    className={`rounded-lg w-8 sm:w-9 shrink-0 px-0 ${c.productPhotoAccess
                      ? "text-success border-success/40 bg-success/5 hover:text-success hover:bg-success/10"
                      : "text-destructive border-destructive/40 bg-destructive/5 hover:text-destructive hover:bg-destructive/10"}`}
                    title={c.productPhotoAccess ? "Product Photos access ON — click to revoke" : "Product Photos access OFF — click to grant"}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </AsyncButton>}
                  {can("clients", "edit") && <AsyncButton size="sm" variant="outline" onClick={() => openEdit(c)} className="rounded-lg w-8 sm:w-9 shrink-0 px-0" title="Edit client details">
                    <Pencil className="h-3.5 w-3.5" />
                  </AsyncButton>}
                  {can("clients", "edit") && <AsyncButton size="sm" variant="outline" onClick={() => resetPw(c)} className="rounded-lg w-8 sm:w-9 shrink-0 px-0" title="Send password reset email">
                    <KeyRound className="h-3.5 w-3.5" />
                  </AsyncButton>}
                  {can("clients", "delete") && <AsyncButton size="sm" variant="outline" onClick={() => del(c.id)} className="rounded-lg w-8 sm:w-9 shrink-0 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Delete client">
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>}
                </div>
              )}
            </div>
          );
        })}
        {total === 0 && (
          <div className="col-span-full card-luxe p-12 text-center text-muted-foreground">No clients found.</div>
        )}
      </div>
      )}

      <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={total > 0 ? `Showing ${start + 1}–${end} of ${total} clients` : undefined}
      />
    </div>
  );
}
