import io
p='src/pages/Suppliers.tsx'
raw=io.open(p,encoding='utf-8',newline='').read()
nl='\r\n' if '\r\n' in raw else '\n'
old = '''                <div className={`p-2.5 rounded-xl text-center ${account.balanceOwed > 0 ? "bg-destructive/5" : "bg-success/8"}`}>
                  <p className="text-[10px] text-muted-foreground">Owed</p>
                  <p className={`text-xs font-semibold ${account.balanceOwed > 0 ? "text-destructive" : "text-success"}`}>
                    {account.balanceOwed > 0 ? fmtMoneyInr(account.balanceOwed) : "\u2713 Cleared"}
                  </p>
                </div>'''
new = '''                {/* The NET position, the same figure the list and the ledger show.
                    This used to read balanceOwed, which only counts unpaid bills:
                    a supplier holding an advance has no unpaid bill, so the card
                    said "Cleared" while their ledger said they owed us money. */}
                <div className={`p-2.5 rounded-xl text-center ${account.net > 0 ? "bg-destructive/5" : account.net < 0 ? "bg-blue-500/5" : "bg-success/8"}`}>
                  <p className="text-[10px] text-muted-foreground">{account.net < 0 ? "Owes you" : "Owed"}</p>
                  <p className={`text-xs font-semibold ${account.net > 0 ? "text-destructive" : account.net < 0 ? "text-blue-600" : "text-success"}`}>
                    {account.net > 0 ? fmtMoneyInr(account.net)
                      : account.net < 0 ? fmtMoneyInr(-account.net)
                      : "\u2713 Cleared"}
                  </p>
                </div>'''
o=old.replace('\n',nl); w=new.replace('\n',nl)
assert raw.count(o)==1, raw.count(o)
io.open(p,'w',encoding='utf-8',newline='').write(raw.replace(o,w))
print("ok")
