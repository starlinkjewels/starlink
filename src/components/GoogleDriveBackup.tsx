import { useCallback, useEffect, useState } from "react";
import {
  driveConfigured, driveStatus, connectDrive, disconnectDrive, backupToDrive,
  setDriveFrequency, listDriveBackups, driveOrigin, type Frequency, type DriveBackup,
} from "@/lib/googleDrive";
import { updateDb } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardDrive, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const LABELS: Record<Frequency, string> = {
  off: "Off", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year",
};

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * A second copy of the backup, somewhere else.
 *
 * The daily snapshot already goes to Firebase Storage, but that sits in the
 * same Google project as the data it is protecting. This connects a Drive
 * account and puts a copy there too, which is the part that makes it a backup
 * rather than a second filing cabinet in the same room.
 */
export function GoogleDriveBackup() {
  const [status, setStatus] = useState(driveStatus);
  const [files, setFiles] = useState<DriveBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [idDraft, setIdDraft] = useState("");

  /** Store the client id, then go straight into the Google account picker —
   *  saving it is not the goal, connecting is. */
  const saveClientId = async () => {
    const id = idDraft.trim();
    if (!id.endsWith(".apps.googleusercontent.com")) {
      toast.error("That does not look like a client ID — it should end in .apps.googleusercontent.com");
      return;
    }
    updateDb(d => { d.settings.googleClientId = id; });
    setBusy(true);
    try {
      const email = await connectDrive();
      setStatus(driveStatus());
      toast.success(`Connected to ${email}`);
      await refreshFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Saved, but Google did not connect — check the origin matches.");
      setStatus(driveStatus());
    } finally { setBusy(false); }
  };

  const refreshFiles = useCallback(async () => {
    if (!driveStatus().connected) { setFiles(null); return; }
    try { setFiles(await listDriveBackups()); } catch { setFiles(null); }
  }, []);

  useEffect(() => { void refreshFiles(); }, [refreshFiles]);

  // Google will not let any app touch a Drive without a client id of its own,
  // and only the account holder can make one. Rather than a dead end saying so,
  // this walks through it: the three links in order, the origin to paste
  // already filled in, and a box for the id. One go, about five minutes, once
  // ever — and no redeploy, because it is kept in settings.
  if (!driveConfigured()) {
    return (
      <div className="rounded-xl border border-border/70 p-4 mt-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-secondary text-muted-foreground grid place-items-center shrink-0"><HardDrive className="h-4 w-4" /></div>
          <div>
            <h3 className="font-semibold text-brand-dark text-sm">Google Drive Backup</h3>
            <p className="text-[11px] text-muted-foreground">
              Keep a second copy of everything in a Google Drive account. Google needs a one-time
              setup first — about five minutes, and only once.
            </p>
          </div>
        </div>

        <ol className="mt-3 space-y-2 text-[11px] text-muted-foreground list-decimal pl-4">
          <li>
            Turn on the Drive API for your Google project —{" "}
            <a className="text-primary hover:underline inline-flex items-center gap-0.5" target="_blank" rel="noreferrer"
              href="https://console.cloud.google.com/apis/library/drive.googleapis.com">
              open it <ExternalLink className="h-3 w-3" />
            </a>{" "}
            and press <span className="font-medium text-foreground">Enable</span>.
          </li>
          <li>
            On the{" "}
            <a className="text-primary hover:underline inline-flex items-center gap-0.5" target="_blank" rel="noreferrer"
              href="https://console.cloud.google.com/apis/credentials/consent">
              consent screen <ExternalLink className="h-3 w-3" />
            </a>{" "}
            add only the scope <code className="font-mono text-foreground">.../auth/drive.file</code> — that one
            lets this app see nothing in the Drive except the files it creates itself.
          </li>
          <li>
            Create an{" "}
            <a className="text-primary hover:underline inline-flex items-center gap-0.5" target="_blank" rel="noreferrer"
              href="https://console.cloud.google.com/apis/credentials/oauthclient">
              OAuth client ID <ExternalLink className="h-3 w-3" />
            </a>{" "}
            of type <span className="font-medium text-foreground">Web application</span>, and under
            <span className="font-medium text-foreground"> Authorised JavaScript origins</span> paste this exactly:
            <span className="mt-1 flex items-center gap-1.5">
              <code className="font-mono text-foreground bg-secondary rounded px-1.5 py-0.5 select-all">{driveOrigin()}</code>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(driveOrigin()); toast.success("Copied"); }}
                className="text-primary hover:underline">copy</button>
            </span>
          </li>
          <li>Paste the client ID it gives you below.</li>
        </ol>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Input value={idDraft} onChange={e => setIdDraft(e.target.value)}
            className="rounded-xl h-10 flex-1 min-w-[260px] font-mono text-xs"
            placeholder="1234567890-abc123.apps.googleusercontent.com" />
          <AsyncButton onClick={saveClientId} disabled={busy} className="btn-hero rounded-xl h-10">Save &amp; Connect</AsyncButton>
        </div>
      </div>
    );
  }

  const connect = async () => {
    setBusy(true);
    try {
      const email = await connectDrive();
      setStatus(driveStatus());
      toast.success(`Connected to ${email}`);
      await refreshFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't connect to Google Drive");
    } finally { setBusy(false); }
  };

  const disconnect = () => {
    if (!confirm("Disconnect Google Drive?\n\nBackups already in Drive stay where they are — only the connection is removed.")) return;
    disconnectDrive();
    setStatus(driveStatus());
    setFiles(null);
    toast.success("Google Drive disconnected");
  };

  const backupNow = async () => {
    setBusy(true);
    try {
      const name = await backupToDrive(true);
      setStatus(driveStatus());
      toast.success(`Backed up to Drive — ${name}`);
      await refreshFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't back up to Drive");
    } finally { setBusy(false); }
  };

  const changeFrequency = (f: Frequency) => {
    setDriveFrequency(f);
    setStatus(driveStatus());
  };

  return (
    <div className="rounded-xl border border-border/70 p-4 mt-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${status.connected ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-brand-dark text-sm">Google Drive Backup</h3>
            <p className="text-[11px] text-muted-foreground">
              {status.connected
                ? <>Connected to <span className="font-medium text-foreground">{status.email}</span>{status.lastAt ? ` · last backup ${new Date(status.lastAt).toLocaleString()}` : " · no backup yet"}</>
                : "A second copy of the whole database, kept outside this project."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status.connected && (
            <AsyncButton variant="outline" onClick={backupNow} disabled={busy} className="rounded-lg gap-1.5">
              <HardDrive className="h-3.5 w-3.5" /> {busy ? "Working…" : "Back up now"}
            </AsyncButton>
          )}
          {status.connected
            ? <Button variant="outline" onClick={disconnect} className="rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive">Disconnect</Button>
            : <AsyncButton onClick={connect} disabled={busy} className="btn-hero rounded-lg gap-1.5">
                <HardDrive className="h-3.5 w-3.5" /> {busy ? "Connecting…" : "Connect Google Drive"}
              </AsyncButton>}
        </div>
      </div>

      {status.connected && (
        <>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Back up automatically</span>
            <Select value={status.frequency} onValueChange={v => changeFrequency(v as Frequency)}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(LABELS) as Frequency[]).map(f => (
                  <SelectItem key={f} value={f}>{LABELS[f]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            The backup runs when an admin opens the app and one is due, so it needs someone to open it
            at least that often. Google only keeps permission for about an hour at a time; if it has
            lapsed, pressing <span className="font-medium text-foreground">Back up now</span> here renews it.
            The app can only ever see files it put in Drive itself, never anything else in the account.
          </p>

          {files && files.length > 0 && (
            <div className="mt-3 space-y-1.5 max-h-56 overflow-y-auto">
              {files.map(f => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{new Date(f.createdTime).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{mb(f.size)}</p>
                  </div>
                  <a href={`https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}
          {files && files.length === 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">Nothing in Drive yet — press Back up now.</p>
          )}
        </>
      )}
    </div>
  );
}
