import type { Caller } from "../lib/scope";
import type { ToolDef } from "../lib/sarvam";

export const TOOL_NAMES = ["find_order", "list_orders", "list_invoices", "get_account_summary"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const CLIENT_NAME_PARAM = {
  client_name: {
    type: "string",
    description: "Name of the client company to look up. Only usable by staff — omit for a client user.",
  },
};

/**
 * Tool schemas are built per-caller-role — this is the strongest scoping
 * guarantee, stronger than instructing the model to "behave": a client's
 * schemas simply have no field the model could fill in to ask about someone
 * else's data, so it's structurally impossible, not just discouraged.
 */
export function buildToolDefs(caller: Caller): ToolDef[] {
  const staffExtra = caller.role !== "client" ? CLIENT_NAME_PARAM : {};

  return [
    {
      type: "function",
      function: {
        name: "find_order",
        description:
          "Look up full details for one order by its order number: status, current production stage, " +
          "dispatch/tracking info, expected delivery date, total amount, balance due, and advance payments.",
        parameters: {
          type: "object",
          properties: {
            order_number: { type: "string", description: "The order number, e.g. SLJ-2026-1014" },
          },
          required: ["order_number"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_orders",
        description: "List orders, optionally filtered by status, most recent first.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description: "Optional exact status filter, e.g. Dispatched, Delivered, In Production, Waiting",
            },
            limit: { type: "number", description: "Max results to return, default 20, max 50" },
            ...staffExtra,
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_invoices",
        description: "List invoices, optionally filtered by order number or paid status, most recent first.",
        parameters: {
          type: "object",
          properties: {
            order_number: { type: "string", description: "Optional: only the invoice(s) for this order" },
            paid: { type: "boolean", description: "Optional: true for paid invoices, false for pending" },
            limit: { type: "number", description: "Max results to return, default 20, max 50" },
            ...staffExtra,
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_account_summary",
        description: "Total billed, received (advance payments), and outstanding balance summary.",
        parameters: {
          type: "object",
          properties: { ...staffExtra },
        },
      },
    },
  ];
}
