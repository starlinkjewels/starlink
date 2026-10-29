// CAD designers — who designs our pieces, the design jobs we give them, and,
// for a freelancer, what we owe them.
//
// Two kinds of designer:
//  • In-house — one of our employees. The designer record links to the
//    employee (users): salary, department and login stay there, and salary is
//    paid there exactly as before. Here we only follow their design work.
//  • Freelancer — paid per design. The agreed charge is booked when we APPROVE
//    the design (cancelled or rejected work costs nothing), and paid from an
//    account like any other party: a payment is an account entry with refType
//    "designerPayment" (refId = the designer), against one design (cadJobId)
//    or on account, settling their oldest approved designs first.
//
// A design job is one design for one order: the designer's folder (images,
// 3D models, videos, anything) and the brief. It is kept apart from the order
// on purpose — an order carries the client, prices and payments, and a
// security rule can only hide a whole document — so whatever a designer may
// one day open holds only what designing needs: no client, no prices.
import {
  uid, isDiamondOnlyOrder, openingCreditAmt, openingDebitAmt,
  type CadJob, type CadJobFile, type CadJobStatus, type DB, type Designer, type LockerTransaction, type Order,
} from "./db";
import { notifyUsers } from "./notify";
import { followOrderPictures, orderPictures } from "./readyStockPhotos";
import { metalLabel } from "./metals";
import { fmtG } from "./weights";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const KIND_LABEL: Record<Designer["kind"], string> = { inhouse: "In-house", freelance: "Freelancer" };

export const STATUS_LABEL: Record<CadJobStatus, string> = {
  assigned: "Assigned", working: "Working", submitted: "Submitted", changes: "Changes asked", approved: "Approved", cancelled: "Cancelled",
};
export const STATUS_TONE: Record<CadJobStatus, "blue" | "amber" | "red" | "green" | "neutral" | "violet"> = {
  assigned: "blue", working: "violet", submitted: "amber", changes: "red", approved: "green", cancelled: "neutral",
};
/** Still being worked on — not approved, not cancelled. */
export const OPEN_STATUSES: CadJobStatus[] = ["assigned", "working", "submitted", "changes"];
export const isOpenJob = (j: Pick<CadJob, "status">) => OPEN_STATUSES.includes(j.status);

/* ── Who ─────────────────────────────────────────────────────────────── */

export function designerOf(db: Pick<DB, "designers">, id: string | undefined): Designer | undefined {
  return id ? (db.designers ?? []).find(x => x.id === id) : undefined;
}

/** The login that gets the app's alerts: an in-house designer's employee record. */
export function designerUserId(d: Pick<DB, "users">, designer: Designer): string | undefined {
  if (!designer.userId) return undefined;
  const u = d.users.find(x => x.id === designer.userId);
  return u && u.status !== "inactive" ? u.id : undefined;
}

/** Where their email goes: their own, else the linked employee's. */
export function designerEmail(db: Pick<DB, "users">, designer: Designer): string | undefined {
  const own = designer.email?.trim();
  if (own) return own;
  return designer.userId ? db.users.find(x => x.id === designer.userId)?.email?.trim() || undefined : undefined;
}

/** The designers that can be given work: active ones, in-house first, then by name. */
export function activeDesigners(db: Pick<DB, "designers">): Designer[] {
  return (db.designers ?? []).filter(x => x.active !== false)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "inhouse" ? -1 : 1) || a.name.localeCompare(b.name));
}

/* ── Which orders, which jobs ────────────────────────────────────────── */

/** A design is for a piece we make: not loose stones, not a ready-stock sale, not a rejected or deleted order. */
export function designableWhy(o: Pick<Order, "metal" | "materialSourcing" | "status" | "deletedAt">): string | undefined {
  if (o.deletedAt) return "This order was deleted";
  if (isDiamondOnlyOrder(o)) return "Loose stones are not designed";
  if (o.materialSourcing === "readyStock") return "A ready-stock piece is already made";
  if (o.status === "Rejected") return "This order was rejected";
  return undefined;
}

