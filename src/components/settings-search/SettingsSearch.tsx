import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchJumps, searchSections } from "./settingsIndex";

/**
 * The search box over Settings' section list, and what it finds: the sections
 * whose name or settings hold the words typed (each saying which settings
 * matched), then the settings kept on other pages. It stands in for the
 * section list while something is typed — the rail on a laptop, the strip on
 * a phone — so the same list works on both. Enter opens the first; Esc clears.
 */
export function SettingsSearch({ value, onChange, sections, onPick }: {
  value: string;
  onChange: (v: string) => void;
  sections: readonly { id: string; label: string; icon: LucideIcon }[];
  onPick: (id: string) => void;
}) {
  const q = value.trim();
  const hits = q ? searchSections(q, sections) : [];
  const jumps = q ? searchJumps(q) : [];
  const pick = (id: string) => { onPick(id); onChange(""); };
  return (
    <div className="space-y-2 min-w-0">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") onChange("");
            if (e.key === "Enter" && hits[0]) pick(hits[0].key);
          }}
          placeholder="Search settings…"
          aria-label="Search settings"
          className="h-10 pl-9 pr-9 rounded-xl bg-white [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Clear the search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {q && (
        <div className="flex flex-col gap-1" aria-label="Settings found">
          {hits.map(h => {
            const s = sections.find(x => x.id === h.key)!;
            const Icon = s.icon;
            return (
              <button key={h.key} type="button" onClick={() => pick(h.key)}
                className="group flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm hover:bg-secondary/70 border border-border/60 bg-white">
                <Icon className="h-4 w-4 shrink-0 mt-0.5 text-primary/70 group-hover:text-primary" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{s.label}</span>
                  {h.matched.length > 0 && (
                    <span className="block text-[11px] text-muted-foreground leading-snug">{h.matched.join(" · ")}</span>
                  )}
                </span>
              </button>
            );
          })}
          {jumps.length > 0 && (
            <p className="px-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">On other pages</p>
          )}
          {jumps.map(j => (
            <Link key={j.to} to={j.to}
              className="group flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm hover:bg-secondary/70 border border-dashed border-border/80 bg-white">
              <ArrowUpRight className="h-4 w-4 shrink-0 mt-0.5 text-primary/70 group-hover:text-primary" />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{j.label}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug">{j.where}</span>
              </span>
            </Link>
          ))}
          {hits.length === 0 && jumps.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">No setting matches “{q}”.</p>
          )}
        </div>
      )}
    </div>
  );
}
