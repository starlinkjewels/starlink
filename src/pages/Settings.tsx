import { useRef, useState } from "react";
import { loadDb, saveDb, updateDb, uid, orderTotal, balanceDue, orderInvoiced, DEFAULT_EXPENSE_CATEGORIES, type DB } from "@/lib/db";
import { uploadDataUrl } from "@/lib/storage";
import { createAuthUser } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Tag,
  Plus,
  Gift,
  DollarSign,
  Building2,
  Database,
  SlidersHorizontal,
} from "lucide-react";

async function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = (e) => res(e.target?.result as string);
    r.readAsDataURL(file);
  });
}

const DEFAULT_LABEL_PRESETS = [
  { id: "tag-72x12", name: "Jewellery tag", style: "tag" as const, widthMm: 72, heightMm: 12 },
  { id: "label-50x30", name: "Spec label", style: "label" as const, widthMm: 50, heightMm: 30 },
];

export function SettingsPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(loadDb());
  const [lp, setLp] = useState({ name: "", style: "tag" as "tag" | "label", w: "", h: "" });
  const [active, setActive] = useState("company");

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
  const saveBand = () => {
    saveDb(db);
    toast.success("Label & barcode settings saved");
  };

  // Expense categories — instant add/remove (like toggling a locker/factory
  // active, not a staged "Save" form). Removing one is non-destructive: any
  // Expense already using that category keeps its string untouched, it just
  // stops appearing in the picker for new expenses.
  const [newCategory, setNewCategory] = useState("");
  const expenseCategories = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (expenseCategories.some(c => c.toLowerCase() === name.toLowerCase())) { toast.error("That category already exists"); return; }
    const next = { ...db, settings: { ...db.settings, expenseCategories: [...expenseCategories, name] } };
    saveDb(next); setDb(next); setNewCategory("");
  };
  const removeCategory = (name: string) => {
    const next = { ...db, settings: { ...db.settings, expenseCategories: expenseCategories.filter(c => c !== name) } };
    saveDb(next); setDb(next);
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
        if (!d || !Array.isArray(d.orders) || !Array.isArray(d.clients)) { toast.error("This doesn't look like a valid backup file."); e.target.value = ""; return; }
        const ok = confirm(
          `Restore from this backup? It REPLACES all current data with the file's contents ` +
          `(${d.clients.length} clients, ${d.orders.length} orders). This cannot be undone.`,
        );
        if (!ok) { e.target.value = ""; return; }
        // Push the restored data into Firestore (keep the current session).
        const fresh = loadDb();
        Object.assign(fresh, d, { session: fresh.session });
        saveDb(fresh);
        toast.success("Restored to database");
        setDb(fresh);
      } catch {
        toast.error("Invalid file");
      } finally {
        e.target.value = ""; // allow re-selecting the same file
      }
    };
    r.readAsText(f);
  };
  const clear = async () => {
    // Most destructive action in the app — require typing RESET, not a single OK.
    const typed = prompt(
      "This WIPES ALL data (clients, orders, invoices, payments, expenses, catalog) and cannot be undone.\n\nType RESET to confirm:",
    );
    if (typed?.trim().toUpperCase() !== "RESET") { toast.info("Cancelled — nothing was deleted."); return; }
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
    .orders.filter((o) => o.amount > 0 && o.status !== "Rejected" && !orderInvoiced(loadDb().invoices, o.id))
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  const [generatingInvoices, setGeneratingInvoices] = useState(false);
  const generateInvoiceNumbers = () => {
    const fresh = loadDb();
    const missing = fresh.orders
      .filter((o) => o.amount > 0 && o.status !== "Rejected" && !orderInvoiced(fresh.invoices, o.id))
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
          orderIds: [o.id],
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

  const sections = [
    { id: "company", label: "Company", icon: Building2, show: true },
    { id: "invoice", label: "Invoice & Bill", icon: FileText, show: true },
    { id: "pricing", label: "Pricing Rates", icon: DollarSign, show: canEditRates },
    { id: "labels", label: "Labels & Barcode", icon: Tag, show: canEditRates },
    { id: "expenses", label: "Expense Categories", icon: SlidersHorizontal, show: isAdmin },
    { id: "logins", label: "Secure Logins", icon: ShieldCheck, show: isAdmin && pendingLogins.length > 0 },
    { id: "data", label: "Data & Backup", icon: Database, show: true },
  ].filter((s) => s.show);
  const activeId = sections.some((s) => s.id === active) ? active : sections[0]?.id;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Settings</h1>

      <div className="grid lg:grid-cols-[230px_1fr] gap-5 items-start">
        {/* Section nav — vertical rail on desktop, scrollable pills on mobile */}
        <nav className="lg:sticky lg:top-4 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 pb-1 lg:pb-0 lg:pr-0">
          {sections.map((s) => {
            const Icon = s.icon;
            const on = activeId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`group flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                  on ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${on ? "text-white" : "text-primary/70 group-hover:text-primary"}`} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Active section content */}
        <div className="min-w-0 space-y-4">

      {/* Company */}
      {activeId === "company" && (
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
      )}

      {/* ── Invoice Branding ── */}
      {activeId === "invoice" && (
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
      )}

      {/* Pricing Rates — admin & employee only */}
      {activeId === "pricing" && (
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

            {/* Cashback % (gift cards) */}
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs flex items-center gap-1.5">
                <Gift className="h-3.5 w-3.5 text-primary" />
                Cashback % on delivered orders
              </Label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={db.settings.cashbackPercent ?? 0}
                  onChange={(e) =>
                    setDb({
                      ...db,
                      settings: {
                        ...db.settings,
                        cashbackPercent: Math.max(0, Number(e.target.value)),
                      },
                    })
                  }
                  className="rounded-xl pr-7"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                default cashback for gift-card-enabled clients — this % of each delivered order becomes a gift card for their next order. Only applies to clients you turn on; override per client on their page. 0 = off.
              </p>
            </div>

            {/* Gift card max redemption % (default) */}
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs flex items-center gap-1.5">
                <Gift className="h-3.5 w-3.5 text-primary" />
                Max gift-card use per order (%)
              </Label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={db.settings.giftMaxRedeemPercent ?? 25}
                  onChange={(e) =>
                    setDb({
                      ...db,
                      settings: {
                        ...db.settings,
                        giftMaxRedeemPercent: Math.min(100, Math.max(0, Number(e.target.value))),
                      },
                    })
                  }
                  className="rounded-xl pr-7"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                default cap on how much of a single order a gift card can cover — the rest carries to the next order. Override per client on their page.
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

      {/* Labels & Barcode — admin & employee only */}
      {activeId === "labels" && (
        <div className="card-luxe p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold">Labels &amp; Barcode</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Jewellery band printing and label-printer profiles</p>
            </div>
          </div>

          {/* Barcode band (jewellery tag) toggles */}
          <div className="grid sm:grid-cols-2 gap-3">
            <button type="button"
              onClick={() => setDb({ ...db, settings: { ...db.settings, barcodeBandEnabled: !(db.settings.barcodeBandEnabled !== false) } })}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3 text-left hover:bg-secondary/40 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Tag className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Barcode band on orders</p>
                  <p className="text-[11px] text-muted-foreground">Show the “Band” print/download button</p>
                </div>
              </div>
              <span className={`relative h-6 w-10 rounded-full shrink-0 transition-colors ${db.settings.barcodeBandEnabled !== false ? "bg-success" : "bg-secondary border border-border"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${db.settings.barcodeBandEnabled !== false ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>

            <button type="button"
              onClick={() => setDb({ ...db, settings: { ...db.settings, barcodeBandShowPrice: !(db.settings.barcodeBandShowPrice !== false) } })}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3 text-left hover:bg-secondary/40 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 grid place-items-center shrink-0"><DollarSign className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Show price on band</p>
                  <p className="text-[11px] text-muted-foreground">Print the price on the tag</p>
                </div>
              </div>
              <span className={`relative h-6 w-10 rounded-full shrink-0 transition-colors ${db.settings.barcodeBandShowPrice !== false ? "bg-success" : "bg-secondary border border-border"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${db.settings.barcodeBandShowPrice !== false ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
          </div>

          {/* Label printers & bands — define a size per label printer / roll */}
          {(() => {
            const rows = db.settings.labelPresets ?? DEFAULT_LABEL_PRESETS;
            const remove = (id: string) => setDb({ ...db, settings: { ...db.settings, labelPresets: rows.filter(p => p.id !== id) } });
            const add = () => {
              const w = Number(lp.w), h = Number(lp.h);
              if (!lp.name.trim() || !w || !h) { toast.error("Enter a name, width and height"); return; }
              const preset = { id: uid("lp_"), name: lp.name.trim(), style: lp.style, widthMm: w, heightMm: h };
              setDb({ ...db, settings: { ...db.settings, labelPresets: [...rows, preset] } });
              setLp({ name: "", style: "tag", w: "", h: "" });
            };
            return (
              <div className="rounded-xl border border-border/70 p-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center"><Tag className="h-4 w-4" /></div>
                  <div>
                    <h3 className="font-semibold text-brand-dark text-sm">Label printers &amp; bands</h3>
                    <p className="text-[11px] text-muted-foreground">A size for each label printer / roll — chosen when you print a band.</p>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  {rows.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">{p.style === "tag" ? "Jewellery tag" : "Spec label"} · {p.widthMm}×{p.heightMm}mm</p>
                      </div>
                      <button onClick={() => remove(p.id)} className="h-7 w-7 rounded-lg grid place-items-center text-destructive hover:bg-destructive/10 shrink-0" title="Remove"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                  <div className="col-span-2 sm:col-span-2"><Label className="text-[11px]">Name</Label><Input value={lp.name} onChange={e => setLp({ ...lp, name: e.target.value })} placeholder="e.g. Godex 50x30" className="rounded-lg h-9 mt-1" /></div>
                  <div><Label className="text-[11px]">Style</Label>
                    <Select value={lp.style} onValueChange={v => setLp({ ...lp, style: v as "tag" | "label" })}>
                      <SelectTrigger className="h-9 rounded-lg mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="tag">Tag</SelectItem><SelectItem value="label">Label</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-[11px]">W (mm)</Label><Input type="number" min={5} value={lp.w} onChange={e => setLp({ ...lp, w: e.target.value })} className="rounded-lg h-9 mt-1" /></div>
                  <div><Label className="text-[11px]">H (mm)</Label><Input type="number" min={5} value={lp.h} onChange={e => setLp({ ...lp, h: e.target.value })} className="rounded-lg h-9 mt-1" /></div>
                  <Button onClick={add} className="btn-hero rounded-lg h-9 gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
                </div>

                <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                  Printers connect through your device (USB · Bluetooth · Wi‑Fi) and appear in the print dialog — pick the printer there. Barcode scanners work automatically as keyboard input. Nothing else to set up.
                </p>
              </div>
            );
          })()}

          <AsyncButton onClick={saveBand} className="btn-hero rounded-xl w-full">
            Save Label &amp; Barcode Settings
          </AsyncButton>
        </div>
      )}

      {/* Expense Categories — admin only */}
      {activeId === "expenses" && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold">Expense Categories</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Shown in the category picker when staff record an expense</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {expenseCategories.map(c => (
              <span key={c} className="inline-flex items-center gap-1.5 text-xs font-medium pl-3 pr-1.5 py-1.5 rounded-full bg-secondary text-foreground">
                {c}
                <button onClick={() => removeCategory(c)} className="h-4 w-4 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newCategory} onChange={e => setNewCategory(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCategory()}
              className="rounded-xl h-10" placeholder="New category name"
            />
            <Button onClick={addCategory} variant="outline" className="rounded-xl gap-2 shrink-0"><Plus className="h-4 w-4" /> Add</Button>
          </div>
        </div>
      )}

      {/* Invoice numbers are now assigned automatically when an order is priced
          (and back-filled on the Invoices page) — no manual step needed. */}

      {/* Sync logins — admin only, shown only when there is something to migrate */}
      {activeId === "logins" && (
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
      {activeId === "data" && (
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
      )}

        </div>
      </div>
    </div>
  );
}
