// The new look's Home (Settings → Appearance → New look) — the research way
// (2026-11-06): the "wow" comes from the business's own work, not decoration.
//   • a slim greeting with what needs you, and the day's two actions;
//   • the piece being made, as a photograph — the richest thing the app holds;
//   • four figures that roll in, each with its change and a line of its trend;
//   • "Needs you": what waits on someone, one button each;
//   • the pipeline: every stage, its count, one tap to the list.
// Calm colour (it means something: green in, red owed/late, amber waiting),
// short precise motion (Motion, already in the app), nothing in the way.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, ArrowDownRight, CheckCircle2, Clock, Gem, Package, Plus, Receipt, Sparkles, TrendingUp, Truck, Wallet, type LucideIcon } from "lucide-react";
import { balanceDue, fmtMoney, orderImage, orderTotal, type DB, type Order } from "@/lib/db";
import { stageLabel } from "@/lib/stages";
import { kpis, lateOpen, monthly, pctChange, presetPeriod, receivables } from "@/lib/analytics";
import { recognisedSale } from "@/lib/orderCost";

const EASE = [0.23, 1, 0.32, 1] as const;

/** The motion setting: system "reduce motion" or the app's own Calm. */
function useCalm(): boolean {
  const reduce = useReducedMotion();
  return !!reduce || (typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "calm");
}

/** A figure that rolls up to its value on arrival and moves to a new one when it changes. */
function RollingNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const calm = useCalm();
  const el = useRef<HTMLSpanElement>(null);
  const from = useRef(calm ? value : 0);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (calm) { node.textContent = format(value); from.current = value; return; }
    const c = animate(from.current, value, { duration: 0.9, ease: EASE, onUpdate: v => { node.textContent = format(v); } });
    from.current = value;
    return () => c.stop();
  }, [value, calm]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={el} className="tabular-nums">{format(calm ? value : 0)}</span>;
}

/** A small line of a figure's trend — its shape, not its numbers. Draws itself in. */
function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const calm = useCalm();
  if (values.length < 2 || values.every(v => v === values[0])) return null;
  const w = 96, h = 30, max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 3 - ((v - min) / (max - min || 1)) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[30px] w-[96px] overflow-visible" aria-hidden>
      <defs><linearGradient id={`sg-${tone}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity="0.16" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <motion.path d={area} fill={`url(#sg-${tone})`} initial={{ opacity: calm ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: calm ? 0 : 0.5 }} />
      <motion.path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: calm ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE, delay: calm ? 0 : 0.15 }} />
    </svg>
  );
}

export interface HomeTile {
  key: string; label: string; icon: LucideIcon; value: number; format: (n: number) => string;
  /** Change against the period before, in %; null when there is nothing to compare. */
  change?: number | null;
  /** Whether a rise is good news (sales) or bad (money owed). */
  upIsGood?: boolean;
  spark?: number[]; sub?: ReactNode; to?: string;
  /** The figure's own meaning, when it has one. */
  tone?: "in" | "out" | "warn";
}

interface Hero { id: string; number: string; what: string; client: string; stage: string; daysLeft: number | null; img?: string; status: string }

const TONE_TEXT: Record<NonNullable<HomeTile["tone"]>, string> = { in: "text-success", out: "text-destructive", warn: "text-amber-600" };

