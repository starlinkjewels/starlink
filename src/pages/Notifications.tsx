import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, currentUserOrders, type Notification } from "@/lib/db";
import { filled, refLink, linkList, type Detail } from "@/components/rowDetails";
import { Bell, Info, Package, AlertCircle, Trash2, Pencil, Mail, MailOpen } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import { confirmBox } from "@/lib/confirm";

const typeIcon = (type: string) => {
  if (type === "order") return <Package className="h-4 w-4 text-primary" />;
  if (type === "alert") return <AlertCircle className="h-4 w-4 text-destructive" />;
  return <Info className="h-4 w-4 text-primary" />;
};

const typeTag = (type: string) => (
  <CellTag tone={type === "alert" ? "red" : type === "order" ? "blue" : "neutral"}>
    <span className="capitalize">{type || "info"}</span>
  </CellTag>
);

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", {
  month: "short", day: "numeric", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});

/** The date and the time, each kept whole: where a phone has no room, the
 *  time goes under the date instead of being cut off. */
function WhenCell({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <span className="text-muted-foreground tabular-nums">
      <span className="whitespace-nowrap">{d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })},</span>{" "}
      <span className="whitespace-nowrap">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
    </span>
  );
}

export function NotificationsPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(loadDb());

  useEffect(() => {
    const h = () => setDb(loadDb());
    window.addEventListener("starlink-db-updated", h);
    return () => window.removeEventListener("starlink-db-updated", h);
  }, []);

  const list = db.notifications
    .filter(n => n.userId === user!.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const unread = list.filter(n => !n.read).length;
  const total = list.length;

  const markAll = () => updateDb(d => d.notifications.forEach(n => { if (n.userId === user!.id) n.read = true; }));

  const markOne = (id: string, read = true) => updateDb(d => {
    const n = d.notifications.find(n => n.id === id);
    if (n) n.read = read;
  });

  // Gone for good once deleted — there is no bin to fetch it back from.
  const deleteOne = async (n: Notification) => {
    if (!(await confirmBox(`Delete this notification?\n\n"${n.title}" — ${when(n.createdAt)}. It is removed from your list for good; nothing it tells you about changes.`))) return;
    updateDb(d => { d.notifications = d.notifications.filter(x => x.id !== n.id); });
  };

  const clearAll = async () => {
    if (!(await confirmBox("Delete all your notifications? This cannot be undone."))) return;
    updateDb(d => { d.notifications = d.notifications.filter(n => n.userId !== user!.id); });
  };

  // The message is the point of a notification, so it wraps rather than being
  // cut off — narrower on a phone, where this column stays in view.
  const wrap = "block whitespace-normal max-md:max-w-[13rem]";
  const columns: DataColumn<Notification>[] = [
    { key: "notification", header: "Notification", always: true, sortValue: n => n.title,
      cell: n => (
        <div className="flex items-start gap-2.5">
          <div className={`h-8 w-8 rounded-lg hidden sm:grid place-items-center shrink-0 ${n.type === "alert" ? "bg-destructive/10" : "bg-primary/10"}`}>
            {typeIcon(n.type)}
          </div>
          <CellMain
            title={n.read ? <span className={wrap}>{n.title}</span> : (
              <span className={`${wrap} font-semibold`}>
                <span className="inline-block h-2 w-2 rounded-full bg-primary mr-1.5 align-middle" aria-hidden="true" />
                <span className="sr-only">Unread: </span>{n.title}
              </span>
            )}
            sub={<span className={wrap}>{n.body}</span>}
          />
        </div>
      ) },
    { key: "type", header: "Type", sortValue: n => n.type, cell: n => typeTag(n.type) },
    { key: "when", header: "When", kind: "date", sortValue: n => n.createdAt, cell: n => <WhenCell iso={n.createdAt} /> },
  ];

  // An opened notification links the orders it names — only ones this person
  // can open (a client's own, an employee's within their work).
  const notificationDetails = (n: Notification): Detail[] => {
    const words = new Set(`${n.title} ${n.body}`.split(/[^\w-]+/).filter(Boolean));
    const named = currentUserOrders(db, user!).filter(o => words.has(o.orderNumber));
    return filled([
      named.length > 0 && { label: named.length > 1 ? "Orders" : "Order", value: linkList(named.map(o => ({ key: o.id, node: refLink(`/orders/${o.id}`, o.orderNumber) }))) },
    ]);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Marking them read is the one button; clearing them all can't be
          undone, so it waits in the ⋯. The total is the table's own count. */}
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "All read"}
        secondary={unread > 0 ? { label: "Mark all read", icon: MailOpen, onClick: markAll } : null}
        menu={[
          { label: "Clear all", icon: Trash2, danger: true, hint: "Can't be undone", onSelect: clearAll, show: total > 0 },
        ]}
      />
      {/* One slim line under the title. Here its × only hides it for this
          visit, so the ask can always be found again. */}
      <PushPermissionBanner keepReachable />

      {/* A click on an unread one marks it read; read ones have nothing to open,
          so they don't look clickable. */}
      <div className="card-luxe p-3 sm:p-4">
        <DataTable
          id="notifications"
          noun="notification"
          rows={list}
          columns={columns}
          rowKey={n => n.id}
          defaultSort={{ key: "when", dir: "desc" }}
          searchText={n => `${n.title} ${n.body} ${n.type}`}
          searchPlaceholder="Search notifications"
          onRowClick={n => { if (!n.read) markOne(n.id); }}
          canClickRow={n => !n.read}
          details={notificationDetails}
          rowClassName={n => (n.read ? "opacity-75" : "bg-primary/[0.04]")}
          rowActions={n => [
            n.read
              ? { label: "Mark unread", icon: Mail, onSelect: () => markOne(n.id, false) }
              : { label: "Mark read", icon: MailOpen, onSelect: () => markOne(n.id) },
            // Written by the app itself, as a record of what happened.
            { label: "Edit", icon: Pencil, hint: "System messages can't be edited", disabled: true, onSelect: () => undefined },
            { label: "Delete", icon: Trash2, danger: true, onSelect: () => deleteOne(n) },
          ]}
          emptyText={
            <span className="inline-flex flex-col items-center">
              <Bell className="h-10 w-10 mb-3 opacity-20" />
              No notifications yet.
            </span>
          }
        />
      </div>
    </div>
  );
}
