"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "ui-scrim fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/* ── A dialog in three parts ───────────────────────────────────────────────
 * The title bar and the row of actions stay put; only the middle scrolls.
 * Every dialog in the app is written as <DialogHeader/>, its fields, and a
 * last row of buttons — so the parts are found from that, and no dialog has
 * to change to get it. A dialog that lays itself out on its own padding (a
 * photo viewer, the command palette) is left exactly as it was. */

/** Phones: a sheet up from the bottom, full width, clear of the home bar. */
const SHEET = "max-sm:inset-x-0 max-sm:left-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:max-h-[92dvh] max-sm:rounded-t-[1.75rem] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:duration-300 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100";
const MOTION = "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

const nameOf = (t: unknown): string => (typeof t === "string" ? t : (t as { displayName?: string; name?: string } | null)?.displayName ?? (t as { name?: string } | null)?.name ?? "");
const isButtonLike = (n: React.ReactNode): boolean =>
  !React.isValidElement(n) || n.type === "button" || /Button$/.test(nameOf(n.type)) || n.type === React.Fragment && React.Children.toArray((n.props as { children?: React.ReactNode }).children).every(isButtonLike);
/** The dialog's actions: a DialogFooter, or a last row holding nothing but buttons. */
function isActions(n: React.ReactNode): boolean {
  if (!React.isValidElement(n)) return false;
  if (n.type === DialogFooter) return true;
  const p = n.props as { className?: string; children?: React.ReactNode };
  if (n.type !== "div" || !/\bflex\b/.test(p.className ?? "") || /\bflex-col\b/.test(p.className ?? "")) return false;
  const kids = React.Children.toArray(p.children);
  return kids.length > 0 && kids.some(k => React.isValidElement(k)) && kids.every(isButtonLike);
}

const CloseButton = ({ className = "" }: { className?: string }) => (
  <DialogPrimitive.Close className={cn("ui-dialog-close grid h-9 w-9 place-items-center rounded-full text-muted-foreground cursor-pointer transition hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none", className)}>
    <X className="h-[18px] w-[18px]" />
    <span className="sr-only">Close</span>
  </DialogPrimitive.Close>
);

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const own = /(^|\s)(p|px|py|pt|pb|pl|pr)-\d/.test(className ?? "");
  if (!own) {
    const parts = React.Children.toArray(children);
    const hi = parts.findIndex(c => React.isValidElement(c) && c.type === DialogHeader);
    const header = hi >= 0 && hi <= 1 ? parts.splice(hi, 1)[0] : null;
    const footer = parts.length > 0 && isActions(parts[parts.length - 1]) ? parts.pop() : null;
    // The caller's spacing belongs to the middle; scrolling is the middle's own.
    const tokens = (className ?? "").split(/\s+/).filter(Boolean);
    const spacing = tokens.filter(t => /^(space-y-|gap-)/.test(t)).join(" ");
    const outer = tokens.filter(t => !/^(space-y-|gap-|overflow-|overscroll-)/.test(t)).join(" ");
    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "ui-dialog ui-dialog-framed fixed left-[50%] top-[50%] z-50 flex flex-col w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border bg-background shadow-2xl sm:rounded-2xl max-h-[min(90dvh,60rem)] overflow-hidden",
            MOTION, outer, "p-0", SHEET,
          )}
          {...props}
        >
          <div aria-hidden className="sm:hidden pointer-events-none absolute z-30 left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-foreground/15" />
          {header && <div className="ui-dialog-head shrink-0 px-6 pt-6 pb-4 pr-16 max-sm:pt-7">{header}</div>}
          {parts.length > 0 && (
            <div className={cn(
              "ui-dialog-body flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 [&>*]:min-w-0",
              header ? "pt-1" : "pt-6 pr-16", footer ? "pb-5" : "pb-6 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
              spacing ? spacing : "grid gap-4 content-start",
            )}>
              {parts}
            </div>
          )}
          {footer && <div className="ui-dialog-foot shrink-0 px-6 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">{footer}</div>}
          <CloseButton className="absolute right-4 top-4 z-30 max-sm:top-5" />
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "ui-dialog fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg max-h-[90dvh] overflow-y-auto overscroll-contain",
        className,
        // Phones: a sheet up from the bottom, full width, clear of the home bar.
        "max-sm:inset-x-0 max-sm:left-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:max-h-[92dvh] max-sm:rounded-t-[1.75rem] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:duration-300 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100",
      )}
      {...props}
    >
      <div aria-hidden className="sm:hidden pointer-events-none absolute z-30 left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-foreground/15" />
      {children}
      {/* Last for the keyboard (the first field still gets the cursor), first on
          screen: a zero-height strip pinned to the top, so the close button
          stays in the corner however far the dialog scrolls. */}
      <div className="ui-dialog-close-wrap order-first sticky -top-6 z-20 h-0 -mb-4 pointer-events-none">
        <DialogPrimitive.Close className="ui-dialog-close pointer-events-auto absolute -right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-[var(--dlg-bg,transparent)] text-muted-foreground opacity-80 ring-offset-background cursor-pointer transition hover:opacity-100 hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-dialog-header flex flex-col gap-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("ui-dialog-footer flex flex-wrap items-center justify-end gap-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