/** An order's design jobs, newest first. */
export function jobsOfOrder(db: Pick<DB, "cadJobs">, orderId: string): CadJob[] {
  return (db.cadJobs ?? []).filter(j => j.orderId === orderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The design an order goes by now: the newest that was not cancelled. */
export function currentJob(db: Pick<DB, "cadJobs">, orderId: string): CadJob | undefined {
  return jobsOfOrder(db, orderId).find(j => j.status !== "cancelled");
}

export function jobsOfDesigner(db: Pick<DB, "cadJobs">, designerId: string): CadJob[] {
  return (db.cadJobs ?? []).filter(j => j.designerId === designerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ── The brief ───────────────────────────────────────────────────────── */

/** What to design, copied from the order — never the client, never a price. */
export function briefFromOrder(o: Order): CadJob["brief"] {
  const stones = [
    o.diamondWeight ? `${o.diamondWeight} ct (est.)` : "",
    o.diamondShape || "",
    o.diamondType || "",
  ].filter(Boolean).join(" · ");
  const weights = [
    o.estimatedGrossWeight ? `gross ${fmtG(o.estimatedGrossWeight)} g` : "",
    o.estimatedNetWeight ? `net ${fmtG(o.estimatedNetWeight)} g` : "",
  ].filter(Boolean).join(" · ");
  const extras = [
    o.engraving?.text ? `Engraving: "${o.engraving.text}" (${o.engraving.font})` : "",
    o.stamping && !/^no stamping$/i.test(o.stamping) ? `Stamping: ${o.stamping}` : "",
    o.rhodium && !/^no rhodium$/i.test(o.rhodium) ? `Rhodium: ${o.rhodium}` : "",
  ].filter(Boolean);
  const instructions = [o.instructions?.trim(), ...extras].filter(Boolean).join("\n");
  const brief: CadJob["brief"] = {
    piece: [o.jewelleryType, o.quantity > 1 ? `× ${o.quantity}` : ""].filter(Boolean).join(" ") || undefined,
    metal: metalLabel(o.metal) || undefined,
    karat: o.productKarats || undefined,
    colour: o.productColor || undefined,
    size: o.productSize || undefined,
    stones: stones || undefined,
    designNo: o.designNumber?.trim() || undefined,
    weightNote: weights ? `Estimated ${weights}` : undefined,
    instructions: instructions || undefined,
    references: (o.images ?? []).filter(u => /^https?:\/\//i.test(u)),
  };
  // Firestore refuses an undefined field.
  return Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as CadJob["brief"];
}

/** The brief as label · value rows, for the screen and the email. */
export function briefRows(b: CadJob["brief"]): [string, string | undefined][] {
  return [
    ["Piece", b.piece],
    // "14K Yellow Gold", never "14K Yellow Yellow Gold" when the metal already names the colour.
    ["Metal", [b.karat, b.colour && !(b.metal ?? "").toLowerCase().includes(b.colour.toLowerCase()) ? b.colour : undefined, b.metal].filter(Boolean).join(" ") || undefined],
    ["Size", b.size],
    ["Stones", b.stones],
    ["Design no.", b.designNo],
    ["Weight", b.weightNote],
    ["Instructions", b.instructions],
  ];
}

/* ── Doing things ────────────────────────────────────────────────────── */

export interface Who { id: string; name: string }

const log = (j: CadJob, by: Who, text: string, at = new Date().toISOString()) => {
  j.history = [...(j.history ?? []), { at, by: by.id, byName: by.name, text }];
  j.updatedAt = at;
};

/** Tell the designer in the app (an in-house designer has a login; email is sent by the caller). */
function tellDesigner(d: DB, designer: Designer, title: string, body: string, by: Who) {
  const uidOf = designerUserId(d, designer);
  if (uidOf) notifyUsers(d, [uidOf], { title, body, type: "design" }, by.id);
}

/**
 * Give an order's design to a designer. A design still being worked on by
 * someone else is cancelled (and they are told); an approved one stays as it
 * was — a new job is a redesign. Returns the new job, or why it can't be done.
 * Call inside updateDb.
 */
export function assignDesigner(d: DB, a: { orderId: string; designerId: string; rate?: number; dueDate?: string; note?: string; by: Who }): CadJob | string {
  const order = d.orders.find(o => o.id === a.orderId);
  if (!order) return "This order is not there any more";
  const why = designableWhy(order);
  if (why) return why;
  const designer = designerOf(d, a.designerId);
  if (!designer || designer.active === false) return "Choose an active designer";
  // Every check before anything changes: a refusal leaves the data as it was.
  const open = (d.cadJobs ?? []).filter(j => j.orderId === order.id && isOpenJob(j));
  if (open.some(j => j.designerId === designer.id)) return `${designer.name} already has this design`;
  const now = new Date().toISOString();
  const rate = designer.kind === "freelance" ? r2(Math.max(0, Number(a.rate ?? designer.ratePerDesign) || 0)) : undefined;
  const job: CadJob = {
    id: uid("cad_"), orderId: order.id, orderNumber: order.orderNumber, designerId: designer.id,
    status: "assigned", brief: briefFromOrder(order), files: [], history: [],
    ...(a.dueDate ? { dueDate: a.dueDate } : {}),
    ...(rate != null ? { rate } : {}),
    ...(order.companyId ? { companyId: order.companyId } : {}),
    createdAt: now, createdBy: a.by.id,
  };
  log(job, a.by, `Assigned to ${designer.name}${a.note?.trim() ? ` — ${a.note.trim()}` : ""}`, now);
  if (a.note?.trim()) job.brief = { ...job.brief, instructions: [job.brief.instructions, `Note: ${a.note.trim()}`].filter(Boolean).join("\n") };
  // The new job is whole before anything existing changes.
  if (!d.cadJobs) d.cadJobs = [];
  for (const j of open) {
    j.status = "cancelled";
    log(j, a.by, `Moved to ${designer.name}`, now);
    const prev = designerOf(d, j.designerId);
    if (prev) tellDesigner(d, prev, `Design ${order.orderNumber} taken back`, `${order.orderNumber} was moved to another designer.`, a.by);
  }
  d.cadJobs.unshift(job);
  tellDesigner(d, designer, `New design: ${order.orderNumber}`, [job.brief.piece, job.brief.designNo && `#${job.brief.designNo}`, a.dueDate && `due ${a.dueDate}`].filter(Boolean).join(" · ") || "A new design is assigned to you", a.by);
  return job;
}

/** What kind of file it is, from its name and type. */
export function fileKind(name: string, mime?: string): CadJobFile["kind"] {
  if (/\.(3dm|stl|obj|step|stp|iges|igs|fbx|glb|gltf|3ds|ply|jcd|mgx)$/i.test(name)) return "model";
  if (mime?.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(name)) return "image";
  if (mime?.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(name)) return "video";
  return "file";
}

/** Put files in a job's folder. A designer's first files move it to Working. */
export function addJobFiles(d: DB, jobId: string, files: CadJobFile[], by: Who, byDesigner = false): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (j.status === "cancelled") return "This design was cancelled";
  j.files = [...(j.files ?? []), ...files];
  if (byDesigner && (j.status === "assigned" || j.status === "changes")) j.status = "working";
  log(j, by, `${files.length} file${files.length === 1 ? "" : "s"} added — ${files.map(f => f.name).slice(0, 3).join(", ")}${files.length > 3 ? "…" : ""}`);
  return undefined;
}

/** Take a file out of a job's folder. Returns its address so the caller can delete it from storage after the save. */
export function removeJobFile(d: DB, jobId: string, fileId: string, by: Who): { url?: string; error?: string } {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return { error: "This design is not there any more" };
  const f = (j.files ?? []).find(x => x.id === fileId);
  if (!f) return { error: "That file is not there any more" };
  // A file the order now shows as its CAD must not vanish from under it.
  const order = d.orders.find(o => o.id === j.orderId);
  if (order && (order.cadImage === f.url || order.cad3dmUrl === f.url)) return { error: "The order shows this file as its CAD — choose another there first" };
  j.files = j.files.filter(x => x.id !== fileId);
  log(j, by, `Removed ${f.name}`);
  // A file that was ever the order's CAD may still be shown elsewhere (a
  // Ready Stock piece, a share link) — it leaves the folder, never storage.
  return { url: f.onOrder ? undefined : f.url };
}

/** The designer (or staff for them) hands the design in. */
export function submitJob(d: DB, jobId: string, by: Who, note?: string): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (!isOpenJob(j)) return `This design is ${STATUS_LABEL[j.status].toLowerCase()}`;
  if (!(j.files ?? []).length) return "Add the design files first";
  j.status = "submitted";
  log(j, by, `Submitted${note?.trim() ? ` — ${note.trim()}` : ""}`);
  // Whoever gave it out, and whoever has the order, have it to approve.
  const order = d.orders.find(o => o.id === j.orderId);
  notifyUsers(d, [j.createdBy, order?.assignedEmployeeId], { title: `Design handed in: ${j.orderNumber}`, body: `${designerOf(d, j.designerId)?.name ?? "The designer"} — waiting for approval`, type: "design" }, by.id);
  return undefined;
}

/** Ask the designer for changes. */
export function askChanges(d: DB, jobId: string, note: string, by: Who, dueDate?: string): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (!isOpenJob(j)) return `This design is ${STATUS_LABEL[j.status].toLowerCase()}`;
  if (!note.trim()) return "Say what to change";
  j.status = "changes";
  if (dueDate) j.dueDate = dueDate;
  log(j, by, `Changes asked — ${note.trim()}`);
  const designer = designerOf(d, j.designerId);
  if (designer) tellDesigner(d, designer, `Changes asked: ${j.orderNumber}`, note.trim(), by);
  return undefined;
}

/**
 * Approve the design. A freelancer's charge is booked now (in-house: none).
 * The image and 3D model chosen become the order's CAD — what the order page,
 * its share links and its bills show.
 */
export function approveJob(d: DB, jobId: string, a: { chargeInr?: number; cadImageUrl?: string; modelUrl?: string; by: Who }): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (!isOpenJob(j)) return `This design is ${STATUS_LABEL[j.status].toLowerCase()}`;
  const designer = designerOf(d, j.designerId);
  const order = d.orders.find(o => o.id === j.orderId);
  if (!order) return "This order is not there any more";
  const why = designableWhy(order);
  if (why) return `${why} — cancel this design instead`;
  const fileOf = (u?: string) => (u ? (j.files ?? []).find(f => f.url === u) : undefined);
  if ((a.cadImageUrl && fileOf(a.cadImageUrl)?.kind !== "image") || (a.modelUrl && !fileOf(a.modelUrl))) return "Choose files from this design";
  // The order's 3D view (View 360°) reads a Rhino .3dm only.
  if (a.modelUrl && !/\.3dm$/i.test(fileOf(a.modelUrl)!.name)) return "Only a .3dm model can be the order's 3D model";
  const now = new Date().toISOString();
  j.status = "approved";
  j.approvedAt = now;
  j.approvedBy = a.by.id;
  j.chargeInr = designer?.kind === "freelance" ? r2(Math.max(0, Number(a.chargeInr ?? j.rate) || 0)) : 0;
  // Left out = the order keeps what it shows. What is replaced is written down, never lost.
  if (a.cadImageUrl && a.cadImageUrl !== order.cadImage) {
    if (order.cadImage) log(j, a.by, `The order's CAD picture before: ${order.cadImage}`, now);
    const before = orderPictures(order);
    order.cadImage = a.cadImageUrl;
    followOrderPictures(d, order.id, before, { by: a.by.id, byName: a.by.name }); // its piece in Ready Stock follows
    fileOf(a.cadImageUrl)!.onOrder = true;
    // A new CAD picture is the client's to see — they are told, as an upload on the order tells them.
    const client = order.clientId ? d.users.find(u => u.clientId === order.clientId && u.role === "client") : undefined;
    if (client) notifyUsers(d, [client.id], { title: "CAD Design Ready", body: `CAD design uploaded for ${order.orderNumber}. Please review.`, type: "info", at: now });
  }
  if (a.modelUrl && a.modelUrl !== order.cad3dmUrl) {
    if (order.cad3dmUrl) log(j, a.by, `The order's 3D model before: ${order.cad3dmUrl}`, now);
    order.cad3dmUrl = a.modelUrl;
    fileOf(a.modelUrl)!.onOrder = true;
  }
  log(j, a.by, `Approved${j.chargeInr ? ` — charge ₹${j.chargeInr.toLocaleString("en-IN")}` : ""}`, now);
  if (designer) tellDesigner(d, designer, `Design approved: ${j.orderNumber}`, "Thank you — the design is approved.", a.by);
  return undefined;
}

/** Open an approved design again (its charge comes off). Not once a payment was made against it. */
export function reopenJob(d: DB, jobId: string, note: string, by: Who): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (j.status !== "approved") return "Only an approved design can be opened again";
  if (designerPayments(d, j.designerId).some(t => t.cadJobId === j.id)) return "A payment was made against this design — move or cancel that payment first";
  j.status = "changes";
  delete j.chargeInr; delete j.approvedAt; delete j.approvedBy;
  log(j, by, `Opened again${note.trim() ? ` — ${note.trim()}` : ""}`);
  const designer = designerOf(d, j.designerId);
  if (designer) tellDesigner(d, designer, `Changes asked: ${j.orderNumber}`, note.trim() || "The design was opened again for changes.", by);
  return undefined;
}

