import { useEffect, useState } from "react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { worksOnClient, type Order } from "@/lib/db";
import { changeOrderClient, clientChangeBlocker } from "@/lib/orderAdmin";

/** Move an order to the right client — for a wrong pick on New Order, while nothing is billed or paid on it. */
export function ChangeClientSheet({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useDb();
  const { user } = useAuth();
  const [clientId, setClientId] = useState(order.clientId);
  useEffect(() => { if (open) setClientId(order.clientId); }, [open, order.clientId]);
  const clients = db.clients
    .filter(c => c.id === order.clientId || (c.status !== "inactive" && worksOnClient(db, user!, c)))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
  const why = clientChangeBlocker(db, order);
  const now = db.clients.find(c => c.id === order.clientId)?.companyName ?? "—";
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title="Change client" description={`${order.orderNumber} is now for ${now}.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="btn-hero rounded-xl" disabled={!!why || clientId === order.clientId}
            onClick={() => { if (changeOrderClient(order.id, clientId)) onOpenChange(false); }}>Move to this client</Button>
        </div>
      }>
      {why ? (
        <p className="text-sm text-amber-700">{why}</p>
      ) : (
        <div className="space-y-2">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-11 rounded-xl" aria-label="Client"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}{c.id === order.clientId ? " · now" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Nothing is billed or paid on it yet, so only the order moves. It is billed by the new client&rsquo;s company.</p>
        </div>
      )}
    </ActionSheet>
  );
}
