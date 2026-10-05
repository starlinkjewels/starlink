import { useCallback, useEffect, useState } from "react";
import {
  driveConfigured, driveStatus, connectDrive, disconnectDrive, backupToDrive,
  setDriveFrequency, listDriveBackups, type Frequency, type DriveBackup,
} from "@/lib/googleDrive";
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

  const refreshFiles = useCallback(async () => {
    if (!driveStatus().connected) { setFiles(null); return; }
    try { setFiles(await listDriveBackups()); } catch { setFiles(null); }
  }, []);

  useEffect(() => { void refreshFiles(); }, [refreshFiles]);

  if (!driveConfigured()) {
    return (
      <div className="rounded-xl border border-border/70 p-4 mt-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-secondary text-muted-foreground grid place-items-center shrink-0"><HardDrive className="h-4 w-4" /></div>
          <div>
            <h3 className="font-semibold text-brand-dark text-sm">Google Drive Backup</h3>
            <p className="text-[11px] text-muted-foreground">
              Not set up yet — a Google OAuth client id is needed before this can be connected.
            </p>
          </div>
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
