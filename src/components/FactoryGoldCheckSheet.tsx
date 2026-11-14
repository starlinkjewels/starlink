import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Scale } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { fmtDate, type Factory, type FactoryGoldCheck } from "@/lib/db";
import { brandFor } from "@/lib/companies";
import { factoryFineGoldBalance } from "@/lib/pure/accounts";
import { addGoldCheck, goldCheckState, goldCheckText, goldGivenSince, shortPct, GOLD_CHECK_TOLERANCE_PCT } from "@/lib/factoryGoldCheck";

const g = (n: number) => `${(Math.round(n * 1000) / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g`;

/**
 * Factory → ⋯ Gold check: what the factory really holds (fine grams, by weighing or by their own
 * statement) against our book; a shortfall above GOLD_CHECK_TOLERANCE_PCT of the gold given since
 * the last check is flagged (lib/factoryGoldCheck.ts). Records and flags — changes no balance.
 */
export function FactoryGoldCheckSheet({ factory, onClose }: { factory: Factory; onClose: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const live = db.factories.find(f => f.id === factory.id) ?? factory;
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const book = factoryFineGoldBalance(db.materialIssuances ?? [], live.id, live.openingFineGold);
  const checks = live.goldChecks ?? [];
  const last = checks[checks.length - 1];
  const given = goldGivenSince(db, live.id, last?.at);
  const a = actual.trim() === "" ? null : Number(actual);
  const preview = a != null && Number.isFinite(a) ? { diff: Math.round((a - book) * 1000) / 1000, givenSince: given } : null;

  const save = () => {
    if (a == null || !Number.isFinite(a) || a < 0) { toast.error("Enter the fine gold they hold — 0 or more grams"); return; }
    try {
      const c = addGoldCheck(live, a, note, user!.name);
      const st = goldCheckState(c);
      toast[st === "flag" ? "error" : "success"](st === "flag" ? `${g(-c.diff)} short — ${shortPct(c)}% of the gold given since the last check, above ${GOLD_CHECK_TOLERANCE_PCT}%` : st === "short" ? `${g(-c.diff)} short — within ${GOLD_CHECK_TOLERANCE_PCT}%` : st === "over" ? `They hold ${g(c.diff)} more than the book` : "Square with the book");
      setActual(""); setNote("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't record it"); }
  };

  // To the factory to confirm — WhatsApp when we have their phone; else the text is copied (as a memo reminder).
  const send = async (c: FactoryGoldCheck) => {
    const text = goldCheckText(c, live.name, brandFor(db.settings, "main").companyName || "us");
    const digits = (live.phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 8) { window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener"); return; }
    try { await navigator.clipboard.writeText(text); toast.success(`No phone on record for ${live.name} — the check is copied, paste it where you reach them`); }
    catch { toast.error(`No phone on record for ${live.name} — add one in Edit details`); }
  };

  const line = (c: { diff: number; givenSince: number }) => {
    const st = goldCheckState(c);
    return st === "ok" ? <span className="text-success font-medium">Square</span>
      : st === "over" ? <span className="text-brand-dark font-medium">{g(c.diff)} more than the book</span>
        : <span className={st === "flag" ? "text-destructive font-semibold" : "text-amber-700 font-medium"}>{g(-c.diff)} short{shortPct(c) != null ? ` · ${shortPct(c)}% of gold given` : ""}{st === "flag" ? " — above the limit" : ""}</span>;
  };

  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} size="md" icon={Scale} title={`Gold check — ${live.name}`}
      description="What they really hold, in fine (24K) grams, against our book — nothing is changed"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="rounded-xl">Close</Button><Button onClick={save} className="btn-hero rounded-xl px-6">Record check</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-border/70 p-3"><p className="text-[11px] text-muted-foreground">Our book: fine gold with them</p><p className="font-semibold tabular-nums">{g(book)}</p></div>
          <div className="rounded-xl border border-border/70 p-3"><p className="text-[11px] text-muted-foreground">Given since {last ? `the check of ${fmtDate(last.at)}` : "the start"}</p><p className="font-semibold tabular-nums">{g(given)}</p></div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {live.wastagePct ? `Their agreed wastage (${live.wastagePct}%) is already off the book, piece by piece.` : "No agreed wastage is set for them (Edit details) — every gram used up shows here as short."}
          {` A shortfall above ${GOLD_CHECK_TOLERANCE_PCT}% of the gold given since the last check is flagged.`}
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="gc-actual" className="text-xs">Fine gold they hold (g, 24K)</Label>
            <Input id="gc-actual" type="number" inputMode="decimal" min={0} step="0.001" value={actual} onChange={e => setActual(e.target.value)} className="rounded-xl h-10 mt-1" />
          </div>
          <div>
            <Label htmlFor="gc-note" className="text-xs">Note <span className="font-normal text-muted-foreground">· optional</span></Label>
            <Input id="gc-note" value={note} onChange={e => setNote(e.target.value)} className="rounded-xl h-10 mt-1" placeholder="weighed at their unit / their statement" />
          </div>
        </div>
        {preview && <p className="text-sm">{line(preview)}</p>}
        {checks.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Checks</p>
            <ul className="rounded-xl border border-border/70 divide-y divide-border/60 px-3 text-sm">
              {[...checks].reverse().slice(0, 12).map(c => (
                <li key={c.id} className="py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="tabular-nums">{fmtDate(c.at)}</span> · book {g(c.book)} · they hold {g(c.actual)} · {line(c)}
                    <span className="block text-[11px] text-muted-foreground">{c.byName}{c.note ? ` — ${c.note}` : ""}</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => send(c)} className="h-8 shrink-0 rounded-lg text-xs" aria-label={`Send the check of ${fmtDate(c.at)} to the factory`}>
                    <MessageCircle className="h-3.5 w-3.5 mr-1" />Send
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ActionSheet>
  );
}
