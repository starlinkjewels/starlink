import { Coins, Gem } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListCombo } from "@/components/ListCombo";
import { useDb } from "@/hooks/useDb";
import { clientMaterialBalance } from "@/lib/clientMaterial";

/** Where the client's material comes from, for this order. */
export type CmSource = "now" | "theirs" | "later";

/** What the order form holds about the client's own material. */
export interface CmDraft {
  gold: boolean;
  diamonds: boolean;
  lossPct: string;
  goldSrc: CmSource; grams: string; purity: string;
  diaSrc: CmSource; ct: string; pcs: string; shape: string; size: string; color: string; clarity: string;
  certified: boolean; certLab: string; certNo: string;
  /** Send what is received (or theirs with us) to the order's factory as the order is placed. */
  sendNow: boolean;
}

export const emptyCm = (): CmDraft => ({
  gold: false, diamonds: false, lossPct: "",
  goldSrc: "now", grams: "", purity: "",
  diaSrc: "now", ct: "", pcs: "", shape: "", size: "", color: "", clarity: "", certified: false, certLab: "", certNo: "",
  sendNow: true,
});

const PURITIES: [string, number][] = [["24K · 999", 999], ["22K · 916", 916], ["18K · 750", 750], ["14K · 585", 585], ["10K · 417", 417], ["9K · 375", 375]];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** What gets sent of what is theirs with us: what the piece needs, at most what is there — nothing without a need. */
export function cmSendFromBalance(need: number, have: number): number {
  return need > 0 ? r3(Math.max(0, Math.min(need, have))) : 0;
}

/**
 * "Who gives the material?" — for this order, on the order form. Each of gold
 * and diamonds: we do, or the client does; if the client does, it is taken in
 * right here (or theirs already with us is used, or it comes later), and can
 * go to the factory with the order.
 */
