import io
def patch(p, pairs):
    raw=io.open(p,encoding='utf-8',newline='').read()
    nl='\r\n' if '\r\n' in raw else '\n'
    for old,new in pairs:
        o=old.replace('\n',nl); w=new.replace('\n',nl)
        assert raw.count(o)==1,(p,raw.count(o),old[:80])
        raw=raw.replace(o,w)
    io.open(p,'w',encoding='utf-8',newline='').write(raw)
    print(p,"ok")

patch('src/lib/db.ts',[
('''export interface Purchase {''',
'''/**
 * Money paid to a factory that settles no particular job — an advance against
 * work to come, or a loan. The mirror of SupplierPayment, and there for the
 * same reason: a making-charge payment normally lives inside the issuance it
 * pays for, which leaves nowhere to put one when there is no job yet.
 */
export interface FactoryPayment {
  id: string;
  factoryId: string;
  amountInr: number;
  lockerId: string; // which Locker the money came out of
  recordedBy: string;
  createdAt: string;
  note?: string;
}

export interface Purchase {'''),
('''  supplierPayments: SupplierPayment[];
  clientReceipts: ClientReceipt[];''',
 '''  supplierPayments: SupplierPayment[];
  factoryPayments: FactoryPayment[];
  clientReceipts: ClientReceipt[];'''),
('''    supplierPayments: [],
    clientReceipts: [],''',
 '''    supplierPayments: [],
    factoryPayments: [],
    clientReceipts: [],'''),
('''  | "supplierPayments"
  | "clientReceipts"''',
 '''  | "supplierPayments"
  | "factoryPayments"
  | "clientReceipts"'''),
('''  "supplierPayments",
  "clientReceipts",''',
 '''  "supplierPayments",
  "factoryPayments",
  "clientReceipts",'''),
('''        col === "supplierPayments" ||
        col === "clientReceipts" ||''',
 '''        col === "supplierPayments" ||
        col === "factoryPayments" ||
        col === "clientReceipts" ||'''),
])

patch('src/lib/manufacturing.ts',[
('''  type SupplierPayment,''','''  type SupplierPayment,
  type FactoryPayment,'''),
('''export function factoryAccount(issuances: MaterialIssuance[], opening?: OpeningBalanceInfo) {''',
'''export function factoryAccount(
  issuances: MaterialIssuance[],
  opening?: OpeningBalanceInfo,
  /** Payments that settle no particular job — advances and loans. */
  standalonePayments: FactoryPayment[] = [],
) {'''),
('''  if (oDebit) {
    const applied = Math.min(oDebit, chargesPending);
    chargesPending -= applied;
    chargesOverpaid += oDebit - applied;
  }
  return {''',
'''  if (oDebit) {
    const applied = Math.min(oDebit, chargesPending);
    chargesPending -= applied;
    chargesOverpaid += oDebit - applied;
  }
  // An advance settles no one job, so it comes off what is still due; pay more
  // than is due and the rest stands as money the factory is holding for us.
  const advanced = standalonePayments.reduce((s, p) => s + p.amountInr, 0);
  if (advanced) {
    chargesPaid += advanced;
    const applied = Math.min(advanced, chargesPending);
    chargesPending -= applied;
    chargesOverpaid += advanced - applied;
  }
  return {'''),
])
