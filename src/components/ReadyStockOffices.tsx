import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Gem, MapPin, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs, type ReadyStockItem } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { moveReadyStock, officeLabel, officeOf, readyStockOffices } from "@/lib/offices";
import { logItem, whoNow } from "@/lib/readyStockHistory";
import { confirmBox } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The office a piece is at, as a small pin. Amber when none was ever set. */
export function OfficeChip({ office, className = "" }: { office: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 max-w-full text-[10px] font-semibold px-2 py-0.5 rounded-full ${office ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-800"} ${className}`}>
      <MapPin className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{officeLabel(office)}</span>
    </span>
  );
}

/**
 * Send pieces to another office — a parcel from India to the US office, say.
 * One lot can be split: some of its pieces go, the rest stay (an admin only,
 * since the piece's cost has to go with them). Sold-out lots stay put.
 */
export function MoveOfficeDialog({ items, onClose, onDone }: { items: ReadyStockItem[]; onClose: () => void; onDone?: () => void }) {
  const db = useDb();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const offices = readyStockOffices(db.settings);
  const movable = items.filter(i => i.quantity > 0);
  const single = movable.length === 1 ? movable[0] : null;
  const from = [...new Set(movable.map(officeOf))];
  const [to, setTo] = useState(() => offices.find(o => !from.includes(o)) ?? offices[0] ?? "");
  const [qty, setQty] = useState(String(single?.quantity ?? 0));
  const n = single ? Math.round(Number(qty)) : 0;
  const going = movable.filter(i => officeOf(i) !== to);
  const pieces = single ? (officeOf(single) === to ? 0 : n) : going.reduce((s, i) => s + i.quantity, 0);
  const problem = !to ? "Choose the office."
    : !movable.length ? "None of these pieces is in stock — there is nothing to move."
    : !going.length ? `${movable.length === 1 ? "It is" : "They are all"} already at the ${officeLabel(to)}.`
    : single && (!(n > 0) || n > single.quantity) ? `Enter 1 to ${single.quantity}.`
    : single && n < single.quantity && !isAdmin ? "Only an admin can move part of a lot — its cost has to go with it. Move all of it, or ask an admin."
    : "";

  const save = async () => {
    if (problem) { toast.error(problem); return; }
    const errs: string[] = [];
    await updateDbAs({ summary: `Moved ${pieces} Ready Stock piece${pieces !== 1 ? "s" : ""} to the ${officeLabel(to)}` }, d => {
      for (const it of going) {
        const r = moveReadyStock(d, it.id, single ? n : it.quantity, to, isAdmin);
        if (typeof r === "string") errs.push(`${it.name}: ${r}`);
      }
    });
    if (errs.length) toast.error(errs.join("\n"));
    else toast.success(`${pieces} piece${pieces !== 1 ? "s" : ""} now at the ${officeLabel(to)}`);
    onDone?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Move to another office</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 divide-y divide-border/50 max-h-60 overflow-y-auto">
            {items.slice(0, 8).map(i => (
              <div key={i.id} className="flex items-center gap-3 px-3 py-2">
                <div className="h-10 w-10 rounded-lg bg-white ring-1 ring-border/60 overflow-hidden grid place-items-center shrink-0">
                  {i.images?.[0] ? <img src={i.images[0]} alt="" className="w-full h-full object-contain" /> : <Gem className="h-4 w-4 text-muted-foreground/40" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-dark truncate">{i.name}</p>
                  <p className="text-[11px] text-muted-foreground">{i.quantity > 0 ? `${i.quantity} pc${i.quantity !== 1 ? "s" : ""} at the ${officeLabel(officeOf(i))}` : "Sold out — stays where it is"}</p>
                </div>
              </div>
            ))}
            {items.length > 8 && <p className="px-3 py-2 text-[11px] text-muted-foreground">and {items.length - 8} more</p>}
          </div>
          <div className={`grid gap-3 ${single && single.quantity > 1 ? "grid-cols-2" : ""}`}>
            {single && single.quantity > 1 && (
              <div>
                <Label className="text-xs">How many pieces (of {single.quantity})</Label>
                <Input id="mv_qty" type="number" min={1} max={single.quantity} value={qty} onChange={e => setQty(e.target.value)} className="rounded-xl mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">To</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger aria-label="To office" className="rounded-xl mt-1"><SelectValue placeholder="Choose the office" /></SelectTrigger>
                <SelectContent>{offices.map(o => <SelectItem key={o} value={o}>{officeLabel(o)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {single && n > 0 && n < single.quantity && !problem && (
            <p className="text-[11px] text-muted-foreground">{n} go to the {officeLabel(to)} as their own lot (same piece, price and cost); {single.quantity - n} stay at the {officeLabel(officeOf(single))}.</p>
          )}
          {problem && <p className="text-xs text-amber-700">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} disabled={!!problem} className="btn-hero rounded-xl px-6">Move {pieces > 0 ? `${pieces} piece${pieces !== 1 ? "s" : ""}` : ""}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The admin's list of offices: add one, put them in order, rename one, take an
 * empty one off. A piece keeps its office as text (`location`), so renaming an
 * office renames it on every piece kept there — and on any return on its way
 * back to it — or those pieces would be left under the old name.
 */
export function OfficesDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  // Each row remembers the name it had when the dialog opened (none for one added here).
  const [rows, setRows] = useState(() => readyStockOffices(db.settings).map(o => ({ orig: o as string | null, name: o })));
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ i: number; to: string } | null>(null);
  const here = (o: string | null) => (o ? (db.readyStock ?? []).filter(i => officeOf(i) === o) : []);
  const clean = (v: string) => v.trim().replace(/\s+/g, " ");
  const taken = (v: string, except: number) => rows.some((r, j) => j !== except && r.name.toLowerCase() === v.toLowerCase());
  const add = () => {
    const v = clean(name);
    if (!v) return;
    if (v.length > 40) { toast.error("Keep the name under 40 letters"); return; }
    if (taken(v, -1)) { toast.error("That office is already on the list"); return; }
    setRows([...rows, { orig: null, name: v }]); setName("");
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; setRows(next);
  };
  const applyRename = () => {
    if (!renaming) return;
    const v = clean(renaming.to);
    if (!v) { toast.error("Enter the office's new name"); return; }
    if (v.length > 40) { toast.error("Keep the name under 40 letters"); return; }
    if (taken(v, renaming.i)) { toast.error("That office is already on the list"); return; }
    setRows(rows.map((r, j) => (j === renaming.i ? { ...r, name: v } : r)));
    setRenaming(null);
  };
  const save = async () => {
    if (!rows.length) { toast.error("Keep at least one office"); return; }
    const list = rows.map(r => r.name);
    const renamed = rows.filter(r => r.orig && r.orig !== r.name) as { orig: string; name: string }[];
    if (renamed.length) {
      // Say exactly what follows the new names before anything moves.
      const coming = (o: string) => db.orders.reduce((s, x) => s + (x.returns ?? []).filter(r => r.status === "coming" && (r.location ?? "").trim() === o).length, 0);
      const lines = renamed.map(r => {
        const lots = here(r.orig), pcs = lots.reduce((s, x) => s + Math.max(0, x.quantity), 0), back = coming(r.orig);
        const merge = (db.readyStock ?? []).some(i => officeOf(i) === r.name) && !rows.some(x => x.orig === r.name);
        return `• ${officeLabel(r.orig)} → ${officeLabel(r.name)}: ${lots.length} lot${lots.length !== 1 ? "s" : ""} (${pcs} piece${pcs !== 1 ? "s" : ""}) move to the new name${back ? `, and ${back} return${back !== 1 ? "s" : ""} on the way back` : ""}${merge ? ` — joining the pieces already marked ${r.name}` : ""}`;
      });
      if (!(await confirmBox(`Rename ${renamed.length === 1 ? "this office" : `${renamed.length} offices`}?\n\n${lines.join("\n")}\n\nEach piece's history notes the change.`, { confirmText: "Rename" }))) return;
    }
    const to = new Map(renamed.map(r => [r.orig, r.name]));
    await updateDbAs({ summary: renamed.length ? `Renamed Ready Stock offices: ${renamed.map(r => `${r.orig} → ${r.name}`).join(", ")}` : "Changed the list of Ready Stock offices" }, d => {
      d.settings.readyStockOffices = list;
      if (!to.size) return;
      const w = { ...whoNow(d), at: new Date().toISOString() };
      // One pass over the pieces as they were, so swapping two names is safe.
      for (const it of d.readyStock ?? []) {
        const next = to.get(officeOf(it));
        if (!next) continue;
        const was = officeOf(it);
        it.location = next;
        logItem(it, { ...w, kind: "edited", text: `Office renamed: ${officeLabel(was)} → ${officeLabel(next)}` });
      }
      for (const o of d.orders) for (const r of o.returns ?? []) {
        const next = r.status === "coming" ? to.get((r.location ?? "").trim()) : undefined;
        if (next) r.location = next;
      }
    });
    toast.success(renamed.length ? `Offices saved — ${renamed.map(r => r.name).join(", ")} renamed` : "Offices saved");
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Our offices</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">Where Ready Stock is kept. Each is a tab on the Ready Stock page, in this order.</p>
        <div className="rounded-xl border border-border/60 divide-y divide-border/50">
          {rows.map((r, i) => {
            const o = r.name;
            const n = here(r.orig).reduce((s, x) => s + Math.max(0, x.quantity), 0);
            const lots = here(r.orig).length;
            if (renaming?.i === i) {
              return (
                <div key={`${r.orig ?? "new"}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  <MapPin className="h-4 w-4 text-primary shrink-0" />
                  <Input value={renaming.to} autoFocus aria-label={`New name for ${o}`} onChange={e => setRenaming({ i, to: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyRename(); } if (e.key === "Escape") setRenaming(null); }}
                    className="h-8 rounded-lg flex-1" />
                  <button type="button" onClick={applyRename} aria-label="Use this name" className="h-7 w-7 rounded-lg border border-border grid place-items-center text-success hover:bg-success/10"><Check className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setRenaming(null)} aria-label="Keep the old name" className="h-7 w-7 rounded-lg border border-border grid place-items-center text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
                </div>
              );
            }
            return (
              <div key={`${r.orig ?? "new"}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-dark truncate">{officeLabel(o)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {n} piece{n !== 1 ? "s" : ""} in stock
                    {r.orig && r.orig !== r.name && <span className="text-amber-700"> · was {r.orig} — its pieces follow when you save</span>}
                  </p>
                </div>
                <button type="button" onClick={() => setRenaming({ i, to: o })} aria-label={`Rename ${o}`} title="Rename — its pieces follow" className="h-7 w-7 rounded-lg border border-border grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Up" className="h-7 w-7 rounded-lg border border-border grid place-items-center disabled:opacity-30 hover:bg-secondary"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Down" className="h-7 w-7 rounded-lg border border-border grid place-items-center disabled:opacity-30 hover:bg-secondary"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={lots > 0}
                  title={lots > 0 ? "Pieces are kept here — move them to another office first" : "Take this office off the list"}
                  aria-label={`Remove ${o}`} className="h-7 w-7 rounded-lg border border-border grid place-items-center text-destructive disabled:opacity-30 hover:bg-destructive/10"><X className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="New office — e.g. Dubai" aria-label="New office" className="rounded-xl" />
          <Button type="button" variant="outline" onClick={add} className="rounded-xl shrink-0"><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <AsyncButton onClick={save} className="btn-hero rounded-xl px-6">Save</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
