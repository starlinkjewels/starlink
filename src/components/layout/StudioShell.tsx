import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronRight, LogOut, MoreHorizontal, Users, Wallet, X, type LucideIcon } from "lucide-react";

/**
 * The app's frame in the new look (preview): menus grouped by the job, a
 * phone tab bar of Home · Orders · Parties · Money · More, sheets that open
 * from the bottom, and a back arrow in the phone's top bar on inner pages.
 *
 * Pages are named here only by their address. The words and pictures come
 * from the caller's own menu list (each business's build keeps its own), and
 * so does who may see what — this file only arranges them.
 */
export interface ShellItem { to: string; label: string; icon: LucideIcon }

/** The sidebar, by job. An untitled group is the top of the list. */
export const STUDIO_SIDEBAR: { title: string; paths: string[] }[] = [
  { title: "", paths: ["/", "/orders", "/catalog"] },
  { title: "Sales", paths: ["/clients", "/invoices", "/ready-stock", "/gift-cards", "/giftcard", "/product-photos"] },
  { title: "Production", paths: ["/suppliers", "/factories", "/stock", "/buy-assign"] },
  { title: "Money", paths: ["/payments", "/income", "/locker", "/expenses", "/reports"] },
  { title: "Workspace", paths: ["/messages", "/notifications", "/ai", "/employees", "/activity", "/settings"] },
];

/** The phone's Parties and Money sheets, with one line on what each is for. */
const PARTIES: [string, string][] = [
  ["/clients", "Who buys from you"],
  ["/suppliers", "Who you buy from — and brokers"],
  ["/factories", "Who makes your pieces"],
];
const MONEY: [string, string][] = [
  ["/payments", "Money in and out"],
  ["/income", "Every entry, in order"],
  ["/locker", "Cash and bank accounts"],
  ["/expenses", "Running costs"],
  ["/reports", "Profit, sales and dues"],
];
/** The phone's More sheet: everything else, by job. */
const MORE: { title: string; paths: string[] }[] = [
  { title: "Sales", paths: ["/catalog", "/invoices", "/ready-stock", "/gift-cards", "/giftcard", "/product-photos"] },
  { title: "Production", paths: ["/stock", "/buy-assign"] },
  { title: "Money", paths: ["/income", "/reports"] },
  { title: "Workspace", paths: ["/messages", "/notifications", "/ai", "/employees", "/activity", "/settings"] },
  { title: "You", paths: ["/profile", "/search"] },
];

const under = (path: string, to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));

/** Build the sidebar groups from the caller's (already filtered) items. */
export function studioSidebarGroups(items: ShellItem[]): { title: string; items: ShellItem[] }[] {
  const by = new Map(items.map(i => [i.to, i]));
  return STUDIO_SIDEBAR
    .map(g => ({ title: g.title, items: g.paths.map(p => by.get(p)).filter((i): i is ShellItem => !!i) }))
    .filter(g => g.items.length > 0);
}

type Row = ShellItem & { hint?: string };

