const MAP: Record<string, string> = {
  Waiting: "bg-warning/15 text-warning-foreground border-warning/30",
  Approved: "bg-brand-light/15 text-brand-dark border-brand-light/30",
  Rejected: "bg-destructive/15 text-destructive border-destructive/30",
  "In Production": "bg-primary/15 text-primary border-primary/30",
  Ready: "bg-accent/15 text-accent-foreground border-accent/30",
  Dispatched: "bg-brand-light/20 text-brand-dark border-brand-light/40",
  Delivered: "bg-success/15 text-success border-success/30",
  active: "bg-success/15 text-success border-success/30",
  inactive: "bg-muted text-muted-foreground border-border",
};
export function StatusBadge({ status }: { status: string }) {
  const cls = MAP[status] || "bg-secondary text-secondary-foreground border-border";
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border ${cls} whitespace-nowrap`}>{status}</span>;
}
