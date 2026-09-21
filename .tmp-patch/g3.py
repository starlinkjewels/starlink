import io
p='src/lib/supplierRepair.ts'
raw=io.open(p,encoding='utf-8',newline='').read()
nl='\r\n' if '\r\n' in raw else '\n'
raw = raw.replace('const PREFIX = "Supplier Payment \u2014 ";',
                  'const SUPPLIER_PREFIX = "Supplier Payment \u2014 ";\nconst FACTORY_PREFIX = "Making Charges \u2014 ";')
raw = raw.replace('''export interface OrphanSupplierPayment {
  txnId: string;
  supplierId: string;
  supplierName: string;''',
'''export interface OrphanSupplierPayment {
  txnId: string;
  /** Which books the money never reached. */
  kind: "supplier" | "factory";
  partyId: string;
  partyName: string;''')
raw = raw.replace('''    if (t.type !== "expense" || !t.category?.startsWith(PREFIX)) continue;
    const name = t.category.slice(PREFIX.length).trim();
    // Renamed since? Then we cannot say whose payment this was \u2014 leave it alone
    // rather than post it to the wrong supplier.
    const supplier = db.suppliers.find(s => s.name.trim() === name);
    if (!supplier) continue;''',
'''    if (t.type !== "expense") continue;
    const isSupplier = !!t.category?.startsWith(SUPPLIER_PREFIX);
    const isFactory = !!t.category?.startsWith(FACTORY_PREFIX);
    if (!isSupplier && !isFactory) continue;
    const name = t.category!.slice((isSupplier ? SUPPLIER_PREFIX : FACTORY_PREFIX).length).trim();
    // Renamed since? Then we cannot say whose payment this was \u2014 leave it alone
    // rather than post it to the wrong party.
    const party = isSupplier
      ? db.suppliers.find(s => s.name.trim() === name)
      : db.factories.find(f => f.name.trim() === name);
    if (!party) continue;''')
raw = raw.replace('''    let booked = 0;
    for (const p of db.purchases ?? []) {
      if (p.supplierId !== supplier.id) continue;
      for (const pay of p.payments ?? []) {
        if (pay.lockerId === t.lockerId && sameMoment(pay.createdAt)) booked += pay.amountInr;
      }
    }
    for (const a of db.supplierPayments ?? []) {
      if (a.supplierId !== supplier.id) continue;
      if (a.lockerId === t.lockerId && sameMoment(a.createdAt)) booked += a.amountInr;
    }''',
'''    let booked = 0;
    if (isSupplier) {
      for (const p of db.purchases ?? []) {
        if (p.supplierId !== party.id) continue;
        for (const pay of p.payments ?? []) {
          if (pay.lockerId === t.lockerId && sameMoment(pay.createdAt)) booked += pay.amountInr;
        }
      }
      for (const a of db.supplierPayments ?? []) {
        if (a.supplierId !== party.id) continue;
        if (a.lockerId === t.lockerId && sameMoment(a.createdAt)) booked += a.amountInr;
      }
    } else {
      for (const mi of db.materialIssuances ?? []) {
        if (mi.factoryId !== party.id) continue;
        for (const pay of mi.makingCharges?.payments ?? []) {
          if (pay.lockerId === t.lockerId && sameMoment(pay.createdAt)) booked += pay.amountInr;
        }
      }
      for (const a of db.factoryPayments ?? []) {
        if (a.factoryId !== party.id) continue;
        if (a.lockerId === t.lockerId && sameMoment(a.createdAt)) booked += a.amountInr;
      }
    }''')
raw = raw.replace('''      out.push({
        txnId: t.id, supplierId: supplier.id, supplierName: supplier.name,
        lockerId: t.lockerId, at: t.createdAt, amountInr: missing,
      });''',
'''      out.push({
        txnId: t.id, kind: isSupplier ? "supplier" : "factory",
        partyId: party.id, partyName: party.name,
        lockerId: t.lockerId, at: t.createdAt, amountInr: missing,
      });''')
raw = raw.replace('''  updateDb(d => {
    if (!d.supplierPayments) d.supplierPayments = [];
    for (const o of orphans) {
      d.supplierPayments.push({
        id: uid("spay_"),
        supplierId: o.supplierId,
        amountInr: o.amountInr,
        lockerId: o.lockerId,
        recordedBy: userId,
        createdAt: o.at,
        note: "Recovered \u2014 paid from the account but missing from the supplier's books",
      });
    }
  });''',
'''  updateDb(d => {
    if (!d.supplierPayments) d.supplierPayments = [];
    if (!d.factoryPayments) d.factoryPayments = [];
    for (const o of orphans) {
      const note = `Recovered \u2014 paid from the account but missing from the ${o.kind}'s books`;
      if (o.kind === "supplier") {
        d.supplierPayments.push({
          id: uid("spay_"), supplierId: o.partyId, amountInr: o.amountInr,
          lockerId: o.lockerId, recordedBy: userId, createdAt: o.at, note,
        });
      } else {
        d.factoryPayments.push({
          id: uid("fadv_"), factoryId: o.partyId, amountInr: o.amountInr,
          lockerId: o.lockerId, recordedBy: userId, createdAt: o.at, note,
        });
      }
    }
  });''')
io.open(p,'w',encoding='utf-8',newline='').write(raw)
print("ok")
