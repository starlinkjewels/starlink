import { useState } from "react";
import { SectionTitle } from "@/components/SectionTitle";
import { toast } from "sonner";
import { Plus, Pencil, Layers, Coins, Gem, Link2, X, Power } from "lucide-react";
import { updateDb, type DB } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import {
  materialDefs, materialProblem, newMaterialId, KIND_LABEL, KIND_UNIT, UNIT_LABEL,
  type MaterialDef, type MaterialKind, type MaterialUnit,
} from "@/lib/materials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmBox } from "@/lib/confirm";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const KIND_ICON: Record<MaterialKind, typeof Coins> = { metal: Coins, stone: Gem, finding: Link2 };
const KIND_HINT: Record<MaterialKind, string> = {
  metal: "Platinum, silver, palladium — weighed in grams",
  stone: "Ruby, emerald, sapphire, pearls — weighed in carats",
  finding: "Locks, chains, earring backs — counted in pieces",
};
const GRADE_HINT: Record<MaterialKind, string> = {
  metal: "e.g. 950, 925 — its purity",
  stone: "e.g. Oval, Round, AAA — shape or quality",
  finding: "e.g. Lobster lock, Box chain 18\"",
};

/** Records that use a material — once any exist it can only be switched off, never deleted. */
export function materialUses(db: DB, id: string): number {
  return (db.purchases ?? []).filter(p => p.material === id).length
    + (db.stockMovements ?? []).filter(m => m.material === id).length
    + (db.materialIssuances ?? []).filter(i => i.material === id).length;
}

/**
 * Add or change a material (Settings → Materials, or "+ Add new material" from
 * any material dropdown). The unit is fixed once it has been used: a quantity
 * entered in grams can never be read again as carats.
 */
