import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PenTool, Building2, UserRound } from "lucide-react";
import { updateDbAs, uid, type Designer, type DesignerKind } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { OpeningBalanceFields } from "@/components/OpeningBalanceFields";
import { designerPayments, jobsOfDesigner } from "@/lib/designers";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Form = {
  kind: DesignerKind; userId: string; name: string; email: string; phone: string; rate: string; notes: string;
  openingBalance?: number; openingDir?: Designer["openingDir"]; openingDate?: string;
};
const EMPTY: Form = { kind: "freelance", userId: "", name: "", email: "", phone: "", rate: "", notes: "" };
const formOf = (x?: Designer): Form => x ? {
  kind: x.kind, userId: x.userId ?? "", name: x.name, email: x.email ?? "", phone: x.phone ?? "",
  rate: x.ratePerDesign != null ? String(x.ratePerDesign) : "", notes: x.notes ?? "",
  openingBalance: x.openingBalance, openingDir: x.openingDir, openingDate: x.openingDate,
} : EMPTY;

/**
 * Add or change a CAD designer — Designers, and "+ Add new designer" wherever
 * one is picked on an order. In-house: one of our employees (salary, login and
 * department stay on the employee). Freelancer: their usual charge per design,
 * filled in on each design and changeable there, and anything owed from before.
 */
