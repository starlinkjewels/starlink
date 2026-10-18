// Shree Suktam Diamond — Cloud Functions, project diamondflow-35f6e, region
// asia-south1. Deployed from this branch to that project only (see SSDIAM.md).

export { sendNotificationPush } from "./notifications";
export { sendMail } from "./mail";

// Totals kept on the server (see summaries.ts):
//   firebase deploy --only functions:sumProd
import { makeSummaries } from "./summaries";
export const sumProd = makeSummaries("diamondflow");

// The assistant lives in ai.ts and is deliberately not exported here.
