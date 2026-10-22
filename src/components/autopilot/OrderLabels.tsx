import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { subscribeMarks } from "@/lib/pipelines/client";

/** The labels Autopilot has put on an order — beside its status, for our own people. */
export function OrderLabels({ orderId }: { orderId: string }) {
  const [labels, setLabels] = useState<string[]>([]);
  useEffect(() => subscribeMarks(orderId, setLabels), [orderId]);
  return (
    <>
      {labels.map(l => (
        <span key={l} title="Put on by Autopilot" className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-800 inline-flex items-center gap-1">
          <Tag className="h-3 w-3" />{l}
        </span>
      ))}
    </>
  );
}
