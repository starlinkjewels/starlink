import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { fmtDate } from "@/lib/db";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { DataTable, CellMain, type DataColumn } from "@/components/DataTable";
import { SectionTitle } from "@/components/SectionTitle";
import type { TableFilter } from "@/components/TableToolbar";
import type { StatementLine } from "@/lib/factoryStatement";

const g3 = (n: number) => (Math.abs(n) < 0.0005 ? "" : n.toFixed(3));
const c2 = (n: number) => (Math.abs(n) < 0.0005 ? "" : (Math.round(n * 1000) / 1000).toString());
const rs = (n: number) => (Math.abs(n) < 0.5 ? "" : Math.round(n).toLocaleString("en-IN"));

/**
 * The factory's account as a statement — one line per voucher, in date order,
 * the balances carried down (lib/factoryStatement.ts). What the client checks
 * line for line against the factory's own statement.
 */
export function FactoryStatement({ lines, check, factoryName, orderNo }: {
  lines: StatementLine[];
  check: { ok: boolean; gold: number; dia: number; owed: number; cardGold: number; cardDia: number; cardOwed: number };
  factoryName: string;
  orderNo: (id: string) => string | undefined;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // A date range keeps the arithmetic whole: what came before it is one
  // "Brought forward" line, so each balance still reads as the account's.
  const rows = useMemo(() => {
    const fromD = from || "", toD = to ? `${to}T23:59:59.999` : "";
    const before = fromD ? lines.filter(l => l.kind !== "opening" && l.date < fromD) : [];
    const inRange = lines.filter(l => (l.kind === "opening" && !fromD) || (l.kind !== "opening" && (!fromD || l.date >= fromD) && (!toD || l.date <= toD)));
    const last = before.length ? before[before.length - 1] : (fromD ? lines.find(l => l.kind === "opening") : undefined);
    const bf: StatementLine[] = last ? [{
      ...last, id: "bf", kind: "opening", particular: "Brought forward", voucher: "", orderIds: [], date: fromD,
      goldIn: Math.max(0, last.goldBal), goldOut: Math.max(0, -last.goldBal), diaIn: Math.max(0, last.diaBal), diaOut: Math.max(0, -last.diaBal),
      billed: Math.max(0, last.owed), paid: Math.max(0, -last.owed),
    }] : [];
    const t = q.trim().toLowerCase();
    const shown = t ? inRange.filter(l => l.voucher.toLowerCase().includes(t) || l.particular.toLowerCase().includes(t)) : inRange;
    return [...bf, ...shown];
  }, [lines, q, from, to]);

  const n = (s: ReactNode, cls = "") => <span className={`tabular-nums whitespace-nowrap ${cls}`}>{s}</span>;
  const columns: DataColumn<StatementLine>[] = [
    { key: "line", header: "Particulars", always: true, sortValue: l => l.date, csv: l => l.particular,
      // On a phone card the date and voucher go under the line (their columns are off the card);
      // on a computer they have their own columns, so they are not said twice.
      cell: l => <CellMain title={<span className={l.kind === "opening" ? "italic" : ""}>{l.particular}</span>}
        sub={<span className="md:hidden">{l.date ? fmtDate(l.date) : ""}{l.voucher ? ` · ${l.voucher}` : ""}</span>} /> },
    { key: "date", header: "Date", kind: "date", card: "hide", sortValue: l => l.date, csv: l => (l.date ? fmtDate(l.date) : ""),
      cell: l => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{l.date ? fmtDate(l.date) : "—"}</span> },
    { key: "voucher", header: "Voucher", card: "hide", sortValue: l => l.voucher, csv: l => l.voucher,
      cell: l => (l.voucher
        ? <span className="font-mono text-[12px] whitespace-nowrap">{l.orderIds.length === 1
            ? <Link to={`/orders/${l.orderIds[0]}`} className="text-primary hover:underline" title={orderNo(l.orderIds[0])}>{l.voucher}</Link>
            : l.voucher}</span>
        : <span className="text-muted-foreground">—</span>) },
    { key: "goldIn", header: "Gold in (g fine)", align: "right", kind: "number", csv: l => g3(l.goldIn), cell: l => n(g3(l.goldIn)) },
    { key: "goldOut", header: "Gold out (g fine)", align: "right", kind: "number", csv: l => g3(l.goldOut), cell: l => n(g3(l.goldOut)) },
    { key: "goldBal", header: "Gold balance", align: "right", kind: "number", card: "figure", csv: l => l.goldBal.toFixed(3),
      cell: l => n(l.goldBal.toFixed(3), `font-semibold ${l.goldBal < -0.0005 ? "text-destructive" : "text-brand-dark"}`) },
    { key: "diaIn", header: "Diam. in (ct)", align: "right", kind: "number", csv: l => c2(l.diaIn), cell: l => n(c2(l.diaIn)) },
    { key: "diaOut", header: "Diam. out (ct)", align: "right", kind: "number", csv: l => c2(l.diaOut), cell: l => n(c2(l.diaOut)) },
    { key: "diaBal", header: "Diam. balance", align: "right", kind: "number", csv: l => c2(l.diaBal) || "0",
      cell: l => n(c2(l.diaBal) || "0", "font-semibold text-blue-700") },
    { key: "billed", header: "Labour billed (₹)", align: "right", kind: "number", csv: l => rs(l.billed), cell: l => n(rs(l.billed)) },
    { key: "paid", header: "Paid (₹)", align: "right", kind: "number", csv: l => rs(l.paid), cell: l => n(rs(l.paid), "text-success") },
    { key: "owed", header: "We owe (₹)", align: "right", kind: "number", csv: l => rs(l.owed) || "0",
      cell: l => n(rs(Math.abs(l.owed)) || "0", `font-semibold ${l.owed > 0.5 ? "text-destructive" : "text-muted-foreground"}`) },
  ];

  const filters: TableFilter[] = [{ kind: "date", from, to, onChange: (f, t) => { setFrom(f); setTo(t); } }];
  const last = rows[rows.length - 1];

  return (
    <div className="card-luxe overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <SectionTitle title="Statement" sub={`${factoryName} · one line per voucher, oldest first`} info={<>
          As the factory keeps it: gold in fine (24K) grams, diamonds in carats, labour in rupees — what came in, what
          went out on each bill, and the balance carried down. The voucher is the factory&rsquo;s bill number where one was
          entered at Final Approval (or on a repair), else our order number. A date range starts from a
          &ldquo;Brought forward&rdquo; line, so the balances stay the account&rsquo;s.
        </>} />
      </div>
      <div className="px-5 py-4 space-y-3">
        {/* The statement's last line, against the Factory Account card above. */}
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${check.ok ? "bg-success/8 text-success" : "bg-destructive/8 text-destructive"}`}>
          {check.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />}
          <span>{check.ok
            ? <>Balances match the factory account — gold {check.gold.toFixed(3)} g fine · diamonds {check.dia.toFixed(3)} ct · {check.owed >= 0 ? `we owe ${fmtMoneyInr(check.owed)}` : `they hold ${fmtMoneyInr(-check.owed)} of ours`}</>
            : <>Doesn&rsquo;t add up to the factory account: gold {check.gold.toFixed(3)} vs {check.cardGold.toFixed(3)} g · diamonds {check.dia.toFixed(3)} vs {check.cardDia.toFixed(3)} ct · ₹{Math.round(check.owed)} vs ₹{Math.round(check.cardOwed)}</>}</span>
        </div>
        <DataTable
          id="factory-statement"
          noun="line"
          rows={rows}
          columns={columns}
          rowKey={l => l.id}
          search={{ value: q, onChange: setQ, placeholder: "Search voucher or bill no., particulars…", ariaLabel: "Search the statement" }}
          filters={filters}
          onClearFilters={() => { setFrom(""); setTo(""); }}
          exportName={`${factoryName} statement`}
          details={false}
          totalsLabel={last ? `Closing${from || to ? " (for the dates shown)" : ""}` : undefined}
          totals={last ? {
            goldBal: () => n(last.goldBal.toFixed(3), "font-semibold"),
            diaBal: () => n(c2(last.diaBal) || "0", "font-semibold"),
            owed: () => n(rs(last.owed) || "0", "font-semibold"),
          } : undefined}
          emptyText={q || from || to ? "No line matches that." : "Nothing given to or billed by this factory yet."}
        />
      </div>
    </div>
  );
}
