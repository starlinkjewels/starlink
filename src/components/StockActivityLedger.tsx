import { Fragment, useState } from "react";
import { useDb } from "@/hooks/useDb";
import { fmtDate } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { ChevronRight } from "lucide-react";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";

const PAGE = 12;

/** One thing this page did, whichever tab did it. */
interface Row {
  id: string;
  date: string;
  kind: "Purchase" | "Opening stock" | "Assigned to factory" | "Diamond sold";
  party: string;
  material: string;
  qty: number;
  unit: "g" | "ct";
  amountInr?: number;
  remark?: string;
  /** A bill's own lines, when this row is a whole bill. */
  items?: { material: string; qty: number; unit: "g" | "ct"; amountInr: number; discountPct?: number }[];
  billNo?: string;
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
export function StockActivityLedger() {
  const db = useDb();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("");
  const [material, setMaterial] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const all: Row[] = [];

  // Bought into stock — the Buy Material tab. A supplier's chitthi is ONE bill
  // with a line per size, and it is checked against its own total, so the lines
  // saved together in one go are shown as that bill rather than as strangers.
  // They stay separate purchases underneath, because stock is counted per size.
  const bills = new Map<string, Row>();
  for (const p of db.purchases ?? []) {
    if (p.purpose !== "stock") continue;
    const isGold = p.material === "gold";
    const label = isGold
      ? `Gold ${p.gold?.purity ?? ""}`.trim()
      : `${p.diamond?.shape ?? "Diamond"}${p.diamond?.kind === "certified" ? " (certified)" : ""}`;
    const qty = isGold ? (p.gold?.weightGrams ?? 0) : (p.diamond?.carat ?? 0);
    const unit: "g" | "ct" = isGold ? "g" : "ct";
    // A bill number groups a bill outright; without one, the lines written in
    // the same save share a supplier and the exact moment they were saved.
    const key = p.invoiceNumber?.trim()
      ? `${p.supplierId}|no:${p.invoiceNumber.trim()}`
      : `${p.supplierId}|at:${p.createdAt}`;
    const existing = bills.get(key);
    if (existing) {
      existing.items!.push({ material: label, qty, unit, amountInr: p.totalInr, discountPct: p.discountPct });
      existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
      existing.amountInr = (existing.amountInr ?? 0) + p.totalInr;
      if (existing.unit !== unit) existing.unit = unit; // mixed bill — the count is shown per line
      continue;
    }
    bills.set(key, {
      id: p.id, date: p.createdAt, kind: "Purchase",
      party: db.suppliers.find(s => s.id === p.supplierId)?.name ?? "Supplier",
      material: label, qty, unit, amountInr: p.totalInr,
      billNo: p.invoiceNumber?.trim() || undefined,
      remark: p.notes || undefined,
      items: [{ material: label, qty, unit, amountInr: p.totalInr, discountPct: p.discountPct }],
    });
  }
  for (const b of bills.values()) {
    if (b.items && b.items.length > 1) b.material = `${b.items.length} items`;
    all.push(b);
  }

  // Stock already owned, seeded at migration — the Opening Stock tab.
  for (const m of db.stockMovements ?? []) {
    if (m.refType !== "opening") continue;
    all.push({
      id: m.id, date: m.createdAt, kind: "Opening stock", party: "—",
      material: `${m.material === "gold" ? "Gold" : "Diamond"} ${m.purityOrQuality}`.trim(),
      qty: m.quantity, unit: m.material === "gold" ? "g" : "ct",
      amountInr: m.valueInr, remark: m.note,
    });
  }

  // Gold handed to a factory with no order behind it — the Assign Gold tab.
  for (const i of db.materialIssuances ?? []) {
    if (i.orderId || i.source !== "stock") continue;
    all.push({
      id: i.id, date: i.issuedAt, kind: "Assigned to factory",
      party: db.factories.find(f => f.id === i.factoryId)?.name ?? "Factory",
      material: `${i.material === "gold" ? "Gold" : "Diamond"} ${i.purityOrQuality}`.trim(),
      qty: i.quantityIssued, unit: i.material === "gold" ? "g" : "ct",
      remark: i.notes,
    });
  }

  // Sold straight out of stock — the Sell Diamond tab.
  for (const s of db.diamondSales ?? []) {
    all.push({
      id: s.id, date: s.createdAt, kind: "Diamond sold",
      party: s.clientId ? (db.clients.find(c => c.id === s.clientId)?.companyName ?? "Client") : (s.buyerName ?? "Buyer"),
      material: `${s.shape}${s.kind === "certified" ? " (certified)" : ""}`,
      qty: s.carat, unit: "ct", amountInr: s.totalInr, remark: s.notes,
    });
  }

  const ql = q.trim().toLowerCase();
  const rows = all
    .filter(r => {
      if (!inDateRange(r.date, from, to)) return false;
      if (kind && r.kind !== kind) return false;
      if (material && !r.material.toLowerCase().startsWith(material.toLowerCase())) return false;
      return !ql || r.party.toLowerCase().includes(ql)
        || r.material.toLowerCase().includes(ql)
        || (r.billNo ?? "").toLowerCase().includes(ql)
        || (r.items ?? []).some(it => it.material.toLowerCase().includes(ql))
        || (r.remark ?? "").toLowerCase().includes(ql);
    })
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));

  const filtered = !!(ql || from || to || kind || material);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setKind(""); setMaterial(""); setPage(1); };
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE, "act");

  const totalIn = rows.filter(r => r.kind === "Purchase" || r.kind === "Opening stock").reduce((s, r) => s + (r.amountInr ?? 0), 0);
  const totalOut = rows.filter(r => r.kind === "Diamond sold").reduce((s, r) => s + (r.amountInr ?? 0), 0);

  const HEAD = ["Sr", "Date", "Entry", "Bill no.", "Party", "Material", "Quantity", "Unit", "Amount (INR)", "Remark"];
  const body: (string | number)[][] = [];
  rows.forEach((r, i) => {
    body.push([i + 1, fmtDate(r.date), r.kind, r.billNo ?? "", r.party, r.material, r.qty, r.unit, r.amountInr ?? "", r.remark ?? ""]);
    // A bill's own lines follow it, so a download can be checked against the
    // chitthi a line at a time and not only on the total.
    if (r.items && r.items.length > 1) {
      for (const it of r.items) {
        body.push(["", "", "  item", "", "", it.material, it.qty, it.unit, it.amountInr, it.discountPct ? `less ${it.discountPct}%` : ""]);
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
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
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
      r.party.slice(0, 26), r.material.slice(0, 26),
      `${r.qty}${r.unit}`, r.amountInr != null ? fmtMoneyInr(r.amountInr) : "",
      (r.remark ?? "").slice(0, 16),
    ]),
    filename: "Stock-Activity",
  });

  return (
    <div className="card-luxe p-5">
      <div className="mb-3">
        <p className="font-display text-lg text-brand-dark leading-tight">Activity</p>
        <p className="text-xs text-muted-foreground">
          {rows.length} entr{rows.length !== 1 ? "ies" : "y"}{filtered ? ` of ${all.length}` : ""}
          {totalIn > 0 && <> · bought in {fmtMoneyInr(totalIn)}</>}
          {totalOut > 0 && <> · sold {fmtMoneyInr(totalOut)}</>}
          {(from || to) && <> · {rangeLabel(from, to)}</>}
        </p>
      </div>

      <LedgerFilters
        q={q} onQ={v => { setQ(v); setPage(1); }}
        placeholder="Search party, material, remark…"
        from={from} to={to}
        onFrom={v => { setFrom(v); setPage(1); }} onTo={v => { setTo(v); setPage(1); }}
        selects={[
          { label: "Entries", value: kind, onChange: v => { setKind(v); setPage(1); },
            options: ["Purchase", "Opening stock", "Assigned to factory", "Diamond sold"].map(k => ({ value: k, label: k })) },
          { label: "Materials", value: material, onChange: v => { setMaterial(v); setPage(1); },
            options: [{ value: "Gold", label: "Gold" }, { value: "Diamond", label: "Diamond" }] },
        ]}
        active={filtered} onReset={reset}
        onPdf={exportPdf} onCsv={exportCsv}
      />

      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5">Sr</th>
              <th className="text-left px-3 py-2.5">Date</th>
              <th className="text-left px-3 py-2.5">Entry</th>
              <th className="text-left px-3 py-2.5">Bill no.</th>
              <th className="text-left px-3 py-2.5">Party</th>
              <th className="text-left px-3 py-2.5">Material</th>
              <th className="text-right px-3 py-2.5">Quantity</th>
              <th className="text-right px-3 py-2.5">Amount</th>
              <th className="text-left px-5 py-2.5">Remark</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                {filtered ? "Nothing matches these filters." : "Nothing bought, assigned or sold yet."}
              </td></tr>
            ) : paged.map((r, i) => {
              // A bill of several sizes opens to show its own lines, so the
              // chitthi can be checked a line at a time as well as on the total.
              const multi = (r.items?.length ?? 0) > 1;
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={`border-t border-border/40 hover:bg-secondary/30 ${multi ? "cursor-pointer" : ""}`}
                    onClick={multi ? () => setOpen(isOpen ? null : r.id) : undefined}>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">{(page - 1) * PAGE + i + 1}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.kind}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{r.billNo ?? "—"}</td>
                    <td className="px-3 py-2.5 font-medium max-w-[160px] truncate" title={r.party}>{r.party}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.material}>
                      {multi && <ChevronRight className={`inline h-3 w-3 mr-1 transition-transform ${isOpen ? "rotate-90" : ""}`} />}
                      {r.material}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{r.qty}{r.unit}</td>
                    <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{r.amountInr != null ? fmtMoneyInr(r.amountInr) : "—"}</td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.remark ?? ""}>{r.remark ?? "—"}</td>
                  </tr>
                  {multi && isOpen && r.items!.map((it, n) => (
                    <tr key={`${r.id}-${n}`} className="bg-secondary/30 text-xs">
                      <td className="px-5 py-1.5" />
                      <td className="px-3 py-1.5" colSpan={5}>
                        <span className="text-muted-foreground">{it.material}</span>
                        {it.discountPct ? <span className="text-muted-foreground"> · less {it.discountPct}%</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-right">{it.qty}{it.unit}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{fmtMoneyInr(it.amountInr)}</td>
                      <td className="px-5 py-1.5" />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
        label={rows.length ? `Showing ${start + 1}–${end} of ${rows.length}` : undefined} />
    </div>
  );
}
