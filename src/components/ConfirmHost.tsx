import { useSyncExternalStore } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { subscribeConfirm, currentConfirm } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

/** Shows the questions lib/confirm.ts asks, one at a time. Mounted once, at the root. */
export function ConfirmHost() {
  const req = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm);
  return (
    <Dialog open={!!req} onOpenChange={v => { if (!v && req) req.resolve(false); }}>
      {req && (
        <DialogContent key={req.id} className="max-w-md rounded-2xl" onOpenAutoFocus={e => {
          // A risky action starts on the safe button, so Enter does not do it by accident.
          if (req.danger) { e.preventDefault(); (document.querySelector("[data-confirm-cancel]") as HTMLElement | null)?.focus(); }
        }}>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className={`h-10 w-10 shrink-0 rounded-2xl grid place-items-center ${req.danger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                {req.danger ? <AlertTriangle className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
              </span>
              <div className="min-w-0 pt-0.5">
                <DialogTitle className="font-display text-xl text-brand-dark leading-snug">{req.title}</DialogTitle>
                {!req.body && <DialogDescription className="sr-only">Confirm or go back.</DialogDescription>}
              </div>
            </div>
          </DialogHeader>
          {req.body && (
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{req.body}</div>
            </DialogDescription>
          )}
          <DialogFooter>
            <Button variant="outline" data-confirm-cancel onClick={() => req.resolve(false)} className="rounded-xl">{req.cancelText}</Button>
            <Button onClick={() => req.resolve(true)}
              className={`rounded-xl px-5 ${req.danger ? "bg-destructive text-white hover:bg-destructive/90" : "btn-hero"}`}>
              {req.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
