import type { LucideIcon } from "lucide-react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

/**
 * The "⋯" at the top right of a page or card: the one main action stays a
 * button beside it, everything else waits in here. Renders nothing when no
 * action applies, so a page never shows an empty menu.
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
  button?: { label: string; icon?: LucideIcon; primary?: boolean };
}) {
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
  return (
    <DropdownMenu modal={false} onOpenChange={o => { if (o) onOpen?.(); }}>
      <DropdownMenuTrigger asChild>
        {button ? (
          <Button type="button" variant={button.primary ? "default" : "outline"} aria-label={label === "More actions" ? button.label : label}
            className={`h-10 rounded-xl px-3.5 gap-2 shrink-0 ${button.primary ? "btn-hero px-4" : ""} ${className}`}>
            {button.icon && <button.icon className="h-4 w-4" />}<span>{button.label}</span><ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        ) : (
          <Button type="button" variant="outline" aria-label={label} title={label}
            className={`${size === "xs" ? "h-8 w-8 rounded-lg border-transparent bg-transparent" : size === "sm" ? "h-8 w-8 max-sm:h-10 max-sm:w-10 rounded-lg border-transparent bg-transparent text-muted-foreground hover:text-foreground" : "h-10 w-10 rounded-xl"} p-0 shrink-0 ${className}`}>
            <MoreHorizontal className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
          </Button>
        )}
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
