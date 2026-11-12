// Memo — goods out on approval: what is out now, with whom, for how long (ageing),
// what came back and what was sold. The books: lib/memos.ts.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileOutput, Undo2, BadgeDollarSign, Printer, Trash2, Eye, Clock, AlertTriangle, Boxes, Wallet } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useHas } from "@/hooks/useCan";
import { fmtDate, type Memo, type MemoLine } from "@/lib/db";
import { fmtCcy } from "@/lib/currency";
import { fmtMoneyInr } from "@/lib/manufacturing";
import { brandFor } from "@/lib/companies";
import { confirmBox } from "@/lib/confirm";
import { downloadLedgerPdf } from "@/lib/ledgerExport";
import {
  memoState, memoAge, memoOpenValue, memoValue, memoPartyName, PARTY_WORD, lineOpen, lineDone, memoOutAsAt, cancelMemo, memoCancelBlocker,
} from "@/lib/memos";
import { MemoOutSheet, MemoBackSheet, qu } from "@/components/MemoSheets";
import { PageHeader, TabBar } from "@/components/PageHeader";
import { StatStrip } from "@/components/TableToolbar";
import { DataTable, CellMain, CellTag, CellAmount, CellDate, type DataColumn } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import type { MoreAction } from "@/components/MoreMenu";

type Tab = "out" | "overdue" | "all";

/** The slip, as a PDF: who holds what, at what price, due when. */
export function printMemoSlip(db: ReturnType<typeof useDb>, memo: Memo): void {
  const who = memoPartyName(db, memo.party);
  const brand = brandFor(db.settings, memo.companyId || "main");
  downloadLedgerPdf({
    title: `MEMO ${memo.no}`,
    subjectLines: [
      `${PARTY_WORD[memo.party.kind]}: ${who}`,
      `Date: ${fmtDate(memo.at)}${memo.dueAt ? `   ·   Due back: ${fmtDate(memo.dueAt)}` : ""}`,
      "Goods on approval — they remain our property until invoiced.",
      ...(memo.notes ? [`Remark: ${memo.notes}`] : []),
    ],
    summary: [{ label: "Lines", value: String(memo.lines.length) }, { label: "Memo value", value: fmtCcy(memoValue(memo), memo.currency) }],
    columns: [{ header: "#", x: 14 }, { header: "Goods", x: 24 }, { header: "Quantity", x: 118 }, { header: "Rate", x: 146 }, { header: "Amount", x: 172 }],
    rows: memo.lines.map((l, i) => [String(i + 1), l.label, `${qu(l.qty, l.unit)}${l.pieces ? ` · ${l.pieces} pcs` : ""}`, l.rate ? fmtCcy(l.rate, memo.currency) : "", l.amount ? fmtCcy(l.amount, memo.currency) : ""]),
    totalsRow: ["", "Total", "", "", fmtCcy(memoValue(memo), memo.currency)],
    filename: `Memo-${memo.no}`,
    company: brand.companyName,
  });
}

