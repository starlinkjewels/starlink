import { useCan } from "@/hooks/useCan";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { EditPurchaseDialog } from "@/components/EditPurchaseDialog";
import {
  canEditPurchase, canVoidPurchase, editPurchase, purchaseLabel, voidImpact, purchaseEditScope,
  voidPurchase as voidPurchaseCascade, type PurchaseEdit,
} from "@/lib/purchaseVoid";
import { ExternalLink, Gem, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import { StatStrip } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { canEditIssuance, canCancelIssuance, deleteIssuance, issuanceVoidImpact } from "@/lib/issuanceEdit";
import { IssuanceEditSheet } from "@/components/IssuanceEditSheet";
import { OpeningStockEditSheet, openingStockActions } from "@/components/OpeningStockEditSheet";
import { needsAccess } from "@/lib/actionHints";
import { canVoidSale, saleVoidImpact, voidDiamondSale } from "@/lib/diamondSaleVoid";
import { toast } from "sonner";
import { fmtDate, type MaterialIssuance, type Purchase, type StockMovement } from "@/lib/db";
import { fmtMoneyInr, discountLabel } from "@/lib/manufacturing";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import type { MoreAction } from "@/components/MoreMenu";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { inDateRange, ledgerTable, rangeLabel } from "@/components/LedgerFilters";
import { confirmBox } from "@/lib/confirm";
import { materialName, materialUnit, purchaseQty, materialDefs, diamondSpec, purchaseUnitInr, type MaterialUnit } from "@/lib/materials";
import { companyOf, companiesOf, hasCompanies } from "@/lib/companies";
import { oneLine } from "@/components/MoneyEntryEditor";
import { bagNoOf, bagNoOfPurchase } from "@/lib/diamondBags";

const ISSUE_ADMIN_ONLY = "Only an admin can change this";
const STOCK_ADMIN_ONLY = "Only an admin can change stock";

/** One thing this page did, whichever tab did it. */
interface Row {
  id: string;
  date: string;
  kind: "Purchase" | "Opening stock" | "Assigned to factory" | "Diamond sold";
  party: string;
  material: string;
  /** Its details under the material: a lot's size · colour · clarity · pcs, a stone's report, a grade. */
  detail?: string;
  /** The rate per unit in rupees, when the row is one material at one rate. */
  rate?: number;
  /** The materials on the row ("gold", "diamond", "mat_…") — what the Materials filter matches. */
  mats: string[];
  /** Whose stock it was. */
  co: string;
  qty: number;
  unit: MaterialUnit;
  amountInr?: number;
  remark?: string;
  /** A bill's own lines, when this row is a whole bill. */
  items?: { id: string; material: string; detail?: string; rate?: number; qty: number; unit: MaterialUnit; amountInr: number; discountPct?: number }[];
  billNo?: string;
  /** Set when the purchase was bought for one order rather than into stock. */
  forOrder?: string;
}

/**
 * What Buy & Assign has actually done, in one list.
 *
 * The four tabs each wrote somewhere different — a purchase, a stock movement,
 * a factory issuance, a diamond sale — so there was nowhere to look afterwards
 * and no way to check a day's entries against the books. This reads all four
 * back and shows them the way the payments tables do: searchable, filterable by
 * date and kind, and downloadable as exactly what is on screen.
 */
/** What the ledger adds up to, for the page's figure strip above it. */
export interface LedgerTotals { totalIn: number; nBought: number; totalOut: number; nSold: number; filtered: boolean }

export function StockActivityLedger({ onTotals }: { onTotals?: (t: LedgerTotals) => void } = {}) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("");
  const [material, setMaterial] = useState("");
  const [company, setCompany] = useState("");
  const [billFilter, setBillFilter] = useState("");
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingIssuance, setEditingIssuance] = useState<MaterialIssuance | null>(null);
  const [editingOpening, setEditingOpening] = useState<StockMovement | null>(null);
  const navigate = useNavigate();
  // Stock and what was issued to a factory are changed by an admin only — as
  // on the Stock page and the factory's page. The rules let any staff member
  // write these, so the menus here are the guard: Buy & Assign access alone
  // must not reach them (it never could cancel more than an assignment, and
  // that needed Buy & Assign → Delete).
  const isAdmin = user?.role === "admin";

  /**
   * Correcting a purchase from the ledger.
   *
   * This is where someone comes looking for a purchase, so this is where it has
   * to be fixable. Both actions go through the same guarded helpers the order
   * page uses — they carry the change through the supplier's due, the factory
   * issue, the stock trail and any certified packet, and refuse outright when
   * it can no longer be unwound cleanly.
   */
  const openEdit = (id: string) => {
    const p = (db.purchases ?? []).find(x => x.id === id);
    if (!p) return;
    const check = canEditPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    setEditing(p);
  };

  const saveEdit = async (edit: PurchaseEdit) => {
    if (!editing) return;
    try {
      await editPurchase(db, editing, edit, user!.id);
      toast.success("Purchase corrected — supplier due, factory issue and stock updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the correction.");
    }
  };

  /** Gold handed to a factory in bulk. It draws down real stock, so entering it
   *  twice or for the wrong factory leaves the stock short until it is undone. */
  const removeAssignment = async (id: string) => {
    if (!isAdmin) { toast.error(ISSUE_ADMIN_ONLY); return; }
    const mi = (db.materialIssuances ?? []).find(x => x.id === id);
    if (!mi) return;
    const check = canCancelIssuance(db, mi);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!(await confirmBox([
      `Cancel this assignment of ${mi.quantityIssued}${materialUnit(db.settings, mi.material)} ${mi.purityOrQuality}?`,
      "",
      ...issuanceVoidImpact(db, mi),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    setRemovingId(id);
    try {
      await deleteIssuance(db, mi, user!.id);
      toast.success("Assignment cancelled — material returned to stock");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this.");
    } finally { setRemovingId(null); }
  };

  /** A diamond sold straight out of stock — wrong buyer, wrong rate, or simply
   *  entered twice. Reverses the stone, the sale and the money together. */
  const removeSale = async (id: string) => {
    const sale = (db.diamondSales ?? []).find(x => x.id === id);
    if (!sale) return;
    const check = canVoidSale(db, sale);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!(await confirmBox([
      `Cancel this sale of ${sale.carat}ct ${sale.bucket || sale.shape}?`,
      "",
      ...saleVoidImpact(db, sale),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    setRemovingId(id);
    try {
      await voidDiamondSale(db, sale, user!.id);
      toast.success("Sale cancelled — stone, sale and money all reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel this sale.");
    } finally { setRemovingId(null); }
  };

  const remove = async (id: string) => {
    const p = (db.purchases ?? []).find(x => x.id === id);
    if (!p) return;
    const check = canVoidPurchase(db, p);
    if (!check.ok) { toast.error(check.reason!); return; }
    if (!(await confirmBox([
      `Remove this purchase of ${purchaseLabel(p)} (${fmtMoneyInr(p.totalInr)})?`,
      "",
      "What changes:",
      ...voidImpact(db, p),
      "",
      "This cannot be undone.",
    ].join("\n")))) return;
    setRemovingId(id);
    try {
      await voidPurchaseCascade(db, p, user!.id);
      toast.success("Purchase removed — supplier due, factory issue and stock all reversed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove this purchase.");
    } finally { setRemovingId(null); }
  };

  const all: Row[] = [];

  // EVERY material purchase, wherever it was entered — bought into stock here,
  // recorded on a supplier's page, or bought for one order. A purchase book is
  // checked bill by bill against all of them, so splitting them by the screen
  // they happened to be typed on made that impossible.
  //
  // A supplier's chitthi is ONE bill with a line per size, checked against its
  // own total, so lines saved together are shown as that bill rather than as
  // strangers. They stay separate purchases underneath: stock is per size.
  const bills = new Map<string, Row>();
  const packetOf = (purchaseId: string) => (db.diamondPackets ?? []).find(x => x.purchaseId === purchaseId);
  for (const p of db.purchases ?? []) {
    const label = p.material === "gold"
      ? `Gold ${p.gold?.purity ?? ""}`.trim()
      : p.material === "diamond"
      ? (p.diamond?.kind === "certified" ? "Certified diamond" : "Loose diamond")
      : `${materialName(db.settings, p.material)} ${p.other?.grade && p.other.grade !== "—" ? p.other.grade : ""}`.trim();
    const detail = p.material === "diamond"
      ? [bagNoOfPurchase(db, p), diamondSpec(p.diamond, p.diamond?.kind === "certified" ? packetOf(p.id) : undefined)].filter(Boolean).join(" · ") || undefined
      : p.material !== "gold" && p.other?.pieces ? `${p.other.pieces} pcs` : undefined;
    const rate = purchaseUnitInr(p);
    const qty = purchaseQty(p);
    const unit = materialUnit(db.settings, p.material);
    // A bill number groups a bill outright; without one, the lines written in
    // the same save share a supplier and the exact moment they were saved.
    const key = p.invoiceNumber?.trim()
      ? `${p.supplierId}|no:${p.invoiceNumber.trim()}`
      : `${p.supplierId}|at:${p.createdAt}`;
    const existing = bills.get(key);
    if (existing) {
      existing.items!.push({ id: p.id, material: label, detail, rate, qty, unit, amountInr: p.totalInr, discountPct: p.discountPct });
      existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
      existing.amountInr = (existing.amountInr ?? 0) + p.totalInr;
      if (!existing.mats.includes(p.material)) existing.mats.push(p.material);
      if (existing.unit !== unit) existing.unit = unit; // mixed bill — the count is shown per line
      continue;
    }
    const forOrder = p.orderId ? db.orders.find(o => o.id === p.orderId)?.orderNumber : undefined;
    bills.set(key, {
      id: p.id, date: p.createdAt, kind: "Purchase",
      forOrder,
      party: db.suppliers.find(s => s.id === p.supplierId)?.name ?? "Supplier",
      material: label, detail, rate, mats: [p.material], co: companyOf(p), qty, unit, amountInr: p.totalInr,
      billNo: p.invoiceNumber?.trim() || undefined,
      remark: p.notes || undefined,
      items: [{ id: p.id, material: label, detail, rate, qty, unit, amountInr: p.totalInr, discountPct: p.discountPct }],
    });
  }
  for (const b of bills.values()) {
    if (b.items && b.items.length > 1) {
      b.material = `${b.items.length} items`;
      // What the bill holds, at a glance; each line's own details open below.
      b.detail = [...new Set(b.items.map(it => it.material))].join(", ");
      b.rate = undefined;
    }
    all.push(b);
  }

  // Stock already owned, seeded at migration — the Opening Stock tab.
  for (const m of db.stockMovements ?? []) {
    if (m.refType !== "opening") continue;
    all.push({
      id: m.id, date: m.createdAt, kind: "Opening stock", party: "—",
      material: m.material === "diamond" ? "Loose diamond" : `${materialName(db.settings, m.material)} ${m.purityOrQuality}`.trim(),
      detail: m.material === "diamond"
        ? [bagNoOf(db, m.purityOrQuality), m.purityOrQuality, m.pieces ? `${m.pieces} pcs` : undefined].filter(Boolean).join(" · ")
        : m.pieces ? `${m.pieces} pcs` : undefined,
      rate: m.valueInr && m.quantity ? Math.round((m.valueInr / m.quantity) * 100) / 100 : undefined,
      mats: [m.material], co: companyOf(m),
      qty: m.quantity, unit: materialUnit(db.settings, m.material),
      amountInr: m.valueInr, remark: m.note,
    });
  }

  // Gold handed to a factory with no order behind it — the Assign Gold tab.
  for (const i of db.materialIssuances ?? []) {
    if (i.orderId || i.source !== "stock") continue;
    all.push({
      id: i.id, date: i.issuedAt, kind: "Assigned to factory",
      party: db.factories.find(f => f.id === i.factoryId)?.name ?? "Factory",
      material: `${materialName(db.settings, i.material)} ${i.purityOrQuality}`.trim(), mats: [i.material], co: companyOf(i),
      qty: i.quantityIssued, unit: materialUnit(db.settings, i.material),
      remark: i.notes,
    });
  }

  // Sold straight out of stock — the Sell Diamond tab.
  for (const s of db.diamondSales ?? []) {
    all.push({
      id: s.id, date: s.createdAt, kind: "Diamond sold",
      party: s.clientId ? (db.clients.find(c => c.id === s.clientId)?.companyName ?? "Client") : (s.buyerName ?? "Buyer"),
      material: s.kind === "certified" ? "Certified diamond" : "Loose diamond",
      detail: s.kind === "certified"
        ? diamondSpec({ shape: s.shape }, (db.diamondPackets ?? []).find(x => x.id === s.packetId))
        : [bagNoOf(db, s.bucket || s.shape), s.bucket || s.shape, s.pieces ? `${s.pieces} pcs` : undefined].filter(Boolean).join(" · "),
      rate: s.ratePerCarat || undefined,
      mats: ["diamond"], co: companyOf(s),
      qty: s.carat, unit: "ct", amountInr: s.totalInr, remark: s.notes,
    });
  }

  const ql = q.trim().toLowerCase();
  const rows = all
    .filter(r => {
      if (!inDateRange(r.date, from, to)) return false;
      if (kind && r.kind !== kind) return false;
      if (material && !r.mats.includes(material)) return false;
      if (company && r.co !== company) return false;
      // Purchases entered before the bill number was required — the ones that
      // still need tying back to a chitthi.
      if (billFilter === "none" && r.billNo) return false;
      return !ql || r.party.toLowerCase().includes(ql)
        || r.material.toLowerCase().includes(ql)
        || (r.detail ?? "").toLowerCase().includes(ql)
        || (r.billNo ?? "").toLowerCase().includes(ql)
        || (r.items ?? []).some(it => `${it.material} ${it.detail ?? ""}`.toLowerCase().includes(ql))
        || (r.remark ?? "").toLowerCase().includes(ql);
    })
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));

  const filtered = !!(ql || from || to || kind || material || billFilter || company);

  const totalIn = rows.filter(r => r.kind === "Purchase" || r.kind === "Opening stock").reduce((s, r) => s + (r.amountInr ?? 0), 0);
  const totalOut = rows.filter(r => r.kind === "Diamond sold").reduce((s, r) => s + (r.amountInr ?? 0), 0);
  const nBought = rows.filter(r => r.kind === "Purchase" || r.kind === "Opening stock").length;
  const nSold = rows.filter(r => r.kind === "Diamond sold").length;
  // The totals show in the page's figure strip, beside the month's — handed up
  // whenever the rows (or the filters on them) change.
  useEffect(() => {
    onTotals?.({ totalIn, nBought, totalOut, nSold, filtered });
  }, [onTotals, totalIn, nBought, totalOut, nSold, filtered]);

  const HEAD = ["Sr", "Date", "Entry", "Bill no.", "Party", "Material", "Details", "Quantity", "Unit", "Rate (INR)", "Amount (INR)", "Remark"];
  const body: (string | number)[][] = [];
  rows.forEach((r, i) => {
    body.push([i + 1, fmtDate(r.date), r.kind, r.billNo ?? "", r.party, r.material, r.detail ?? "", r.qty, r.unit, r.rate ?? "", r.amountInr ?? "", r.remark ?? ""]);
    // A bill's own lines follow it, so a download can be checked against the
    // chitthi a line at a time and not only on the total.
    if (r.items && r.items.length > 1) {
      for (const it of r.items) {
        body.push(["", "", "  item", "", "", it.material, it.detail ?? "", it.qty, it.unit, it.rate ?? "", it.amountInr, it.discountPct ? discountLabel(it.discountPct) : ""]);
      }
    }
  });

  const exportCsv = () => downloadCsv("Stock-Activity", HEAD, body);

  const exportPdf = () => downloadLedgerPdf({
    title: "Buy & Assign — Activity",
    subjectLines: [
      `${rows.length} entr${rows.length !== 1 ? "ies" : "y"} · ${rangeLabel(from, to)}`,
      [kind && `Entry: ${kind}`, material && `Material: ${material}`, ql && `Search: "${q.trim()}"`]
        .filter(Boolean).join(" · ") || "All entries",
      `Report Generated: ${new Date().toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Bought in", value: fmtMoneyInr(totalIn) },
      { label: "Sold", value: fmtMoneyInr(totalOut) },
    ],
    landscape: true,
    columns: [
      { header: "Sr", x: 14 }, { header: "Date", x: 26 }, { header: "Entry", x: 56 },
      { header: "Bill no.", x: 100 }, { header: "Party", x: 128 }, { header: "Material", x: 172 },
      { header: "Qty", x: 218 }, { header: "Amount", x: 242 }, { header: "Remark", x: 268 },
    ],
    align: ["left", "left", "left", "left", "left", "left", "right", "right", "left"],
    rows: rows.map((r, i) => [
      String(i + 1), fmtDate(r.date), r.kind, (r.billNo ?? "").slice(0, 16),
      r.party.slice(0, 26), (r.detail ? `${r.material} · ${r.detail}` : r.material).slice(0, 26),
      `${r.qty}${r.unit}`, r.amountInr != null ? fmtMoneyInr(r.amountInr) : "",
      (r.remark ?? "").slice(0, 16),
    ]),
    filename: "Stock-Activity",
  });

  type Item = NonNullable<Row["items"]>[number];
  // Every action is offered; one that can't be done — not allowed, already
  // paid, already used — is greyed out with the reason, never left out and
  // never refused only after the click.
  const mayEdit = can("buyAssign", "edit"), mayDelete = can("buyAssign", "delete");
  // Why a pool delivery / opening stock may not be changed by this person.
  const issueDenied = !isAdmin ? ISSUE_ADMIN_ONLY : undefined;
  const stockDenied = !isAdmin ? STOCK_ADMIN_ONLY : undefined;
  const viewAction = (label: string, hint: string, to: string, module: Parameters<typeof needsAccess>[0]): MoreAction => ({
    label, icon: ExternalLink, disabled: !can(module), hint: can(module) ? hint : needsAccess(module, "view"), onSelect: () => navigate(to),
  });
  /** Correcting or removing one purchase — a single-line bill, or one line of a bigger one. */
  const purchaseActions = (id: string, what: "purchase" | "item"): MoreAction[] => {
    const p = (db.purchases ?? []).find(x => x.id === id);
    if (!p) return [];
    const edit = canEditPurchase(db, p);
    const scope = purchaseEditScope(db, p);
    const voidable = canVoidPurchase(db, p);
    return [
      ...(what === "purchase" ? [viewAction("View purchase", db.suppliers.find(x => x.id === p.supplierId)?.name ?? "The supplier's page", `/suppliers/${p.supplierId}`, "suppliers")] : []),
      { label: `Edit ${what}`, icon: Pencil, onSelect: () => openEdit(id), disabled: !mayEdit || !edit.ok,
        hint: !mayEdit ? needsAccess("buyAssign", "edit") : !edit.ok ? oneLine(edit.reason) : !scope.quantity ? oneLine(scope.reason) : undefined },
      { label: `Remove ${what}`, icon: Trash2, danger: true, onSelect: () => remove(id), disabled: !mayDelete || removingId === id || !voidable.ok,
        hint: !mayDelete ? needsAccess("buyAssign", "delete") : !voidable.ok ? oneLine(voidable.reason) : "Undoes due, stock and factory issue" },
    ];
  };
  const actionsFor = (r: Row): MoreAction[] => {
    if (r.kind === "Assigned to factory") {
      const mi = (db.materialIssuances ?? []).find(x => x.id === r.id);
      if (!mi) return [];
      const edit = canEditIssuance(db, mi);
      const cancel = canCancelIssuance(db, mi);
      return [
        viewAction("View factory", r.party, `/factories/${mi.factoryId}`, "factories"),
        { label: "Edit assignment", icon: Pencil, onSelect: () => setEditingIssuance(mi), disabled: !!issueDenied || !edit.ok,
          hint: issueDenied ?? (!edit.ok ? oneLine(edit.reason) : "Stock moves by the difference") },
        { label: "Cancel assignment", icon: Trash2, danger: true, onSelect: () => removeAssignment(r.id), disabled: !!issueDenied || removingId === r.id || !cancel.ok,
          hint: issueDenied ?? (!cancel.ok ? oneLine(cancel.reason) : "Material goes back to stock") },
      ];
    }
    if (r.kind === "Diamond sold") {
      const sale = (db.diamondSales ?? []).find(x => x.id === r.id);
      if (!sale) return [];
      const voidable = canVoidSale(db, sale);
      return [
        ...(sale.clientId ? [viewAction("View client", r.party, `/clients/${sale.clientId}`, "clients")] : []),
        // A sale moves a stone, a buyer and money at once; correcting one of
        // them alone is how they fall out of step.
        { label: "Edit", icon: Pencil, disabled: true, onSelect: () => {}, hint: "Cancel and re-enter the sale" },
        { label: "Cancel sale", icon: Trash2, danger: true, onSelect: () => removeSale(r.id), disabled: !mayDelete || removingId === r.id || !voidable.ok,
          hint: !mayDelete ? needsAccess("buyAssign", "delete") : !voidable.ok ? oneLine(voidable.reason) : "Undoes stone, sale and money" },
      ];
    }
    if (r.kind === "Opening stock") {
      const m = (db.stockMovements ?? []).find(x => x.id === r.id);
      if (!m) return [];
      return [
        viewAction("View in Stock", "Its stock ledger", `/stock/${m.material}`, "stock"),
        ...openingStockActions(db, m, {
          onEdit: () => setEditingOpening(m),
          editDenied: stockDenied,
          deleteDenied: stockDenied,
        }),
      ];
    }
    // A bill of several lines is corrected line by line, since each line is its
    // own purchase with its own supplier due and factory issue — so its actions
    // sit on the lines, which open below.
    if ((r.items?.length ?? 0) > 1) return [
      { label: "Edit each item", hint: "Open the bill to edit lines", disabled: true, onSelect: () => {} },
    ];
    return purchaseActions(r.items![0].id, "purchase");
  };

  const TONE: Record<Row["kind"], "blue" | "neutral" | "amber" | "green"> = {
    "Purchase": "blue", "Opening stock": "neutral", "Assigned to factory": "amber", "Diamond sold": "green",
  };
  const columns: DataColumn<Row>[] = [
    { key: "party", header: "Party", always: true, sortValue: r => r.party,
      cell: r => <div title={r.party} className="max-w-[160px]"><CellMain title={r.party} sub={r.forOrder ? `for ${r.forOrder}` : undefined} /></div> },
    { key: "entry", header: "Entry", sortValue: r => r.kind, cell: r => <CellTag tone={TONE[r.kind]}>{r.kind}</CellTag> },
    { key: "date", header: "Date", kind: "date", sortValue: r => +new Date(r.date), csv: r => fmtDate(r.date),
      cell: r => <CellDate>{fmtDate(r.date)}</CellDate> },
    { key: "bill", header: "Bill no.", sortValue: r => r.billNo ?? "",
      cell: r => r.billNo
        ? <button type="button" onClick={() => setQ(r.billNo!)}
            title="Show everything on this bill" className="font-mono text-[11px] text-primary hover:underline whitespace-nowrap">
            {r.billNo}
          </button>
        : <span className="font-mono text-[11px] text-muted-foreground">—</span> },
    { key: "material", header: "Material", sortValue: r => r.material, csv: r => (r.detail ? `${r.material} · ${r.detail}` : r.material),
      cell: r => <div className="max-w-[240px]" title={r.detail ? `${r.material} · ${r.detail}` : r.material}><CellMain title={r.material} sub={r.detail} /></div> },
    { key: "qty", header: "Quantity", align: "right", kind: "number", sortValue: r => r.qty,
      cell: r => <span className="font-medium tabular-nums whitespace-nowrap">{r.qty}{r.unit}</span> },
    { key: "rate", header: "Rate", align: "right", kind: "number", sortValue: r => r.rate ?? 0, csv: r => r.rate ?? "",
      cell: r => (r.rate != null ? <span className="text-xs tabular-nums whitespace-nowrap">{fmtMoneyInr(r.rate)}/{r.unit}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: r => r.amountInr,
      cell: r => (r.amountInr != null ? <CellAmount>{fmtMoneyInr(r.amountInr)}</CellAmount> : <span className="text-muted-foreground">—</span>) },
    { key: "remark", header: "Remark", sortValue: r => r.remark ?? "",
      cell: r => <span className="block text-xs text-muted-foreground max-w-[160px] truncate" title={r.remark ?? ""}>{r.remark ?? "—"}</span> },
  ];
  // A bill's own lines, so the chitthi can be checked a line at a time as well
  // as on the total — and each line corrected on its own.
  const lineColumns: DataColumn<Item>[] = [
    { key: "material", header: "Item", always: true, sortValue: it => it.material,
      cell: it => <CellMain title={it.material} sub={[it.detail, it.discountPct ? discountLabel(it.discountPct) : undefined].filter(Boolean).join(" · ") || undefined} /> },
    { key: "qty", header: "Quantity", align: "right", kind: "number", sortValue: it => it.qty,
      cell: it => <span className="tabular-nums whitespace-nowrap">{it.qty}{it.unit}</span> },
    { key: "rate", header: "Rate", align: "right", kind: "number", sortValue: it => it.rate ?? 0,
      cell: it => (it.rate != null ? <span className="text-xs tabular-nums whitespace-nowrap">{fmtMoneyInr(it.rate)}/{it.unit}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "amount", header: "Amount", align: "right", kind: "number", sortValue: it => it.amountInr,
      cell: it => <CellAmount>{fmtMoneyInr(it.amountInr)}</CellAmount> },
  ];

  return (
    <div className="card-luxe p-5">
      <SectionTitle className="mb-4" title="Purchase & stock ledger" />

      {/* Search, filters and downloads sit in the table's own toolbar. What
          was bought in and sold shows in the page's figure strip when the page
          asks for it (onTotals), else under the toolbar. A new filter
          (resetKey) starts it again from the first page. */}
      <DataTable
        summary={!onTotals && (totalIn > 0 || totalOut > 0) ? (
          <StatStrip items={[
            ...(totalIn > 0 ? [{ label: "Bought in", value: fmtMoneyInr(totalIn), icon: ShoppingCart, sub: `${nBought} ${nBought === 1 ? "entry" : "entries"}` }] : []),
            ...(totalOut > 0 ? [{ label: "Sold", value: fmtMoneyInr(totalOut), tone: "in" as const, icon: Gem, sub: `${nSold} ${nSold === 1 ? "sale" : "sales"}` }] : []),
          ]} note={filtered ? `For what the filters show${from || to ? ` · ${rangeLabel(from, to)}` : ""}` : undefined} />
        ) : undefined}
        {...ledgerTable({
          q, onQ: setQ, placeholder: "Search bill no., party, material, remark…",
          from, to, onFrom: setFrom, onTo: setTo,
          selects: [
            { label: "Entry", value: kind, onChange: setKind,
              options: ["Purchase", "Opening stock", "Assigned to factory", "Diamond sold"].map(k => ({ value: k, label: k })) },
            { label: "Material", value: material, onChange: setMaterial,
              options: [{ value: "gold", label: "Gold" }, { value: "diamond", label: "Diamond" },
                ...materialDefs(db.settings).map(m => ({ value: m.id, label: m.name }))] },
            { label: "Bill", value: billFilter, onChange: setBillFilter, allLabel: "Any bill",
              options: [{ value: "none", label: "No bill number" }] },
            ...(hasCompanies(db.settings) ? [{ label: "Company", value: company, onChange: setCompany,
              options: companiesOf(db.settings).map(c => ({ value: c.id, label: c.name })) }] : []),
          ],
          onPdf: exportPdf, onCsv: exportCsv,
        })}
        resetKey={JSON.stringify([ql, from, to, kind, material, billFilter, company])}
        id="stock-activity"
        noun="record"
        rows={rows}
        columns={columns}
        rowKey={r => r.id}
        defaultSort={{ key: "date", dir: "desc" }}
        emptyText={filtered ? "Nothing matches these filters." : "Nothing bought, assigned or sold yet."}
        rowActions={actionsFor}
        expand={{
          can: r => (r.items?.length ?? 0) > 1,
          render: r => (
            <DataTable
              id="stock-activity-bill-lines"
              controls="none"
              rows={r.items!}
              columns={lineColumns}
              rowKey={it => it.id}
              rowActions={it => purchaseActions(it.id, "item")}
            />
          ),
        }}
      />

      <EditPurchaseDialog
        purchase={editing}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        // Material already made into a piece keeps its weight; the rate can still move.
        lockQuantity={!!editing && !purchaseEditScope(db, editing).quantity}
        lockNote={editing ? purchaseEditScope(db, editing).reason : undefined}
      />
      <IssuanceEditSheet issuance={editingIssuance} onClose={() => setEditingIssuance(null)} />
      <OpeningStockEditSheet movement={editingOpening} onClose={() => setEditingOpening(null)} />
    </div>
  );
}
