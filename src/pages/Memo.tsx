// Memo — goods out on approval: what is out now, with whom, for how long (ageing),
// what came back and what was sold. The books: lib/memos.ts.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileOutput, FileInput, Undo2, BadgeDollarSign, Printer, Trash2, Eye, Clock, AlertTriangle, Boxes, Wallet, CalendarClock, MessageCircle } from "lucide-react";
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
  memoDueBlocker, setMemoDue, memoPartyPhone, memoReminderText,
} from "@/lib/memos";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemoOutSheet, MemoBackSheet, qu } from "@/components/MemoSheets";
import { MemoInSheet, MemoInBackSheet } from "@/components/MemoInSheets";
import { Segmented } from "@/components/BillLayout";
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
    title: `${memo.dir === "in" ? "MEMO IN" : "MEMO"} ${memo.no}`,
    subjectLines: [
      `${PARTY_WORD[memo.party.kind]}: ${who}`,
      `Date: ${fmtDate(memo.at)}${memo.dueAt ? `   ·   Due back: ${fmtDate(memo.dueAt)}` : ""}`,
      memo.dir === "in" ? "Goods received on approval — they remain the sender's property until we buy them." : "Goods on approval — they remain our property until invoiced.",
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
  // Ours with them (out), or theirs with us (in).
  const [dir, setDir] = useState<"out" | "in">("out");
  const isIn = dir === "in";
  const [adding, setAdding] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [back, setBack] = useState<{ id: string; mode: "return" | "sold" | "keep" } | null>(null);
  // Changing a memo's due day: which memo, and the day typed ("" = no due day).
  const [dueEdit, setDueEdit] = useState<{ id: string; day: string } | null>(null);

  const all = useMemo(() => (db.memos ?? []).filter(m => m.dir === dir), [db.memos, dir]);
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
    if (!(await confirmBox(m.dir === "in"
      ? `Cancel memo ${m.no}?\n\nThe slip is removed — our stock was never touched by it. Use this only for a memo made by mistake.`
      : `Cancel memo ${m.no}?\n\n${m.lines.map(l => `• ${l.label} — ${qu(l.qty, l.unit)} goes back into stock`).join("\n")}\n\nThe slip is removed. Use this only for a memo made by mistake.`, { confirmText: "Cancel the memo" }))) return;
    try { await cancelMemo(m.id, user!); toast.success(m.dir === "in" ? `Memo ${m.no} cancelled` : `Memo ${m.no} cancelled — everything is back in stock`); setViewId(null); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't cancel it"); }
  };
  // A reminder to whoever holds our goods (lib/memos.ts memoReminderText) — WhatsApp when we have
  // their phone; else the text is copied to send another way.
  const remind = async (m: Memo) => {
    const text = memoReminderText(m, brandFor(db.settings, m.companyId ?? "main").companyName || "us");
    const digits = (memoPartyPhone(db, m.party) ?? "").replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 8) { window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener"); return; }
    try { await navigator.clipboard.writeText(text); toast.success(`No phone on record for ${memoPartyName(db, m.party)} — the reminder is copied, paste it where you reach them`); }
    catch { toast.error("No phone on record — add one to their details first"); }
  };
  const saveDue = () => {
    if (!dueEdit) return;
    try {
      setMemoDue(dueEdit.id, dueEdit.day, user!);
      toast.success(dueEdit.day ? `Due back ${fmtDate(new Date(`${dueEdit.day}T12:00:00`).toISOString())}` : "No due day now");
      setDueEdit(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't change it"); }
  };
  const actions = (m: Memo): MoreAction[] => {
    const open = memoState(m) !== "closed";
    const block = memoCancelBlocker(db, m);
    return [
      { label: "View", icon: Eye, onSelect: () => setViewId(m.id) },
      { label: "Take back", icon: Undo2, hint: "Goods returned — into stock again", show: open && may && m.dir === "out", onSelect: () => setBack({ id: m.id, mode: "return" }) },
      { label: "Sold", icon: BadgeDollarSign, hint: "They keep it — becomes a sale", show: open && may && m.dir === "out", onSelect: () => setBack({ id: m.id, mode: "sold" }) },
      { label: "Keep (buy)", icon: BadgeDollarSign, hint: "We buy it — the purchase bill opens, filled in", show: open && may && m.dir === "in", onSelect: () => setBack({ id: m.id, mode: "keep" }) },
      { label: "Return", icon: Undo2, hint: "Goes back to its owner", show: open && may && m.dir === "in", onSelect: () => setBack({ id: m.id, mode: "return" }) },
      { label: "Change due date", icon: CalendarClock, show: open && may, hint: m.dueAt ? `Due back ${fmtDate(m.dueAt)} now` : "No due day yet",
        onSelect: () => setDueEdit({ id: m.id, day: m.dueAt ? m.dueAt.slice(0, 10) : "" }) },
      { label: "Send reminder", icon: MessageCircle, show: open && m.dir === "out",
        hint: memoPartyPhone(db, m.party) ? "On WhatsApp — the goods still with them, the due day" : "No phone on record — the text is copied",
        onSelect: () => void remind(m) },
      { label: "Print slip", icon: Printer, onSelect: () => printMemoSlip(db, m) },
      { label: "Cancel memo", icon: Trash2, danger: true, show: may, disabled: !!block, hint: block ?? "Made by mistake — everything back", onSelect: () => void cancel(m) },
    ];
  };

  const stateTag = (m: Memo) => {
    const s = memoState(m), a = memoAge(m);
    if (s === "closed") return <CellTag tone="green">Closed</CellTag>;
    if (a.overdue > 0) return <CellTag tone="red">Overdue {a.overdue}d</CellTag>;
    return <CellTag tone={s === "part" ? "blue" : "amber"}>{s === "part" ? (m.dir === "in" ? "Part done" : "Part back") : m.dir === "in" ? "With us" : "Out"}</CellTag>;
  };
  const goodsText = (m: Memo) => m.lines.map(l => l.label).join(", ");
  const columns: DataColumn<Memo>[] = [
    { key: "no", header: "Memo", always: true, sortValue: m => m.no, csv: m => m.no,
      cell: m => <CellMain title={<span className="font-mono text-xs font-semibold">{m.no}</span>} sub={`${m.lines.length} line${m.lines.length === 1 ? "" : "s"}`} /> },
    { key: "party", header: isIn ? "From" : "With", sortValue: m => memoPartyName(db, m.party), csv: m => `${memoPartyName(db, m.party)} (${PARTY_WORD[m.party.kind]})`,
      cell: m => <CellMain title={memoPartyName(db, m.party)} sub={PARTY_WORD[m.party.kind]} /> },
    { key: "goods", header: "Goods", csv: goodsText, cell: m => <span className="block max-w-[280px] truncate text-muted-foreground" title={goodsText(m)}>{goodsText(m)}</span> },
    { key: "at", header: isIn ? "Came on" : "Out on", kind: "date", sortValue: m => m.at, csv: m => fmtDate(m.at), cell: m => <CellDate>{fmtDate(m.at)}</CellDate> },
    { key: "due", header: "Due back", kind: "date", sortValue: m => m.dueAt ?? "", csv: m => (m.dueAt ? fmtDate(m.dueAt) : ""), cell: m => <CellDate>{m.dueAt ? fmtDate(m.dueAt) : "—"}</CellDate> },
    { key: "days", header: isIn ? "Days with us" : "Days out", align: "right", kind: "number", sortValue: m => (memoState(m) === "closed" ? -1 : memoAge(m).days), csv: m => (memoState(m) === "closed" ? "" : memoAge(m).days),
      cell: m => memoState(m) === "closed" ? <span className="text-muted-foreground/60">—</span> : <span className={`tabular-nums ${memoAge(m).days > 30 ? "font-semibold text-amber-800" : ""}`}>{memoAge(m).days}</span> },
    { key: "value", header: isIn ? "Still with us" : "Still out", align: "right", kind: "number", sortValue: m => memoOpenValue(m), csv: m => memoOpenValue(m),
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
          {qu(l.qty, l.unit)}{l.pieces ? ` · ${l.pieces} pcs` : ""} {m.dir === "in" ? "in" : "out"}
          {d.returned > 0 && <> · <span className="text-foreground">{qu(d.returned, l.unit)} {m.dir === "in" ? "returned" : "back"}</span></>}
          {d.sold > 0 && <> · <span className="text-success font-medium">{qu(d.sold, l.unit)} {m.dir === "in" ? "kept" : "sold"}</span></>}
          {open > 1e-6 ? <> · <span className="text-amber-800 font-medium">{qu(open, l.unit)} {m.dir === "in" ? "still with us" : "still out"}</span></> : " · closed"}
          {isAdmin && l.costInr != null && <> · cost {fmtMoneyInr(l.costInr)}</>}
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader title="Memo" subtitle={isIn ? "A dealer's goods with us on approval" : "Goods out on approval"}
        info={<>Goods on memo are still ours, but out of the stock that can be sold or issued. When they come back they go into the same bag or shelf at the same cost; when the holder keeps them they become a sale on their account.</>}
        primary={may ? (isIn ? { label: "Take in on memo", icon: FileInput, onClick: () => setAdding(true) } : { label: "Send on memo", icon: FileOutput, onClick: () => setAdding(true) }) : null} />

      <Segmented value={dir} onChange={d => { setDir(d); setTab("out"); setViewId(null); }} options={[["out", "Memo out — ours with them"], ["in", "Memo in — theirs with us"]] as const} className="max-w-xl" />

      <StatStrip items={[
        { label: isIn ? "With us now" : "Out now", value: String(out.length), icon: Boxes, sub: `${out.reduce((t, m) => t + m.lines.filter(l => lineOpen(m, l) > 1e-6).length, 0)} lines` },
        { label: isIn ? "Value with us" : "Value out", value: valueBy(out), icon: Wallet, sub: isIn ? "what we would owe if we kept it all" : "at the prices agreed" },
        ...(isAdmin && !isIn ? [{ label: "Our cost out", value: fmtMoneyInr(cost.costInr), icon: Clock, sub: [cost.pieces ? `+ ${cost.pieces} piece${cost.pieces === 1 ? "" : "s"}` : "", cost.unpriced ? `${cost.unpriced} not priced` : ""].filter(Boolean).join(" · ") || "still ours — not in the stock figures" }] : []),
        { label: "Overdue", value: String(overdue.length), icon: AlertTriangle, tone: overdue.length ? "out" as const : undefined, sub: overdue.length ? valueBy(overdue) : "none past its due day" },
      ]} />

      <TabBar label="Memos" value={tab} onChange={setTab} tabs={[
        { key: "out", label: isIn ? "With us now" : "Out now", count: out.length },
        { key: "overdue", label: "Overdue", count: overdue.length },
        { key: "all", label: "All", count: all.length },
      ] as const} />

      {rows.length === 0 ? (
        <div className="card-luxe py-14 text-center text-muted-foreground">
          <FileOutput className="h-10 w-10 mx-auto mb-2 opacity-20" />
          <p className="text-sm">{tab === "overdue" ? "Nothing is overdue." : tab === "out" ? (isIn ? "No dealer's goods are with us on memo." : "Nothing is out on memo.") : "No memos yet."}</p>
          {may && tab !== "overdue" && <Button onClick={() => setAdding(true)} className="btn-hero rounded-xl h-9 mt-3 gap-1.5">{isIn ? <><FileInput className="h-4 w-4" /> Take in on memo</> : <><FileOutput className="h-4 w-4" /> Send on memo</>}</Button>}
        </div>
      ) : (
        <div className="card-luxe p-3 sm:p-4">
          <DataTable id="memos" noun="memo" rows={rows} columns={columns} rowKey={m => m.id}
            defaultSort={{ key: "at", dir: "desc" }} onRowClick={m => setViewId(m.id)} rowActions={actions}
            resetKey={`${dir}|${tab}`}
            searchText={m => `${m.no} ${memoPartyName(db, m.party)} ${goodsText(m)} ${m.notes ?? ""}`} searchPlaceholder="Search memo, party or goods"
            exportName={isIn ? "Memo-in-ageing" : "Memo-ageing"} pageSizes={[25, 50, 100]} />
        </div>
      )}

      {dueEdit && (() => {
        const m = all.find(x => x.id === dueEdit.id);
        if (!m) return null;
        const why = memoDueBlocker(m, dueEdit.day);
        return (
          <ActionSheet open onOpenChange={o => { if (!o) setDueEdit(null); }} size="md" icon={CalendarClock} title={`Due date — memo ${m.no}`}
            description={`${memoPartyName(db, m.party)} · ${m.dir === "in" ? "came" : "out"} ${fmtDate(m.at)}${m.dueAt ? ` · due ${fmtDate(m.dueAt)} now` : ""}`}
            footer={<div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDueEdit(null)} className="rounded-xl">Cancel</Button>
              <Button onClick={saveDue} disabled={!!why} className="btn-hero rounded-xl px-6">Save</Button>
            </div>}>
            <div className="space-y-2">
              <Label htmlFor="memo-due" className="text-xs">Due back on</Label>
              <Input id="memo-due" type="date" min={m.at.slice(0, 10)} value={dueEdit.day} onChange={e => setDueEdit({ ...dueEdit, day: e.target.value })} className="rounded-xl h-10" />
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setDueEdit({ ...dueEdit, day: "" })}>No due date</button>
              {why && <p className="text-xs text-destructive">{why}</p>}
              <p className="text-[11px] text-muted-foreground">Kept in the memo's history. Past the new day, the team is alerted again.</p>
            </div>
          </ActionSheet>
        );
      })()}
      {adding && !isIn && <MemoOutSheet open onOpenChange={v => { if (!v) setAdding(false); }} />}
      {adding && isIn && <MemoInSheet open onOpenChange={v => { if (!v) setAdding(false); }} />}
      {backMemo && back && backMemo.dir === "out" && back.mode !== "keep" && <MemoBackSheet memo={backMemo} mode={back.mode} onClose={() => setBack(null)} />}
      {backMemo && back && backMemo.dir === "in" && back.mode !== "sold" && <MemoInBackSheet memo={backMemo} mode={back.mode} onClose={() => setBack(null)} />}
      {view && (
        <ActionSheet open onOpenChange={o => { if (!o) setViewId(null); }} size="lg" icon={view.dir === "in" ? FileInput : FileOutput} title={`Memo ${view.no}`}
          description={`${PARTY_WORD[view.party.kind]}: ${memoPartyName(db, view.party)} · ${view.dir === "in" ? "came" : "out"} ${fmtDate(view.at)}${view.dueAt ? ` · due ${fmtDate(view.dueAt)}` : ""}`}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => printMemoSlip(db, view)} className="rounded-xl h-10 gap-1.5"><Printer className="h-4 w-4" /> Print slip</Button>
              {may && memoState(view) !== "closed" && <Button variant="outline" onClick={() => { setBack({ id: view.id, mode: "return" }); setViewId(null); }} className="rounded-xl h-10 gap-1.5"><Undo2 className="h-4 w-4" /> {view.dir === "in" ? "Return" : "Take back"}</Button>}
              {may && memoState(view) !== "closed" && view.dir === "out" && <Button onClick={() => { setBack({ id: view.id, mode: "sold" }); setViewId(null); }} className="btn-hero rounded-xl h-10 gap-1.5"><BadgeDollarSign className="h-4 w-4" /> Sold</Button>}
              {may && memoState(view) !== "closed" && view.dir === "in" && <Button onClick={() => { setBack({ id: view.id, mode: "keep" }); setViewId(null); }} className="btn-hero rounded-xl h-10 gap-1.5"><BadgeDollarSign className="h-4 w-4" /> Keep (buy)</Button>}
            </div>
          )}>
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">{stateTag(view)}<span className="text-xs text-muted-foreground">{memoState(view) !== "closed" ? `${memoAge(view).days} days ${view.dir === "in" ? "with us" : "out"} · ${fmtCcy(memoOpenValue(view), view.currency)} still ${view.dir === "in" ? "with us" : "out"} of ${fmtCcy(memoValue(view), view.currency)}` : `${fmtCcy(memoValue(view), view.currency)} — ${view.dir === "in" ? "all returned or kept" : "all back or sold"}`}</span></div>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">The goods</p>
              <div className="rounded-xl border border-border/70 px-3">{view.lines.map(l => lineRow(view, l))}</div>
            </section>
            {(view.dueChanges ?? []).length > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Due date changed</p>
                <div className="rounded-xl border border-border/70 px-3">
                  {[...view.dueChanges!].reverse().map((c, i) => (
                    <p key={i} className="py-2 border-t border-border/50 first:border-t-0 text-sm">
                      {c.from ? fmtDate(c.from) : "none"} → <span className="font-medium">{c.to ? fmtDate(c.to) : "none"}</span>
                      <span className="text-muted-foreground"> · {fmtDate(c.at)} · {c.byName}</span>
                    </p>
                  ))}
                </div>
              </section>
            )}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">What happened</p>
              {(view.events ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{view.dir === "in" ? "Nothing returned or kept yet." : "Nothing back or sold yet."}</p> : (
                <div className="rounded-xl border border-border/70 px-3">
                  {[...view.events].sort((a, b) => b.at.localeCompare(a.at)).map(e => (
                    <div key={e.id} className="py-2 border-t border-border/50 first:border-t-0 text-sm">
                      <p><span className={`font-medium ${e.kind !== "return" ? "text-success" : "text-foreground"}`}>{e.kind === "sold" ? "Sold" : e.kind === "kept" ? "Kept — bought" : view.dir === "in" ? "Returned" : "Came back"}</span> <span className="text-muted-foreground">· {fmtDate(e.at)} · {db.users.find(u => u.id === e.createdBy)?.name ?? ""}</span></p>
                      <p className="text-[11px] text-muted-foreground">{e.lines.map(x => { const l = view.lines.find(y => y.id === x.lineId); return l ? `${l.label} — ${qu(x.qty, l.unit)}` : ""; }).filter(Boolean).join(" · ")}{e.note ? ` · ${e.note}` : ""}
                        {e.purchase?.ids.length ? <> · {e.purchase.ids.length} purchase bill{e.purchase.ids.length === 1 ? "" : "s"} on the dealer&rsquo;s account</> : null}
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
