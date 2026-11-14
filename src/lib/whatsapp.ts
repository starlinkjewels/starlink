/**
 * WhatsApp from the app — a chat opened, or a message ready to send, never sent by itself.
 * Offered in the ⋯ and the right-click menu where it fits: a person's chat (client, supplier,
 * factory, broker, designer, employee) and an order's update to its client. Read-only: nothing
 * is written. The same number rule as the rest (Invoices, receipts, memo reminders): digits only,
 * no leading zeros; one too short opens WhatsApp to pick the chat instead.
 */
import { MessageCircle } from "lucide-react";
import type { MoreAction } from "@/components/MoreMenu";
import { fmtDate, type DB, type Order } from "./db";
import { brandForDocument } from "./companies";
import { currentStage, isDelivered, isDispatched } from "./pure/pipelines";
import { stageLabel } from "./stages";

/** The number as wa.me takes it ("+91 98250 12345" → "919825012345"); "" when there is none. */
export function waDigits(phone?: string | null): string {
  return (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
}
export const hasWhatsApp = (phone?: string | null) => waDigits(phone).length >= 8;

/** wa.me link: to the number when we have it (else WhatsApp asks which chat), with the text when given. */
export function waUrl(phone?: string | null, text?: string): string {
  const d = waDigits(phone);
  return `https://wa.me/${d.length >= 8 ? d : ""}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export function openWhatsApp(phone?: string | null, text?: string): void {
  window.open(waUrl(phone, text), "_blank", "noopener,noreferrer");
}

/** "WhatsApp" — a chat with this person; greyed with the reason when no number is on record. */
export function chatAction(name: string, phone?: string | null): MoreAction {
  const ok = hasWhatsApp(phone);
  return {
    label: "WhatsApp", icon: MessageCircle, disabled: !ok,
    hint: ok ? `Chat with ${name} · ${phone!.trim()}` : `No phone number on record for ${name} — add one in Edit`,
    onSelect: () => openWhatsApp(phone),
  };
}

/**
 * Where the order is, for its client — the stage by the names in Settings, courier and tracking
 * once sent, the expected day while it is made. Never a price or a cost.
 */
export function orderUpdateText(db: Pick<DB, "settings" | "clients" | "invoices">, o: Order): string {
  const client = db.clients.find(c => c.id === o.clientId);
  const from = brandForDocument(db, { clientId: o.clientId }).companyName || "";
  const piece = [o.jewelleryType, o.metal && o.metal !== "None (Diamond only)" ? o.metal : ""].filter(Boolean).join(" · ");
  const now = isDelivered(o) ? "Delivered"
    : isDispatched(o) ? `Dispatched${o.courierName ? ` with ${o.courierName}` : ""}${o.trackingNumber ? ` — tracking ${o.trackingNumber}` : ""}`
      : stageLabel(currentStage(o), db.settings);
  return [
    `Dear ${client?.ownerName?.trim() || client?.companyName || "Sir/Madam"},`,
    `Your order ${o.orderNumber}${piece ? ` (${piece})` : ""}`,
    `Now: ${now}`,
    ...(!isDispatched(o) && o.expectedDelivery ? [`Expected delivery: ${fmtDate(o.expectedDelivery)}`] : []),
    ...(from ? ["", `— ${from}`] : []),
  ].join("\n");
}

/** "Send update on WhatsApp" — the order's update, to its client's number. */
export function orderWhatsAppAction(db: Pick<DB, "settings" | "clients" | "invoices">, o: Order): MoreAction {
  const phone = db.clients.find(c => c.id === o.clientId)?.phone;
  return {
    label: "Send update on WhatsApp", icon: MessageCircle,
    hint: hasWhatsApp(phone) ? "Where the order is, to the client — no price" : "No phone for the client — WhatsApp asks which chat",
    onSelect: () => openWhatsApp(phone, orderUpdateText(db, o)),
  };
}
