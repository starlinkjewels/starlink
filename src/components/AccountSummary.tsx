import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

/**
 * Top-of-page money summary: three premium cards showing the grand total across
 * every supplier / client / factory — Receivable (to collect · ughrani), Payable
 * (to pay · chukavni), and the Net position. The formatter is passed in so each
 * page uses its own currency (₹ for suppliers/factories, page money for clients).
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
  const netTone = net > 0 ? "blue" : net < 0 ? "red" : "green";

  const cards: {
    key: string; label: string; value: string; sub: string;
    icon: typeof Scale; accent: string; chip: string; bar: string;
  }[] = [
    {
      key: "rec", label: "Total Receivable", value: fmt(receivable),
      sub: receivableSub ?? "to collect · ughrani", icon: ArrowDownLeft,
      accent: "text-blue-600", chip: "bg-blue-500/10 text-blue-600", bar: "bg-blue-500",
    },
    {
      key: "pay", label: "Total Payable", value: fmt(payable),
      sub: payableSub ?? "to pay · chukavni", icon: ArrowUpRight,
      accent: "text-destructive", chip: "bg-destructive/10 text-destructive", bar: "bg-destructive",
    },
    {
      key: "net", label: "Net", value: net === 0 ? "✓ Settled" : fmt(Math.abs(net)),
      sub: net > 0 ? "net receivable" : net < 0 ? "net payable" : "all settled", icon: Scale,
      accent: netTone === "blue" ? "text-blue-600" : netTone === "red" ? "text-destructive" : "text-success",
      chip: netTone === "blue" ? "bg-blue-500/10 text-blue-600" : netTone === "red" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
      bar: netTone === "blue" ? "bg-blue-500" : netTone === "red" ? "bg-destructive" : "bg-success",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
      {cards.map(({ icon: Icon, ...c }) => (
        <div
          key={c.key}
          className="relative overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm transition-shadow hover:shadow-md p-3 pl-4 sm:p-5 sm:pl-6"
        >
          <span className={`absolute left-0 top-0 h-full w-1 ${c.bar}`} aria-hidden="true" />
          <div className="flex items-center gap-2">
            <span className={`h-7 w-7 sm:h-9 sm:w-9 rounded-xl grid place-items-center shrink-0 ${c.chip}`}>
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </span>
            <span className="text-[9.5px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground truncate">{c.label}</span>
          </div>
          <p className={`mt-2 sm:mt-3 font-display text-lg sm:text-3xl leading-none tabular-nums ${c.accent}`}>{c.value}</p>
          <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1.5 truncate">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
