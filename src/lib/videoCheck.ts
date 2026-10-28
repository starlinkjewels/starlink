/**
 * Whether this browser can play a video file — asked before it is uploaded.
 * An iPhone records in "High Efficiency" (HEVC / H.265) unless set otherwise;
 * Chrome and Edge on Windows can't play that, so a product video uploaded from
 * an iPhone showed a black box at 0:00 for everyone on a computer.
 * Resolves true when a frame decodes, false when the browser refuses the file,
 * and true when it can't tell in time (never blocks an upload on a slow file).
 */
export function canPlayVideo(file: Blob, timeoutMs = 10000): Promise<boolean> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute("src"); v.load();
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.onloadeddata = () => finish(v.videoWidth > 0);
    v.onerror = () => finish(false);
    v.src = url;
  });
}

/** What to tell someone whose video won't play. */
export const UNPLAYABLE_VIDEO_HELP =
  "This video won't play in Chrome or Edge on a computer — it is most likely an iPhone \"High Efficiency\" (HEVC) video. "
  + "On the iPhone: Settings → Camera → Formats → Most Compatible, then record again; or send the video to yourself on WhatsApp and upload that copy.";
