import { useState } from "react";
import { useDb } from "@/hooks/useDb";
import { fmtDate } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
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

  const all: Row[] = [];

  // Bought into stock — the Buy Material tab.
  for (const p of db.purchases ?? []) {
    if (p.purpose !== "stock") continue;
    const isGold = p.material === "gold";
    all.push({
      id: p.id, date: p.createdAt, kind: "Purchase",
      party: db.suppliers.find(s => s.id === p.supplierId)?.name ?? "Supplier",
      material: isGold ? `Gold ${p.gold?.purity ?? ""}`.trim() : `${p.diamond?.shape ?? "Diamond"}${p.diamond?.kind === "certified" ? " (certified)" : ""}`,
      qty: isGold ? (p.gold?.weightGrams ?? 0) : (p.diamond?.carat ?? 0),
      unit: isGold ? "g" : "ct",
      amountInr: p.totalInr,
      remark: [p.discountPct ? `less ${p.discountPct}%` : "", p.notes ?? ""].filter(Boolean).join(" · ") || undefined,
    });
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
        || (r.remark ?? "").toLowerCase().includes(ql);
    })
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));

  const filtered = !!(ql || from || to || kind || material);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setKind(""); setMaterial(""); setPage(1); };
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE, "act");

  const totalIn = rows.filter(r => r.kind === "Purchase" || r.kind === "Opening stock").reduce((s, r) => s + (r.amountInr ?? 0), 0);
  const totalOut = rows.filter(r => r.kind === "Diamond sold").reduce((s, r) => s + (r.amountInr ?? 0), 0);

  const HEAD = ["Sr", "Date", "Entry", "Party", "Material", "Quantity", "Unit", "Amount (INR)", "Remark"];
  const body = rows.map((r, i) => [
    i + 1, fmtDate(r.date), r.kind, r.party, r.material, r.qty, r.unit, r.amountInr ?? "", r.remark ?? "",
  ]);

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
      { header: "Party", x: 100 }, { header: "Material", x: 150 },
      { header: "Qty", x: 205 }, { header: "Amount", x: 232 }, { header: "Remark", x: 262 },
    ],
    align: ["left", "left", "left", "left", "left", "right", "right", "left"],
    rows: rows.map((r, i) => [
      String(i + 1), fmtDate(r.date), r.kind, r.party.slice(0, 28), r.material.slice(0, 30),
      `${r.qty}${r.unit}`, r.amountInr != null ? fmtMoneyInr(r.amountInr) : "",
      (r.remark ?? "").slice(0, 18),
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
              <th className="text-left px-3 py-2.5">Party</th>
              <th className="text-left px-3 py-2.5">Material</th>
              <th className="text-right px-3 py-2.5">Quantity</th>
              <th className="text-right px-3 py-2.5">Amount</th>
              <th className="text-left px-5 py-2.5">Remark</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                {filtered ? "Nothing matches these filters." : "Nothing bought, assigned or sold yet."}
              </td></tr>
            ) : paged.map((r, i) => (
              <tr key={r.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="px-5 py-2.5 text-xs text-muted-foreground">{(page - 1) * PAGE + i + 1}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.kind}</td>
                <td className="px-3 py-2.5 font-medium max-w-[160px] truncate" title={r.party}>{r.party}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.material}>{r.material}</td>
                <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{r.qty}{r.unit}</td>
                <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{r.amountInr != null ? fmtMoneyInr(r.amountInr) : "—"}</td>
                <td className="px-5 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.remark ?? ""}>{r.remark ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage}
        label={rows.length ? `Showing ${start + 1}–${end} of ${rows.length}` : undefined} />
    </div>
  );
}
