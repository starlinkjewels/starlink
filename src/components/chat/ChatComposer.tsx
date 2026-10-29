import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Image as ImageIcon, Loader2, Mic, Package, Paperclip, Pencil, Reply, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ChatAttachment, Message, User } from "@/lib/db";
import { editMessage, previewOf, sendMessage, uploadAttachment, uploadVoice } from "@/lib/chat";
import { playSent } from "@/lib/chatSound";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** The longest voice note. */
const VOICE_MAX_S = 5 * 60;
const pickMime = () => {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported?.(t));
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const touchFirst = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/**
 * Where a message is written: words (Enter sends on a computer; on a phone the
 * send button does, Enter is a new line), photos, the camera, a document, an
 * order, or a voice note (the mic, while there is nothing typed). A reply or an
 * edit shows what it is about above the box.
 */
export function ChatComposer({ convoId, me, replyTo, editing, nameOf, onDone, onCancel, onPickOrder }: {
  convoId: string;
  me: User;
  replyTo: Message | null;
  editing: Message | null;
  nameOf: (id: string) => string;
  /** Sent / saved: the reply or edit is over. */
  onDone: () => void;
  /** The reply or the edit dropped. */
  onCancel: () => void;
  onPickOrder: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);

  // An edit starts from the message's words.
  useEffect(() => { if (editing) { setText(editing.text); box.current?.focus(); } }, [editing]);
  useEffect(() => { if (replyTo) box.current?.focus(); }, [replyTo]);
  // A different conversation: an empty box.
  useEffect(() => { setText(""); }, [convoId]);
  // The box grows with the words, up to five lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const send = async (attachments?: ChatAttachment[]) => {
    try {
      if (editing) {
        await editMessage(editing, me.id, text);
        toast.success("Edited");
      } else {
        sendMessage(convoId, me, { text, attachments, replyTo: replyTo ?? undefined });
        playSent();
      }
      setText("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send — try again");
    }
  };

  const sendFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusy(`Sending ${list.length} file${list.length !== 1 ? "s" : ""}…`);
    try {
      const done: ChatAttachment[] = [];
      for (const [i, f] of list.entries()) {
        setBusy(`Sending ${i + 1} of ${list.length}…`);
        done.push(await uploadAttachment(f, convoId, me.id, pct => setBusy(`Sending ${i + 1} of ${list.length} · ${pct}%`)));
      }
      await send(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the file");
    } finally { setBusy(null); }
  };

  // ── Voice ──
  const [rec, setRec] = useState<{ started: number; secs: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const keep = useRef(false);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const secs = (Date.now() - rec.started) / 1000;
      setRec(r => (r ? { ...r, secs } : r));
      if (secs >= VOICE_MAX_S) stopVoice(true);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.started]);
  // Leaving mid-recording: the microphone is let go.
  useEffect(() => () => { keep.current = false; recorder.current?.stream.getTracks().forEach(t => t.stop()); }, []);

  const startVoice = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast.error("This browser can't record a voice message"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const secs = (Date.now() - started) / 1000;
        if (!keep.current || secs < 1) return;
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" });
        setBusy("Sending the voice message…");
        try { await send([await uploadVoice(blob, secs, convoId, me.id)]); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't send the voice message"); }
        finally { setBusy(null); }
      };
      const started = Date.now();
      recorder.current = r;
      r.start();
      setRec({ started, secs: 0 });
    } catch {
      toast.error("Allow the microphone to record a voice message");
    }
  };
  const stopVoice = (keepIt: boolean) => {
    keep.current = keepIt;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null;
    setRec(null);
  };

  const about = editing ?? replyTo;
  const hasText = !!text.trim();

  return (
    <div className="border-t border-border/60 shrink-0 bg-background/80 pb-[env(safe-area-inset-bottom)] md:pb-0">
      {about && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-xl bg-secondary/70 pl-3 pr-1 py-1.5 border-l-4 border-primary">
          {editing ? <Pencil className="h-3.5 w-3.5 text-primary shrink-0" /> : <Reply className="h-3.5 w-3.5 text-primary shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">{editing ? "Edit message" : about.fromUserId === me.id ? "Replying to yourself" : `Replying to ${nameOf(about.fromUserId)}`}</p>
            <p className="text-xs text-muted-foreground truncate">{previewOf(about)}</p>
          </div>
          <button type="button" onClick={() => { if (editing) setText(""); onCancel(); }} aria-label={editing ? "Stop editing" : "Don't reply"}
            className="h-8 w-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-background shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}
      {busy && <p className="mx-3 mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{busy}</p>}

      {rec ? (
        // Recording: the time, throw it away, or send it.
        <div className="p-3 flex items-center gap-3">
          <button type="button" onClick={() => stopVoice(false)} aria-label="Throw the recording away" className="h-11 w-11 rounded-xl grid place-items-center text-destructive hover:bg-destructive/10 shrink-0"><Trash2 className="h-5 w-5" /></button>
          <div className="flex-1 flex items-center gap-2 rounded-xl bg-secondary/70 h-11 px-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm tabular-nums">{mmss(rec.secs)}</span>
            <span className="text-xs text-muted-foreground truncate">Recording…</span>
          </div>
          <button type="button" onClick={() => stopVoice(true)} aria-label="Send the voice message" className="btn-hero h-11 w-11 rounded-xl grid place-items-center shrink-0"><Send className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="p-3 flex items-end gap-2">
          {!editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={!!busy} aria-label="Attach" className="h-11 w-11 rounded-xl grid place-items-center text-muted-foreground hover:bg-secondary shrink-0 disabled:opacity-50"><Paperclip className="h-5 w-5" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-48">
                <DropdownMenuItem onSelect={() => photos.current?.click()}><ImageIcon className="h-4 w-4 mr-2" />Photos</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => camera.current?.click()}><Camera className="h-4 w-4 mr-2" />Camera</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => docs.current?.click()}><FileText className="h-4 w-4 mr-2" />Document</DropdownMenuItem>
                <DropdownMenuItem onSelect={onPickOrder}><Package className="h-4 w-4 mr-2" />Order</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <textarea ref={box} value={text} rows={1} onChange={e => setText(e.target.value)} aria-label="Message"
            placeholder={editing ? "Edit the message" : "Message"}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !touchFirst() && !e.nativeEvent.isComposing) { e.preventDefault(); if (hasText) void send(); }
              if (e.key === "Escape" && about) { if (editing) setText(""); onCancel(); }
            }}
            className="flex-1 min-w-0 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-h-[8.25rem]" />
          {hasText || editing ? (
            <button type="button" onClick={() => void send()} disabled={!hasText || !!busy} aria-label={editing ? "Save the edit" : "Send"}
              className="btn-hero h-11 w-11 rounded-xl grid place-items-center shrink-0 disabled:opacity-50"><Send className="h-4 w-4" /></button>
          ) : (
            <button type="button" onClick={() => void startVoice()} disabled={!!busy} aria-label="Record a voice message"
              className="btn-hero h-11 w-11 rounded-xl grid place-items-center shrink-0 disabled:opacity-50"><Mic className="h-5 w-5" /></button>
          )}
          <input ref={photos} type="file" accept="image/*" multiple className="hidden" onChange={e => { void sendFiles(e.target.files); e.target.value = ""; }} />
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void sendFiles(e.target.files); e.target.value = ""; }} />
          <input ref={docs} type="file" multiple className="hidden" onChange={e => { void sendFiles(e.target.files); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}
