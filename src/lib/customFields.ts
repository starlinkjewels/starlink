// Custom fields — boxes a business adds to its own records (Settings → Custom
// fields, admins): "Ring size" on an order, "Birthday" on a client, "Tray no."
// on a Ready Stock piece, "Origin" on a stone lot…
//
// A field belongs to one kind of record (CfTarget) and is one of five kinds
// (text, number, date, yes/no, a dropdown of the admin's options). It can be
// required (the form won't save without it — older records still open and
// save), and switched off (kept for what is filled in; no longer asked).
//
// Who sees it decides where its value is kept, so the database itself — not
// just the screen — keeps it from anyone who shouldn't read it:
//   • "client" — the client sees it too: on the record itself (`custom`).
//   • "staff"  — every staff member: in `customValues` (one doc per record,
//                id "<target>_<recordId>"), a collection clients never read.
//   • "admins" — admins only: in adminRecords ("cfa_<target>_<recordId>").
// valuesOf() puts the three back together for whoever is looking; each person
// only ever reads and writes the fields they may see.
import type { DB, Settings, User } from "./db";
import { toast } from "sonner";
import { adminStoreReady, staffValuesReady } from "./db";

export type CfTarget = "orders" | "clients" | "suppliers" | "readyStock" | "bags" | "packets";
export type CfKind = "text" | "number" | "date" | "yesno" | "list";
export type CfAccess = "staff" | "admins" | "client";
export type CfValue = string | number | boolean;
export type CfValues = Record<string, CfValue>;

export interface CustomFieldDef {
  /** "cf_…" — its key on every record; never changes, so renaming keeps every value. */
  id: string;
  target: CfTarget;
  label: string;
  kind: CfKind;
  /** A dropdown's choices. */
  options?: string[];
  access: CfAccess;
  required?: boolean;
  /** Switched off: no longer asked or shown in tables; what was filled in is kept. */
  active?: boolean;
  /** A line under the box. */
  hint?: string;
  createdAt: string;
}

/** The staff-visible values of one record. */
export interface CustomValuesDoc { id: string; target: CfTarget; recId: string; values: CfValues; updatedAt?: string; updatedBy?: string }

export const TARGETS: Record<CfTarget, { label: string; one: string }> = {
  orders: { label: "Orders", one: "order" },
  clients: { label: "Clients", one: "client" },
  suppliers: { label: "Suppliers", one: "supplier" },
  readyStock: { label: "Ready Stock pieces", one: "piece" },
  bags: { label: "Loose stone lots (bags)", one: "lot" },
  packets: { label: "Certified stones", one: "certified stone" },
};
export const TARGET_LIST: CfTarget[] = ["orders", "clients", "suppliers", "readyStock", "bags", "packets"];
export const KIND_LABEL: Record<CfKind, string> = { text: "Text", number: "Number", date: "Date", yesno: "Yes / No", list: "Dropdown" };
export const ACCESS_LABEL: Record<CfAccess, string> = { staff: "All staff", admins: "Admins only", client: "Staff and the client" };

type Who = Pick<User, "role"> | null | undefined;

/** May this person see (and fill) this field? Clients only the ones shown to them. */
export function canSeeField(def: Pick<CustomFieldDef, "access">, who: Who): boolean {
  if (!who) return false;
  if (who.role === "admin") return true;
  if (who.role === "employee") return def.access !== "admins";
  return def.access === "client";
}

/** The fields of one kind of record this person sees, in the admin's order. `all` keeps switched-off ones. */
export function fieldsFor(settings: Pick<Settings, "customFields"> | undefined, target: CfTarget, who: Who, opts: { all?: boolean } = {}): CustomFieldDef[] {
  return (settings?.customFields ?? []).filter(d => d.target === target && (opts.all || d.active !== false) && canSeeField(d, who));
}

const valuesDocId = (target: CfTarget, recId: string) => `${target}_${recId}`;
const adminDocId = (target: CfTarget, recId: string) => `cfa_${target}_${recId}`;

type WithCustom = { id: string; custom?: CfValues };
/** The record a value belongs to. */
export function recordOf(d: Pick<DB, "orders" | "clients" | "suppliers" | "readyStock" | "diamondBags" | "diamondPackets">, target: CfTarget, recId: string): WithCustom | undefined {
  const list: WithCustom[] = target === "orders" ? d.orders : target === "clients" ? d.clients : target === "suppliers" ? d.suppliers
    : target === "readyStock" ? d.readyStock ?? [] : target === "bags" ? d.diamondBags ?? [] : d.diamondPackets ?? [];
  return list.find(x => x.id === recId);
}

/** Every value of one record this person may see — from the record, the staff list and the admin's records. */
export function valuesOf(db: DB, target: CfTarget, recId: string | undefined, rec?: WithCustom): CfValues {
  if (!recId) return {};
  const own = (rec ?? recordOf(db, target, recId))?.custom ?? {};
  const staff = (db.customValues ?? []).find(x => x.id === valuesDocId(target, recId))?.values ?? {};
  const adm = (db.adminRecords ?? []).find(r => r.kind === "customValues" && r.id === adminDocId(target, recId)) as { values?: CfValues } | undefined;
  return { ...staff, ...(adm?.values ?? {}), ...own };
}

