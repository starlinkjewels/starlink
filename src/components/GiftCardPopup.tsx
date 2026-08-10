import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { activeGiftCardsFor, giftCardRemaining, fmtMoney, fmtDate, type GiftCard } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Gift } from "lucide-react";

const SEEN_KEY = "gc-seen-v1";    // new-card announcements already shown
const EXP_KEY = "gc-exp-seen-v1"; // 24h expiry reminders already shown
const loadSet = (k: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(k) || "[]")); } catch { return new Set(); } };
const saveSet = (k: string, s: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...s])); } catch { /* ignore */ } };

/** Shows a client a popup when they receive a gift card, and again ~24h before
 *  one expires. Each is shown once (remembered in localStorage). */
export function GiftCardPopup() {
  const { user } = useAuth();
  const db = useDb();
  const nav = useNavigate();
  const [card, setCard] = useState<GiftCard | null>(null);
  const [mode, setMode] = useState<"new" | "expiry">("new");

  useEffect(() => {
    if (user?.role !== "client" || !user.clientId || card) return;
    const cards = activeGiftCardsFor(db, user.clientId);
    if (!cards.length) return;
    const seen = loadSet(SEEN_KEY), expSeen = loadSet(EXP_KEY);
    const fresh = cards.find(c => !seen.has(c.id));
    if (fresh) { setCard(fresh); setMode("new"); return; }
    const soon = cards.find(c => Date.parse(c.expiresAt) - Date.now() <= 86400000 && !expSeen.has(c.id));
    if (soon) { setCard(soon); setMode("expiry"); }
  }, [db, user, card]);

  if (!card) return null;
  const remaining = giftCardRemaining(card, db.orders);
  const dismiss = () => {
    const key = mode === "new" ? SEEN_KEY : EXP_KEY;
    const s = loadSet(key); s.add(card.id); saveSet(key, s);
    setCard(null);
  };
  const goUse = () => { dismiss(); nav("/giftcard"); };

  return (
    <Dialog open onOpenChange={o => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle className="sr-only">Gift card</DialogTitle></DialogHeader>
        <div className="text-center px-2 pb-1">
          <div className="mx-auto h-16 w-16 rounded-2xl grid place-items-center text-white mb-3"
            style={{ background: "linear-gradient(140deg,#223B73,#0E1A33)" }}>
            <Gift className="h-8 w-8" />
          </div>
          <h2 className="font-display text-2xl text-brand-dark">
            {mode === "new" ? "You've received a Gift Card! 🎁" : "Your gift card expires soon"}
          </h2>
          <p className="font-display text-3xl text-primary mt-2">{fmtMoney(remaining)}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "new"
              ? <>Use it on your next order — up to 25% of the order value. Valid until {fmtDate(card.expiresAt)}.</>
              : <>Expires {fmtDate(card.expiresAt)}. Use it on an order before it's gone.</>}
          </p>
          <div className="flex flex-col gap-2 mt-5">
            <Button onClick={goUse} className="btn-hero rounded-xl w-full">View my gift card</Button>
            <button onClick={dismiss} className="text-sm text-muted-foreground hover:text-foreground">Maybe later</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
