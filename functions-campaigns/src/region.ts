// What differs between the two apps — the SS Diam branch sets its own here
// (asia-south1, ssdiam.web.app, its brand, its mailbox and its owner), as
// functions-etsy/src/region.ts and functions/src/pipelines/config.ts do.
export const REGION = "asia-south1";
export const APP_URL = "https://ssdiam.web.app";
export const BRAND = { name: "Shree Suktam Diamond", logo: "/brand-logo-wide.png" };
/** The mailbox every email of this app goes out from (functions/src/mail.ts) — campaigns too. */
export const SMTP_USER = "harshil@ssdiam.in";
/**
 * Campaign emails a day. The mailbox's own limit (a Google Workspace account ≈ 2,000)
 * is shared with order emails and Autopilot, so campaigns keep well under it and
 * carry on the next day. The admin may change it in Campaigns → Settings, never past MAX.
 */
export const DEFAULT_DAILY_BUDGET = 1000;
export const MAX_DAILY_BUDGET = 1600;
/** Owners: always admins, whatever the role index says. */
export const OWNER_EMAILS = ["online@ssdiam.in"];
