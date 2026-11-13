import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useBackToClose } from "@/hooks/useBackNav";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type MoreAction = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => unknown;
  /** A second, quieter line under the label. */
  hint?: string;
  /** Cancel, delete, melt: red, and kept at the bottom below a line. */
  danger?: boolean;
  disabled?: boolean;
  /** Left out of the menu when false. */
  show?: boolean;
};

/** A phone-width screen: the menu opens as a panel from the bottom, in thumb's reach. */
function usePhoneMenu(): boolean {
  const query = "(max-width: 639px)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

/**
 * The "⋯" at the top right of a page or card: the one main action stays a
 * button beside it, everything else waits in here. Renders nothing when no
 * action applies, so a page never shows an empty menu.
 *
 * On a phone it opens as a panel from the bottom of the screen — big rows in
 * thumb's reach, each one's reason under it — instead of a small dropdown at
 * the top; the phone's Back closes it.
 */
export function MoreMenu({ actions, label = "More actions", title, className = "", size = "md", onOpen, button }: {
  actions: MoreAction[];
  label?: string;
  /** A heading inside the menu. */
  title?: string;
  className?: string;
  /** "sm" on a card, "md" in a page header, "xs" where a card is too narrow
   *  for the larger phone tap size (the grid of order photos). */
  size?: "xs" | "sm" | "md";
  /** Called as the menu opens — to load what its items need only when
   *  someone actually looks (they show "Checking…" until it is here). */
  onOpen?: () => void;
  /** A labelled button ("Pay ▾") instead of the ⋯ — for a group of actions
   *  that share a name, beside a page's main button. */
  /** `short`: the word on a phone, where the full name would push the title aside ("Add"). */
  button?: { label: string; short?: string; icon?: LucideIcon; primary?: boolean };
}) {
  const phone = usePhoneMenu();
  const [sheetOpen, setSheetOpen] = useState(false);
  useBackToClose(sheetOpen, () => setSheetOpen(false));
  const shown = actions.filter(a => a.show !== false);
  if (!shown.length) return null;
  const safe = shown.filter(a => !a.danger);
  const danger = shown.filter(a => a.danger);
  // Run after the menu has closed, so a dialog it opens takes the focus cleanly.
  const run = (a: MoreAction) => setTimeout(() => {
    Promise.resolve().then(a.onSelect).catch(e => toast.error(e instanceof Error ? e.message : "That didn't work"));
  }, 0);
  const item = (a: MoreAction) => (
    <DropdownMenuItem key={a.label} disabled={a.disabled} onSelect={() => run(a)}
      className={`rounded-lg gap-2.5 py-2 cursor-pointer items-start ${a.danger ? "text-destructive focus:text-destructive focus:bg-destructive/10" : ""}`}>
      {a.icon && <a.icon className={`h-4 w-4 mt-0.5 shrink-0 ${a.danger ? "" : "text-muted-foreground"}`} />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{a.label}</span>
        {/* At most two lines. A greyed item can't show a tooltip, so its reason
            (and what to do instead) has to fit here. */}
        {a.hint && <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2" title={a.hint}>{a.hint}</span>}
      </span>
    </DropdownMenuItem>
  );
  const trigger = (extra: { onClick?: () => void }) => (button ? (
    <Button type="button" variant={button.primary ? "default" : "outline"} aria-label={label === "More actions" ? button.label : label} {...extra}
      className={`h-10 rounded-xl px-3.5 gap-2 shrink-0 ${button.primary ? "btn-hero px-4" : ""} ${className}`}>
      {button.icon && <button.icon className="h-4 w-4" />}
      {button.short
        ? <><span className="sm:hidden">{button.short}</span><span className="max-sm:hidden">{button.label}</span></>
        : <span>{button.label}</span>}
      <ChevronDown className="h-4 w-4 opacity-60" />
    </Button>
  ) : (
    <Button type="button" variant="outline" aria-label={label} title={label} {...extra}
      className={`${size === "xs" ? "h-8 w-8 rounded-lg border-transparent bg-transparent" : size === "sm" ? "h-8 w-8 max-sm:h-10 max-sm:w-10 rounded-lg border-transparent bg-transparent text-muted-foreground hover:text-foreground" : "h-10 w-10 rounded-xl"} p-0 shrink-0 ${className}`}>
      <MoreHorizontal className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
    </Button>
  ));

  // A phone: the same actions, as a panel from the bottom.
  if (phone) {
    const row = (a: MoreAction) => (
      <button key={a.label} type="button" role="menuitem" disabled={a.disabled}
        onClick={() => { setSheetOpen(false); setTimeout(() => run(a), 120); }}
        className={`w-full flex items-start gap-3 px-3 py-3 min-h-12 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:bg-secondary disabled:opacity-45 ${a.danger ? "text-destructive active:bg-destructive/10" : "active:bg-secondary"}`}>
        {a.icon && <a.icon className={`h-5 w-5 mt-0.5 shrink-0 ${a.danger ? "" : "text-muted-foreground"}`} />}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug">{a.label}</span>
          {a.hint && <span className="block text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2">{a.hint}</span>}
        </span>
      </button>
    );
    return (
      <>
        {trigger({ onClick: () => { onOpen?.(); setSheetOpen(true); } })}
        {/* A card or row around the ⋯ must not open as well: React events travel up from
            the panel and its backdrop (a tap outside it) to whatever holds the ⋯. Clicks and
            keys only — the panel closes on a tap outside by its pointer-down, left alone. */}
        <span className="contents" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" aria-describedby={undefined} className="rounded-t-2xl p-0 gap-0 max-h-[85dvh] flex flex-col">
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border shrink-0" aria-hidden />
            <SheetTitle className="px-5 pt-3 pb-1 pr-12 text-sm font-semibold text-foreground truncate">{title ?? (label === "More actions" ? (button?.label ?? "Actions") : label)}</SheetTitle>
            <div role="menu" aria-label={label} className="overflow-y-auto px-2 pt-1 pb-[max(env(safe-area-inset-bottom),12px)]">
              {safe.map(row)}
              {safe.length > 0 && danger.length > 0 && <div role="separator" className="my-1 mx-3 h-px bg-border" />}
              {danger.map(row)}
            </div>
          </SheetContent>
        </Sheet>
        </span>
      </>
    );
  }

  return (
    <DropdownMenu modal={false} onOpenChange={o => { if (o) onOpen?.(); }}>
      <DropdownMenuTrigger asChild>
        {trigger({})}
      </DropdownMenuTrigger>
      {/* Lined up with the button's right edge: these buttons sit at the right of a
          card or page, and opening rightwards ran the menu off the screen. */}
      <DropdownMenuContent align="end" collisionPadding={12} className="w-64 max-w-[calc(100vw-2rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl p-1.5">
        {title && <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</DropdownMenuLabel>}
        {safe.map(item)}
        {safe.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
