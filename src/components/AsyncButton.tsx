import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { flush } from "@/lib/db";

type AsyncButtonProps = Omit<ButtonProps, "onClick" | "asChild"> & {
  /** Click handler. May be sync or async and return anything; the button stays
   *  busy until it (and any Firebase write it triggers) has settled. */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => unknown;
};

/**
 * A Button that shows a spinner and disables itself while its action — and the
 * resulting Firebase write — is in progress. Because all writes go through the
 * store's queue, awaiting flush() after the handler keeps the button "busy"
 * until the change is actually committed to Firestore. Use for any button that
 * mutates data.
 */
export const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  ({ onClick, children, disabled, ...props }, ref) => {
    const [busy, setBusy] = React.useState(false);
    const mounted = React.useRef(true);
    React.useEffect(() => () => { mounted.current = false; }, []);

    const handle = async (e: React.MouseEvent<HTMLButtonElement>) => {
      if (busy) return;
      setBusy(true);
      try {
        await onClick?.(e);   // run the action (may enqueue a Firebase write)
        await flush();        // wait until the write actually commits
      } catch (err) {
        console.error("[AsyncButton] action failed:", err);
      } finally {
        if (mounted.current) setBusy(false);
      }
    };

    return (
      <Button ref={ref} onClick={handle} disabled={disabled || busy} aria-busy={busy} {...props}>
        {busy ? <Loader2 className="animate-spin" /> : children}
      </Button>
    );
  },
);
AsyncButton.displayName = "AsyncButton";
