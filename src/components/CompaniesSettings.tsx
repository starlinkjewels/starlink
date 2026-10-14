import { useRef, useState } from "react";
import { Building2, Plus, Pencil, ImagePlus, X, Loader2, Power, Trash2, Hash, Landmark } from "lucide-react";
import { toast } from "sonner";
import { updateDb, uid, type Company, type Settings } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl } from "@/lib/storage";
import {
  MAIN_COMPANY_ID, companiesOf, companyIdOfClient, companyIdOfInvoice, companyProblem, formatInvoiceNumber,
} from "@/lib/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmBox } from "@/lib/confirm";

type ImgKey = "logoUrl" | "stamp" | "qr1" | "qr2" | "bankImage1" | "bankImage2";
const IMAGES: { key: ImgKey; label: string }[] = [
  { key: "logoUrl", label: "Logo" },
  { key: "stamp", label: "Stamp / seal" },
  { key: "qr1", label: "Payment QR 1" },
  { key: "qr2", label: "Payment QR 2" },
  { key: "bankImage1", label: "Bank details 1" },
  { key: "bankImage2", label: "Bank details 2" },
];

const toDataUrl = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

/** The first company lives in the settings themselves — written back field by field. */
function writeMain(s: Settings, c: Company) {
  s.companyName = c.name;
  s.companyLegalSuffix = c.legalSuffix;
  s.companyCountry = c.country;
  s.companyLogoUrl = c.logoUrl;
  s.invoiceAddress1 = c.address1; s.invoiceAddress2 = c.address2; s.invoiceAddress3 = c.address3;
  s.invoiceTel = c.tel; s.invoicePrimary = c.primary; s.invoiceEmail = c.email; s.invoiceWebsite = c.website;
  s.invoiceTaxLabel = c.taxLabel; s.invoiceTaxId = c.taxId; s.invoiceTerms = c.terms;
  s.invoiceQr1 = c.qr1; s.invoiceQr2 = c.qr2; s.invoiceStamp = c.stamp;
  s.bankDetailsImage1 = c.bankImage1; s.bankDetailsImage2 = c.bankImage2; s.invoiceBankText = c.bankText;
  // Firestore keeps no undefined fields; drop the ones cleared.
  for (const k of Object.keys(s) as (keyof Settings)[]) if (s[k] === undefined) delete s[k];
}

/**
 * Settings → Companies. Each of our companies with its own name, logo,
 * address, tax number, bank details and invoice number series. The first
 * company is the business's own settings; the others are added here.
 */
