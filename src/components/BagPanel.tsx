import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRightLeft, Gem, Hash, Layers, Package, Printer, Wallet } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { fmtDate, loadDb, ensureCollections } from "@/lib/db";
import { bagMoveLabel, bagNoOf, printBagLabels } from "@/lib/diamondBags";
import { lotBalances, lotHistory, lotKey, lotLabel, lotParts, type LotSpec } from "@/lib/diamondLots";
import { stockAverageRate } from "@/lib/orderCost";
import { fmtMoneyInr, stockBucketHistory } from "@/lib/manufacturing";
import { moveBetweenBags, recountBag } from "@/lib/stock";
import { companiesOf, companyById, hasCompanies, MAIN_COMPANY_ID } from "@/lib/companies";
import { needsAccess } from "@/lib/actionHints";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { BagSelect, LooseLotFields, lotFromDraft, type LooseLotDraft } from "@/components/LotFields";
import { DataTable, CellAmount, CellDate, CellTag, type DataColumn } from "@/components/DataTable";
import { StatStrip } from "@/components/TableToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Mode = "view" | "move" | "recount";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const draftOf = (s: LotSpec): LooseLotDraft => ({ shape: s.shape, variety: s.variety ?? "", type: s.type ?? "", mm: s.mm ?? "", size: s.size ?? "", color: s.color ?? "", clarity: s.clarity ?? "" });

/**
 * A bag of loose diamonds, opened from the Stock page: what it is, what it
 * holds and what it cost, and every movement in and out of it with what it
 * held after each — carats, and pieces while they were counted. From here the
 * stones move into another bag (one already kept, or a new one), and the bag
 * is recounted (a stock-take sets its pieces).
 *
 * Opened on a line of several bags (one size, "By size"), it lists them — each
 * opens on its own — over their history together.
 */
