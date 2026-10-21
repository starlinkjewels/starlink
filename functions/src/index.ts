// Shree Suktam Diamond — Cloud Functions, project diamondflow-35f6e, region
// asia-south1. Deployed from this branch to that project only (see SSDIAM.md).

export { sendNotificationPush } from "./notifications";
export { sendMail } from "./mail";
// An admin changing a client's sign-in email or password (see clientLogin.ts).
export { setClientLogin } from "./clientLogin";

// Totals kept on the server (see summaries.ts):
//   firebase deploy --only functions:sumProd
import { makeSummaries } from "./summaries";
export const sumProd = makeSummaries("diamondflow");

// The assistant (/ai in the app), on SS Diam's own AI provider key — the
// functions secret SARVAM_API_KEY.
export { starlinkAiChat } from "./ai";