/** An empty value — not kept. */
export const isBlank = (v: CfValue | undefined | null) => v == null || v === "" || (typeof v === "number" && !isFinite(v));

/** A value tidied to its field's kind: a number as a number, a date as yyyy-mm-dd, yes/no as true/false. */
export function cleanValue(def: Pick<CustomFieldDef, "kind">, v: CfValue | undefined | null): CfValue | undefined {
  if (isBlank(v)) return undefined;
  if (def.kind === "number") { const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, "")); return isFinite(n) ? n : undefined; }
  if (def.kind === "yesno") return v === true || /^(yes|y|true|1)$/i.test(String(v)) ? true : v === false || /^(no|n|false|0)$/i.test(String(v)) ? false : undefined;
  const t = String(v).trim();
  return t || undefined;
}

/**
 * Save one record's values (inside updateDb), each where its field says — a form's
 * whole set: a field this person sees in the form and left empty is cleared. Only
 * the fields this person may see are touched; a switched-off one only when given.
 * `only`: just the fields given (a move between places). The record must already
 * be in `d` for a client-visible value.
 */
export function writeValues(d: DB, target: CfTarget, recId: string, values: CfValues | undefined, who: Who, by?: string, opts: { only?: boolean } = {}): void {
  if (!values) return;
  const defs = fieldsFor(d.settings, target, who, { all: true }).filter(def => def.id in values || (!opts.only && def.active !== false));
  if (!defs.length) return;
  const rec = recordOf(d, target, recId);
  const now = new Date().toISOString();
  const put = (bag: CfValues, def: CustomFieldDef) => {
    const v = cleanValue(def, values[def.id]);
    if (v === undefined) delete bag[def.id]; else bag[def.id] = v;
  };
  // Shown to the client: on the record.
  const onRec = defs.filter(x => x.access === "client");
  if (onRec.length && rec) {
    const bag = { ...(rec.custom ?? {}) };
    for (const def of onRec) put(bag, def);
    if (Object.keys(bag).length) rec.custom = bag; else delete rec.custom;
  }
  // Every staff member: the staff list.
  const onStaff = defs.filter(x => x.access === "staff");
  // Its database rules not live yet: written there, the whole save would be refused — so not.
  if (onStaff.some(def => !sameValues({ [def.id]: values[def.id] }, {})) && !staffValuesReady()) {
    toast.error("Custom fields for staff can't be saved yet — the database rules for them aren't switched on. Everything else was saved.");
  }
  if (onStaff.length && staffValuesReady()) {
    if (!d.customValues) d.customValues = [];
    const id = valuesDocId(target, recId);
    const i = d.customValues.findIndex(x => x.id === id);
    const bag = { ...(i >= 0 ? d.customValues[i].values : {}) };
    for (const def of onStaff) put(bag, def);
    if (!Object.keys(bag).length) { if (i >= 0) d.customValues = d.customValues.filter(x => x.id !== id); }
    else {
      const doc: CustomValuesDoc = { id, target, recId, values: bag, updatedAt: now, ...(by ? { updatedBy: by } : {}) };
      if (i >= 0) d.customValues[i] = doc; else d.customValues.push(doc);
    }
  }
  // Admins only: the admin's own records (never anywhere staff can read).
  const onAdmin = defs.filter(x => x.access === "admins");
  if (onAdmin.length && who?.role === "admin" && adminStoreReady()) {
    if (!d.adminRecords) d.adminRecords = [];
    const id = adminDocId(target, recId);
    const i = d.adminRecords.findIndex(r => r.id === id);
    const bag: CfValues = { ...(i >= 0 ? ((d.adminRecords[i] as { values?: CfValues }).values ?? {}) : {}) };
    for (const def of onAdmin) put(bag, def);
    if (!Object.keys(bag).length) { if (i >= 0) d.adminRecords = d.adminRecords.filter(r => r.id !== id); }
    else {
      const rec2 = { id, kind: "customValues" as const, target, recId, values: bag };
      if (i >= 0) d.adminRecords[i] = rec2; else d.adminRecords.push(rec2);
    }
  }
}

/** The same values (blank ones and "5" vs 5 alike)? */
export function sameValues(a: CfValues | undefined, b: CfValues | undefined): boolean {
  const norm = (x: CfValues | undefined) => Object.entries(x ?? {}).filter(([, v]) => !isBlank(v)).map(([k, v]) => `${k}=${String(v).trim()}`).sort().join("|");
  return norm(a) === norm(b);
}

/**
 * Why the form can't save — a required field left empty — or null. `saved`: an
 * edit's values as they were — untouched, an older record saves as it is (a
 * field made required later never blocks a change to something else).
 */
