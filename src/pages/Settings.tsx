import { CurrencyRatesSettings } from "@/components/CurrencyRatesSettings";
import { InfoTip, SectionTitle } from "@/components/SectionTitle";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { materialUnit } from "@/lib/materials";
import { TableStyleSettings } from "@/components/TableStyleSettings";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { ServerTotalsCheck } from "@/components/ServerTotalsCheck";
import { DataSizePanel } from "@/components/DataSizePanel";
import { Table2, Palette } from "lucide-react";
import { MAIN_COMPANY_ID, companyIdOfInvoice } from "@/lib/companies";
import { CompaniesSettings } from "@/components/CompaniesSettings";
import { MaterialsSettings } from "@/components/MaterialsSettings";
import { OptionListsSettings } from "@/components/OptionListsSettings";
import { TimelineSettings } from "@/components/TimelineSettings";
import { ListOrdered } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadDb, saveDb, updateDb, updateDbAs, uid, orderTotal, balanceDue, fmtMoney, fmtDate, todayLocal, orderInvoiced, logEvent, collectionLoaded, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_LOCKER_CATEGORIES, type DB } from "@/lib/db";
import { listBackups, createBackup, backupUrl, fetchBackup, type BackupEntry } from "@/lib/backup";
import { IS_DEMO } from "@/lib/firebase";
import { seedDemoData, clearDemoData, hasDemoData } from "@/lib/demoSeed";
import { releaseInvoiceNumber, resetSequence } from "@/lib/counters";
import { useDbVersion } from "@/hooks/useDb";
import {
  fxTableOf, writeFxTable, adminStoreReady, exposedAdminFigures, copyAdminFiguresToPrivate,
  stripExposedAdminFigures, collectionRefused, flush,
} from "@/lib/db";
import { GoogleDriveBackup } from "@/components/GoogleDriveBackup";
import { duplicateOrderNumbers, renumberOrder } from "@/lib/orderNumbers";
import { duplicateUsers, countReferences, mergeUsers } from "@/lib/mergeUsers";
import { unappliedIncome, invoiceBalance, applyIncomeToClient, markedNotClientPayment, setNotClientPayment } from "@/lib/clientPayments";
import { legacyPayments, backfillReceipts } from "@/lib/receipts";
import { orphanSupplierPayments, repairSupplierPayments } from "@/lib/supplierRepair";
import { orphanDirectUses, orphanImpact, repairOrphanDirectUses } from "@/lib/stockRepair";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { ccy, ccySymbol, fmtCcy } from "@/lib/currency";
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
  Building2, Layers,
  Database,
  Lock,
  Boxes,
  SlidersHorizontal,
  ListChecks,
  Hash,
  Receipt,
  Banknote,
  ReceiptText,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";
import { confirmBox } from "@/lib/confirm";

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

// The three repair tools — Order Numbers, Receipt Numbers and Unapplied Money
// In — are hidden. They were built to clean up data from before those things
// were recorded properly, that work is done, and a page of permanently-empty
// repair cards is noise. Left in place rather than deleted: if a figure ever
// looks wrong again these are what diagnose it, and turning them back on is
// this one word.
const SHOW_REPAIR_TOOLS = false;

// Invoice Numbers, Delete an Invoice and Automatic Backups are hidden too.
// All three rewrite or remove something that is already settled — renumbering
// every bill, deleting one, or restoring the whole database over the top of
// today's work — and none of them is part of anybody's day. Same as above:
// switched off, not deleted, so one word brings them back when one is needed.
const SHOW_ADMIN_TOOLS = false;

// …except the invoice numbering tool, which is the one of the three that puts
// something right rather than throwing it away: it renumbers the book so the
// sequence runs straight through, keeping every amount, order link and payment
// exactly where it is. Deleting an invoice and restoring a backup stay hidden.
const SHOW_INVOICE_NUMBER_TOOL = true;

