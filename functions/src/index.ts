// Shree Suktam Diamond — Cloud Functions, project diamondflow-35f6e, region
// asia-south1. Deployed from this branch to that project only (see SSDIAM.md).

export { sendNotificationPush } from "./notifications";
// The agent: an admin's business analyst (see aiOffice.ts).
export { aiOffice } from "./aiOffice";
// Its voice: what the owner says, and its answers spoken (see aiVoice.ts).
export { aiVoice } from "./aiVoice";
// Transactional email from the company's own Gmail account (see mail.ts).
export { sendMail } from "./mail";
// An admin changing a client's sign-in email or password (see clientLogin.ts).
export { setClientLogin } from "./clientLogin";

// A CAD designer's own login: their files, hand-in and money statement — checked here.
export { designerWork } from "./designerWork";
// Product videos made playable on every browser and device (see videoWeb.ts).
export { makeWebVideo } from "./videoWeb";
// Documents: opening a password link without signing in (see docShare.ts).
export { openDocShare } from "./docShare";
// Who someone is, on their sign-in token, for the file rules (see fileClaims.ts).
export { fileClaimsOnIndex, syncFileClaims } from "./fileClaims";
// Software health — attacks and failures watched, partners alerted (see health/).
export { healthTick, healthDigest, healthOnDelete, healthOnActivity } from "./health/watchers";
export { reportHealth, healthAction } from "./health/report";
// Backups every 6 hours, each checked; the main admin's safe restore (functions/src/backup/).
export { backupEvery6h, backupNow } from "./backup/run";
export { backupRestore } from "./backup/restore";
// Smart Pipelines — the business's own automations (Settings → Autopilot; see pipelines/).
export { pipelineOnOrder, pipelineOnClient, pipelineOnInvoice, pipelineOnAnswer, pipelineTick, pipelineTest, pipelineRunNow } from "./pipelines";

// Totals kept on the server (see summaries.ts):
//   firebase deploy --only functions:sumProd
import { makeSummaries } from "./summaries";
export const sumProd = makeSummaries("diamondflow");

// The assistant (/ai in the app), on SS Diam's own AI provider key — the
// functions secret SARVAM_API_KEY.
export { starlinkAiChat } from "./ai";

// A shared link's preview (WhatsApp, Telegram…): the piece's photo and name — Hosting sends /s/** here.
export { shareMeta, shareImage } from "./shareMeta";
