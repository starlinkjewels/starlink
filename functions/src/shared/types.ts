/**
 * The record fields the shared account calculations read (./accounts.ts,
 * ./basics.ts — copied from the app's src/lib/pure). The app's full types live
 * in its src/lib/db.ts; only the parts these calculations touch are here, so a
 * field they start reading must be added here too or the build says so.
 */
export type LedgerDir = "debit" | "credit";

export interface OpeningBalanceInfo {
  openingBalance?: number;
  openingDir?: LedgerDir;
  openingDate?: string;
}

interface Paid { amountInr: number }

export interface Purchase { totalInr: number; payments?: Paid[] }
export interface SupplierReceipt extends Paid {}
export interface SupplierPayment extends Paid {}
export interface FactoryPayment extends Paid {}

export interface MaterialIssuance {
  factoryId: string;
  orderId?: string;
  material: "gold" | "diamond" | string;
  purityOrQuality: string;
  quantityIssued: number;
  status?: string;
  source?: string;
  diamondKind?: string;
  finishDisposition?: string;
  finishReturnedCt?: number;
  finishReturnedQty?: number;
  companyId?: string;
  finishedNetWeight?: number;
  finishedPurity?: number;
  finishedKarat?: string;
  finishedPieces?: { quantityUsed: number }[];
  makingCharges: { amountInr: number; payments?: Paid[] };
}

export interface Locker { id: string; openingBalance: number }
export interface LockerTransaction { lockerId: string; type: string; amountInr: number }
