import { useState } from "react";
import { useDb } from "@/hooks/useDb";
import { fmtDate, type LockerTransaction } from "@/lib/db";
import { lockerBalance } from "@/lib/manufacturing";
import { ccy, fmtCcy, fmtCcyPdf } from "@/lib/currency";
import { downloadCsv, downloadLedgerPdf } from "@/lib/ledgerExport";
import { LedgerFilters, inDateRange, rangeLabel } from "@/components/LedgerFilters";
import { DataTable, CellMain, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { lockerTxnDetails } from "@/components/rowDetails";
import { useCan } from "@/hooks/useCan";

/** One line of the book: the entry, and the account's balance after it. */
type Line = { t: LockerTransaction; balance: number };

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
 *
 * `lockerId`: the account to show when the page around the book already lists
 * the accounts (Payments' balance strip) — the book then leaves out its own
 * row of account buttons rather than showing every balance twice.
 */
export function DayBook({ lockerId: chosen }: { lockerId?: string }) {
  const db = useDb();
  const can = useCan();
  const lockers = db.lockers.filter(l => l.active !== false);
  // The account picked, or the first one. Taking the first one ONCE, when the
  // page drew, left the book on "no account" whenever the accounts arrived a
  // moment after the page — it said "Nothing on this account yet" over ₹27 lakh.
  const [picked, setLockerId] = useState("");
  const want = chosen ?? picked;
  const lockerId = lockers.some(l => l.id === want) ? want : (lockers[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dir, setDir] = useState("");

  const locker = db.lockers.find(l => l.id === lockerId);
  // Any currency the account is held in; on screen with its symbol, on the
  // PDF in a form its font can draw (no ₹).
  const code = ccy(locker?.currency);
  const money = (n: number) => fmtCcy(n, code);
  const pdfMoney = (n: number) => fmtCcyPdf(n, code);

  // Everything on this account, oldest first — the order the book is written in.
  const ledger = (db.lockerTransactions ?? [])
    .filter(t => t.lockerId === lockerId)
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  // The balance is carried down the WHOLE book, then the view is filtered — so
  // a filtered page still shows the true balance on each of its lines, not a
  // total that starts from nothing.
  let running = locker?.openingBalance || 0;
  const withBalance: Line[] = ledger.map(t => {
    running += isIn(t) ? t.amountInr : -t.amountInr;
    return { t, balance: Math.round(running * 100) / 100 };
  });

  const ql = q.trim().toLowerCase();
  const matching = withBalance.filter(({ t }) => {
    if (!inDateRange(t.createdAt, from, to)) return false;
    if (dir === "in" && !isIn(t)) return false;
    if (dir === "out" && isIn(t)) return false;
    if (!ql) return true;
    return (t.category ?? "").toLowerCase().includes(ql)
      || (t.note ?? "").toLowerCase().includes(ql)
      || (t.voucherNo ?? "").toLowerCase().includes(ql);
  });

  // Newest first on screen: today's entries are the ones being checked, and
  // reaching them meant paging to the end of the book. The balance is worked
  // out downwards before this, so every line still carries the balance AFTER
  // it — the top line is simply the closing balance.
  const rows = [...matching].reverse();

  const filtered = !!(ql || from || to || dir);
  const reset = () => { setQ(""); setFrom(""); setTo(""); setDir(""); };

  const totalIn = rows.filter(r => isIn(r.t)).reduce((s, r) => s + r.t.amountInr, 0);
  const totalOut = rows.filter(r => !isIn(r.t)).reduce((s, r) => s + r.t.amountInr, 0);
  const closing = withBalance.length ? withBalance[withBalance.length - 1].balance : (locker?.openingBalance || 0);

  const particulars = (t: LockerTransaction) =>
    [t.category || t.type, t.note].filter(Boolean).join(" · ");

  const HEAD = ["Date", "Voucher", "Particulars", `In (${code})`, `Out (${code})`, `Balance (${code})`];
  // The download keeps the book's own order — oldest first — because a printed
  // page gets laid beside the written rojmel, which runs that way down the page.
  const body = matching.map(({ t, balance }) => [
    fmtDate(t.createdAt), t.voucherNo ?? "", particulars(t),
    isIn(t) ? t.amountInr : "", isIn(t) ? "" : t.amountInr, balance,
  ]);

  const exportCsv = () => downloadCsv(`Day-Book-${locker?.name?.replace(/\s+/g, "-") ?? "account"}`, HEAD, body);

  const exportPdf = () => downloadLedgerPdf({
    title: `Day Book — ${locker?.name ?? "Account"}`,
    subjectLines: [
      `${matching.length} entr${matching.length !== 1 ? "ies" : "y"} · ${rangeLabel(from, to)} · oldest first`,
      `Opening ${pdfMoney(locker?.openingBalance || 0)} · Closing ${pdfMoney(closing)}`,
      `Report Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ],
    summary: [
      { label: "Money in", value: pdfMoney(totalIn) },
      { label: "Money out", value: pdfMoney(totalOut) },
      { label: "Balance", value: pdfMoney(closing) },
    ],
    landscape: true,
    columns: [
      { header: "Date", x: 14 }, { header: "Voucher", x: 44 }, { header: "Particulars", x: 70 },
      { header: "In", x: 180 }, { header: "Out", x: 215 }, { header: "Balance", x: 252 },
    ],
    align: ["left", "left", "left", "right", "right", "right"],
    rows: matching.map(({ t, balance }) => [
      fmtDate(t.createdAt), t.voucherNo ?? "", particulars(t).slice(0, 62),
      isIn(t) ? pdfMoney(t.amountInr) : "", isIn(t) ? "" : pdfMoney(t.amountInr), pdfMoney(balance),
    ]),
    filename: `Day-Book-${locker?.name?.replace(/\s+/g, "-") ?? "account"}`,
  });

  const columns: DataColumn<Line>[] = [
    { key: "particulars", header: "Particulars", always: true, sortValue: ({ t }) => particulars(t),
      cell: ({ t }) => <div title={particulars(t)} className="max-w-[340px]"><CellMain title={t.category || t.type} sub={t.note} /></div> },
    { key: "date", header: "Date", kind: "date", sortValue: ({ t }) => +new Date(t.createdAt), csv: ({ t }) => fmtDate(t.createdAt),
      cell: ({ t }) => <CellDate>{fmtDate(t.createdAt)}</CellDate> },
    { key: "voucher", header: "Voucher", sortValue: ({ t }) => t.voucherNo ?? "",
      cell: ({ t }) => <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">{t.voucherNo ?? "—"}</span> },
    { key: "in", header: "In", align: "right", kind: "number", sortValue: ({ t }) => (isIn(t) ? t.amountInr : null),
      cell: ({ t }) => (isIn(t) ? <CellAmount tone="in">{money(t.amountInr)}</CellAmount> : null) },
    { key: "out", header: "Out", align: "right", kind: "number", sortValue: ({ t }) => (isIn(t) ? null : t.amountInr),
      cell: ({ t }) => (isIn(t) ? null : <CellAmount tone="out">{money(t.amountInr)}</CellAmount>) },
    { key: "balance", header: "Balance", align: "right", kind: "number", sortValue: r => r.balance,
      cell: r => <span className="font-medium tabular-nums whitespace-nowrap">{money(r.balance)}</span> },
  ];

  if (!lockers.length) {
    return <div className="card-luxe p-8 text-center text-muted-foreground">No accounts yet — add one on the Locker page.</div>;
  }

  return (
    <div className="card-luxe p-5">
      <div className="mb-3">
        <p className="font-display text-lg text-brand-dark leading-tight">Day Book{chosen !== undefined && locker ? ` — ${locker.name}` : ""}</p>
        <p className="text-xs text-muted-foreground">
          Every movement on one account, newest first — the balance on each line is the balance after it
          {chosen !== undefined && lockers.length > 1 ? ". Pick another account from the balances above." : ""}
        </p>
      </div>

      {/* One account at a time — a running balance across mixed accounts, some in
          rupees and some in dollars, would not mean anything. */}
      {chosen === undefined && <div className="flex items-center gap-2 flex-wrap mb-3">
        {lockers.map(l => {
          const bal = lockerBalance(l, db.lockerTransactions ?? []);
          const on = l.id === lockerId;
          return (
            <button key={l.id} onClick={() => setLockerId(l.id)}
              className={`px-3 py-2 rounded-xl border text-left transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"}`}>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{l.name}</span>
              <span className={`block text-sm font-semibold ${on ? "text-primary" : "text-brand-dark"}`}>
                {fmtCcy(bal, l.currency)}
              </span>
            </button>
          );
        })}
      </div>}

      <LedgerFilters
        q={q} onQ={setQ}
        placeholder="Search particulars or voucher…"
        from={from} to={to}
        onFrom={setFrom} onTo={setTo}
        selects={[
          { label: "Directions", value: dir, onChange: setDir,
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

      {/* The filters, search and downloads live in the bar above, so the table
          brings no search or Excel of its own. A new account or filter
          (resetKey) starts it again from the first page. Newest
          first by default; sorted oldest first, the balance reads downwards. */}
      <DataTable
        resetKey={JSON.stringify([lockerId, ql, from, to, dir])}
        id="day-book"
        noun="movement"
        rows={rows}
        columns={columns}
        rowKey={r => r.t.id}
        defaultSort={{ key: "date", dir: "desc" }}
        // Opened: the note as typed, who recorded it and when, and what the
        // movement was — the other account of a transfer, the client, bill or job.
        details={({ t }) => lockerTxnDetails(db, t, m => can(m), { note: true })}
        emptyText={filtered ? "Nothing matches these filters." : "Nothing on this account yet."}
      />
    </div>
  );
}