function Tile({ t, i }: { t: HomeTile; i: number }) {
  const up = (t.change ?? 0) > 0, flat = t.change == null || Math.abs(t.change) < 0.5;
  // A figure of nothing says neither good nor bad news.
  const tone = t.value === 0 ? undefined : t.tone;
  const good = flat ? null : t.upIsGood === false ? !up : up;
  const body = (
    <motion.div variants={ITEM} custom={i} className="home-tile group h-full">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground truncate">{t.label}</p>
        <t.icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
      </div>
      <p className={`mt-3 text-[1.6rem] sm:text-[2rem] font-semibold leading-none tracking-[-0.03em] whitespace-nowrap ${tone ? TONE_TEXT[tone] : "text-foreground"}`}>
        <RollingNumber value={t.value} format={t.format} />
      </p>
      <div className="mt-3 flex items-end justify-between gap-2 min-h-[34px]">
        <div className="min-w-0 text-xs leading-snug">
          {!flat && (
            <p title={`${up ? "Up" : "Down"} ${Math.abs(Math.round(t.change!))}% on last month`} className={`inline-flex items-center gap-0.5 font-semibold ${good ? "text-success" : "text-destructive"}`}>
              {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{Math.abs(Math.round(t.change!))}%
            </p>
          )}
          {t.sub && <p className="text-muted-foreground truncate">{t.sub}</p>}
        </div>
        {t.spark && <span className={`home-spark shrink-0 ${tone ? TONE_TEXT[tone] : "text-primary"}`}><Sparkline values={t.spark} tone={t.key} /></span>}
      </div>
    </motion.div>
  );
  return t.to ? <Link to={t.to} className="block h-full rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{body}</Link> : body;
}

const LIST = { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } } };
const ITEM = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } } };

