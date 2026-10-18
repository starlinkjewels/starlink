/**
 * Totals kept on the server — one small document per factory, supplier and
 * locker in `summaries`, so screens that only need a party's figures (the
 * dashboard, the lists) can read those instead of downloading every record.
 *
 * Each total is worked out from the records themselves, with exactly the code
 * the app uses (./shared, copied from src/lib/pure), every time one of that
 * party's records is written. Recomputing from the records — never adding or
 * subtracting a change — means a trigger delivered twice, or out of order,
 * still lands on the right figure. Each recompute runs in a transaction, so
 * two saves a moment apart cannot leave the older figure standing.
 *
 * Built once per database (makeSummaries): the demo set is deployed and proven
 * before production's is.
 */
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, AggregateField, FieldValue, type Firestore, type DocumentData } from "firebase-admin/firestore";
import { factoryAccount, factoryFineGoldBalance, factoryPoolBuckets, supplierAccount } from "./shared/accounts";
import type { MaterialIssuance, FactoryPayment, Purchase, SupplierReceipt, SupplierPayment, OpeningBalanceInfo } from "./shared/types";
import { app } from "./lib/firestoreAdmin";

type DbName = "ssdiamdemo" | "diamondflow";
const SUM = "summaries";
/** Bumped when what a summary holds changes, so old ones can be told apart.
 *  2: a factory's summary also carries its pool stock (goldPool, diaPool).
 *  3: other materials (Settings → Materials) are kept out of the diamond figures.
 *  4: a locker's balance keeps its cents (accounts in any currency). */
const VERSION = 4;
const REGION = "us-central1";

/** Owners recognised by email, as each database's rules recognise them. */
export const OWNER_EMAILS: Record<DbName, string[]> = {
  diamondflow: ["marketing.starlinkjewels@gmail.com", "admin@starlinkjewels.com"],
  ssdiamdemo: ["marketing.starlinkjewels@gmail.com", "admin@starlinkjewels.com", "test@gmail.com"],
};

const fsFor = (db: DbName): Firestore => getFirestore(app, db);
const data = <T>(d: { data(): DocumentData | undefined }) => d.data() as T;