export function MemoPage() {
  const db = useDb();
  const { user } = useAuth();
  const has = useHas();
  const may = user?.role === "admin" || has("stock.memo");
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("out");
  const [adding, setAdding] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [back, setBack] = useState<{ id: string; mode: "return" | "sold" } | null>(null);

  const all = useMemo(() => (db.memos ?? []).filter(m => m.dir === "out"), [db.memos]);
  const out = all.filter(m => memoState(m) !== "closed");
  const overdue = out.filter(m => memoAge(m).overdue > 0);
  const rows = tab === "out" ? out : tab === "overdue" ? overdue : all;
  const view = viewId ? all.find(m => m.id === viewId) : undefined;
  const backMemo = back ? all.find(m => m.id === back.id) : undefined;
  const cost = useMemo(() => memoOutAsAt(db), [db]);
  const valueBy = (list: Memo[]) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(x.currency, (m.get(x.currency) ?? 0) + memoOpenValue(x));
    return [...m].filter(([, v]) => v > 0).map(([c, v]) => fmtCcy(Math.round(v * 100) / 100, c)).join(" + ") || "—";
  };

  if (user?.role !== "admin" && !has("stock.memo")) {
    return <div className="max-w-3xl mx-auto py-16 text-center text-sm text-muted-foreground">Memo is not part of your access — ask an admin (Employees → Manage access → Stock → Memo).</div>;
  }

  const cancel = async (m: Memo) => {
    const block = memoCancelBlocker(db, m);
    if (block) { toast.error(block); return; }
    if (!(await confirmBox(`Cancel memo ${m.no}?\n\n${m.lines.map(l => `• ${l.label} — ${qu(l.qty, l.unit)} goes back into stock`).join("\n")}\n\nThe slip is removed. Use this only for a memo made by mistake.`, { confirmText: "Cancel the memo" }))) return;
    try { await cancelMemo(m.id, user!); toast.success(`Memo ${m.no} cancelled — everything is back in stock`); setViewId(null); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't cancel it"); }
  };
  const actions = (m: Memo): MoreAction[] => {
    const open = memoState(m) !== "closed";
    const block = memoCancelBlocker(db, m);
    return [
      { label: "View", icon: Eye, onSelect: () => setViewId(m.id) },
      { label: "Take back", icon: Undo2, hint: "Goods returned — into stock again", show: open && may, onSelect: () => setBack({ id: m.id, mode: "return" }) },
      { label: "Sold", icon: BadgeDollarSign, hint: "They keep it — becomes a sale", show: open && may, onSelect: () => setBack({ id: m.id, mode: "sold" }) },
      { label: "Print slip", icon: Printer, onSelect: () => printMemoSlip(db, m) },
      { label: "Cancel memo", icon: Trash2, danger: true, show: may, disabled: !!block, hint: block ?? "Made by mistake — everything back", onSelect: () => void cancel(m) },
    ];
  };

  const stateTag = (m: Memo) => {
    const s = memoState(m), a = memoAge(m);
    if (s === "closed") return <CellTag tone="green">Closed</CellTag>;
    if (a.overdue > 0) return <CellTag tone="red">Overdue {a.overdue}d</CellTag>;
    return <CellTag tone={s === "part" ? "blue" : "amber"}>{s === "part" ? "Part back" : "Out"}</CellTag>;
  };
  const goodsText = (m: Memo) => m.lines.map(l => l.label).join(", ");
  const columns: DataColumn<Memo>[] = [
    { key: "no", header: "Memo", always: true, sortValue: m => m.no, csv: m => m.no,
      cell: m => <CellMain title={<span className="font-mono text-xs font-semibold">{m.no}</span>} sub={`${m.lines.length} line${m.lines.length === 1 ? "" : "s"}`} /> },
    { key: "party", header: "With", sortValue: m => memoPartyName(db, m.party), csv: m => `${memoPartyName(db, m.party)} (${PARTY_WORD[m.party.kind]})`,
      cell: m => <CellMain title={memoPartyName(db, m.party)} sub={PARTY_WORD[m.party.kind]} /> },
    { key: "goods", header: "Goods", csv: goodsText, cell: m => <span className="block max-w-[280px] truncate text-muted-foreground" title={goodsText(m)}>{goodsText(m)}</span> },
    { key: "at", header: "Out on", kind: "date", sortValue: m => m.at, csv: m => fmtDate(m.at), cell: m => <CellDate>{fmtDate(m.at)}</CellDate> },
    { key: "due", header: "Due back", kind: "date", sortValue: m => m.dueAt ?? "", csv: m => (m.dueAt ? fmtDate(m.dueAt) : ""), cell: m => <CellDate>{m.dueAt ? fmtDate(m.dueAt) : "—"}</CellDate> },
    { key: "days", header: "Days out", align: "right", kind: "number", sortValue: m => (memoState(m) === "closed" ? -1 : memoAge(m).days), csv: m => (memoState(m) === "closed" ? "" : memoAge(m).days),
      cell: m => memoState(m) === "closed" ? <span className="text-muted-foreground/60">—</span> : <span className={`tabular-nums ${memoAge(m).days > 30 ? "font-semibold text-amber-800" : ""}`}>{memoAge(m).days}</span> },
    { key: "value", header: "Still out", align: "right", kind: "number", sortValue: m => memoOpenValue(m), csv: m => memoOpenValue(m),
      cell: m => <CellAmount>{memoOpenValue(m) ? fmtCcy(memoOpenValue(m), m.currency) : "—"}</CellAmount> },
    { key: "state", header: "Status", sortValue: m => memoState(m), csv: m => memoState(m), cell: stateTag },
  ];

  const lineRow = (m: Memo, l: MemoLine) => {
    const d = lineDone(m, l.id), open = lineOpen(m, l);
    return (
      <div key={l.id} className="py-2 border-t border-border/50 first:border-t-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-foreground min-w-0 break-words">{l.label}</p>
          <p className="text-sm tabular-nums shrink-0">{l.amount ? fmtCcy(l.amount, m.currency) : "—"}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {qu(l.qty, l.unit)}{l.pieces ? ` · ${l.pieces} pcs` : ""} out
          {d.returned > 0 && <> · <span className="text-foreground">{qu(d.returned, l.unit)} back</span></>}
          {d.sold > 0 && <> · <span className="text-success font-medium">{qu(d.sold, l.unit)} sold</span></>}
          {open > 1e-6 ? <> · <span className="text-amber-800 font-medium">{qu(open, l.unit)} still out</span></> : " · closed"}
          {isAdmin && l.costInr != null && <> · cost {fmtMoneyInr(l.costInr)}</>}
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader title="Memo" subtitle="Goods out on approval"
        info={<>Goods on memo are still ours, but out of the stock that can be sold or issued. When they come back they go into the same bag or shelf at the same cost; when the holder keeps them they become a sale on their account.</>}
        primary={may ? { label: "Send on memo", icon: FileOutput, onClick: () => setAdding(true) } : null} />

      <StatStrip items={[
        { label: "Out now", value: String(out.length), icon: Boxes, sub: `${out.reduce((t, m) => t + m.lines.filter(l => lineOpen(m, l) > 1e-6).length, 0)} lines` },
        { label: "Value out", value: valueBy(out), icon: Wallet, sub: "at the prices agreed" },
        ...(isAdmin ? [{ label: "Our cost out", value: fmtMoneyInr(cost.costInr), icon: Clock, sub: [cost.pieces ? `+ ${cost.pieces} piece${cost.pieces === 1 ? "" : "s"}` : "", cost.unpriced ? `${cost.unpriced} not priced` : ""].filter(Boolean).join(" · ") || "still ours — not in the stock figures" }] : []),
        { label: "Overdue", value: String(overdue.length), icon: AlertTriangle, tone: overdue.length ? "out" as const : undefined, sub: overdue.length ? valueBy(overdue) : "none past its due day" },
      ]} />

      <TabBar label="Memos" value={tab} onChange={setTab} tabs={[
        { key: "out", label: "Out now", count: out.length },
        { key: "overdue", label: "Overdue", count: overdue.length },
        { key: "all", label: "All", count: all.length },
      ] as const} />

      {rows.length === 0 ? (
        <div className="card-luxe py-14 text-center text-muted-foreground">
          <FileOutput className="h-10 w-10 mx-auto mb-2 opacity-20" />
          <p className="text-sm">{tab === "overdue" ? "Nothing is overdue." : tab === "out" ? "Nothing is out on memo." : "No memos yet."}</p>
          {may && tab !== "overdue" && <Button onClick={() => setAdding(true)} className="btn-hero rounded-xl h-9 mt-3 gap-1.5"><FileOutput className="h-4 w-4" /> Send on memo</Button>}
        </div>
      ) : (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable id="memos" noun="memo" rows={rows} columns={columns} rowKey={m => m.id}
            defaultSort={{ key: "at", dir: "desc" }} onRowClick={m => setViewId(m.id)} rowActions={actions}
            resetKey={tab}
            searchText={m => `${m.no} ${memoPartyName(db, m.party)} ${goodsText(m)} ${m.notes ?? ""}`} searchPlaceholder="Search memo, party or goods"
            exportName="Memo-ageing" pageSizes={[25, 50, 100]} />
        </div>
      )}

      {adding && <MemoOutSheet open onOpenChange={v => { if (!v) setAdding(false); }} />}
      {backMemo && back && <MemoBackSheet memo={backMemo} mode={back.mode} onClose={() => setBack(null)} />}
      {view && (
        <ActionSheet open onOpenChange={o => { if (!o) setViewId(null); }} size="lg" icon={FileOutput} title={`Memo ${view.no}`}
          description={`${PARTY_WORD[view.party.kind]}: ${memoPartyName(db, view.party)} · out ${fmtDate(view.at)}${view.dueAt ? ` · due ${fmtDate(view.dueAt)}` : ""}`}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => printMemoSlip(db, view)} className="rounded-xl h-10 gap-1.5"><Printer className="h-4 w-4" /> Print slip</Button>
              {may && memoState(view) !== "closed" && <Button variant="outline" onClick={() => { setBack({ id: view.id, mode: "return" }); setViewId(null); }} className="rounded-xl h-10 gap-1.5"><Undo2 className="h-4 w-4" /> Take back</Button>}
              {may && memoState(view) !== "closed" && <Button onClick={() => { setBack({ id: view.id, mode: "sold" }); setViewId(null); }} className="btn-hero rounded-xl h-10 gap-1.5"><BadgeDollarSign className="h-4 w-4" /> Sold</Button>}
            </div>
          )}>
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">{stateTag(view)}<span className="text-xs text-muted-foreground">{memoState(view) !== "closed" ? `${memoAge(view).days} days out · ${fmtCcy(memoOpenValue(view), view.currency)} still out of ${fmtCcy(memoValue(view), view.currency)}` : `${fmtCcy(memoValue(view), view.currency)} — all back or sold`}</span></div>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">The goods</p>
              <div className="rounded-xl border border-border/70 px-3">{view.lines.map(l => lineRow(view, l))}</div>
            </section>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">What happened</p>
              {(view.events ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing back or sold yet.</p> : (
                <div className="rounded-xl border border-border/70 px-3">
                  {[...view.events].sort((a, b) => b.at.localeCompare(a.at)).map(e => (
                    <div key={e.id} className="py-2 border-t border-border/50 first:border-t-0 text-sm">
                      <p><span className={`font-medium ${e.kind === "sold" ? "text-success" : "text-foreground"}`}>{e.kind === "sold" ? "Sold" : "Came back"}</span> <span className="text-muted-foreground">· {fmtDate(e.at)} · {db.users.find(u => u.id === e.createdBy)?.name ?? ""}</span></p>
                      <p className="text-[11px] text-muted-foreground">{e.lines.map(x => { const l = view.lines.find(y => y.id === x.lineId); return l ? `${l.label} — ${qu(x.qty, l.unit)}` : ""; }).filter(Boolean).join(" · ")}{e.note ? ` · ${e.note}` : ""}
                        {e.sale?.type === "supplierSale" && <> · on the dealer&rsquo;s account (Suppliers)</>}
                        {e.sale?.type === "diamondSale" && <> · a diamond sale, not received yet (<Link to="/payments" className="text-primary hover:underline">Payments</Link>)</>}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {view.notes && <p className="text-xs text-muted-foreground">Remark: {view.notes}</p>}
          </div>
        </ActionSheet>
      )}
    </div>
  );
}
