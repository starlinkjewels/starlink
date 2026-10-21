import { pieceLine } from "@/lib/orderText";
import { useMemo, useState } from "react";
import { metalLabel } from "@/lib/metals";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Package, CalendarClock, FileSignature, Truck, PackageCheck, CheckCircle2, BadgeCheck, Boxes, ChevronDown, ArrowRight, Undo2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb, useDbVersion } from "@/hooks/useDb";
import { useCan } from "@/hooks/useCan";
import { loadDb, updateDbAs, fmtDate, orderImage, type Order } from "@/lib/db";
import { sendMail, orderApprovedEmail } from "@/lib/email";
import {
  DONE_COLUMN, applyApprove, applyComplete, applyRevert, boardColumnOf, boardColumns, planMove, stageKind, stagePermission,
  type MovePlan,
} from "@/lib/stages";
import { BulkDispatchDialog, BulkDeliverDialog } from "@/components/BulkDispatchDialog";
import { confirmBox } from "@/lib/confirm";

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, "High Priority": 1, Normal: 2 };
const DONE_SHOWN = 20;

/** The icon a column carries when its stage opens a screen of its own. */
function StageIcon({ step }: { step: string }) {
  const k = step === DONE_COLUMN ? "done" : stageKind(step);
  const cls = "h-3.5 w-3.5 shrink-0";
  if (k === "approve") return <BadgeCheck className={cls} />;
  if (k === "finalApproval") return <FileSignature className={cls} />;
  if (k === "dispatch") return <Truck className={cls} />;
  if (k === "deliver") return <PackageCheck className={cls} />;
  if (k === "readyStock") return <Boxes className={cls} />;
  if (k === "done") return <CheckCircle2 className={cls} />;
  return null;
}

