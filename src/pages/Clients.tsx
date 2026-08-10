import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadDb, updateDb, uid, fmtMoney, clientAccount, isOnline, timeAgo, type Client } from "@/lib/db";
import { AccountSummary } from "@/components/AccountSummary";
import { useDb } from "@/hooks/useDb";
import { auth, createAuthUser } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Mail, Phone, MapPin, Search, Trash2, Package, History, Printer, UserCog, KeyRound, Rows3, LayoutGrid, Camera, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

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
  const db = useDb();
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
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Client>>({
    companyName: "", ownerName: "", email: "", phone: "",
    country: "USA", zip: "", gstVat: "", address: "", username: "", password: "",
  });

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
        if (user!.role === "admin") c.accountManagerId = ef.accountManagerId;
        const u = d.users.find(u => u.clientId === c.id);
        if (u) { u.name = c.ownerName || c.companyName; u.phone = c.phone; }
      });
      toast.success("Client details updated");
      setEditingId(null);
    } finally { setSavingEdit(false); }
  };

  const employees = db.users.filter(u => u.role === "employee");

  // Employee: only their own assigned clients. Admin: everyone.
  const scoped = user!.role === "employee"
    ? db.clients.filter(c => c.accountManagerId === user!.id)
    : db.clients;

  const list = scoped.filter(c =>
    c.companyName.toLowerCase().includes(q.toLowerCase()) ||
    c.ownerName.toLowerCase().includes(q.toLowerCase())
  );

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  // Grand totals across all clients this user can see: outstanding = money
  // clients owe us (receivable · ughrani); credit = advances we hold for them,
  // i.e. money we'd owe back (payable · chukavni). Rejected orders aren't billed.
  const totals = scoped.reduce((acc, c) => {
    const a = clientAccount(db.orders.filter(o => o.clientId === c.id && o.status !== "Rejected"), c.creditBalance || 0);
    acc.receivable += a.outstanding;
    acc.payable += a.credit;
    return acc;
  }, { payable: 0, receivable: 0 });

  const create = async () => {
    if (!f.companyName || !f.email || !f.password) { toast.error("Fill company, email and password"); return; }
    const email = f.email!.trim().toLowerCase();
    if (loadDb().users.some(u => u.email.toLowerCase() === email)) { toast.error("That email is already in use"); return; }
    setSaving(true);
    try {
      // Create the client's Firebase Auth account (password lives in Auth).
      const authUid = await createAuthUser(email, f.password!);
      const id = uid("c_");
      // An employee who creates a client becomes its account manager (so they
      // can see and work with it). Admin keeps whatever manager was selected.
      const accountManagerId = user!.role === "employee" ? user!.id : f.accountManagerId;
      updateDb(d => {
        d.clients.unshift({ ...f, id, accountManagerId, username: email, email, status: "active", createdAt: new Date().toISOString() } as Client);
        d.users.push({
          id: uid("u_"), authUid, username: email, password: "", role: "client",
          name: f.ownerName || f.companyName!, email, phone: f.phone,
          status: "active", clientId: id, createdAt: new Date().toISOString(),
        });
      });
      toast.success(`Client created — they can sign in with their email & password${f.accountManagerId ? "" : " · handled by Admin"}`);
      setOpen(false);
      setF({ companyName: "", ownerName: "", email: "", phone: "", country: "USA", zip: "", gstVat: "", address: "", username: "", password: "", accountManagerId: undefined });
    } catch (e) {
      toast.error(authErrorMessage(e));
    } finally { setSaving(false); }
  };

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

  const del = (id: string) => {
    if (!confirm("Delete client?")) return;
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
        {user!.role !== "client" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="btn-hero h-11 rounded-xl"><Plus className="h-4 w-4 mr-2" />New Client</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg rounded-2xl">
              <DialogHeader><DialogTitle className="font-display text-2xl">Create Client</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {(["companyName","ownerName","email","phone","country","zip","gstVat","address","password"] as const).map(k => (
                  <div key={k} className={k === "address" || k === "companyName" ? "col-span-2" : ""}>
                    <Label className="text-xs capitalize">
                      {k === "zip" ? "ZIP / Postal Code" : k === "gstVat" ? "GST / VAT" : k === "email" ? "Email (login ID)" : k === "password" ? "Password (login)" : k.replace(/([A-Z])/g, " $1")}
                    </Label>
                    <Input
                      value={(f as Record<string, string>)[k] || ""}
                      onChange={e => setF({ ...f, [k]: e.target.value })}
                      className="rounded-xl mt-1"
                      type={k === "password" ? "password" : k === "email" ? "email" : "text"}
                    />
                  </div>
                ))}
              </div>
              {user!.role === "admin" ? (
                <div className="mt-3">
                  <Label className="text-xs">Assign Employee (optional)</Label>
                  <Select
                    value={f.accountManagerId || "__none"}
                    onValueChange={v => setF({ ...f, accountManagerId: v === "__none" ? undefined : v })}
                  >
                    <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Not selected — you (Admin) will handle this client" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Not selected — Admin handles this client</SelectItem>
                      {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    If no employee is selected, this client stays under Admin. Otherwise the selected employee gets full access to this client only.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-3">This client will be added under your account — you'll manage them and their orders.</p>
              )}
              <Button onClick={create} disabled={saving} className="btn-hero rounded-xl mt-3">{saving ? "Creating…" : "Create Client"}</Button>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Dialog open={!!editingId} onOpenChange={v => !v && setEditingId(null)}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit Client</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Login email and password aren't editable here — use "Reset Password" for credentials.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
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
          {user!.role === "admin" && (
            <div className="mt-3">
              <Label className="text-xs">Assign Employee</Label>
              <Select
                value={ef.accountManagerId || "__none"}
                onValueChange={v => setEf({ ...ef, accountManagerId: v === "__none" ? undefined : v })}
              >
                <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Not selected — Admin handles this client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not selected — Admin handles this client</SelectItem>
                  {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={saveEdit} disabled={savingEdit} className="btn-hero rounded-xl mt-3">{savingEdit ? "Saving…" : "Save Changes"}</Button>
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
            const acc = clientAccount(db.orders.filter(o => o.clientId === c.id && o.status !== "Rejected"), c.creditBalance || 0);
            const clientUser = db.users.find(u => u.clientId === c.id);
            return (
              <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors">
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
                  <p className="font-medium text-brand-dark truncate">{c.companyName}{c.status !== "active" && <span className="ml-2 text-[10px] text-muted-foreground">(inactive)</span>}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.ownerName || c.email || c.phone || "—"}
                    {clientUser && (
                      <span className={isOnline(clientUser.lastActiveAt) ? "text-success" : ""}>
                        {" · "}{isOnline(clientUser.lastActiveAt) ? "Online" : `Last seen ${timeAgo(clientUser.lastActiveAt)}`}
                      </span>
                    )}
                  </p>
                </div>
                {/* Billed / Received / Balance (debit / credit / balance) */}
                <div className="hidden sm:grid grid-cols-3 gap-3 shrink-0 text-right">
                  <div><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Billed</p><p className="text-xs font-medium tabular-nums text-brand-dark">{fmtMoney(acc.billed)}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Received</p><p className="text-xs font-medium tabular-nums text-success">{fmtMoney(acc.received)}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Balance</p>
                    {acc.outstanding > 0
                      ? <p className="text-xs font-semibold tabular-nums text-destructive">{fmtMoney(acc.outstanding)}</p>
                      : <p className="text-xs font-semibold text-success">✓</p>}
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
              </Link>
            );
          })}
          {total === 0 && <div className="p-12 text-center text-muted-foreground">No clients found.</div>}
        </div>
      )}

      {view === "grid" && (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(c => {
          const orderCount = db.orders.filter(o => o.clientId === c.id).length;
          const activeCount = db.orders.filter(o => o.clientId === c.id && !["Delivered","Rejected"].includes(o.status)).length;
          const acc = clientAccount(db.orders.filter(o => o.clientId === c.id && o.status !== "Rejected"), c.creditBalance || 0);
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => printLabel(c)}
                  className="w-full rounded-xl gap-2 font-medium text-muted-foreground hover:text-foreground"
                >
                  <Printer className="h-4 w-4" />
                  Print Shipping Label
                </Button>
              </div>

              {user!.role !== "client" && (
                <div className="flex gap-2 mt-2">
                  <AsyncButton size="sm" variant="outline" onClick={() => toggle(c)} className="rounded-lg flex-1">
                    {c.status === "active" ? "Deactivate" : "Activate"}
                  </AsyncButton>
                  <AsyncButton
                    size="sm" variant="outline" onClick={() => togglePhotoAccess(c)}
                    className={`rounded-lg w-9 px-0 ${c.productPhotoAccess
                      ? "text-success border-success/40 bg-success/5 hover:text-success hover:bg-success/10"
                      : "text-destructive border-destructive/40 bg-destructive/5 hover:text-destructive hover:bg-destructive/10"}`}
                    title={c.productPhotoAccess ? "Product Photos access ON — click to revoke" : "Product Photos access OFF — click to grant"}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => openEdit(c)} className="rounded-lg w-9 px-0" title="Edit client details">
                    <Pencil className="h-3.5 w-3.5" />
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => resetPw(c)} className="rounded-lg w-9 px-0" title="Send password reset email">
                    <KeyRound className="h-3.5 w-3.5" />
                  </AsyncButton>
                  <AsyncButton size="sm" variant="outline" onClick={() => del(c.id)} className="rounded-lg w-9 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Delete client">
                    <Trash2 className="h-3.5 w-3.5" />
                  </AsyncButton>
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