export function DesignerCreateDialog({ open, onOpenChange, onCreated, designer }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void;
  /** Editing this designer; absent = a new one. */
  designer?: Designer;
}) {
  const db = useDb();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Form>(formOf(designer));
  useEffect(() => { if (open) setF(formOf(designer)); }, [open, designer]);
  // Employees not yet a designer (or this one's own).
  const taken = new Set((db.designers ?? []).filter(x => x.id !== designer?.id && x.userId).map(x => x.userId!));
  const staff = db.users.filter(u => (u.role === "employee" || u.role === "admin") && u.status !== "inactive" && (!taken.has(u.id) || u.id === f.userId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const emp = f.kind === "inhouse" ? db.users.find(u => u.id === f.userId) : undefined;

  const save = () => {
    const name = (f.kind === "inhouse" ? emp?.name : f.name)?.trim() ?? "";
    if (designer && f.kind !== designer.kind && hasWork) { toast.error(`${designer.name} has designs, payments or money from before — they stay ${designer.kind === "inhouse" ? "in-house" : "a freelancer"}`); return; }
    if (f.kind === "inhouse" && !emp) { toast.error("Choose the employee"); return; }
    if (!name) { toast.error("Enter the designer's name"); return; }
    const email = f.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("That email doesn't look right"); return; }
    const rate = f.rate.trim() === "" ? undefined : Number(f.rate);
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0)) { toast.error("Charge per design should be a positive amount"); return; }
    const dupe = (db.designers ?? []).find(x => x.id !== designer?.id && x.name.trim().toLowerCase() === name.toLowerCase());
    if (dupe) { toast.error(`${dupe.name} is already a designer`); return; }
    setSaving(true);
    try {
      const fields: Partial<Designer> = {
        kind: f.kind, name,
        userId: f.kind === "inhouse" ? emp!.id : undefined,
        email: email || undefined, phone: f.phone.trim() || undefined, notes: f.notes.trim() || undefined,
        // Money is a freelancer's alone: an in-house designer is paid salary.
        ratePerDesign: f.kind === "freelance" ? rate : undefined,
        openingBalance: f.kind === "freelance" ? f.openingBalance : undefined,
        openingDir: f.kind === "freelance" ? f.openingDir : undefined,
        openingDate: f.kind === "freelance" ? f.openingDate : undefined,
      };
      const id = designer?.id ?? uid("dsg_");
      updateDbAs({ summary: designer ? `Designer ${name} updated` : `Designer ${name} added` }, d => {
        if (!d.designers) d.designers = [];
        const x = d.designers.find(y => y.id === id);
        if (x) Object.assign(x, fields);
        else d.designers.unshift({ ...(fields as Designer), id, active: true, createdAt: new Date().toISOString() });
      });
      toast.success(designer ? "Designer updated" : "Designer added");
      onOpenChange(false);
      if (!designer) { setF(EMPTY); onCreated?.(id); }
    } finally { setSaving(false); }
  };

  const kindBtn = (k: DesignerKind, Icon: typeof Building2, title: string, sub: string) => (
    <button type="button" onClick={() => setF(x => ({ ...x, kind: k }))} aria-pressed={f.kind === k} disabled={!!designer && designer.kind !== k && hasWork}
      className={`flex-1 min-w-0 rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${f.kind === k ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30" : "border-border hover:bg-secondary/50"}`}>
      <span className="flex items-center gap-2 text-sm font-semibold text-brand-dark"><Icon className="h-4 w-4 text-primary" />{title}</span>
      <span className="block text-[11px] text-muted-foreground mt-0.5">{sub}</span>
    </button>
  );
  // Once a designer has work, payments or money from before, what kind they are can't change —
  // their designs were costed that way, and a freelancer's account would vanish from view.
  const hasWork = !!designer && (jobsOfDesigner(db, designer.id).length > 0 || designerPayments(db, designer.id).length > 0 || !!designer.openingBalance);

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title={designer ? "Edit Designer" : "Add Designer"}
      description="Our own CAD designer, or a freelancer paid per design" icon={PenTool} size="md"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{f.kind === "inhouse" ? "In-house designer" : "Freelancer"}</p>
            <p className="text-sm font-semibold text-brand-dark truncate">{(f.kind === "inhouse" ? emp?.name : f.name.trim()) || "—"}{f.kind === "freelance" && f.rate.trim() ? ` · ₹${Number(f.rate).toLocaleString("en-IN")} a design` : ""}</p>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="btn-hero rounded-xl px-6 flex-1 sm:flex-none sm:min-w-40">{saving ? "Saving…" : designer ? "Save" : "Add Designer"}</Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        <div className="flex gap-2">
          {kindBtn("inhouse", Building2, "In-house", "Our employee — on salary")}
          {kindBtn("freelance", UserRound, "Freelancer", "Outside — paid per design")}
        </div>
        {hasWork && <p className="text-[11px] text-muted-foreground -mt-2">They have designs, payments or money from before, so whether they are in-house or a freelancer stays as it is.</p>}

        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          {f.kind === "inhouse" ? (
            <div className="col-span-2">
              <Label htmlFor="dsg-emp" className="text-xs">Employee</Label>
              <Select value={f.userId} onValueChange={v => setF(x => ({ ...x, userId: v }))}>
                <SelectTrigger id="dsg-emp" className="rounded-xl mt-1 h-10" aria-label="Employee"><SelectValue placeholder="Choose the employee" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {staff.map(u => <SelectItem key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Their salary is paid in Employees, as always — here you follow their designs.</p>
            </div>
          ) : (
            <div className="col-span-2">
              <Label htmlFor="dsg-name" className="text-xs">Name</Label>
              <Input id="dsg-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="rounded-xl mt-1" autoFocus />
            </div>
          )}
          <div>
            <Label htmlFor="dsg-email" className="text-xs">Email {f.kind === "inhouse" && <span className="font-normal text-muted-foreground">· else the employee's</span>}</Label>
            <Input id="dsg-email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className="rounded-xl mt-1"
              placeholder={f.kind === "inhouse" ? emp?.email || "Optional" : "Gets the new-design emails"} />
          </div>
          <div>
            <Label htmlFor="dsg-phone" className="text-xs">Phone</Label>
            <Input id="dsg-phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className="rounded-xl mt-1" inputMode="tel" placeholder="Optional" />
          </div>
          {f.kind === "freelance" && (
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="dsg-rate" className="text-xs">Usual charge per design (₹)</Label>
              <Input id="dsg-rate" type="number" min={0} step="1" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} className="rounded-xl mt-1" placeholder="e.g. 1500" />
            </div>
          )}
          <div className={f.kind === "freelance" ? "col-span-2 sm:col-span-1" : "col-span-2"}>
            <Label htmlFor="dsg-notes" className="text-xs">Notes</Label>
            <Input id="dsg-notes" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className="rounded-xl mt-1" placeholder="Optional — software, speciality…" />
          </div>
          {f.kind === "freelance" && (
            <OpeningBalanceFields
              amount={f.openingBalance != null ? String(f.openingBalance) : ""}
              dir={f.openingDir || "credit"}
              date={f.openingDate || ""}
              onAmount={v => setF({ ...f, openingBalance: v === "" ? undefined : Number(v) })}
              onDir={v => setF({ ...f, openingDir: v })}
              onDate={v => setF({ ...f, openingDate: v || undefined })}
              debitLabel="We paid ahead (Debit)"
              creditLabel="We owe the designer (Credit)"
              hint="Anything owed either way when you started using the app (₹)."
            />
          )}
        </div>
      </div>
    </ActionSheet>
  );
}
