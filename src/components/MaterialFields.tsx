import { ListCombo } from "@/components/ListCombo";
import { updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { activeMaterials, materialDef, UNIT_LABEL } from "@/lib/materials";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The admin-defined materials offered for a new entry (plus the one already chosen). */
export function useOtherMaterials(current?: string) {
  const db = useDb();
  const list = activeMaterials(db.settings);
  const cur = materialDef(db.settings, current);
  return cur && !list.some(m => m.id === cur.id) ? [...list, cur] : list;
}

/** Choose one of the other materials — or add a new one without leaving the form. */
export function OtherMaterialSelect({ value, onChange, className = "h-10 rounded-xl", label = "Material" }: {
  value: string; onChange: (id: string) => void; className?: string; label?: string;
}) {
  const list = useOtherMaterials(value);
  const addNew = useAddNew();
  return (
    <Select value={value} onValueChange={addNew("material", onChange)}>
      <SelectTrigger className={className} aria-label={label}><SelectValue placeholder={list.length ? "Choose material" : "Add a material first"} /></SelectTrigger>
      <SelectContent>
        {list.map(m => <SelectItem key={m.id} value={m.id}>{m.name} <span className="text-muted-foreground text-xs">· {UNIT_LABEL[m.unit]}</span></SelectItem>)}
        <AddNewItem kind="material" />
      </SelectContent>
    </Select>
  );
}

/** The grade of a material: its listed grades are suggested, anything may be typed. */
export function GradeInput({ material, value, onChange, className = "h-10 rounded-xl", placeholder }: {
  material: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
}) {
  const db = useDb();
  const def = materialDef(db.settings, material);
  // Pick one of the material's grades, or type a new one — used at once and
  // remembered with the material (Settings → Materials), like every other list.
  return (
    <ListCombo value={value === "—" ? "" : value} onChange={onChange} choices={def?.grades ?? []} className={className}
      placeholder={placeholder ?? "Grade (optional)"} ariaLabel="Grade" listTitle={def ? `${def.name} grades` : "grades"}
      remember={!def ? undefined : word => updateDb(d => {
        const m = (d.settings.materials ?? []).find(x => x.id === material);
        if (m && !m.grades.some(g => g.toLowerCase() === word.toLowerCase())) m.grades = [...m.grades, word];
      })} />
  );
}
