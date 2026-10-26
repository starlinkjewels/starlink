import { useState } from "react";
import { Gem, Coins, PackageOpen, Undo2, Send } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListCombo } from "@/components/ListCombo";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { updateDbAs, type Order } from "@/lib/db";
import { clientMaterialBalance, fmtCt, fmtFine, receiveClientMaterial, returnClientMaterial, sendClientDiamonds, sendClientGold } from "@/lib/clientMaterial";

/** Purities offered for gold; any other can be typed. */
const PURITIES: [string, number][] = [["24K · 999", 999], ["22K · 916", 916], ["18K · 750", 750], ["14K · 585", 585], ["10K · 417", 417], ["9K · 375", 375]];

/**
 * The client's own material: received from them, handed back, or sent to the
 * factory for one of their orders. Gold by weight and purity (its fine gold
 * worked out), diamonds by carats and stones with what they are.
 */
export function ClientMaterialSheet({ clientId, mode, material: start, order, onClose }: {
  clientId: string;
  mode: "receive" | "return" | "send";
  material?: "gold" | "diamond";
  /** "send": the order it is for (its factory). Receive: optionally the order it came for. */
  order?: Order;
  onClose(): void;
}) {
  const { user } = useAuth();
  const db = useDb();
  const client = db.clients.find(c => c.id === clientId);
  const bal = client ? clientMaterialBalance(db, client) : null;
  const [material, setMaterial] = useState<"gold" | "diamond">(start ?? "diamond");
  const [f, setF] = useState({ grams: "", purity: "", ct: "", pcs: "", shape: "", size: "", color: "", clarity: "", certified: false, certLab: "", certNo: "", note: "" });
  const set = (k: keyof typeof f, v: string | boolean) => setF(p => ({ ...p, [k]: v }));
  const grams = Number(f.grams) || 0, purity = Number(f.purity) || 0, ct = Number(f.ct) || 0, pcs = Math.round(Number(f.pcs) || 0);
  const fine = Math.round(grams * purity / 1000 * 1000) / 1000;
  const factory = order?.assignedFactoryId ? db.factories.find(x => x.id === order.assignedFactoryId) : undefined;
  if (!client || !bal) return null;

  const title = mode === "receive" ? "Receive from the client" : mode === "return" ? "Hand back to the client" : `Send the client's ${material === "gold" ? "gold" : "diamonds"} to the factory`;
  const save = async () => {
    const who = { id: user!.id, name: user!.name };
    try {
      if (material === "gold") {
        if (grams <= 0 || purity <= 0 || purity > 1000) { toast.error("Enter the weight and its purity (‰)"); return; }
      } else if (ct <= 0) { toast.error("Enter the carats"); return; }
      const what = material === "gold" ? `${grams} g at ${purity}‰ (${fine} g fine)` : `${ct} ct${pcs ? ` · ${pcs} pcs` : ""}`;
      updateDbAs({ summary: `${mode === "receive" ? "Received from" : mode === "return" ? "Handed back to" : "Sent to the factory for"} ${client.companyName}: ${what} ${material === "gold" ? "gold" : "diamonds"} (client's own)` }, d => {
        if (mode === "send") {
          const o = d.orders.find(x => x.id === order!.id)!;
          if (material === "gold") sendClientGold(d, o, { grams, purity }, who);
          else sendClientDiamonds(d, o, { ct, pcs: pcs || undefined, certified: f.certified, shape: f.shape, size: f.size, color: f.color, clarity: f.clarity, certLab: f.certLab, certNo: f.certNo }, who);
          return;
        }
        const e = material === "gold"
          ? { material, grams, purity, note: f.note.trim() || undefined, orderId: order?.id }
          : { material, ct, pcs: pcs || undefined, shape: f.shape || undefined, size: f.size || undefined, color: f.color || undefined, clarity: f.clarity || undefined,
              certLab: f.certified ? f.certLab || undefined : undefined, certNo: f.certified ? f.certNo || undefined : undefined, note: f.note.trim() || undefined, orderId: order?.id };
        if (mode === "receive") receiveClientMaterial(d, client.id, e, who);
        else returnClientMaterial(d, client.id, e, who);
      });
      toast.success(mode === "receive" ? `Received — ${what}` : mode === "return" ? `Handed back — ${what}` : `Sent to ${factory?.name ?? "the factory"} — ${what}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    }
  };

  const limit = mode === "receive" ? null : material === "gold" ? bal.goldInHand : bal.diaInHand;
  return (
    <ActionSheet open onOpenChange={o => { if (!o) onClose(); }} icon={mode === "receive" ? PackageOpen : mode === "return" ? Undo2 : Send}
      title={title}
      description={`${client.companyName} · their own material — not our stock, no cost to us`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} className="btn-hero rounded-xl px-6">{mode === "receive" ? "Receive" : mode === "return" ? "Hand back" : "Send"}</AsyncButton>
        </div>
      }>
      <div className="space-y-4">
        {!start && (
          <div className="grid grid-cols-2 gap-2">
            {(["diamond", "gold"] as const).map(m => (
              <button key={m} type="button" onClick={() => setMaterial(m)} aria-pressed={material === m}
                className={`flex items-center gap-2 h-11 px-3 rounded-xl border text-sm font-medium ${material === m ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-secondary"}`}>
                {m === "gold" ? <Coins className="h-4 w-4" /> : <Gem className="h-4 w-4" />} {m === "gold" ? "Gold" : "Diamonds"}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-xl bg-secondary/50 border border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {material === "gold"
            ? <>Their gold: <b className="text-foreground">{fmtFine(bal.goldFine)}</b> held · {fmtFine(bal.goldInHand)} with us · {fmtFine(bal.goldAtFactory)} at factories</>
            : <>Their diamonds: <b className="text-foreground">{fmtCt(bal.diaCt, bal.diaPcs)}</b> held · {bal.diaInHand} ct with us · {bal.diaAtFactory} ct at factories</>}
          {limit != null && <> · up to <b className="text-foreground">{material === "gold" ? fmtFine(limit) : `${limit} ct`}</b> {mode === "send" ? "can be sent" : "can be handed back"}</>}
          {mode === "send" && <> · to <b className="text-foreground">{factory?.name ?? "the order's factory"}</b></>}
        </div>

        {material === "gold" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="cm-g" className="text-xs">Weight (g)</Label><Input id="cm-g" type="number" min={0} step="0.001" value={f.grams} onChange={e => set("grams", e.target.value)} className="h-10 rounded-xl" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs">Purity (‰)</Label>
              <Select value={PURITIES.find(([, p]) => String(p) === f.purity)?.[0] ?? ""} onValueChange={v => set("purity", String(PURITIES.find(([l]) => l === v)?.[1] ?? ""))}>
                <SelectTrigger className="h-10 rounded-xl" aria-label="Purity"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{PURITIES.map(([l]) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" min={1} max={1000} step="0.1" value={f.purity} onChange={e => set("purity", e.target.value)} className="h-9 rounded-lg" placeholder="or type it, e.g. 916" aria-label="Purity (‰), typed" />
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Fine gold (24K)</Label><div className="h-10 rounded-xl bg-secondary/60 border border-border/60 px-3 grid items-center text-sm font-semibold tabular-nums">{fine ? `${fine} g` : "—"}</div></div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <div className="space-y-1.5"><Label htmlFor="cm-ct" className="text-xs">Carats</Label><Input id="cm-ct" type="number" min={0} step="0.001" value={f.ct} onChange={e => set("ct", e.target.value)} className="h-10 rounded-xl" /></div>
              <div className="space-y-1.5"><Label htmlFor="cm-pcs" className="text-xs">Stones · optional</Label><Input id="cm-pcs" type="number" min={0} step="1" value={f.pcs} onChange={e => set("pcs", e.target.value)} className="h-10 rounded-xl" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Shape</Label><ListCombo list="diamondShapes" value={f.shape} onChange={v => set("shape", v)} placeholder="—" className="h-10 rounded-xl" ariaLabel="Shape" /></div>
              <div className="space-y-1.5"><Label htmlFor="cm-size" className="text-xs">Size / MM</Label><Input id="cm-size" value={f.size} onChange={e => set("size", e.target.value)} className="h-10 rounded-xl" placeholder="e.g. 1.5 mm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Colour</Label><ListCombo list="diamondColors" value={f.color} onChange={v => set("color", v)} placeholder="—" className="h-10 rounded-xl" ariaLabel="Colour" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Clarity</Label><ListCombo list="diamondClarities" value={f.clarity} onChange={v => set("clarity", v)} placeholder="—" className="h-10 rounded-xl" ariaLabel="Clarity" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={f.certified} onChange={e => set("certified", e.target.checked)} className="h-4 w-4 accent-[var(--color-primary,#1f4ea3)]" /> Certified stone
            </label>
            {f.certified && (
              <div className="grid gap-3 grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="cm-lab" className="text-xs">Lab</Label><Input id="cm-lab" value={f.certLab} onChange={e => set("certLab", e.target.value)} className="h-10 rounded-xl" placeholder="GIA, IGI…" /></div>
                <div className="space-y-1.5"><Label htmlFor="cm-cert" className="text-xs">Certificate no.</Label><Input id="cm-cert" value={f.certNo} onChange={e => set("certNo", e.target.value)} className="h-10 rounded-xl" /></div>
              </div>
            )}
          </div>
        )}
        {mode !== "send" && (
          <div className="space-y-1.5"><Label htmlFor="cm-note" className="text-xs">Note · optional</Label><Input id="cm-note" value={f.note} onChange={e => set("note", e.target.value)} className="h-10 rounded-xl" placeholder={mode === "receive" ? "e.g. Brought by hand, slip no. 42" : "e.g. Handed to Mr. Patel"} /></div>
        )}
      </div>
    </ActionSheet>
  );
}
