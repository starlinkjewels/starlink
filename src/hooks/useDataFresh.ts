import { createContext, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { toast } from "sonner";
import { dataFresh } from "@/lib/db";

/**
 * Whether the app is showing the server's answer yet — false for the first
 * second or two after opening, while it shows this device's saved copy (see
 * staleCols in lib/db.ts). Something that writes by itself when a screen opens
 * waits for this, and runs again the moment it turns true.
 */
export function useDataFresh(): boolean {
  const [fresh, setFresh] = useState(dataFresh());
  useEffect(() => {
    const on = () => setFresh(dataFresh());
    window.addEventListener("starlink-db-stale", on);
    on();
    return () => window.removeEventListener("starlink-db-stale", on);
  }, []);
  return fresh;
}

/**
 * A panel or dialog opened while the saved copy is on screen. A form in it
 * would start from those older values, and saving later would put them back
 * over newer work. So its content is held (shown, not usable) until the
 * server's answer is in; then one with fields in it is closed, to be opened
 * again from the latest, and one with nothing to fill in is simply let go.
 */
export function useHeldWhileStale(open: boolean | undefined, onOpenChange?: (open: boolean) => void) {
  const fresh = useDataFresh();
  const openedStale = useRef(false);
  /** Set by the content while it is held: whether it has anything to fill in. */
  const hasForm = useRef(false);
  if (open && !fresh) openedStale.current = true;
  useEffect(() => { if (!open) { openedStale.current = false; hasForm.current = false; } }, [open]);
  useEffect(() => {
    if (!fresh || !openedStale.current) return;
    openedStale.current = false;
    if (open && onOpenChange && hasForm.current) {
      onOpenChange(false);
      toast("Updated with the latest — open it again.");
    }
    // Only when the answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);
  return { held: !fresh, hasForm };
}

/** Passes a Dialog's hasForm (above) down to its content. */
export const HeldFormContext = createContext<MutableRefObject<boolean> | null>(null);

const FIELDS = 'input:not([type="hidden"]):not([type="search"]), textarea, select, [role="combobox"], [contenteditable="true"]';
/** While held: notes whether the content has fields to fill in. */
export function useNoteFields(held: boolean, el: RefObject<HTMLElement | null>, hasForm: MutableRefObject<boolean> | null) {
  useLayoutEffect(() => {
    if (held && hasForm && el.current) hasForm.current = hasForm.current || !!el.current.querySelector(FIELDS);
  });
}

/**
 * Bumped once when the server's answer replaces the saved copy a screen was
 * drawn from. Used as the page's key, so the page starts again from the latest:
 * a form on it (a new order, Settings) is filled from the server's answer,
 * never the older copy.
 */
export function useFreshKey(): number {
  const fresh = useDataFresh();
  const [key, setKey] = useState(0);
  const wasStale = useRef(!fresh);
  useEffect(() => {
    if (!fresh) wasStale.current = true;
    else if (wasStale.current) { wasStale.current = false; setKey(k => k + 1); }
  }, [fresh]);
  return key;
}
