import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

/**
 * Top-of-page money summary: three cards showing the grand total across every
 * supplier / client / factory — Receivable (to collect · ughrani), Payable
 * (to pay · chukavni), and the Net position. The formatter is passed in so
 * each page uses its own currency (₹ for suppliers/factories, page money for
 * clients).
 */
export function AccountSummary({
  receivable,
  payable,
  fmt,
  receivableSub,
  payableSub,
}: {
  receivable: number;
  payable: number;
  fmt: (n: number) => string;
  receivableSub?: string;
  payableSub?: string;
}) {
  const net = Math.round((receivable - payable) * 100) / 100;
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {/* Receivable — money owed TO us */}
      <div className="card-luxe p-3 sm:p-4 flex flex-col gap-1 bg-blue-500/5 border border-blue-500/15">
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
          <ArrowDownLeft className="h-3.5 w-3.5 text-blue-600 shrink-0" />
          <span className="truncate">Total Receivable</span>
        </div>
        <p className="text-sm sm:text-xl font-semibold text-blue-600 leading-tight">{fmt(receivable)}</p>
        <p className="text-[10px] text-muted-foreground truncate">{receivableSub ?? "to collect · ughrani"}</p>
      </div>

      {/* Payable — money we owe */}
      <div className="card-luxe p-3 sm:p-4 flex flex-col gap-1 bg-destructive/5 border border-destructive/15">
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
          <ArrowUpRight className="h-3.5 w-3.5 text-destructive shrink-0" />
          <span className="truncate">Total Payable</span>
        </div>
        <p className="text-sm sm:text-xl font-semibold text-destructive leading-tight">{fmt(payable)}</p>
        <p className="text-[10px] text-muted-foreground truncate">{payableSub ?? "to pay · chukavni"}</p>
      </div>

      {/* Net position */}
      <div className="card-luxe p-3 sm:p-4 flex flex-col gap-1 bg-secondary border border-border/60">
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
          <Scale className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Net</span>
        </div>
        <p className={`text-sm sm:text-xl font-semibold leading-tight ${net > 0 ? "text-blue-600" : net < 0 ? "text-destructive" : "text-success"}`}>
          {net === 0 ? "✓ Settled" : fmt(Math.abs(net))}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">
          {net > 0 ? "net receivable" : net < 0 ? "net payable" : "all settled"}
        </p>
      </div>
    </div>
  );
}
