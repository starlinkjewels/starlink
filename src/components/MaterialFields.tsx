import { useId } from "react";
import { useDb } from "@/hooks/useDb";
import { activeMaterials, materialDef, UNIT_LABEL } from "@/lib/materials";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Input } from "@/components/ui/input";
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
  const listId = useId();
  return (
    <>
      <Input list={listId} value={value} onChange={e => onChange(e.target.value)} className={className}
        placeholder={placeholder ?? (def?.grades.length ? def.grades.slice(0, 3).join(", ") : "Grade (optional)")} aria-label="Grade" />
      <datalist id={listId}>{(def?.grades ?? []).map(g => <option key={g} value={g} />)}</datalist>
    </>
  );
}
