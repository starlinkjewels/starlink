import { useState } from "react";
import { useDb } from "@/hooks/useDb";
import { fmtDate, type LockerTransaction } from "@/lib/db";
import { fmtLockerAmount, lockerBalance } from "@/lib/manufacturing";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";

const PAGE = 25;

/** Money in or money out, whichever kind of entry wrote it. */
function isIn(t: LockerTransaction) {
  return t.type === "income" || t.type === "transfer_in";
}

/**
 * The day book — the rojmel, as it is actually written.
 *
 * Every payment in this system already writes one movement on one account:
 * a client's receipt, a supplier's payment, a factory's labour, an expense, a
 * transfer. They were only ever readable split up by who they were with, which
 * is not how a cash book is kept or checked — the book is one column of money
 * in, one of money out, in date order, with the balance carried down the page.
 *
 * So this shows exactly that, one account at a time, oldest first, because a
 * running balance can only be read downwards. What each entry WAS stays in its
 * own tab; this is for agreeing the day's cash against the book.
 */
export function DayBook() {
  const db = useDb();
  const lockers = db.lockers.filter(l => l.active !== false);
  const [lockerId, setLockerId] = useState(lockers[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dir, setDir] = useState("");

  const locker = db.lockers.find(l => l.id === lockerId);
  const ccy = (locker?.currency ?? "INR") as "INR" | "USD";
  const money = (n: number) => fmtLockerAmount(n, ccy);

  // Everything on this account, oldest first — the order the book is written in.
  const ledger = (db.lockerTransactions ?? [])
    .filter(t => t.lockerId === lockerId)
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  // The balance is carried down the WHOLE book, then the view is filtered — so
  // a filtered page still shows the true balance on each of its lines, not a
  // total that starts from nothing.
  let running = locker?.openingBalance || 0;
  const withBalance = ledger.map(t => {
    running += isIn(t) ? t.amountInr : -t.amountInr;
    return { t, balance: Math.round(running * 100) / 100 };
  });

  const ql = q.trim().toLowerCase();
  const rows = withBalance.filter(({ t }) => {
    if (!inDateRange(t.createdAt, from, to)) return false;
    if (dir === "in" && !isIn(t)) return false;
    if (dir === "out" && isIn(t)) return false;
    if (!ql) return true;
    return (t.category ?? "").toLowerCase().includes(ql)
      || (t.note ?? "").toLowerCase().includes(ql)
      || (t.voucherNo ?? "").toLowerCase().includes(ql);
  });

  const filtered = !!(ql || from || to || dir);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setDir(""); setPage(1); };
  const { paged, page, setPage, totalPages, start, end } = usePagination(rows, PAGE, "db");

  const totalIn = rows.filter(r => isIn(r.t)).reduce((s, r) => s + r.t.amountInr, 0);
  const totalOut = rows.filter(r => !isIn(r.t)).reduce((s, r) => s + r.t.amountInr, 0);
  const closing = withBalance.length ? withBalance[withBalance.length - 1].balance : (locker?.openingBalance || 0);

  const particulars = (t: LockerTransaction) =>
    [t.category || t.type, t.note].filter(Boolean).join(" · ");

  const HEAD = ["Date", "Voucher", "Particulars", `In (${ccy})`, `Out (${ccy})`, `Balance (${ccy})`];
  const body = rows.map(({ t, balance }) => [
    fmtDate(t.createdAt), t.voucherNo ?? "", particulars(t),
    isIn(t) ? t.amountInr : "", isIn(t) ? "" : t.amountInr, balance,
  ]);

  const exportCsv = () => downloadCsv(`Day-Book-${locker?.name?.replace(/\s+/g, "-") ?? "account"}`, HEAD, body);

  const exportPdf = () => downloadLedgerPdf({
    title: `Day Book — ${locker?.name ?? "Account"}`,
    subjectLines: [
      `${rows.length} entr${rows.length !== 1 ? "ies" : "y"} · ${rangeLabel(from, to)}`,
      `Opening ${money(locker?.openingBalance || 0)} · Closing ${money(closing)}`,
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Money in", value: money(totalIn) },
      { label: "Money out", value: money(totalOut) },
      { label: "Balance", value: money(closing) },
    ],
    landscape: true,
    columns: [
      { header: "Date", x: 14 }, { header: "Voucher", x: 44 }, { header: "Particulars", x: 70 },
      { header: "In", x: 180 }, { header: "Out", x: 215 }, { header: "Balance", x: 252 },
    ],
    align: ["left", "left", "left", "right", "right", "right"],
    rows: rows.map(({ t, balance }) => [
      fmtDate(t.createdAt), t.voucherNo ?? "", particulars(t).slice(0, 62),
      isIn(t) ? money(t.amountInr) : "", isIn(t) ? "" : money(t.amountInr), money(balance),
    ]),
    filename: `Day-Book-${locker?.name?.replace(/\s+/g, "-") ?? "account"}`,
  });

  if (!lockers.length) {
    return <div className="card-luxe p-8 text-center text-muted-foreground">No accounts yet — add one on the Locker page.</div>;
  }

  return (
    <div className="card-luxe p-5">
      <div className="mb-3">
        <p className="font-display text-lg text-brand-dark leading-tight">Day Book</p>
        <p className="text-xs text-muted-foreground">
          Every movement on one account, oldest first, the way the rojmel is written
        </p>
      </div>

      {/* One account at a time — a running balance across mixed accounts, some in
          rupees and some in dollars, would not mean anything. */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {lockers.map(l => {
          const bal = lockerBalance(l, db.lockerTransactions ?? []);
          const on = l.id === lockerId;
          return (
            <button key={l.id} onClick={() => { setLockerId(l.id); setPage(1); }}
              className={`px-3 py-2 rounded-xl border text-left transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"}`}>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{l.name}</span>
              <span className={`block text-sm font-semibold ${on ? "text-primary" : "text-brand-dark"}`}>
                {fmtLockerAmount(bal, (l.currency ?? "INR") as "INR" | "USD")}
              </span>
            </button>
          );
        })}
      </div>

      <LedgerFilters
        q={q} onQ={v => { setQ(v); setPage(1); }}
        placeholder="Search particulars or voucher…"
        from={from} to={to}
        onFrom={v => { setFrom(v); setPage(1); }} onTo={v => { setTo(v); setPage(1); }}
        selects={[
          { label: "Directions", value: dir, onChange: v => { setDir(v); setPage(1); },
            options: [{ value: "in", label: "Money in" }, { value: "out", label: "Money out" }] },
        ]}
        active={filtered} onReset={reset}
        onPdf={exportPdf} onCsv={exportCsv}
      />

      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground mb-2">
        <span>Opening <span className="font-semibold text-foreground">{money(locker?.openingBalance || 0)}</span></span>
        <span className="text-success">In <span className="font-semibold">{money(totalIn)}</span></span>
        <span className="text-destructive">Out <span className="font-semibold">{money(totalOut)}</span></span>
        <span>Closing <span className="font-semibold text-brand-dark">{money(closing)}</span></span>
        {(from || to) && <span>· {rangeLabel(from, to)}</span>}
      </div>

      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5">Date</th>
              <th className="text-left px-3 py-2.5">Voucher</th>
              <th className="text-left px-3 py-2.5">Particulars</th>
              <th className="text-right px-3 py-2.5 text-success">In</th>
              <th className="text-right px-3 py-2.5 text-destructive">Out</th>
              <th className="text-right px-5 py-2.5">Balance</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                {filtered ? "Nothing matches these filters." : "Nothing on this account yet."}
              </td></tr>
            ) : paged.map(({ t, balance }) => (
              <tr key={t.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{t.voucherNo ?? "—"}</td>
                <td className="px-3 py-2.5 max-w-[340px] truncate" title={particulars(t)}>{particulars(t)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-success whitespace-nowrap">{isIn(t) ? money(t.amountInr) : ""}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-destructive whitespace-nowrap">{isIn(t) ? "" : money(t.amountInr)}</td>
                <td className="px-5 py-2.5 text-right font-medium whitespace-nowrap">{money(balance)}</td>
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
