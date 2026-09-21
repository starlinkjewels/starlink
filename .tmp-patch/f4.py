import io
p='src/lib/moneyEntries.ts'
raw=io.open(p,encoding='utf-8',newline='').read()
nl='\r\n' if '\r\n' in raw else '\n'
def rep(old,new):
    global raw
    o=old.replace('\n',nl); w=new.replace('\n',nl)
    assert raw.count(o)==1,(raw.count(o),old[:80])
    raw=raw.replace(o,w)

rep('''  if (kind === "factory") {
    for (const mi of db.materialIssuances ?? []) {''',
'''  if (kind === "factory") {
    // Advances and loans \u2014 paid to the factory against no particular job.
    for (const a of db.factoryPayments ?? []) {
      const factory = db.factories.find(f => f.id === a.factoryId);
      out.push({
        id: a.id, kind, date: a.createdAt,
        party: factory?.name ?? "Factory", against: "Advance / loan",
        amount: a.amountInr, currency: "INR",
        lockerId: a.lockerId, note: a.note, direction: "out",
      });
    }
    for (const mi of db.materialIssuances ?? []) {''')

rep('''    if (entry.kind === "factory") {
      for (const mi of d.materialIssuances ?? []) {
        const pay = (mi.makingCharges?.payments ?? []).find(x => x.id === entry.id);
        if (pay) {
          if (patch.amount !== undefined) pay.amountInr = r2(patch.amount);
          if (patch.date !== undefined) pay.createdAt = patch.date;
          if (patch.note !== undefined) pay.note = patch.note || undefined;
          if (patch.lockerId !== undefined) pay.lockerId = patch.lockerId;
          syncTxn(d, entry, patch);''',
'''    if (entry.kind === "factory") {
      const adv = (d.factoryPayments ?? []).find(x => x.id === entry.id);
      if (adv) {
        if (patch.amount !== undefined) adv.amountInr = r2(patch.amount);
        if (patch.date !== undefined) adv.createdAt = patch.date;
        if (patch.note !== undefined) adv.note = patch.note || undefined;
        if (patch.lockerId !== undefined) adv.lockerId = patch.lockerId;
        syncTxn(d, entry, patch);
        return;
      }
      for (const mi of d.materialIssuances ?? []) {
        const pay = (mi.makingCharges?.payments ?? []).find(x => x.id === entry.id);
        if (pay) {
          if (patch.amount !== undefined) pay.amountInr = r2(patch.amount);
          if (patch.date !== undefined) pay.createdAt = patch.date;
          if (patch.note !== undefined) pay.note = patch.note || undefined;
          if (patch.lockerId !== undefined) pay.lockerId = patch.lockerId;
          syncTxn(d, entry, patch);''')

rep('''    if (entry.kind === "factory") {
      for (const mi of d.materialIssuances ?? []) {
        if ((mi.makingCharges?.payments ?? []).some(x => x.id === entry.id)) {
          mi.makingCharges.payments = mi.makingCharges.payments.filter(x => x.id !== entry.id);
          dropTxn(d, entry);
          return;
        }
      }
      return;
    }''',
'''    if (entry.kind === "factory") {
      if ((d.factoryPayments ?? []).some(x => x.id === entry.id)) {
        d.factoryPayments = d.factoryPayments.filter(x => x.id !== entry.id);
        dropTxn(d, entry);
        return;
      }
      for (const mi of d.materialIssuances ?? []) {
        if ((mi.makingCharges?.payments ?? []).some(x => x.id === entry.id)) {
          mi.makingCharges.payments = mi.makingCharges.payments.filter(x => x.id !== entry.id);
          dropTxn(d, entry);
          return;
        }
      }
      return;
    }''')
io.open(p,'w',encoding='utf-8',newline='').write(raw)
print("ok")
