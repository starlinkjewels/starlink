import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, LayoutGrid, Rows3 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MoreMenu, type MoreAction } from "@/components/MoreMenu";
import { useWideScroll } from "@/components/WideScroll";
import { InfoTip } from "@/components/SectionTitle";

/** A button in a page's header. */
export interface HeaderAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Why it's greyed, or a longer name. */
  title?: string;
}

/**
 * The top of every page, the same everywhere: where you are (and the way
 * back), the one thing most people come here to do as the main button, at
 * most one quieter button or group beside it ("Pay ▾"), and everything else
 * in the ⋯. Buttons never wrap into a second row or run off the side — on a
 * phone they sit in one row under the title, the main one taking the room.
 */
export function PageHeader({ title, subtitle, info, back, eyebrow, primary, secondary, menu, menuTitle, menuLabel, actions, children }: {
  title: ReactNode;
  /** One short line of fact — never an explanation (that goes in `info`). */
  subtitle?: ReactNode;
  /** The hint that matters, behind an ⓘ beside the title. */
  info?: ReactNode;
  /** "← Back to Suppliers". */
  back?: { label: string; to?: string; onClick?: () => void };
  /** A small line above the title — a code, a status. */
  eyebrow?: ReactNode;
  /** The page's main button — or a named group of them ("Receive ▾"). */
  primary?: HeaderAction | { label: string; icon?: LucideIcon; items: MoreAction[] } | null;
  /** One quieter button, or a named group of them shown as a menu button. */
  secondary?: HeaderAction | { label: string; icon?: LucideIcon; items: MoreAction[] } | null;
  /** The rest, in the ⋯. */
  menu?: MoreAction[];
  menuTitle?: string;
  /** The ⋯'s name for a screen reader ("Actions for Paresh"); "More actions" without it. */
  menuLabel?: string;
  /** Anything else the header needs on the right (a view switch). */
  actions?: ReactNode;
  /** Under the title: badges, a note. */
  children?: ReactNode;
}) {
  const hasActions = !!primary || !!secondary || !!menu?.some(a => a.show !== false) || !!actions;
  // Two named buttons and the ⋯ on a 390px phone: words only, no icons, so the row fits.
  const tight = !!primary && !!secondary ? "max-sm:[&_svg:first-child]:hidden" : "";
  return (
    <header className="space-y-2">
      {back && (
        back.to
          ? <Link to={back.to} className="inline-flex items-center gap-1.5 min-h-10 -my-2.5 pr-2 text-sm text-muted-foreground hover:text-foreground -ml-0.5"><ArrowLeft className="h-4 w-4" />{back.label}</Link>
          : <button type="button" onClick={back.onClick} className="inline-flex items-center gap-1.5 min-h-10 -my-2.5 pr-2 text-sm text-muted-foreground hover:text-foreground -ml-0.5"><ArrowLeft className="h-4 w-4" />{back.label}</button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          {eyebrow && <div className="text-xs text-muted-foreground mb-1">{eyebrow}</div>}
          <h1 className="font-display text-[26px] sm:text-[30px] leading-[1.15] text-brand-dark [overflow-wrap:anywhere] sm:[overflow-wrap:normal]">{title}{info && <span className="ml-2 align-middle"><InfoTip text={info} /></span>}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
          {children}
        </div>
        {hasActions && (
          <div className={`flex items-center gap-2 shrink-0 ${primary || secondary ? "max-sm:w-full" : ""}`}>
            {actions}
            {secondary && ("items" in secondary
              ? <MoreMenu button={{ label: secondary.label, icon: secondary.icon }} actions={secondary.items} className={tight} />
              : <Button variant="outline" onClick={secondary.onClick} disabled={secondary.disabled} title={secondary.title} className={`h-10 rounded-xl px-3.5 gap-2 ${tight}`}>
                  {secondary.icon && <secondary.icon className="h-4 w-4" />}{secondary.label}
                </Button>)}
            {primary && "items" in primary && (
              <MoreMenu button={{ label: primary.label, icon: primary.icon, primary: true }} actions={primary.items} className={`max-sm:flex-1 ${tight}`} />
            )}
            {primary && !("items" in primary) && (
              <Button onClick={primary.onClick} disabled={primary.disabled} title={primary.title} className={`btn-hero h-10 rounded-xl px-4 gap-2 max-sm:flex-1 ${tight}`}>
                {primary.icon && <primary.icon className="h-4 w-4" />}{primary.label}
              </Button>
            )}
            {menu && <MoreMenu title={menuTitle} label={menuLabel} actions={menu} />}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * List or Grid, for a page that has both — the same switch on every page,
 * remembered by the page itself. Names "List view" / "Grid view".
 */
export function ViewSwitch({ view, onChange }: { view: "list" | "grid"; onChange: (v: "list" | "grid") => void }) {
  const opt = (v: "list" | "grid", Icon: LucideIcon, label: string) => (
    <button type="button" onClick={() => onChange(v)} aria-label={`${label} view`} aria-pressed={view === v} title={`${label} view`}
      className={`flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors ${view === v ? "bg-white text-brand-dark shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="shrink-0 inline-flex items-stretch h-10 gap-0.5 p-1 rounded-xl bg-secondary border border-border/60">
      {opt("list", Rows3, "List")}{opt("grid", LayoutGrid, "Grid")}
    </div>
  );
}

/**
 * A row of tiles (balances, totals) that may not fit a phone: it scrolls
 * sideways, fades at the edge that has more, and can be dragged with a mouse.
 * Give it its layout classes — a grid from a tablet up, say.
 */
export function ScrollRow({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useWideScroll(ref);
  const fade = s.over ? `${s.start ? "" : "fade-l"} ${s.end ? "" : "fade-r"}` : "";
  return <div ref={ref} className={`overflow-x-auto no-scrollbar snap-x ${fade} ${className}`}>{children}</div>;
}

/**
 * A row of tabs, the same on every page: words on a quiet line, the chosen
 * one marked by a bar that slides to it. It never gets cut off — on a narrow
 * screen it scrolls sideways, fades at the edge that has more and brings the
 * chosen tab into view; the arrow keys move between tabs.
 */
export function TabBar<K extends string>({ tabs, value, onChange, label, className = "" }: {
  tabs: readonly { key: K; label: string; icon?: LucideIcon; count?: number; hint?: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useWideScroll(ref);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  // Where the chosen tab sits, for the bar under it — again whenever the row
  // changes size (a count arriving, the window turning).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const b = el.querySelector<HTMLElement>("[aria-selected=true]");
      setBar(b ? { x: b.offsetLeft, w: b.offsetWidth } : null);
    };
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    el.querySelectorAll("[role=tab]").forEach(t => ro?.observe(t));
    return () => ro?.disconnect();
  }, [value, tabs]);
  // The chosen tab slides into view inside the row — the row only, never the
  // page (scrollIntoView would move the page down to a tab bar on first show).
  useEffect(() => {
    const list = ref.current, el = list?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!list || !el) return;
    if (list.scrollWidth <= list.clientWidth + 1) return;
    list.scrollTo({ left: Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2), behavior: "smooth" });
  }, [value]);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.findIndex(t => t.key === value);
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[n].key);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-selected=true]")?.focus());
  };
  const fade = s.over ? `${s.start ? "" : "fade-l"} ${s.end ? "" : "fade-r"}` : "";
  return (
    <div className={`border-b border-border/80 ${className}`}>
      <div ref={ref} role="tablist" aria-label={label} onKeyDown={keys}
        className={`tabbar relative flex gap-1 overflow-x-auto no-scrollbar ${fade}`}>
        {tabs.map((t, i) => {
          const on = t.key === value;
          // One tab takes the Tab key: the chosen one, or the first if none is.
          const stop = on || (i === 0 && !tabs.some(x => x.key === value));
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} tabIndex={stop ? 0 : -1} onClick={() => onChange(t.key)} title={t.hint}
              className={`group shrink-0 inline-flex items-center gap-2 h-11 px-3 text-sm whitespace-nowrap transition-colors rounded-t-lg focus-visible:outline-none focus-visible:bg-primary/[0.06] ${on ? "text-brand-dark font-semibold" : "text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/50"}`}>
              {t.icon && <t.icon className={`h-4 w-4 transition-colors ${on ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground"}`} />}
              {t.label}
              {t.count !== undefined && (
                <span className={`min-w-5 h-5 px-1.5 grid place-items-center rounded-full text-[11px] font-semibold tabular-nums ${on ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>{t.count}</span>
              )}
            </button>
          );
        })}
        {bar && (
          <span aria-hidden className="absolute bottom-0 h-[2.5px] rounded-full bg-primary transition-[transform,width] duration-300 ease-out"
            style={{ width: bar.w, transform: `translateX(${bar.x}px)`, left: 0 }} />
        )}
      </div>
    </div>
  );
}
