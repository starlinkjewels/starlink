import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { confirmBox } from "@/lib/confirm";
import { fmtDate, updateDb, type Order } from "@/lib/db";
import { cadReviewNow, cadState, recordCadReview } from "@/lib/cadApproval";

/**
 * The client's word on the CAD design, on the order's CAD card (lib/cadApproval.ts).
 * The client: Approve design / Ask for changes. Staff: where it stands, and — when the client
 * said yes by phone or WhatsApp — Record their approval. Nothing shows without a CAD image.
 */
export function CadApprovalBox({ order, stageDone, mayRecord }: {
  order: Order;
  /** The CAD stage is already complete: the answer is shown, no longer asked for. */
  stageDone: boolean;
  /** Staff who may move this order's stages may record the client's approval for them. */
  mayRecord: boolean;
}) {
  const { user } = useAuth();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const state = cadState(order);
  if (state === "none") return null;
  const review = cadReviewNow(order);
  const isClient = user?.role === "client";
  const me = { id: user!.id, name: user!.name };

  const answer = async (status: "approved" | "changes", onBehalf = false) => {
    if (status === "changes" && !note.trim()) { toast.error("Say what should change"); return; }
    if (status === "approved" && !(await confirmBox(onBehalf
      ? "Record the client's approval of this design?\n\nUse this when they said yes by phone, WhatsApp or in person. It is kept with your name."
      : "Approve this design?\n\nProduction is made from it. For any change, choose Ask for changes instead."))) return;
    let ok = false;
    updateDb(d => { ok = recordCadReview(d, order.id, { status, note: status === "changes" ? note : undefined, image: order.cadImage!, by: me, onBehalf }); });
    if (!ok) { toast.error("The design was changed meanwhile — look at the new one"); return; }
    setAsking(false); setNote("");
    toast.success(status === "approved" ? (onBehalf ? "Approval recorded for the client" : "Design approved — thank you") : "Sent — we'll update the design");
  };

  const line = review?.status === "approved"
    ? { icon: CheckCircle2, cls: "text-success", text: `Approved${review.onBehalf ? ` for the client by ${review.byName}` : isClient ? " by you" : ` by ${review.byName}`} on ${fmtDate(review.at)}` }
    : review?.status === "changes"
      ? { icon: MessageSquareWarning, cls: "text-destructive", text: `Changes asked${isClient ? "" : ` by ${review.byName}`} on ${fmtDate(review.at)}${review.note ? `: “${review.note}”` : ""}` }
      : { icon: Clock, cls: "text-amber-700", text: isClient ? "Waiting for your approval" : "Waiting for the client's approval" };
  const Icon = line.icon;
  const open = !stageDone && state !== "approved";

  return (
    <div className="rounded-xl border border-border/70 bg-secondary/30 p-3 space-y-2" role="region" aria-label="Design approval">
      <p className={`text-sm font-medium flex items-start gap-2 ${line.cls}`}><Icon className="h-4 w-4 mt-0.5 shrink-0" />{line.text}</p>
      {open && isClient && !asking && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => answer("approved")} className="btn-hero rounded-xl h-10 gap-1.5"><CheckCircle2 className="h-4 w-4" />Approve design</Button>
          <Button variant="outline" onClick={() => setAsking(true)} className="rounded-xl h-10">Ask for changes</Button>
        </div>
      )}
      {open && isClient && asking && (
        <div className="space-y-2">
          <Label htmlFor="cad-changes" className="text-xs">What should change?</Label>
          <Textarea id="cad-changes" value={note} onChange={e => setNote(e.target.value)} rows={3} className="rounded-xl" placeholder="e.g. a thinner band, the centre stone a little higher" />
          <div className="flex gap-2">
            <Button onClick={() => answer("changes")} className="rounded-xl h-10">Send</Button>
            <Button variant="outline" onClick={() => { setAsking(false); setNote(""); }} className="rounded-xl h-10">Cancel</Button>
          </div>
        </div>
      )}
      {open && !isClient && mayRecord && (
        <Button variant="outline" size="sm" onClick={() => answer("approved", true)} className="rounded-xl h-8 text-xs">Record the client's approval</Button>
      )}
    </div>
  );
}
