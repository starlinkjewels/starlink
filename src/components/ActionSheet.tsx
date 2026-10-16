import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * The panel a task slides in on: a new purchase, a payment, a transfer. The
 * page behind it — balances and history — stays where it was, so nobody loses
 * their place; the form gets the panel's whole height, with what it adds up to
 * and its button held at the bottom.
 *
 * Full screen on a phone; a wide panel from the right on a laptop.
 */
export function ActionSheet({ open, onOpenChange, title, description, icon: Icon, size = "md", footer, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** md ≈ 36rem (a payment), lg ≈ 48rem (a bill with lines), xl ≈ 60rem. */
  size?: "md" | "lg" | "xl";
  /** Held at the bottom: totals and the main button. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const width = size === "xl" ? "sm:max-w-[60rem]" : size === "lg" ? "sm:max-w-[48rem]" : "sm:max-w-[36rem]";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`w-full ${width} p-0 gap-0 flex flex-col bg-background`}>
        <div className="shrink-0 px-5 sm:px-6 pt-5 pb-4 border-b border-border/60 pr-12">
          <div className="flex items-start gap-3">
            {Icon && <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0"><Icon className="h-5 w-5 text-primary" /></div>}
            <div className="min-w-0">
              <SheetTitle className="font-display text-xl text-brand-dark leading-tight">{title}</SheetTitle>
              {description
                ? <SheetDescription className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</SheetDescription>
                : <SheetDescription className="sr-only">{title}</SheetDescription>}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-border/60 bg-secondary/30 px-5 sm:px-6 py-4">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