/** The piece being made, as a photograph; the next few beside it. */
function HeroPiece({ heroes }: { heroes: Hero[] }) {
  const [i, setI] = useState(0);
  const h = heroes[Math.min(i, heroes.length - 1)];
  if (!h) {
    return (
      <motion.div variants={ITEM} className="home-hero home-hero-empty">
        <Gem className="h-10 w-10 text-primary/50" />
        <p className="mt-3 font-semibold text-foreground">Nothing in the works right now</p>
        <p className="text-sm text-muted-foreground">New orders and their photos appear here.</p>
        <Link to="/orders/new" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><Plus className="h-4 w-4" />New order</Link>
      </motion.div>
    );
  }
  return (
    <motion.div variants={ITEM} className="home-hero group">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={h.id} className="absolute inset-0" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          {h.img
            ? <img src={h.img} alt="" className="home-hero-img" />
            : <div className="home-hero-img home-hero-noimg"><Gem className="h-14 w-14 text-white/35" /></div>}
        </motion.div>
      </AnimatePresence>
      <div className="home-hero-shade" />
      <div className="absolute left-4 top-4 sm:left-5 sm:top-5 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{h.status === "Ready" ? "Ready to ship" : "In the works"}
      </div>
      {heroes.length > 1 && (
        <div className="absolute right-4 top-4 sm:right-5 sm:top-5 flex gap-1.5" role="tablist" aria-label="Pieces in the works">
          {heroes.map((x, k) => (
            <button key={x.id} type="button" role="tab" aria-selected={k === i} aria-label={x.number} onClick={() => setI(k)}
              className={`h-9 w-9 overflow-hidden rounded-lg ring-2 transition ${k === i ? "ring-white" : "ring-white/25 opacity-70 hover:opacity-100"}`}>
              {x.img ? <img src={x.img} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center bg-white/15"><Gem className="h-4 w-4 text-white/70" /></span>}
            </button>
          ))}
        </div>
      )}
      <Link to={`/orders/${h.id}`} className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5 text-white focus-visible:outline-none">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-wider text-white/75">{h.number}</p>
          <p className="mt-0.5 text-lg sm:text-2xl font-semibold leading-tight tracking-tight line-clamp-2">{h.what}</p>
          <p className="mt-1 text-sm text-white/85 truncate">{h.client}{h.stage ? ` · ${h.stage}` : ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {h.daysLeft != null && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${h.daysLeft < 0 ? "bg-red-500/85" : h.daysLeft <= 3 ? "bg-amber-500/85" : "bg-black/40"}`}>
              {h.daysLeft < 0 ? `${-h.daysLeft} days late` : h.daysLeft === 0 ? "Due today" : `${h.daysLeft} days left`}
            </span>
          )}
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-900 transition-transform group-hover:translate-x-0.5"><ArrowRight className="h-4 w-4" /></span>
        </div>
      </Link>
    </motion.div>
  );
}

export interface NeedRow { key: string; icon: LucideIcon; title: string; sub: string; action: { label: string; to: string }; tone?: "out" | "warn" }

const daysTo = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso); if (isNaN(+d)) return null;
  const a = new Date(); a.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.round((+d - +a) / 86_400_000);
};
const stageOf = (o: Order) => {
  const s = o.timeline.find(t => t.status === "in_progress") ?? [...o.timeline].reverse().find(t => t.status === "done");
  return s ? stageLabel(s.step) : "";
};
/** "Ring · 14K Yellow Gold" — what the piece is, as the order page names it. */
const whatOf = (o: Order) => [o.jewelleryType, [o.productKarats, /gold/i.test(o.metal ?? "") ? o.productColor : "", o.metal].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || o.orderNumber;

export function StudioHome({ db, orders, role, firstName, isClient, goldGrams }: {
  db: DB; orders: Order[]; role: "admin" | "employee" | "client"; firstName: string; isClient: boolean; goldGrams: number;
}) {
  const live = useMemo(() => orders.filter(o => !o.deletedAt), [orders]);

  // The pieces in the works — photographed ones first, the soonest due first.
  const heroes: Hero[] = useMemo(() => live
    .filter(o => ["In Production", "Ready", "Approved"].includes(o.status) && !o.forReadyStock)
    .sort((a, b) => (orderImage(b) ? 1 : 0) - (orderImage(a) ? 1 : 0) || (+new Date(a.expectedDelivery || "9999") - +new Date(b.expectedDelivery || "9999")))
    .slice(0, 4)
    .map(o => ({
      id: o.id, number: o.orderNumber, what: whatOf(o), status: o.status,
      client: isClient ? "" : db.clients.find(c => c.id === o.clientId)?.companyName ?? "",
      stage: stageOf(o), daysLeft: daysTo(o.expectedDelivery), img: orderImage(o),
    })), [live, db.clients, isClient]);

  // The four figures.
  const tiles: HomeTile[] = useMemo(() => {
    const month = presetPeriod("thisMonth"), prev = presetPeriod("lastMonth");
    const usd = (n: number) => fmtMoney(Math.round(n));
    const int = (n: number) => Math.round(n).toLocaleString("en-IN");
    const open = live.filter(o => !["Delivered", "Rejected"].includes(o.status));
    const late = lateOpen(live).length;
    if (role === "admin") {
      const k = kpis(db, live, month, false), kp = kpis(db, live, prev, false);
      const trend = monthly(db, live, presetPeriod("last12"), false);
      const owed = receivables(live);
      return [
        { key: "sales", label: "Sales this month", icon: TrendingUp, value: k.salesUsd, format: usd, change: pctChange(k.salesUsd, kp.salesUsd), spark: trend.map(m => m.salesUsd), sub: `${k.soldCount} order${k.soldCount === 1 ? "" : "s"}`, to: "/reports" },
        { key: "collected", label: "Collected this month", icon: Wallet, value: k.collectedUsd, format: usd, change: pctChange(k.collectedUsd, kp.collectedUsd), spark: trend.map(m => m.collectedUsd), tone: "in", to: "/payments?book=received" },
        { key: "owed", label: "Owed to us", icon: Receipt, value: owed.total, format: usd, upIsGood: false, sub: owed.d90 ? `${usd(owed.d90)} over 90 days` : "none over 90 days", tone: owed.total > 0 ? "out" : undefined, to: "/clients" },
        { key: "open", label: "Open orders", icon: Package, value: open.length, format: int, sub: late ? `${late} late` : "none late", tone: late ? "warn" : undefined, to: "/orders" },
      ];
    }
    if (role === "employee") {
      const done = live.filter(o => o.status === "Delivered").length;
      return [
        { key: "open", label: "My open orders", icon: Truck, value: open.length, format: int, to: "/orders" },
        { key: "prod", label: "In production", icon: Gem, value: live.filter(o => o.status === "In Production").length, format: int, to: "/orders?status=In%20Production" },
        { key: "late", label: "Late", icon: Clock, value: late, format: int, tone: late ? "warn" : undefined, to: "/orders" },
        { key: "done", label: "Completed", icon: CheckCircle2, value: done, format: int, tone: "in", to: "/orders?status=Delivered" },
      ];
    }
    const pendingPay = live.filter(o => o.status !== "Rejected").reduce((s, o) => s + balanceDue(o), 0);
    return [
      { key: "open", label: "Current orders", icon: Truck, value: open.length, format: int, to: "/orders" },
      { key: "done", label: "Completed", icon: CheckCircle2, value: live.filter(o => o.status === "Delivered").length, format: int, tone: "in", to: "/orders?status=Delivered" },
      { key: "value", label: "Order value", icon: TrendingUp, value: live.filter(o => o.status !== "Rejected").reduce((s, o) => s + orderTotal(o), 0), format: usd, to: "/invoices" },
      { key: "due", label: "Pending payment", icon: Wallet, value: pendingPay, format: usd, tone: pendingPay > 0 ? "out" : undefined, to: "/invoices" },
    ];
  }, [db, live, role]);

  // What waits on someone — one button each.
  const needs: NeedRow[] = useMemo(() => {
    if (role === "client") return [];
    const out: NeedRow[] = [];
    const name = (o: Order) => db.clients.find(c => c.id === o.clientId)?.companyName ?? "";
    const waiting = live.filter(o => o.status === "Waiting");
    if (waiting.length) out.push({ key: "approve", icon: CheckCircle2, title: waiting.length === 1 ? `${waiting[0].orderNumber} is waiting for approval` : `${waiting.length} orders waiting for approval`, sub: waiting.length === 1 ? `${name(waiting[0])} · ${whatOf(waiting[0])}` : waiting.slice(0, 3).map(o => o.orderNumber).join(", "), action: { label: "Review", to: waiting.length === 1 ? `/orders/${waiting[0].id}` : "/orders?status=Waiting" }, tone: "warn" });
    for (const o of lateOpen(live).slice(0, 3)) {
      const d = daysTo(o.expectedDelivery);
      out.push({ key: `late-${o.id}`, icon: Clock, title: `${o.orderNumber} is ${d != null && d < 0 ? `${-d} days late` : "late"}`, sub: `${name(o)} · ${stageOf(o) || o.status}`, action: { label: "Open", to: `/orders/${o.id}` }, tone: "out" });
    }
    const ready = live.filter(o => o.status === "Ready");
    if (ready.length) out.push({ key: "ship", icon: Truck, title: ready.length === 1 ? `${ready[0].orderNumber} is ready to ship` : `${ready.length} orders ready to ship`, sub: ready.length === 1 ? name(ready[0]) : ready.slice(0, 3).map(o => o.orderNumber).join(", "), action: { label: "Dispatch", to: ready.length === 1 ? `/orders/${ready[0].id}` : "/orders?status=Ready" } });
    if (role === "admin") {
      // Who owes the most on what has left us.
      const by = new Map<string, number>();
      for (const o of live) if (recognisedSale(o)) { const due = balanceDue(o); if (due > 0.009) by.set(o.clientId, (by.get(o.clientId) ?? 0) + due); }
      const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) { const c = db.clients.find(x => x.id === top[0]); if (c) out.push({ key: "owed", icon: Wallet, title: `${c.companyName} owes ${fmtMoney(Math.round(top[1]))}`, sub: "on pieces already shipped", action: { label: "Record payment", to: `/clients/${c.id}` }, tone: "out" }); }
    }
    return out.slice(0, 6);
  }, [db, live, role]);

  // The pipeline — every stage, its count.
  const stages = useMemo(() => {
    const list = [
      { key: "Waiting", label: "Waiting" }, { key: "Approved", label: "Approved" }, { key: "In Production", label: "In production" },
      { key: "Ready", label: "Ready" }, { key: "Dispatched", label: "Shipped" }, { key: "Delivered", label: "Completed" },
    ].map(s => ({ ...s, count: live.filter(o => o.status === s.key).length }));
    const max = Math.max(1, ...list.map(s => s.count));
    return list.map(s => ({ ...s, pct: s.count / max }));
  }, [live]);

  const heroLine = role === "client"
    ? "Your pieces, bills and payments in one place."
    : needs.length ? `${needs.length} thing${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} you today` : "All caught up — nothing waiting on you.";

  return (
    <motion.div className="home space-y-5 sm:space-y-6" variants={LIST} initial="hidden" animate="show">
      {/* The greeting: slim, the day's two actions beside it. */}
      <motion.header variants={ITEM} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="home-title mt-1">{greet()}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{heroLine}</p>
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Link to="/orders/new" className="home-btn home-btn-primary flex-1 sm:flex-none"><Plus className="h-4 w-4" />New order</Link>
          {role === "admin" && <Link to="/ai" className="home-btn home-btn-quiet flex-1 sm:flex-none"><Sparkles className="h-4 w-4" />Ask the agent</Link>}
        </div>
      </motion.header>

      {/* The piece in the works, and the four figures beside it. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="col-span-2 lg:row-span-2"><HeroPiece heroes={heroes} /></div>
        {tiles.map((t, i) => <div key={t.key} className="min-w-0"><Tile t={t} i={i} /></div>)}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3 items-start [&>*]:min-w-0">
        {/* Needs you. */}
        {role !== "client" && (
          <motion.section variants={ITEM} className="home-card lg:col-span-2">
            <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-2">
              <h2 className="text-[15px] font-semibold text-foreground">Needs you</h2>
              {needs.length > 0 && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">{needs.length}</span>}
            </div>
            {needs.length === 0 ? (
              <div className="flex items-center gap-3 px-4 sm:px-5 pb-5 pt-2 text-sm text-muted-foreground"><CheckCircle2 className="h-5 w-5 text-success" />All caught up — nothing is waiting on you.</div>
            ) : (
              <ul className="pb-2">
                {needs.map(n => (
                  <li key={n.key} className="home-need">
                    <span className={`home-need-ico ${n.tone === "out" ? "text-destructive" : n.tone === "warn" ? "text-amber-600" : "text-muted-foreground"}`}><n.icon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground line-clamp-2">{n.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{n.sub}</p>
                    </div>
                    <Link to={n.action.to} className="home-btn home-btn-small shrink-0">{n.action.label}</Link>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        )}

        {/* The pipeline. */}
        <motion.section variants={ITEM} className={`home-card ${role === "client" ? "lg:col-span-3" : ""}`}>
          <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-2">
            <h2 className="text-[15px] font-semibold text-foreground">Orders by stage</h2>
            <Link to="/orders" className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">All<ArrowRight className="h-3 w-3" /></Link>
          </div>
          <ul className="px-2 pb-3">
            {stages.map((s, i) => (
              <li key={s.key}>
                <Link to={`/orders?status=${encodeURIComponent(s.key)}`} className="home-stage">
                  <span className="w-28 shrink-0 text-sm text-foreground/85">{s.label}</span>
                  <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <motion.span className="absolute inset-y-0 left-0 rounded-full bg-primary/70 origin-left" style={{ width: `${Math.max(s.count ? 6 : 0, s.pct * 100)}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, ease: EASE, delay: 0.2 + i * 0.04 }} />
                  </span>
                  <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{s.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          {role === "admin" && goldGrams > 0 && (
            <div className="mx-4 sm:mx-5 mb-4 flex items-center justify-between rounded-xl bg-secondary/70 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Gold in stock</span>
              <span className="font-semibold tabular-nums">{goldGrams.toLocaleString("en-IN", { maximumFractionDigits: 3 })} g</span>
            </div>
          )}
        </motion.section>
      </div>
    </motion.div>
  );
}

function greet(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
