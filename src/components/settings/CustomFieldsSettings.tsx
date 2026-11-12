// Settings → Custom fields (admins): the business's own boxes on orders, clients,
// suppliers, Ready Stock pieces, stone lots and certified stones. The rules and
// where values are kept: lib/customFields.ts.
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ArrowUp, ArrowDown, Power, Trash2, SlidersHorizontal } from "lucide-react";
import { useDb } from "@/hooks/useDb";
import { updateDbAs } from "@/lib/db";
import { confirmBox } from "@/lib/confirm";
import {
  TARGETS, TARGET_LIST, KIND_LABEL, ACCESS_LABEL, newFieldId, relocateField, usesOf,
  type CfAccess, type CfKind, type CfTarget, type CustomFieldDef,
} from "@/lib/customFields";
import { SectionTitle } from "@/components/SectionTitle";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { ActionSheet } from "@/components/ActionSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Field, PanelActions, Segmented } from "@/components/BillLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MoreAction } from "@/components/MoreMenu";

type Draft = { target: CfTarget; label: string; kind: CfKind; options: string; access: CfAccess; required: boolean; hint: string };
const blank = (target: CfTarget = "orders"): Draft => ({ target, label: "", kind: "text", options: "", access: "staff", required: false, hint: "" });

export function CustomFieldsSettings() {
  const db = useDb();
  const fields = db.settings.customFields ?? [];
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [show, setShow] = useState<CfTarget | "all">("all");

  const save = async () => {
    if (!editing) return;
    const { id, draft } = editing;
    const label = draft.label.trim();
    if (!label) { toast.error("Name the field"); return; }
    const options = [...new Set(draft.options.split(/\n|,/).map(s => s.trim()).filter(Boolean))];
    if (draft.kind === "list" && options.length < 1) { toast.error("Add the dropdown's choices — one a line"); return; }
    if (fields.some(f => f.id !== id && f.target === draft.target && f.label.trim().toLowerCase() === label.toLowerCase())) { toast.error(`${TARGETS[draft.target].label} already have a field called ${label}`); return; }
    const before = id ? fields.find(f => f.id === id) : undefined;
    if (before && before.kind !== draft.kind && usesOf(db, before) > 0) {
      if (!(await confirmBox([`Change ${before.label} from ${KIND_LABEL[before.kind]} to ${KIND_LABEL[draft.kind]}?`, "", `• ${usesOf(db, before)} record(s) already have a value — they are kept as written and shown as they are.`], { confirmText: "Change" }))) return;
    }
    let moved = 0;
    updateDbAs({ summary: before ? `Custom field changed — ${label}` : `Custom field added — ${label} (${TARGETS[draft.target].label})` }, d => {
      const list = [...(d.settings.customFields ?? [])];
      const next: CustomFieldDef = {
        id: before?.id ?? newFieldId(), target: before?.target ?? draft.target, label, kind: draft.kind,
        ...(draft.kind === "list" ? { options } : {}), access: draft.access,
        ...(draft.required ? { required: true } : {}), ...(draft.hint.trim() ? { hint: draft.hint.trim() } : {}),
        ...(before?.active === false ? { active: false } : {}), createdAt: before?.createdAt ?? new Date().toISOString(),
      };
      // Who sees it changed: its values move to where the new setting keeps them.
      if (before && before.access !== draft.access) moved = relocateField(d, before, before.access, draft.access);
      const i = list.findIndex(f => f.id === next.id);
      if (i >= 0) list[i] = next; else list.push(next);
      d.settings = { ...d.settings, customFields: list };
    });
    toast.success(before ? `Saved${moved ? ` — ${moved} value${moved === 1 ? "" : "s"} moved to match who sees it` : ""}` : `${label} added to ${TARGETS[draft.target].label.toLowerCase()}`);
    setEditing(null);
  };

  const move = (f: CustomFieldDef, dir: -1 | 1) => updateDbAs({ summary: `Custom fields reordered` }, d => {
    const list = [...(d.settings.customFields ?? [])];
    const same = list.map((x, i) => ({ x, i })).filter(({ x }) => x.target === f.target);
    const at = same.findIndex(({ x }) => x.id === f.id);
    const to = same[at + dir];
    if (!to) return;
    [list[same[at].i], list[to.i]] = [list[to.i], list[same[at].i]];
    d.settings = { ...d.settings, customFields: list };
  });
  const toggle = (f: CustomFieldDef) => updateDbAs({ summary: `Custom field ${f.active === false ? "switched on" : "switched off"} — ${f.label}` }, d => {
    d.settings = { ...d.settings, customFields: (d.settings.customFields ?? []).map(x => (x.id === f.id ? (f.active === false ? (({ active: _a, ...rest }) => rest)(x) : { ...x, active: false }) : x)) };
  });
  const remove = async (f: CustomFieldDef) => {
    if (!(await confirmBox([`Delete the field ${f.label}?`, "", "• no record has a value in it", "• it goes from every form and table"], { danger: true, confirmText: "Delete field" }))) return;
    updateDbAs({ summary: `Custom field deleted — ${f.label}` }, d => {
      d.settings = { ...d.settings, customFields: (d.settings.customFields ?? []).filter(x => x.id !== f.id) };
    });
  };

  const rows = fields.filter(f => show === "all" || f.target === show);
  const columns: DataColumn<CustomFieldDef>[] = [
    { key: "label", header: "Field", always: true, sortValue: f => f.label, csv: f => f.label,
      cell: f => <CellMain title={f.label} sub={`${KIND_LABEL[f.kind]}${f.kind === "list" ? `: ${(f.options ?? []).join(", ")}` : ""}${f.hint ? ` · ${f.hint}` : ""}`} /> },
    { key: "target", header: "On", sortValue: f => TARGET_LIST.indexOf(f.target), csv: f => TARGETS[f.target].label, cell: f => <span className="text-sm">{TARGETS[f.target].label}</span> },
    { key: "access", header: "Who sees it", sortValue: f => f.access, csv: f => ACCESS_LABEL[f.access],
      cell: f => <CellTag tone={f.access === "admins" ? "violet" : f.access === "client" ? "blue" : "neutral"}>{ACCESS_LABEL[f.access]}</CellTag> },
    { key: "req", header: "Required", sortValue: f => (f.required ? 1 : 0), csv: f => (f.required ? "Yes" : ""), cell: f => (f.required ? <CellTag tone="amber">Required</CellTag> : <span className="text-muted-foreground">—</span>) },
    { key: "uses", header: "Filled on", align: "right", sortValue: f => usesOf(db, f), csv: f => usesOf(db, f), cell: f => <span className="tabular-nums text-sm">{usesOf(db, f)}</span> },
    { key: "state", header: "Status", sortValue: f => (f.active === false ? 1 : 0), csv: f => (f.active === false ? "Off" : "On"),
      cell: f => (f.active === false ? <CellTag>Off</CellTag> : <CellTag tone="green">On</CellTag>) },
  ];
  const actions = (f: CustomFieldDef): MoreAction[] => {
    const uses = usesOf(db, f);
    const same = fields.filter(x => x.target === f.target);
    const at = same.findIndex(x => x.id === f.id);
    return [
      { label: "Edit", icon: Pencil, onSelect: () => setEditing({ id: f.id, draft: { target: f.target, label: f.label, kind: f.kind, options: (f.options ?? []).join("\n"), access: f.access, required: !!f.required, hint: f.hint ?? "" } }) },
      { label: "Move up", icon: ArrowUp, disabled: at <= 0, onSelect: () => move(f, -1) },
      { label: "Move down", icon: ArrowDown, disabled: at >= same.length - 1, onSelect: () => move(f, 1) },
      { label: f.active === false ? "Switch on" : "Switch off", icon: Power, hint: f.active === false ? "Asked again in forms and tables" : "No longer asked — what is filled in is kept", onSelect: () => toggle(f) },
      { label: "Delete", icon: Trash2, danger: true, disabled: uses > 0, hint: uses > 0 ? `${uses} record${uses === 1 ? " has" : "s have"} a value — switch it off instead` : "No record has a value", onSelect: () => void remove(f) },
    ];
  };

  const d = editing?.draft;
  const setD = (p: Partial<Draft>) => setEditing(e => (e ? { ...e, draft: { ...e.draft, ...p } } : e));
  return (
    <div className="space-y-5">
      <SectionTitle title="Custom fields" sub="Your own boxes on orders, clients, suppliers, Ready Stock and stones"
        info={<>Each field shows in its record's form, on its page, as a column in its table (from View) and in its Excel. Who sees it decides where the value is kept: <b>All staff</b> — never readable by a client; <b>Admins only</b> — kept with the admin's private records; <b>Staff and the client</b> — on the record, shown to the client too (an order's page and PDF, a piece in the shop and on shared pages).</>} />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={show} onValueChange={v => setShow(v as CfTarget | "all")}>
          <SelectTrigger className="rounded-xl h-9 w-56" aria-label="Show fields of"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            {TARGET_LIST.map(t => <SelectItem key={t} value={t}>{TARGETS[t].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" className="btn-hero rounded-xl h-9 gap-1.5 ml-auto" onClick={() => setEditing({ id: null, draft: blank(show === "all" ? "orders" : show) })}><Plus className="h-4 w-4" /> Add field</Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No custom fields yet{show !== "all" ? ` on ${TARGETS[show].label.toLowerCase()}` : ""} — add one, e.g. “Ring size” on orders or “Birthday” on clients.</p>
      ) : (
        <DataTable id="custom-fields" noun="field" rows={rows} columns={columns} rowKey={f => f.id} rowActions={actions}
          searchText={f => `${f.label} ${TARGETS[f.target].label} ${(f.options ?? []).join(" ")}`} searchPlaceholder="Search fields" exportName="Custom-fields" pageSizes={[25, 50, 100]} />
      )}

      {editing && d && (
        <ActionSheet open onOpenChange={o => { if (!o) setEditing(null); }} size="md" icon={SlidersHorizontal}
          title={editing.id ? `Edit ${d.label || "field"}` : "Add a custom field"} description="A box of your own on a kind of record"
          footer={<PanelActions onCancel={() => setEditing(null)}><AsyncButton onClick={save} className="btn-hero rounded-xl h-11 flex-1 sm:flex-none sm:min-w-40">{editing.id ? "Save field" : "Add field"}</AsyncButton></PanelActions>}>
          <div className="space-y-4">
            <Field label="On" hint={editing.id ? "A field stays on the records it was made for" : undefined}>{id => (
              <Select value={d.target} disabled={!!editing.id} onValueChange={v => setD({ target: v as CfTarget })}>
                <SelectTrigger id={id} className="rounded-xl h-10" aria-label="On"><SelectValue /></SelectTrigger>
                <SelectContent>{TARGET_LIST.map(t => <SelectItem key={t} value={t}>{TARGETS[t].label}</SelectItem>)}</SelectContent>
              </Select>
            )}</Field>
            <Field label="Name" required>{id => <Input id={id} value={d.label} onChange={e => setD({ label: e.target.value })} className="rounded-xl h-10" placeholder="e.g. Ring size" aria-label="Name" />}</Field>
            <Field label="Kind">{id => (
              <Select value={d.kind} onValueChange={v => setD({ kind: v as CfKind })}>
                <SelectTrigger id={id} className="rounded-xl h-10" aria-label="Kind"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(KIND_LABEL) as CfKind[]).map(k => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            )}</Field>
            {d.kind === "list" && (
              <Field label="Choices" required hint="One a line">{id => <Textarea id={id} rows={4} value={d.options} onChange={e => setD({ options: e.target.value })} className="rounded-xl" placeholder={"Small\nMedium\nLarge"} aria-label="Choices" />}</Field>
            )}
            <Field label="Who sees it">
              <Segmented value={d.access} onChange={v => setD({ access: v })} options={[["staff", "All staff"], ["admins", "Admins only"], ["client", "+ the client"]] as const} />
            </Field>
            <p className="text-[11px] text-muted-foreground -mt-2">{d.access === "staff" ? "Every staff member sees and fills it; a client never can — not even from the database." : d.access === "admins" ? "Only admins see and fill it; kept with the admin's private records." : d.target === "orders" || d.target === "clients" || d.target === "readyStock" ? "Shown to the client too — on their order, their profile or the shop and shared pages." : "Staff see it (clients never see these records)."}</p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={d.required} onChange={e => setD({ required: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" aria-label="Required" />
              Required — the form won't save without it <span className="text-muted-foreground text-xs">(older records still open and save)</span>
            </label>
            <Field label="Hint" hint="Optional — a line under the box">{id => <Input id={id} value={d.hint} onChange={e => setD({ hint: e.target.value })} className="rounded-xl h-10" placeholder="e.g. US size" aria-label="Hint" />}</Field>
          </div>
        </ActionSheet>
      )}
    </div>
  );
}
