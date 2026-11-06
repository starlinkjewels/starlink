// The agent's voice (AI Office): "listen" — what the owner said, in Gujarati,
// Hindi, English or another Indian language (found by itself); "speak" — the
// agent's answer read aloud in a natural voice, in the answer's language.
// Admins only, like the AI Office; a day's voice calls are capped per business;
// the provider is never named to the app (lib/sarvam.ts is the only file that knows it).

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "./lib/firestoreAdmin";
import { resolveCaller } from "./lib/scope";
import { speechToText, textToSpeech } from "./lib/sarvam";
import { REGION } from "./region";

const SARVAM_API_KEY = defineSecret("SARVAM_API_KEY");
const OWNER_EMAILS = ["marketing.starlinkjewels@gmail.com", "admin@starlinkjewels.com"];
const DAILY_VOICE = 600;
/** About a minute of speech, compressed. */
const MAX_AUDIO_BYTES = 1_500_000;
/** The natural voices offered (all women's voices, by the business's choice); the first is the default. */
export const VOICES = ["priya", "neha", "ritu", "kavya", "shreya"];
const LANGS = ["en-IN", "hi-IN", "gu-IN", "mr-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "pa-IN", "od-IN"];

export interface VoiceRequest {
  action: "listen" | "speak";
  /** listen: the recording, base64, and its type (audio/webm, audio/mp4 …). */
  audio?: string;
  mime?: string;
  /** speak: what to say, its language, the voice and the pace. */
  text?: string;
  language?: string;
  voice?: string;
  pace?: number;
}

async function underCap(): Promise<void> {
  const ref = db.collection("aiUsage").doc(`voice_${new Date().toISOString().slice(0, 10)}`);
  await db.runTransaction(async tx => {
    const n = Number((await tx.get(ref)).get("calls") ?? 0);
    if (n >= DAILY_VOICE) throw new HttpsError("resource-exhausted", "Today's voice limit is reached — type instead, it starts again tomorrow.");
    tx.set(ref, { calls: n + 1, at: new Date().toISOString() }, { merge: true });
  });
}

export const aiVoice = onCall<VoiceRequest>(
  { secrets: [SARVAM_API_KEY], region: REGION, cors: true, memory: "256MiB", minInstances: 0, maxInstances: 3, timeoutSeconds: 60 },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const owner = OWNER_EMAILS.includes(String(request.auth.token?.email ?? "").toLowerCase());
    if (!owner) {
      const caller = await resolveCaller(request.auth.uid);
      if (caller.role !== "admin") throw new HttpsError("permission-denied", "The voice agent is for admins.");
    }
    const settings = await db.collection("meta").doc("settings").get();
    if (settings.exists && settings.get("aiEnabled") === false) throw new HttpsError("failed-precondition", "The agent is switched off.");
    const r = request.data ?? ({} as VoiceRequest);
    if (r.action === "listen") {
      const audio = Buffer.from(String(r.audio ?? ""), "base64");
      if (!audio.length) throw new HttpsError("invalid-argument", "Nothing was recorded.");
      if (audio.length > MAX_AUDIO_BYTES) throw new HttpsError("invalid-argument", "That was too long — speak for under a minute.");
      const mime = /^audio\/[a-z0-9.+-]+/i.exec(String(r.mime ?? ""))?.[0] ?? "audio/webm";
      await underCap();
      try {
        return await speechToText(SARVAM_API_KEY.value(), audio, mime);
      } catch (err) {
        console.error("[aiVoice] listen failed:", err);
        throw new HttpsError("internal", "Couldn't hear that — please try again.");
      }
    }
    if (r.action === "speak") {
      const text = String(r.text ?? "").trim().slice(0, 2500);
      if (!text) throw new HttpsError("invalid-argument", "Nothing to say.");
      const language = LANGS.includes(String(r.language)) ? String(r.language) : "en-IN";
      const voice = VOICES.includes(String(r.voice)) ? String(r.voice) : VOICES[0];
      const pace = Math.min(1.6, Math.max(0.7, Number(r.pace) || 1));
      await underCap();
      try {
        return { audio: await textToSpeech(SARVAM_API_KEY.value(), text, language, voice, pace), format: "mp3" };
      } catch (err) {
        console.error("[aiVoice] speak failed:", err);
        throw new HttpsError("internal", "Couldn't speak that — the answer is on screen.");
      }
    }
    throw new HttpsError("invalid-argument", "Listen or speak?");
  },
);
