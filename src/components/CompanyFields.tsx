import { Building2 } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { companiesOf, companiesForUser, companyById, hasCompanies, MAIN_COMPANY_ID } from "@/lib/companies";
import { AddNewItem, useAddNew } from "@/components/create/QuickCreate";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** More than one company — only then is "which company" asked or shown. */
export function useMultiCo(): boolean {
  const db = useDb();
  return hasCompanies(db.settings);
}

/** The company a new entry starts on: the person's only company, else the first. */
export function useDefaultCompany(): string {
  const db = useDb();
  const { user } = useAuth();
  const mine = companiesForUser(db.settings, user);
  return mine.length === 1 ? mine[0].id : MAIN_COMPANY_ID;
}

/**
 * Which company an entry is for — shown only when there is more than one.
 * Whose stock it goes into or comes out of: each company holds its own.
 */
export function CompanyPicker({ value, onChange, label = "Company", hint, className = "h-10 rounded-xl", labelClassName = "text-xs" }: {
  value: string; onChange: (id: string) => void; label?: string; hint?: string; className?: string;
  /** To match the labels of the fields beside it. */
  labelClassName?: string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const addNew = useAddNew();
  if (!hasCompanies(db.settings)) return null;
  const list = companiesForUser(db.settings, user);
  const cur = companyById(db.settings, value);
  const options = list.some(c => c.id === cur.id) ? list : [cur, ...list];
  return (
    <div>
      <Label className={labelClassName}>{label}</Label>
      <Select value={value || MAIN_COMPANY_ID} onValueChange={addNew("company", onChange)}>
        <SelectTrigger className={`${className} mt-1`} aria-label={label}><Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" /><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.country ? ` · ${c.country}` : ""}</SelectItem>)}
          <AddNewItem kind="company" />
        </SelectContent>
      </Select>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

/** A list's company filter: "All companies", or one. Shown only when there is more than one. */
export function CompanyFilter({ value, onChange, className = "h-10 rounded-lg text-sm w-full sm:w-52" }: {
  value: string; onChange: (id: string) => void; className?: string;
}) {
  const db = useDb();
  if (!hasCompanies(db.settings)) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label="Company"><Building2 className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" /><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All companies</SelectItem>
        {companiesOf(db.settings).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** A small pill naming the company — when there is more than one. */
export function CompanyBadge({ id, className = "" }: { id: string | undefined; className?: string }) {
  const db = useDb();
  if (!hasCompanies(db.settings)) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground ${className}`}>
      <Building2 className="h-2.5 w-2.5" />{companyById(db.settings, id || MAIN_COMPANY_ID).name}
    </span>
  );
}
