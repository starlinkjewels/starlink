import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import { StatStrip } from "@/components/TableToolbar";

/**
 * Top-of-page money summary across every supplier / client / factory:
 * Receivable (to collect · ughrani), Payable (to pay · chukavni) and the Net
 * position — in the one figures strip every page uses, colour on the figure
 * only and a zero in grey. The formatter is passed in so each page uses its
 * own currency (₹ for suppliers/factories, page money for clients).
 */
/** "to collect · ughrani": the Gujarati word kept, in its own quieter span (studio.css). */
function local(sub: string) {
  const m = /^(.*?)( · (?:ughrani|chukavni))$/.exec(sub);
  return m ? <>{m[1]}<span className="ui-local">{m[2]}</span></> : sub;
}

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
    <StatStrip items={[
      { label: "Total receivable", value: fmt(receivable), tone: "in", icon: ArrowDownLeft, sub: local(receivableSub ?? "to collect · ughrani") },
      { label: "Total payable", value: fmt(payable), tone: "out", icon: ArrowUpRight, sub: local(payableSub ?? "to pay · chukavni") },
      { label: "Net", value: net === 0 ? "✓ Settled" : fmt(Math.abs(net)), tone: net > 0 ? "in" : net < 0 ? "out" : "strong", icon: Scale,
        sub: net > 0 ? "net receivable" : net < 0 ? "net payable" : "all settled" },
    ]} />
  );
}
