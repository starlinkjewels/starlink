import { useRef, useState } from "react";
import { loadDb, saveDb, updateDb, uid, orderTotal, balanceDue, type DB } from "@/lib/db";
import { uploadDataUrl } from "@/lib/storage";
import { createAuthUser } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Diamond,
  Weight,
  Truck,
  Upload,
  X,
  QrCode,
  Stamp,
  Landmark,
  FileText,
  ShieldCheck,
  Loader2,
} from "lucide-react";

async function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = (e) => res(e.target?.result as string);
    r.readAsDataURL(file);
  });
}

export function SettingsPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(loadDb());

  const qr1Ref = useRef<HTMLInputElement>(null);
  const qr2Ref = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);
  const bankImg1Ref = useRef<HTMLInputElement>(null);
  const bankImg2Ref = useRef<HTMLInputElement>(null);

  const save = () => {
    saveDb(db);
    toast.success("Settings saved");
  };
  const saveRates = () => {
    saveDb(db);
    toast.success("Pricing rates updated");
  };
  const saveInvoice = () => {
    saveDb(db);
    toast.success("Invoice settings saved");
  };

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
        const d = JSON.parse(r.result as string) as DB;
        // Push the restored data into Firestore (keep the current session).
        const fresh = loadDb();
        Object.assign(fresh, d, { session: fresh.session });
        saveDb(fresh);
        toast.success("Restored to database");
        setDb(fresh);
      } catch {
        toast.error("Invalid file");
      }
    };
    r.readAsText(f);
  };
  const clear = async () => {
    if (
      !confirm(
        "Wipe ALL data from the database and reset to the admin seed? This cannot be undone.",
      )
    )
      return;
    const fresh = loadDb();
    fresh.users = [];
    fresh.clients = [];
    fresh.orders = [];
    fresh.tasks = [];
    fresh.messages = [];
    fresh.notifications = [];
    fresh.invoices = [];
    fresh.expenses = [];
    fresh.catalogFolders = [];
    fresh.catalogFavorites = [];
    saveDb(fresh); // diff-sync deletes every remote doc; admin is re-seeded on next boot
    // catalogItems is paginated and lives outside the diff-sync engine (see
    // src/lib/catalogItems.ts) — wipe it directly.
    const { deleteAllCatalogItems } = await import("@/lib/catalogItems");
    await deleteAllCatalogItems();
    toast.success("Data cleared — reloading");
    setTimeout(() => location.reload(), 600);
  };

  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const handleImg = async (
    field: "invoiceQr1" | "invoiceQr2" | "invoiceStamp" | "bankDetailsImage1" | "bankDetailsImage2",
    file: File,
  ) => {
    setUploadingField(field);
    try {
      const url = await uploadDataUrl(await toBase64(file), "settings");
      setDb((prev) => ({ ...prev, settings: { ...prev.settings, [field]: url } }));
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setUploadingField(null);
    }
  };

  const canEditRates = user?.role === "admin" || user?.role === "employee";
  const isAdmin = user?.role === "admin";

  // Orders that have been priced but never had an invoice number assigned —
  // lets admin backfill all of them at once instead of opening each order to print.
  const ordersNeedingInvoice = loadDb()
    .orders.filter((o) => o.amount > 0 && !loadDb().invoices.some((i) => i.orderId === o.id))
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  const [generatingInvoices, setGeneratingInvoices] = useState(false);
  const generateInvoiceNumbers = () => {
    const fresh = loadDb();
    const missing = fresh.orders
      .filter((o) => o.amount > 0 && !fresh.invoices.some((i) => i.orderId === o.id))
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    if (!missing.length) return;
    if (
      !confirm(
        `Generate invoice numbers for ${missing.length} order${missing.length !== 1 ? "s" : ""}, oldest first? This cannot be undone.`,
      )
    )
      return;
    setGeneratingInvoices(true);
    updateDb((d) => {
      let n = d.invoices.length;
      for (const o of missing) {
        n++;
        d.invoices.push({
          id: uid("inv_"),
          orderId: o.id,
          clientId: o.clientId,
          number: String(n).padStart(4, "0"),
          amount: orderTotal(o),
          paid: balanceDue(o) <= 0,
          createdAt: o.createdAt,
        });
      }
    });
    toast.success(`Generated ${missing.length} invoice number${missing.length !== 1 ? "s" : ""}`);
    setGeneratingInvoices(false);
  };

  // Users created under the previous model (password in Firestore, no Auth
  // account). Admin can provision Firebase Auth logins for them in one click.
  const [syncing, setSyncing] = useState(false);
  const pendingLogins = loadDb().users.filter(
    (u) => u.role !== "admin" && !u.authUid && !!u.password,
  );
  const syncLogins = async () => {
    const targets = loadDb().users.filter((u) => u.role !== "admin" && !u.authUid && !!u.password);
    if (!targets.length) {
      toast.info("Everyone already has a Firebase login.");
      return;
    }
    setSyncing(true);
    let ok = 0;
    const failed: string[] = [];
    for (const u of targets) {
      try {
        const authUid = await createAuthUser(u.email, u.password);
        updateDb((d) => {
          const x = d.users.find((y) => y.id === u.id);
          if (x) {
            x.authUid = authUid;
            x.password = "";
          }
        });
        ok++;
      } catch (e) {
        failed.push(`${u.email} (${authErrorMessage(e)})`);
      }
    }
    setSyncing(false);
    if (ok) toast.success(`Provisioned ${ok} login${ok !== 1 ? "s" : ""}.`);
    if (failed.length) toast.error(`${failed.length} failed — recreate them: ${failed.join(", ")}`);
  };

  /* ── small preview card for uploaded images ── */
  const ImgSlot = ({
    label,
    icon: Icon,
    value,
    fieldKey,
    inputRef,
  }: {
    label: string;
    icon: React.ElementType;
    value?: string;
    fieldKey:
      "invoiceQr1" | "invoiceQr2" | "invoiceStamp" | "bankDetailsImage1" | "bankDetailsImage2";
    inputRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative h-24 w-24 rounded-xl border-2 border-dashed border-border hover:border-primary/50 cursor-pointer overflow-hidden transition-colors group"
        onClick={() => {
          if (uploadingField !== fieldKey) inputRef.current?.click();
        }}
      >
        {uploadingField === fieldKey && (
          <div className="absolute inset-0 z-10 bg-black/50 grid place-items-center">
            <Loader2 className="h-5 w-5 text-white animate-spin" />
          </div>
        )}
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
          onClick={() =>
            setDb((prev) => ({ ...prev, settings: { ...prev.settings, [fieldKey]: undefined } }))
          }
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
        onChange={async (e) => {
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
            onChange={(e) =>
              setDb({ ...db, settings: { ...db.settings, companyName: e.target.value } })
            }
            className="rounded-xl mt-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Currency</Label>
            <Input
              value={db.settings.currency}
              onChange={(e) =>
                setDb({ ...db, settings: { ...db.settings, currency: e.target.value } })
              }
              className="rounded-xl mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Language</Label>
            <Input
              value={db.settings.language}
              onChange={(e) =>
                setDb({ ...db, settings: { ...db.settings, language: e.target.value } })
              }
              className="rounded-xl mt-1"
            />
          </div>
        </div>
        <label className="flex items-center justify-between">
          <span className="text-sm">Push notifications</span>
          <Switch
            checked={db.settings.notifications}
            onCheckedChange={(v) =>
              setDb({ ...db, settings: { ...db.settings, notifications: v } })
            }
          />
        </label>
        <AsyncButton onClick={save} className="btn-hero rounded-xl w-full">
          Save Settings
        </AsyncButton>
      </div>

      {/* ── Invoice Branding ── */}
      <div className="card-luxe p-6 space-y-5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold">Invoice / Bill Settings</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Address, bank details, QR codes and stamp shown on every printed bill
            </p>
          </div>
        </div>

        {/* Address fields */}
        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Address Line 1 (Street)</Label>
            <Input
              value={db.settings.invoiceAddress1 ?? ""}
              onChange={(e) =>
                setDb({ ...db, settings: { ...db.settings, invoiceAddress1: e.target.value } })
              }
              placeholder="55 JOHN ST"
              className="rounded-xl"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">City / Area</Label>
              <Input
                value={db.settings.invoiceAddress2 ?? ""}
                onChange={(e) =>
                  setDb({ ...db, settings: { ...db.settings, invoiceAddress2: e.target.value } })
                }
                placeholder="EAST RUTHERFORD"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">State &amp; ZIP</Label>
              <Input
                value={db.settings.invoiceAddress3 ?? ""}
                onChange={(e) =>
                  setDb({ ...db, settings: { ...db.settings, invoiceAddress3: e.target.value } })
                }
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
                onChange={(e) =>
                  setDb({ ...db, settings: { ...db.settings, invoiceTel: e.target.value } })
                }
                placeholder="+91 83472 78188"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Primary Phone</Label>
              <Input
                value={db.settings.invoicePrimary ?? ""}
                onChange={(e) =>
                  setDb({ ...db, settings: { ...db.settings, invoicePrimary: e.target.value } })
                }
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
                onChange={(e) =>
                  setDb({ ...db, settings: { ...db.settings, invoiceEmail: e.target.value } })
                }
                placeholder="Starlinkjewels@gmail.com"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Invoice Terms</Label>
              <Input
                value={db.settings.invoiceTerms ?? "COD"}
                onChange={(e) =>
                  setDb({ ...db, settings: { ...db.settings, invoiceTerms: e.target.value } })
                }
                placeholder="COD"
                className="rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Image uploads */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            Bill Images
          </p>
          <div className="flex items-start justify-around gap-4 flex-wrap">
            <ImgSlot
              label="Bank Details 1 (e.g. USA Wire)"
              icon={Landmark}
              value={db.settings.bankDetailsImage1}
              fieldKey="bankDetailsImage1"
              inputRef={bankImg1Ref}
            />
            <ImgSlot
              label="Bank Details 2 (e.g. International Wire)"
              icon={Landmark}
              value={db.settings.bankDetailsImage2}
              fieldKey="bankDetailsImage2"
              inputRef={bankImg2Ref}
            />
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

        <AsyncButton onClick={saveInvoice} className="btn-hero rounded-xl w-full">
          Save Invoice Settings
        </AsyncButton>
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={db.settings.diamondRate ?? 3500}
                  onChange={(e) =>
                    setDb({
                      ...db,
                      settings: {
                        ...db.settings,
                        diamondRate: Math.max(0, Number(e.target.value)),
                      },
                    })
                  }
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={db.settings.metalRate ?? 65}
                  onChange={(e) =>
                    setDb({
                      ...db,
                      settings: { ...db.settings, metalRate: Math.max(0, Number(e.target.value)) },
                    })
                  }
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={db.settings.defaultShippingCharge ?? 0}
                  onChange={(e) =>
                    setDb({
                      ...db,
                      settings: {
                        ...db.settings,
                        defaultShippingCharge: Math.max(0, Number(e.target.value)),
                      },
                    })
                  }
                  className="rounded-xl pl-7"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                pre-filled on every new order — staff can override per order
              </p>
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-xl bg-secondary/50 border border-border/60 px-4 py-3 text-sm text-muted-foreground">
            Example: 0.5 ct diamond + 3 g metal + shipping ={" "}
            <span className="font-semibold text-foreground">
              $
              {(
                (db.settings.diamondRate ?? 3500) * 0.5 +
                (db.settings.metalRate ?? 65) * 3 +
                (db.settings.defaultShippingCharge ?? 0)
              ).toLocaleString()}
            </span>
          </div>

          <AsyncButton onClick={saveRates} className="btn-hero rounded-xl w-full">
            Save Pricing Rates
          </AsyncButton>
        </div>
      )}

      {/* Bulk invoice numbering — admin only, shown only when some priced orders have no invoice yet */}
      {isAdmin && ordersNeedingInvoice.length > 0 && (
        <div className="card-luxe p-6 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Invoice Numbering</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {ordersNeedingInvoice.length} priced order
            {ordersNeedingInvoice.length !== 1 ? "s don't" : " doesn't"} have an invoice number yet.
            Generate them all at once — numbered{" "}
            {String(loadDb().invoices.length + 1).padStart(4, "0")} through{" "}
            {String(loadDb().invoices.length + ordersNeedingInvoice.length).padStart(4, "0")},
            oldest order first.
          </p>
          <AsyncButton
            onClick={generateInvoiceNumbers}
            disabled={generatingInvoices}
            className="btn-hero rounded-xl w-full"
          >
            {generatingInvoices
              ? "Generating…"
              : `Generate ${ordersNeedingInvoice.length} invoice number${ordersNeedingInvoice.length !== 1 ? "s" : ""}`}
          </AsyncButton>
        </div>
      )}

      {/* Sync logins — admin only, shown only when there is something to migrate */}
      {isAdmin && pendingLogins.length > 0 && (
        <div className="card-luxe p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Secure Logins</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {pendingLogins.length} employee/client account
            {pendingLogins.length !== 1 ? "s were" : " was"} created before Firebase Authentication.
            Provision real Auth logins for them (uses their current password). After this, no
            passwords remain in the database.
          </p>
          <Button onClick={syncLogins} disabled={syncing} className="btn-hero rounded-xl w-full">
            {syncing
              ? "Provisioning…"
              : `Provision ${pendingLogins.length} login${pendingLogins.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}

      {/* Data */}
      <div className="card-luxe p-6 space-y-3">
        <h3 className="font-semibold">Data</h3>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={exp} className="rounded-xl">
            Backup
          </Button>
          <label className="cursor-pointer">
            <input type="file" accept="application/json" onChange={imp} className="hidden" />
            <span className="inline-flex items-center justify-center w-full h-9 rounded-xl border text-sm hover:bg-secondary">
              Restore
            </span>
          </label>
        </div>
        <AsyncButton
          variant="outline"
          onClick={clear}
          className="rounded-xl w-full text-destructive"
        >
          Clear Data &amp; Reset Seed
        </AsyncButton>
      </div>
    </div>
  );
}
