import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { app } from "./lib/firestoreAdmin";
import { resolveCaller } from "./lib/scope";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require("ffmpeg-static");

const REGION = "us-central1";

/** Where the app keeps videos — nothing outside these folders is ever read or written. */
const FOLDERS = /^(orders|readyStock|catalog|productPhotos|cad)\//;
/** The copy sits next to the original under this suffix (the app reads it by the same name). */
const WEB_SUFFIX = ".web.mp4";
const MAX_MB = 300;

/**
 * A product video in a form every browser and device plays: H.264 video with
 * AAC sound in an MP4 that starts playing before it has all downloaded.
 *
 * An iPhone records in HEVC (and in a QuickTime .MOV) — fine on the phone and
 * on many computers, a black box or "can't play" on others (Firefox, Chrome on
 * a computer without HEVC hardware). The original stays exactly as uploaded;
 * the playable copy is written next to it as "<original>.web.mp4" with the
 * original's own download token, so the app finds it by name and anyone who
 * could open the original can open the copy. Nothing in the database changes.
 *
 * Staff only. Only this app's own bucket, only the app's video folders.
 */
export const makeWebVideo = onCall(
  { region: REGION, memory: "2GiB", cpu: 2, timeoutSeconds: 540, maxInstances: 3, concurrency: 1 },
  async req => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const caller = await resolveCaller(req.auth.uid);
    if (caller.role !== "admin" && caller.role !== "employee") throw new HttpsError("permission-denied", "Staff only.");

    const url = String((req.data as { url?: unknown })?.url ?? "");
    const m = url.match(/^https?:\/\/[^/]+\/v0\/b\/([^/]+)\/o\/([^?]+)/);
    if (!m) throw new HttpsError("invalid-argument", "Not a stored video.");
    const [, bucketName, encPath] = m;
    // This project's own storage only (either name a project's default bucket goes by).
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
    if (!project || ![`${project}.firebasestorage.app`, `${project}.appspot.com`].includes(bucketName)) {
      throw new HttpsError("permission-denied", "Only this app's own files.");
    }
    const bucket = getStorage(app).bucket(bucketName);
    const path = decodeURIComponent(encPath);
    if (!FOLDERS.test(path) || path.endsWith(WEB_SUFFIX) || path.includes("..")) throw new HttpsError("invalid-argument", "Not one of the app's videos.");

    const dest = bucket.file(path + WEB_SUFFIX);
    const src0 = bucket.file(path);
    const [[exists], [srcExists]] = await Promise.all([dest.exists(), src0.exists()]);
    if (exists) return { status: "exists" };
    if (!srcExists) throw new HttpsError("not-found", "The video is not there any more.");
    const [meta] = await src0.getMetadata();
    // Exactly the version whose size and type were checked — not one swapped in since.
    const src = bucket.file(path, { generation: meta.generation });
    if (!String(meta.contentType ?? "").startsWith("video/") && !/\.(mp4|mov|m4v|webm|3gp|avi|mkv)$/i.test(path)) {
      throw new HttpsError("invalid-argument", "Not a video.");
    }
    if (Number(meta.size ?? 0) > MAX_MB * 1024 * 1024) throw new HttpsError("failed-precondition", `Videos over ${MAX_MB} MB are left as they are.`);
    // The original's own token(s): whoever could open the original can open the copy.
    const tokens = String((meta.metadata as Record<string, unknown> | undefined)?.firebaseStorageDownloadTokens ?? "");
    if (!tokens) throw new HttpsError("failed-precondition", "The original has no download link.");

    const work = await fs.mkdtemp(join(tmpdir(), "vid-"));
    const inFile = join(work, "in"), outFile = join(work, "out.mp4");
    try {
      await src.download({ destination: inFile });
      await run(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        // The file is read as a video and nothing else: no playlists, no links to
        // other files or addresses (a file posing as a video could ask for them).
        "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska", "-probesize", "50M",
        "-i", inFile,
        "-map", "0:v:0", "-map", "0:a:0?", "-dn", "-sn",
        // Ten minutes at most, 60 frames a second at most.
        "-t", "600", "-fpsmax", "60",
        // At most 1920 on the long side, even sizes; the phone's rotation applied.
        "-vf", "scale='if(gt(iw,ih),min(1920,trunc(iw/2)*2),-2)':'if(gt(iw,ih),-2,min(1920,trunc(ih/2)*2))',format=yuv420p",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-movflags", "+faststart",
        outFile,
      ]);
      try {
        await bucket.upload(outFile, {
          destination: dest,
          // Only ever a new file: if anything is already there, it is left exactly as it is.
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: "video/mp4",
            cacheControl: meta.cacheControl || "public, max-age=31536000",
            metadata: { firebaseStorageDownloadTokens: tokens, webCopyOf: path },
          },
        });
      } catch (e) {
        if ((e as { code?: number })?.code === 412) return { status: "exists" };
        throw e;
      }
      const out = await fs.stat(outFile);
      return { status: "made", bytes: out.size };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error("[makeWebVideo]", path, e);
      throw new HttpsError("internal", "This video could not be converted.");
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  },
);

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    // Never past the function's own time: a stuck conversion is stopped, not left running.
    const kill = setTimeout(() => p.kill("SIGKILL"), 480_000);
    p.on("close", () => clearTimeout(kill));
    let err = "";
    p.stderr.on("data", d => { err = (err + d.toString()).slice(-4000); });
    p.on("error", reject);
    p.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
}
