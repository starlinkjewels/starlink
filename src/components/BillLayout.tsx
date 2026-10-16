import { useId, type ComponentProps, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/*
 * The pieces the Buy & Assign panels are laid out with, so the four of them
 * read as one set: groups of fields ruled off from each other, and a footer
 * holding what the entry adds up to and the button that saves it. Purely
 * presentational: no data, no writes.
 *
 * Sizes come from container queries (`@container` / `@md:`) rather than
 * screen breakpoints — a panel is full screen on a phone and a fixed width on
 * a laptop, so the screen says little about the room the fields have.
 */

/** A group of fields in a panel, ruled off from the group above it. */
export function Group({ title, aside, children, className = "" }: {
  title?: string; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`border-t border-border/60 pt-5 first:border-t-0 first:pt-0 ${className}`}>
      {(title || aside) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A labelled field — the label above, the control under it.
 *
 * The label stays a direct child of the field's own box, so a field can be
 * found by its label text. Pass the control as a function to have the label
 * point at it (`{id => <Input id={id} … />}`); controls that name themselves
 * (aria-label) can be passed as they are.
 */
export function Field({ label, required, hint, className = "", labelClassName = "", children }: {
  label: ReactNode; required?: boolean; hint?: ReactNode; className?: string; labelClassName?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  const linked = typeof children === "function";
  return (
    <div className={`min-w-0 ${className}`}>
      <Label htmlFor={linked ? id : undefined} className={`text-xs ${labelClassName}`}>
        {label}{required && <> <span className="text-destructive">*</span></>}
      </Label>
      <div className="mt-1">{linked ? children(id) : children}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

/** A figure box with its unit written inside it, right-aligned the way a bill reads. */
export function UnitInput({ unit, className = "", ...props }: ComponentProps<typeof Input> & { unit?: string }) {
  return (
    <div className="relative">
      <Input type="number" {...props}
        // No spinner arrows: they sat on top of the unit, and nobody steps a rate by 1.
        className={`h-10 rounded-xl text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${unit ? (unit.length > 2 ? "pr-12" : "pr-8") : ""} ${className}`} />
      {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>}
    </div>
  );
}

/**
 * One choice of a few — the kind of thing an entry is about.
 * Each option stays a plain button named by its label (aria-pressed marks the
 * chosen one); with four options the icons drop out when there is no room.
 */
export function Segmented<K extends string>({ value, onChange, options, className = "" }: {
  value: K; onChange: (k: K) => void;
  options: readonly (readonly [K, string, LucideIcon?])[];
  className?: string;
}) {
  const icon = options.length > 3 ? "hidden @[22rem]:block" : options.length === 3 ? "hidden @[16rem]:block" : "block";
  return (
    <div className={`@container min-w-0 ${className}`}>
      <div className="grid gap-1 p-1 bg-secondary rounded-xl" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
            className={`flex items-center justify-center gap-1.5 h-8 px-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-w-0 ${value === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground hover:text-foreground"}`}>
            {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${icon}`} />}
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A small figure with its caption, for a panel footer's summary. */
export function Stat({ label, value, sub, big, className = "" }: {
  label: string; value: ReactNode; sub?: ReactNode; big?: boolean; className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tabular-nums text-brand-dark truncate ${big ? "font-display text-2xl font-bold leading-tight" : "text-sm font-semibold mt-0.5"}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
    </div>
  );
}

/** A row of Stats: two to a row on a phone, side by side when there is room. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">{children}</div>;
}

/** The panel's buttons: Cancel, and the one that saves. A quiet note can sit beside them. */
export function PanelActions({ note, onCancel, children }: { note?: ReactNode; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
      {note ? <p className="text-[11px] text-muted-foreground leading-snug sm:flex-1 min-w-0">{note}</p> : <div className="hidden sm:block sm:flex-1" />}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel} className="h-11 rounded-xl">Cancel</Button>
        {children}
      </div>
    </div>
  );
}
