// Sales of our own built pieces made as separate orders (before a build was
// sold on itself) — shown to the admin on the Orders page, and moved onto
// their builds in one go: each build becomes the client's order (same number,
// photos, CAD), with the sale's client, price, payments, invoice and dispatch;
// the separate order is closed (lib/stockSale.ts mergeShelfSale).
import { useMemo, useState } from "react";
import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { useDb } from "@/hooks/useDb";
import { useLoaded } from "@/hooks/useLoaded";
import { fmtMoney, updateDbAs, findInvoiceForOrder } from "@/lib/db";
import { confirmBox } from "@/lib/confirm";
import { whoOf } from "@/lib/readyStockHistory";
import { mergeShelfSale, SALE_REPAIR_COLS, shelfSaleDuplicates } from "@/lib/stockSale";
import { recordsReady, STILL_LOADING } from "@/lib/actionHints";
import type { User } from "@/lib/db";

export function ShelfSaleMerge({ user }: { user: Pick<User, "id" | "name" | "role"> }) {
  const db = useDb();
  // The payment entries that name a sale are moved with it — read before anything is.
  const ready = useLoaded(["lockerTransactions"]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => shelfSaleDuplicates(db), [db]);
  const movable = rows.filter(r => !r.reason);
  // Only while there is something to move: a sale of part of a build is how it should be, not a thing to fix.
  if (user.role !== "admin" || !movable.length) return null;
  const client = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "—";

  const merge = async () => {
    // Everything that names a sale is moved with it — so all of it must be here, fresh from the server.
    if (!ready || !(await recordsReady(SALE_REPAIR_COLS))) { toast.error(STILL_LOADING); return; }
    if (!(await confirmBox([
      `Move ${movable.length} sale${movable.length !== 1 ? "s" : ""} onto the pieces' own orders?`,
      "",
      "Each piece's own order (the one it was made on) becomes the client's order — the same number, photos and CAD — with the sale's client, price, payments, invoice and dispatch. The separate sale order is closed and marked as moved. Nothing is added to or taken from Ready Stock: the pieces were sold already.",
      "",
      ...movable.slice(0, 25).map(r => `• ${r.sale.orderNumber} → ${r.build!.orderNumber} · ${client(r.sale.clientId)} · ${fmtMoney(r.sale.amount)}`),
      ...(movable.length > 25 ? [`• …and ${movable.length - 25} more`] : []),
    ].join("\n"), { confirmText: "Move them" }))) return;
    setBusy(true);
    let moved = 0;
    const who = whoOf(user);
    try {
      updateDbAs({ summary: `Moved ${movable.length} Ready Stock sale${movable.length !== 1 ? "s" : ""} onto their own build orders (${movable.map(r => `${r.sale.orderNumber}→${r.build!.orderNumber}`).join(", ")})` }, d => {
        for (const r of movable) if (mergeShelfSale(d, r.sale.id, who)) moved++;
      });
      if (moved) toast.success(`${moved} sale${moved !== 1 ? "s" : ""} moved onto their own orders`);
      if (moved < movable.length) toast.warning(`${movable.length - moved} changed meanwhile and stayed as they were — open this again to see why.`);
      if (moved === movable.length) setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error && e.name === "StaleDataError" ? "Still getting the latest — try again in a moment" : "Nothing was moved — try again");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <GitMerge className="h-4 w-4 text-primary shrink-0" />
        <p className="flex-1 min-w-0">
          <span className="font-semibold">{movable.length} Ready Stock sale{movable.length !== 1 ? "s were" : " was"} made as separate orders.</span>{" "}
          They can go onto the pieces' own orders — the same number, photos and CAD.
        </p>
        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setOpen(true)}>Review</Button>
      </div>
      <ActionSheet open={open} onOpenChange={setOpen} icon={GitMerge} size="lg" title="Sales made as separate orders"
        description="Each piece we built has its own order. Its sale goes onto that order; the separate one is closed."
        footer={<div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={() => void merge()} disabled={busy || !movable.length || !ready}>{busy ? "Moving…" : `Move ${movable.length}`}</Button>
        </div>}>
        <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-white">
          {rows.map(r => {
            const inv = findInvoiceForOrder(db.invoices ?? [], r.sale.id);
            return (
              <li key={r.sale.id} className="px-3.5 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{r.sale.orderNumber}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold">{r.build?.orderNumber ?? "—"}</span>
                  <span className="text-muted-foreground">· {r.item?.name ?? r.sale.jewelleryType} · {client(r.sale.clientId)} · {fmtMoney(r.sale.amount)}{inv ? ` · invoice ${inv.number}` : ""} · {r.sale.status}</span>
                </div>
                {r.reason && <p className="text-xs text-destructive mt-0.5">Stays as it is: {r.reason}</p>}
              </li>
            );
          })}
        </ul>
      </ActionSheet>
    </>
  );
}
