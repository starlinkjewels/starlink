/**
 * Asking before something that cannot easily be taken back — in the app's own
 * dialog, not the browser's grey box. Awaited where window.confirm() was
 * called:   if (!(await confirmBox("Delete client?"))) return;
 *
 * The question is written the way the browser's was: a first line that asks,
 * then the details after a blank line. The first line becomes the title; a
 * question that starts with Delete, Remove, Cancel and the like gets a red
 * button. ConfirmHost (components/ConfirmHost.tsx) shows them, one at a time.
 */
export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
export interface ConfirmRequest {
  id: number;
  title: string;
  body: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let queue: ConfirmRequest[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

export function subscribeConfirm(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function currentConfirm(): ConfirmRequest | null { return queue[0] ?? null; }
function emit() { for (const fn of listeners) fn(); }

const DANGER = /^(delete|remove|cancel|reject|reverse|disconnect|stop|undo|clear|void|discard|melt)\b/i;
/** The button that does it, named after what it does: "Delete client?" → "Delete". */
function verbOf(title: string): string | null {
  const m = title.trim().match(/^(delete|remove|reject|reverse|disconnect|stop|undo|move|mark|put|re-open|reopen|make|create|apply|dispatch|send|open|restore|merge|reload|replace|repair|rebuild|record|save|use)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

export function confirmBox(message: string | string[], opts: ConfirmOptions = {}): Promise<boolean> {
  const text = (Array.isArray(message) ? message.join("\n") : message).trim();
  // A short first paragraph is the question; the rest is what it means.
  const [first, ...rest] = text.split(/\n\s*\n/);
  const short = first.length <= 120 && !first.includes("\n");
  const title = opts.title ?? (short ? first : "Are you sure?");
  const body = opts.title ? text : short ? rest.join("\n\n") : text;
  const cancelFirst = /^cancel\b/i.test(title);
  const danger = opts.danger ?? DANGER.test(title);
  const confirmText = opts.confirmText ?? (cancelFirst ? "Yes, cancel it" : verbOf(title) ?? "Yes, continue");
  const cancelText = opts.cancelText ?? (cancelFirst ? "Keep it" : "Cancel");
  const id = nextId++;
  return new Promise<boolean>(resolve => {
    queue = [...queue, {
      id, title, body, confirmText, cancelText, danger,
      resolve: ok => { queue = queue.filter(q => q.id !== id); emit(); resolve(ok); },
    }];
    emit();
  });
}