/** Cancel a design still being worked on. An approved one is opened again instead. */
export function cancelJob(d: DB, jobId: string, by: Who, note?: string): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (!isOpenJob(j)) return `This design is ${STATUS_LABEL[j.status].toLowerCase()}`;
  j.status = "cancelled";
  log(j, by, `Cancelled${note?.trim() ? ` — ${note.trim()}` : ""}`);
  const designer = designerOf(d, j.designerId);
  if (designer) tellDesigner(d, designer, `Design ${j.orderNumber} cancelled`, note?.trim() || "This design is no longer needed.", by);
  return undefined;
}

/** Change the agreed charge or due date of a design not yet approved. */
export function updateJobTerms(d: DB, jobId: string, a: { rate?: number; dueDate?: string }, by: Who): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  if (!j) return "This design is not there any more";
  if (!isOpenJob(j)) return "Only a design still being worked on can be changed";
  const bits: string[] = [];
  if (a.rate != null && r2(a.rate) !== (j.rate ?? 0)) { j.rate = r2(Math.max(0, a.rate)); bits.push(`charge ₹${j.rate.toLocaleString("en-IN")}`); }
  if (a.dueDate != null && a.dueDate !== (j.dueDate ?? "")) { if (a.dueDate) j.dueDate = a.dueDate; else delete j.dueDate; bits.push(a.dueDate ? `due ${a.dueDate}` : "no due date"); }
  if (bits.length) log(j, by, `Changed — ${bits.join(", ")}`);
  return undefined;
}

