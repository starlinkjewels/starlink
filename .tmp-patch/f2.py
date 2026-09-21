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

# ── all factoryAccount callers pass the advances ──
patch('src/pages/Dashboard.tsx',[(
'''    (s, f) => s + factoryAccount(db.materialIssuances.filter(i => i.factoryId === f.id), f).chargesPending, 0);''',
'''    (s, f) => s + factoryAccount(
      db.materialIssuances.filter(i => i.factoryId === f.id),
      f,
      (db.factoryPayments ?? []).filter(x => x.factoryId === f.id),
    ).chargesPending, 0);''')])

patch('src/pages/Factories.tsx',[(
'''    factoryAccount(db.materialIssuances.filter(i => i.factoryId === fac.id), fac),''',
'''    factoryAccount(
      db.materialIssuances.filter(i => i.factoryId === fac.id),
      fac,
      (db.factoryPayments ?? []).filter(x => x.factoryId === fac.id),
    ),''')])

patch('src/pages/FactoryHistory.tsx',[(
'''  const account = factoryAccount(issuances, factory);''',
'''  // Advances and loans — paid to this factory but settling no particular job.
  const advances = (db.factoryPayments ?? []).filter(x => x.factoryId === id);
  const account = factoryAccount(issuances, factory, advances);''')])

patch('src/pages/Payments.tsx',[
('''  const account = factoryAccount(issuances, db.factories.find(f => f.id === factoryId));''',
'''  const account = factoryAccount(
    issuances,
    db.factories.find(f => f.id === factoryId),
    (db.factoryPayments ?? []).filter(x => x.factoryId === factoryId),
  );'''),
])
