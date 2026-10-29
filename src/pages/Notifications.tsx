import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, currentUserOrders, orderImage, type Notification, type Order } from "@/lib/db";
import { filled, refLink, linkList, type Detail } from "@/components/rowDetails";
import { Bell, Info, Package, AlertCircle, Trash2, Pencil, Mail, MailOpen, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, CellMain, CellTag, type DataColumn } from "@/components/DataTable";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import { confirmBox } from "@/lib/confirm";
import { useNavigate } from "react-router-dom";

const typeIcon = (type: string) => {
  if (type === "order") return <Package className="h-4 w-4 text-primary" />;
  if (type === "alert") return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (type === "message") return <MessageSquare className="h-4 w-4 text-primary" />;
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
}).replace(/\bSept\b/, "Sep");

/** The date and the time, each kept whole: where a phone has no room, the
 *  time goes under the date instead of being cut off. */
function WhenCell({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <span className="text-muted-foreground tabular-nums">
      <span className="whitespace-nowrap">{d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }).replace(/\bSept\b/, "Sep")},</span>{" "}
      <span className="whitespace-nowrap">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
    </span>
  );
}

/** Order numbers in an alert's text ("SLJ-2026-1053"). */
const ORDER_NO = /\b[A-Z]{2,6}-\d{4}-\d{3,6}\b/g;

/**
 * Alerts that say the same thing about different orders, close together — a
 * person placing five orders in a minute — are one row: "5 new orders ·
 * SLJ-2026-1053 – 1057 · LA PASION · by Meet". Only how the list reads; every
 * alert is still there, read, unread and deleted together.
 */
interface AlertRow { id: string; items: Notification[]; title: string; body: string; type: string; read: boolean; createdAt: string }
const GROUP_WITHIN_MS = 15 * 60e3;
const PLURAL: Record<string, string> = { "New Order": "new orders", "New Order Request": "new order requests", "Timeline updated": "orders moved on" };

function numbersLine(nums: string[]): string {
  const sorted = [...new Set(nums)].sort();
  const parts = sorted.map(n => { const m = /^(.*-)(\d+)$/.exec(n); return m ? { pre: m[1], n: Number(m[2]), raw: n } : null; });
  // One run of numbers in a row — "SLJ-2026-1053 – 1057".
  if (parts.length > 2 && parts.every(Boolean) && parts.every(x => x!.pre === parts[0]!.pre) && parts.every((x, i) => i === 0 || x!.n === parts[i - 1]!.n + 1)) {
    return `${sorted[0]} – ${parts[parts.length - 1]!.n}`;
  }
  return sorted.length > 4 ? `${sorted.slice(0, 3).join(", ")} +${sorted.length - 3}` : sorted.join(", ");
}

