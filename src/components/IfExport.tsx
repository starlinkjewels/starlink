import type { ReactNode } from "react";
import { useMayExport } from "@/hooks/useCan";
import type { ModuleKey } from "@/lib/modules";

/**
 * Shows a download or print button only to someone who may use it — the
 * page's section unless another is named. The downloads themselves still
 * refuse anyone else (lib/access.ts); this keeps them from being offered.
 */
export function IfExport({ module, children }: { module?: ModuleKey; children: ReactNode }) {
  return useMayExport(module) ? <>{children}</> : null;
}
