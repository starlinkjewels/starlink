import { ClientLoginSection } from "@/components/ClientLoginSection";
import { CustomFieldInputs } from "@/components/CustomFields";
import { customProblem, sameValues, valuesOf, writeValues, type CfValues } from "@/lib/customFields";
import { handlerChoices } from "@/lib/clientHandlers";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { MAIN_COMPANY_ID, companiesOf, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { updateDbAs, type Client } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fieldsOf = (c: Client): Partial<Client> => ({
  companyName: c.companyName, ownerName: c.ownerName, email: c.email ?? "", phone: c.phone,
  country: c.country, zip: c.zip, gstVat: c.gstVat, address: c.address, shippingAddress: c.shippingAddress,
  accountManagerId: c.accountManagerId,
  companyId: companyIdOfClient(c),
  openingBalance: c.openingBalance, openingDir: c.openingDir, openingDate: c.openingDate,
});

/**
 * Edit a client's details — the one form, opened from the Clients list and
 * from the client's own page, in the side panel.
 *
 * The login (email and password) is its own section, for the admin: giving
 * one to a client who has none, or changing it through the server
 * (ClientLoginSection — a plain record can't change a sign-in).
 * Who handles the client and which of our companies bills them are an
 * admin's to change.
 */
/** The handler a client has now — kept in the list even if they have since left. */
const currentHandler = (clientId: string | null, db: { clients: { id: string; accountManagerId?: string }[] }) =>
  clientId ? db.clients.find(c => c.id === clientId)?.accountManagerId : undefined;

export function ClientEditDialog({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const db = useDb();
  // Who handles the client and which company it is: an admin, or access with clients.handler.
  const mayHandler = hasFeature(user, db.roles ?? [], "clients.handler");
  const addNew = useAddNew();
  const multiCo = hasCompanies(db.settings);
  const staff = handlerChoices(db, currentHandler(clientId, db));
  const client = clientId ? db.clients.find(c => c.id === clientId) : undefined;
  const [ef, setEf] = useState<Partial<Client>>({});
  const [shown, setShown] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // Custom fields (lib/customFields.ts) — the ones this person may see.
  const [cf, setCf] = useState<CfValues>({});
  // With a sign-in, their email is that login — changed in the login section (through the server).
  // Without one, it is only how we reach them, and is corrected here like any other detail.
  const hasLogin = !!clientId && db.users.some(u => u.clientId === clientId && !!u.authUid);

  // Start from the client's current details each time one is opened.
  if (clientId !== shown && (!clientId || client)) {
    setShown(clientId);
    if (client) { setEf(fieldsOf(client)); setCf(valuesOf(db, "clients", client.id)); }
  }

  const saveEdit = async () => {
    if (!clientId) return;
    if (!ef.companyName?.trim()) { toast.error("Company name is required"); return; }
    const email = (ef.email ?? "").trim().toLowerCase();
    if (!hasLogin && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Check the email"); return; }
    const cfWhy = customProblem(db.settings, "clients", cf, user, valuesOf(db, "clients", clientId));
    if (cfWhy) { toast.error(cfWhy); return; }
    setSavingEdit(true);
    try {
      updateDbAs({ summary: `Edited client ${ef.companyName.trim()}` }, d => {
        const c = d.clients.find(x => x.id === clientId);
        if (!c) return;
        c.companyName = ef.companyName!.trim();
        c.ownerName = ef.ownerName?.trim() || "";
        c.phone = ef.phone?.trim() || "";
        if (!hasLogin) c.email = email;
        c.country = ef.country?.trim() || "";
        c.zip = ef.zip?.trim() || undefined;
        c.gstVat = ef.gstVat?.trim() || "";
        c.address = ef.address?.trim() || "";
        // Blank = the billing address, as every client before there was a separate one.
        c.shippingAddress = ef.shippingAddress?.trim() || undefined;
        // Opening balance (migration) — clear direction/date when amount is blank/0.
        c.openingBalance = ef.openingBalance || undefined;
        c.openingDir = ef.openingBalance ? (ef.openingDir || "debit") : undefined;
        c.openingDate = ef.openingBalance ? (ef.openingDate || undefined) : undefined;
        if (mayHandler) c.accountManagerId = ef.accountManagerId;
        // Moving a client to another company changes who bills them from now
        // on; every invoice already raised keeps the company that issued it.
        if (mayHandler && ef.companyId) {
          if (ef.companyId === MAIN_COMPANY_ID) delete c.companyId; else c.companyId = ef.companyId;
        }
        const u = d.users.find(x => x.clientId === c.id);
        if (u) { u.name = c.ownerName || c.companyName; u.phone = c.phone; }
        if (!sameValues(cf, valuesOf(d, "clients", c.id))) writeValues(d, "clients", c.id, cf, user, user?.id);
      });
      toast.success("Client details updated");
      onClose();
    } finally { setSavingEdit(false); }
  };

  return (
    <ActionSheet
      open={!!clientId && !!client}
      onOpenChange={v => { if (!v) onClose(); }}
      title="Edit Client"
      description={mayHandler ? "Details, who handles them, and their login" : "Their details"}
      icon={Pencil}
      size="lg"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-brand-dark truncate min-w-0">{ef.companyName?.trim() || "—"}</p>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={onClose} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit} className="btn-hero rounded-xl flex-1 sm:flex-none sm:min-w-40">{savingEdit ? "Saving…" : "Save Changes"}</Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {(["companyName", "ownerName", "email", "phone", "country", "zip", "gstVat", "address", "shippingAddress"] as const).map(k => (
          <div key={k} className={k === "address" || k === "shippingAddress" || k === "companyName" ? "col-span-2" : ""}>
            <Label className="text-xs capitalize" htmlFor={`client-edit-${k}`}>
              {k === "zip" ? "ZIP / Postal Code" : k === "gstVat" ? "GST / VAT" : k === "address" ? "Billing address" : k === "shippingAddress" ? "Shipping address" : k.replace(/([A-Z])/g, " $1")}
              {k === "shippingAddress" && <span className="normal-case font-normal text-muted-foreground"> · only if different from billing</span>}
            </Label>
            <Input
              id={`client-edit-${k}`}
              type={k === "email" ? "email" : "text"}
              value={(ef as Record<string, string>)[k] || ""}
              onChange={e => setEf({ ...ef, [k]: e.target.value })}
              disabled={k === "email" && hasLogin}
              className="rounded-xl mt-1 disabled:opacity-70"
            />
            {k === "email" && hasLogin && <p className="text-[11px] text-muted-foreground mt-1">Their sign-in — {user!.role === "admin" ? "changed in Login below" : "an admin changes it in Login"}.</p>}
          </div>
        ))}
      </div>
      <div className="mt-4">
        <OpeningBalanceFields
          amount={ef.openingBalance != null ? String(ef.openingBalance) : ""}
          dir={ef.openingDir || "debit"}
          date={ef.openingDate || ""}
          onAmount={v => setEf({ ...ef, openingBalance: v === "" ? undefined : Number(v) })}
          onDir={v => setEf({ ...ef, openingDir: v })}
          onDate={v => setEf({ ...ef, openingDate: v || undefined })}
          debitLabel="Client owes us (Debit)"
          creditLabel="We owe client / advance (Credit)"
          hint="Carried in from your previous system."
        />
      </div>
      <CustomFieldInputs target="clients" values={cf} onChange={setCf} className="mt-4" />
      {mayHandler && multiCo && (
        <div className="mt-4">
          <Label className="text-xs">Our company — who bills this client</Label>
          <Select value={ef.companyId || MAIN_COMPANY_ID} onValueChange={addNew("company", v => setEf(prev => ({ ...prev, companyId: v })))}>
            <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {companiesOf(db.settings).filter(co => co.active !== false || co.id === ef.companyId).map(co => <SelectItem key={co.id} value={co.id}>{co.name}{co.country ? ` · ${co.country}` : ""}</SelectItem>)}
            <AddNewItem kind="company" /></SelectContent>
          </Select>
          {client && ef.companyId !== companyIdOfClient(client) && (
            <p className="text-[11px] text-amber-700 mt-1">New invoices only — raised ones keep their company.</p>
          )}
        </div>
      )}
      {mayHandler && (
        <div className="mt-4">
          <Label className="text-xs">Handled by</Label>
          <Select
            value={ef.accountManagerId || "__none"}
            onValueChange={addNew("employee", v => setEf(prev => ({ ...prev, accountManagerId: v === "__none" ? undefined : v })))}
          >
            <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Not assigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Not assigned</SelectItem>
              {staff.map(e => <SelectItem key={e.id} value={e.id}>{e.name}{e.role === "admin" ? " · admin" : ""}</SelectItem>)}
            <AddNewItem kind="employee" /></SelectContent>
          </Select>
        </div>
      )}
      {hasFeature(user, db.roles ?? [], "clients.login") && clientId && <ClientLoginSection clientId={clientId} />}
    </ActionSheet>
  );
}