function groupAlerts(list: Notification[]): AlertRow[] {
  const rows: AlertRow[] = [];
  const keyOf = (n: Notification) => `${n.type}|${n.title}|${n.body.replace(ORDER_NO, "#")}`;
  for (const n of list) {
    const last = rows[rows.length - 1];
    const lastN = last?.items[last.items.length - 1];
    const same = last && lastN && (n.body.match(ORDER_NO)?.length ?? 0) > 0 && keyOf(lastN) === keyOf(n)
      && Math.abs(+new Date(last.createdAt) - +new Date(n.createdAt)) <= GROUP_WITHIN_MS;
    if (same) last.items.push(n);
    else rows.push({ id: n.id, items: [n], title: n.title, body: n.body, type: n.type, read: n.read, createdAt: n.createdAt });
  }
  for (const r of rows) {
    if (r.items.length < 2) continue;
    const nums = r.items.flatMap(n => n.body.match(ORDER_NO) ?? []);
    const rest = r.items[0].body.replace(ORDER_NO, "").replace(/^[\s·:,-]+/, "").trim();
    r.title = `${r.items.length} ${PLURAL[r.title] ?? `× ${r.title}`}`;
    r.body = [numbersLine(nums), rest].filter(Boolean).join(" · ");
    r.read = r.items.every(n => n.read);
    r.id = r.items.map(n => n.id).join("+");
  }
  return rows;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const rows = groupAlerts(list);
  // The orders an alert names, that this person can open — for its photo and its links.
  const myOrders = currentUserOrders(db, user!);
  const ordersIn = (r: AlertRow): Order[] => {
    const words = new Set(r.items.flatMap(n => `${n.title} ${n.body}`.split(/[^\w-]+/).filter(Boolean)));
    return myOrders.filter(o => words.has(o.orderNumber));
  };

  const markAll = () => updateDb(d => d.notifications.forEach(n => { if (n.userId === user!.id) n.read = true; }));

  const markRow = (r: AlertRow, read = true) => updateDb(d => {
    const ids = new Set(r.items.map(n => n.id));
    d.notifications.forEach(n => { if (ids.has(n.id)) n.read = read; });
  });

  // Gone for good once deleted — there is no bin to fetch it back from.
  const deleteRow = async (r: AlertRow) => {
    const what = r.items.length > 1 ? `these ${r.items.length} notifications` : "this notification";
    if (!(await confirmBox(`Delete ${what}?\n\n"${r.title}" — ${when(r.createdAt)}. Removed from your list for good; nothing it tells you about changes.`))) return;
    const ids = new Set(r.items.map(n => n.id));
    updateDb(d => { d.notifications = d.notifications.filter(x => !ids.has(x.id)); });
  };

  const clearAll = async () => {
    if (!(await confirmBox("Delete all your notifications? This cannot be undone."))) return;
    updateDb(d => { d.notifications = d.notifications.filter(n => n.userId !== user!.id); });
  };

  // The message is the point of a notification, so it wraps rather than being
  // cut off — narrower on a phone, where this column stays in view.
  const wrap = "block whitespace-normal max-md:max-w-[13rem]";
  const columns: DataColumn<AlertRow>[] = [
    { key: "notification", header: "Notification", always: true, sortValue: n => n.title,
      cell: n => {
        // The order's own photo when the alert is about one; else its kind.
        const img = ordersIn(n).map(o => orderImage(o)).find(Boolean);
        return (
        <div className="flex items-start gap-2.5">
          {img ? (
            // The middle of the photo, filling the box: an order's picture is
            // often a wide CAD sheet, and shrunk whole it reads as a blank square.
            <div className="relative h-12 w-12 rounded-lg overflow-hidden bg-white ring-1 ring-border/60 shrink-0">
              <img src={img} alt="" loading="lazy" className="h-full w-full object-cover scale-125" />
              {n.items.length > 1 && <span className="absolute bottom-0 right-0 min-w-[1.1rem] h-[1.1rem] px-1 rounded-tl-md bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center">{n.items.length}</span>}
            </div>
          ) : (
            <div className={`h-8 w-8 rounded-lg hidden sm:grid place-items-center shrink-0 ${n.type === "alert" ? "bg-destructive/10" : "bg-primary/10"}`}>
              {typeIcon(n.type)}
            </div>
          )}
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
        );
      } },
    { key: "type", header: "Type", sortValue: n => n.type, cell: n => typeTag(n.type) },
    { key: "when", header: "When", kind: "date", sortValue: n => n.createdAt, cell: n => <WhenCell iso={n.createdAt} /> },
  ];

  // An opened notification links the orders it names — only ones this person
  // can open (a client's own, an employee's within their work).
  const notificationDetails = (n: AlertRow): Detail[] => {
    const named = ordersIn(n);
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
          rows={rows}
          columns={columns}
          rowKey={n => n.id}
          defaultSort={{ key: "when", dir: "desc" }}
          searchText={n => `${n.title} ${n.body} ${n.type} ${n.items.map(x => x.body).join(" ")}`}
          searchPlaceholder="Search notifications"
          // A tap reads it — and opens its order when it names exactly one.
          onRowClick={n => { if (!n.read) markRow(n); const o = ordersIn(n); if (o.length === 1) navigate(`/orders/${o[0].id}`); }}
          canClickRow={n => !n.read || ordersIn(n).length === 1}
          details={notificationDetails}
          rowClassName={n => (n.read ? "opacity-75" : "bg-primary/[0.04]")}
          rowActions={n => [
            n.read
              ? { label: "Mark unread", icon: Mail, onSelect: () => markRow(n, false) }
              : { label: "Mark read", icon: MailOpen, onSelect: () => markRow(n) },
            // Written by the app itself, as a record of what happened.
            { label: "Edit", icon: Pencil, hint: "System messages can't be edited", disabled: true, onSelect: () => undefined },
            { label: n.items.length > 1 ? `Delete all ${n.items.length}` : "Delete", icon: Trash2, danger: true, onSelect: () => deleteRow(n) },
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