/** Copy the order's details into the brief again (after the order was edited). */
export function refreshBrief(d: DB, jobId: string, by: Who): string | undefined {
  const j = (d.cadJobs ?? []).find(x => x.id === jobId);
  const order = j ? d.orders.find(o => o.id === j.orderId) : undefined;
  if (!j || !order) return "This design is not there any more";
  const notes = (j.brief.instructions ?? "").split("\n").filter(l => l.startsWith("Note: "));
  const b = briefFromOrder(order);
  j.brief = notes.length ? { ...b, instructions: [b.instructions, ...notes].filter(Boolean).join("\n") } : b;
  log(j, by, "Brief brought up to date from the order");
  return undefined;
}

/* ── Money (freelancers) ─────────────────────────────────────────────── */

/** What we paid a designer: account entries "designerPayment" to them. */
export function designerPayments(db: Pick<DB, "lockerTransactions">, designerId: string): LockerTransaction[] {
  return (db.lockerTransactions ?? []).filter(t => t.refType === "designerPayment" && t.refId === designerId && t.type === "expense");
}

/** Their approved designs that carry a charge, oldest approved first. */
export function chargedJobs(db: Pick<DB, "cadJobs">, designerId: string): CadJob[] {
  return (db.cadJobs ?? []).filter(j => j.designerId === designerId && j.status === "approved" && (j.chargeInr ?? 0) > 0)
    .sort((a, b) => (a.approvedAt ?? a.createdAt).localeCompare(b.approvedAt ?? b.createdAt));
}

