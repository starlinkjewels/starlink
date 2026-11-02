import type { LucideIcon } from "lucide-react";
import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/** One Settings section as the navigation shows it. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The heading it sits under ("Sales & billing"). */
  group: string;
  /** One line about it — the phone list shows it under the name. */
  hint: string;
}

/** The headings, in order; a section's `group` is one of these. */
export const SETTINGS_GROUPS = ["Business", "Sales & billing", "Production", "Lists & categories", "Photos & videos", "Look & feel", "Security & data"] as const;

const grouped = (sections: SettingsSection[]) =>
  SETTINGS_GROUPS.map(g => ({ group: g, items: sections.filter(s => s.group === g) })).filter(x => x.items.length);

/**
 * The laptop's side list: the sections under their headings, the open one
 * marked by a soft tint and a bar at its edge — calm, not a solid block.
 */
export function SettingsSideNav({ sections, active, onPick }: { sections: SettingsSection[]; active?: string; onPick: (id: string) => void }) {
  return (
    <nav aria-label="Settings sections" className="space-y-5">
      {grouped(sections).map(({ group, items }) => (
        <div key={group}>
          <p className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{group}</p>
          <div className="space-y-0.5">
            {items.map(s => {
              const Icon = s.icon;
              const on = active === s.id;
              return (
                <button key={s.id} type="button" onClick={() => onPick(s.id)} aria-current={on ? "page" : undefined}
                  className={`group relative w-full flex items-center gap-2.5 rounded-lg pl-3 pr-2 h-9 text-[13.5px] text-left transition-colors
                    ${on ? "bg-primary/[0.08] text-primary font-semibold" : "text-foreground/75 hover:bg-secondary/80 hover:text-foreground font-medium"}`}>
                  {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />}
                  <Icon className={`h-4 w-4 shrink-0 ${on ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * The phone's Settings home — the sections as grouped lists, like a phone's own
 * Settings: an icon, the name, a line about it, a chevron. A tap opens it.
 */
export function SettingsPhoneList({ sections, onPick }: { sections: SettingsSection[]; onPick: (id: string) => void }) {
  return (
    <div className="space-y-5">
      {grouped(sections).map(({ group, items }) => (
        <section key={group}>
          <p className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{group}</p>
          <div className="rounded-2xl border border-border/60 bg-white divide-y divide-border/50 overflow-hidden">
            {items.map(s => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" onClick={() => onPick(s.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-secondary/70">
                  <span className="h-9 w-9 shrink-0 grid place-items-center rounded-xl bg-primary/[0.08] text-primary"><Icon className="h-[18px] w-[18px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-brand-dark truncate">{s.label}</span>
                    <span className="block text-xs text-muted-foreground truncate">{s.hint}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Changes not saved yet: one bar at the foot of the screen, only while there
 * are some — Discard puts them back as they were, Save writes them.
 */
export function UnsavedBar({ count, saving, onSave, onDiscard }: { count: number; saving?: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.18 }}
          className="sticky bottom-3 z-30 mt-4" role="status">
          <div className="mx-auto max-w-3xl flex items-center gap-3 rounded-2xl bg-brand-dark text-white shadow-xl px-4 py-2.5 max-md:flex-wrap">
            <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
            <p className="text-sm font-medium flex-1 min-w-0">Unsaved changes<span className="text-white/60 font-normal"> · {count} setting{count !== 1 ? "s" : ""}</span></p>
            <button type="button" onClick={onDiscard} disabled={saving}
              className="h-9 px-3.5 rounded-xl text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 inline-flex items-center gap-1.5 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" />Discard
            </button>
            <button type="button" onClick={onSave} disabled={saving}
              className="h-9 px-5 rounded-xl text-sm font-semibold bg-white text-brand-dark hover:bg-white/90 inline-flex items-center gap-1.5 disabled:opacity-70">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save changes
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
