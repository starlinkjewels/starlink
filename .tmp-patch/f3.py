import io
def patch(p, pairs):
    raw=io.open(p,encoding='utf-8',newline='').read()
    nl='\r\n' if '\r\n' in raw else '\n'
    for old,new in pairs:
        o=old.replace('\n',nl); w=new.replace('\n',nl)
        assert raw.count(o)==1,(p,raw.count(o),old[:90])
        raw=raw.replace(o,w)
    io.open(p,'w',encoding='utf-8',newline='').write(raw)
    print(p,"ok")

# ── 1. supplier, a specific bill that is no longer there ──
patch('src/pages/Payments.tsx',[
('''        } else {
          const p = d.purchases.find(p => p.id === target);
          if (p) {
            if (!p.payments) p.payments = [];
            p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          }
        }''',
'''        } else {
          const p = d.purchases.find(p => p.id === target);
          if (p) {
            if (!p.payments) p.payments = [];
            p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          } else {
            // The bill went while the form was open. The money still left the
            // account, so it is booked as an advance rather than discarded.
            asAdvance(amt);
          }
        }'''),
# ── 2. factory, FIFO with no job to settle, and a job that is no longer there ──
('''        const factoryIssuances = d.materialIssuances.filter(i => i.factoryId === factoryId);
        if (target === "__fifo") {
          const leftover = allocateFactoryChargePaymentFIFO(factoryIssuances, amt, lockerId, user!.id, now, note.trim() || undefined);
          if (leftover > 0) {
            // Park the excess on the newest issuance so Total Paid / Overpaid reflect it.
            const newest = [...factoryIssuances].sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))[0];
            if (newest) {
              if (!newest.makingCharges.payments) newest.makingCharges.payments = [];
              newest.makingCharges.payments.push({ id: uid("fpay_"), amountInr: leftover, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
            }
          }
        } else {
          const mi = d.materialIssuances.find(x => x.id === target);
          if (mi) {
            if (!mi.makingCharges.payments) mi.makingCharges.payments = [];
            mi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          }
        }''',
'''        const factoryIssuances = d.materialIssuances.filter(i => i.factoryId === factoryId);
        const asAdvance = (sum: number) => {
          if (!d.factoryPayments) d.factoryPayments = [];
          d.factoryPayments.push({ id: uid("fadv_"), factoryId, amountInr: sum, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
        };
        if (target === "__advance") {
          asAdvance(amt);
        } else if (target === "__fifo") {
          const leftover = allocateFactoryChargePaymentFIFO(factoryIssuances, amt, lockerId, user!.id, now, note.trim() || undefined);
          if (leftover > 0) {
            // Park the excess on the newest issuance so Total Paid / Overpaid reflect it.
            const newest = [...factoryIssuances].sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))[0];
            if (newest) {
              if (!newest.makingCharges.payments) newest.makingCharges.payments = [];
              newest.makingCharges.payments.push({ id: uid("fpay_"), amountInr: leftover, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
            } else {
              // No job to settle at all — an advance to a factory that has not
              // started anything yet. It used to be discarded.
              asAdvance(leftover);
            }
          }
        } else {
          const mi = d.materialIssuances.find(x => x.id === target);
          if (mi) {
            if (!mi.makingCharges.payments) mi.makingCharges.payments = [];
            mi.makingCharges.payments.push({ id: uid("fpay_"), amountInr: amt, lockerId, recordedBy: user!.id, createdAt: now, note: note.trim() || undefined });
          } else {
            asAdvance(amt);
          }
        }'''),
('''              <SelectItem value="__fifo">Oldest issued first</SelectItem>''',
 '''              <SelectItem value="__fifo">Oldest issued first</SelectItem>
              <SelectItem value="__advance">Advance / loan \u2014 not against any job</SelectItem>'''),
])

# ── 3. supplier page, a specific bill that is no longer there ──
patch('src/pages/SupplierHistory.tsx',[
('''      } else {
        const p = d.purchases.find(p => p.id === payTargetPurchase);
        if (p) {
          if (!p.payments) p.payments = [];
          p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
        }
      }''',
'''      } else {
        const p = d.purchases.find(p => p.id === payTargetPurchase);
        if (p) {
          if (!p.payments) p.payments = [];
          p.payments.push({ id: uid("ppay_"), amountInr: amt, lockerId: payLockerId, recordedBy: user!.id, createdAt: now, note: payNote.trim() || undefined });
        } else {
          // The bill went while the form was open. The money still left the
          // account, so it is booked as an advance rather than discarded.
          asAdvance(amt);
        }
      }'''),
])
