import { Coins, Gem } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListCombo } from "@/components/ListCombo";
import { useDb } from "@/hooks/useDb";
import { clientMaterialBalance, receiveClientMaterial, sendClientDiamonds, sendClientGold, type ClientMaterialBalance, type Who } from "@/lib/clientMaterial";
import { estimatedPureGoldNeeded } from "@/lib/manufacturing";
import type { DB } from "@/lib/db";

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

/** Which of the client's materials this order takes. */
export interface CmOn { gold: boolean; diamonds: boolean }

/**
 * What is wrong with the choice — or null. The same checks on the order form
 * and on an order's "Client's own material" sheet.
 */
export function cmDraftProblem(v: CmDraft, on: CmOn, bal: ClientMaterialBalance | null, est: { goldNeedFine: number; wantCt: number; canSend: boolean }): string | null {
  const sendOn = v.sendNow && est.canSend;
  if (on.gold && v.goldSrc === "now" && !((Number(v.grams) || 0) > 0 && (Number(v.purity) || 0) > 0 && Number(v.purity) <= 1000)) return "Their gold: enter the weight and its purity — or choose \"They'll bring it later\".";
  if (on.diamonds && v.diaSrc === "now" && !((Number(v.ct) || 0) > 0)) return "Their diamonds: enter the carats — or choose \"They'll bring it later\".";
  if (on.diamonds && v.diaSrc === "now" && v.pcs.trim() && !(Number.isInteger(Number(v.pcs)) && Number(v.pcs) >= 0)) return "Their diamonds: the number of stones is a whole number.";
  if (on.gold && v.goldSrc === "theirs" && !(bal && bal.goldInHand > 0)) return "None of their gold is with us — choose Receiving now or Later.";
  if (on.diamonds && v.diaSrc === "theirs" && !(bal && bal.diaInHand > 0)) return "None of their diamonds is with us — choose Receiving now or Later.";
  // Theirs with us, sent with the order: only what the piece needs — so the estimate must be there.
  if (on.gold && v.goldSrc === "theirs" && sendOn && !(est.goldNeedFine > 0)) return "Their gold: add the estimated weight, so we know how much of theirs to send — or untick Send.";
  if (on.diamonds && v.diaSrc === "theirs" && sendOn && !(est.wantCt > 0)) return "Their diamonds: add the diamond weight, so we know how much of theirs to send — or untick Send.";
  if (Number(v.lossPct) < 0 || Number(v.lossPct) > 25) return "Gold loss is a percentage between 0 and 25";
  return null;
}

/**
 * Take the client's material in for an order, and send it to the order's
 * factory, as chosen — all or nothing: should any step refuse, what came
 * before it is taken back and the refusal is thrown. Returns whether a send
 * was asked for with no factory to send to.
 */
export function applyCmDraft(d: DB, orderId: string, v: CmDraft, on: CmOn, who: Who): { unsent: boolean } {
  const o = d.orders.find(x => x.id === orderId);
  if (!o) throw new Error("That order is not there any more");
  const send = v.sendNow && !!o.assignedFactoryId;
  const unsent = v.sendNow && !o.assignedFactoryId && ((on.gold && v.goldSrc !== "later") || (on.diamonds && v.diaSrc !== "later"));
  const loss = Number(v.lossPct) || 0;
  const c0 = d.clients.find(x => x.id === o.clientId);
  const keep = { ledger: c0?.materialLedger, n: d.materialIssuances.length, ids: o.materialIssuanceIds };
  try {
    if (on.gold && v.goldSrc !== "later") {
      if (v.goldSrc === "now") {
        receiveClientMaterial(d, o.clientId, { material: "gold", grams: Number(v.grams), purity: Number(v.purity), orderId: o.id }, who);
        if (send) sendClientGold(d, o, { grams: Number(v.grams), purity: Number(v.purity) }, who);
      } else if (send && c0) {
        const fineNeed = r3(estimatedPureGoldNeeded(o) * (1 + loss / 100));
        const g = cmSendFromBalance(fineNeed, clientMaterialBalance(d, c0).goldInHand);
        if (g > 0) sendClientGold(d, o, { grams: g, purity: 1000 }, who);
      }
    }
    if (on.diamonds && v.diaSrc !== "later") {
      const spec = { shape: v.shape || undefined, size: v.size || undefined, color: v.color || undefined, clarity: v.clarity || undefined };
      if (v.diaSrc === "now") {
        receiveClientMaterial(d, o.clientId, { material: "diamond", ct: Number(v.ct), pcs: Number(v.pcs) || undefined, ...spec,
          certLab: v.certified ? v.certLab || undefined : undefined, certNo: v.certified ? v.certNo || undefined : undefined, orderId: o.id }, who);
        if (send) sendClientDiamonds(d, o, { ct: Number(v.ct), pcs: Number(v.pcs) || undefined, certified: v.certified, ...spec, certLab: v.certLab, certNo: v.certNo }, who);
      } else if (send && c0) {
        const ct = cmSendFromBalance(Number(o.diamondWeight) || 0, clientMaterialBalance(d, c0).diaInHand);
        if (ct > 0) sendClientDiamonds(d, o, { ct, shape: o.diamondShape }, who);
      }
    }
  } catch (err) {
    if (c0) c0.materialLedger = keep.ledger;
    d.materialIssuances.length = keep.n;
    o.materialIssuanceIds = keep.ids;
    throw err;
  }
  return { unsent };
}

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
export function ClientMaterialChoice({ value: v, onChange, clientId, showGold, factoryName, goldNeedFine, wantCt, clientView, declareOnly, laterLabel, already }: {
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
  /** The order page: "later" reads "Nothing more now" — what is there already stays. */
  laterLabel?: string;
  /** What this order already has of theirs, a line per material. */
  already?: { gold?: string; diamonds?: string };
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
      {([["now", "Receiving now"], ...(have ? [["theirs", `Theirs with us · ${have}`]] : []), ["later", laterLabel ?? "They'll bring it later"]] as [CmSource, string][]).map(([s, l]) => (
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
              {already?.gold && <p className="text-xs text-muted-foreground">{already.gold}</p>}
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
              {v.goldSrc === "later" && !laterLabel && <p className="text-xs text-muted-foreground">The order will show it's waiting for their gold — receive it there when it comes.</p>}
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
            {already?.diamonds && <p className="text-xs text-muted-foreground">{already.diamonds}</p>}
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
            {v.diaSrc === "later" && !laterLabel && <p className="text-xs text-muted-foreground">The order will show it's waiting for their diamonds — receive them there when they come.</p>}
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
