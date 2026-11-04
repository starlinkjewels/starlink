// A catalogue card's word on its reading, for staff: a sheet whose details were
// read, one to check, one being read — nothing on an ordinary picture.
import type { CatalogItem } from "@/lib/db";

export function SpecsBadge({ item }: { item: CatalogItem }) {
  const s = item.specs;
  if (!s || s.status === "noTable") return null;
  if (s.pending && s.status !== "error") return null;
  const t = s.checkedBy ? { label: "Checked", cls: "bg-success text-white" }
    : s.status === "ok" ? { label: "Details", cls: "bg-success/90 text-white" }
    : s.status === "review" ? { label: "Check", cls: "bg-primary text-primary-foreground" }
    : s.status === "queued" ? { label: "Reading…", cls: "bg-black/55 text-white" }
    : { label: "Not read", cls: "bg-destructive/90 text-white" };
  return (
    <div className="absolute bottom-2 left-2 pointer-events-none">
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium shadow-sm ${t.cls}`}>{t.label}</span>
    </div>
  );
}
