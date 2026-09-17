import { useEffect, useMemo, useRef, useState } from "react";
import { loadDb, saveDb, updateDb, uid, orderTotal, balanceDue, fmtMoney, orderInvoiced, DEFAULT_EXPENSE_CATEGORIES, type DB } from "@/lib/db";
import { listBackups, createBackup, backupUrl, fetchBackup, type BackupEntry } from "@/lib/backup";
import { duplicateOrderNumbers, renumberOrder } from "@/lib/orderNumbers";
import { duplicateUsers, countReferences, mergeUsers } from "@/lib/mergeUsers";
import { unappliedIncome, invoiceBalance, applyIncomeToClient } from "@/lib/clientPayments";
import { legacyPayments, backfillReceipts } from "@/lib/receipts";
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
  Hash,
  Receipt,
  Banknote,
  ReceiptText,
  Trash2,
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

  // Persist ONLY the settings object. `db` here is a snapshot taken when this
  // page mounted, so writing the whole thing back (the old saveDb(db)) reverted
  // every other collection to that moment — silently deleting anything created
  // since (this is what wiped a saved locker and a live order). updateDb touches
  // the live cache in place and leaves all other data alone.
  const persistSettings = (msg: string) => {
    updateDb(d => { d.settings = { ...db.settings }; });
    toast.success(msg);
  };
  const save = () => persistSettings("Settings saved");
  const saveRates = () => persistSettings("Pricing rates updated");
  const saveInvoice = () => persistSettings("Invoice settings saved");
  const saveBand = () => persistSettings("Label & barcode settings saved");

  // Expense categories — instant add/remove (like toggling a locker/factory
  // active, not a staged "Save" form). Removing one is non-destructive: any
  // Expense already using that category keeps its string untouched, it just
  // stops appearing in the picker for new expenses.
  const [newCategory, setNewCategory] = useState("");
  const expenseCategories = db.settings.expenseCategories?.length ? db.settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
  // Write just the category list into the live cache (never the whole snapshot).
  const setCategories = (list: string[]) => {
    updateDb(d => { d.settings.expenseCategories = list; });
    setDb(prev => ({ ...prev, settings: { ...prev.settings, expenseCategories: list } }));
  };
  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (expenseCategories.some(c => c.toLowerCase() === name.toLowerCase())) { toast.error("That category already exists"); return; }
    setCategories([...expenseCategories, name]);
    setNewCategory("");
  };
  const removeCategory = (name: string) => {
    setCategories(expenseCategories.filter(c => c !== name));
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

  // ── Automatic cloud backups (admin only) ──
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const isAdminUser = user?.role === "admin";
  useEffect(() => {
    if (active !== "data" || !isAdminUser) return;
    listBackups().then(setBackups).catch(() => setBackups([]));
  }, [active, isAdminUser]);

  const backupNow = async () => {
    setBackingUp(true);
    try {
      await createBackup();
      setBackups(await listBackups());
      toast.success("Backup saved to the cloud");
    } catch {
      toast.error("Backup failed — only an admin account can write backups.");
    } finally { setBackingUp(false); }
  };

  const downloadBackup = async (b: BackupEntry) => {
    try { window.open(await backupUrl(b.path), "_blank"); }
    catch { toast.error("Couldn't open that backup"); }
  };

  const restoreFromCloud = async (b: BackupEntry) => {
    try {
      const d = (await fetchBackup(b.path)) as unknown as DB;
      if (!d || !Array.isArray(d.orders) || !Array.isArray(d.clients)) { toast.error("That backup looks invalid."); return; }
      if (!confirm(
        `Restore the backup from ${b.date}?\n\nThis REPLACES all current data with that snapshot ` +
        `(${d.clients.length} clients, ${d.orders.length} orders). Anything created since then will be lost. This cannot be undone.`,
      )) return;
      const fresh = loadDb();
      Object.assign(fresh, d, { session: fresh.session });
      saveDb(fresh);
      setDb(fresh);
      toast.success(`Restored from ${b.date}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    }
  };

  // ── Duplicate order numbers (legacy data repaired here) ──
  const [dupScan, setDupScan] = useState(0); // bump to re-scan after a fix
  const [fixingOrderId, setFixingOrderId] = useState<string | null>(null);
  const [mergingEmail, setMergingEmail] = useState<string | null>(null);
  const mergeAccounts = (email: string, keepId: string, dropIds: string[]) => {
    const refs = countReferences(loadDb(), dropIds);
    if (!confirm(
      `Merge ${dropIds.length + 1} accounts for ${email} into one?

` +
      `${refs} record${refs === 1 ? "" : "s"} attributed to the extra account${dropIds.length === 1 ? "" : "s"} will be moved onto the one you keep, then the extras are removed. Nothing is lost.`
    )) return;
    setMergingEmail(email);
    try {
      mergeUsers(keepId, dropIds);
      setDupScan(n => n + 1);
      toast.success("Duplicate accounts merged into one");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't merge those accounts.");
    } finally { setMergingEmail(null); }
  };
  const liveDb = loadDb();
  const duplicateGroups = useMemo(() => duplicateOrderNumbers(liveDb.orders), [liveDb.orders, dupScan]);

  // ── Invoices raised by mistake ────────────────────────────────────────────
  // A bill should only exist for a DISPATCHED order. One was once raised for an
  // order that was neither approved nor dispatched, so admins need a way to take
  // it back. Deleting an invoice only removes the bill document — the order, its
  // payments and every ledger figure live on the order itself and are untouched.
  const [invQuery, setInvQuery] = useState("");
  const invoiceRows = useMemo(() => {
    const rows = (liveDb.invoices || []).map(inv => {
      const ids = inv.orderIds?.length ? inv.orderIds : [inv.orderId];
      const orders = ids.map(id => liveDb.orders.find(o => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
      const dispatched = orders.length > 0 && orders.every(o =>
        o.status === "Dispatched" || o.status === "Delivered" ||
        o.timeline.some(t => t.step === "Dispatch" && t.status === "done"));
      const client = liveDb.clients.find(c => c.id === inv.clientId);
      const paid = orders.reduce((s, o) => s + balanceDue(o), 0) <= 0 && orders.length > 0;
      return { inv, orders, dispatched, client, paid };
    });
    const q = invQuery.trim().toLowerCase();
    const match = q
      ? rows.filter(r => r.inv.number.toLowerCase().includes(q)
          || (r.client?.companyName ?? "").toLowerCase().includes(q)
          || r.orders.some(o => o.orderNumber.toLowerCase().includes(q)))
      : rows.filter(r => !r.dispatched);
    return match.sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt));
  }, [liveDb.invoices, liveDb.orders, liveDb.clients, invQuery]);
  const undispatchedCount = useMemo(
    () => (liveDb.invoices || []).filter(inv => {
      const ids = inv.orderIds?.length ? inv.orderIds : [inv.orderId];
      const orders = ids.map(id => liveDb.orders.find(o => o.id === id)).filter(Boolean);
      return !(orders.length > 0 && orders.every(o => o!.status === "Dispatched" || o!.status === "Delivered"
        || o!.timeline.some(t => t.step === "Dispatch" && t.status === "done")));
    }).length,
    [liveDb.invoices, liveDb.orders],
  );

  function deleteInvoice(id: string, number: string) {
    if (!confirm(`Delete invoice ${number}? Only the bill is removed — the order, its payments, the client ledger and every report stay exactly as they are. The order can be invoiced again once it is dispatched.`)) return;
    updateDb(d => { d.invoices = (d.invoices || []).filter(i => i.id !== id); });
    toast.success(`Invoice ${number} deleted`);
  }

  // ── Invoice numbers: close a gap left by a cancelled invoice ───────────────
  // Deleting an invoice leaves a hole (0001, 0003) and the atomic counter never
  // hands a number back, so the book reads wrong for good unless it is renumbered.
  const invoiceGaps = useMemo(() => {
    const nums = (liveDb.invoices ?? [])
      .map(i => parseInt(i.number, 10))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let want = 1, k2 = 0; k2 < nums.length; k2++, want++) {
      while (want < nums[k2]) { gaps.push(want); want++; }
    }
    return gaps;
  }, [liveDb.invoices]);

  function renumberInvoices() {
    const list = [...(liveDb.invoices ?? [])].sort(
      (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || a.number.localeCompare(b.number));
    if (!list.length) return;
    if (!confirm(
      `Renumber ${list.length} invoice${list.length !== 1 ? "s" : ""} in date order, starting at 0001?

`
      + "Only the numbers change — every amount, order link and payment stays exactly as it is. "
      + "Do this only if an invoice has been cancelled and the sequence has a hole in it; anything already "
      + "sent to a client will no longer match the copy they hold."
    )) return;
    updateDb(d => {
      const byId = new Map(list.map((inv, i) => [inv.id, String(i + 1).padStart(4, "0")]));
      for (const inv of d.invoices ?? []) {
        const n = byId.get(inv.id);
        if (n) inv.number = n;
      }
    });
    toast.success(`Renumbered ${list.length} invoice${list.length !== 1 ? "s" : ""}`);
  }


  // ── Client money that never reached their orders ───────────────────────────
  // A payment typed into the Locker as a plain entry sits there as cash while
  // the client's invoice still reads unpaid. These are every such row, so the
  // ones recorded before the Locker learnt about client payments can be put
  // right rather than being re-keyed and double-counted.
  const [fixTxnId, setFixTxnId] = useState<string | null>(null);
  const [fixClientId, setFixClientId] = useState("");
  const [fixInvoiceId, setFixInvoiceId] = useState("");
  const [fixRate, setFixRate] = useState("");
  const looseIncome = useMemo(() => unappliedIncome(liveDb), [liveDb]);
  const fixTxn = looseIncome.find(t => t.id === fixTxnId) ?? null;
  const fixInvoices = useMemo(
    () => (fixClientId
      ? (liveDb.invoices ?? [])
          .filter(i => i.clientId === fixClientId)
          .map(i => ({ inv: i, bal: invoiceBalance(liveDb, i.id) }))
          .sort((a, b) => +new Date(b.inv.createdAt) - +new Date(a.inv.createdAt))
      : []),
    [liveDb, fixClientId],
  );

  function applyLooseIncome() {
    if (!fixTxn) return;
    const client = liveDb.clients.find(c => c.id === fixClientId);
    if (!client) { toast.error("Choose the client this money came from"); return; }
    const res = applyIncomeToClient({
      txnId: fixTxn.id, clientId: client.id,
      invoiceId: fixInvoiceId || undefined,
      exchangeRate: Number(fixRate) || undefined,
      userId: user!.id,
    });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`${fmtMoney(res.settled)} applied to ${client.companyName}'s bills`);
    setFixTxnId(null); setFixClientId(""); setFixInvoiceId(""); setFixRate("");
  }

  // ── Receipt numbers for payments taken before the receipt book existed ─────
  const [numbering, setNumbering] = useState(false);
  const unnumberedPayments = useMemo(() => legacyPayments(liveDb), [liveDb]);

  async function numberPastPayments() {
    const n = unnumberedPayments.length;
    if (!n) return;
    if (!confirm(
      `Give receipt numbers to ${n} past payment${n !== 1 ? "s" : ""}, oldest first?

`
      + "This only labels them. Not one amount, date or balance changes — each payment keeps exactly the money "
      + "it already put on the orders, and an existing deposit is linked rather than recorded again. "
      + "Afterwards they can be corrected or cancelled like any new receipt."
    )) return;
    setNumbering(true);
    try {
      const done = await backfillReceipts(user!.id);
      toast.success(`${done} payment${done !== 1 ? "s" : ""} numbered`);
    } catch {
      toast.error("Couldn't finish numbering — nothing was lost, try again.");
    } finally { setNumbering(false); }
  }


  const duplicateAccounts = useMemo(() => duplicateUsers(liveDb.users), [liveDb.users, dupScan]);
  const fixOrderNumber = async (orderId: string, oldNumber: string, invoiced: boolean) => {
    if (invoiced && !confirm(
      `This order already has an invoice under ${oldNumber}.

` +
      "Giving it a new number means the invoice you already sent shows the old one — you will need to re-send the corrected invoice. Continue?"
    )) return;
    setFixingOrderId(orderId);
    try {
      const fresh = await renumberOrder(loadDb(), orderId);
      setDupScan(n => n + 1);
      toast.success(`Renumbered ${oldNumber} → ${fresh}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't renumber that order.");
    } finally { setFixingOrderId(null); }
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

  // The "generate invoice numbers for every order missing one" button used to
  // live here. It billed work that had never shipped — that is where invoice
  // 0002 for an undispatched order came from — and numbered by invoices.length,
  // which repeats a number the moment one is deleted. Invoices are raised only
  // from Invoices → Create invoice from dispatched orders, which is now the one
  // path createInvoiceFromOrders() allows.

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
        {/* ── Duplicate staff accounts (same person added twice) ── */}
        {isAdminUser && duplicateAccounts.length > 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-destructive/10 text-destructive">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Duplicate Accounts</h3>
                <p className="text-[11px] text-muted-foreground">
                  The same e-mail appears on more than one account. Merge them so history stays under one person.
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {duplicateAccounts.map(g => {
                const keep = g.users[0];
                const drops = g.users.slice(1);
                return (
                  <div key={g.email} className="rounded-lg bg-white border border-border/60 p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{keep.name} · {g.email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.users.length} accounts — keeping the oldest ({new Date(keep.createdAt).toLocaleDateString()}), removing {drops.length}
                        </p>
                      </div>
                      <AsyncButton
                        size="sm"
                        variant="outline"
                        disabled={mergingEmail === g.email}
                        onClick={() => mergeAccounts(g.email, keep.id, drops.map(u => u.id))}
                        className="rounded-lg h-8 shrink-0"
                      >
                        {mergingEmail === g.email ? "Merging…" : "Merge into one"}
                      </AsyncButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Duplicate order numbers (repairs legacy data) ── */}
        {isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${duplicateGroups.length ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <Hash className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Order Numbers</h3>
                <p className="text-[11px] text-muted-foreground">
                  {duplicateGroups.length === 0
                    ? "No duplicates — every order number is unique."
                    : `${duplicateGroups.length} number${duplicateGroups.length !== 1 ? "s are" : " is"} used by more than one order.`}
                </p>
              </div>
            </div>

            {duplicateGroups.length > 0 && (
              <div className="mt-3 space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  The oldest order keeps the number; give the later one a fresh number. Nothing else changes —
                  invoices, purchases and payments link to the order itself, not to the number.
                </p>
                {duplicateGroups.map(g => (
                  <div key={g.number} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-xs font-semibold text-destructive mb-2">{g.number} — used by {g.orders.length} orders</p>
                    <div className="space-y-1.5">
                      {g.orders.map((o, i) => {
                        const client = liveDb.clients.find(c => c.id === o.clientId);
                        const invoiced = orderInvoiced(liveDb.invoices, o.id);
                        return (
                          <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-border/60 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{client?.companyName || "Ready Stock"} · {o.jewelleryType}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(o.createdAt).toLocaleDateString()} · {o.status}
                                {invoiced ? " · already invoiced" : ""}
                              </p>
                            </div>
                            {i === 0 ? (
                              <span className="text-[11px] font-medium text-muted-foreground shrink-0">keeps this number</span>
                            ) : (
                              <AsyncButton
                                size="sm"
                                variant="outline"
                                disabled={fixingOrderId === o.id}
                                onClick={() => fixOrderNumber(o.id, o.orderNumber, invoiced)}
                                className="rounded-lg h-8 shrink-0"
                              >
                                {fixingOrderId === o.id ? "Fixing…" : "Give new number"}
                              </AsyncButton>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Receipt numbers for past payments (admin only) ── */}
        {isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${unnumberedPayments.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <ReceiptText className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Receipt Numbers</h3>
                <p className="text-[11px] text-muted-foreground">
                  {unnumberedPayments.length === 0
                    ? "Every payment received has a receipt number."
                    : `${unnumberedPayments.length} payment${unnumberedPayments.length !== 1 ? "s were" : " was"} taken before receipts were numbered.`}
                </p>
              </div>
            </div>

            {unnumberedPayments.length > 0 && (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Payments recorded earlier exist only as entries on the orders they settled, so they can&rsquo;t be
                  looked up or corrected as one thing. Numbering them is pure labelling —
                  <span className="font-medium text-foreground"> not one amount, date or balance changes</span>.
                  Each payment keeps exactly the money it already put on the orders, an existing deposit is linked
                  rather than recorded again, and afterwards they can be corrected or cancelled like any new receipt.
                </p>
                <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                  {unnumberedPayments.slice(0, 8).map((g, i) => {
                    const client = liveDb.clients.find(c => c.id === g.clientId);
                    return (
                      <p key={i} className="text-[11px] text-muted-foreground">
                        {new Date(g.at).toLocaleDateString()} · {client?.companyName ?? "Client"} · {fmtMoney(g.amount)}
                        {g.orders.length > 1 ? ` · across ${g.orders.length} orders` : ""}
                      </p>
                    );
                  })}
                  {unnumberedPayments.length > 8 && (
                    <p className="text-[11px] text-muted-foreground">…and {unnumberedPayments.length - 8} more.</p>
                  )}
                </div>
                <AsyncButton
                  size="sm" variant="outline" disabled={numbering}
                  onClick={numberPastPayments}
                  className="rounded-xl h-9 mt-3"
                >
                  {numbering ? "Numbering…" : `Number ${unnumberedPayments.length} past payment${unnumberedPayments.length !== 1 ? "s" : ""}`}
                </AsyncButton>
              </>
            )}
          </div>
        )}


        {/* ── Client payments that never reached their orders (admin only) ── */}
        {isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${looseIncome.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <Banknote className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Unapplied Money In</h3>
                <p className="text-[11px] text-muted-foreground">
                  {looseIncome.length === 0
                    ? "Every deposit is accounted for."
                    : `${looseIncome.length} deposit${looseIncome.length !== 1 ? "s are" : " is"} sitting in a locker without being applied to anyone.`}
                </p>
              </div>
            </div>

            {looseIncome.length > 0 && (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Money typed into a locker as a plain entry is counted as cash but never settles a bill,
                  so the client&rsquo;s invoice keeps reading as pending. Applying one runs only the missing
                  allocation — the locker amount and its balance do not change, and nothing is counted twice.
                  Leave anything that genuinely is not a client payment (capital, interest, a refund) alone.
                </p>
                <div className="mt-3 space-y-1.5">
                  {looseIncome.slice(0, 30).map(t => {
                    const locker = liveDb.lockers.find(l => l.id === t.lockerId);
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {(t.currency ?? "INR") === "USD" ? "$" : "₹"}{Math.round(t.amountInr).toLocaleString("en-IN")} · {t.category || t.note || "Money in"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {locker?.name ?? "Locker"} · {new Date(t.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setFixTxnId(t.id); setFixClientId(""); setFixInvoiceId(""); setFixRate(""); }}
                          className="rounded-lg h-8 shrink-0"
                        >
                          Apply to a client
                        </Button>
                      </div>
                    );
                  })}
                  {looseIncome.length > 30 && (
                    <p className="text-[11px] text-muted-foreground">Showing the 30 newest.</p>
                  )}
                </div>
              </>
            )}

            {fixTxn && (
              <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-brand-dark">
                  Apply {(fixTxn.currency ?? "INR") === "USD" ? "$" : "₹"}{Math.round(fixTxn.amountInr).toLocaleString("en-IN")} from {new Date(fixTxn.createdAt).toLocaleDateString()}
                </p>
                <div>
                  <Label className="text-xs">Received from</Label>
                  <Select value={fixClientId} onValueChange={v => { setFixClientId(v); setFixInvoiceId(""); }}>
                    <SelectTrigger className="h-10 rounded-xl mt-1 bg-white"><SelectValue placeholder="Choose the client" /></SelectTrigger>
                    <SelectContent>
                      {[...liveDb.clients].sort((a, b) => a.companyName.localeCompare(b.companyName))
                        .map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {fixClientId && (
                  <div>
                    <Label className="text-xs">Against</Label>
                    <Select value={fixInvoiceId || "fifo"} onValueChange={v => setFixInvoiceId(v === "fifo" ? "" : v)}>
                      <SelectTrigger className="h-10 rounded-xl mt-1 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fifo">Oldest bills first</SelectItem>
                        {fixInvoices.map(({ inv, bal }) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            Invoice {inv.number} — {bal > 0 ? `${fmtMoney(bal)} pending` : "settled"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(fixTxn.currency ?? "INR") !== "USD" && (
                  <div>
                    <Label className="text-xs">Exchange rate — 1 USD = ₹ <span className="text-destructive">*</span></Label>
                    <Input type="number" min={0} step="0.01" value={fixRate} onChange={e => setFixRate(e.target.value)} className="rounded-xl h-10 mt-1 bg-white" placeholder="e.g. 83.50" />
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" onClick={() => setFixTxnId(null)} className="rounded-xl flex-1 h-9">Cancel</Button>
                  <Button onClick={applyLooseIncome} disabled={!fixClientId} className="btn-hero rounded-xl flex-1 h-9">Apply</Button>
                </div>
              </div>
            )}
          </div>
        )}


        {/* ── Invoice numbering (admin only) ── */}
        {isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${invoiceGaps.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <Hash className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Invoice Numbers</h3>
                <p className="text-[11px] text-muted-foreground">
                  {invoiceGaps.length === 0
                    ? "The sequence runs straight through with no gaps."
                    : `Missing: ${invoiceGaps.map(n => String(n).padStart(4, "0")).join(", ")} — an invoice was cancelled.`}
                </p>
              </div>
            </div>
            {invoiceGaps.length > 0 && (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Renumbering puts every invoice back in date order starting at 0001. Only the numbers change —
                  amounts, order links and payments stay exactly as they are. Do not do this if a client already
                  holds a copy of an invoice, because their number will no longer match yours.
                </p>
                <Button size="sm" variant="outline" onClick={renumberInvoices} className="rounded-xl h-9 mt-3">
                  Renumber invoices in date order
                </Button>
              </>
            )}
          </div>
        )}


        {/* ── Invoices raised by mistake (admin only) ── */}
        {isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${undispatchedCount ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Delete an Invoice</h3>
                <p className="text-[11px] text-muted-foreground">
                  {undispatchedCount === 0
                    ? "Every invoice belongs to a dispatched order."
                    : `${undispatchedCount} invoice${undispatchedCount !== 1 ? "s were" : " was"} raised for an order that isn't dispatched.`}
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Deleting removes only the bill document. The order, its advances, the client
              ledger and every report read from the order itself, so no figure changes — the
              order simply becomes billable again once it is dispatched. Undispatched invoices
              are listed below; search to find any other one.
            </p>
            <Input
              value={invQuery}
              onChange={e => setInvQuery(e.target.value)}
              placeholder="Search invoice #, client or order #…"
              className="rounded-xl h-9 mt-3"
            />

            <div className="mt-3 space-y-1.5">
              {invoiceRows.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  {invQuery.trim() ? "No invoice matches that search." : "Nothing to clean up."}
                </p>
              ) : invoiceRows.slice(0, 40).map(r => (
                <div
                  key={r.inv.id}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${r.dispatched ? "border-border/60 bg-white" : "border-destructive/30 bg-destructive/5"}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      Invoice {r.inv.number} · {r.client?.companyName || "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {r.orders.map(o => o.orderNumber).join(", ") || "order missing"} ·{" "}
                      {new Date(r.inv.createdAt).toLocaleDateString()} ·{" "}
                      {r.dispatched ? "dispatched" : "NOT dispatched"}
                      {r.paid ? " · fully paid" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteInvoice(r.inv.id, r.inv.number)}
                    className="rounded-lg h-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                  </Button>
                </div>
              ))}
              {invoiceRows.length > 40 && (
                <p className="text-[11px] text-muted-foreground">Showing the 40 newest — search to narrow it down.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Automatic daily cloud backups (admin only) ── */}
        {isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-success/10 text-success grid place-items-center shrink-0"><Database className="h-4 w-4" /></div>
                <div>
                  <h3 className="font-semibold text-brand-dark text-sm">Automatic Backups</h3>
                  <p className="text-[11px] text-muted-foreground">A full snapshot is saved to the cloud once a day — last 14 kept.</p>
                </div>
              </div>
              <AsyncButton variant="outline" onClick={backupNow} disabled={backingUp} className="rounded-lg gap-1.5 shrink-0">
                <Database className="h-3.5 w-3.5" /> {backingUp ? "Backing up…" : "Back up now"}
              </AsyncButton>
            </div>

            <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
              {backups.map(b => (
                <div key={b.path} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                  <p className="text-sm font-medium text-foreground tabular-nums">{b.date}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => downloadBackup(b)} className="rounded-lg h-8 gap-1.5">
                      <Upload className="h-3.5 w-3.5 rotate-180" /> Download
                    </Button>
                    <AsyncButton size="sm" variant="outline" onClick={() => restoreFromCloud(b)} className="rounded-lg h-8 text-destructive hover:bg-destructive/10 hover:text-destructive">
                      Restore
                    </AsyncButton>
                  </div>
                </div>
              ))}
              {backups.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">
                  No cloud backups yet — one is taken automatically the first time an admin opens the app each day, or press “Back up now”.
                </p>
              )}
            </div>
          </div>
        )}

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