export function MaterialEditor({ material, onClose, onSaved }: {
  material?: MaterialDef; onClose: () => void; onSaved?: (id: string) => void;
}) {
  const db = useDb();
  const [name, setName] = useState(material?.name ?? "");
  const [kind, setKind] = useState<MaterialKind>(material?.kind ?? "metal");
  const [unit, setUnit] = useState<MaterialUnit>(material?.unit ?? "g");
  const [grades, setGrades] = useState<string[]>(material?.grades ?? []);
  const [grade, setGrade] = useState("");
  const used = material ? materialUses(db, material.id) > 0 : false;

  const pickKind = (k: MaterialKind) => { setKind(k); if (!used) setUnit(KIND_UNIT[k]); };
  const addGrade = () => {
    const g = grade.trim();
    if (!g) return;
    if (grades.some(x => x.toLowerCase() === g.toLowerCase())) { toast.error(`${g} is already listed`); return; }
    setGrades(gs => [...gs, g]); setGrade("");
  };
  const save = () => {
    const all = materialDefs(db.settings);
    const next: MaterialDef = {
      id: material?.id ?? newMaterialId(name), name: name.trim(), kind, unit,
      grades: grade.trim() && !grades.some(x => x.toLowerCase() === grade.trim().toLowerCase()) ? [...grades, grade.trim()] : grades,
      active: material?.active ?? true, createdAt: material?.createdAt ?? new Date().toISOString(),
    };
    const why = materialProblem(next, all);
    if (why) { toast.error(why); return; }
    updateDb(d => {
      const list = d.settings.materials ?? (d.settings.materials = []);
      const i = list.findIndex(m => m.id === next.id);
      if (i >= 0) list[i] = next; else list.push(next);
    });
    toast.success(material ? `${next.name} saved` : `${next.name} added — it can now be bought, stocked and issued`);
    onSaved?.(next.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{material ? `Edit ${material.name}` : "New material"}</DialogTitle>
          <DialogDescription className="text-xs">Anything beyond gold and diamonds that goes into a piece. It then works like them everywhere — bought, held in stock, issued to a factory, used at Final Approval, costed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="mat_name">Name</Label>
            <Input id="mat_name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Platinum, Ruby, Lobster lock" className="h-10 rounded-xl" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">What it is</Label>
            <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="What it is">
              {(["metal", "stone", "finding"] as const).map(k => {
                const Icon = KIND_ICON[k];
                return (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => pickKind(k)}
                    className={`text-left rounded-xl border p-3 transition-all ${kind === k ? "border-primary ring-2 ring-primary/25 bg-primary/5" : "border-border/70 hover:border-primary/40"}`}>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-dark"><Icon className="h-4 w-4 text-primary" />{KIND_LABEL[k]}</span>
                    <span className="block text-[11px] text-muted-foreground mt-1 leading-snug">{KIND_HINT[k]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Counted in</Label>
            <div className="inline-flex rounded-lg bg-secondary p-0.5" role="radiogroup" aria-label="Counted in">
              {(["g", "ct", "pcs"] as const).map(u => (
                <button key={u} type="button" role="radio" aria-checked={unit === u} disabled={used && unit !== u} onClick={() => setUnit(u)}
                  className={`px-3 h-8 rounded-md text-xs font-medium disabled:opacity-40 ${unit === u ? "bg-card shadow-soft text-brand-dark" : "text-muted-foreground"}`}>{UNIT_LABEL[u]}</button>
              ))}
            </div>
            {used && <p className="text-[11px] text-muted-foreground">Fixed — it is already in use, and quantities entered in {UNIT_LABEL[unit]} must stay in {UNIT_LABEL[unit]}.</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="mat_grade">Grades <span className="font-normal text-muted-foreground">({GRADE_HINT[kind]})</span></Label>
            <div className="flex gap-2">
              <Input id="mat_grade" value={grade} onChange={e => setGrade(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addGrade(); } }}
                placeholder="Type one and press Enter" className="h-10 rounded-xl" />
              <Button type="button" variant="outline" onClick={addGrade} className="rounded-xl h-10 gap-1"><Plus className="h-4 w-4" />Add</Button>
            </div>
            {grades.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {grades.map(g => (
                  <span key={g} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-lg bg-secondary text-xs">
                    {g}
                    <button type="button" aria-label={`Remove ${g}`} onClick={() => setGrades(gs => gs.filter(x => x !== g))} className="h-5 w-5 grid place-items-center rounded hover:bg-destructive/10 hover:text-destructive"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            ) : <p className="text-[11px] text-muted-foreground">Optional. Stock is kept per grade; without any, it is all one.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} className="btn-hero rounded-xl">{material ? "Save" : "Add material"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Materials. */
export function MaterialsSettings() {
  const db = useDb();
  const [editing, setEditing] = useState<MaterialDef | "new" | null>(null);
  const list = materialDefs(db.settings);
  const toggle = async (m: MaterialDef) => {
    const on = m.active === false;
    if (!on && !(await confirmBox(`Stop offering ${m.name}? Its stock and history stay exactly as they are; it just isn't offered for new entries.`, { confirmText: "Stop offering" }))) return;
    updateDb(d => { const x = d.settings.materials?.find(y => y.id === m.id); if (x) x.active = on; });
    toast.success(on ? `${m.name} is offered again` : `${m.name} is no longer offered for new entries`);
  };
  const remove = async (m: MaterialDef) => {
    if (materialUses(db, m.id)) { toast.error(`${m.name} is in use — stop offering it instead.`); return; }
    if (!(await confirmBox(`Delete ${m.name}?\n\nNothing uses it yet — no purchase, stock or factory issue. It goes off every material list${m.grades.length ? `, with its grades (${m.grades.join(", ")})` : ""}.`, { danger: true, confirmText: "Delete" }))) return;
    updateDb(d => { d.settings.materials = (d.settings.materials ?? []).filter(y => y.id !== m.id); });
    toast.success(`${m.name} deleted`);
  };

  return (
    <div className="card-luxe p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <SectionTitle icon={Layers} title="Materials" sub="Gold and diamonds are built in"
          info="Anything else a piece uses — platinum, silver, gemstones, locks — gets its own stock, purchases, factory issues and costing." />
        <Button onClick={() => setEditing("new")} className="btn-hero rounded-xl gap-1.5"><Plus className="h-4 w-4" /> New material</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {[{ name: "Gold", kind: "Metal · grams · by purity (9K–24K)", Icon: Coins }, { name: "Diamond", kind: "Stone · carats · loose by shape, or certified one by one", Icon: Gem }].map(b => (
          <div key={b.name} className="rounded-xl border border-border/60 p-3 flex items-center gap-3 bg-secondary/30">
            <b.Icon className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0"><p className="font-semibold text-brand-dark text-sm">{b.name} <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide ml-1">built in</span></p><p className="text-xs text-muted-foreground">{b.kind}</p></div>
          </div>
        ))}
        {list.map(m => {
          const Icon = KIND_ICON[m.kind];
          const uses = materialUses(db, m.id);
          return (
            <div key={m.id} className={`rounded-xl border border-border/60 p-3 flex items-center gap-3 ${m.active === false ? "opacity-60" : ""}`}>
              <Icon className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-brand-dark text-sm truncate">{m.name}{m.active === false && <span className="ml-1.5 text-[10px] font-medium text-muted-foreground uppercase">not offered</span>}</p>
                <p className="text-xs text-muted-foreground truncate">{[KIND_LABEL[m.kind], UNIT_LABEL[m.unit]].filter(Boolean).join(" · ")}{m.grades.length ? ` · ${m.grades.join(", ")}` : ""}{uses ? ` · ${uses} record${uses !== 1 ? "s" : ""}` : ""}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" aria-label={m.active === false ? `Offer ${m.name} again` : `Stop offering ${m.name}`} onClick={() => toggle(m)}><Power className="h-3.5 w-3.5" /></Button>
                {/* Always there; greyed with the reason once records use it (a tap says it too). */}
                <Button size="icon" variant="ghost" aria-label={`Delete ${m.name}`} aria-disabled={uses > 0}
                  title={uses ? `In use by ${uses} record${uses !== 1 ? "s" : ""} — stop offering it instead` : `Delete ${m.name}`}
                  className={`h-8 w-8 rounded-lg ${uses ? "opacity-40 cursor-not-allowed text-muted-foreground" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                  onClick={() => remove(m)}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          );
        })}
      </div>
      {!list.length && <p className="text-xs text-muted-foreground">No other materials yet.</p>}
      {editing && <MaterialEditor material={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
