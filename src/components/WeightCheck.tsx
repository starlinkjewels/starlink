import { AlertTriangle, Scale } from "lucide-react";
import { weightProblem, weightSummary, type WeightInput } from "@/lib/weights";

/**
 * Under a set of weight fields: what is wrong with them, in red, or — when
 * they hang together — the less weight and what it is in carats. The form
 * refuses to save while the red line shows (see weightProblem).
 */
export function WeightCheck(props: WeightInput & { className?: string }) {
  const problem = weightProblem(props);
  const summary = problem ? null : weightSummary(props);
  if (!problem && !summary) return null;
  return problem ? (
    <p className={`flex items-start gap-1.5 text-[11px] text-destructive ${props.className ?? ""}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {problem}
    </p>
  ) : (
    <p className={`flex items-start gap-1.5 text-[11px] text-muted-foreground ${props.className ?? ""}`}>
      <Scale className="h-3.5 w-3.5 shrink-0 mt-px" /> {summary}
    </p>
  );
}
