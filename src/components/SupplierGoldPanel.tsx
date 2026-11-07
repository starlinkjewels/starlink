import { useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, BookOpen, Coins, FileText, Pencil, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { dayOf, fmtDate, stampFor, todayLocal, type Supplier, type SupplierGoldEntry } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { companiesOf, companyById, hasCompanies } from "@/lib/companies";
import {
  GOLD_COLS, GOLD_KARATS, billAmount, billProblem, deleteGoldEntry, editGoldEntry, goldEntryEditProblem, fmtG, goldEntryDeleteBlocker, goldEntryDeleteImpact, goldFine, goldInStock,
  goldToBill, hasGoldAccount, loanProblem, owedIn, returnGold, returnProblem, setOpeningGold, supplierGoldOwed, takeGoldLoan,
  type SupplierGoldRow,
} from "@/lib/supplierGold";
import { useLoaded } from "@/hooks/useLoaded";
import { confirmBox } from "@/lib/confirm";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, Group, PanelActions, Stat, Stats, UnitInput } from "@/components/BillLayout";
import { CompanyPicker, useDefaultCompany, useMultiCo } from "@/components/CompanyFields";
import { SectionTitle } from "@/components/SectionTitle";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellAmount, CellDate, CellTag, type DataColumn } from "@/components/DataTable";
import { filled, noteText, recorded, type Detail } from "@/components/rowDetails";
import type { MoreAction } from "@/components/MoreMenu";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cleanGstPct, defaultPurchaseGstPct, gstOn, pctText } from "@/lib/purchaseGst";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openMin } from "@/lib/openMin";

/** Which form is open: take on loan, give back, turn into a bill, or the opening figure. */
export type GoldMode = "take" | "return" | "bill" | "opening" | null;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const dash = <span className="text-muted-foreground/50">—</span>;

/**
 * A supplier's gold account (lib/supplierGold.ts): gold taken on loan into our
 * stock, gold given back, gold owed turned into a rupee bill — in grams, with
 * what is owed in fine (24K) grams. The page's ⋯ opens the forms (`mode`).
 */
