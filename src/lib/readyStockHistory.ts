/**
 * A Ready Stock piece's own history: who added it, every change to it, the
 * orders it was sold on, the pieces that came back. It is kept on the item
 * (`history`, oldest first, the last 200), so whoever can see the piece can
 * see its story — the admin's activity log can't be read per record, and
 * staff can't read it at all.
 *
 * Every client can read Ready Stock, so a line never holds a cost figure (a
 * cost change is its own "cost" line, which only an admin is shown) nor a
 * client's name (the product page adds that when staff look).
 */
import { auth } from "./firebase";
import { fmtMoney, type DB, type ReadyStockEvent, type ReadyStockEventKind, type ReadyStockItem, type User } from "./db";
import { officeLabel, officeOf } from "./offices";

export const HISTORY_CAP = 200;

/** Who did something, as a history line keeps them. */
export interface Who { by: string; byName?: string }

/** The signed-in person (useAuth's user). A client's name is never written onto a piece. */
export function whoOf(u: Pick<User, "id" | "name" | "role"> | null | undefined): Who {
  if (!u) return { by: "" };
  if (u.role === "client" || !u.name) return { by: u.id };
  return { by: u.id, byName: u.name };
}

/** Whoever is signed in on this device — for lib code its caller didn't tell who. */
export function whoNow(d: Pick<DB, "users">): Who {
  const fb = auth.currentUser;
  const u = fb ? (d.users ?? []).find(x => x.authUid === fb.uid) : undefined;
  if (u) return whoOf(u);
  const name = fb?.displayName || fb?.email || "";
  return name ? { by: fb?.uid ?? "", byName: name } : { by: fb?.uid ?? "" };
}

/** Add a line to a piece's history (inside updateDb). The oldest fall off past 200. */
export function logItem(item: ReadyStockItem, e: Omit<ReadyStockEvent, "at"> & { at?: string }): void {
  const ev: ReadyStockEvent = { at: e.at ?? new Date().toISOString(), by: e.by || "", kind: e.kind, text: e.text };
  if (e.byName) ev.byName = e.byName;
  // No undefined fields — Firestore keeps only what is there.
  const ref = Object.fromEntries(Object.entries(e.ref ?? {}).filter(([, v]) => !!v));
  if (Object.keys(ref).length) ev.ref = ref;
  item.history = [...(item.history ?? []), ev].slice(-HISTORY_CAP);
}

export const qtyText = (from: number, to: number) => `Quantity ${from} → ${to}`;
const QTY_LINE = /^Quantity (\d+) → (\d+)$/;

/**
 * The − / + stepper (inside updateDb). Clicks in a row by the same person read
 * as one change — "Quantity 3 → 6", not three lines; back where it started, no line.
 */
export function stepQty(d: DB, itemId: string, delta: number, who: Who): void {
  const it = d.readyStock.find(x => x.id === itemId);
  if (!it) return;
  const was = it.quantity;
  it.quantity = Math.max(0, it.quantity + delta);
  if (it.quantity === was) return;
  const last = it.history?.[it.history.length - 1];
  const m = last && last.kind === "qty" && last.by === who.by && Date.now() - +new Date(last.at) < 2 * 60_000 ? QTY_LINE.exec(last.text) : null;
  if (m && Number(m[2]) === was) {
    const from = Number(m[1]);
    it.history = it.history!.slice(0, -1);
    if (from !== it.quantity) logItem(it, { ...who, kind: "qty", text: qtyText(from, it.quantity) });
    return;
  }
  logItem(it, { ...who, kind: "qty", text: qtyText(was, it.quantity) });
}

/**
 * What an edit changed, in a line: "Price $1,200 → $1,350 · Quantity 3 → 2".
 * One kind of change keeps its kind (price, qty, moved); several are "edited".
 * Cost is left out on purpose — the caller adds its own "cost" line.
 * Null when nothing a person would notice changed.
 */