export interface DesignerAccount {
  /** Approved designs and their charges (with any owed from before the app). */
  designs: number; charged: number; opening: number;
  paid: number;
  /** Still to pay them. */
  due: number;
  /** Paid ahead of the work. */
  advance: number;
}

/** A freelancer's account: charged on approval, less what we paid. In-house designers have none (salary is paid as salary). */
export function designerAccount(db: Pick<DB, "cadJobs" | "lockerTransactions">, designer: Designer): DesignerAccount {
  const jobs = chargedJobs(db, designer.id);
  const charges = r2(jobs.reduce((s, j) => s + (j.chargeInr ?? 0), 0));
  const opening = r2(openingCreditAmt(designer) - openingDebitAmt(designer));
  const paid = r2(designerPayments(db, designer.id).reduce((s, t) => s + (t.amountInr || 0), 0));
  const net = r2(opening + charges - paid);
  return { designs: jobs.length, charged: charges, opening, paid, due: Math.max(0, net), advance: Math.max(0, r2(-net)) };
}

/**
 * Each approved design's paid and still-due part. A payment made against one
 * design settles that one first; the rest — payments on account, overflow, an
 * advance from before the app — settles the oldest approved designs first
 * (after anything owed from before the app). Read-only: nothing is stored.
 */
export function jobPayState(db: Pick<DB, "cadJobs" | "lockerTransactions">, designer: Designer): Map<string, { charge: number; paid: number; due: number }> {
  const jobs = chargedJobs(db, designer.id);
  const out = new Map(jobs.map(j => [j.id, { charge: j.chargeInr ?? 0, paid: 0, due: j.chargeInr ?? 0 }]));
  let pool = r2(openingDebitAmt(designer));
  let openingOwed = r2(openingCreditAmt(designer));
  for (const t of designerPayments(db, designer.id)) {
    const row = t.cadJobId ? out.get(t.cadJobId) : undefined;
    if (row) {
      const take = Math.min(row.due, t.amountInr || 0);
      row.paid = r2(row.paid + take); row.due = r2(row.due - take);
      pool = r2(pool + (t.amountInr || 0) - take);
    } else pool = r2(pool + (t.amountInr || 0));
  }
  const first = Math.min(pool, openingOwed);
  pool = r2(pool - first); openingOwed = r2(openingOwed - first);
  for (const j of jobs) {
    if (pool <= 0) break;
    const row = out.get(j.id)!;
    const take = Math.min(row.due, pool);
    row.paid = r2(row.paid + take); row.due = r2(row.due - take); pool = r2(pool - take);
  }
  return out;
}

