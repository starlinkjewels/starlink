// Shree Suktam Diamond — Cloud Functions, project diamondflow-35f6e, region
// asia-south1. Deployed from this branch to that project only (see SSDIAM.md).

export { sendNotificationPush } from "./notifications";
export { sendMail } from "./mail";
// An admin changing a client's sign-in email or password (see clientLogin.ts).
export { setClientLogin } from "./clientLogin";
// Product videos made playable on every browser and device (see videoWeb.ts).
export { makeWebVideo } from "./videoWeb";
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