/** A sheet from the bottom of the phone: titled groups of rows. */
function Sheet({ open, onClose, title, sub, groups, footer }: {
  open: boolean; onClose: () => void; title: string; sub?: ReactNode;
  groups: { title?: string; rows: Row[] }[]; footer?: ReactNode;
}) {
  const navigate = useNavigate();
  const loc = useLocation();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            className="ui-scrim md:hidden fixed inset-0 z-50 bg-black/40" onClick={onClose} />
          <motion.div key="sheet" role="dialog" aria-modal="true" aria-label={title}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 32, stiffness: 340 }}
            className="ui-dialog md:hidden fixed bottom-0 inset-x-0 z-50 bg-card rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: "88vh" }}>
            <div className="flex justify-center pt-2.5 pb-1 shrink-0"><div className="h-1 w-9 rounded-full bg-border" /></div>
            <div className="flex items-center justify-between px-5 pt-1 pb-3 shrink-0">
              <div className="min-w-0">
                <p className="text-[17px] font-semibold text-foreground">{title}</p>
                {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="h-9 w-9 -mr-1.5 rounded-full grid place-items-center text-muted-foreground hover:bg-secondary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-2" style={{ paddingBottom: footer ? undefined : "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
              {groups.map((g, gi) => (
                <div key={g.title ?? gi} className={gi ? "mt-3" : ""}>
                  {g.title && <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.title}</p>}
                  <div className="rounded-xl border border-border/70 overflow-hidden divide-y divide-border/60">
                    {g.rows.map(r => {
                      const on = under(loc.pathname, r.to);
                      return (
                        <button key={r.to} type="button" onClick={() => { onClose(); navigate(r.to); }} aria-current={on ? "page" : undefined}
                          className={`w-full flex items-center gap-3 px-3.5 min-h-[52px] py-2 text-left active:bg-secondary ${on ? "bg-primary/[0.06]" : "bg-card"}`}>
                          <r.icon className={`h-5 w-5 shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`} />
                          <span className="min-w-0 flex-1">
                            <span className={`block text-[15px] ${on ? "text-primary font-semibold" : "text-foreground font-medium"}`}>{r.label}</span>
                            {r.hint && <span className="block text-xs text-muted-foreground truncate">{r.hint}</span>}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {footer && <div className="shrink-0 px-3 pt-2 border-t border-border/60" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * The phone's tab bar: Home · Orders · Parties · Money · More for the team;
 * the client portal keeps Home · Orders · Catalog · Chat · More. Parties,
 * Money and More open a sheet; a tab with nothing in it for this person is left out.
 */
export function StudioTabBar({ items, isClient, hidden, user, onSignOut }: {
  items: ShellItem[]; isClient: boolean; hidden: boolean;
  user: { name: string; role: string }; onSignOut: () => void;
}) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<null | "parties" | "money" | "more">(null);
  useEffect(() => { setSheet(null); }, [loc.pathname]);
  const by = new Map(items.map(i => [i.to, i]));
  const rows = (list: [string, string][]): Row[] => list.flatMap(([to, hint]) => { const i = by.get(to); return i ? [{ ...i, hint }] : []; });
  const parties = isClient ? [] : rows(PARTIES);
  const money = isClient ? [] : rows(MONEY);

  // Tabs that go straight to a page, and the ones that open a sheet.
  const direct: ShellItem[] = (isClient ? ["/", "/orders", "/catalog", "/messages"] : ["/", "/orders"])
    .map(p => by.get(p)).filter((i): i is ShellItem => !!i)
    .map(i => (i.to === "/" ? { ...i, label: "Home" } : i.to === "/messages" ? { ...i, label: "Chat" } : i));
  // More holds whatever is not already a tab or in the Parties / Money sheets.
  const elsewhere = new Set([...direct, ...parties, ...money].map(i => i.to));
  const moreGroups = MORE
    .map(g => ({ title: g.title, rows: g.paths.filter(p => !elsewhere.has(p)).map(p => by.get(p)).filter((i): i is ShellItem => !!i) }))
    .filter(g => g.rows.length > 0);

  const inParties = parties.some(r => under(loc.pathname, r.to));
  const inMoney = money.some(r => under(loc.pathname, r.to));
  const inDirect = direct.some(i => under(loc.pathname, i.to));
  const inMore = !inParties && !inMoney && !inDirect && loc.pathname !== "/";

  const tab = (key: string, label: string, Icon: LucideIcon, on: boolean, onClick: () => void, badge = 0) => (
    <button key={key} type="button" onClick={onClick} aria-current={on ? "page" : undefined}
      className={`relative flex-1 flex flex-col items-center gap-0.5 pt-1.5 pb-1 text-[10.5px] font-medium transition-colors ${on ? "text-primary" : "text-muted-foreground"}`}>
      <span className={`h-7 w-12 rounded-full grid place-items-center transition-colors ${on ? "bg-primary/10" : ""}`}><Icon className="h-[21px] w-[21px]" /></span>
      {label}
      {badge > 0 && <span className="absolute top-0.5 left-1/2 ml-2.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9.5px] font-bold grid place-items-center leading-none">{badge > 9 ? "9+" : badge}</span>}
    </button>
  );

  return (
    <>
      <nav aria-label="Main" className={`app-tabbar md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/70 bg-card/95 backdrop-blur-xl flex items-stretch px-1 ${hidden ? "hidden" : ""}`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.25rem)" }}>
        {direct.map(i => tab(i.to, i.label, i.icon, under(loc.pathname, i.to), () => navigate(i.to)))}
        {parties.length > 0 && tab("parties", "Parties", Users, inParties, () => setSheet("parties"))}
        {money.length > 0 && tab("money", "Money", Wallet, inMoney, () => setSheet("money"))}
        {/* Unread alerts show on the bell in the top bar, not twice. */}
        {tab("more", "More", MoreHorizontal, inMore, () => setSheet("more"))}
      </nav>
      <Sheet open={sheet === "parties"} onClose={() => setSheet(null)} title="Parties" groups={[{ rows: parties }]} />
      <Sheet open={sheet === "money"} onClose={() => setSheet(null)} title="Money" groups={[{ rows: money }]} />
      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title="More" sub={user.name && user.name !== user.role ? `${user.name} · ${user.role}` : user.role} groups={moreGroups}
        footer={
          <button type="button" onClick={onSignOut} className="w-full flex items-center gap-3 px-3.5 min-h-[48px] rounded-xl text-[15px] font-medium text-destructive active:bg-destructive/10">
            <LogOut className="h-5 w-5" />Sign out
          </button>
        } />
    </>
  );
}

/** "/suppliers/abc" → "/suppliers"; null on a top-level page. */
export function parentPath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  // A new order is a task on the Orders list.
  return "/" + parts[0];
}

/**
 * The phone's top bar on an inner page: a back arrow named after where it
 * goes ("‹ Suppliers") in place of the logo. Back means back — the page you
 * came from when there is one in this app, else the list the page belongs to.
 */
export function StudioBackButton({ items }: { items: ShellItem[] }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const parent = parentPath(loc.pathname);
  if (!parent) return null;
  const label = items.find(i => i.to === parent)?.label ?? "Back";
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1); else navigate(parent);
  };
  return (
    <button type="button" onClick={back} aria-label={`Back to ${label}`}
      className="md:hidden flex items-center gap-1 -ml-2 pl-1 pr-2 h-10 rounded-lg text-[15px] font-medium text-primary active:bg-primary/10 min-w-0">
      <ArrowLeft className="h-5 w-5 shrink-0" /><span className="truncate">{label}</span>
    </button>
  );
}
