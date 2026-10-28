import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/**
 * Every video plays on every browser and device. An iPhone video (HEVC, often
 * a QuickTime .MOV) plays on the phone and on many computers, and not on others
 * (Firefox; Chrome on a computer without HEVC hardware). The server makes a copy
 * in H.264 MP4 — what everything plays — next to the original, as
 * "<original>.web.mp4" with the original's own download token
 * (functions/src/videoWeb.ts). Nothing in the database points to it: a player
 * tries the copy first and falls back to the original until the copy is made.
 */
export const WEB_SUFFIX = ".web.mp4";

/** The playable copy's address beside a stored video — null for anything else (a blob, another site). */
export function webVideoUrl(src: string | undefined | null): string | null {
  if (!src) return null;
  const m = src.match(/^(https?:\/\/[^/]+\/v0\/b\/[^/]+\/o\/)([^?#]+)(\?[^#]*)?$/);
  if (!m) return null;
  let path: string;
  try { path = decodeURIComponent(m[2]); } catch { return null; }
  if (path.endsWith(WEB_SUFFIX)) return null;
  return `${m[1]}${m[2]}${encodeURIComponent(WEB_SUFFIX)}${m[3] ?? ""}`;
}

/** Ask the server for the playable copy (staff only). "exists" when it is already there. */
export async function makeVideoPlayable(url: string): Promise<"made" | "exists"> {
  const call = httpsCallable<{ url: string }, { status: "made" | "exists" }>(functions, "makeWebVideo", { timeout: 600_000 });
  return (await call({ url })).data.status;
}

const asked = new Set<string>();
/** The same, in the background — once a session for a video; failures are left for Settings → Videos. */
export function requestPlayable(url: string | undefined | null): void {
  if (!url || !webVideoUrl(url) || asked.has(url)) return;
  asked.add(url);
  makeVideoPlayable(url).catch(e => console.warn("[video] not converted:", e?.message ?? e));
}

/**
 * Which address a player uses: the playable copy when there is one, else the
 * original. `failed()` is called on a playback error — it moves on to the
 * original and returns true, or returns false when nothing is left to try.
 */
export function usePlayableSrc(src: string): { src: string; failed: () => boolean; usingCopy: boolean } {
  const web = webVideoUrl(src);
  // Which video's copy failed — kept by the video, not reset in an effect: a missing
  // copy can fail before any effect runs, and resetting then put the dead copy back.
  const [copyFailedFor, setCopyFailedFor] = useState<string | null>(null);
  const useWeb = !!web && copyFailedFor !== src;
  return {
    src: useWeb ? web! : src,
    usingCopy: useWeb,
    failed: () => {
      if (useWeb) { setCopyFailedFor(src); return true; }
      return false;
    },
  };
}
