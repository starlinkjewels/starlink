export function StatCard({ label, value, icon: Icon, colorClass }: { label: string; value: string | number; icon: any; colorClass?: string }) {
  return (
    <div className="card-luxe card-hover p-4 md:p-5 relative overflow-hidden">
      {/* subtle corner glow */}
      <div className="pointer-events-none absolute -top-8 -right-8 h-20 w-20 rounded-full bg-primary/5 blur-xl" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground truncate">{label}</p>
          <p className="font-display text-xl md:text-2xl lg:text-3xl text-brand-dark mt-2 leading-tight truncate">{value}</p>
        </div>
        <div className={`inline-flex h-11 w-11 rounded-2xl bg-gradient-to-br from-primary/12 to-brand-light/15 items-center justify-center shrink-0 ring-1 ring-primary/10 ${colorClass || "text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
