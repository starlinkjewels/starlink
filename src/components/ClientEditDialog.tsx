import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { MAIN_COMPANY_ID, companiesOf, companyIdOfClient, hasCompanies } from "@/lib/companies";
import { updateDbAs, type Client } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fieldsOf = (c: Client): Partial<Client> => ({
  companyName: c.companyName, ownerName: c.ownerName, phone: c.phone,
  country: c.country, zip: c.zip, gstVat: c.gstVat, address: c.address,
  accountManagerId: c.accountManagerId,
  companyId: companyIdOfClient(c),
  openingBalance: c.openingBalance, openingDir: c.openingDir, openingDate: c.openingDate,
});

/**
 * Edit a client's details — the one form, opened from the Clients list and
 * from the client's own page, in the side panel.
 *
 * Login email and password aren't here: email is the Firebase Auth identifier
 * (changing it needs a privileged Admin SDK operation, not a plain Firestore
 * write) and the password has its own "Reset Password" email-link flow.
 * Who handles the client and which of our companies bills them are an
 * admin's to change.
 */
export function ClientEditDialog({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const db = useDb();
  const addNew = useAddNew();
  const multiCo = hasCompanies(db.settings);
  const employees = db.users.filter(u => u.role === "employee");
  const client = clientId ? db.clients.find(c => c.id === clientId) : undefined;
  const [ef, setEf] = useState<Partial<Client>>({});
  const [shown, setShown] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Start from the client's current details each time one is opened.
  if (clientId !== shown && (!clientId || client)) {
    setShown(clientId);
    if (client) setEf(fieldsOf(client));
  }

  const saveEdit = async () => {
    if (!clientId) return;
    if (!ef.companyName?.trim()) { toast.error("Company name is required"); return; }
    setSavingEdit(true);
    try {
      updateDbAs({ summary: `Edited client ${ef.companyName.trim()}` }, d => {
        const c = d.clients.find(x => x.id === clientId);
        if (!c) return;
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
        const u = d.users.find(x => x.clientId === c.id);
        if (u) { u.name = c.ownerName || c.companyName; u.phone = c.phone; }
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
      description="The login stays — use Send password reset for it"
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
        {(["companyName", "ownerName", "phone", "country", "zip", "gstVat", "address"] as const).map(k => (
          <div key={k} className={k === "address" || k === "companyName" ? "col-span-2" : ""}>
            <Label className="text-xs capitalize" htmlFor={`client-edit-${k}`}>
              {k === "zip" ? "ZIP / Postal Code" : k === "gstVat" ? "GST / VAT" : k.replace(/([A-Z])/g, " $1")}
            </Label>
            <Input
              id={`client-edit-${k}`}
              value={(ef as Record<string, string>)[k] || ""}
              onChange={e => setEf({ ...ef, [k]: e.target.value })}
              className="rounded-xl mt-1"
            />
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
      {user!.role === "admin" && multiCo && (
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
      {user!.role === "admin" && (
        <div className="mt-4">
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
    </ActionSheet>
  );
}