export async function rebuildFactory(fs: Firestore, factoryId: string): Promise<void> {
  if (!factoryId) return;
  await fs.runTransaction(async t => {
    const [fac, iss, pays] = await Promise.all([
      t.get(fs.collection("factories").doc(factoryId)),
      t.get(fs.collection("materialIssuances").where("factoryId", "==", factoryId)),
      t.get(fs.collection("factoryPayments").where("factoryId", "==", factoryId)),
    ]);
    const ref = fs.collection(SUM).doc(`factory_${factoryId}`);
    if (!fac.exists) { t.delete(ref); return; }
    const f = fac.data() as OpeningBalanceInfo & { openingFineGold?: number };
    const list = iss.docs.map(d => data<MaterialIssuance>(d));
    const acct = factoryAccount(list, f, pays.docs.map(d => data<FactoryPayment>(d)));
    t.set(ref, {
      kind: "factory", partyId: factoryId, v: VERSION,
      ...acct,
      fineGold: factoryFineGoldBalance(list, factoryId, f.openingFineGold || 0),
      // Bulk-delivered material not yet drawn for an order — the list's "Pool stock".
      goldPool: factoryPoolBuckets(list, factoryId, "gold").reduce((t, b) => t + b.balance, 0),
      diaPool: factoryPoolBuckets(list, factoryId, "diamond").reduce((t, b) => t + b.balance, 0),
      records: list.length,
      computedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function rebuildSupplier(fs: Firestore, supplierId: string): Promise<void> {
  if (!supplierId) return;
  await fs.runTransaction(async t => {
    const [sup, pur, rec, pay] = await Promise.all([
      t.get(fs.collection("suppliers").doc(supplierId)),
      t.get(fs.collection("purchases").where("supplierId", "==", supplierId)),
      t.get(fs.collection("supplierReceipts").where("supplierId", "==", supplierId)),
      t.get(fs.collection("supplierPayments").where("supplierId", "==", supplierId)),
    ]);
    const ref = fs.collection(SUM).doc(`supplier_${supplierId}`);
    if (!sup.exists) { t.delete(ref); return; }
    const acct = supplierAccount(
      pur.docs.map(d => data<Purchase>(d)),
      rec.docs.map(d => data<SupplierReceipt>(d)),
      sup.data() as OpeningBalanceInfo,
      pay.docs.map(d => data<SupplierPayment>(d)),
    );
    t.set(ref, { kind: "supplier", partyId: supplierId, v: VERSION, ...acct, records: pur.size, computedAt: FieldValue.serverTimestamp() });
  });
}

/** A locker's balance by the database's own sums — however many entries it
 *  holds, this reads a handful of index pages, not the entries. */
export async function rebuildLocker(fs: Firestore, lockerId: string): Promise<void> {
  if (!lockerId) return;
  await fs.runTransaction(async t => {
    const txns = fs.collection("lockerTransactions").where("lockerId", "==", lockerId);
    const sumOf = (types: string[]) => txns.where("type", "in", types)
      .aggregate({ total: AggregateField.sum("amountInr"), n: AggregateField.count() });
    const [lk, inn, out] = await Promise.all([
      t.get(fs.collection("lockers").doc(lockerId)),
      t.get(sumOf(["income", "transfer_in"])),
      t.get(sumOf(["expense", "transfer_out"])),
    ]);
    const ref = fs.collection(SUM).doc(`locker_${lockerId}`);
    if (!lk.exists) { t.delete(ref); return; }
    const l = lk.data() as { openingBalance?: number; currency?: string };
    const moneyIn = inn.data().total || 0, moneyOut = out.data().total || 0;
    t.set(ref, {
      kind: "locker", partyId: lockerId, v: VERSION,
      currency: l.currency || "INR",
      openingBalance: l.openingBalance || 0,
      moneyIn, moneyOut,
      // To the cent, the way lockerBalance() rounds, so the two read the same
      // (version 4: before it, whole units — a dollar account lost its cents).
      balance: Math.round(((l.openingBalance || 0) + moneyIn - moneyOut) * 100) / 100,
      records: (inn.data().n || 0) + (out.data().n || 0),
      computedAt: FieldValue.serverTimestamp(),
    });
  });
}

/** The party ids a write touched — both before and after, in case it moved. */
function idsOf(ev: { data?: { before?: { data(): DocumentData | undefined }; after?: { data(): DocumentData | undefined } } }, field: string): string[] {
  const ids = new Set<string>();
  for (const s of [ev.data?.before, ev.data?.after]) {
    const v = s?.data()?.[field];
    if (typeof v === "string" && v) ids.add(v);
  }
  return [...ids];
}

/** Every summary trigger, plus the admin's "rebuild everything", for one database. */
export function makeSummaries(db: DbName) {
  const fs = fsFor(db);
  const on = (path: string, field: string | null, rebuild: (fs: Firestore, id: string) => Promise<void>) =>
    onDocumentWritten({ document: `${path}/{id}`, database: db, region: REGION, retry: false }, async ev => {
      const ids = field ? idsOf(ev, field) : [ev.params.id];
      await Promise.all(ids.map(id => rebuild(fs, id)));
    });

  return {
    factory: on("factories", null, rebuildFactory),
    issuance: on("materialIssuances", "factoryId", rebuildFactory),
    factoryPayment: on("factoryPayments", "factoryId", rebuildFactory),
    supplier: on("suppliers", null, rebuildSupplier),
    purchase: on("purchases", "supplierId", rebuildSupplier),
    supplierReceipt: on("supplierReceipts", "supplierId", rebuildSupplier),
    supplierPayment: on("supplierPayments", "supplierId", rebuildSupplier),
    locker: on("lockers", null, rebuildLocker),
    lockerEntry: on("lockerTransactions", "lockerId", rebuildLocker),

    /** Admin only: work out every party's totals from scratch — the first fill,
     *  and the repair if a summary is ever in doubt. */
    rebuild: onCall({ region: REGION, timeoutSeconds: 540, memory: "512MiB" }, async req => {
      const uid = req.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
      const email = String(req.auth?.token?.email || "").toLowerCase();
      const idx = (await fs.collection("userByAuth").doc(uid).get()).data() as { role?: string; status?: string } | undefined;
      const isAdmin = OWNER_EMAILS[db].includes(email) || (idx?.role === "admin" && idx?.status === "active");
      if (!isAdmin) throw new HttpsError("permission-denied", "Only an admin can rebuild the totals.");
      const [facs, sups, lks] = await Promise.all([
        fs.collection("factories").select().get(),
        fs.collection("suppliers").select().get(),
        fs.collection("lockers").select().get(),
      ]);
      const failed: string[] = [];
      const run = async (kind: string, ids: string[], fn: (fs: Firestore, id: string) => Promise<void>) => {
        for (const id of ids) {
          try { await fn(fs, id); } catch (e) { failed.push(`${kind} ${id}: ${(e as Error).message}`); }
        }
      };
      await run("factory", facs.docs.map(d => d.id), rebuildFactory);
      await run("supplier", sups.docs.map(d => d.id), rebuildSupplier);
      await run("locker", lks.docs.map(d => d.id), rebuildLocker);
      return { factories: facs.size, suppliers: sups.size, lockers: lks.size, failed };
    }),
  };
}