export function BagPanel({ keys, label, companyId, start = "view", onClose }: {
  /** The bag (its lot), or every bag of one size. Null: closed. */
  keys: string[] | null;
  /** What several bags are, together ("Round · 1.3 mm"). */
  label?: string;
  /** The Stock page's company, or "all". */
  companyId: string;
  /** Open straight on Move or Recount (a row's ⋯). */
  start?: Mode;
  onClose: () => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const can = useCan();
  const mayEdit = can("stock", "edit");
  const multiCo = hasCompanies(db.settings);
  // The bag open now: the one given, or the one picked from a line of several.
  const [bag, setBag] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    setBag(keys?.length === 1 ? keys[0] : null);
    setMode(keys?.length === 1 ? start : "view");
  }, [keys, start]);

  const movements = useMemo(() => db.stockMovements ?? [], [db.stockMovements]);
  const balances = useMemo(() => lotBalances(movements, companyId), [movements, companyId]);
  const shownKeys = bag ? [bag] : keys ?? [];
  const now = new Date().toISOString();
  const co = companyId === "all" ? undefined : companyId;
  const holding = (k: string) => balances.find(l => l.key === k);
  const avgOf = (k: string) => stockAverageRate(db, "diamond", k, now, co);

  // ── What it holds ──
  const members = (keys ?? []).map(k => ({ key: k, no: bagNoOf(db, k), lot: holding(k), avg: avgOf(k) }));
  const lots = shownKeys.map(k => holding(k)).filter(Boolean) as NonNullable<ReturnType<typeof holding>>[];
  const ct = r3(lots.reduce((s, l) => s + l.ct, 0));
  const pcs = lots.length && lots.every(l => l.pcs != null) ? lots.reduce((s, l) => s + (l.pcs ?? 0), 0) : null;
  const value = shownKeys.reduce((s, k) => { const a = avgOf(k); const l = holding(k); return a != null && l ? s + a * l.ct : s; }, 0);
  const priced = shownKeys.some(k => avgOf(k) != null && holding(k));
  const no = bag ? bagNoOf(db, bag) : undefined;
  const spec = bag ? (holding(bag)?.spec ?? lotParts(bag)) : null;

  // ── Its history, oldest first worked out, newest first shown ──
  const linked = useMemo(() => new Map(stockBucketHistory(movements, "diamond", shownKeys, {
    purchases: db.purchases, issuances: db.materialIssuances, orders: db.orders, factories: db.factories, suppliers: db.suppliers,
    diamondSales: db.diamondSales, supplierSales: db.supplierSales ?? [], clients: db.clients,
  }, companyId).map(m => [m.id, m.link])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [movements, db.purchases, db.materialIssuances, db.orders, companyId, shownKeys.join("|")]);
  type HRow = ReturnType<typeof lotHistory>[number];
  const history = useMemo(() => lotHistory(movements, shownKeys, companyId).reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movements, companyId, shownKeys.join("|")]);
  const isIn = (m: HRow["m"]) => m.type === "purchase_in" || (m.type === "adjustment" && m.quantity > 0);
  const dash = <span className="text-muted-foreground/50">—</span>;
  const particulars = (r: HRow) => {
    const l = linked.get(r.m.id);
    const label = bagMoveLabel(db, r.m) ?? l?.label ?? r.m.note ?? "—";
    const to = l?.orderId ? `/orders/${l.orderId}` : l?.factoryId ? `/factories/${l.factoryId}` : l?.supplierId ? `/suppliers/${l.supplierId}` : l?.clientId ? `/clients/${l.clientId}` : null;
    return to ? <Link to={to} className="text-primary hover:underline">{label}</Link> : <span>{label}</span>;
  };
  const columns: DataColumn<HRow>[] = [
    { key: "date", header: "Date", always: true, kind: "date", sortValue: r => +new Date(r.m.createdAt), cell: r => <CellDate>{fmtDate(r.m.createdAt)}</CellDate> },
    ...(!bag && shownKeys.length > 1 ? [{ key: "bag", header: "Bag", sortValue: (r: HRow) => bagNoOf(db, r.m.purityOrQuality) ?? r.m.purityOrQuality,
      cell: (r: HRow) => (bagNoOf(db, r.m.purityOrQuality)
        ? <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{bagNoOf(db, r.m.purityOrQuality)}</span>
        : <span className="text-xs text-muted-foreground">{[lotParts(r.m.purityOrQuality).type, lotParts(r.m.purityOrQuality).color, lotParts(r.m.purityOrQuality).clarity].filter(Boolean).join(" · ") || lotLabel(r.m.purityOrQuality)}</span>) }] : []),
    { key: "what", header: "Particulars", sortValue: r => linked.get(r.m.id)?.label ?? r.m.note ?? "",
      cell: r => <span className="text-sm">{particulars(r)}</span> },
    { key: "in", header: "In (ct)", align: "right", kind: "number", sortValue: r => (isIn(r.m) ? r.m.quantity : null),
      cell: r => (isIn(r.m) && r.m.quantity ? <CellAmount tone="in">{r.m.quantity.toLocaleString()}</CellAmount> : dash) },
    { key: "out", header: "Out (ct)", align: "right", kind: "number", sortValue: r => (isIn(r.m) ? null : r.m.quantity),
      cell: r => (!isIn(r.m) && r.m.quantity ? <CellAmount tone="out">{Math.abs(r.m.quantity).toLocaleString()}</CellAmount> : dash) },
    { key: "pcs", header: "Pcs", align: "right", kind: "number", sortValue: r => r.m.pcsCount ?? r.m.pieces ?? null,
      cell: r => (r.m.pcsCount != null ? <CellTag tone="violet">= {r.m.pcsCount}</CellTag>
        : r.m.pieces != null ? <span className="tabular-nums">{isIn(r.m) ? "+" : "−"}{r.m.pieces}</span> : dash) },
    { key: "bal", header: "Holds", align: "right", kind: "number", sortValue: r => r.ct,
      cell: r => <span className="tabular-nums whitespace-nowrap font-medium text-brand-dark">{r.ct.toLocaleString()} ct{r.pcs != null ? <span className="text-muted-foreground font-normal"> · {r.pcs} pcs</span> : ""}</span> },
  ];

  // ── Move into another bag ──
  const [into, setInto] = useState<"existing" | "new">("existing");
  const [target, setTarget] = useState("");
  const [draft, setDraft] = useState<LooseLotDraft>({ shape: "Round", mm: "", size: "", color: "", clarity: "" });
  const [qty, setQty] = useState("");
  const [movePcs, setMovePcs] = useState("");
  const [note, setNote] = useState("");
  const [counted, setCounted] = useState("");
  // The company the stones are in: the page's, or — seen across companies — the one holding this bag.
  const holders = bag && multiCo && companyId === "all"
    ? companiesOf(db.settings).map(c => ({ id: c.id, name: c.name, lot: lotBalances(movements, c.id).find(l => l.key === bag) })).filter(c => c.lot && c.lot.ct > 0)
    : [];
  const [moveCo, setMoveCo] = useState<string>(MAIN_COMPANY_ID);
  useEffect(() => {
    if (mode === "view") return;
    setQty(""); setMovePcs(""); setNote(""); setCounted(""); setTarget(""); setInto("existing");
    if (spec) setDraft(draftOf(spec));
    setMoveCo(companyId !== "all" ? companyId : holders[0]?.id ?? MAIN_COMPANY_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bag]);
  const srcCo = companyId !== "all" ? companyId : multiCo ? moveCo : MAIN_COMPANY_ID;
  const src = bag ? lotBalances(movements, srcCo).find(l => l.key === bag) : undefined;
  const toKey = into === "existing" ? target : lotKey(lotFromDraft(draft));
  const toNo = toKey ? bagNoOf(db, toKey) : undefined;
  const toNow = toKey ? lotBalances(movements, srcCo).find(l => l.key === toKey) : undefined;
  const q = Number(qty) || 0;
  const srcAvg = bag ? stockAverageRate(db, "diamond", bag, now, multiCo ? srcCo : undefined) : null;
  const sameBag = !!bag && toKey === bag;
  const tooMuch = !!src && q > src.ct + 0.0005;

  const doMove = async () => {
    if (!bag || !user) return;
    if (!mayEdit) { toast.error(needsAccess("stock", "edit")); return; }
    if (!toKey) { toast.error(into === "existing" ? "Choose the bag to move the stones into" : "Fill in the new bag"); return; }
    if (sameBag) { toast.error("That is the same bag — choose another, or change its grade"); return; }
    if (!(q > 0)) { toast.error("Enter how many carats to move"); return; }
    if (!src || tooMuch) { toast.error(`${no ?? "This bag"} holds only ${src?.ct ?? 0} ct`); return; }
    const p = Math.round(Number(movePcs) || 0);
    if (p < 0) { toast.error("Pieces can't be below 0"); return; }
    if (p && src.pcs != null && p > src.pcs) { toast.error(`${no ?? "This bag"} holds only ${src.pcs} pcs`); return; }
    try {
      await ensureCollections(["purchases", "stockMovements"]);
      const rate = stockAverageRate(loadDb(), "diamond", bag, new Date().toISOString(), multiCo ? srcCo : undefined);
      await moveBetweenBags({
        companyId: srcCo, from: bag, to: toKey, toLot: into === "new" ? lotFromDraft(draft) : undefined,
        quantity: q, pieces: p || undefined, valueInr: rate != null ? rate * q : undefined,
        // A new bag gets its number once the move is saved (moveBetweenBags), so its line names the lot.
        fromNo: no, toNo: bagNoOf(loadDb(), toKey), createdBy: user.id, note,
      });
      toast.success(`${r3(q)} ct moved into ${bagNoOf(loadDb(), toKey) ?? lotLabel(toKey)}`);
      setMode("view");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't move the stones");
    }
  };

  const doRecount = async () => {
    if (!bag || !user) return;
    if (!mayEdit) { toast.error(needsAccess("stock", "edit")); return; }
    if (counted.trim() === "" || !(Number(counted) >= 0) || !Number.isInteger(Number(counted))) { toast.error("Enter how many stones you counted"); return; }
    try {
      await recountBag({ companyId: srcCo, key: bag, pieces: Number(counted), was: src?.pcs ?? null, createdBy: user.id, note });
      toast.success(`${no ?? "Bag"} recounted: ${Number(counted)} pcs`);
      setMode("view");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the count");
    }
  };

  // Seen across companies with this bag in more than one: whose stones are moved or counted.
  const coPicker = holders.length > 1 ? (
    <div>
      <Label htmlFor="bm-co" className="text-xs">Company</Label>
      <Select value={moveCo} onValueChange={setMoveCo}>
        <SelectTrigger id="bm-co" className="h-10 rounded-xl mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>{holders.map(h => <SelectItem key={h.id} value={h.id}>{h.name} — {h.lot!.ct} ct</SelectItem>)}</SelectContent>
      </Select>
    </div>
  ) : null;

  const coName = multiCo && companyId !== "all" ? companyById(db.settings, companyId).name : undefined;
  const print = (list: string[]) => {
    const items = list.map(k => ({ no: bagNoOf(db, k), key: k, ct: holding(k)?.ct, pcs: holding(k)?.pcs ?? null })).filter(i => i.no) as { no: string; key: string; ct?: number; pcs: number | null }[];
    if (!items.length) { toast.error("Give these lots bag numbers first"); return; }
    printBagLabels(items, coName);
  };

  const title = bag ? (mode === "move" ? `Move from ${no ?? "this bag"}` : mode === "recount" ? `Recount ${no ?? "this bag"}` : no ?? "Bag")
    : `${members.length} bags of one size`;
  const description = bag ? lotLabel(bag) : label;
  const editHint = mayEdit ? undefined : needsAccess("stock", "edit");

  const footer = !keys ? null : mode === "move" ? (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Moving</p>
        <p className="font-display text-lg font-bold text-brand-dark leading-tight">{q > 0 ? `${r3(q)} ct` : "—"}{Number(movePcs) > 0 ? ` · ${Math.round(Number(movePcs))} pcs` : ""}</p>
      </div>
      <div className="flex gap-2.5 ml-auto">
        <Button variant="outline" onClick={() => setMode("view")} className="rounded-xl h-10">Cancel</Button>
        <AsyncButton onClick={doMove} disabled={!mayEdit || tooMuch || sameBag} className="btn-hero rounded-xl h-10">Move stones</AsyncButton>
      </div>
    </div>
  ) : mode === "recount" ? (
    <div className="flex justify-end gap-2.5">
      <Button variant="outline" onClick={() => setMode("view")} className="rounded-xl h-10">Cancel</Button>
      <AsyncButton onClick={doRecount} disabled={!mayEdit} className="btn-hero rounded-xl h-10">Save count</AsyncButton>
    </div>
  ) : bag ? (
    <div className="flex items-center gap-2.5 flex-wrap justify-end">
      {keys && keys.length > 1 && <Button variant="ghost" onClick={() => setBag(null)} className="rounded-xl h-10 mr-auto">All {keys.length} bags</Button>}
      <Button variant="outline" onClick={() => print([bag])} disabled={!no} className="rounded-xl h-10"><Printer className="h-4 w-4 mr-1.5" />Label</Button>
      <Button variant="outline" onClick={() => setMode("recount")} disabled={!mayEdit || ct <= 0} title={editHint} className="rounded-xl h-10"><Hash className="h-4 w-4 mr-1.5" />Recount</Button>
      <Button onClick={() => setMode("move")} disabled={!mayEdit || ct <= 0} title={editHint} className="btn-hero rounded-xl h-10"><ArrowRightLeft className="h-4 w-4 mr-1.5" />Move to another bag</Button>
    </div>
  ) : (
    <div className="flex justify-end">
      <Button variant="outline" onClick={() => print(keys)} disabled={!members.some(m => m.no)} title={members.some(m => m.no) ? undefined : "Give these bags numbers first (Stock page)"}
        className="rounded-xl h-10"><Printer className="h-4 w-4 mr-1.5" />Print {members.filter(m => m.no).length || keys.length} labels</Button>
    </div>
  );

  return (
    <ActionSheet open={!!keys} onOpenChange={o => { if (!o) onClose(); }} title={title} description={description} icon={Package} size="lg" footer={footer}>
      {mode === "move" && bag ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm">
            <span className="font-mono font-semibold text-primary mr-1.5">{no ?? "—"}</span>
            <span className="text-foreground">{lotLabel(bag)}</span>
            <span className="text-muted-foreground"> — holds {src?.ct ?? 0} ct{src?.pcs != null ? ` · ${src.pcs} pcs` : ""}{srcAvg != null ? ` · ${fmtMoneyInr(srcAvg)}/ct` : ""}</span>
          </div>
          {coPicker}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bm-ct" className="text-xs">Carats to move *</Label>
              <div className="flex gap-1.5 mt-1">
                <Input id="bm-ct" type="number" inputMode="decimal" min={0} step="0.001" value={qty} onChange={e => setQty(e.target.value)} className="h-10 rounded-xl" placeholder="0.000" />
                <Button type="button" variant="outline" className="h-10 rounded-xl px-3 shrink-0" onClick={() => { setQty(String(src?.ct ?? "")); if (src?.pcs != null) setMovePcs(String(src.pcs)); }}>All</Button>
              </div>
              {tooMuch && <p className="text-[11px] text-destructive mt-1">The bag holds only {src?.ct} ct</p>}
            </div>
            <div>
              <Label htmlFor="bm-pcs" className="text-xs">Pieces</Label>
              <Input id="bm-pcs" type="number" inputMode="numeric" min={0} step="1" value={movePcs} onChange={e => setMovePcs(e.target.value)} className="h-10 rounded-xl mt-1"
                placeholder={src?.pcs != null ? `of ${src.pcs}` : "Optional"} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Into</p>
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary border border-border/60" role="group" aria-label="Into which bag">
              {([["existing", "A bag we keep"], ["new", "A new bag"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setInto(v)} aria-pressed={into === v}
                  className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${into === v ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
              ))}
            </div>
            {into === "existing"
              ? <BagSelect id="bm-to" value={target} onChange={setTarget} companyId={srcCo} exclude={[bag]} />
              : <LooseLotFields idPrefix="bm-new" compact companyId={srcCo} bagPicker={false} value={draft} onChange={p => setDraft(d => ({ ...d, ...p }))} />}
          </div>
          <div>
            <Label htmlFor="bm-note" className="text-xs">Note</Label>
            <Input id="bm-note" value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl mt-1" placeholder="Optional — e.g. re-sorted, mixed after a recheck" />
          </div>
          {toKey && !sameBag && q > 0 && !tooMuch && (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2.5 text-xs space-y-1">
              <p><span className="font-mono font-semibold text-primary">{no ?? "This bag"}</span> {src?.ct ?? 0} → {r3((src?.ct ?? 0) - q)} ct</p>
              <p><span className="font-mono font-semibold text-primary">{toNo ?? "New bag"}</span> {toNow?.ct ?? 0} → {r3((toNow?.ct ?? 0) + q)} ct <span className="text-muted-foreground">· {lotLabel(toKey)}</span></p>
              <p className="text-muted-foreground">
                The stones take {toNo ?? "the new bag"}&rsquo;s grade{srcAvg != null ? `, at what they cost: ${fmtMoneyInr(srcAvg)}/ct (${fmtMoneyInr(srcAvg * q)})` : ""}. Stock in all doesn&rsquo;t change.
              </p>
            </div>
          )}
          {sameBag && <p className="text-xs text-destructive">That is this bag — choose another, or change the grade for a new bag.</p>}
        </div>
      ) : mode === "recount" && bag ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm">
            <span className="font-mono font-semibold text-primary mr-1.5">{no ?? "—"}</span>
            <span>{lotLabel(bag)}</span>
            <span className="text-muted-foreground"> — {src?.ct ?? 0} ct · {src?.pcs != null ? `${src.pcs} pcs on record` : "pieces not counted"}</span>
          </div>
          {coPicker}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rc-pcs" className="text-xs">Stones counted *</Label>
              <Input id="rc-pcs" type="number" inputMode="numeric" min={0} step="1" value={counted} onChange={e => setCounted(e.target.value)} className="h-10 rounded-xl mt-1" autoFocus />
            </div>
            <div>
              <Label htmlFor="rc-note" className="text-xs">Note</Label>
              <Input id="rc-note" value={note} onChange={e => setNote(e.target.value)} className="h-10 rounded-xl mt-1" placeholder="Optional" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Counting sets the bag&rsquo;s pieces from today. Carats and value don&rsquo;t change — weigh and move stones for that.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bag && spec && (
            <div className="flex flex-wrap gap-1.5">
              {([["Shape", spec.shape], ["Type", spec.type], ["MM", spec.mm], ["Sieve", spec.size], ["Colour", spec.color], ["Clarity", spec.clarity]] as const)
                .filter(([, v]) => v).map(([l, v]) => (
                  <span key={l} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-xs">
                    <span className="text-muted-foreground">{l}</span><span className="font-medium text-brand-dark">{v}</span>
                  </span>
                ))}
            </div>
          )}
          <StatStrip items={[
            { label: "Carats", value: `${ct} ct`, icon: Gem, sub: bag ? (ct > 0 ? "In the bag" : "Empty") : `${members.length} bags` },
            { label: "Pieces", value: pcs != null ? pcs.toLocaleString() : "—", icon: Layers, sub: pcs != null ? "Counted" : "Not counted — recount" },
            { label: "Value at cost", value: priced ? fmtMoneyInr(value) : "—", icon: Wallet, sub: priced && ct > 0 ? `${fmtMoneyInr(value / ct)}/ct average` : "No price yet" },
          ]} />
          {!bag && (
            <div className="grid sm:grid-cols-2 gap-2">
              {members.map(m => (
                <button key={m.key} type="button" onClick={() => { setBag(m.key); setMode("view"); }}
                  className="text-left rounded-xl border border-border bg-white px-3 py-2.5 hover:border-primary/40 hover:bg-primary/[0.03] transition-colors">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-primary">{m.no ?? "No number"}</span>
                    <span className="tabular-nums text-sm font-semibold text-brand-dark">{m.lot?.ct ?? 0} ct</span>
                  </span>
                  <span className="block text-xs text-foreground mt-0.5 truncate">{[lotParts(m.key).type, lotParts(m.key).color, lotParts(m.key).clarity].filter(Boolean).join(" · ") || "grade not recorded"}</span>
                  <span className="block text-[11px] text-muted-foreground">{m.lot?.pcs != null ? `${m.lot.pcs} pcs` : "pcs not counted"}{m.avg != null ? ` · ${fmtMoneyInr(m.avg)}/ct` : ""}</span>
                </button>
              ))}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-brand-dark mb-2">{bag ? "History of this bag" : "History of these bags"}</p>
            <DataTable
              id="bag-history"
              stateKey={`bag-history:${shownKeys.join("|")}`}
              noun="movement"
              rows={history}
              columns={columns}
              rowKey={r => r.m.id}
              defaultSort={{ key: "date", dir: "desc" }}
              searchText={r => [linked.get(r.m.id)?.label, r.m.note, bagNoOf(db, r.m.purityOrQuality)].filter(Boolean).join(" ")}
              searchPlaceholder={bag ? "Search this bag's history" : "Search these bags' history"}
              details={false}
              resetKey={shownKeys.join("|")}
              emptyText="Nothing has moved in or out yet."
            />
          </div>
        </div>
      )}
    </ActionSheet>
  );
}
