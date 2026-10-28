import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, LayoutList, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { updateDbAs } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/SectionTitle";
import { DEFAULT_ORDER_SECTIONS, ORDER_SECTIONS, orderSections, type OrderSectionKey } from "@/lib/orderLayout";

const INFO = Object.fromEntries(ORDER_SECTIONS.map(s => [s.key, s])) as Record<OrderSectionKey, (typeof ORDER_SECTIONS)[number]>;

/**
 * Settings → Order page. The admin drags the order page's sections into the
 * order the team works in (or moves them with the arrows — a phone can't
 * drag). The order's header stays on top. One order for the whole business,
 * on every order, for everyone who opens one; only where a section sits
 * changes, never what it shows or who may see it.
 */
export function OrderLayoutSettings() {
  const db = useDb();
  const saved = orderSections(db.settings);
  const savedKey = saved.join("|");
  const [list, setList] = useState<OrderSectionKey[]>(saved);
  const [dragKey, setDragKey] = useState<OrderSectionKey | null>(null);
  const [overKey, setOverKey] = useState<OrderSectionKey | null>(null);
  useEffect(() => { setList(saved); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);

  const dirty = list.join("|") !== savedKey;
  const isDefault = list.join("|") === DEFAULT_ORDER_SECTIONS.join("|");

  const moveTo = (key: OrderSectionKey, to: number) => setList(l => {
    const next = l.filter(k => k !== key);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, key);
    return next;
  });
  const shift = (i: number, dir: -1 | 1) => setList(l => {
    const n = [...l];
    [n[i], n[i + dir]] = [n[i + dir], n[i]];
    return n;
  });

  const save = () => {
    updateDbAs({ summary: "Order page: sections put in a new order" }, d => {
      d.settings.orderPageSections = isDefault ? undefined : [...list];
    });
    toast.success("Order page saved — every order shows its sections in this order");
  };

  return (
    <div className="card-luxe p-6 space-y-4">
      <SectionTitle icon={LayoutList} title="Order page" sub="The order of the sections on every order's page"
        info="Drag a section by its handle, or use the arrows. The order's header — the piece at a glance — always stays on top." />

      <div className="space-y-1.5" onDragOver={e => e.preventDefault()}>
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-secondary/40 border-border/50">
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-brand-dark">Order header</p>
            <p className="text-[11px] text-muted-foreground truncate">The piece at a glance — its photo, status, details and price. Always first.</p>
          </div>
        </div>
        {list.map((k, i) => (
          <div key={k}
            draggable
            onDragStart={e => { e.dataTransfer.setData("text/plain", k); e.dataTransfer.effectAllowed = "move"; setDragKey(k); }}
            onDragEnter={() => setOverKey(k)}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={e => { e.preventDefault(); const from = (e.dataTransfer.getData("text/plain") || dragKey) as OrderSectionKey | null; if (from && from !== k) moveTo(from, list.indexOf(k)); setDragKey(null); setOverKey(null); }}
            onDragEnd={() => { setDragKey(null); setOverKey(null); }}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 bg-white transition-colors
              ${dragKey === k ? "opacity-40" : ""} ${overKey === k && dragKey && dragKey !== k ? "border-primary ring-2 ring-primary/20" : "border-border/70"}`}
            aria-label={`${INFO[k].label}, position ${i + 1}`}>
            <span className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-primary shrink-0" title="Drag to move" aria-hidden>
              <GripVertical className="h-4 w-4" />
            </span>
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0 tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand-dark truncate">{INFO[k].label}</p>
              <p className="text-[11px] text-muted-foreground truncate">{INFO[k].note}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => shift(i, -1)} disabled={i === 0} aria-label={`Move ${INFO[k].label} up`} title="Move up"
                className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => shift(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${INFO[k].label} down`} title="Move down"
                className="h-7 w-7 grid place-items-center rounded-lg hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"><ArrowDown className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
        <li>One order for the whole business — every order, and everyone who opens one, sees its sections this way.</li>
        <li>Only where a section sits changes. Who may see it stays the same: Cost &amp; profit is still the admin&rsquo;s alone, Manufacturing and its log still staff only.</li>
        <li>A section an order has nothing for (no CAD, not dispatched yet) is simply not shown, wherever it is in the list.</li>
      </ul>

      <div className="flex gap-2 justify-end">
        {!isDefault && (
          <Button type="button" variant="ghost" onClick={() => setList([...DEFAULT_ORDER_SECTIONS])} className="rounded-xl gap-1.5 text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Back to default
          </Button>
        )}
        {dirty && <Button type="button" variant="outline" onClick={() => setList(saved)} className="rounded-xl">Discard</Button>}
        <Button type="button" onClick={save} disabled={!dirty} className="btn-hero rounded-xl">Save order page</Button>
      </div>
    </div>
  );
}
