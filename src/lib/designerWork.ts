/**
 * A designer's own login does its work through the server (functions
 * designerWork) — its device never writes to the database. These are the calls.
 * Each one is checked there against who is signed in; a refusal comes back as
 * an Error with the reason to show.
 */
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { CadJobStatus } from "./db";

/** How a design stands, in the designer's words. */
export const DESIGNER_SIDE_STATUS: Record<CadJobStatus, string> = {
  assigned: "New", working: "In progress", submitted: "Handed in", changes: "Changes asked", approved: "Approved", cancelled: "Taken back",
};
export const DESIGNER_SIDE_TONE: Record<CadJobStatus, "blue" | "amber" | "red" | "green" | "neutral" | "violet"> = {
  assigned: "blue", working: "violet", submitted: "amber", changes: "red", approved: "green", cancelled: "neutral",
};

async function call<T>(data: Record<string, unknown>): Promise<T> {
  try {
    const r = await httpsCallable<Record<string, unknown>, T>(functions, "designerWork")(data);
    return r.data;
  } catch (e) {
    const msg = (e as { message?: string })?.message;
    throw new Error(msg && !/^internal$/i.test(msg) ? msg : "Couldn't reach the office's server — check the connection and try again.");
  }
}

/** Files already uploaded to the designer's own folder, put on the design. */
export const addDesignFiles = (jobId: string, files: { name: string; url: string; mime?: string }[]) =>
  call<{ ok: true }>({ action: "addFiles", jobId, files });

/** One of their own files taken out of the design. */
export const removeDesignFile = (jobId: string, fileId: string) => call<{ ok: true }>({ action: "removeFile", jobId, fileId });

/** The design handed in for approval. */
export const submitDesign = (jobId: string, note?: string) => call<{ ok: true }>({ action: "submit", jobId, ...(note ? { note } : {}) });

export interface DesignerStatement {
  kind: "freelance" | "inhouse";
  account?: { designs: number; charged: number; opening: number; paid: number; due: number; advance: number };
  opening?: { amount: number; date: string | null } | null;
  designs?: { id: string; orderNumber: string; approvedAt: string | null; charge: number; paid: number; due: number }[];
  payments?: { id: string; at: string; amountInr: number; orderNumber: string | null }[];
  months?: { month: string; designs: number; charged: number; paid: number }[];
}
/** Their own money (freelancers): charged on approval, paid, owed now. */
export const myDesignerStatement = () => call<DesignerStatement>({ action: "statement" });
