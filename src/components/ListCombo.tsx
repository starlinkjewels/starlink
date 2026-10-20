import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { choicesOf, listDef, listOf, type ListKey } from "@/lib/optionLists";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/**
 * A dropdown fed by one of the business's lists (Settings → Dropdown lists)
 * that can also be TYPED in: type to find an option, or type something new and
 * press "Add" — it is used straight away and remembered in the list, so next
 * time it is there to pick. Clients' typed words are used on their own record
 * only (the lists are the business's).
 *
 * Built on a popover + search rather than a plain select so a long list (mm
 * sizes, colours) is found by typing a few letters.
 */
export function ListCombo({
  list, value, onChange, id, optional = true, placeholder = "—", className = "h-10 rounded-xl",
  choices, normalize, disabled, ariaLabel,
}: {
  list: ListKey; value: string; onChange: (v: string) => void; id?: string;
  /** Adds "—" (not recorded). */
  optional?: boolean; placeholder?: string; className?: string;
  /** The options, when they are not the list as it stands (the mm and sieve sizes). */
  choices?: string[];
  /** Tidies a typed word before it is used ("1.30" → "1.3 mm"). */
  normalize?: (typed: string) => string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const db = useDb();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const base = choices ?? choicesOf(list, undefined, db.settings);
  const options = value && !base.includes(value) ? [...base, value] : base;
  const typed = q.trim();
  const word = typed ? (normalize ? normalize(typed) : typed) : "";
  const known = word ? options.find(o => o.toLowerCase() === word.toLowerCase()) : undefined;
  // What matches what is typed — existing words first, so Enter picks one of them
  // rather than adding a half-typed duplicate. "Add" is last, and Enter adds only
  // when nothing matches at all.
  const shown = typed ? options.filter(o => o.toLowerCase().includes(typed.toLowerCase()) || (word && o.toLowerCase().includes(word.toLowerCase()))) : options;

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  const add = () => {
    if (!word) return;
    if (known) { pick(known); return; }
    // Remembered in the business's list — staff only; a client's word stays on their record.
    if (user && user.role !== "client") {
      updateDb(d => {
        const cur = listOf(list, d.settings);
        if (cur.some(x => x.toLowerCase() === word.toLowerCase())) return;
        if (!d.settings.optionLists) d.settings.optionLists = {};
        d.settings.optionLists[list] = [...cur, word];
      });
      toast.success(`"${word}" added to ${listDef(list).title}`, { description: "It's in the list from now on — change it in Settings → Dropdown lists." });
    }
    pick(word);
  };

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQ(""); }} modal>
      <PopoverTrigger asChild>
        <button type="button" id={id} role="combobox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between gap-2 whitespace-nowrap border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[12rem]">
        <Command loop shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Type to find or add…"
            onKeyDown={e => { if (e.key === "Enter" && word && !known && shown.length === 0) { e.preventDefault(); add(); } }} />
          <CommandList className="max-h-64">
            {optional && !typed && (
              <CommandItem value={NONE} onSelect={() => pick("")}><span className="text-muted-foreground">—</span></CommandItem>
            )}
            {shown.map(o => (
              <CommandItem key={o} value={o} onSelect={() => pick(o)}>
                <span className="flex-1 truncate">{o}</span>
                {o === value && <Check className="h-4 w-4 text-primary shrink-0" />}
              </CommandItem>
            ))}
            {word && !known && (
              <CommandItem value={`${typed} __add__`} onSelect={add} className="text-primary font-medium">
                <Plus className="h-4 w-4 shrink-0" /> Add “{word}”
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
