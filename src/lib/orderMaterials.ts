// What went into an order, line by line — the order page's "Material for this
// order" table and the order's download (lib/orderExport.ts) read the same lines.
//
// A repair is ONE line of its own, under the piece's lines: the gold added or
// taken out, the stones, the labour and the factory's repair bill number
// together. It is never folded into the piece's own gold line — that line is the
// piece as first finished (lib/rework.ts finishRecordOf), and stays as it was.
import type { DB, MaterialIssuance, Order, Purchase } from "./db";
import { fmtDate } from "./db";
import { bagNoOf, bagNoOfPurchase } from "./diamondBags";
import { fmtMoneyInr, issuancePending, issuanceUsed, purchasePending } from "./manufacturing";
import { diamondSpec, fmtQty, isOtherMaterial, materialName, materialUnit, purchaseQty, type MaterialKey } from "./materials";
import { finishRecordOf, isReworkIssue } from "./rework";

export interface MaterialLine {
  id: string;
  href: string;
  gold: boolean;
  title: string;
  detail?: string;
  qty: string;
  /** Stones (or pieces) — beside the carats, not lost in the detail line. */
  pcs?: number;
  source: string;
  sourceSub?: string;
  costInr?: number;
  dueInr: number;
  labourDueInr: number;
  status: string;
  tone: "blue" | "green" | "amber" | "neutral";
  /** What the line is, for the page's actions. */
  purchase?: Purchase;
  issuance?: MaterialIssuance;
  repair?: { key: string; at: string; billNo?: string; issues: MaterialIssuance[] };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const signed = (n: number, unit: string) => `${n > 0 ? "+" : "−"}${r3(Math.abs(n))}${unit}`;

/** An order's issues that belong to its repairs: every repair record but the one
 *  that carries the piece's finish (older repairs overwrote it), and the gold a
 *  repair took out (kept at the factory, so not on the order itself). */
export function repairIssuesOf(db: Pick<DB, "materialIssuances">, order: Pick<Order, "id">): MaterialIssuance[] {
  const own = db.materialIssuances.filter(i => i.orderId === order.id);
  const finish = finishRecordOf(own, order.id);
  return [
    ...own.filter(i => isReworkIssue(i) && i.id !== finish?.id),
    ...db.materialIssuances.filter(i => !i.orderId && i.rework?.orderId === order.id),
  ];
}

export function orderMaterialLines(db: DB, order: Order, faDone: boolean): MaterialLine[] {
  const linkedPurchases = db.purchases.filter(p => p.orderId === order.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const linkedIssuances = db.materialIssuances.filter(i => i.orderId === order.id).sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
  const repairs = repairIssuesOf(db, order);
  const repairIds = new Set(repairs.map(i => i.id));

  const supplierText = (p: Purchase) => `${db.suppliers.find(s => s.id === p.supplierId)?.name || "Supplier"}${p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}`;
  const brokerText = (p: Purchase) => {
    const br = p.brokerId ? (db.brokers ?? []).find(x => x.id === p.brokerId) : undefined;
    return br && p.brokerageInr ? `brokerage ${fmtMoneyInr(p.brokerageInr)} to ${br.name}${p.brokeragePaidBy === "supplier" ? " (supplier pays)" : ""}` : undefined;
  };
  const kindTitle = (material: string, kind: string | undefined, grade: string) =>
    material === "gold" ? `Gold ${grade}`.trim()
    : material === "diamond" ? (kind === "certified" ? "Certified diamond" : "Loose diamond")
    : materialName(db.settings, material as MaterialKey);

  const lines: MaterialLine[] = [];
  // Purchases not yet shown as an issue below — a bought diamond is one row, not two.
  for (const p of linkedPurchases.filter(x => !linkedIssuances.some(i => i.sourcePurchaseId === x.id))) {
    lines.push({
      id: p.id, href: `/suppliers/${p.supplierId}`, gold: p.material === "gold",
      title: kindTitle(p.material, p.diamond?.kind, p.gold?.purity ?? ""),
      detail: p.material === "diamond" ? [bagNoOfPurchase(db, p), diamondSpec(p.diamond && { ...p.diamond, pieces: undefined }, (db.diamondPackets ?? []).find(x => x.purchaseId === p.id))].filter(Boolean).join(" · ") || undefined
        : isOtherMaterial(p.material) && p.other?.grade && p.other.grade !== "—" ? p.other.grade : undefined,
      qty: fmtQty(purchaseQty(p), materialUnit(db.settings, p.material)),
      pcs: p.material === "diamond" ? (p.diamond?.kind === "certified" ? 1 : p.diamond?.pieces) : materialUnit(db.settings, p.material) === "pcs" ? undefined : p.other?.pieces,
      source: supplierText(p), sourceSub: brokerText(p),
      costInr: p.totalInr, dueInr: purchasePending(p), labourDueInr: 0,
      status: "Bought", tone: "neutral", purchase: p,
    });
  }
  for (const mi of linkedIssuances) {
    if (repairIds.has(mi.id)) continue;
    const unit = materialUnit(db.settings, mi.material);
    const used = issuanceUsed(mi);
    const packs = mi.diamondKind === "certified" ? (db.diamondPackets ?? []).filter(x => mi.diamondPacketIds?.includes(x.id)) : [];
    const srcPurchase = mi.source === "purchase" && mi.sourcePurchaseId ? linkedPurchases.find(x => x.id === mi.sourcePurchaseId) : undefined;
    const factory = db.factories.find(f => f.id === mi.factoryId);
    const spec = mi.diamondSpec;
    const lot = mi.material === "diamond" && mi.diamondKind !== "certified" ? mi.purityOrQuality : "";
    const detail = mi.diamondKind === "certified"
      ? packs.map(x => [x.shape, `${x.carat}ct`, x.color, x.clarity, `${x.certificateLab || "Cert"} ${x.certificateNumber}`].filter(Boolean).join(" · ")).join("; ")
      : mi.material === "diamond"
      ? [bagNoOf(db, lot), lot, spec?.type && !lot.includes(spec.type) ? spec.type : undefined,
          spec?.mm && !lot.includes(spec.mm) ? (/mm$/i.test(spec.mm) ? spec.mm : `${spec.mm} mm`) : undefined, spec?.size && !lot.includes(spec.size) ? spec.size : undefined,
          spec?.color && !lot.includes(spec.color) ? spec.color : undefined, spec?.clarity && !lot.includes(spec.clarity) ? spec.clarity : undefined,
          spec?.ratePerCaratInr ? `${fmtMoneyInr(spec.ratePerCaratInr)}/ct` : undefined].filter(Boolean).join(" · ")
      : isOtherMaterial(mi.material) ? mi.purityOrQuality : undefined;
    // After Final Approval a stone was either set in the piece or went back to stock.
    const returnedCt = mi.finishReturnedCt ?? 0;
    const [status, tone]: [string, MaterialLine["tone"]] = faDone && mi.material === "diamond"
      ? (mi.diamondKind !== "certified" && returnedCt > 0
          ? [`${r3(mi.quantityIssued - returnedCt)} ct used · ${returnedCt} ct back`, "amber"]
          : mi.finishDisposition === "returned" ? [mi.source === "client" ? "Back to the client" : "Back to stock", "amber"] : ["Used in piece", "green"])
      : mi.status === "open" ? ["In progress", "blue"] : ["Closed", "green"];
    lines.push({
      // Stones a diamond-only order sold straight from stock have no factory: the row opens the bags.
      id: mi.id, href: mi.factoryId ? `/factories/${mi.factoryId}` : "/stock/diamond", gold: mi.material === "gold",
      title: mi.diamondKind === "certified" && packs.length > 1 ? `${packs.length} certified diamonds` : kindTitle(mi.material, mi.diamondKind, mi.purityOrQuality),
      detail: detail || undefined,
      // What was issued, until some of it is used; then "1.2 ct of 1.58 ct". ("0ct of 1.58ct"
      // before Final Approval read as "Oct of 1.58ct".)
      qty: mi.status === "open" && used <= 0.0005 ? fmtQty(mi.quantityIssued, unit)
        : `${fmtQty(used, unit)}${Math.abs(used - mi.quantityIssued) > 0.001 ? ` of ${fmtQty(mi.quantityIssued, unit)}` : ""}`,
      // Loose: the stones issued, less any counted back at Final Approval; certified: the stones.
      pcs: mi.diamondKind === "certified" ? (packs.length || undefined)
        : mi.piecesIssued ? Math.max(0, mi.piecesIssued - (mi.finishReturnedPcs ?? 0)) : undefined,
      source: srcPurchase ? supplierText(srcPurchase) : mi.source === "stock" ? "Our stock" : mi.source === "factoryPool" ? "Factory's holding" : mi.source === "melt" ? "Melted piece" : mi.source === "transfer" ? "Transfer" : mi.source === "client" ? "Client's own" : "—",
      sourceSub: [srcPurchase ? brokerText(srcPurchase) : undefined, mi.factoryId ? `to ${factory?.name || "factory"}` : "sold with the order"].filter(Boolean).join(" · "),
      costInr: srcPurchase?.totalInr ?? spec?.amountInr, dueInr: srcPurchase ? purchasePending(srcPurchase) : 0, labourDueInr: issuancePending(mi),
      status, tone, purchase: srcPurchase, issuance: mi,
    });
  }

  // ── Each repair: one line, oldest first, under the piece's own lines ──
  // One repair's records share its key; older ones (before keys) share the moment they were saved.
  const groups = new Map<string, MaterialIssuance[]>();
  for (const mi of repairs) {
    const k = mi.rework?.key ?? `at:${mi.issuedAt}`;
    groups.set(k, [...(groups.get(k) ?? []), mi]);
  }
  const repairLines = [...groups.entries()].map(([key, issues]) => {
    const at = issues[0].rework?.at ?? issues[0].issuedAt;
    const billNo = issues.find(i => i.rework?.billNo)?.rework?.billNo;
    const factory = db.factories.find(f => f.id === issues[0].factoryId);
    // What the repair did, as it was written down when it was saved — it names
    // stones taken out too, which go back into their bag without an issue.
    const log = (order.manufacturingLog ?? []).find(l => l.at === at && /^Rework/.test(l.remarks ?? ""));
    const said = log?.remarks?.includes(" — ") ? log.remarks.slice(log.remarks.indexOf(" — ") + 3) : undefined;
    const parts: string[] = [];
    let goldG = 0, diaCt = 0, pcs = 0;
    for (const mi of issues) {
      if (!(mi.quantityIssued > 0)) continue; // the labour line
      if (mi.material === "gold") {
        const out = mi.source === "rework";
        goldG += out ? -mi.quantityIssued : mi.quantityIssued;
        parts.push(out ? `−${mi.quantityIssued}g ${mi.purityOrQuality} taken out (kept by the factory)`
          : `+${mi.quantityIssued}g ${mi.purityOrQuality} from ${mi.source === "stock" ? "our stock" : "the factory's holding"}`);
      } else if (mi.material === "diamond") {
        diaCt += mi.quantityIssued; pcs += mi.piecesIssued ?? 0;
        parts.push(`+${mi.quantityIssued}ct ${[bagNoOf(db, mi.purityOrQuality), mi.purityOrQuality].filter(Boolean).join(" · ")}${mi.piecesIssued ? ` · ${mi.piecesIssued} pcs` : ""}`);
      } else {
        parts.push(`+${mi.quantityIssued} ${materialName(db.settings, mi.material)}`);
      }
    }
    const labour = issues.reduce((s, i) => s + (i.makingCharges?.amountInr ?? 0), 0);
    const qty = [goldG ? signed(goldG, "g") : "", diaCt ? signed(diaCt, "ct") : ""].filter(Boolean).join(" · ");
    return {
      id: `repair:${key}`, href: issues[0].factoryId ? `/factories/${issues[0].factoryId}` : "/factories", gold: true,
      title: `Repair${billNo ? ` · bill ${billNo}` : ""}`,
      detail: said ?? (parts.join(" · ") || "Labour only"),
      qty: qty || "Labour only",
      pcs: pcs || undefined,
      source: factory?.name || "Factory", sourceSub: fmtDate(at),
      costInr: labour || undefined, dueInr: 0, labourDueInr: issues.reduce((s, i) => s + issuancePending(i), 0),
      status: "Repair", tone: "amber" as const,
      repair: { key, at, billNo, issues },
    };
  }).sort((a, b) => +new Date(a.repair.at) - +new Date(b.repair.at));
  return [...lines, ...repairLines];
}
