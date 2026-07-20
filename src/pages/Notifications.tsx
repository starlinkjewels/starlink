import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb } from "@/lib/db";
import { Bell, Info, Package, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";

const PAGE_SIZE = 15;

const typeIcon = (type: string) => {
  if (type === "order") return <Package className="h-5 w-5 text-primary" />;
  if (type === "alert") return <AlertCircle className="h-5 w-5 text-destructive" />;
  return <Info className="h-5 w-5 text-primary" />;
};

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

  const { paged, page, setPage, totalPages, total, start, end } = usePagination(list, PAGE_SIZE);

  const markAll = () => updateDb(d => d.notifications.forEach(n => { if (n.userId === user!.id) n.read = true; }));

  const markOne = (id: string) => updateDb(d => {
    const n = d.notifications.find(n => n.id === id);
    if (n) n.read = true;
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unread} unread · {total} total</p>
        </div>
        {unread > 0 && (
          <Button variant="outline" onClick={markAll} className="rounded-xl">Mark all read</Button>
        )}
      </div>

      <div className="space-y-2">
        {total === 0 && (
          <div className="card-luxe p-12 text-center text-muted-foreground">
            <Bell className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>No notifications yet.</p>
          </div>
        )}

        {paged.map(n => (
          <div
            key={n.id}
            onClick={() => !n.read && markOne(n.id)}
            className={`card-luxe p-4 flex items-start gap-3 transition-all
              ${!n.read ? "border-l-4 border-l-primary cursor-pointer hover:bg-secondary/40" : "opacity-75"}`}
          >
            <div className={`h-10 w-10 rounded-xl grid place-items-center shrink-0
              ${n.type === "alert" ? "bg-destructive/10" : "bg-primary/10"}`}>
              {typeIcon(n.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm">{n.title}</p>
                {!n.read && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-1.5">
                {new Date(n.createdAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        label={`Showing ${start + 1}–${end} of ${total}`}
      />
    </div>
  );
}
