// The OCR engine (tesseract, open source, on our own server): one per server
// instance — a task at a time — started on the first picture.
import path from "path";
import { createWorker, type Worker } from "tesseract.js";

let worker: Promise<Worker> | null = null;
export function engine(): Promise<Worker> {
  if (!worker) {
    const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
    worker = createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none" }).catch(e => { worker = null; throw e; });
  }
  return worker;
}

export async function stopEngine(): Promise<void> {
  if (worker) { const w = await worker.catch(() => null); worker = null; await w?.terminate(); }
}
