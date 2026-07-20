export function StatCard({ label, value, icon: Icon, colorClass }: { label: string; value: string | number; icon: any; colorClass?: string }) {
  return (
    <div className="card-luxe p-4 md:p-5 relative overflow-hidden">
      <div className={`inline-flex h-10 w-10 rounded-xl bg-secondary items-center justify-center ${colorClass || "text-primary"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs text-muted-foreground mt-3">{label}</p>
      <p className="font-display text-lg md:text-2xl lg:text-3xl text-brand-dark mt-1 leading-tight truncate">{value}</p>
    </div>
  );
}
