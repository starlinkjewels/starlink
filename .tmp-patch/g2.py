import io
p='src/pages/FactoryHistory.tsx'
raw=io.open(p,encoding='utf-8',newline='').read()
nl='\r\n' if '\r\n' in raw else '\n'
old = '''      for (const pay of mi.makingCharges.payments || []) {
        rows.push({ ...zero(), id: pay.id, date: pay.createdAt, ref, particular: `Payment${pay.note ? ` \u2014 ${pay.note}` : ""}`, drAmount: pay.amountInr });
      }
    }
    return rows.sort('''
new = '''      for (const pay of mi.makingCharges.payments || []) {
        rows.push({ ...zero(), id: pay.id, date: pay.createdAt, ref, particular: `Payment${pay.note ? ` \u2014 ${pay.note}` : ""}`, drAmount: pay.amountInr });
      }
    }
    // Advances and loans \u2014 money out against no particular job. Without these
    // the statement would not add up to the balance shown above it.
    for (const a of advances) {
      rows.push({ ...zero(), id: a.id, date: a.createdAt, ref: "", particular: `Advance / loan paid${a.note ? ` \u2014 ${a.note}` : ""}`, drAmount: a.amountInr });
    }
    return rows.sort('''
o=old.replace('\n',nl); w=new.replace('\n',nl)
assert raw.count(o)==1, raw.count(o)
io.open(p,'w',encoding='utf-8',newline='').write(raw.replace(o,w))
print("ok")