export function ClientMaterialChoice({ value: v, onChange, clientId, showGold, factoryName, goldNeedFine, wantCt, clientView, declareOnly }: {
  value: CmDraft;
  onChange(next: CmDraft): void;
  clientId: string;
  /** The metal is gold (has karats) — else there is no gold to give. */
  showGold: boolean;
  /** The factory chosen in the plan, if any — material can go with the order. */
  factoryName?: string;
  goldNeedFine: number;
  wantCt: number;
  /** The client placing it themselves: they only say what they'll send. */
  clientView?: boolean;
  /** Staff who may not record material: only who gives it; it is received from the order. */
  declareOnly?: boolean;
}) {
  const db = useDb();
  const client = db.clients.find(c => c.id === clientId);
  const bal = client ? clientMaterialBalance(db, client) : null;
  const set = (p: Partial<CmDraft>) => onChange({ ...v, ...p });
  // Switched to "client gives": use theirs already with us, if there is any; else it is received now.
  const setGold = (b: boolean) => set({ gold: b, ...(b && !v.gold ? { goldSrc: bal && bal.goldInHand > 0 ? "theirs" : "now" } : {}) });
  const setDia = (b: boolean) => set({ diamonds: b, ...(b && !v.diamonds ? { diaSrc: bal && bal.diaInHand > 0 ? "theirs" : "now" } : {}) });
  const fine = r3((Number(v.grams) || 0) * (Number(v.purity) || 0) / 1000);
  const loss = Number(v.lossPct) || 0;
  const goldFromTheirs = cmSendFromBalance(r3(goldNeedFine * (1 + loss / 100)), bal?.goldInHand ?? 0);
  const diaFromTheirs = cmSendFromBalance(wantCt, bal?.diaInHand ?? 0);

  const who = (label: string, on: boolean, set1: (b: boolean) => void, icon: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium text-brand-dark flex items-center gap-1.5">{icon}{label}</p>
      <div className="inline-flex rounded-xl border border-border p-0.5 bg-secondary/40" role="radiogroup" aria-label={`Who gives the ${label.toLowerCase()}`}>
        {([[false, clientView ? "Use yours" : "We give"], [true, clientView ? "I'll send mine" : "Client gives"]] as const).map(([val, l]) => (
          <button key={String(val)} type="button" role="radio" aria-checked={on === val} onClick={() => set1(val)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${on === val ? (val ? "bg-amber-500 text-white shadow-sm" : "bg-white text-brand-dark shadow-sm") : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
  const source = (cur: CmSource, have: string | null, pick: (s: CmSource) => void) => (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {([["now", "Receiving now"], ...(have ? [["theirs", `Theirs with us · ${have}`]] : []), ["later", "They'll bring it later"]] as [CmSource, string][]).map(([s, l]) => (
        <button key={s} type="button" role="radio" aria-checked={cur === s} onClick={() => pick(s)}
          className={`h-8 px-3 rounded-full border text-xs font-medium ${cur === s ? "border-amber-500 bg-amber-500/10 text-amber-800" : "border-border text-muted-foreground hover:bg-secondary"}`}>{l}</button>
      ))}
    </div>
  );

  if (clientView || declareOnly) {
    return (
      <div className="space-y-3">
        {showGold && who("Gold", v.gold, setGold, <Coins className="h-4 w-4 text-amber-600" />)}
        {who("Diamonds", v.diamonds, setDia, <Gem className="h-4 w-4 text-sky-600" />)}
        {(v.gold || v.diamonds) && <p className="text-xs text-muted-foreground">{clientView ? "We'll note it on the order — your own material isn't charged; send it to us and we'll confirm when it arrives." : "Noted on the order — their material is received from the order's page."}</p>}
      </div>
    );
  }

  const canSend = !!factoryName && ((v.gold && v.goldSrc !== "later") || (v.diamonds && v.diaSrc !== "later"));
  return (
    <div className="space-y-4">
      {showGold && (
        <div className="space-y-2.5">
          {who("Gold", v.gold, setGold, <Coins className="h-4 w-4 text-amber-600" />)}
          {v.gold && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-3">
              {source(v.goldSrc, bal && bal.goldInHand > 0 ? `${bal.goldInHand} g fine` : null, s => set({ goldSrc: s }))}
              {v.goldSrc === "now" && (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="cmo-g" className="text-xs">Weight (g)</Label><Input id="cmo-g" type="number" min={0} step="0.001" value={v.grams} onChange={e => set({ grams: e.target.value })} className="h-10 rounded-xl" /></div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Purity</Label>
                    <Select value={PURITIES.find(([, p]) => String(p) === v.purity)?.[0] ?? ""} onValueChange={x => set({ purity: String(PURITIES.find(([l]) => l === x)?.[1] ?? "") })}>
                      <SelectTrigger className="h-10 rounded-xl" aria-label="Their gold's purity"><SelectValue placeholder="Choose…" /></SelectTrigger>
                      <SelectContent>{PURITIES.map(([l]) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label className="text-xs">Fine gold</Label><div className="h-10 rounded-xl bg-white border border-border/60 px-3 grid items-center text-sm font-semibold tabular-nums">{fine ? `${fine} g` : "—"}</div></div>
                </div>
              )}
              {v.goldSrc === "theirs" && <p className="text-xs text-muted-foreground">{goldFromTheirs > 0 ? <>Uses <b className="text-foreground">{goldFromTheirs} g fine</b> of theirs{goldNeedFine > 0 ? " — what the piece needs, with the loss" : ""}.</> : "Add the estimated weight to see what is used."}</p>}
              {v.goldSrc === "later" && <p className="text-xs text-muted-foreground">The order will show it's waiting for their gold — receive it there when it comes.</p>}
              <div className="flex items-center gap-2">
                <Label htmlFor="cmo-loss" className="text-xs text-muted-foreground">Gold loss agreed</Label>
                <Input id="cmo-loss" type="number" min={0} max={25} step="0.1" value={v.lossPct} onChange={e => set({ lossPct: e.target.value })} className="h-9 w-20 rounded-lg" placeholder="0" />
                <span className="text-xs text-muted-foreground">% · taken from their gold with the piece's</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {who("Diamonds", v.diamonds, setDia, <Gem className="h-4 w-4 text-sky-600" />)}
        {v.diamonds && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-3">
            {source(v.diaSrc, bal && bal.diaInHand > 0 ? `${bal.diaInHand} ct` : null, s => set({ diaSrc: s }))}
            {v.diaSrc === "now" && (
              <>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="cmo-ct" className="text-xs">Carats</Label><Input id="cmo-ct" type="number" min={0} step="0.001" value={v.ct} onChange={e => set({ ct: e.target.value })} className="h-10 rounded-xl" /></div>
                  <div className="space-y-1.5"><Label htmlFor="cmo-pcs" className="text-xs">Stones</Label><Input id="cmo-pcs" type="number" min={0} step="1" value={v.pcs} onChange={e => set({ pcs: e.target.value })} className="h-10 rounded-xl" placeholder="optional" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Shape</Label><ListCombo list="diamondShapes" value={v.shape} onChange={x => set({ shape: x })} placeholder="—" className="h-10 rounded-xl" ariaLabel="Their diamonds' shape" /></div>
                  <div className="space-y-1.5"><Label htmlFor="cmo-size" className="text-xs">Size / MM</Label><Input id="cmo-size" value={v.size} onChange={e => set({ size: e.target.value })} className="h-10 rounded-xl" placeholder="optional" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Colour</Label><ListCombo list="diamondColors" value={v.color} onChange={x => set({ color: x })} placeholder="—" className="h-10 rounded-xl" ariaLabel="Their diamonds' colour" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Clarity</Label><ListCombo list="diamondClarities" value={v.clarity} onChange={x => set({ clarity: x })} placeholder="—" className="h-10 rounded-xl" ariaLabel="Their diamonds' clarity" /></div>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={v.certified} onChange={e => set({ certified: e.target.checked })} className="h-4 w-4" /> Certified stone
                </label>
                {v.certified && (
                  <div className="grid gap-3 grid-cols-2">
                    <Input value={v.certLab} onChange={e => set({ certLab: e.target.value })} className="h-10 rounded-xl" placeholder="Lab — GIA, IGI…" aria-label="Certificate lab" />
                    <Input value={v.certNo} onChange={e => set({ certNo: e.target.value })} className="h-10 rounded-xl" placeholder="Certificate no." aria-label="Certificate number" />
                  </div>
                )}
              </>
            )}
            {v.diaSrc === "theirs" && <p className="text-xs text-muted-foreground">{diaFromTheirs > 0 ? <>Uses <b className="text-foreground">{diaFromTheirs} ct</b> of theirs{wantCt > 0 ? " — the diamond weight of the piece" : ""}.</> : "Add the diamond weight to see what is used."}</p>}
            {v.diaSrc === "later" && <p className="text-xs text-muted-foreground">The order will show it's waiting for their diamonds — receive them there when they come.</p>}
          </div>
        )}
      </div>

      {canSend && (
        <label className="flex items-center gap-2 text-sm cursor-pointer rounded-xl border border-border/70 px-3 py-2.5">
          <input type="checkbox" checked={v.sendNow} onChange={e => set({ sendNow: e.target.checked })} className="h-4 w-4" />
          <span>Send it to <b>{factoryName}</b> with the order</span>
        </label>
      )}
      {(v.gold || v.diamonds) && <p className="text-[11px] text-muted-foreground">Their material is held for them — not our stock, not charged. The order value is the labour and setting.</p>}
    </div>
  );
}
