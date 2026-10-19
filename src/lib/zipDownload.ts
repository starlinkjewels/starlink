import JSZip from "jszip";
import { logEvent } from "./db";
import { exportAllowed } from "./access";

/** A name used once already gets " (2)", " (3)"… before its extension. */
function uniqueName(name: string, used: Set<string>): string {
  let out = name;
  if (used.has(out)) {
    const dot = name.lastIndexOf(".");
    const slash = name.lastIndexOf("/");
    const hasExt = dot > slash + 1;
    const stem = hasExt ? name.slice(0, dot) : name;
    const ext = hasExt ? name.slice(dot) : "";
    let n = 2;
    while (used.has(`${stem} (${n})${ext}`)) n++;
    out = `${stem} (${n})${ext}`;
  }
  used.add(out);
  return out;
}

function saveBlob(blob: Blob, filename: string) {
  const obj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = obj;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 10000);
}

/**
 * Download a set of files as one zip.
 *
 * "Download All" used to fire one save per file, so a five-photo order meant
 * five browser prompts and five loose files in Downloads — and most browsers
 * block the second and later ones as pop-ups anyway, so the client often got
 * one photo and thought the rest were missing. One archive is one prompt and
 * one folder.
 *
 * A filename may carry a path ("Rings/Bands/ring.jpg") — it becomes a folder
 * inside the zip. A few files are fetched at a time, so a folder of hundreds
 * doesn't take one round trip after another.
 */
export async function downloadAsZip(
  files: { url: string; filename: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; failed: string[] }> {
  if (!exportAllowed()) return { added: 0, failed: [] };
  const zip = new JSZip();
  const failed: string[] = [];
  // Two photos of the same piece often arrive with the same name; the second
  // would silently replace the first inside the archive. Named up front, in
  // order, so the names don't depend on which download finishes first.
  const used = new Set<string>();
  const named = files.map((f, i) => ({ ...f, name: uniqueName(f.filename || `file-${i + 1}`, used) }));
  let added = 0;
  let next = 0;

  const worker = async () => {
    while (next < named.length) {
      const f = named[next++];
      try {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(String(res.status));
        zip.file(f.name, await res.blob());
        added++;
      } catch {
        failed.push(f.filename);
      }
      onProgress?.(added + failed.length, named.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, named.length) }, worker));

  if (!added) return { added: 0, failed };

  const blob = await zip.generateAsync({ type: "blob" });
  const filename = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
  logEvent("export", `Downloaded ${added} file${added !== 1 ? "s" : ""} as ${filename}`, { file: filename, files: added });
  saveBlob(blob, filename);
  return { added, failed };
}

/**
 * Save one file under its own name. A link to a stored file opens it in a new
 * tab instead of saving it (the browser ignores "download" on another site's
 * link), so the file is fetched and saved; if it can't be fetched, it opens.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  if (!exportAllowed()) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    saveBlob(await res.blob(), filename);
    logEvent("export", `Downloaded ${filename}`, { file: filename, files: 1 });
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
