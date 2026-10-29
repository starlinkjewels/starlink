import { MessageCircle } from "lucide-react";

/** Digits a dialler and WhatsApp take: "+91 98250 12345" → "919825012345". */
const dial = (p: string) => p.replace(/[^\d+]/g, "");

/**
 * A phone number one taps to call, with WhatsApp beside it — the two ways
 * people actually reach a client or a supplier. "—" when there is none.
 */
export function PhoneLink({ phone, className = "" }: { phone?: string | null; className?: string }) {
  const p = (phone ?? "").trim();
  if (!p) return <span className={className}>—</span>;
  const wa = dial(p).replace(/^\+/, "");
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <a href={`tel:${dial(p)}`} className="hover:text-primary hover:underline truncate">{p}</a>
      {wa.length >= 8 && (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${p}`} title="WhatsApp"
          className="shrink-0 inline-grid place-items-center h-6 w-6 rounded-full bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20">
          <MessageCircle className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}

/** An email address one taps to write to. "—" when there is none. */
export function EmailLink({ email, className = "" }: { email?: string | null; className?: string }) {
  const e = (email ?? "").trim();
  if (!e) return <span className={className}>—</span>;
  return <a href={`mailto:${e}`} title={e} className={`hover:text-primary hover:underline truncate ${className}`}>{e}</a>;
}