export function CompaniesSettings() {
  const db = useDb();
  const companies = companiesOf(db.settings);
  const [editing, setEditing] = useState<Company | null>(null);

  const clientsOf = (id: string) => db.clients.filter(c => companyIdOfClient(c) === id).length;
  const invoicesOf = (id: string) => (db.invoices ?? []).filter(i => companyIdOfInvoice(i) === id).length;

  const toggle = async (c: Company) => {
    if (c.id === MAIN_COMPANY_ID) return;
    const on = c.active === false;
    if (!on && !(await confirmBox(`Stop using ${c.name}?\n\nIts clients and invoices stay as they are; it just won't be offered for new clients.`))) return;
    updateDb(d => { const x = d.settings.companies?.find(y => y.id === c.id); if (x) x.active = on; });
    toast.success(on ? `${c.name} is in use again` : `${c.name} is no longer offered for new clients`);
  };
  const remove = async (c: Company) => {
    if (clientsOf(c.id) || invoicesOf(c.id)) { toast.error("It has clients or invoices — stop using it instead."); return; }
    if (!(await confirmBox(`Delete ${c.name}? It has no clients or invoices.`))) return;
    updateDb(d => { d.settings.companies = (d.settings.companies ?? []).filter(y => y.id !== c.id); });
    toast.success(`${c.name} deleted`);
  };

  return (
    <div className="card-luxe p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold">Companies</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each company prints its own name, logo, address, bank details and invoice numbers on its clients' invoices, proformas and statements.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setEditing({ id: "", name: "", invoicePrefix: "", legalSuffix: "", active: true, createdAt: "" })} className="btn-hero rounded-xl gap-1.5">
          <Plus className="h-4 w-4" /> Add company
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {companies.map((c, i) => (
          <div key={c.id} className={`rounded-2xl border p-4 space-y-3 ${c.active === false ? "opacity-60 border-dashed" : "border-border/70"}`}>
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-xl border border-border/60 bg-white grid place-items-center overflow-hidden shrink-0">
                {c.logoUrl || c.id === MAIN_COMPANY_ID
                  ? <img src={c.logoUrl || "/starlink-logo.png"} alt="" className="max-h-full max-w-full object-contain" />
                  : <Building2 className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-brand-dark truncate">{c.name} {c.legalSuffix && <span className="text-muted-foreground font-normal">{c.legalSuffix}</span>}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {i === 0 ? "Company 1 · " : ""}{[c.country, c.currency].filter(Boolean).join(" · ") || "No country set"}
                </p>
              </div>
              <button type="button" onClick={() => setEditing({ ...c })} title="Edit" className="h-8 w-8 grid place-items-center rounded-lg hover:bg-secondary shrink-0">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold"><Hash className="h-3 w-3" />Invoices {formatInvoiceNumber(c, 1)}…</span>
              <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{clientsOf(c.id)} client{clientsOf(c.id) !== 1 ? "s" : ""}</span>
              <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{invoicesOf(c.id)} invoice{invoicesOf(c.id) !== 1 ? "s" : ""}</span>
              {(c.bankImage1 || c.bankImage2 || c.bankText) && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success"><Landmark className="h-3 w-3" />Bank details</span>}
              {c.active === false && <span className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-semibold">Not in use</span>}
            </div>
            {c.id !== MAIN_COMPANY_ID && (
              <div className="flex gap-3 text-[11px]">
                <button type="button" onClick={() => toggle(c)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Power className="h-3 w-3" />{c.active === false ? "Use again" : "Stop using"}</button>
                {!clientsOf(c.id) && !invoicesOf(c.id) && (
                  <button type="button" onClick={() => remove(c)} className="inline-flex items-center gap-1 text-destructive hover:underline"><Trash2 className="h-3 w-3" />Delete</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
        <li>Every client, invoice and employee from before belongs to Company 1, and Company 1's invoice numbers carry on as they are.</li>
        <li>Each new company numbers its invoices on its own, with its prefix: SJD-0001, SJD-0002…</li>
        <li>A client's invoices are fixed to the company that issued them — moving the client later never changes a bill already sent.</li>
      </ul>

      {editing && <CompanyEditor company={editing} all={companies} invoices={invoicesOf(editing.id || "_new")} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The one company form — Settings → Companies, and "+ Add new company" in a dropdown. */
export function CompanyEditor({ company, all, invoices, onClose, onSaved }: { company: Company; all: Company[]; invoices: number; onClose: () => void; onSaved?: (id: string) => void }) {
  const isNew = !company.id;
  const isMain = company.id === MAIN_COMPANY_ID;
  const [c, setC] = useState<Company>(company);
  const [uploading, setUploading] = useState<ImgKey | null>(null);
  const idRef = useRef(company.id || uid("co_"));
  const set = (patch: Partial<Company>) => setC(prev => ({ ...prev, ...patch }));

  const upload = async (key: ImgKey, f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Choose an image file"); return; }
    if (f.size > 4 * 1024 * 1024) { toast.error("That image is over 4 MB — please use a smaller one"); return; }
    setUploading(key);
    try {
      const url = await uploadDataUrl(await toDataUrl(f), `companies/${idRef.current}`);
      set({ [key]: url } as Partial<Company>);
    } catch {
      toast.error("Couldn't upload the image");
    } finally { setUploading(null); }
  };

  const save = () => {
    const clean: Company = { ...c, id: idRef.current, name: c.name.trim(), invoicePrefix: c.invoicePrefix.trim().toUpperCase(), createdAt: c.createdAt || new Date().toISOString() };
    const problem = companyProblem(clean, all);
    if (problem) { toast.error(problem); return; }
    updateDb(d => {
      if (isMain) { writeMain(d.settings, clean); return; }
      const list = d.settings.companies ?? (d.settings.companies = []);
      const row = Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined && v !== "")) as unknown as Company;
      row.invoicePrefix = clean.invoicePrefix; row.name = clean.name;
      const at = list.findIndex(x => x.id === row.id);
      if (at >= 0) list[at] = row; else list.push(row);
    });
    toast.success(isNew ? `${clean.name} added` : `${clean.name} saved`);
    onClose();
    onSaved?.(clean.id);
  };

  const field = (key: keyof Company, label: string, placeholder = "", extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={(c[key] as string | undefined) ?? ""} onChange={e => set({ [key]: e.target.value } as Partial<Company>)} placeholder={placeholder} className="rounded-xl mt-1 h-10" {...extra} />
    </div>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">{isNew ? "Add company" : `Edit ${company.name}`}</DialogTitle></DialogHeader>

        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The company</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">{field("name", "Name *", "e.g. Starlink Diamonds")}</div>
            {field("legalSuffix", "Legal form", "INC, LLC, LTD, DMCC")}
            {field("country", "Country", "e.g. UAE")}
            {!isMain && field("currency", "Currency shown", "e.g. USD, AED")}
            {!isMain && (
              <div>
                <Label className="text-xs">Invoice prefix *</Label>
                <Input value={c.invoicePrefix} onChange={e => set({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })}
                  disabled={invoices > 0} placeholder="e.g. SJD" className="rounded-xl mt-1 h-10 font-mono" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {invoices > 0 ? "Fixed — this company has invoices numbered with it." : `Its invoices: ${c.invoicePrefix || "XXX"}-0001, ${c.invoicePrefix || "XXX"}-0002…`}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Address &amp; contact — printed at the top of its invoices</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {field("address1", "Street")}
            {field("address2", "City / area")}
            {field("address3", "State, ZIP / country")}
            {field("tel", "Tel")}
            {field("primary", "Primary phone")}
            {field("email", "Email")}
            {field("website", "Website")}
            {field("taxLabel", "Tax label", "GST, VAT, EIN, TRN")}
            {field("taxId", "Tax number")}
            {field("terms", "Payment terms", "e.g. COD, Net 30")}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Logo, stamp, QR codes &amp; bank details</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {IMAGES.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <label className="block aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/30 overflow-hidden cursor-pointer relative">
                  <input type="file" accept="image/*" className="hidden" onChange={e => { void upload(key, e.target.files?.[0]); e.target.value = ""; }} />
                  {uploading === key ? <span className="absolute inset-0 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></span>
                    : c[key] ? <img src={c[key]} alt="" className="h-full w-full object-contain bg-white" />
                    : <span className="absolute inset-0 grid place-items-center"><ImagePlus className="h-5 w-5 text-muted-foreground" /></span>}
                </label>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
                  {c[key] && <button type="button" onClick={() => set({ [key]: undefined } as Partial<Company>)} title="Remove" className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>}
                </div>
              </div>
            ))}
          </div>
          <div>
            <Label className="text-xs">Bank / wire details as text <span className="text-muted-foreground">(printed when there are no bank pictures)</span></Label>
            <Textarea value={c.bankText ?? ""} onChange={e => set({ bankText: e.target.value })} rows={4} className="rounded-xl mt-1 text-sm"
              placeholder={"Bank: …\nAccount name: …\nAccount no: …\nSWIFT / IBAN: …"} />
          </div>
        </section>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} disabled={!!uploading} className="btn-hero rounded-xl">{isNew ? "Add company" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