export function customProblem(settings: Pick<Settings, "customFields"> | undefined, target: CfTarget, values: CfValues | undefined, who: Who, saved?: CfValues): string | null {
  if (saved && sameValues(values, saved)) return null;
  for (const def of fieldsFor(settings, target, who)) {
    if (!def.required) continue;
    const v = cleanValue(def, values?.[def.id]);
    if (v === undefined) return `Fill in ${def.label}`;
  }
  return null;
}

/** As people read it: "12 Apr 2026", "Yes", "1,250". */
export function fmtValue(def: Pick<CustomFieldDef, "kind">, v: CfValue | undefined): string {
  if (isBlank(v)) return "";
  if (def.kind === "yesno") return v === true ? "Yes" : v === false ? "No" : String(v);
  if (def.kind === "number") return typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : String(v);
  if (def.kind === "date") {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep") : String(v);
  }
  return String(v);
}

/** The filled-in ones as [label, value] — for a details card, a PDF or a share page. */
export function filledPairs(defs: CustomFieldDef[], values: CfValues): [string, string][] {
  return defs.map(d => [d.label, fmtValue(d, values[d.id])] as [string, string]).filter(([, v]) => !!v);
}

/** All the values' words, for a search box. */
export function searchWords(defs: CustomFieldDef[], values: CfValues): string {
  return defs.map(d => fmtValue(d, values[d.id])).filter(Boolean).join(" ");
}

/** For a table: the sort value of one field. */
export function sortOf(def: CustomFieldDef, v: CfValue | undefined): string | number | null {
  if (isBlank(v)) return null;
  if (def.kind === "number") return typeof v === "number" ? v : Number(v) || 0;
  if (def.kind === "yesno") return v === true ? 1 : 0;
  return String(v).toLowerCase();
}

/** How many records hold a value for this field — a field in use can only be switched off, not deleted. */
export function usesOf(db: DB, def: CustomFieldDef): number {
  const all = (["orders", "clients", "suppliers", "readyStock", "diamondBags", "diamondPackets"] as const)
    .flatMap(c => ((db[c] ?? []) as WithCustom[]).filter(r => r.custom && !isBlank(r.custom[def.id])).map(r => r.id));
  // Values kept apart count only while their record is still here (a deleted record's are left behind).
  const exists = (recId: string) => !!recordOf(db, def.target, recId);
  const staff = (db.customValues ?? []).filter(x => x.target === def.target && !isBlank(x.values[def.id]) && exists(x.recId)).map(x => x.recId);
  const adm = (db.adminRecords ?? []).filter(r => r.kind === "customValues" && r.target === def.target && !isBlank(r.values[def.id]) && exists(r.recId)).map(r => (r as { recId: string }).recId);
  return new Set([...all, ...staff, ...adm]).size;
}

/**
 * A field's "who sees it" changed (inside updateDb, by an admin): every value it
 * has moves to where the new setting keeps it — so a field made admins-only is
 * no longer anywhere staff or a client can read, and one shown to the client is
 * on the record.
 */
export function relocateField(d: DB, def: CustomFieldDef, from: CfAccess, to: CfAccess): number {
  if (from === to) return 0;
  const found: { recId: string; v: CfValue }[] = [];
  if (from === "client") {
    for (const r of (d[colOf(def.target)] ?? []) as WithCustom[]) {
      if (r.custom && !isBlank(r.custom[def.id])) { found.push({ recId: r.id, v: r.custom[def.id] }); const c = { ...r.custom }; delete c[def.id]; if (Object.keys(c).length) r.custom = c; else delete r.custom; }
    }
  } else if (from === "staff") {
    d.customValues = (d.customValues ?? []).flatMap(x => {
      if (x.target !== def.target || isBlank(x.values[def.id])) return [x];
      found.push({ recId: x.recId, v: x.values[def.id] });
      const v = { ...x.values }; delete v[def.id];
      return Object.keys(v).length ? [{ ...x, values: v }] : [];
    });
  } else {
    d.adminRecords = (d.adminRecords ?? []).flatMap(r => {
      if (r.kind !== "customValues" || r.target !== def.target || isBlank(r.values[def.id])) return [r];
      found.push({ recId: r.recId, v: r.values[def.id] });
      const v = { ...r.values }; delete v[def.id];
      return Object.keys(v).length ? [{ ...r, values: v }] : [];
    });
  }
  const moved = { ...def, access: to };
  const settings = { ...d.settings, customFields: (d.settings.customFields ?? []).map(x => (x.id === def.id ? moved : x)) };
  const was = d.settings;
  d.settings = settings;
  for (const f of found) writeValues(d, def.target, f.recId, { [def.id]: f.v }, { role: "admin" }, undefined, { only: true });
  d.settings = was;
  return found.length;
}

const colOf = (t: CfTarget) => (t === "bags" ? "diamondBags" : t === "packets" ? "diamondPackets" : t) as "orders" | "clients" | "suppliers" | "readyStock" | "diamondBags" | "diamondPackets";

/** A new field's id. */
export const newFieldId = () => `cf_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
