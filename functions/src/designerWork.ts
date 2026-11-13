import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { randomBytes } from "crypto";
import { app, db } from "./lib/firestoreAdmin";
import { REGION } from "./region";
import * as money from "./shared/designerMoney";

/**
 * A CAD designer's own login (role "designer", Designers → Give login) does its
 * work here — never by writing to the database itself (its rules let a designer
 * READ only their profile, their designer record and their jobs). Each action
 * is checked against who is asking, from their sign-in record, never what the
 * browser says:
 *
 *   addFiles   — files they uploaded to their own folder (cad/by/{designer}/{job}/…)
 *                put in the job's folder; the job moves to Working.
 *   removeFile — one of their own files taken out, while the design is open and
 *                the file is not what the order shows as its CAD.
 *   submit     — the design handed in for approval; whoever gave it out and
 *                whoever has the order are told.
 *   statement  — a freelancer's own money: charges (on approval), payments, owed —
 *                worked out by lib/pure/designerMoney.ts, as the staff pages do.
 *
 * The same rules as the staff side (src/lib/designers.ts addJobFiles,
 * removeJobFile, submitJob) — a job given to someone else, cancelled or
 * approved can't be changed from here.
 */

type Job = {
  id: string; orderId: string; orderNumber: string; designerId: string; status: string;
  files?: { id: string; name: string; url: string; kind: string; size?: number; uploadedBy: string; uploadedByName?: string; uploadedAt: string; onOrder?: boolean }[];
  history?: { at: string; by: string; byName?: string; text: string }[];
  createdBy: string; chargeInr?: number; approvedAt?: string; createdAt: string;
};
const OPEN = ["assigned", "working", "submitted", "changes"];
const STATUS_WORD: Record<string, string> = { assigned: "given out", working: "being worked on", submitted: "handed in", changes: "back for changes", approved: "approved", cancelled: "cancelled" };
const MAX_FILES = 20;

/** Who is asking: an active designer login, linked to an active designer. */
async function designerCaller(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const idx = (await db.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string; appId?: string; designerId?: string } | undefined;
  if (!idx || idx.role !== "designer" || idx.status !== "active" || !idx.designerId || !idx.appId) {
    throw new HttpsError("permission-denied", "This login can't do that.");
  }
  const des = (await db.collection("designers").doc(idx.designerId).get()).data() as
    { name?: string; kind?: string; active?: boolean; openingBalance?: number; openingDir?: "debit" | "credit"; openingDate?: string } | undefined;
  if (!des || des.active === false) throw new HttpsError("permission-denied", "This designer is switched off — ask the office.");
  const me = (await db.collection("users").doc(idx.appId).get()).data() as { name?: string; status?: string } | undefined;
  if (!me || me.status === "inactive") throw new HttpsError("permission-denied", "This login is switched off.");
  return { appId: idx.appId, designerId: idx.designerId, designer: des, name: me.name || des.name || "Designer" };
}

/** What kind of file it is, from its name and type (as src/lib/designers.ts fileKind). */
function fileKind(name: string, mime?: string): string {
  if (/\.(3dm|stl|obj|step|stp|iges|igs|fbx|glb|gltf|3ds|ply|jcd|mgx)$/i.test(name)) return "model";
  if (mime?.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(name)) return "image";
  if (mime?.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(name)) return "video";
  return "file";
}

