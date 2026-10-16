import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { loadDb, updateDb, flush, uid, type Client } from "@/lib/db";
import { createAuthUser } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { useAuth } from "@/lib/auth";
import { MAIN_COMPANY_ID, companiesForUser, hasCompanies, worksFor } from "@/lib/companies";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * The one Create Client form — the Clients page's, also opened from
 * "+ Add new client" wherever a client is picked. Same fields, same login,
 * same company and account manager, whichever way in.
 */
export function ClientCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
}) {
  const { user } = useAuth();
  const addNew = useAddNew();
  // Our companies — asked about only once there is more than one.
  const dbNow = loadDb();
  const multiCo = hasCompanies(dbNow.settings);
  const meUser = dbNow.users.find(u => u.id === user!.id) ?? user!;
  const myCompanies = companiesForUser(dbNow.settings, meUser);
  const employees = dbNow.users.filter(u => u.role === "employee");
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Partial<Client>>({
    companyName: "", ownerName: "", email: "", phone: "",
    country: "USA", zip: "", gstVat: "", address: "", username: "", password: "",
  });

  const create = async () => {
    if (!f.companyName || !f.email || !f.password) { toast.error("Fill company, email and password"); return; }
    // Which of our companies sells to them. One to choose from: that one.
    const sellerId = f.companyId || (myCompanies.length === 1 ? myCompanies[0].id : "");
    if (multiCo && !sellerId) { toast.error("Choose which of our companies this client buys from"); return; }
    if (multiCo && !myCompanies.some(c => c.id === sellerId)) { toast.error("You don't sell for that company"); return; }
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
        const { companyId: _picked, ...rest } = f;
        void _picked;
        d.clients.unshift({
          ...rest, id, accountManagerId, username: email, email, status: "active", createdAt: new Date().toISOString(),
          ...(sellerId && sellerId !== MAIN_COMPANY_ID ? { companyId: sellerId } : {}),
        } as Client);
        d.users.push({
          id: uid("u_"), authUid, username: email, password: "", role: "client",
          name: f.ownerName || f.companyName!, email, phone: f.phone,
          status: "active", clientId: id, createdAt: new Date().toISOString(),
        });
      });
      // Wait for the login's permission record to reach the server before
      // saying it is done. It goes up just after the profile; close the tab in
      // between and the account can sign in to nothing.
      await flush();
      toast.success(`Client created — they can sign in with their email & password${f.accountManagerId ? "" : " · handled by Admin"}`);
      onOpenChange(false);
      onCreated?.(id);
      setF({ companyName: "", ownerName: "", email: "", phone: "", country: "USA", zip: "", gstVat: "", address: "", username: "", password: "", accountManagerId: undefined });
    } catch (e) {
      toast.error(authErrorMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create Client"
      description="A buyer's business details, and the email and password they sign in with."
      icon={UserPlus}
      size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">New client</p>
            <p className="text-sm font-semibold text-brand-dark truncate">{f.companyName?.trim() || "—"}</p>
            {f.email?.trim() && <p className="text-[11px] text-muted-foreground truncate">Signs in as {f.email.trim().toLowerCase()}</p>}
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={create} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none sm:min-w-40">{saving ? "Creating…" : "Create Client"}</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
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
      <div className="mt-4">
        <OpeningBalanceFields
          amount={f.openingBalance != null ? String(f.openingBalance) : ""}
          dir={f.openingDir || "debit"}
          date={f.openingDate || ""}
          onAmount={v => setF({ ...f, openingBalance: v === "" ? undefined : Number(v) })}
          onDir={v => setF({ ...f, openingDir: v })}
          onDate={v => setF({ ...f, openingDate: v || undefined })}
          debitLabel="Client owes us (Debit)"
          creditLabel="We owe client / advance (Credit)"
          hint="What this client already owed you (or prepaid) when you started using this app. Shown as the first line of their ledger."
        />
      </div>
      {multiCo && (
        <div className="mt-4">
          <Label className="text-xs">Our company — who bills this client *</Label>
          <Select value={f.companyId || (myCompanies.length === 1 ? myCompanies[0].id : "")} onValueChange={addNew("company", v => setF(prev => ({ ...prev, companyId: v })))}>
            <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Choose the company" /></SelectTrigger>
            <SelectContent>
              {myCompanies.map(co => <SelectItem key={co.id} value={co.id}>{co.name}{co.country ? ` · ${co.country}` : ""}</SelectItem>)}
            <AddNewItem kind="company" /></SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">Their invoices, proformas and statements carry this company's name, logo, bank details and invoice numbers.</p>
        </div>
      )}
      {user!.role === "admin" ? (
        <div className="mt-4">
          <Label className="text-xs">Assign Employee (optional)</Label>
          <Select
            value={f.accountManagerId || "__none"}
            onValueChange={addNew("employee", v => setF(prev => ({ ...prev, accountManagerId: v === "__none" ? undefined : v })))}
          >
            <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Not selected — you (Admin) will handle this client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Not selected — Admin handles this client</SelectItem>
              {employees.filter(e => !multiCo || !f.companyId || worksFor(e, f.companyId)).map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            <AddNewItem kind="employee" /></SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            If no employee is selected, this client stays under Admin. Otherwise the selected employee gets full access to this client only.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mt-4">This client will be added under your account — you'll manage them and their orders.</p>
      )}
    </ActionSheet>
  );
}
