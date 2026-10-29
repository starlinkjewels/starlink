import { useMemo, useState } from "react";
import { Check, Search, Users } from "lucide-react";
import { toast } from "sonner";
import type { ChatGroup, Message, Order, User } from "@/lib/db";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { OrderThumb } from "@/components/OrderThumb";
import { createGroup, previewOf, updateGroup } from "@/lib/chat";

/** One person to tick in a list. */
function PersonRow({ u, on, onToggle, note }: { u: User; on: boolean; onToggle: () => void; note?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on}
      className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${on ? "bg-primary/10" : "hover:bg-secondary"}`}>
      <UserAvatar photo={u.photo} name={u.name} className="h-9 w-9 rounded-full text-sm shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{u.name}</span>
        <span className="block text-[11px] text-muted-foreground capitalize">{note ?? u.role}</span>
      </span>
      <span className={`h-5 w-5 rounded-full border grid place-items-center shrink-0 ${on ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
        {on && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

/** A new group — or, with `group`, its name and who is in it. */
export function GroupDialog({ open, onClose, people, me, group, onCreated }: {
  open: boolean; onClose: () => void; people: User[]; me: User; group?: ChatGroup; onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set((group?.memberIds ?? []).filter(id => id !== me.id)));
  const [q, setQ] = useState("");
  const shown = people.filter(u => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = () => {
    try {
      if (group) {
        if (picked.size < 2) throw new Error("A group needs at least two other people");
        updateGroup(group.id, { name, memberIds: [me.id, ...picked] });
        toast.success("Group updated");
      } else {
        const id = createGroup(name, [...picked], me);
        toast.success(`Group "${name.trim()}" made`);
        onCreated?.(id);
      }
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save the group"); }
  };
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? "Group" : "New group"}</DialogTitle>
          <DialogDescription>{group ? "Its name and who is in it." : "A conversation with several people — the team on one client, say."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Group name" className="h-11 rounded-xl" aria-label="Group name" autoFocus={!group} />
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find people" className="h-10 rounded-xl pl-9" aria-label="Find people" />
          </div>
          <p className="text-[11px] text-muted-foreground">{picked.size} picked · you are in it too</p>
          <div className="max-h-[45dvh] overflow-y-auto -mx-1 px-1 space-y-0.5">
            {shown.map(u => <PersonRow key={u.id} u={u} on={picked.has(u.id)} onToggle={() => toggle(u.id)} />)}
            {!shown.length && <p className="text-center text-xs text-muted-foreground py-6">Nobody by that name</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} className="btn-hero rounded-xl">{group ? "Save" : "Make the group"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A conversation to send something on to. */
export interface ConvoChoice { id: string; name: string; photo?: string; note: string; group?: boolean }

/** Forward a message to one or more conversations. */
export function ForwardDialog({ message, choices, onClose, onSend }: {
  message: Message | null; choices: ConvoChoice[]; onClose: () => void; onSend: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const shown = choices.filter(c => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Dialog open={!!message} onOpenChange={o => { if (!o) { setPicked(new Set()); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Forward to…</DialogTitle>
          <DialogDescription className="truncate">{message ? previewOf(message) : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a chat" className="h-10 rounded-xl pl-9" aria-label="Find a chat" />
          </div>
          <div className="max-h-[50dvh] overflow-y-auto -mx-1 px-1 space-y-0.5">
            {shown.map(c => (
              <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={picked.has(c.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${picked.has(c.id) ? "bg-primary/10" : "hover:bg-secondary"}`}>
                {c.group
                  ? <span className="h-9 w-9 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0"><Users className="h-4 w-4" /></span>
                  : <UserAvatar photo={c.photo} name={c.name} className="h-9 w-9 rounded-full text-sm shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{c.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{c.note}</span>
                </span>
                <span className={`h-5 w-5 rounded-full border grid place-items-center shrink-0 ${picked.has(c.id) ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                  {picked.has(c.id) && <Check className="h-3 w-3" />}
                </span>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button disabled={!picked.size} onClick={() => { onSend([...picked]); setPicked(new Set()); }} className="btn-hero rounded-xl">
            Send{picked.size > 1 ? ` to ${picked.size}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An order to share in the conversation, as a card that opens it. */
export function OrderPicker({ open, orders, clientName, onClose, onPick }: {
  open: boolean; orders: Order[]; clientName: (o: Order) => string | undefined; onClose: () => void; onPick: (o: Order) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...orders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(o => !t || [o.orderNumber, o.designNumber, o.jewelleryType, clientName(o)].some(v => (v ?? "").toLowerCase().includes(t)))
      .slice(0, 60);
  }, [orders, q, clientName]);
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share an order</DialogTitle>
          <DialogDescription>It shows as a card — a tap opens the order.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Order no., design, client…" className="h-10 rounded-xl pl-9" aria-label="Find an order" autoFocus />
          </div>
          <div className="max-h-[50dvh] overflow-y-auto -mx-1 px-1 space-y-0.5">
            {shown.map(o => (
              <button key={o.id} type="button" onClick={() => onPick(o)} className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-secondary transition">
                <OrderThumb o={o} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{o.orderNumber}{o.designNumber ? ` · ${o.designNumber}` : ""}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{[o.jewelleryType, clientName(o), o.status].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ))}
            {!shown.length && <p className="text-center text-xs text-muted-foreground py-6">No order matches</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
