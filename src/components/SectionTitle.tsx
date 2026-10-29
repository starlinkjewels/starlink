import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A small ⓘ beside a title, for the one hint that prevents a mistake — shown
 * on hover with a mouse, on a tap with a finger. Guidance lives here, not in a
 * sentence under every heading.
 */
export function InfoTip({ text, label = "About this" }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label}
          onMouseEnter={e => { if (window.matchMedia("(pointer: fine)").matches) { e.currentTarget.dataset.hover = "1"; setOpen(true); } }}
          onMouseLeave={e => { if (e.currentTarget.dataset.hover) { delete e.currentTarget.dataset.hover; setOpen(false); } }}
          className="inline-grid place-items-center h-5 w-5 rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/10 align-middle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-3 text-xs leading-relaxed text-foreground/80"
        onOpenAutoFocus={e => e.preventDefault()}>
        {text}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The heading of a card or section, the same everywhere: what it is, at most
 * one short line of fact under it (an account, a period, a count — never an
 * explanation), an ⓘ for the hint that matters, and its own buttons on the right.
 */
export function SectionTitle({ title, sub, info, icon: Icon, actions, className = "" }: {
  title: ReactNode;
  /** A short fact, one line: "HDFC Current A/c", "Oct 2026", "8 orders". */
  sub?: ReactNode;
  info?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex-1 flex items-center gap-3">
        {Icon && <span className="ui-title-icon h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary grid place-items-center"><Icon className="h-[18px] w-[18px]" /></span>}
        <div className="min-w-0">
          <h2 className="ui-section-title font-display text-lg sm:text-xl text-brand-dark leading-tight flex items-center gap-1.5 min-w-0">
            <span className="truncate">{title}</span>{info && <InfoTip text={info} />}
          </h2>
          {sub && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 sm:line-clamp-1">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
