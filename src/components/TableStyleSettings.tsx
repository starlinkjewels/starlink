import { useEffect, useState } from "react";
import { SectionTitle } from "@/components/SectionTitle";
import { Table2, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { loadDb, updateDb } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  TABLE_STYLES, DEFAULT_TABLE_UI, applyTableUi, tableUiOf, type TableUi, type TableStyleKey, type TableDensity,
} from "@/lib/tableStyle";

/** A thumbnail of each style — drawn, so it shows even before the style is applied. */
function Thumb({ k }: { k: TableStyleKey }) {
  const head = k === "bold" ? "bg-brand-dark" : k === "striped" ? "bg-primary/15" : k === "grid" || k === "classic" ? "bg-secondary" : "bg-transparent";
  const rows = [0, 1, 2, 3];
  return (
    <div className={`rounded-lg overflow-hidden border ${k === "cards" ? "border-transparent bg-secondary/60 p-1 space-y-1" : "border-border/70 bg-white"}`}>
      {k !== "cards" && <div className={`h-3 ${head} ${k === "minimal" || k === "clean" ? "border-b border-border/60" : ""}`} />}
      {rows.map(r => (
        <div key={r} className={`flex ${k === "cards" ? "h-3 rounded bg-white border border-border/60" : "h-3"} ${k === "striped" && r % 2 ? "bg-primary/5" : ""} ${k !== "cards" && k !== "minimal" ? "border-b border-border/40" : k === "minimal" ? "border-b border-border/20" : ""}`}>
          {[0, 1, 2].map(c => <div key={c} className={`flex-1 ${k === "grid" && c ? "border-l border-border/50" : ""}`} />)}
        </div>
      ))}
    </div>
  );
}

const SAMPLE = [
  { no: "SLJ-2026-1104", client: "GIVARA JEWELRY", status: "In Production", amt: "$1,500", date: "11 Oct 2026" },
  { no: "SLJ-2026-1103", client: "VIEN BYEN BIEN", status: "Ready", amt: "$750", date: "10 Oct 2026" },
  { no: "SLJ-2026-1102", client: "AMATI DESIGNS", status: "Dispatched", amt: "$1,120", date: "10 Oct 2026" },
  { no: "SLJ-2026-1101", client: "KC Gold and Diamond Trade", status: "Delivered", amt: "$2,450", date: "9 Oct 2026" },
];

/**
 * Settings → Table Style. Picking a style shows it at once — on the sample
 * below and on every table in the app — and Save keeps it for everyone.
 * Leaving without saving puts back what was saved.
 */
export function TableStyleSettings() {
  const db = useDb();
  const saved = tableUiOf(db.settings.tableUi as Partial<TableUi> | undefined);
  const savedKey = JSON.stringify(saved);
  const [ui, setUi] = useState<TableUi>(saved);
  const dirty = JSON.stringify(ui) !== savedKey;

  // Live preview while choosing; the saved style again on the way out.
  useEffect(() => { applyTableUi(ui); }, [ui]);
  // Read live — after a Save this is the new style, not the one the page opened with.
  useEffect(() => () => applyTableUi(tableUiOf(loadDb().settings.tableUi as Partial<TableUi> | undefined)), []);

  const pick = (k: TableStyleKey) => {
    const s = TABLE_STYLES.find(x => x.key === k)!;
    // Each style starts from the options that suit it; any can be changed after.
    setUi(prev => ({ ...prev, style: k, zebra: s.zebra, hover: s.hover, lines: s.lines }));
  };
  const save = () => {
    updateDb(d => { d.settings.tableUi = ui.style === "classic" && ui.density === "default" ? undefined : ui; });
    toast.success("Table style saved — every table now uses it");
  };

  const disabled = ui.style === "classic";
  const toggle = (key: "zebra" | "hover" | "lines" | "sticky", label: string, hint: string) => (
    <label className={`flex items-start justify-between gap-3 rounded-xl border border-border/70 p-3 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block text-sm font-medium text-brand-dark">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={ui[key]} disabled={disabled} onCheckedChange={v => setUi(prev => ({ ...prev, [key]: v }))} />
    </label>
  );

  return (
    <div className="card-luxe p-6 space-y-5">
      <SectionTitle icon={Table2} title="Table Style" sub="Every table, for everyone once saved" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TABLE_STYLES.map(s => {
          const on = ui.style === s.key;
          return (
            <button key={s.key} type="button" onClick={() => pick(s.key)}
              className={`text-left rounded-2xl border p-3 space-y-2 transition-all ${on ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border/70 hover:border-primary/40 bg-white"}`}>
              <Thumb k={s.key} />
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-semibold text-brand-dark">{s.name}</span>
                {on && <Check className="h-4 w-4 text-primary" />}
              </div>
              <p className="text-[10.5px] text-muted-foreground leading-snug">{s.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className={`flex flex-wrap items-center gap-3 ${disabled ? "opacity-50" : ""}`}>
          <span className="text-sm font-medium text-brand-dark">Row spacing</span>
          <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-secondary">
            {([["compact", "Compact"], ["default", "Normal"], ["spacious", "Spacious"]] as [TableDensity, string][]).map(([k, l]) => (
              <button key={k} type="button" disabled={disabled} onClick={() => setUi(prev => ({ ...prev, density: k }))}
                className={`h-8 px-3 rounded-md text-xs font-medium ${ui.density === k ? "bg-white shadow-soft text-brand-dark" : "text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {toggle("zebra", "Striped rows", "Every other row lightly tinted")}
          {toggle("hover", "Highlight row under the pointer", "Easier to read across a wide row")}
          {toggle("lines", "Column lines", "A thin line between columns")}
          {/* No "header stays at the top" any more: every table's header now
              stays in view on its own (components/TableBox.tsx). */}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Preview</p>
        <div className="overflow-x-auto max-h-52 overflow-y-auto rounded-xl border border-border/60 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold">Order</th>
                <th className="text-left px-4 py-2 text-xs font-semibold">Client</th>
                <th className="text-left px-4 py-2 text-xs font-semibold">Status</th>
                <th className="text-right px-4 py-2 text-xs font-semibold">Value</th>
                <th className="text-right px-4 py-2 text-xs font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {[...SAMPLE, ...SAMPLE].map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-brand-dark">{r.no}</td>
                  <td className="px-4 py-2.5">{r.client}</td>
                  <td className="px-4 py-2.5"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{r.status}</span></td>
                  <td className="px-4 py-2.5 text-right font-semibold">{r.amt}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        {ui.style !== "classic" && (
          <Button type="button" variant="ghost" onClick={() => setUi(DEFAULT_TABLE_UI)} className="rounded-xl gap-1.5 text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Back to Classic
          </Button>
        )}
        {dirty && <Button type="button" variant="outline" onClick={() => setUi(saved)} className="rounded-xl">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save for everyone</Button>
      </div>
    </div>
  );
}
