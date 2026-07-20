import { useRef, useState } from "react";
import { loadDb, saveDb } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Diamond, Weight, Truck, Upload, X, QrCode, Stamp, FileText } from "lucide-react";

async function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = e => res(e.target?.result as string);
    r.readAsDataURL(file);
  });
}

export function SettingsPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(loadDb());

  const qr1Ref    = useRef<HTMLInputElement>(null);
  const qr2Ref    = useRef<HTMLInputElement>(null);
  const stampRef  = useRef<HTMLInputElement>(null);

  const save = () => { saveDb(db); toast.success("Settings saved"); };
  const saveRates = () => { saveDb(db); toast.success("Pricing rates updated"); };
  const saveInvoice = () => { saveDb(db); toast.success("Invoice settings saved"); };

  const exp = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "starlink-backup.json";
    a.click();
  };
  const imp = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result as string);
        localStorage.setItem("starlink_db_v2", JSON.stringify(d));
        window.dispatchEvent(new Event("starlink-db-updated"));
        toast.success("Restored");
        setDb(d);
      } catch { toast.error("Invalid file"); }
    };
    r.readAsText(f);
  };
  const clear = () => {
    if (!confirm("Wipe all data and reload seed?")) return;
    localStorage.removeItem("starlink_db_v2");
    location.reload();
  };

  const handleImg = async (field: "invoiceQr1" | "invoiceQr2" | "invoiceStamp", file: File) => {
    try {
      const b64 = await toBase64(file);
      setDb(prev => ({ ...prev, settings: { ...prev.settings, [field]: b64 } }));
    } catch { toast.error("Failed to read image"); }
  };

  const canEditRates = user?.role === "admin" || user?.role === "employee";

  /* ── small preview card for uploaded images ── */
  const ImgSlot = ({
    label, icon: Icon, value, fieldKey, inputRef,
  }: {
    label: string;
    icon: React.ElementType;
    value?: string;
    fieldKey: "invoiceQr1" | "invoiceQr2" | "invoiceStamp";
    inputRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative h-24 w-24 rounded-xl border-2 border-dashed border-border hover:border-primary/50 cursor-pointer overflow-hidden transition-colors group"
        onClick={() => inputRef.current?.click()}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="w-full h-full object-contain p-1" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Upload className="h-5 w-5 text-white" />
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <Icon className="h-6 w-6" />
            <span className="text-[10px] text-center px-1">Click to upload</span>
          </div>
        )}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => setDb(prev => ({ ...prev, settings: { ...prev.settings, [fieldKey]: undefined } }))}
          className="flex items-center gap-1 text-xs text-destructive hover:underline"
        >
          <X className="h-3 w-3" /> Remove
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0];
          if (f) await handleImg(fieldKey, f);
          e.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground text-center leading-tight">{label}</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Settings</h1>

      {/* Company */}
      <div className="card-luxe p-6 space-y-4">
        <h3 className="font-semibold">Company</h3>
        <div>
          <Label className="text-xs">Company Name</Label>
          <Input
            value={db.settings.companyName}
            onChange={e => setDb({ ...db, settings: { ...db.settings, companyName: e.target.value } })}
            className="rounded-xl mt-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Currency</Label>
            <Input
              value={db.settings.currency}
              onChange={e => setDb({ ...db, settings: { ...db.settings, currency: e.target.value } })}
              className="rounded-xl mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Language</Label>
            <Input
              value={db.settings.language}
              onChange={e => setDb({ ...db, settings: { ...db.settings, language: e.target.value } })}
              className="rounded-xl mt-1"
            />
          </div>
        </div>
        <label className="flex items-center justify-between">
          <span className="text-sm">Push notifications</span>
          <Switch
            checked={db.settings.notifications}
            onCheckedChange={v => setDb({ ...db, settings: { ...db.settings, notifications: v } })}
          />
        </label>
        <Button onClick={save} className="btn-hero rounded-xl w-full">Save Settings</Button>
      </div>

      {/* ── Invoice Branding ── */}
      <div className="card-luxe p-6 space-y-5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold">Invoice / Bill Settings</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Address, QR codes and stamp shown on every printed bill</p>
          </div>
        </div>

        {/* Address fields */}
        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Address Line 1 (Street)</Label>
            <Input
              value={db.settings.invoiceAddress1 ?? ""}
              onChange={e => setDb({ ...db, settings: { ...db.settings, invoiceAddress1: e.target.value } })}
              placeholder="55 JOHN ST"
              className="rounded-xl"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">City / Area</Label>
              <Input
                value={db.settings.invoiceAddress2 ?? ""}
                onChange={e => setDb({ ...db, settings: { ...db.settings, invoiceAddress2: e.target.value } })}
                placeholder="EAST RUTHERFORD"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">State &amp; ZIP</Label>
              <Input
                value={db.settings.invoiceAddress3 ?? ""}
                onChange={e => setDb({ ...db, settings: { ...db.settings, invoiceAddress3: e.target.value } })}
                placeholder="NEW JERSEY 07073"
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tel No</Label>
              <Input
                value={db.settings.invoiceTel ?? ""}
                onChange={e => setDb({ ...db, settings: { ...db.settings, invoiceTel: e.target.value } })}
                placeholder="+91 83472 78188"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Primary Phone</Label>
              <Input
                value={db.settings.invoicePrimary ?? ""}
                onChange={e => setDb({ ...db, settings: { ...db.settings, invoicePrimary: e.target.value } })}
                placeholder="+1 201 554 4824"
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                value={db.settings.invoiceEmail ?? ""}
                onChange={e => setDb({ ...db, settings: { ...db.settings, invoiceEmail: e.target.value } })}
                placeholder="Starlinkjewels@gmail.com"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Invoice Terms</Label>
              <Input
                value={db.settings.invoiceTerms ?? "COD"}
                onChange={e => setDb({ ...db, settings: { ...db.settings, invoiceTerms: e.target.value } })}
                placeholder="COD"
                className="rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Image uploads */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Bill Images</p>
          <div className="flex items-start justify-around gap-4 flex-wrap">
            <ImgSlot
              label="QR Code 1 (Venmo / Pay)"
              icon={QrCode}
              value={db.settings.invoiceQr1}
              fieldKey="invoiceQr1"
              inputRef={qr1Ref}
            />
            <ImgSlot
              label="QR Code 2 (Venmo / Pay)"
              icon={QrCode}
              value={db.settings.invoiceQr2}
              fieldKey="invoiceQr2"
              inputRef={qr2Ref}
            />
            <ImgSlot
              label="Company Stamp / Seal"
              icon={Stamp}
              value={db.settings.invoiceStamp}
              fieldKey="invoiceStamp"
              inputRef={stampRef}
            />
          </div>
        </div>

        <Button onClick={saveInvoice} className="btn-hero rounded-xl w-full">Save Invoice Settings</Button>
      </div>

      {/* Pricing Rates — admin & employee only */}
      {canEditRates && (
        <div className="card-luxe p-6 space-y-5">
          <div>
            <h3 className="font-semibold">Order Value Pricing Rates</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Used to auto-estimate order value on new orders. Staff can override per order.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Diamond rate */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Diamond className="h-3.5 w-3.5 text-primary" />
                Diamond Rate ($ / ct)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number" min={0} step={1}
                  value={db.settings.diamondRate ?? 3500}
                  onChange={e => setDb({ ...db, settings: { ...db.settings, diamondRate: Math.max(0, Number(e.target.value)) } })}
                  className="rounded-xl pl-7"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">per carat</p>
            </div>

            {/* Metal rate */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Weight className="h-3.5 w-3.5 text-primary" />
                Metal Rate ($ / g)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number" min={0} step={1}
                  value={db.settings.metalRate ?? 65}
                  onChange={e => setDb({ ...db, settings: { ...db.settings, metalRate: Math.max(0, Number(e.target.value)) } })}
                  className="rounded-xl pl-7"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">per gram</p>
            </div>

            {/* Default shipping charge */}
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-primary" />
                Default Shipping Charge ($ flat)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number" min={0} step={1}
                  value={db.settings.defaultShippingCharge ?? 0}
                  onChange={e => setDb({ ...db, settings: { ...db.settings, defaultShippingCharge: Math.max(0, Number(e.target.value)) } })}
                  className="rounded-xl pl-7"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">pre-filled on every new order — staff can override per order</p>
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-xl bg-secondary/50 border border-border/60 px-4 py-3 text-sm text-muted-foreground">
            Example: 0.5 ct diamond + 3 g metal + shipping ={" "}
            <span className="font-semibold text-foreground">
              ${(
                (db.settings.diamondRate ?? 3500) * 0.5 +
                (db.settings.metalRate ?? 65) * 3 +
                (db.settings.defaultShippingCharge ?? 0)
              ).toLocaleString()}
            </span>
          </div>

          <Button onClick={saveRates} className="btn-hero rounded-xl w-full">Save Pricing Rates</Button>
        </div>
      )}

      {/* Data */}
      <div className="card-luxe p-6 space-y-3">
        <h3 className="font-semibold">Data</h3>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={exp} className="rounded-xl">Backup</Button>
          <label className="cursor-pointer">
            <input type="file" accept="application/json" onChange={imp} className="hidden" />
            <span className="inline-flex items-center justify-center w-full h-9 rounded-xl border text-sm hover:bg-secondary">
              Restore
            </span>
          </label>
        </div>
        <Button variant="outline" onClick={clear} className="rounded-xl w-full text-destructive">
          Clear Data &amp; Reset Seed
        </Button>
      </div>
    </div>
  );
}