/** What choosing this move will do, in a few words — shown under it in the menu. */
function moveHint(plan: MovePlan): string {
  const parts: string[] = [];
  if (plan.approve) parts.push("Approve & tell the client");
  if (plan.complete.length) parts.push(`Mark ${plan.complete.length === 1 ? "1 stage" : `${plan.complete.length} stages`} done`);
  if (plan.then === "dispatch") parts.push("opens the dispatch form");
  else if (plan.then === "deliver") parts.push("opens the delivery form");
  else if (plan.then) parts.push("finish it on the order");
  const s = parts.join(", then ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** What a column is waiting for, in a few words. */
function columnHint(step: string): string {
  if (step === DONE_COLUMN) return "Every stage done";
  switch (stageKind(step)) {
    case "approve": return "Waiting for approval";
    case "finalApproval": return "Actuals recorded on the order";
    case "dispatch": return "Ready to ship — courier & date";
    case "deliver": return "Shipped — waiting for delivery";
    case "readyStock": return "Added to stock on the order";
    default: return "In this stage";
  }
}

/**
 * The Orders board: one column per production stage, each order in the stage
 * it is at now. Drag a card to another column to move it — or use "Move to…"
 * on a phone, where dragging is not available.
 *
 * Moving forward marks the stages in between done. A stage with work of its
 * own is never just ticked: approval asks first and tells the client, dispatch
 * and delivery open their own forms, and Final Approval or Ready for Stock is
 * finished on the order. Moving back re-opens plain stages only; anything with
 * records of its own is undone on the order, where they are shown.
 */
export function OrderBoard({ orders }: { orders: Order[] }) {
  const { user } = useAuth();
  const db = useDb();
  // The store is edited in place — a moved order is the same object with a new
  // timeline — so the columns are keyed on this, not on the arrays themselves.
  const version = useDbVersion();
  const can = useCan();
  const nav = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [dispatchFor, setDispatchFor] = useState<Order | null>(null);
  const [deliverFor, setDeliverFor] = useState<Order | null>(null);
  const [allDone, setAllDone] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const active = useMemo(() => orders.filter(o => o.status !== "Rejected"), [orders, version]);
  const rejected = orders.length - active.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cols = useMemo(() => boardColumns(db.settings, active), [db.settings, active, version]);
  const byCol = useMemo(() => {
    const m = new Map<string, Order[]>(cols.map(c => [c, []]));
    for (const o of active) m.get(boardColumnOf(o))?.push(o);
    for (const [c, list] of m) {
      if (c === DONE_COLUMN) list.sort((a, b) => +new Date(b.timeline.at(-1)?.date ?? b.createdAt) - +new Date(a.timeline.at(-1)?.date ?? a.createdAt));
      else list.sort((a, b) =>
        (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
        || (a.expectedDelivery || "9999").localeCompare(b.expectedDelivery || "9999"));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, active, version]);

  const mayEdit = can("orders", "edit");
  const blockedFor = (o: Order) => stagePermission(db, user!, o, mayEdit);
  const dragging = dragId ? active.find(o => o.id === dragId) ?? null : null;

  const openOrderPrompt = (o: Order, step: string) =>
    toast(`${o.orderNumber}: ${step} is recorded on the order`, {
      description: step === "Final Approval" ? "Enter the actual gold, diamonds and labour there." : "Add the finished piece to Ready Stock there.",
      action: { label: "Open order", onClick: () => nav(`/orders/${o.id}`) },
    });

  const move = async (orderId: string, target: string) => {
    const o = loadDb().orders.find(x => x.id === orderId);
    if (!o) return;
    const denied = blockedFor(o);
    if (denied) { toast.error(denied); return; }
    const plan = planMove(o, target);
    if (plan.none) return;
    if (plan.blocked) { toast.error(plan.blocked); return; }

    if (plan.revertFrom != null) {
      if (!(await confirmBox(`Move ${o.orderNumber} back to ${target}?\n\nThese stages will be marked not done again: ${plan.names.join(", ")}.`))) return;
      updateDbAs({ summary: `Moved ${o.orderNumber} back to ${target} on the board` }, d => applyRevert(d, o.id, plan.revertFrom!));
      toast.success(`${o.orderNumber} moved back to ${target}`);
      return;
    }

    const doNow = plan.approve || plan.complete.length > 0;
    const thenStep = plan.then ? plan.names[plan.names.length - 1] : "";
    if (!doNow) {
      if (plan.then === "dispatch") setDispatchFor(o);
      else if (plan.then === "deliver") setDeliverFor(o);
      else if (plan.then) {
        if ((await confirmBox(`${thenStep} for ${o.orderNumber} is recorded on the order itself.\n\nOpen the order now?`))) nav(`/orders/${o.id}`);
      }
      return;
    }

    const lines = [
      plan.approve ? "• Approve the order — the client is notified and emailed" : "",
      plan.complete.length ? `• Mark done: ${plan.complete.map(i => o.timeline[i].step).join(", ")}` : "",
      plan.then ? `• Then ${thenStep} — ${plan.then === "dispatch" || plan.then === "deliver" ? "its form opens next" : "finished on the order"}` : "",
    ].filter(Boolean);
    if (!(await confirmBox(`Move ${o.orderNumber}${plan.then ? ` towards ${target}` : ` to ${target}`}?\n\n${lines.join("\n")}`))) return;

    const at = new Date().toISOString();
    updateDbAs({ summary: `Moved ${o.orderNumber} on the board: ${lines.map(l => l.replace(/^• /, "")).join("; ")}` }, d => {
      if (plan.approve) applyApprove(d, o.id, at);
      applyComplete(d, o.id, plan.complete, { id: user!.id, department: user!.department }, at);
    });
    if (plan.approve) {
      const client = db.clients.find(c => c.id === o.clientId);
      if (client?.email) {
        const m = orderApprovedEmail({
          orderNumber: o.orderNumber, clientName: client.companyName, jewelleryType: o.jewelleryType,
          metal: o.metal, quantity: o.quantity, expectedDelivery: o.expectedDelivery,
        });
        void sendMail(client.email, m.subject, m.html);
      }
    }
    toast.success(`${o.orderNumber} moved`);
    const fresh = loadDb().orders.find(x => x.id === o.id);
    if (!fresh) return;
    if (plan.then === "dispatch") setDispatchFor(fresh);
    else if (plan.then === "deliver") setDeliverFor(fresh);
    else if (plan.then) openOrderPrompt(fresh, thenStep);
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span>Drag a card to another stage to move it — or use “Move to…” on a phone.</span>
        <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" /> Dispatch &amp; Delivered open their form</span>
        <span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> Final Approval is entered on the order</span>
        {rejected > 0 && <span>{rejected} rejected order{rejected !== 1 ? "s are" : " is"} not on the board.</span>}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x">
        {/* "Order Submitted" is done the moment an order is placed, so nothing
            waits in it — shown only if an older order somehow does. */}
        {cols.filter(c => c !== "Order Submitted" || (byCol.get(c)?.length ?? 0) > 0).map(col => {
          const list = byCol.get(col) ?? [];
          const shown = col === DONE_COLUMN && !allDone ? list.slice(0, DONE_SHOWN) : list;
          const verdict = dragging ? planMove(dragging, col) : null;
          const ok = !verdict || verdict.none || !verdict.blocked;
          return (
            <div key={col}
              onDragOver={e => { if (!dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = ok ? "move" : "none"; if (overCol !== col) setOverCol(col); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(c => (c === col ? null : c)); }}
              onDrop={e => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                setOverCol(null); setDragId(null);
                if (id) move(id, col);
              }}
              className={`snap-start w-[17rem] shrink-0 rounded-2xl border flex flex-col max-h-[calc(100vh-14rem)] min-h-[12rem] transition-all
                ${col === DONE_COLUMN ? "bg-success/5 border-success/20" : "bg-secondary/40 border-border/60"}
                ${dragging && !ok ? "opacity-40" : ""}
                ${overCol === col && ok ? "ring-2 ring-primary bg-primary/5" : ""}`}>
              <div className="px-3 pt-3 pb-2 border-b border-border/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-dark flex items-center gap-1.5 min-w-0">
                    <StageIcon step={col} /><span className="truncate">{col}</span>
                  </p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white border border-border/60 text-muted-foreground shrink-0">{list.length}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{columnHint(col)}</p>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto flex-1">
                {shown.map(o => {
                  const locked = blockedFor(o);
                  const client = db.clients.find(c => c.id === o.clientId);
                  const img = orderImage(o);
                  const overdue = col !== DONE_COLUMN && !!o.expectedDelivery && o.expectedDelivery.slice(0, 10) < today;
                  // Only moves that would actually go through — a refused one is not offered.
                  const targets = locked ? [] : cols
                    .filter(c => c !== col && (c === DONE_COLUMN || o.timeline.some(t => t.step === c)))
                    .map(c => ({ col: c, plan: planMove(o, c) }))
                    .filter(t => !t.plan.none && !t.plan.blocked);
                  // Ahead: the stages it can really reach, then the one stage that
                  // hands over (a form, or the order) — not every later column,
                  // which would all stop at that same place.
                  const ahead: typeof targets = [];
                  for (const t of targets.filter(t => t.plan.revertFrom == null)) {
                    const doNow = t.plan.approve || t.plan.complete.length > 0;
                    if (t.plan.then && doNow && (t.plan.then === "finalApproval" || t.plan.then === "readyStock")) break;
                    ahead.push(t);
                    if (t.plan.then) break;
                  }
                  const back = targets.filter(t => t.plan.revertFrom != null);
                  return (
                    <div key={o.id}
                      draggable={!locked}
                      onDragStart={e => { e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; setDragId(o.id); }}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      className={`rounded-xl bg-white border border-border/70 p-2.5 shadow-sm transition-shadow ${locked ? "" : "cursor-grab active:cursor-grabbing hover:shadow-md"} ${dragId === o.id ? "opacity-50" : ""}`}>
                      <div className="flex gap-2.5">
                        <div className="h-11 w-11 rounded-lg overflow-hidden bg-secondary/60 shrink-0 grid place-items-center">
                          {img ? <img src={img} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-primary/30" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link to={`/orders/${o.id}`} draggable={false} className="text-sm font-semibold text-brand-dark hover:text-primary hover:underline truncate block">{o.orderNumber}</Link>
                          <p className="text-[11px] text-muted-foreground truncate">{pieceLine(o, false)}{o.designNumber ? ` · #${o.designNumber}` : ""}</p>
                          <p className="text-[11px] font-medium text-muted-foreground truncate">{o.forReadyStock ? "🏭 Ready Stock" : client?.companyName ?? "—"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {o.priority !== "Normal" && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${o.priority === "Urgent" ? "bg-destructive/10 text-destructive" : "bg-amber-500/15 text-amber-700"}`}>{o.priority}</span>
                        )}
                        {o.expectedDelivery && col !== DONE_COLUMN && (
                          <span className={`text-[10px] inline-flex items-center gap-0.5 ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                            <CalendarClock className="h-3 w-3" />{overdue ? "Late · " : ""}{fmtDate(o.expectedDelivery)}
                          </span>
                        )}
                        <span className="ml-auto">
                          {locked ? (
                            <span title={locked} className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" /></span>
                          ) : targets.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={`Move ${o.orderNumber} to another stage`}
                                  className="h-7 inline-flex items-center gap-1 rounded-lg border border-border/70 bg-white px-2 text-[11px] font-medium text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors data-[state=open]:border-primary/50 data-[state=open]:text-primary">
                                  Move to <ChevronDown className="h-3 w-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
                                {ahead.length > 0 && <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Move ahead</DropdownMenuLabel>}
                                {ahead.map(t => (
                                  <DropdownMenuItem key={t.col} onSelect={() => move(o.id, t.col)} className="rounded-lg px-2 py-1.5 cursor-pointer gap-2 items-start">
                                    <span className="mt-0.5 text-primary"><StageIcon step={t.col} />{stageKind(t.col) === "plain" && t.col !== DONE_COLUMN && <ArrowRight className="h-3.5 w-3.5" />}</span>
                                    <span className="min-w-0">
                                      <span className="block text-xs font-medium text-brand-dark">{t.col}</span>
                                      <span className="block text-[10px] text-muted-foreground">{moveHint(t.plan)}</span>
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                                {ahead.length > 0 && back.length > 0 && <DropdownMenuSeparator />}
                                {back.length > 0 && <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Move back</DropdownMenuLabel>}
                                {back.map(t => (
                                  <DropdownMenuItem key={t.col} onSelect={() => move(o.id, t.col)} className="rounded-lg px-2 py-1.5 cursor-pointer gap-2 items-start">
                                    <span className="mt-0.5 text-muted-foreground"><Undo2 className="h-3.5 w-3.5" /></span>
                                    <span className="min-w-0">
                                      <span className="block text-xs font-medium text-brand-dark">{t.col}</span>
                                      <span className="block text-[10px] text-muted-foreground">Re-opens {t.plan.names.join(", ")}</span>
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && (
                  <div className={`rounded-xl border-2 border-dashed p-4 text-center text-[11px] text-muted-foreground ${dragging && ok ? "border-primary/40" : "border-border/50"}`}>
                    {dragging && ok ? "Drop here" : "Nothing here"}
                  </div>
                )}
                {col === DONE_COLUMN && list.length > DONE_SHOWN && (
                  <button type="button" onClick={() => setAllDone(v => !v)} className="w-full text-[11px] text-primary hover:underline py-1">
                    {allDone ? "Show the latest only" : `Show all ${list.length}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dispatchFor && (
        <BulkDispatchDialog orders={[dispatchFor]} onClose={() => setDispatchFor(null)} onDone={() => setDispatchFor(null)} />
      )}
      {deliverFor && (
        <BulkDeliverDialog orders={[deliverFor]} onClose={() => setDeliverFor(null)} onDone={() => setDeliverFor(null)} />
      )}
    </div>
  );
}