/** The stored file a download link points to, in this project's own bucket — or null. */
function pathOf(url: string): { bucket: string; path: string } | null {
  const m = String(url).match(/^https?:\/\/[^/]+\/v0\/b\/([^/]+)\/o\/([^?#]+)/);
  if (!m) return null;
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  if (!project || ![`${project}.firebasestorage.app`, `${project}.appspot.com`].includes(m[1])) return null;
  let path: string;
  try { path = decodeURIComponent(m[2]); } catch { return null; }
  if (path.includes("..") || path.includes("//")) return null;
  return { bucket: m[1], path };
}

const now = () => new Date().toISOString();
const newId = (p: string) => p + randomBytes(6).toString("hex");

export const designerWork = onCall<{ action?: unknown; jobId?: unknown; files?: unknown; fileId?: unknown; note?: unknown }>(
  { region: REGION, memory: "256MiB", maxInstances: 10, timeoutSeconds: 60 },
  async req => {
    const me = await designerCaller(req.auth?.uid);
    const action = String(req.data?.action ?? "");

    // ── Their own money (freelancers) ──
    if (action === "statement") {
      if (me.designer.kind !== "freelance") return { kind: "inhouse" };
      const [jobsSnap, paySnap] = await Promise.all([
        db.collection("cadJobs").where("designerId", "==", me.designerId).get(),
        db.collection("lockerTransactions").where("refType", "==", "designerPayment").where("refId", "==", me.designerId).get(),
      ]);
      const jobs = jobsSnap.docs.map(d => d.data() as Job & money.DesignJobMoney);
      const txs = paySnap.docs.map(d => d.data() as money.DesignerPayEntry);
      const who = { id: me.designerId, openingBalance: me.designer.openingBalance, openingDir: me.designer.openingDir, openingDate: me.designer.openingDate };
      const account = money.designerAccount(jobs, txs, who);
      const state = money.jobPayState(jobs, txs, who);
      const byId = new Map(jobs.map(j => [j.id, j]));
      return {
        kind: "freelance",
        account,
        opening: account.opening ? { amount: account.opening, date: me.designer.openingDate ?? null } : null,
        // Only what is theirs to know: the design, when, and the money — no account names, no notes.
        designs: money.chargedJobs(jobs, me.designerId).map(j => ({ id: j.id, orderNumber: j.orderNumber, approvedAt: j.approvedAt ?? null, ...(state.get(j.id) ?? { charge: 0, paid: 0, due: 0 }) })),
        payments: money.designerPayments(txs, me.designerId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(t => ({ id: (t as { id?: string }).id ?? "", at: t.createdAt, amountInr: t.amountInr, orderNumber: t.cadJobId ? byId.get(t.cadJobId)?.orderNumber ?? null : null })),
        months: [...money.designerMonths(jobs, txs, who)].sort((a, b) => b[0].localeCompare(a[0])).map(([month, v]) => ({ month, ...v })),
      };
    }

    const jobId = typeof req.data?.jobId === "string" ? req.data.jobId : "";
    if (!/^[\w-]{1,64}$/.test(jobId)) throw new HttpsError("invalid-argument", "Which design?");
    const ref = db.collection("cadJobs").doc(jobId);

    // ── Files they uploaded, into the job's folder ──
    if (action === "addFiles") {
      const raw = Array.isArray(req.data?.files) ? req.data.files : [];
      if (!raw.length || raw.length > MAX_FILES) throw new HttpsError("invalid-argument", `Add 1 to ${MAX_FILES} files at a time.`);
      const folder = `cad/by/${me.designerId}/${jobId}/`;
      const files: NonNullable<Job["files"]> = [];
      for (const f of raw as { name?: unknown; url?: unknown; mime?: unknown }[]) {
        const url = typeof f?.url === "string" ? f.url : "";
        const at = pathOf(url);
        if (!at || !at.path.startsWith(folder)) throw new HttpsError("permission-denied", "That file is not in your folder for this design.");
        const [exists] = await getStorage(app).bucket(at.bucket).file(at.path).exists();
        if (!exists) throw new HttpsError("not-found", "A file did not finish uploading — add it again.");
        const [meta] = await getStorage(app).bucket(at.bucket).file(at.path).getMetadata();
        const name = (typeof f?.name === "string" && f.name.trim() ? f.name.trim() : at.path.split("/").pop() ?? "file").slice(0, 200);
        files.push({
          id: newId("f_"), name, url, kind: fileKind(name, String(meta.contentType ?? "")),
          ...(meta.size != null ? { size: Number(meta.size) } : {}),
          uploadedBy: me.appId, uploadedByName: me.name, uploadedAt: now(),
        });
      }
      await db.runTransaction(async t => {
        const snap = await t.get(ref);
        const j = snap.data() as Job | undefined;
        if (!j || j.designerId !== me.designerId) throw new HttpsError("not-found", "This design is not given to you.");
        if (!OPEN.includes(j.status)) throw new HttpsError("failed-precondition", `This design is ${STATUS_WORD[j.status] ?? j.status}.`);
        const at = now();
        const have = new Set((j.files ?? []).map(x => x.url));
        const fresh = files.filter(x => !have.has(x.url));
        if (!fresh.length) return;
        t.update(ref, {
          files: [...(j.files ?? []), ...fresh],
          ...(j.status === "assigned" || j.status === "changes" ? { status: "working" } : {}),
          history: [...(j.history ?? []), { at, by: me.appId, byName: me.name, text: `${fresh.length} file${fresh.length === 1 ? "" : "s"} added — ${fresh.map(x => x.name).slice(0, 3).join(", ")}${fresh.length > 3 ? "…" : ""}` }],
          updatedAt: at,
        });
      });
      return { ok: true };
    }

    // ── One of their own files taken out ──
    if (action === "removeFile") {
      const fileId = typeof req.data?.fileId === "string" ? req.data.fileId : "";
      let gone: { bucket: string; path: string } | null = null;
      await db.runTransaction(async t => {
        const snap = await t.get(ref);
        const j = snap.data() as Job | undefined;
        if (!j || j.designerId !== me.designerId) throw new HttpsError("not-found", "This design is not given to you.");
        if (!OPEN.includes(j.status)) throw new HttpsError("failed-precondition", `This design is ${STATUS_WORD[j.status] ?? j.status}.`);
        const f = (j.files ?? []).find(x => x.id === fileId);
        if (!f) throw new HttpsError("not-found", "That file is not there any more.");
        if (f.uploadedBy !== me.appId) throw new HttpsError("permission-denied", "Only files you added can be taken out here.");
        if (f.onOrder) throw new HttpsError("failed-precondition", "The order shows this file — ask the office.");
        const order = (await t.get(db.collection("orders").doc(j.orderId))).data() as { cadImage?: string; cad3dmUrl?: string } | undefined;
        if (order && (order.cadImage === f.url || order.cad3dmUrl === f.url)) throw new HttpsError("failed-precondition", "The order shows this file as its CAD — ask the office.");
        const at = now();
        t.update(ref, {
          files: (j.files ?? []).filter(x => x.id !== fileId),
          history: [...(j.history ?? []), { at, by: me.appId, byName: me.name, text: `Removed ${f.name}` }],
          updatedAt: at,
        });
        const p = pathOf(f.url);
        gone = p && p.path.startsWith(`cad/by/${me.designerId}/`) ? p : null;
      });
      // Out of storage too — only from their own folder, after the save.
      const g = gone as { bucket: string; path: string } | null;
      if (g) await getStorage(app).bucket(g.bucket).file(g.path).delete().catch(() => { /* already gone */ });
      return { ok: true };
    }

    // ── Handed in for approval ──
    if (action === "submit") {
      const note = typeof req.data?.note === "string" ? req.data.note.trim().slice(0, 500) : "";
      let tell: { ids: string[]; title: string; body: string } | null = null;
      await db.runTransaction(async t => {
        const snap = await t.get(ref);
        const j = snap.data() as Job | undefined;
        if (!j || j.designerId !== me.designerId) throw new HttpsError("not-found", "This design is not given to you.");
        if (!OPEN.includes(j.status)) throw new HttpsError("failed-precondition", `This design is ${STATUS_WORD[j.status] ?? j.status}.`);
        if (j.status === "submitted") throw new HttpsError("failed-precondition", "Already handed in — waiting for approval.");
        if (!(j.files ?? []).length) throw new HttpsError("failed-precondition", "Add the design files first.");
        const order = (await t.get(db.collection("orders").doc(j.orderId))).data() as { assignedEmployeeId?: string } | undefined;
        const at = now();
        t.update(ref, {
          status: "submitted",
          history: [...(j.history ?? []), { at, by: me.appId, byName: me.name, text: `Submitted${note ? ` — ${note}` : ""}` }],
          updatedAt: at,
        });
        tell = { ids: [j.createdBy, order?.assignedEmployeeId].filter((x): x is string => !!x), title: `Design handed in: ${j.orderNumber}`, body: `${me.designer.name ?? me.name} — waiting for approval` };
      });
      // The in-app alert, as the staff side's notifyUsers writes it — to people still active.
      const msg = tell as { ids: string[]; title: string; body: string } | null;
      if (msg) {
        const at = now();
        for (const id of [...new Set(msg.ids)]) {
          const u = (await db.collection("users").doc(id).get()).data() as { status?: string; role?: string } | undefined;
          if (!u || u.status === "inactive" || (u.role !== "admin" && u.role !== "employee")) continue;
          const nid = newId("n_");
          await db.collection("notifications").doc(nid).set({ id: nid, userId: id, title: msg.title, body: msg.body, type: "design", read: false, createdAt: at });
        }
      }
      return { ok: true };
    }

    throw new HttpsError("invalid-argument", "Unknown action.");
  },
);
