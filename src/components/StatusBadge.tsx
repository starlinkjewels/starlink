/**
 * An order's (or a person's) status, the same on every page: a soft pill in
 * the status's own colour with a dot, never broken across lines.
 */
const TONE: Record<string, { pill: string; dot: string }> = {
  Waiting: { pill: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  Approved: { pill: "bg-sky-50 text-sky-800 ring-sky-600/20", dot: "bg-sky-500" },
  Rejected: { pill: "bg-rose-50 text-rose-700 ring-rose-600/20", dot: "bg-rose-500" },
  "In Production": { pill: "bg-violet-50 text-violet-800 ring-violet-600/20", dot: "bg-violet-500" },
  Ready: { pill: "bg-teal-50 text-teal-800 ring-teal-600/20", dot: "bg-teal-500" },
  Dispatched: { pill: "bg-blue-50 text-blue-800 ring-blue-600/20", dot: "bg-blue-500" },
  Delivered: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  active: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  inactive: { pill: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
};
const OTHER = { pill: "bg-slate-50 text-slate-700 ring-slate-500/20", dot: "bg-slate-400" };

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const t = TONE[status] ?? OTHER;
  // "active" / "inactive" are stored in lower case; shown as words.
  const text = status === "active" ? "Active" : status === "inactive" ? "Inactive" : status;
  return (
    <span title={text} className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap min-w-0 max-w-full ${t.pill} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${t.dot}`} aria-hidden /><span className="truncate">{text}</span>
    </span>
  );
}
