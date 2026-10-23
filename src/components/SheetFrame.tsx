import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";

/** What a payment form hands its panel: the ActionSheet's own props. */
export type FrameParts = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  size?: "md" | "lg" | "xl";
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * How a payment form is framed. On its own (Payments, a party's page) it is a
 * panel of its own; inside the Locker's "Record transaction" it is the body of
 * that one panel, under its In / Out and "Who" choices — the same form, the
 * same save, so money recorded from either place lands in the same books.
 */
export type Frame = (p: FrameParts) => ReactNode;

export const sheetFrame: Frame = p => <ActionSheet {...p} />;

/** Inside another panel: the body where the form sits, the footer (totals and
 *  Save) carried down into that panel's footer slot. */
export function embedFrame(footer: HTMLElement | null): Frame {
  return p => (
    <>
      {p.children}
      {footer && p.footer ? createPortal(p.footer, footer) : null}
    </>
  );
}
