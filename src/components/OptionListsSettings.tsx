import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, List, Lock, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { SectionTitle } from "@/components/SectionTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { confirmBox } from "@/lib/confirm";
import { LIST_DEFS, listDef, listOf, noKaratMetals, type ListKey } from "@/lib/optionLists";
import { isPlainlyNotGold } from "@/lib/metals";

const GROUPS = ["Orders", "Diamonds", "Payments", "Team", "Reasons"] as const;
const MAX = 60;

/**
 * Settings → Dropdown lists. Every business words its own choices — metals,
 * jewellery types, payment methods, departments — so each list is edited here:
 * add, rename, reorder, remove. A draft until Save, like the production
 * timeline. Saving never touches a record already made: an order keeps the
 * word it was saved with, and is still shown and editable with it.
 */
export function OptionListsSettings() {
  const db = useDb();
  const [key, setKey] = useState<ListKey>("metals");
  const def = listDef(key);
  const saved = listOf(key, db.settings);
  const savedNoKarat = noKaratMetals(db.settings);
  const [list, setList] = useState<string[]>(saved);
  const [noKarat, setNoKarat] = useState<string[]>(savedNoKarat);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const savedKey = `${key}|${saved.join("|")}|${savedNoKarat.join("|")}`;
  useEffect(() => {
    setList(saved); setNoKarat(savedNoKarat); setEditing(null); setName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const isMetals = key === "metals";
  const dirty = list.join("|") !== saved.join("|") || (isMetals && [...noKarat].sort().join("|") !== [...savedNoKarat].sort().join("|"));
  const isDefault = list.join("|") === def.defaults.join("|");
  const builtIn = def.builtIn ?? [];

  /** Why a name can't be used — or nothing. */
  const problem = (raw: string, except?: number) => {
    const n = raw.trim().replace(/\s+/g, " ");
    if (!n) return "Type a name";
    if (n.length > MAX) return `Keep it under ${MAX} characters`;
    const lower = n.toLowerCase();
    if (list.some((x, i) => i !== except && x.toLowerCase() === lower) || builtIn.some(b => b.toLowerCase() === lower)) return `"${n}" is already in the list`;
    return null;
  };

  const add = () => {
    const p = problem(name);
    if (p) { toast.error(p); return; }
    const n = name.trim().replace(/\s+/g, " ");
    setList([...list, n]);
    setName("");
  };
  const rename = (i: number) => {
    const p = problem(editText, i);
    if (p) { toast.error(p); return; }
    const n = editText.trim().replace(/\s+/g, " ");
    const old = list[i];
    setList(list.map((x, j) => (j === i ? n : x)));
    // A metal keeps its "no karats" under its new name too — and the old name
    // stays marked, for the orders already saved with it.
    if (isMetals && noKarat.includes(old) && !noKarat.includes(n)) setNoKarat([...noKarat, n]);
    setEditing(null);
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setList(next);
  };
  const remove = (i: number) => {
    if (list.length <= 1) { toast.error("A list needs at least one choice"); return; }
    setList(list.filter((_, j) => j !== i));
    if (editing === i) setEditing(null);
  };
  const toggleKarat = (m: string, hasKarats: boolean) =>
    setNoKarat(hasKarats ? noKarat.filter(x => x !== m) : [...noKarat, m]);

  const save = () => {
    if (!list.length) { toast.error("A list needs at least one choice"); return; }
    updateDbAs({ summary: `Dropdown lists: ${def.title} updated` }, d => {
      const own = { ...(d.settings.optionLists ?? {}) };
      // Back on the default list, nothing is stored — later improvements to the default reach it.
      if (isDefault) delete own[key]; else own[key] = list;
      d.settings.optionLists = own;
      if (isMetals) d.settings.metalsWithoutKarats = noKarat;
    });
    toast.success(`${def.title} saved — new entries use it; earlier records keep their wording`);
  };

  const pick = async (k: ListKey) => {
    if (k === key) return;
    if (dirty && !(await confirmBox(`${def.title} has changes that aren't saved. Leave without saving?`))) return;
    setKey(k);
  };

  const iconBtn = "h-8 w-8 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div className="card-luxe p-6 space-y-5">
      <SectionTitle icon={List} title="Dropdown lists" sub="The choices your team picks from"
        info="Add, rename, reorder or remove choices. Records already saved keep their wording — nothing that was entered changes." />

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* The lists, grouped — one open at a time. */}
        <nav className="space-y-4" aria-label="Lists">
          {GROUPS.map(g => (
            <div key={g}>
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</p>
              <div className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
                {LIST_DEFS.filter(d => d.group === g).map(d => {
                  const on = d.key === key;
                  const n = listOf(d.key, db.settings).length;
                  const own = !!db.settings.optionLists?.[d.key]?.length;
                  return (
                    <button key={d.key} type="button" onClick={() => void pick(d.key)} aria-current={on ? "true" : undefined}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm text-left transition-colors max-lg:border
                        ${on ? "bg-primary/10 text-primary font-semibold max-lg:border-primary/30" : "text-brand-dark hover:bg-secondary max-lg:border-border/70"}`}>
                      <span className="truncate">{d.title}</span>
                      <span className={`text-[11px] tabular-nums shrink-0 ${on ? "text-primary/80" : "text-muted-foreground"}`}>{n}{own ? " · edited" : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* The open list. */}
        <div className="min-w-0 space-y-4">
          <div>
            <h3 className="font-semibold text-brand-dark">{def.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{def.hint}</p>
          </div>

          <div className="space-y-1.5">
            {list.map((item, i) => (
              <div key={`${item}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/70 bg-white px-3 py-2">
                <span className="text-xs text-muted-foreground w-5 text-right shrink-0 tabular-nums">{i + 1}</span>
                {editing === i ? (
                  <>
                    <Input value={editText} onChange={e => setEditText(e.target.value)} autoFocus maxLength={MAX}
                      onKeyDown={e => { if (e.key === "Enter") rename(i); if (e.key === "Escape") setEditing(null); }}
                      className="h-8 rounded-lg flex-1 min-w-0" aria-label={`Rename ${item}`} />
                    <button type="button" onClick={() => rename(i)} className={iconBtn} title="Keep this name"><Check className="h-4 w-4 text-success" /></button>
                    <button type="button" onClick={() => setEditing(null)} className={iconBtn} title="Cancel"><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    {/* On a phone the name takes its own line, the controls the next. */}
                    <p className="min-w-0 flex-1 text-sm font-medium text-brand-dark truncate max-sm:basis-[calc(100%-1.75rem)]" title={item}>{item}</p>
                    {isMetals && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0 cursor-pointer max-sm:ml-7" title="Karats: gold of any colour. No karats: the piece is this metal (platinum, silver…)">
                        {/* Silver, platinum… are never karat metals; their switch shows it and stays off. */}
                        <Switch checked={!isPlainlyNotGold(item) && !noKarat.includes(item)} disabled={isPlainlyNotGold(item)}
                          title={isPlainlyNotGold(item) ? "Not gold — never karats" : undefined}
                          onCheckedChange={v => toggleKarat(item, v)} aria-label={`${item} has karats`} />
                        <span className="w-14">{isPlainlyNotGold(item) || noKarat.includes(item) ? "No karats" : "Karats"}</span>
                      </label>
                    )}
                    <div className="flex items-center shrink-0 ml-auto">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={iconBtn} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className={iconBtn} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => { setEditing(i); setEditText(item); }} className={iconBtn} title="Rename"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => remove(i)} disabled={list.length <= 1} className={`${iconBtn} text-destructive hover:bg-destructive/10`} title="Remove from the list"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {builtIn.map(b => (
              <div key={b} className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/40 px-3 py-2">
                <span className="text-xs text-muted-foreground w-5 text-right shrink-0"><Lock className="h-3 w-3 inline" /></span>
                <p className="min-w-0 flex-1 text-sm font-medium text-brand-dark truncate">{b}</p>
                <span className="text-[11px] text-muted-foreground shrink-0">Built in — the app relies on it</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
              placeholder={`Add to ${def.title.toLowerCase()}`} className="rounded-xl h-10" maxLength={MAX} />
            <Button type="button" variant="outline" onClick={add} className="rounded-xl h-10 gap-1.5 shrink-0"><Plus className="h-4 w-4" /> Add</Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Records already saved keep their wording, and can still be edited with it. Changes apply to new entries.
            {isMetals ? " A metal with karats is gold of some colour — bought, issued and charged by karat." : ""}
          </p>

          <div className="flex flex-wrap gap-2 justify-end">
            {!isDefault && (
              <Button type="button" variant="ghost" onClick={() => setList([...def.defaults])} className="rounded-xl gap-1.5 text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> Back to default
              </Button>
            )}
            {dirty && <Button type="button" variant="outline" onClick={() => { setList(saved); setNoKarat(savedNoKarat); setEditing(null); }} className="rounded-xl">Discard</Button>}
            <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save {def.title.toLowerCase()}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