export function SettingsPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(loadDb());
  const [lp, setLp] = useState({ name: "", style: "tag" as "tag" | "label", w: "", h: "" });
  // A label preset being changed in place (staged until the section's Save).
  const [lpEdit, setLpEdit] = useState<{ id: string; name: string; style: "tag" | "label"; w: string; h: string } | null>(null);
  // A dated ₹-per-$ profit rate being corrected in place.
  const [fxEdit, setFxEdit] = useState<{ from: string; rate: string } | null>(null);
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
  //
  // And only the fields changed on this page. The form's copy of the settings
  // was taken when the page opened; writing all of it back reverted whatever
  // else had been saved since — the production timeline and companies (saved
  // by their own sections), categories, another admin's edits, even the
  // diamond stock-number counter. So the form is compared with what it
  // started from, and only what was actually changed here is written.
  const baseline = useRef(loadDb().settings);
  const persistSettings = (msg: string) => {
    const now = db.settings as unknown as Record<string, unknown>;
    const was = baseline.current as unknown as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    const removed: string[] = [];
    for (const k of new Set([...Object.keys(now), ...Object.keys(was)])) {
      if (JSON.stringify(now[k]) === JSON.stringify(was[k])) continue;
      if (now[k] === undefined) removed.push(k); else changed[k] = now[k];
    }
    updateDb(d => {
      const next = { ...(d.settings as unknown as Record<string, unknown>), ...changed };
      for (const k of removed) delete next[k];
      // Once the rates live in the admin-only record, this form's copy of the
      // old ones must not be written back into settings, where every signed-in
      // user can read them. The form may still hold them from before the move.
      if ((d.adminRecords ?? []).some(r => r.kind === "fx")) {
        delete next.fxRates;
        delete next.usdToInr;
      }
      d.settings = next as unknown as typeof d.settings;
    });
    baseline.current = { ...db.settings };
    toast.success(msg);
  };
  const save = () => persistSettings("Settings saved");
  // New dated exchange rate being typed in (admin, Pricing).
  const [fxFrom, setFxFrom] = useState(todayLocal());
  const [fxRate, setFxRate] = useState("");
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
  const removeCategory = async (name: string) => {
    const n = (loadDb().expenses ?? []).filter(e => e.category === name).length;
    if (!(await confirmBox(`Remove the expense category "${name}"?\n\nIt stops being offered for new expenses.${n ? ` The ${n} expense${n !== 1 ? "s" : ""} already filed under it keep it, exactly as they are.` : " No expense uses it."}`))) return;
    setCategories(expenseCategories.filter(c => c !== name));
  };

  // Account (Locker) categories — the same editor, for money in and out of an
  // account. These are compulsory on an entry, so the list has to be managed
  // somewhere rather than typed fresh each time.
  const [newLockerCategory, setNewLockerCategory] = useState("");
  const lockerCategories = db.settings.lockerCategories?.length
    ? db.settings.lockerCategories
    : DEFAULT_LOCKER_CATEGORIES;
  const setLockerCategories = (list: string[]) => {
    updateDb(d => { d.settings.lockerCategories = list; });
    setDb(prev => ({ ...prev, settings: { ...prev.settings, lockerCategories: list } }));
  };
  const addLockerCategory = () => {
    const name = newLockerCategory.trim();
    if (!name) return;
    if (lockerCategories.some(c => c.toLowerCase() === name.toLowerCase())) { toast.error("That category already exists"); return; }
    setLockerCategories([...lockerCategories, name]);
    setNewLockerCategory("");
  };
  const removeLockerCategory = async (name: string) => {
    const n = (loadDb().lockerTransactions ?? []).filter(t => t.category === name).length;
    if (!(await confirmBox(`Remove the account category "${name}"?\n\nIt stops being offered for new entries.${n ? ` The ${n} account entr${n !== 1 ? "ies" : "y"} already filed under it keep it, exactly as they are.` : " No entry uses it."}`))) return;
    setLockerCategories(lockerCategories.filter(c => c !== name));
  };

  // Renaming a category renames it everywhere: the list, and every record
  // filed under it — so a report never splits one category in two under its
  // old and new names. Names the app itself files records under can't change.
  const RESERVED: Record<"expense" | "account", Record<string, string>> = {
    expense: { Salary: "Built in — salaries are filed under this name", Shipping: "Built in — shipping costs are filed under this name" },
    account: { Transfer: "Built in — transfers between accounts are filed under this name" },
  };
  const [catEdit, setCatEdit] = useState<{ kind: "expense" | "account"; from: string; to: string } | null>(null);
  const renameCategory = async () => {
    if (!catEdit) return;
    const { kind, from } = catEdit;
    const to = catEdit.to.trim().replace(/\s+/g, " ");
    const list = kind === "expense" ? expenseCategories : lockerCategories;
    if (!to) { toast.error("Enter the new name"); return; }
    if (to === from) { setCatEdit(null); return; }
    if (list.some(c => c !== from && c.toLowerCase() === to.toLowerCase())) { toast.error(`"${to}" is already on the list`); return; }
    const col = kind === "expense" ? "expenses" : "lockerTransactions";
    if (!collectionLoaded(col)) { toast.error("Still loading the records filed under it — try again in a moment"); return; }
    const d0 = loadDb();
    const n = kind === "expense"
      ? (d0.expenses ?? []).filter(e => e.category === from).length
      : (d0.lockerTransactions ?? []).filter(t => t.category === from).length;
    const what = kind === "expense" ? `expense${n !== 1 ? "s" : ""}` : `account entr${n !== 1 ? "ies" : "y"}`;
    if (!(await confirmBox(`Rename "${from}" to "${to}"?\n\n${n ? `${n} ${what} filed under "${from}" change to "${to}" too, so reports keep them together.` : `No ${kind === "expense" ? "expense" : "entry"} is filed under it yet.`} New ${kind === "expense" ? "expenses" : "entries"} are offered "${to}".`, { confirmText: "Rename" }))) return;
    const next = list.map(c => (c === from ? to : c));
    updateDbAs({ summary: `Renamed the ${kind === "expense" ? "expense" : "account"} category "${from}" to "${to}" (${n} record${n !== 1 ? "s" : ""})` }, d => {
      if (kind === "expense") {
        d.settings.expenseCategories = next;
        for (const e of d.expenses ?? []) if (e.category === from) e.category = to;
      } else {
        d.settings.lockerCategories = next;
        for (const t of d.lockerTransactions ?? []) if (t.category === from) t.category = to;
      }
    });
    setDb(prev => ({ ...prev, settings: { ...prev.settings, ...(kind === "expense" ? { expenseCategories: next } : { lockerCategories: next }) } }));
    setCatEdit(null);
    toast.success(`Renamed to "${to}"${n ? ` — ${n} ${what} updated` : ""}`);
  };
  /** One category, as a chip: rename and remove — or the reason it can't be renamed. */
  const catChip = (kind: "expense" | "account", c: string, remove: (c: string) => unknown) => {
    const reserved = RESERVED[kind][c];
    if (catEdit && catEdit.kind === kind && catEdit.from === c) {
      return (
        <span key={c} className="inline-flex items-center gap-1 rounded-full bg-white ring-2 ring-primary/30 pl-1 pr-1 py-0.5">
          <Input value={catEdit.to} autoFocus onChange={e => setCatEdit({ ...catEdit, to: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") void renameCategory(); if (e.key === "Escape") setCatEdit(null); }}
            aria-label={`New name for ${c}`} className="h-7 w-40 rounded-full text-xs" />
          <button type="button" onClick={() => void renameCategory()} aria-label="Save the new name" className="h-6 w-6 rounded-full grid place-items-center text-success hover:bg-success/10"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setCatEdit(null)} aria-label="Keep the old name" className="h-6 w-6 rounded-full grid place-items-center text-muted-foreground hover:bg-secondary"><X className="h-3 w-3" /></button>
        </span>
      );
    }
    return (
      <span key={c} className="inline-flex items-center gap-1 text-xs font-medium pl-3 pr-1.5 py-1.5 rounded-full bg-secondary text-foreground">
        {c}
        <button type="button" onClick={() => (reserved ? toast.error(reserved) : setCatEdit({ kind, from: c, to: c }))} title={reserved ?? `Rename ${c}`}
          aria-label={`Rename ${c}`} aria-disabled={!!reserved}
          className={`h-4 w-4 rounded-full grid place-items-center text-muted-foreground transition-colors ${reserved ? "opacity-40 cursor-not-allowed" : "hover:text-primary hover:bg-primary/10"}`}>
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button type="button" onClick={() => void remove(c)} title={`Remove ${c}`} aria-label={`Remove ${c}`} className="h-4 w-4 rounded-full grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  };


  const exp = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ssdiam-backup.json";
    a.click();
    // A full copy of every record leaving the building — the one download most
    // worth knowing about.
    logEvent("export", "Downloaded a full backup of all data", { file: "ssdiam-backup.json" });
  };
  const imp = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result as string) as DB;
        if (!d || !Array.isArray(d.orders) || !Array.isArray(d.clients)) { toast.error("This doesn't look like a valid backup file."); e.target.value = ""; return; }
        const ok = (await confirmBox(
          `Restore from this backup? It REPLACES all current data with the file's contents ` +
          `(${d.clients.length} clients, ${d.orders.length} orders). This cannot be undone.`,
        ));
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
  // "Clear Data & Reset Seed" used to live here: one button that emptied every
  // collection and every catalog item, guarded only by typing RESET into a
  // browser prompt. On a live business that is not a setting, it is an accident
  // waiting to happen, so the button and the code behind it are both gone
  // rather than merely hidden. Restoring from a backup sits on this same page
  // and covers the only honest reason anyone had to reach for it.

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
      if (!(await confirmBox(
        `Restore the backup from ${b.date}?\n\nThis REPLACES all current data with that snapshot ` +
        `(${d.clients.length} clients, ${d.orders.length} orders). Anything created since then will be lost. This cannot be undone.`,
      ))) return;
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
  const mergeAccounts = async (email: string, keepId: string, dropIds: string[]) => {
    const refs = countReferences(loadDb(), dropIds);
    if (!(await confirmBox(
      `Merge ${dropIds.length + 1} accounts for ${email} into one?

` +
      `${refs} record${refs === 1 ? "" : "s"} attributed to the extra account${dropIds.length === 1 ? "" : "s"} will be moved onto the one you keep, then the extras are removed. Nothing is lost.`
    ))) return;
    setMergingEmail(email);
    try {
      mergeUsers(keepId, dropIds);
      setDupScan(n => n + 1);
      toast.success("Duplicate accounts merged into one");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't merge those accounts.");
    } finally { setMergingEmail(null); }
  };
  // Re-draw when the data moves, so things saved straight to the live record
  // — a new exchange rate, the result of the privacy move — show at once.
  useDbVersion();
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

  async function deleteInvoice(id: string, number: string) {
    if (!(await confirmBox(`Delete invoice ${number}? Only the bill is removed — the order, its payments, the client ledger and every report stay exactly as they are. The order can be invoiced again once it is dispatched.`))) return;
    const companyId = companyIdOfInvoice((liveDb.invoices ?? []).find(i => i.id === id));
    updateDb(d => { d.invoices = (d.invoices || []).filter(i => i.id !== id); });
    // If this was the newest number, hand it back so the next invoice takes it
    // instead of the book skipping one. Older numbers are left alone — their
    // hole can only be closed by renumbering. Each company has its own series.
    await releaseInvoiceNumber(number, companyId);
    toast.success(`Invoice ${number} deleted`);
  }

  // ── Invoice numbers: close a gap left by a cancelled invoice ───────────────
  // Deleting an invoice leaves a hole (0001, 0003) and the atomic counter never
  // hands a number back, so the book reads wrong for good unless it is renumbered.
  // Company 1's series only — every other company numbers its own invoices,
  // with its prefix, and is never pulled into this one.
  const mainInvoices = (liveDb.invoices ?? []).filter(i => companyIdOfInvoice(i) === MAIN_COMPANY_ID);
  const invoiceGaps = useMemo(() => {
    const nums = mainInvoices
      .map(i => parseInt(i.number, 10))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let want = 1, k2 = 0; k2 < nums.length; k2++, want++) {
      while (want < nums[k2]) { gaps.push(want); want++; }
    }
    return gaps;
  }, [liveDb.invoices]);

  async function renumberInvoices() {
    const list = [...mainInvoices].sort(
      (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || a.number.localeCompare(b.number));
    if (!list.length) return;
    // Show exactly which number becomes which before anything is written — the
    // point of the whole exercise is that the book reads differently afterwards.
    const moves = list
      .map((inv, i) => ({ from: inv.number, to: String(i + 1).padStart(4, "0") }))
      .filter(m => m.from !== m.to);
    if (!moves.length) {
      toast.success("The sequence already runs straight through — nothing to renumber");
      return;
    }
    const preview = moves.slice(0, 12).map(m => `  ${m.from}  →  ${m.to}`).join("\n")
      + (moves.length > 12 ? `\n  …and ${moves.length - 12} more` : "");
    if (!(await confirmBox(
      `Renumber ${list.length} invoice${list.length !== 1 ? "s" : ""} in date order, starting at 0001?\n\n`
      + `${moves.length} will change:\n${preview}\n\n`
      + "Every amount, order link and payment stays exactly as it is — only the numbers move. "
      + "Each invoice keeps its old number on record, so a client holding the old copy can still be found by "
      + "searching for it."
    ))) return;
    updateDb(d => {
      const byId = new Map(list.map((inv, i) => [inv.id, String(i + 1).padStart(4, "0")]));
      for (const inv of d.invoices ?? []) {
        const n = byId.get(inv.id);
        if (!n || n === inv.number) continue;
        // Keep the first number it ever carried, not the one from the last
        // renumber — that is the one on the paperwork a client holds.
        if (!inv.previousNumber) inv.previousNumber = inv.number;
        inv.number = n;
      }
    });
    // The book now runs 1..N, so the counter has to follow it. Left where it
    // was, the next invoice would carry on from the old high number and open a
    // fresh hole the moment the renumber finished.
    void resetSequence("invoiceNumber", list.length + 1);
    toast.success(`Renumbered ${list.length} invoice${list.length !== 1 ? "s" : ""} — next is ${String(list.length + 1).padStart(4, "0")}`);
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
  const notClientRows = useMemo(() => markedNotClientPayment(liveDb), [liveDb]);
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

  async function applyLooseIncome() {
    if (!fixTxn) return;
    const client = liveDb.clients.find(c => c.id === fixClientId);
    if (!client) { toast.error("Choose the client this money came from"); return; }
    const res = await applyIncomeToClient({
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
    if (!(await confirmBox(
      `Give receipt numbers to ${n} past payment${n !== 1 ? "s" : ""}, oldest first?

`
      + "This only labels them. Not one amount, date or balance changes — each payment keeps exactly the money "
      + "it already put on the orders, and an existing deposit is linked rather than recorded again. "
      + "Afterwards they can be corrected or cancelled like any new receipt."
    ))) return;
    setNumbering(true);
    try {
      const done = await backfillReceipts(user!.id);
      toast.success(`${done} payment${done !== 1 ? "s" : ""} numbered`);
    } catch {
      toast.error("Couldn't finish numbering — nothing was lost, try again.");
    } finally { setNumbering(false); }
  }


  // ── Supplier payments that never reached the supplier's books ───────────
  const [fixingSupplier, setFixingSupplier] = useState(false);
  const lostSupplierPayments = useMemo(() => orphanSupplierPayments(liveDb), [liveDb]);
  const lostSupplierTotal = lostSupplierPayments.reduce((s, o) => s + o.amountInr, 0);

  async function restoreSupplierPayments() {
    const n = lostSupplierPayments.length;
    if (!n) return;
    if (!(await confirmBox(
      `Put ${n} payment${n !== 1 ? "s" : ""} back on the supplier books?

`
      + "These left an account but were never recorded against the supplier, so the supplier reads ₹0 and "
      + "\"Settled\". Each one is added back as an advance on its original date, from the same account, for the "
      + "same amount. No money moves — it already left; this only records where it went."
    ))) return;
    setFixingSupplier(true);
    try {
      const done = repairSupplierPayments(user!.id);
      toast.success(`${done} payment${done !== 1 ? "s" : ""} restored to the supplier books`);
    } catch {
      toast.error("Couldn't finish — nothing was lost, try again.");
    } finally { setFixingSupplier(false); }
  }

  // ── Stock gone negative from a half-removed purchase ──────────────────
  const [fixingStock, setFixingStock] = useState(false);
  const widowedUses = useMemo(() => orphanDirectUses(liveDb), [liveDb]);
  const widowedImpact = useMemo(() => orphanImpact(widowedUses), [widowedUses]);

  async function repairStock() {
    const n = widowedUses.length;
    if (!n) return;
    if (!(await confirmBox([
      `Clear ${n} stock movement${n !== 1 ? "s" : ""} with nothing behind them?`,
      "",
      "These record material leaving a pool it was never added to, because the purchase",
      "they belonged to was removed and only half the pair went with it. Clearing them",
      "puts the balance back.",
      "",
      "Nothing else changes — no purchase, issue, order or payment is touched.",
    ].join("\n")))) return;
    setFixingStock(true);
    try {
      const done = repairOrphanDirectUses();
      toast.success(`${done} movement${done !== 1 ? "s" : ""} cleared — stock balances restored`);
    } catch {
      toast.error("Couldn't finish — nothing was lost, try again.");
    } finally { setFixingStock(false); }
  }

  const duplicateAccounts = useMemo(() => duplicateUsers(liveDb.users), [liveDb.users, dupScan]);
  const fixOrderNumber = async (orderId: string, oldNumber: string, invoiced: boolean) => {
    if (invoiced && !(await confirmBox(
      `This order already has an invoice under ${oldNumber}.

` +
      "Giving it a new number means the invoice you already sent shows the old one — you will need to re-send the corrected invoice. Continue?"
    ))) return;
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
    { id: "expenses", label: "Categories", icon: SlidersHorizontal, show: isAdmin },
    { id: "lists", label: "Dropdown lists", icon: ListChecks, show: isAdmin },
    { id: "timeline", label: "Production Timeline", icon: ListOrdered, show: isAdmin },
    { id: "companies", label: "Companies", icon: Building2, show: isAdmin },
    { id: "materials", label: "Materials", icon: Layers, show: isAdmin },
    { id: "appearance", label: "Appearance", icon: Palette, show: isAdmin },
    { id: "tables", label: "Table Style", icon: Table2, show: isAdmin },
    { id: "logins", label: "Secure Logins", icon: ShieldCheck, show: isAdmin && pendingLogins.length > 0 },
    { id: "data", label: "Data & Backup", icon: Database, show: true },
  ].filter((s) => s.show);
  const activeId = sections.some((s) => s.id === active) ? active : sections[0]?.id;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />

      <div className="grid lg:grid-cols-[230px_1fr] gap-5 items-start">
        {/* Section nav — the shared tab bar on a phone or tablet, a rail on a laptop. */}
        <TabBar className="lg:hidden min-w-0" label="Settings" value={activeId ?? ""} onChange={setActive}
          tabs={sections.map(s => ({ key: s.id, label: s.label, icon: s.icon }))} />
        <nav className="max-lg:hidden lg:sticky lg:top-4 flex flex-col gap-1">
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

      {/* ── Sample data — demo build only ── */}
      {activeId === "company" && IS_DEMO && isAdmin && (
      <div className="card-luxe p-6 space-y-3 border-amber-500/40">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-amber-600" />
          <div>
            <h3 className="font-semibold">Demo sample data</h3>
            <p className="text-xs text-muted-foreground">
              Clients, orders at every stage, ready stock and certified stones — so the
              app can be shown doing its job instead of sitting empty.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Everything it adds is dated from today and marked internally, so loading it again
          replaces the sample and leaves anything entered during the demo untouched.
          Removing it does the same in reverse.
        </p>
        <div className="flex flex-wrap gap-2">
          <AsyncButton
            onClick={async () => {
              seedDemoData();
              toast.success("Sample data loaded — open Orders to see it");
            }}
            className="btn-hero rounded-xl"
          >
            {hasDemoData() ? "Reload sample data" : "Load sample data"}
          </AsyncButton>
          {hasDemoData() && (
            <Button
              variant="outline"
              onClick={() => {
                if (!confirm("Remove the sample data? Anything entered during the demo is kept.")) return;
                clearDemoData();
                toast.success("Sample data removed");
              }}
              className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Remove sample data
            </Button>
          )}
        </div>
      </div>
      )}

      {/* Company */}
      {activeId === "company" && (
      <div className="card-luxe p-6 space-y-4">
        <SectionTitle title="Company" />
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
        <AsyncButton onClick={save} className="btn-hero rounded-xl h-10 px-5 flex w-fit ml-auto">
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
            <p className="text-xs text-muted-foreground mt-0.5">On every printed bill</p>
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
                placeholder="online@ssdiam.in"
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

        <AsyncButton onClick={saveInvoice} className="btn-hero rounded-xl h-10 px-5 flex w-fit ml-auto">
          Save Invoice Settings
        </AsyncButton>
      </div>
      )}

      {/* Pricing Rates — admin & employee only */}
      {activeId === "pricing" && (
        <div className="card-luxe p-6 space-y-5">
          <div>
            <h3 className="font-semibold flex items-center gap-1.5">Order Value Pricing Rates<InfoTip text="Estimates a new order's value. Staff can change it per order." /></h3>
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

            {/* ₹ to $ over time — admin only: it is what turns an order's rupee cost
                into a profit, and profit is not for anyone else's screen. */}
            {isAdmin && (
              <div className="space-y-2 col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <Label className="text-xs flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-amber-600" />
                  Exchange Rates for Profit (₹ per $1) — admin only
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  A sale converts at the rate on its dispatch day.
                </p>
                {(() => {
                  const table = fxTableOf(liveDb);
                  const rates = [...table.rates].sort((a, b) => b.from.localeCompare(a.from));
                  // Saved straight away, to the admin-only record when its rules are
                  // live and to settings until then. When it lands in settings the
                  // form's copy follows, or the next "Save Pricing Rates" — which
                  // writes the whole form back — would put the old list back.
                  const commit = (next: { from: string; rate: number }[]) => {
                    let where: "private" | "settings" = "settings";
                    updateDb(d => { where = writeFxTable(d, next, fxTableOf(d).flat); });
                    if (where === "settings") setDb(prev => ({ ...prev, settings: { ...prev.settings, fxRates: next } }));
                  };
                  return (
                    <>
                      {rates.length > 0 ? (
                        <div className="rounded-lg border border-border/60 bg-white divide-y divide-border/50">
                          {rates.map((r, i) => (
                            <div key={r.from} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                              <span>
                                From <span className="font-medium">{fmtDate(r.from)}</span>
                                {i === 0 && <span className="ml-1.5 text-[10px] font-semibold text-success">current</span>}
                              </span>
                              <span className="flex items-center gap-3">
                                {fxEdit?.from === r.from ? (
                                  <>
                                    <Input type="number" min={0} step={0.01} value={fxEdit.rate} autoFocus aria-label={`Rate from ${r.from}`}
                                      onChange={e => setFxEdit({ ...fxEdit, rate: e.target.value })}
                                      onKeyDown={e => { if (e.key === "Escape") setFxEdit(null); }}
                                      className="h-7 w-24 rounded-lg text-xs" />
                                    <button
                                      onClick={async () => {
                                        const rate = Number(fxEdit.rate);
                                        if (!(rate > 0)) { toast.error("Enter the rate"); return; }
                                        if (rate === r.rate) { setFxEdit(null); return; }
                                        if (!(await confirmBox(`Change the rate from ${fmtDate(r.from)} to ₹${rate}?\n\nIt was ₹${r.rate}. Profit on every sale dispatched from that day until the next rate is worked out again at ₹${rate}.`, { confirmText: "Change" }))) return;
                                        commit(table.rates.map(x => (x.from === r.from ? { ...x, rate } : x)));
                                        setFxEdit(null);
                                        toast.success(`₹${rate} from ${fmtDate(r.from)} saved`);
                                      }}
                                      className="text-success" aria-label="Save the rate"><Check className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => setFxEdit(null)} className="text-muted-foreground" aria-label="Keep the rate"><X className="h-3.5 w-3.5" /></button>
                                  </>
                                ) : (
                                  <>
                                <span className="font-semibold tabular-nums">₹{r.rate}</span>
                                <button onClick={() => setFxEdit({ from: r.from, rate: String(r.rate) })} className="text-muted-foreground hover:text-primary" aria-label="Edit rate" title="Edit rate">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!(await confirmBox(`Remove the rate of ₹${r.rate} from ${fmtDate(r.from)}? Sales in that period will be converted at the rate before it.`))) return;
                                    commit(table.rates.filter(x => x.from !== r.from));
                                    toast.success("Rate removed");
                                  }}
                                  className="text-muted-foreground hover:text-destructive" aria-label="Remove rate">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                  </>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-amber-700">
                          No dated rates yet.{table.flat ? ` A flat rate of ₹${table.flat} is being used for every order until you add one.` : " Profit is not shown until one is added."}
                        </p>
                      )}
                      <div className="flex flex-wrap items-end gap-2">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">From</p>
                          <Input type="date" value={fxFrom} max={todayLocal()} onChange={e => setFxFrom(e.target.value)} className="rounded-xl h-9 w-[9.5rem]" />
                        </div>
                        <div className="relative">
                          <p className="text-[10px] text-muted-foreground mb-0.5">₹ per $1</p>
                          <Input type="number" min={0} step={0.01} value={fxRate} placeholder="e.g. 84.50"
                            onChange={e => setFxRate(e.target.value)} className="rounded-xl h-9 w-28" />
                        </div>
                        <Button size="sm" variant="outline" className="rounded-xl h-9"
                          onClick={() => {
                            const rate = Number(fxRate);
                            if (!fxFrom) { toast.error("Pick the date the rate applies from"); return; }
                            if (!(rate > 0)) { toast.error("Enter the rate"); return; }
                            // One rate per day: entering a day again corrects it.
                            const next = [...table.rates.filter(x => x.from !== fxFrom), { from: fxFrom, rate }];
                            commit(next);
                            setFxRate("");
                            toast.success(`₹${rate} from ${fmtDate(fxFrom)} saved`);
                          }}>
                          Add rate
                        </Button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Every other currency we hold: what transfers, foreign receipts and
                foreign expenses start from. */}
            {isAdmin && <CurrencyRatesSettings onSaved={next => setDb(prev => ({ ...prev, settings: { ...prev.settings, currencyRates: next } }))} />}

            {/* ── Where the cost figures are kept — admin only ── */}
            {isAdmin && (() => {
              const ready = adminStoreReady();
              const exposed = exposedAdminFigures(liveDb);
              const owed = exposed.stockCosts > 0 || exposed.rates;
              const move = async () => {
                if (!(await confirmBox(
                  "Move every ready-stock cost and the exchange rates into the admin-only store?\n\n"
                  + "They are copied first and only removed from their old places once the copy has reached the server, "
                  + "so nothing can be lost on the way. Afterwards no employee or client can read them, even from the raw data.",
                ))) return;
                updateDb(d => { copyAdminFiguresToPrivate(d); });
                await flush();
                if (collectionRefused("adminRecords")) {
                  toast.error("The server refused the admin-only store — nothing was moved. The security update has to be deployed first.");
                  return;
                }
                let removed = 0;
                updateDb(d => { removed = stripExposedAdminFigures(d); });
                await flush();
                // The form still holds the old rates; refresh it so "Save Pricing
                // Rates" cannot write them back where they came from.
                setDb(loadDb());
                toast.success(`Moved — ${removed} figure${removed !== 1 ? "s are" : " is"} now admin-only`);
              };
              return (
                <div className={`col-span-2 rounded-xl border p-3 text-xs ${!ready ? "border-border/60 bg-secondary/30" : owed ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"}`}>
                  <p className="font-semibold text-brand-dark flex items-center gap-1.5 mb-1">
                    <Lock className="h-3.5 w-3.5" /> Who can read your cost figures
                  </p>
                  {!ready ? (
                    <p className="text-muted-foreground">
                      Security update not live yet — exchange rates are still readable by staff, and
                      ready-stock costs by <span className="font-semibold text-destructive">clients too</span>, in the raw data.
                    </p>
                  ) : owed ? (
                    <>
                      <p className="text-muted-foreground">
                        Still readable by others:{" "}
                        {[
                          exposed.stockCosts > 0 ? `${exposed.stockCosts} ready-stock cost${exposed.stockCosts !== 1 ? "s" : ""} (clients can read these)` : "",
                          exposed.rates ? "the exchange rates (staff can read these)" : "",
                        ].filter(Boolean).join(" and ")}.
                      </p>
                      <AsyncButton onClick={move} className="btn-hero rounded-xl h-8 text-xs mt-2">Make them admin-only</AsyncButton>
                    </>
                  ) : (
                    <p className="text-success font-medium">
                      All ready-stock costs and exchange rates are admin-only — no employee or client can read them.
                    </p>
                  )}
                </div>
              );
            })()}

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
                Back as a gift card on each delivered order — clients you turn on only. 0 = off.
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
                Most of one order a gift card can pay. Override per client.
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

          <AsyncButton onClick={saveRates} className="btn-hero rounded-xl h-10 px-5 flex w-fit ml-auto">
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
            // Staged with the rest of this section — kept when "Save" below is pressed.
            const remove = async (id: string) => {
              const p = rows.find(x => x.id === id);
              if (!p) return;
              if (!(await confirmBox(`Remove the "${p.name}" label (${p.widthMm}×${p.heightMm}mm)?\n\nIt stops being offered when a band is printed. Bands already printed are not affected. Press Save below to keep the change.`))) return;
              setDb(prev => ({ ...prev, settings: { ...prev.settings, labelPresets: (prev.settings.labelPresets ?? DEFAULT_LABEL_PRESETS).filter(x => x.id !== id) } }));
            };
            const saveEdit = () => {
              if (!lpEdit) return;
              const w = Number(lpEdit.w), h = Number(lpEdit.h);
              if (!lpEdit.name.trim() || !(w >= 5) || !(h >= 5)) { toast.error("Enter a name, and a width and height of at least 5 mm"); return; }
              setDb(prev => ({ ...prev, settings: { ...prev.settings, labelPresets: (prev.settings.labelPresets ?? DEFAULT_LABEL_PRESETS).map(x => (x.id === lpEdit.id ? { ...x, name: lpEdit.name.trim(), style: lpEdit.style, widthMm: w, heightMm: h } : x)) } }));
              setLpEdit(null);
              toast.message("Changed — press Save below to keep it");
            };
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
                    <p className="text-[11px] text-muted-foreground">One size per printer or roll</p>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  {rows.map(p => lpEdit?.id === p.id ? (
                    <div key={p.id} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end rounded-lg border border-primary/40 bg-primary/[0.03] px-3 py-2">
                      <div className="col-span-2"><Label className="text-[11px]">Name</Label><Input value={lpEdit.name} autoFocus onChange={e => setLpEdit({ ...lpEdit, name: e.target.value })} className="rounded-lg h-9 mt-1" /></div>
                      <div><Label className="text-[11px]">Style</Label>
                        <Select value={lpEdit.style} onValueChange={v => setLpEdit({ ...lpEdit, style: v as "tag" | "label" })}>
                          <SelectTrigger className="h-9 rounded-lg mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="tag">Tag</SelectItem><SelectItem value="label">Label</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-[11px]">W (mm)</Label><Input type="number" min={5} value={lpEdit.w} onChange={e => setLpEdit({ ...lpEdit, w: e.target.value })} className="rounded-lg h-9 mt-1" /></div>
                      <div><Label className="text-[11px]">H (mm)</Label><Input type="number" min={5} value={lpEdit.h} onChange={e => setLpEdit({ ...lpEdit, h: e.target.value })} className="rounded-lg h-9 mt-1" /></div>
                      <div className="flex gap-1.5">
                        <Button onClick={saveEdit} className="btn-hero rounded-lg h-9 flex-1">Done</Button>
                        <Button variant="outline" onClick={() => setLpEdit(null)} className="rounded-lg h-9 w-9 p-0" aria-label="Keep it as it was"><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ) : (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">{p.style === "tag" ? "Jewellery tag" : "Spec label"} · {p.widthMm}×{p.heightMm}mm</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setLpEdit({ id: p.id, name: p.name, style: p.style, w: String(p.widthMm), h: String(p.heightMm) })} className="h-7 w-7 rounded-lg grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10" title="Edit" aria-label={`Edit ${p.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => void remove(p.id)} className="h-7 w-7 rounded-lg grid place-items-center text-destructive hover:bg-destructive/10" title="Remove" aria-label={`Remove ${p.name}`}><X className="h-3.5 w-3.5" /></button>
                      </div>
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
                  Pick the printer in the print dialog; scanners just work.
                </p>
              </div>
            );
          })()}

          <AsyncButton onClick={saveBand} className="btn-hero rounded-xl h-10 px-5 flex w-fit ml-auto">
            Save Label &amp; Barcode Settings
          </AsyncButton>
        </div>
      )}

      {/* Table style — admin only */}
      {activeId === "appearance" && <AppearanceSettings />}
      {activeId === "tables" && <TableStyleSettings />}

      {/* Companies — admin only */}
      {activeId === "companies" && <CompaniesSettings />}
      {/* Materials beyond gold and diamonds — admin only */}
      {activeId === "materials" && <MaterialsSettings />}

      {/* Production timeline — admin only */}
      {activeId === "timeline" && <TimelineSettings />}

      {/* The business's own dropdown choices — admin only */}
      {activeId === "lists" && <OptionListsSettings />}

      {/* Expense Categories — admin only */}
      {activeId === "expenses" && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold">Expense Categories</h3>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {expenseCategories.map(c => catChip("expense", c, removeCategory))}
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

      {/* Account Categories — admin only */}
      {activeId === "expenses" && (
        <div className="card-luxe p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold">Account Categories</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Required on every account entry
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {lockerCategories.map(c => catChip("account", c, removeLockerCategory))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newLockerCategory} onChange={e => setNewLockerCategory(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addLockerCategory()}
              className="rounded-xl h-10" placeholder="New account category"
            />
            <Button onClick={addLockerCategory} variant="outline" className="rounded-xl gap-2 shrink-0"><Plus className="h-4 w-4" /> Add</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Removing hides it for new entries only; renaming renames old entries too.
          </p>
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
          <Button onClick={syncLogins} disabled={syncing} className="btn-hero rounded-xl h-10 px-5 flex w-fit ml-auto">
            {syncing
              ? "Provisioning…"
              : `Provision ${pendingLogins.length} login${pendingLogins.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}

      {/* Data */}
      {activeId === "data" && isAdmin && <ServerTotalsCheck />}
      {activeId === "data" && isAdmin && <DataSizePanel />}
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
                <p className="text-[11px] text-muted-foreground">Same e-mail on more than one account — merge them.</p>
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
                          {g.users.length} accounts — keeping the oldest ({new Date(keep.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")}), removing {drops.length}
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
        {SHOW_REPAIR_TOOLS && isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${duplicateGroups.length ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <Hash className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Order Numbers</h3>
                <p className="text-[11px] text-muted-foreground">
                  {duplicateGroups.length === 0
                    ? "All unique."
                    : `${duplicateGroups.length} number${duplicateGroups.length !== 1 ? "s are" : " is"} used by more than one order.`}
                </p>
              </div>
            </div>

            {duplicateGroups.length > 0 && (
              <div className="mt-3 space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  The oldest keeps the number. Links follow the order, not the number.
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
                                {new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")} · {o.status}
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
        {SHOW_REPAIR_TOOLS && isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${unnumberedPayments.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <ReceiptText className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm flex items-center gap-1.5">Receipt Numbers<InfoTip text="Older payments live only on the orders they settled. Numbering links each to a receipt — existing deposits are linked, not recorded again — so it can be corrected or cancelled like any new one." /></h3>
                <p className="text-[11px] text-muted-foreground">
                  {unnumberedPayments.length === 0
                    ? "All numbered."
                    : `${unnumberedPayments.length} payment${unnumberedPayments.length !== 1 ? "s were" : " was"} taken before receipts were numbered.`}
                </p>
              </div>
            </div>

            {unnumberedPayments.length > 0 && (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Labels only — <span className="font-medium text-foreground">not one amount, date or balance changes</span>.
                </p>
                <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                  {unnumberedPayments.slice(0, 8).map((g, i) => {
                    const client = liveDb.clients.find(c => c.id === g.clientId);
                    return (
                      <p key={i} className="text-[11px] text-muted-foreground">
                        {new Date(g.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")} · {client?.companyName ?? "Client"} · {fmtMoney(g.amount)}
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


        {/* ── Stock driven negative by a half-removed purchase (admin only) ── */}
        {isAdminUser && widowedUses.length > 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-destructive/10 text-destructive">
                <Boxes className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm flex items-center gap-1.5">Stock Showing Less Than It Should<InfoTip text="Material bought for one order goes in and out as a pair. Removing such a purchase left its 'used' row behind. Clearing those rows puts the balance back; the cause is fixed." /></h3>
                <p className="text-[11px] text-muted-foreground">
                  {widowedUses.length} movement{widowedUses.length !== 1 ? "s" : ""} record material leaving stock it was never added to.
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Clears the leftover &ldquo;used&rdquo; rows —
              <span className="font-medium text-foreground"> no purchase, issue, order or payment is touched</span>.
            </p>

            {widowedImpact.length > 0 && (
              <p className="mt-2 text-[11px]">
                <span className="text-muted-foreground">Short by: </span>
                {widowedImpact.map(i => `${i.key} ${i.qty}${i.unit}`).join(" · ")}
              </p>
            )}

            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
              {widowedUses.slice(0, 8).map(r => (
                <p key={r.id} className="text-[11px] text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")} · {r.purityOrQuality} · {r.quantity}{materialUnit(db.settings, r.material)} · {r.orderNumber}
                </p>
              ))}
              {widowedUses.length > 8 && (
                <p className="text-[11px] text-muted-foreground">…and {widowedUses.length - 8} more.</p>
              )}
            </div>

            <AsyncButton size="sm" variant="outline" disabled={fixingStock} onClick={repairStock} className="rounded-xl h-9 mt-3">
              {fixingStock ? "Clearing…" : `Clear ${widowedUses.length} movement${widowedUses.length !== 1 ? "s" : ""}`}
            </AsyncButton>
          </div>
        )}

        {/* ── Supplier payments that never reached the supplier's books (admin only) ── */}
        {isAdminUser && lostSupplierPayments.length > 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 bg-destructive/10 text-destructive">
                <Truck className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm flex items-center gap-1.5">Payments Missing From The Party's Books<InfoTip text="Paid to a supplier with no bills (a first advance, a loan), only the account side was written: the money left, but the supplier reads ₹0 and Settled. Restoring records where it went." /></h3>
                <p className="text-[11px] text-muted-foreground">
                  {lostSupplierPayments.length} payment{lostSupplierPayments.length !== 1 ? "s" : ""} totalling {fmtMoneyInr(lostSupplierTotal)} left an account but never reached the supplier or factory.
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Adds each back as an advance on its own date —
              <span className="font-medium text-foreground"> no money moves</span>.
            </p>

            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
              {lostSupplierPayments.slice(0, 8).map(o => (
                <p key={o.txnId} className="text-[11px] text-muted-foreground">
                  {new Date(o.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")} · {o.partyName} · {fmtMoneyInr(o.amountInr)}
                  {" · "}{liveDb.lockers.find(l => l.id === o.lockerId)?.name ?? "account"}
                </p>
              ))}
              {lostSupplierPayments.length > 8 && (
                <p className="text-[11px] text-muted-foreground">…and {lostSupplierPayments.length - 8} more.</p>
              )}
            </div>

            <AsyncButton
              size="sm" variant="outline" disabled={fixingSupplier}
              onClick={restoreSupplierPayments}
              className="rounded-xl h-9 mt-3"
            >
              {fixingSupplier ? "Restoring…" : `Restore ${lostSupplierPayments.length} payment${lostSupplierPayments.length !== 1 ? "s" : ""}`}
            </AsyncButton>
          </div>
        )}


        {/* ── Client payments that never reached their orders (admin only) ── */}
        {SHOW_REPAIR_TOOLS && isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${looseIncome.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <Banknote className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm flex items-center gap-1.5">Unapplied Money In<InfoTip text="A plain locker entry counts as cash but never settles a bill, so the invoice stays pending. Applying it counts nothing twice; marking one as not a client payment moves no money and can be undone." /></h3>
                <p className="text-[11px] text-muted-foreground">
                  {looseIncome.length === 0
                    ? "All applied."
                    : `${looseIncome.length} deposit${looseIncome.length !== 1 ? "s" : ""} not applied to anyone.`}
                </p>
              </div>
            </div>

            {looseIncome.length > 0 && (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Applying adds only the missing allocation — the locker amount doesn&rsquo;t change. Capital or interest:
                  mark it <span className="font-medium text-foreground">Not a client payment</span>.
                </p>
                <div className="mt-3 space-y-1.5">
                  {looseIncome.slice(0, 30).map(t => {
                    const locker = liveDb.lockers.find(l => l.id === t.lockerId);
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {fmtCcy(t.amountInr, t.currency)} · {t.category || t.note || "Money in"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {locker?.name ?? "Locker"} · {new Date(t.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setNotClientPayment(t.id, true)}
                            className="rounded-lg h-8 text-muted-foreground hover:text-foreground"
                          >
                            Not a client payment
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => { setFixTxnId(t.id); setFixClientId(""); setFixInvoiceId(""); setFixRate(""); }}
                            className="rounded-lg h-8"
                          >
                            Apply to a client
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {looseIncome.length > 30 && (
                    <p className="text-[11px] text-muted-foreground">Showing the 30 newest.</p>
                  )}
                </div>
              </>
            )}

            {notClientRows.length > 0 && (
              <details className="mt-3">
                <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                  {notClientRows.length} entr{notClientRows.length !== 1 ? "ies" : "y"} marked as not a client payment
                </summary>
                <div className="mt-2 space-y-1.5">
                  {notClientRows.map(t => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-white px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {fmtCcy(t.amountInr, t.currency)} · {t.category || t.note || "Money in"}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {liveDb.lockers.find(l => l.id === t.lockerId)?.name ?? "Locker"} · {new Date(t.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setNotClientPayment(t.id, false)}
                        className="rounded-lg h-8 shrink-0 text-muted-foreground hover:text-foreground">
                        Undo
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {fixTxn && (
              <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-brand-dark">
                  Apply {fmtCcy(fixTxn.amountInr, fixTxn.currency)} from {new Date(fixTxn.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")}
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
                    {/* In the account's own currency: what one dollar of the bill is worth in it. */}
                    <Label className="text-xs">Exchange rate — 1 USD = {ccySymbol(fixTxn.currency).trim()} <span className="text-destructive">*</span></Label>
                    <Input type="number" min={0} step="0.01" value={fixRate} onChange={e => setFixRate(e.target.value)} className="rounded-xl h-10 mt-1 bg-white" placeholder={ccy(fixTxn.currency) === "INR" ? "e.g. 83.50" : undefined} />
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
        {SHOW_INVOICE_NUMBER_TOOL && isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${invoiceGaps.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <Hash className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Invoice Numbers</h3>
                <p className="text-[11px] text-muted-foreground">
                  {invoiceGaps.length === 0
                    ? "No gaps."
                    : `Missing: ${invoiceGaps.map(n => String(n).padStart(4, "0")).join(", ")} — an invoice was cancelled.`}
                </p>
              </div>
            </div>
            {invoiceGaps.length > 0 && (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Date order from 0001 — only the numbers move, and old numbers stay searchable. You see every change first.
                </p>
                <Button size="sm" variant="outline" onClick={renumberInvoices} className="rounded-xl h-9 mt-3">
                  Renumber invoices in date order
                </Button>
              </>
            )}
          </div>
        )}


        {/* ── Invoices raised by mistake (admin only) ── */}
        {SHOW_ADMIN_TOOLS && isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${undispatchedCount ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark text-sm">Delete an Invoice</h3>
                <p className="text-[11px] text-muted-foreground">
                  {undispatchedCount === 0
                    ? "All on dispatched orders."
                    : `${undispatchedCount} invoice${undispatchedCount !== 1 ? "s were" : " was"} raised for an order that isn't dispatched.`}
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Removes only the bill — no figure changes, and the order can be billed again.
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
                      {new Date(r.inv.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")} ·{" "}
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
        {SHOW_ADMIN_TOOLS && isAdminUser && (
          <div className="rounded-xl border border-border/70 p-4 mt-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-success/10 text-success grid place-items-center shrink-0"><Database className="h-4 w-4" /></div>
                <div>
                  <h3 className="font-semibold text-brand-dark text-sm">Automatic Backups</h3>
                  <p className="text-[11px] text-muted-foreground">Daily, to the cloud · last 14 kept</p>
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
                  No cloud backups yet — one is taken daily, or press “Back up now”.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── The same snapshot, in Drive — the copy that is not in this project ── */}
        {isAdminUser && <GoogleDriveBackup />}

      </div>
      )}

        </div>
      </div>
    </div>
  );
}
