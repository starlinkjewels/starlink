import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { updateDb, uid, fmtMoney, fmtDate, issueGiftCard, giftCardRemaining, giftCardExpired } from "@/lib/db";
import { sendMail } from "@/lib/email";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gift, Ban, Check } from "lucide-react";
import { toast } from "sonner";

/** Admin-only panel on a client's page: enable gift cards/cashback for this
 *  client, issue a welcome gift card, set a cashback %, and see their cards. */
export function GiftCardAdminPanel({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const db = useDb();
  const client = db.clients.find(c => c.id === clientId);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pct, setPct] = useState(client?.cashbackPercent != null ? String(client.cashbackPercent) : "");

  if (user?.role !== "admin" || !client) return null; // admin only — money-sensitive

  const enabled = !!client.giftCardEnabled;
  const cards = (db.giftCards ?? []).filter(c => c.clientId === clientId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const globalPct = db.settings.cashbackPercent ?? 0;

  const setEnabled = (on: boolean) =>
    updateDb(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.giftCardEnabled = on || undefined; });

  const savePct = () =>
    updateDb(d => { const c = d.clients.find(x => x.id === clientId); if (c) c.cashbackPercent = pct.trim() === "" ? undefined : Math.max(0, Number(pct) || 0); });

  const issue = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const now = new Date().toISOString();
    updateDb(d => {
      const c = d.clients.find(x => x.id === clientId);
      if (c && !c.giftCardEnabled) c.giftCardEnabled = true; // issuing turns it on
      issueGiftCard(d, { clientId, amount: amt, source: "welcome", issuedBy: user!.id, note: note.trim() || undefined, at: now });
      const cu = d.users.find(u => u.clientId === clientId && u.role === "client");
      if (cu) d.notifications.unshift({
        id: uid("n_"), userId: cu.id, title: "You've received a Gift Card 🎁",
        body: `${fmtMoney(amt)} gift card — use it on your next order. Valid 30 days.`,
        type: "info", read: false, createdAt: now,
      });
    });
    if (client.email) {
      void sendMail(client.email, "You've received a gift card",
        `<p>Dear ${client.companyName},</p><p>You've received a <b>${fmtMoney(amt)}</b> gift card to use on your next order. It is valid for 30 days.</p>${note.trim() ? `<p>${note.trim()}</p>` : ""}<p>Open your account to see and use it.</p>`);
    }
    toast.success(`${fmtMoney(amt)} gift card issued`);
    setAmount(""); setNote("");
  };

  const revoke = (id: string) => {
    if (!confirm("Cancel this gift card? The client will no longer be able to use it.")) return;
    updateDb(d => { const c = (d.giftCards ?? []).find(x => x.id === id); if (c) c.revoked = true; });
    toast.success("Gift card cancelled");
  };

  return (
    <div className="card-luxe p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary grid place-items-center"><Gift className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-brand-dark">Gift Card &amp; Cashback</h2>
            <p className="text-xs text-muted-foreground">Admin only — off unless you turn it on for this client</p>
          </div>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-medium transition-colors ${enabled ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          {enabled ? <><Check className="h-4 w-4" /> Enabled</> : "Turn on"}
        </button>
      </div>

      {enabled && (
        <div className="mt-4 space-y-4">
          {/* Cashback % */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">Cashback % on delivered orders</Label>
              <Input type="number" min={0} step="0.5" value={pct} onChange={e => setPct(e.target.value)}
                placeholder={globalPct ? `Default ${globalPct}%` : "e.g. 3"} className="rounded-xl mt-1 h-10" />
            </div>
            <Button variant="outline" onClick={savePct} className="rounded-xl h-10">Save %</Button>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">
            {(() => { const eff = client.cashbackPercent ?? globalPct; return eff > 0
              ? `Every delivered order earns a ${eff}% gift card (USD) usable on the next order.`
              : "Set a % here or a global default in Settings to enable cashback."; })()}
          </p>

          {/* Issue a welcome card */}
          <div className="rounded-xl border border-border/70 p-3 bg-secondary/20">
            <p className="text-xs font-semibold text-brand-dark mb-2">Issue a gift card</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-32">
                <Label className="text-xs">Amount ($)</Label>
                <Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} className="rounded-xl mt-1 h-10" />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs">Note (optional)</Label>
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Welcome gift" className="rounded-xl mt-1 h-10" />
              </div>
              <AsyncButton onClick={issue} className="btn-hero rounded-xl h-10">Issue</AsyncButton>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">USD · valid 30 days · usable up to 25% of an order.</p>
          </div>

          {/* Existing cards */}
          {cards.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issued cards</p>
              {cards.map(c => {
                const remaining = giftCardRemaining(c, db.orders);
                const expired = giftCardExpired(c);
                const dead = c.revoked || expired || remaining <= 0.005;
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {fmtMoney(c.amount)} <span className="text-[10px] uppercase tracking-wide text-muted-foreground">· {c.source}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.revoked ? "Cancelled" : expired ? "Expired" : `${fmtMoney(remaining)} left`} · expires {fmtDate(c.expiresAt)}
                      </p>
                    </div>
                    {!dead && (
                      <button onClick={() => revoke(c.id)} className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg px-2 py-1 shrink-0">
                        <Ban className="h-3.5 w-3.5" /> Cancel
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
