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

/** A zip is built in the browser's memory, and a big one ran out of room ("can't
 *  construct the Blob" on a whole catalog of originals and videos). Past this
 *  many bytes the download is cut into parts — each saved, and its memory let
 *  go, before the next is gathered. */
const PART_BYTES = 300 * 1024 * 1024;
/** How many files are fetched ahead of the one being added. */
const AHEAD = 6;

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
 * doesn't take one round trip after another. A very large set is saved as
 * "Name (part 1).zip", "Name (part 2).zip"… — see PART_BYTES.
 */
export async function downloadAsZip(
  files: { url: string; filename: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
  /** Off: not written to Activity (an admin's own Catalog downloads). */
  log = true,
  /** For tests: a smaller part size. */
  partBytes = PART_BYTES,
): Promise<{ added: number; failed: string[]; parts: number }> {
  if (!exportAllowed()) return { added: 0, failed: [], parts: 0 };
  const failed: string[] = [];
  // Two photos of the same piece often arrive with the same name; the second
  // would silently replace the first inside the archive. Named up front, in
  // order, so the names don't depend on which download finishes first.
  const used = new Set<string>();
  const named = files.map((f, i) => ({ ...f, name: uniqueName(f.filename || `file-${i + 1}`, used) }));
  const base = zipName.replace(/\.zip$/i, "");

  // Fetched a few ahead of the one being added — never the whole set held at once.
  const got: (Promise<Blob | null> | undefined)[] = [];
  const fetchOne = (i: number) => {
    got[i] = (async () => {
      try {
        const res = await fetch(named[i].url);
        if (!res.ok) throw new Error(String(res.status));
        return await res.blob();
      } catch { return null; }
    })();
  };
  for (let i = 0; i < Math.min(AHEAD, named.length); i++) fetchOne(i);

  let zip = new JSZip();
  let inZip = 0, bytes = 0, added = 0, parts = 0;
  // Photos and videos are compressed already: stored as they are, which is
  // quicker and asks less memory than squeezing them again.
  const save = async (last: boolean) => {
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
    parts++;
    const multi = parts > 1 || !last;
    saveBlob(blob, multi ? `${base} (part ${parts}).zip` : `${base}.zip`);
    zip = new JSZip(); inZip = 0; bytes = 0;
  };

  for (let i = 0; i < named.length; i++) {
    if (i + AHEAD < named.length) fetchOne(i + AHEAD);
    const blob = await got[i]!;
    got[i] = undefined; // let it go once it is in the zip
    if (blob) {
      // This one would take the part past its size: the part is saved first.
      if (inZip > 0 && bytes + blob.size > partBytes) await save(false);
      zip.file(named[i].name, blob);
      inZip++; bytes += blob.size; added++;
    } else failed.push(named[i].filename);
    onProgress?.(i + 1, named.length);
  }
  if (inZip > 0) await save(true);

  if (added && log) {
    const what = parts > 1 ? `${base} in ${parts} parts` : `${base}.zip`;
    logEvent("export", `Downloaded ${added} file${added !== 1 ? "s" : ""} as ${what}`, { file: `${base}.zip`, files: added });
  }
  return { added, failed, parts };
}

/**
 * Save one file under its own name. A link to a stored file opens it in a new
 * tab instead of saving it (the browser ignores "download" on another site's
 * link), so the file is fetched and saved; if it can't be fetched, it opens.
 */
export async function downloadFile(url: string, filename: string, log = true): Promise<void> {
  if (!exportAllowed()) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    saveBlob(await res.blob(), filename);
    if (log) logEvent("export", `Downloaded ${filename}`, { file: filename, files: 1 });
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