export function SupplierGoldPanel({ supplier, isAdmin, mode, onMode }: {
  supplier: Supplier;
  isAdmin: boolean;
  mode: GoldMode;
  onMode: (m: GoldMode) => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const multiCo = useMultiCo();
  const defaultCo = useDefaultCompany();
  // The account is worked out from the stock lines and the bills — both must be here first.
  const ready = useLoaded(GOLD_COLS);
  const acc = supplierGoldOwed(db, supplier);

  // ── The form: one set of fields, read by whichever form is open ──
  const [grams, setGrams] = useState("");
  const [purity, setPurity] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [companyId, setCompanyId] = useState(defaultCo);
  const [note, setNote] = useState("");
  const [fine, setFine] = useState("");
  const [rate, setRate] = useState("");
  const [billNo, setBillNo] = useState("");
  // In bill (GST) — off unless ticked, at the % from Settings → Pricing.
  const [gstBill, setGstBill] = useState(false);
  const [gstPctText, setGstPctText] = useState("");
  // A loan or a return being corrected: the same form, filled with it (lib/supplierGold.ts editGoldEntry).
  const [editing, setEditing] = useState<SupplierGoldEntry | null>(null);
  useEffect(() => {
    if (!mode) { setEditing(null); return; }
    setGrams(""); setPurity(""); setDate(mode === "opening" ? supplier.openingGoldDate || "" : todayLocal()); setCompanyId(defaultCo);
    setNote(""); setFine(mode === "opening" && supplier.openingGoldFine ? String(supplier.openingGoldFine) : ""); setRate(""); setBillNo("");
    setGstBill(false); setGstPctText(pctText(defaultPurchaseGstPct(db.settings)));
    if (editing && (mode === "take" || mode === "return")) {
      setGrams(String(editing.grams)); setPurity(editing.purity); setDate(dayOf(editing.at));
      setCompanyId(editing.companyId || "main"); setNote(editing.note ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editing]);

  const close = () => onMode(null);
  // A return or a bill comes off the gold owed in the company it is for.
  const owedCo = owedIn(db, supplier, companyId);
  const coName = hasCompanies(db.settings) ? ` in ${companyById(db.settings, companyId).name}` : "";
  const inStock = goldInStock(db, companyId);
  const stockPurities = Object.entries(inStock).filter(([, g]) => g > 0.0005).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  // Any karat for a loan — the usual ones, and any other already kept in stock.
  const takePurities = [...new Set([...GOLD_KARATS, ...Object.keys(inStock)])].filter(Boolean);
  const g = r3(num(grams));
  const moveFine = purity && g > 0 ? goldFine(g, purity) : 0;
  const billFine = r3(num(fine));
  const baseAmount = billFine > 0 && num(rate) > 0 ? billAmount(billFine, num(rate)) : 0;
  const gstPct = gstBill ? cleanGstPct(gstPctText) : 0;
  const gstAmount = gstOn(baseAmount, gstPct);
  // The bill as it goes on their account — with its GST when it is in bill.
  const amount = baseAmount + gstAmount;
  /** Grams of a purity that make this much fine gold (owed 9.16 g fine = 10 g of 22K). */
  const grossOf = (f: number, p: string) => { const per = goldFine(1, p); return per > 0 ? r3(f / per) : 0; };
  // A correction dated the same day keeps its moment, so nothing moves in the history by itself.
  const move = () => ({ grams: g, purity, companyId, at: editing && date === dayOf(editing.at) ? editing.at : stampFor(date), note });
  const correct = async () => {
    if (!editing) return;
    if (!ready) { toast.error("Still loading — a moment"); return; }
    const problem = goldEntryEditProblem(db, supplier, editing, move());
    if (problem) { toast.error(problem); return; }
    try {
      await editGoldEntry(supplier.id, editing.id, move(), user!);
      toast.success("Corrected — stock and gold owed put right");
      close();
    } catch (e) { toast.error(e instanceof Error ? e.message : "It wasn't corrected"); }
  };

  const take = async () => {
    const problem = loanProblem(supplier, move());
    if (problem) { toast.error(problem); return; }
    try {
      await takeGoldLoan(supplier.id, move(), user!);
      toast.success(`${fmtG(g)} ${purity} into stock — owed to ${supplier.name}`);
      close();
    } catch (e) { toast.error(e instanceof Error ? e.message : "The loan wasn't recorded"); }
  };
  const giveBack = async () => {
    if (!ready) { toast.error("Still loading — a moment"); return; }
    const problem = returnProblem(db, supplier, move());
    if (problem) { toast.error(problem); return; }
    try {
      await returnGold(supplier.id, move(), user!);
      toast.success(`${fmtG(g)} ${purity} returned to ${supplier.name}`);
      close();
    } catch (e) { toast.error(e instanceof Error ? e.message : "The return wasn't recorded"); }
  };
  const bill = async () => {
    const b = { fine: billFine, rateInr: num(rate), companyId, at: stampFor(date), invoiceNumber: billNo, note, gstBill, gstPct };
    if (!ready) { toast.error("Still loading — a moment"); return; }
    if (gstBill && !(gstPct > 0)) { toast.error("Enter the GST % — or untick In bill"); return; }
    const problem = billProblem(db, supplier, b);
    if (problem) { toast.error(problem); return; }
    if (!(await confirmBox([
      `Turn ${fmtG(billFine)} fine gold into a bill of ${fmtMoneyInr(amount)}?`,
      "",
      `• ${fmtG(billFine)} fine comes off the gold owed to ${supplier.name}`,
      `• ${fmtMoneyInr(amount)}${gstAmount > 0 ? ` (incl. GST ${pctText(gstPct)}% ${fmtMoneyInr(gstAmount)})` : ""} goes on their account as a bill, paid like any other`,
      "• no stock moves — the gold is already in stock",
    ].join("\n"), { confirmText: "Make the bill" }))) return;
    try {
      goldToBill(supplier.id, b, user!);
      toast.success(`Bill of ${fmtMoneyInr(amount)} made — ${fmtG(billFine)} fine off the gold owed`);
      close();
    } catch (e) { toast.error(e instanceof Error ? e.message : "The bill wasn't made"); }
  };
  const saveOpening = () => {
    try {
      setOpeningGold(supplier.id, num(fine), date || undefined);
      toast.success(num(fine) > 0 ? `Opening gold owed: ${fmtG(num(fine))} fine` : "Opening gold cleared");
      close();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save the opening gold"); }
  };

  // ── The account: figures, then every line ──
  const rowActions = (r: SupplierGoldRow): MoreAction[] => {
    if (r.kind === "opening") {
      return [{ label: "Edit", icon: BookOpen, disabled: !isAdmin, hint: isAdmin ? "Gold owed when you started" : "Only an admin can change it", onSelect: () => onMode("opening") }];
    }
    const e = r.entry!;
    const why = !isAdmin ? "Only an admin can change it" : !ready ? "Still loading" : goldEntryDeleteBlocker(db, supplier, e);
    const editWhy = !isAdmin ? "Only an admin can change it" : !ready ? "Still loading" : e.kind === "toBill" ? "A bill — correct it in Purchase History" : undefined;
    return [{
      label: "Edit", icon: Pencil, disabled: !!editWhy,
      hint: editWhy ?? "Grams, purity, date, company and note",
      onSelect: () => { setEditing(e); onMode(e.kind === "loanIn" ? "take" : "return"); },
    }, {
      label: "Delete", icon: Trash2, danger: true, disabled: !!why,
      hint: why ?? (e.kind === "loanIn" ? "Its gold comes out of stock again" : "Its gold goes back into stock"),
      onSelect: async () => {
        if (!(await confirmBox([`Delete this ${e.kind === "loanIn" ? "gold loan" : "gold return"}?`, "", ...goldEntryDeleteImpact(supplier, e)].join("\n"), { danger: true, confirmText: "Delete" }))) return;
        try { await deleteGoldEntry(supplier.id, e.id, user!); toast.success("Deleted — stock and gold owed put right"); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't delete it"); }
      },
    }];
  };
  const details = (r: SupplierGoldRow): Detail[] => {
    const e = r.entry;
    if (!e) return [];
    const p = e.purchaseId ? (db.purchases ?? []).find(x => x.id === e.purchaseId) : undefined;
    return filled([
      { label: "Fine gold", value: `${fmtG(e.fine)} fine${e.kind !== "toBill" ? ` (${fmtG(e.grams)} ${e.purity})` : ""}` },
      e.kind === "toBill" && !!p && { label: "Bill", value: `${fmtMoneyInr(p.totalInr)}${p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}` },
      multiCo && { label: "Company", value: companyById(db.settings, e.companyId).name },
      { label: "Note", value: noteText(e.note) },
      { label: "Recorded", value: recorded(db, e.at, e.by) },
    ]);
  };
  const columns: DataColumn<SupplierGoldRow>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: r => +new Date(r.at), csv: r => (r.kind === "opening" ? "Opening" : fmtDate(r.at)),
      cell: r => <CellDate>{r.kind === "opening" ? "Opening" : fmtDate(r.at)}</CellDate> },
    { key: "particulars", header: "Particulars", always: true, sortValue: r => r.particulars,
      cell: r => <span>{r.particulars}</span> },
    { key: "in", header: "In (g)", align: "right", kind: "number", sortValue: r => r.inGrams || null,
      cell: r => (r.inGrams ? <CellAmount tone="in">{r.inGrams.toLocaleString()}</CellAmount> : dash) },
    { key: "purity", header: "Purity", sortValue: r => r.purity, cell: r => (r.kind === "opening" ? dash : <CellTag tone="blue">{r.purity}</CellTag>) },
    { key: "out", header: "Out (g)", align: "right", kind: "number", sortValue: r => r.outGrams || null,
      cell: r => (r.outGrams ? <CellAmount tone="out">{r.outGrams.toLocaleString()}</CellAmount> : dash) },
    { key: "fine", header: "Fine (g)", align: "right", kind: "number", sortValue: r => r.fine,
      cell: r => <span className="tabular-nums whitespace-nowrap">{r.fine > 0 ? "+" : "−"}{Math.abs(r.fine).toLocaleString()}</span> },
    { key: "balance", header: "Balance (fine g)", align: "right", kind: "number", sortValue: r => r.balance,
      cell: r => <span className="tabular-nums whitespace-nowrap font-medium text-brand-dark">{r.balance.toLocaleString()}</span> },
  ];

  const show = ready && hasGoldAccount(db, supplier);
  // With several companies, what each owes — a return or a bill comes off its own company's.
  const byCo = multiCo ? companiesOf(db.settings).map(c => ({ name: c.name, owed: owedIn(db, supplier, c.id) })).filter(x => Math.abs(x.owed) > 0.0005) : [];
  const owedSub = byCo.length > 1 ? byCo.map(x => `${x.name} ${fmtG(x.owed)}`).join(" · ")
    : acc.owed > 0.0005 ? "Fine (24K) gold to give back" : "Nothing owed in gold";

  const title = editing && mode === "take" ? "Correct gold loan" : editing && mode === "return" ? "Correct gold return" : mode === "take" ? "Gold on loan" : mode === "return" ? "Return gold" : mode === "bill" ? "Gold to a bill" : "Opening gold owed";
  const icon = mode === "take" ? ArrowDownCircle : mode === "return" ? ArrowUpCircle : mode === "bill" ? FileText : BookOpen;
  const description = mode === "take" ? `From ${supplier.name} — into our gold stock, owed back in gold`
    : mode === "return" ? `To ${supplier.name}, out of our stock · ${fmtG(owedCo)} fine owed${coName}`
    : mode === "bill" ? `Pay for gold owed in money · ${fmtG(owedCo)} fine owed${coName}`
    : "Fine gold we owed them when you started";
  // Corrected: as if the line were never there, then the corrected one.
  const was = editing && (editing.companyId || "main") === (companyId || "main") ? (editing.kind === "loanIn" ? editing.fine : -editing.fine) : 0;
  const owedAfter = mode === "take" ? owedCo - was + moveFine : mode === "return" ? owedCo - was - moveFine : mode === "bill" ? owedCo - billFine : acc.owed;

  const dateField = (
    <Field label="Date">{id => <Input id={id} type="date" min={openMin()} value={date} max={todayLocal()} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
  );
  const companyField = multiCo && (
    <div className="col-span-2">
      <CompanyPicker value={companyId} onChange={v => { setCompanyId(v); if (mode === "return") setPurity(""); }}
        label={mode === "take" ? "Company — whose stock it goes into" : mode === "return" ? "Company — whose stock it comes out of" : "Company — whose bill it is"} />
    </div>
  );
  const noteField = (
    <Field label="Note" className="col-span-2">{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
  );

  return (
    <>
      {show && (
        <div className="card-luxe overflow-hidden">
          <SectionTitle title="Gold account" className="px-5 py-4 border-b border-border/60" icon={Coins}
            sub="In grams · apart from the money account"
            info="Gold taken from them on loan goes into our gold stock and is owed back in gold. Give it back from stock, or turn some into a rupee bill at a gold rate." />
          <div className="p-3 sm:p-4 space-y-3">
            <StatStrip items={[
              { label: "Gold owed", value: `${fmtG(acc.owed)} fine`, icon: Scale, tone: acc.owed > 0.0005 ? "out" : "in", sub: owedSub },
              { label: "Taken on loan", value: `${fmtG(acc.taken)} fine`, icon: ArrowDownCircle, sub: acc.opening > 0 ? `+ ${fmtG(acc.opening)} fine opening` : undefined },
              { label: "Returned", value: `${fmtG(acc.returned)} fine`, icon: ArrowUpCircle },
              ...(acc.billed > 0 ? [{ label: "Turned into bills", value: `${fmtG(acc.billed)} fine`, icon: FileText }] : []),
            ]} />
            <DataTable
              id="supplier-gold"
              noun="entry"
              plural="entries"
              rows={[...acc.rows].reverse()}
              columns={columns}
              rowKey={r => r.id}
              defaultSort={{ key: "date", dir: "desc" }}
              searchText={r => [r.particulars, r.purity, r.entry?.note].filter(Boolean).join(" ")}
              searchPlaceholder="Search gold account"
              exportName={`Supplier-${supplier.name.replace(/\s+/g, "_")}-Gold`}
              details={details}
              rowActions={rowActions}
              emptyText="No gold taken or returned yet."
            />
          </div>
        </div>
      )}

      <ActionSheet open={!!mode} onOpenChange={v => { if (!v) close(); }} title={title} description={description} icon={icon}
        footer={(
          <div className="space-y-3">
            <Stats>
              {mode === "bill"
                ? <Stat big label="Bill" value={amount > 0 ? fmtMoneyInr(amount) : "—"} sub={billFine > 0 && num(rate) > 0 ? `${fmtG(billFine)} fine × ${fmtMoneyInr(num(rate))}/g${gstAmount > 0 ? ` + GST ${fmtMoneyInr(gstAmount)}` : ""}` : "fine grams × rate"} />
                : mode === "opening"
                  ? <Stat big label="Opening" value={`${fmtG(num(fine))} fine`} />
                  : <Stat big label="Fine gold" value={moveFine > 0 ? `${fmtG(moveFine)} fine` : "—"} sub={purity ? `${purity} at ${Math.round(goldFine(1, purity) * 1000)}‰` : "choose the purity"} />}
              {mode !== "opening" && <Stat label="Owed after" value={`${fmtG(owedAfter)} fine`} sub={owedAfter < -0.0005 ? "more than is owed" : undefined} />}
            </Stats>
            <PanelActions onCancel={close}>
              <AsyncButton onClick={editing ? correct : mode === "take" ? take : mode === "return" ? giveBack : mode === "bill" ? bill : saveOpening}
                className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-44">
                {editing ? "Save correction" : mode === "take" ? "Take on loan" : mode === "return" ? "Return gold" : mode === "bill" ? "Make the bill" : "Save"}
              </AsyncButton>
            </PanelActions>
          </div>
        )}>
        <div className="@container space-y-5">
          {mode === "take" && (
            <Group>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Grams">{id => <UnitInput id={id} min={0} step="0.001" unit="g" value={grams} onChange={e => setGrams(e.target.value)} autoFocus />}</Field>
                <Field label="Purity">{id => (
                  <Select value={purity} onValueChange={setPurity}>
                    <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose purity" /></SelectTrigger>
                    <SelectContent>{takePurities.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                )}</Field>
                {dateField}
                {companyField}
                {noteField}
              </div>
            </Group>
          )}
          {mode === "return" && (
            <Group>
              <div className="grid grid-cols-2 gap-3">
                {companyField}
                <Field label="Purity" hint={stockPurities.length ? undefined : "No gold in stock."}>{id => (
                  <Select value={purity} onValueChange={setPurity}>
                    <SelectTrigger id={id} className="h-10 rounded-xl"><SelectValue placeholder="Choose purity in stock" /></SelectTrigger>
                    <SelectContent>
                      {stockPurities.map(([p, q]) => <SelectItem key={p} value={p}>{p} — {fmtG(q)} in stock</SelectItem>)}
                      {editing && !stockPurities.some(([p]) => p === editing.purity) && <SelectItem value={editing.purity}>{editing.purity} — as returned</SelectItem>}
                    </SelectContent>
                  </Select>
                )}</Field>
                <Field label="Grams" hint={purity ? <>In stock: {fmtG(inStock[purity] ?? 0)}{owedCo > 0.0005 ? <> · all owed = {fmtG(grossOf(owedCo, purity))} of {purity}</> : null}</> : undefined}>{id => (
                  <UnitInput id={id} min={0} step="0.001" unit="g" value={grams} onChange={e => setGrams(e.target.value)} />
                )}</Field>
                {purity && owedCo > 0.0005 && (
                  <button type="button" onClick={() => setGrams(String(Math.min(grossOf(owedCo, purity), r3(inStock[purity] ?? 0))))}
                    className="col-span-2 -mt-1 justify-self-start inline-flex items-center h-7 px-2.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10">
                    All owed · {fmtG(grossOf(owedCo, purity))} {purity}
                  </button>
                )}
                {dateField}
                {noteField}
              </div>
              <p className="text-xs text-muted-foreground mt-3">Only what is owed can go back — more than that is a sale: use Sell to them.</p>
            </Group>
          )}
          {mode === "bill" && (
            <Group>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fine gold (g)" hint={owedCo > 0.0005 ? `Owed${coName}: ${fmtG(owedCo)} fine` : `No gold is owed${coName}`}>{id => (
                  <UnitInput id={id} min={0} step="0.001" unit="g" value={fine} onChange={e => setFine(e.target.value)} autoFocus />
                )}</Field>
                <Field label="Rate (₹ / fine g)">{id => <UnitInput id={id} min={0} unit="₹/g" value={rate} onChange={e => setRate(e.target.value)} />}</Field>
                {owedCo > 0.0005 && num(fine) !== r3(owedCo) && (
                  <button type="button" onClick={() => setFine(String(r3(owedCo)))}
                    className="col-span-2 -mt-1 justify-self-start inline-flex items-center h-7 px-2.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10">
                    All owed · {fmtG(owedCo)} fine
                  </button>
                )}
                <Field label="Bill no.">{id => <Input id={id} value={billNo} onChange={e => setBillNo(e.target.value)} className="rounded-xl h-10" placeholder="Optional" />}</Field>
                {dateField}
                {companyField}
                {noteField}
                {/* In bill: GST on top of fine × rate (lib/purchaseGst.ts). */}
                <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-brand-dark cursor-pointer">
                    <Checkbox checked={gstBill} onCheckedChange={v => setGstBill(v === true)} aria-label="In bill (GST)" />
                    In bill (GST)
                  </label>
                  {gstBill && <div className="w-24"><UnitInput min={0} max={100} step="0.01" unit="%" value={gstPctText} onChange={e => setGstPctText(e.target.value)} aria-label="GST %" /></div>}
                  <span className="text-xs text-muted-foreground">{gstBill ? (gstAmount > 0 ? `+${fmtMoneyInr(gstAmount)} GST` : "GST on fine × rate") : "Not ticked: no bill — no GST."}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">The gold stays in stock. The bill goes on their money account and is paid like any other; void it to put the gold back on what is owed.</p>
            </Group>
          )}
          {mode === "opening" && (
            <Group>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fine gold owed (g)" hint="0 clears it">{id => (
                  <UnitInput id={id} min={0} step="0.001" unit="g" value={fine} onChange={e => setFine(e.target.value)} autoFocus />
                )}</Field>
                <Field label="As of">{id => <Input id={id} type="date" min={openMin()} value={date} max={todayLocal()} onChange={e => setDate(e.target.value)} className="rounded-xl h-10" />}</Field>
              </div>
            </Group>
          )}
        </div>
      </ActionSheet>
    </>
  );
}
