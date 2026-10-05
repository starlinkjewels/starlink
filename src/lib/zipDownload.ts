import JSZip from "jszip";

/**
 * Download a set of files as one zip.
 *
 * "Download All" used to fire one save per file, so a five-photo order meant
 * five browser prompts and five loose files in Downloads — and most browsers
 * block the second and later ones as pop-ups anyway, so the client often got
 * one photo and thought the rest were missing. One archive is one prompt and
 * one folder.
 */
export async function downloadAsZip(
  files: { url: string; filename: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; failed: string[] }> {
  const zip = new JSZip();
  const failed: string[] = [];
  const used = new Set<string>();
  let added = 0;

  for (const f of files) {
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(String(res.status));
      // Two photos of the same piece often arrive with the same name; the second
      // would silently replace the first inside the archive.
      let name = f.filename || `file-${added + 1}`;
      if (used.has(name)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 2;
        while (used.has(`${stem} (${n})${ext}`)) n++;
        name = `${stem} (${n})${ext}`;
      }
      used.add(name);
      zip.file(name, await res.blob());
      added++;
    } catch {
      failed.push(f.filename);
    }
    onProgress?.(added + failed.length, files.length);
  }

  if (!added) return { added: 0, failed };

  const blob = await zip.generateAsync({ type: "blob" });
  const obj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = obj;
  a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 10000);
  return { added, failed };
}