/** A month's work and money, "2026-10" → designs approved, charged, paid. */
export function designerMonths(db: Pick<DB, "cadJobs" | "lockerTransactions">, designer: Designer): Map<string, { designs: number; charged: number; paid: number }> {
  const m = new Map<string, { designs: number; charged: number; paid: number }>();
  const at = (k: string) => { let v = m.get(k); if (!v) m.set(k, v = { designs: 0, charged: 0, paid: 0 }); return v; };
  for (const j of jobsOfDesigner(db, designer.id)) if (j.status === "approved" && j.approvedAt) {
    const v = at(j.approvedAt.slice(0, 7)); v.designs++; v.charged = r2(v.charged + (j.chargeInr ?? 0));
  }
  for (const t of designerPayments(db, designer.id)) { const v = at(t.createdAt.slice(0, 7)); v.paid = r2(v.paid + (t.amountInr || 0)); }
  return m;
}

/** Why a designer can't be deleted (they have work or payments) — make them inactive instead. */
export function designerDeleteWhy(db: Pick<DB, "cadJobs" | "lockerTransactions">, designer: Designer): string | undefined {
  const jobs = jobsOfDesigner(db, designer.id).length;
  const pays = designerPayments(db, designer.id).length;
  if (jobs || pays) return `${designer.name} has ${[jobs && `${jobs} design${jobs === 1 ? "" : "s"}`, pays && `${pays} payment${pays === 1 ? "" : "s"}`].filter(Boolean).join(" and ")} — make them inactive instead`;
  return undefined;
}
