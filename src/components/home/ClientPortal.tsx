import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, Banknote, CheckCircle2, Download, FileText, PenTool, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionSheet } from "@/components/ActionSheet";
import { StatStrip } from "@/components/TableToolbar";
import { SectionTitle } from "@/components/SectionTitle";
import { buildInvoiceBlocks } from "@/components/ClientInvoiceLedger";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fmtDate, fmtMoney, todayLocal, stampFor, uid, updateDb } from "@/lib/db";
import { adminIds, notifyUsers } from "@/lib/notify";
import { brandForDocument, companyById, companyIdOfClient, hasCompanies, MAIN_COMPANY_ID } from "@/lib/companies";
import { daysOverdue, invoiceDueAt, invoiceOwed, termsDaysOf, termsLabel } from "@/lib/paymentTerms";
import { cadState } from "@/lib/cadApproval";
import { downloadInvoiceStatementPdf } from "@/lib/clientStatement";

/**
 * A client's own Home, the portal part: what is waiting on them (a design to approve, bills to
 * pay — overdue first), where their account stands, their statement, how to pay us, and
 * "I've paid" to tell the team a payment is on its way. Only their own records are read (the
 * database lets a client read nothing else); their credit limit is never shown.
 */
export function ClientPortal() {
  const { user } = useAuth();
  const db = useDb();
  const clientId = user?.clientId ?? "";
  const client = db.clients.find(c => c.id === clientId);
  const [paidOpen, setPaidOpen] = useState(false);

  const { designs, bills, dueNow, overdue, credit, blocks } = useMemo(() => {
    const orders = db.orders.filter(o => o.clientId === clientId && !o.deletedAt);
    const cadIdx = (o: (typeof orders)[number]) => o.timeline.findIndex(t => t.step === "CAD Designing");
    const designs = orders.filter(o => cadState(o) === "waiting" && cadIdx(o) >= 0 && o.timeline[cadIdx(o)].status !== "done" && o.status !== "Rejected");
    const bills = (db.invoices ?? []).filter(i => i.clientId === clientId).map(inv => {
      const owed = invoiceOwed(db.orders, inv);
      const dueAt = invoiceDueAt(inv, client, db.settings);
      return { inv, owed, dueAt, late: daysOverdue(dueAt, owed) };
    }).filter(b => b.owed > 0.005)
      .sort((a, b) => b.late - a.late || +new Date(a.inv.createdAt) - +new Date(b.inv.createdAt));
    const blocks = buildInvoiceBlocks(db.invoices ?? [], db.orders, clientId).map(b => {
      const inv = (db.invoices ?? []).find(i => i.id === b.id);
      const dueAt = inv ? invoiceDueAt(inv, client, db.settings) : undefined;
      return dueAt ? { ...b, dueAt } : b;
    });
    return {
      designs, bills, blocks,
      dueNow: Math.round(bills.reduce((s, b) => s + b.owed, 0) * 100) / 100,
      overdue: Math.round(bills.filter(b => b.late > 0).reduce((s, b) => s + b.owed, 0) * 100) / 100,
      credit: Math.round((client?.creditBalance || 0) * 100) / 100,
    };
  }, [db.orders, db.invoices, db.settings, client, clientId]);

  if (!client) return null;
  const brand = brandForDocument(db, { clientId });
  const bank = [brand.bankDetailsImage1, brand.bankDetailsImage2].filter((s): s is string => !!s);
  const terms = termsDaysOf(client, db.settings);
  const company = hasCompanies(db.settings) && companyIdOfClient(client) !== MAIN_COMPANY_ID ? companyById(db.settings, companyIdOfClient(client)).name : undefined;
  const statement = () => downloadInvoiceStatementPdf({ client, allBlocks: blocks, from: null, to: null, company });

  return (
    <section className="space-y-3" aria-label="Your account">
      <SectionTitle title="Your account" sub={terms != null ? `Payment terms: ${termsLabel(terms)}` : undefined}
        actions={<>
          <Button variant="outline" onClick={statement} className="rounded-xl h-9 gap-1.5"><Download className="h-4 w-4" />Statement</Button>
          {dueNow > 0 && <Button onClick={() => setPaidOpen(true)} className="btn-hero rounded-xl h-9 gap-1.5"><Send className="h-4 w-4" />I've paid</Button>}
        </>} />
      <StatStrip items={[
        { label: "Due now", value: dueNow > 0 ? fmtMoney(dueNow) : "✓ Cleared", tone: dueNow > 0 ? "out" : "in", icon: FileText,
          sub: `${bills.length} invoice${bills.length === 1 ? "" : "s"} to pay` },
        ...(overdue > 0 ? [{ label: "Overdue", value: fmtMoney(overdue), tone: "out" as const, icon: AlertCircle, sub: "Past the due date" }] : []),
        ...(credit > 0 ? [{ label: "Your credit", value: fmtMoney(credit), tone: "in" as const, sub: "Held for your next bills" }] : []),
      ]} />

      {(designs.length > 0 || bills.length > 0) && (
        <div className="card-luxe p-4 space-y-2" role="region" aria-label="Waiting on you">
          <p className="text-sm font-semibold text-brand-dark">Waiting on you</p>
          <ul className="divide-y divide-border/60">
            {designs.map(o => (
              <li key={o.id} className="py-2 flex items-center gap-3">
                <PenTool className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1 min-w-0 text-sm">A design to approve — <span className="font-medium">{o.orderNumber}</span></span>
                <Link to={`/orders/${o.id}`} className="text-sm font-medium text-primary hover:underline whitespace-nowrap">Review</Link>
              </li>
            ))}
            {bills.map(b => (
              <li key={b.inv.id} className="py-2 flex items-center gap-3">
                <FileText className={`h-4 w-4 shrink-0 ${b.late > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                <span className="flex-1 min-w-0 text-sm">
                  Invoice <span className="font-medium">{b.inv.number}</span> · {fmtMoney(b.owed)}
                  <span className={`block text-xs ${b.late > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    {b.late > 0 ? `${b.late} day${b.late === 1 ? "" : "s"} overdue (due ${fmtDate(b.dueAt)})` : b.dueAt ? `Due ${fmtDate(b.dueAt)}` : `Raised ${fmtDate(b.inv.createdAt)}`}
                  </span>
                </span>
                <Link to={`/invoices?q=${encodeURIComponent(b.inv.number)}`} className="text-sm font-medium text-primary hover:underline whitespace-nowrap">Open</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(bank.length > 0 || brand.invoiceBankText) && dueNow > 0 && (
        <div className="card-luxe p-4 space-y-2" role="region" aria-label="How to pay">
          <p className="text-sm font-semibold text-brand-dark flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" />How to pay</p>
          <p className="text-xs text-muted-foreground">Pay {brand.companyName || "us"} by bank transfer, quoting your invoice number. Then press I've paid so we look out for it.</p>
          {bank.length > 0
            ? <div className="flex flex-wrap gap-3">{bank.map(src => <img key={src.slice(-24)} src={src} alt="Bank details" className="max-h-40 max-w-full object-contain rounded-lg border border-border/60 bg-white" />)}</div>
            : <p className="text-sm whitespace-pre-line rounded-lg border border-border/60 bg-white p-3">{brand.invoiceBankText}</p>}
        </div>
      )}

      <IvePaid open={paidOpen} onOpenChange={setPaidOpen} bills={bills.map(b => ({ id: b.inv.id, number: b.inv.number, owed: b.owed }))} />
    </section>
  );
}

/** "I've paid": the client tells the team a payment is on its way — nothing is recorded as received
 *  until the team sees the money and takes it in (Payments → Receive). */
function IvePaid({ open, onOpenChange, bills }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  bills: { id: string; number: string; owed: number }[];
}) {
  const { user } = useAuth();
  const db = useDb();
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(todayLocal());
  const [ref, setRef] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const client = db.clients.find(c => c.id === user?.clientId);

  const send = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error("Enter the amount you paid"); return; }
    if (!client) return;
    const nos = bills.filter(b => picked.includes(b.id)).map(b => b.number);
    const what = `${fmtMoney(amt)} on ${fmtDate(stampFor(day))}${ref.trim() ? ` · ref ${ref.trim()}` : ""}${nos.length ? ` · for invoice${nos.length > 1 ? "s" : ""} ${nos.join(", ")}` : ""}`;
    updateDb(d => {
      notifyUsers(d, [client.accountManagerId, ...adminIds(d)], {
        title: `Payment sent by ${client.companyName}`,
        body: `${what} — record it in Payments → Receive when it arrives.`, type: "payment",
      }, user!.id);
      // Their own copy, in their Alerts.
      d.notifications.unshift({ id: uid("n_"), userId: user!.id, title: "We've been told about your payment",
        body: `${what}. We'll confirm when it arrives.`, type: "info", read: false, createdAt: new Date().toISOString() });
    });
    toast.success("Thank you — the team has been told");
    onOpenChange(false); setAmount(""); setRef(""); setPicked([]); setDay(todayLocal());
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title="I've paid" description="Tell us about a payment you have sent — we confirm it when it arrives" icon={CheckCircle2} size="md"
      footer={<div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
        <Button onClick={send} className="btn-hero rounded-xl px-6">Send</Button>
      </div>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="paid-amount" className="text-xs">Amount you paid ($)</Label>
          <Input id="paid-amount" type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div>
          <Label htmlFor="paid-day" className="text-xs">Paid on</Label>
          <Input id="paid-day" type="date" max={todayLocal()} value={day} onChange={e => setDay(e.target.value)} className="rounded-xl h-10 mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="paid-ref" className="text-xs">Bank reference <span className="font-normal text-muted-foreground">· optional</span></Label>
          <Input id="paid-ref" value={ref} onChange={e => setRef(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="e.g. the wire / UTR number" />
        </div>
        {bills.length > 0 && (
          <div className="sm:col-span-2 space-y-1.5" role="group" aria-label="For invoices">
            <p className="text-xs font-medium">For invoices <span className="font-normal text-muted-foreground">· optional</span></p>
            {bills.map(b => (
              <label key={b.id} className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.includes(b.id)}
                  onChange={e => setPicked(p => (e.target.checked ? [...p, b.id] : p.filter(x => x !== b.id)))} />
                <span className="flex-1">Invoice {b.number}</span><span className="tabular-nums text-xs">{fmtMoney(b.owed)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </ActionSheet>
  );
}
