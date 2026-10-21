import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { useDb } from "@/hooks/useDb";
import { updateDb } from "@/lib/db";
import { proposeHandlers } from "@/lib/clientHandlers";

/**
 * Clients nobody was named on, handed to the admin who added each one — read
 * from the activity log, shown in full first, written only on "Fill in". A
 * client someone was named on in the meantime is left as it is.
 */
export function FillHandlersSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useDb();
  const [rows, setRows] = useState<{ clientId: string; userId: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) { setRows(null); return; }
    let live = true;
    proposeHandlers(db).then(r => { if (live) setRows(r); }).catch(e => { if (live) { setRows([]); toast.error(`Couldn't read the activity log: ${(e as Error).message}`); } });
    return () => { live = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string) => db.users.find(u => u.id === id)?.name ?? "—";
  const clientOf = (id: string) => db.clients.find(c => c.id === id);
  const unassigned = db.clients.filter(c => !c.accountManagerId).length;
  const left = unassigned - (rows?.length ?? 0);

  const fill = () => {
    if (!rows?.length) return;
    setSaving(true);
    let n = 0;
    updateDb(d => {
      for (const r of rows) {
        const c = d.clients.find(x => x.id === r.clientId);
        if (c && !c.accountManagerId) { c.accountManagerId = r.userId; n++; }
      }
    });
    setSaving(false);
    toast.success(`${n} client${n !== 1 ? "s" : ""} now show who handles them`);
    onOpenChange(false);
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title="Fill in “Handled by”"
      description="For clients nobody was named on: the admin who added each one, from the activity log. Nothing changes until you press Fill in."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="btn-hero rounded-xl gap-2" disabled={!rows?.length || saving} onClick={fill}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Fill in {rows?.length ?? 0} client{rows?.length === 1 ? "" : "s"}
          </Button>
        </div>
      }>
      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" />Reading who added each client…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">{unassigned ? "The activity log doesn't show who added the clients that have nobody — name them from Edit." : "Every client already shows who handles them."}</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 overflow-hidden divide-y divide-border/60">
            {rows.map(r => (
              <div key={r.clientId} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground">{clientOf(r.clientId)?.companyName ?? r.clientId}</span>
                <span className="shrink-0 text-muted-foreground">→ <span className="text-foreground">{nameOf(r.userId)}</span></span>
              </div>
            ))}
          </div>
          {left > 0 && <p className="text-xs text-muted-foreground">{left} other client{left !== 1 ? "s" : ""} with nobody named stay as they are — the log doesn't say who added them. Name them from Edit.</p>}
        </div>
      )}
    </ActionSheet>
  );
}
