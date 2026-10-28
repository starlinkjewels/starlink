import { ListCombo } from "@/components/ListCombo";
import { useDb } from "@/hooks/useDb";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_LOCKER_CATEGORIES, updateDb } from "@/lib/db";

/**
 * A category for an account entry or an expense: pick one of the business's
 * (Settings → Categories), or type a new one — it is used at once and kept in
 * that list for next time, like every other dropdown.
 */
export function CategoryCombo({ kind, value, onChange, className = "h-10 rounded-xl", exclude = [], include = [], id }: {
  kind: "locker" | "expense"; value: string; onChange: (v: string) => void; className?: string;
  /** Left out of the choices (a salary is entered from the employee). */
  exclude?: string[];
  /** Always offered, first, even when the saved list lacks it (Salary for an employee). */
  include?: string[];
  id?: string;
}) {
  const db = useDb();
  const saved = kind === "locker" ? db.settings.lockerCategories : db.settings.expenseCategories;
  const list = saved?.length ? saved : kind === "locker" ? DEFAULT_LOCKER_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
  const choices = [...include.filter(c => !list.includes(c)), ...list].filter(c => !exclude.includes(c));
  return (
    <ListCombo value={value} onChange={onChange} choices={choices} optional={false} className={className} id={id}
      placeholder="Choose or type a category" ariaLabel="Category"
      listTitle={kind === "locker" ? "account categories" : "expense categories"}
      remember={word => updateDb(d => {
        const cur = (kind === "locker" ? d.settings.lockerCategories : d.settings.expenseCategories) ?? [];
        const base = cur.length ? cur : [...(kind === "locker" ? DEFAULT_LOCKER_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES)];
        if (base.some(c => c.toLowerCase() === word.toLowerCase())) return;
        if (kind === "locker") d.settings.lockerCategories = [...base, word];
        else d.settings.expenseCategories = [...base, word];
      })} />
  );
}
