import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { activeGiftCardsFor, giftCardRemaining, giftCardGranted, giftMaxRedeemPctFor, fmtMoney, fmtDate } from "@/lib/db";
import { Gift, Clock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));
}

export function GiftCardPage() {
  const { user } = useAuth();
  const db = useDb();
  const clientId = user?.clientId ?? undefined;
  const cards = clientId ? activeGiftCardsFor(db, clientId) : [];
  const total = cards.reduce((s, c) => s + giftCardRemaining(c, db.orders), 0);
  const pct = Math.round(giftMaxRedeemPctFor(db, clientId ? db.clients.find(c => c.id === clientId) : undefined) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader
        title="Your Gift Cards"
        subtitle="Credit for your orders"
      />

      {/* Balance hero */}
      <div className="rounded-2xl p-6 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(140deg,#223B73,#0E1A33)" }}>
        <div className="absolute -right-6 -top-8 opacity-20"><Gift className="h-40 w-40" /></div>
        <p className="text-xs uppercase tracking-[0.18em] text-white/60">Available balance</p>
        <p className="font-display text-4xl mt-1">{fmtMoney(total)}</p>
        <p className="text-xs text-white/70 mt-3">Up to {pct}% of an order · USD · redeem on the order page</p>
      </div>

      {cards.length === 0 ? (
        <div className="card-luxe p-12 text-center text-muted-foreground">
          <Gift className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-brand-dark">No active gift cards</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map(c => {
            const remaining = giftCardRemaining(c, db.orders);
            const d = daysLeft(c.expiresAt);
            const soon = d <= 3;
            return (
              <div key={c.id} className="card-luxe p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {c.source === "cashback" ? "Cashback" : "Gift card"}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${soon ? "text-amber-700" : "text-muted-foreground"}`}>
                    <Clock className="h-3 w-3" /> {d === 0 ? "Expires today" : `${d} day${d !== 1 ? "s" : ""} left`}
                  </span>
                </div>
                <p className="font-display text-2xl text-brand-dark mt-2">{fmtMoney(remaining)}</p>
                <p className="text-xs text-muted-foreground">of {fmtMoney(giftCardGranted(c))} · expires {fmtDate(c.expiresAt)}</p>
                {c.note && <p className="text-xs text-muted-foreground mt-2 italic">"{c.note}"</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