export function describeEdit(before: ReadyStockItem, after: ReadyStockItem, opts?: { companyName?: (id: string) => string }): { kind: ReadyStockEventKind; text: string } | null {
  const parts: { kind: ReadyStockEventKind; text: string }[] = [];
  const push = (kind: ReadyStockEventKind, text: string) => parts.push({ kind, text });
  const txt = (v?: string) => v?.trim() || "none";
  const num = (v: number | undefined, unit: string) => (v ? `${v}${unit}` : "none");
  // Blank, 0 and unset all read as "none" — never a "none → none" line.
  const same = (a?: string, b?: string) => (a?.trim() || "") === (b?.trim() || "");
  const sameNum = (a?: number, b?: number) => (a || 0) === (b || 0);

  if (before.name.trim() !== after.name.trim()) push("edited", `Name “${before.name.trim()}” → “${after.name.trim()}”`);
  if (before.price !== after.price) push("price", `Price ${fmtMoney(before.price)} → ${fmtMoney(after.price)}`);
  if (before.quantity !== after.quantity) push("qty", qtyText(before.quantity, after.quantity));
  if (officeOf(before) !== officeOf(after)) push("moved", `Office ${officeLabel(officeOf(before))} → ${officeLabel(officeOf(after))}`);
  if (before.jewelleryType !== after.jewelleryType) push("edited", `Type ${before.jewelleryType} → ${after.jewelleryType}`);
  if (before.metal !== after.metal) push("edited", `Metal ${before.metal} → ${after.metal}`);
  if (!same(before.productKarats, after.productKarats)) push("edited", `Karat ${txt(before.productKarats)} → ${txt(after.productKarats)}`);
  if (!sameNum(before.grossWeight, after.grossWeight)) push("edited", `Gross ${num(before.grossWeight, "g")} → ${num(after.grossWeight, "g")}`);
  if (!sameNum(before.netWeight, after.netWeight)) push("edited", `Net ${num(before.netWeight, "g")} → ${num(after.netWeight, "g")}`);
  if (!sameNum(before.diamondWeight, after.diamondWeight)) push("edited", `Diamond ${num(before.diamondWeight, "ct")} → ${num(after.diamondWeight, "ct")}`);
  else if ((after.diamondWeight || 0) > 0 && !same(before.diamondType, after.diamondType)) push("edited", `Diamond ${txt(before.diamondType)} → ${txt(after.diamondType)}`);
  if (!same(before.sku, after.sku)) push("edited", `Design # ${txt(before.sku)} → ${txt(after.sku)}`);
  if ((before.companyId || "main") !== (after.companyId || "main")) {
    const name = opts?.companyName;
    push("edited", name ? `Company ${name(before.companyId || "main")} → ${name(after.companyId || "main")}` : "Company changed");
  }
  const pics = (i: ReadyStockItem) => (i.images ?? []).join("\n");
  if (pics(before) !== pics(after)) {
    const a = before.images?.length ?? 0, b = after.images?.length ?? 0;
    push("edited", a === b ? "Photos changed" : `Photos ${a} → ${b}`);
  }
  if (!same(before.video, after.video)) push("edited", !before.video ? "Video added" : !after.video ? "Video removed" : "Video replaced");
  if (!same(before.notes?.trim(), after.notes?.trim())) push("edited", "Notes changed");

  if (!parts.length) return null;
  const kind = parts.every(p => p.kind === parts[0].kind) ? parts[0].kind : "edited";
  return { kind, text: parts.map(p => p.text).join(" · ") };
}

/** A line of the product page's timeline — `derived` when worked out from other records. */
export interface TimelineEntry extends ReadyStockEvent { derived?: boolean }

/**
 * The piece's whole story, oldest first: its own history, plus what other
 * records already say, for pieces from before history was kept — where it
 * came from, every order it was sold on, every return that came back onto it.
 */
export function pieceTimeline(db: Pick<DB, "orders">, item: ReadyStockItem): TimelineEntry[] {
  const hist = item.history ?? [];
  const out: TimelineEntry[] = [...hist];
  const fr = item.fromReturn;
  const hasOrigin = hist.some(e => e.kind === "added" || e.kind === "split" || (e.kind === "returned" && !!fr && e.ref?.returnId === fr.returnId));
  if (!hasOrigin) {
    const retOrder = fr ? db.orders.find(o => o.id === fr.orderId) : undefined;
    const ret = fr ? retOrder?.returns?.find(r => r.id === fr.returnId) : undefined;
    const built = fr ? undefined : db.orders.find(o => o.readyStockCreatedId === item.id);
    out.push({
      at: item.createdAt, by: item.createdBy, derived: true,
      kind: fr ? "returned" : "added",
      text: fr ? `Came back from order ${retOrder?.orderNumber ?? "(not loaded)"}${ret ? ` — credit note ${ret.creditNoteNo}` : ""}`
        : built ? `Built in-house on order ${built.orderNumber}`
        : "Added to Ready Stock",
      ...(fr ? { ref: { orderId: fr.orderId, returnId: fr.returnId } } : built ? { ref: { orderId: built.id } } : {}),
    });
  }
  for (const o of db.orders) {
    if (o.materialSourcing === "readyStock" && o.readyStockItemId === item.id && !hist.some(e => e.kind === "sold" && e.ref?.orderId === o.id)) {
      out.push({ at: o.createdAt, by: "", ...(o.contactPerson ? { byName: o.contactPerson } : {}), kind: "sold", text: `Sold on ${o.orderNumber}`, ref: { orderId: o.id }, derived: true });
    }
    for (const r of o.returns ?? []) {
      if (r.readyStockId !== item.id || r.status !== "received" || fr?.returnId === r.id) continue;
      if (hist.some(e => e.kind === "returned" && e.ref?.returnId === r.id)) continue;
      out.push({
        at: r.receivedAt ?? r.at, by: r.receivedBy ?? r.by, kind: "returned", derived: true,
        text: `${r.qty} came back — credit note ${r.creditNoteNo}, order ${o.orderNumber}`,
        ref: { orderId: o.id, returnId: r.id },
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
