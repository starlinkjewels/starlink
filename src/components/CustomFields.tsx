// Custom fields on screen — the boxes in a form, the rows on a record's page, and
// the columns of a table. What they are and where values live: lib/customFields.ts.
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { fieldsFor, fmtValue, filledPairs, sortOf, valuesOf, type CfTarget, type CfValues, type CustomFieldDef } from "@/lib/customFields";
import { Field } from "@/components/BillLayout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DataColumn } from "@/components/DataTable";

const NONE = "__none";

/** One box for one field. */
function FieldInput({ def, value, onChange, disabled }: { def: CustomFieldDef; value: CfValues[string] | undefined; onChange: (v: string | number | boolean | undefined) => void; disabled?: boolean }) {
  return (
    <Field label={def.label} required={def.required} hint={def.hint}>
      {id => def.kind === "list" || def.kind === "yesno" ? (
        <Select disabled={disabled} value={value === undefined || value === "" ? NONE : def.kind === "yesno" ? (value ? "yes" : "no") : String(value)}
          onValueChange={v => onChange(v === NONE ? undefined : def.kind === "yesno" ? v === "yes" : v)}>
          <SelectTrigger id={id} className="rounded-xl h-10" aria-label={def.label}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {def.kind === "yesno"
              ? <><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></>
              : [...(def.options ?? []), ...(value && !(def.options ?? []).includes(String(value)) ? [String(value)] : [])].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} disabled={disabled} aria-label={def.label} className="rounded-xl h-10"
          type={def.kind === "number" ? "number" : def.kind === "date" ? "date" : "text"} step={def.kind === "number" ? "any" : undefined}
          value={value === undefined ? "" : String(value)}
          onChange={e => onChange(e.target.value === "" ? undefined : def.kind === "number" ? e.target.value : e.target.value)} />
      )}
    </Field>
  );
}

/**
 * The custom boxes of one kind of record, for a form. `values` is the form's copy
 * (start it from valuesOf for an edit); nothing shows when there are no fields.
 */
export function CustomFieldInputs({ target, values, onChange, disabled, title = "More details", className = "" }: {
  target: CfTarget; values: CfValues; onChange: (next: CfValues) => void; disabled?: boolean; title?: ReactNode | null; className?: string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const defs = fieldsFor(db.settings, target, user);
  if (!defs.length) return null;
  return (
    <div className={className}>
      {title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {defs.map(def => (
          <FieldInput key={def.id} def={def} value={values[def.id]} disabled={disabled}
            onChange={v => { const n = { ...values }; if (v === undefined) delete n[def.id]; else n[def.id] = v; onChange(n); }} />
        ))}
      </div>
    </div>
  );
}

/** The filled-in custom fields of one record, as label · value pairs this person may see. */
export function useCustomPairs(target: CfTarget, recId: string | undefined, opts: { clientOnly?: boolean } = {}): [string, string][] {
  const db = useDb();
  const { user } = useAuth();
  if (!recId) return [];
  const defs = fieldsFor(db.settings, target, opts.clientOnly ? { role: "client" } : user);
  return filledPairs(defs, valuesOf(db, target, recId));
}

/** A record's custom fields as a small grid of facts — nothing when none is filled. */
export function CustomFieldsView({ target, recId, className = "", title, clientOnly }: { target: CfTarget; recId: string | undefined; className?: string; title?: string; clientOnly?: boolean }) {
  const pairs = useCustomPairs(target, recId, { clientOnly });
  if (!pairs.length) return null;
  return (
    <div className={className}>
      {title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5">
        {pairs.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="text-sm font-medium text-foreground break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A column for each custom field — hidden until shown from the table's View menu. */
export function customColumns<T>(defs: CustomFieldDef[], get: (row: T) => CfValues): DataColumn<T>[] {
  return defs.map(def => ({
    key: `cf:${def.id}`, header: def.label, hidden: true,
    align: def.kind === "number" ? "right" as const : undefined,
    kind: def.kind === "date" ? "date" as const : def.kind === "number" ? "number" as const : "text" as const,
    sortValue: (r: T) => sortOf(def, get(r)[def.id]),
    csv: (r: T) => fmtValue(def, get(r)[def.id]),
    cell: (r: T) => <span className="text-sm">{fmtValue(def, get(r)[def.id]) || <span className="text-muted-foreground">—</span>}</span>,
  }));
}
