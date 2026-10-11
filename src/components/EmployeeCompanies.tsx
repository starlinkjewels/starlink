import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { updateDb, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { companiesOf, hasCompanies } from "@/lib/companies";

/**
 * Tick boxes for the companies someone sells for. None ticked means every
 * company — what every employee had before there was more than one.
 */
export function CompanyTicks({ value, onChange, label = "Sells for" }: { value: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const db = useDb();
  const companies = companiesOf(db.settings, true);
  if (!hasCompanies(db.settings)) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div>
      <p className="text-xs font-medium flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-primary" />{label}</p>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {companies.map(c => {
          const on = value.includes(c.id);
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.id)}
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium transition-colors ${on ? "bg-primary text-white border-primary" : "bg-white border-border text-brand-dark hover:bg-secondary"}`}>
              {c.name}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {value.length ? "They can put new clients only under these companies." : "None ticked — every company."}
      </p>
    </div>
  );
}

/** On an employee's card: the companies they sell for, changed in place. Admin only. */
export function EmployeeCompaniesControl({ u }: { u: User }) {
  const db = useDb();
  if (!hasCompanies(db.settings) || u.role !== "employee") return null;
  const save = (ids: string[]) => {
    updateDb(d => {
      const x = d.users.find(y => y.id === u.id);
      if (!x) return;
      if (ids.length) x.companyIds = ids; else delete x.companyIds;
    });
    toast.success(ids.length ? `${u.name} now sells for ${ids.length} compan${ids.length === 1 ? "y" : "ies"}` : `${u.name} sells for every company`);
  };
  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <CompanyTicks value={u.companyIds ?? []} onChange={save} />
    </div>
  );
}
