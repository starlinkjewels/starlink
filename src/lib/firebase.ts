// Firebase initialisation for Shree Suktam Diamond (SS Diam).
//
// ⚠️  THIS BRANCH (ssdiamdemo) IS SS DIAM'S LIVE APP — its own company, its own
//     Firebase project (diamondflow-35f6e). Nothing here may point at Starlink
//     Jewels' project (starlinkjewels109), which is served from main.
//
// Everything this build uses is SS Diam's own: Firestore database
// "diamondflow" (asia-south1), the project's Storage bucket, its Auth users and
// its Cloud Functions (deployed from this branch, region asia-south1).
//
// Uses a named Firestore database rather than the project's "(default)"
// database — see getFirestore below. The web API key/config below is public by
// design (client SDK config); access is governed by Firestore/Storage security
// rules, not by hiding this.
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence, waitForPendingWrites, type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";
import {
  getAuth, createUserWithEmailAndPassword, signOut, type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA1Dz2AQD64atmV4WP20rBvNL6IH3tNG4A",
  authDomain: "diamondflow-35f6e.firebaseapp.com",
  projectId: "diamondflow-35f6e",
  storageBucket: "diamondflow-35f6e.firebasestorage.app",
  messagingSenderId: "619733591596",
  appId: "1:619733591596:web:d8564b89b8bf8b795e1389",
  measurementId: "G-RMFL67RF9V",
};

/** The Firestore named database id this app reads/writes. */
export const DATABASE_ID = "diamondflow";

/** The demo-only tools (sample data in Settings) — off: this is a live business. */
export const IS_DEMO = false;

/**
 * The assistant (/ai). On: it runs in this project's starlinkAiChat function
 * on SS Diam's own AI provider key (secret SARVAM_API_KEY) — see SSDIAM.md.
 */
export const AI_ENABLED = true;

/** The name the assistant goes by in this app. */
export const AI_NAME = "Assistant";

/** Uploads go straight into this project's own bucket — no folder prefix. */
export const STORAGE_PREFIX = "";

/** The region every Cloud Function of this project runs in (next to the database). */
export const FUNCTIONS_REGION = "asia-south1";

/**
 * Admin accounts, identified by their Firebase Auth email. Anyone signing in
 * with one of these emails is treated as the admin (full access).
 *
 * ⚠️ KEEP THIS IN SYNC with the `isOwner()` allowlist in firestore.rules, the
 *    `isAdmin()` one in storage.rules and OWNER_EMAILS in functions/src/summaries.ts.
 */
export const ADMIN_EMAILS = [
  "online@ssdiam.in",
].map(e => e.toLowerCase());

export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export const app: FirebaseApp = initializeApp(firebaseConfig);

/**
 * App Check — makes Firebase reject any request that doesn't come from THIS app,
 * so a copied config can't be used from a script/Postman/other site. This is the
 * real protection for a public client config (the config itself is not secret).
 *
 * It is OFF, deliberately. With the key below Google's reCAPTCHA refused to
 * issue a token on these sites ("AppCheck: ReCAPTCHA error" on every start,
 * production included), so no request ever carried an App Check token: it
 * protected nothing, filled the console with errors, and made sign-in wait on
 * failed attempts — opening offline most of all.
 *
 * TO TURN IT ON PROPERLY
 *  1. Create a reCAPTCHA v3 key for SS Diam with every address the app is
 *     served from (ssdiam.web.app and any custom domain).
 *  2. Firebase Console → App Check → Apps → this web app → reCAPTCHA v3 with
 *     that key (and its secret).
 *  3. Build with VITE_APP_CHECK=on (and VITE_RECAPTCHA_SITE_KEY if the key is
 *     new), deploy, and confirm App Check → Metrics shows verified requests.
 *  4. Only then: App Check → APIs → set Firestore, Storage and Functions to
 *     "Enforced". Enforcing before step 3 shows verified traffic would lock
 *     every user out.
 */
// reCAPTCHA v3 SITE key — SS Diam has none yet, so it comes only from the env var.
const RECAPTCHA_SITE_KEY =
  (import.meta.env?.VITE_RECAPTCHA_SITE_KEY as string | undefined) || "";
const APP_CHECK_ON = (import.meta.env?.VITE_APP_CHECK as string | undefined) === "on";
if (APP_CHECK_ON && RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("[firebase] App Check init failed:", e);
  }
}

/**
 * The device keeps a copy of what it has downloaded (IndexedDB, shared by every
 * open tab), so opening the app again soon after fetches only what changed
 * instead of everything. db.ts still waits for the server's answer before it
 * shows or saves anything — see serverFirst() there — so a saved copy is never
 * edited and written back over newer work.
 *
 * Where the browser cannot keep one (private windows, some in-app browsers) it
 * runs from memory exactly as before. On a device where it ever misbehaves,
 * localStorage "sl-no-device-cache" = "1" turns it off for that device.
 */
let deviceCacheOn = false;
/** Whether this device keeps a saved copy of the data between opens. */
export function deviceCacheActive(): boolean { return deviceCacheOn; }
function makeFirestore(): Firestore {
  let off = false;
  try { off = typeof localStorage !== "undefined" && localStorage.getItem("sl-no-device-cache") === "1"; } catch { /* no storage */ }
  if (!off && typeof indexedDB !== "undefined") {
    try {
      // initializeFirestore(app, settings, databaseId) targets the named database instead of "(default)".
      const f = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, DATABASE_ID);
      deviceCacheOn = true;
      return f;
    } catch (e) {
      console.warn("[firebase] device cache unavailable — running from memory:", e);
    }
  }
  return getFirestore(app, DATABASE_ID);
}
export const db: Firestore = makeFirestore();

/**
 * Wipe this device's copy — at sign-out, so the next person on a shared
 * computer finds none of the last one's data in the browser. Waits briefly for
 * saves still on their way up. The Firestore instance cannot be used after
 * this, so the caller reloads the page.
 */
export async function clearDeviceCache(): Promise<boolean> {
  // The role remembered for opening offline goes with it, and the note of which lists it holds.
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("sl-scope:") || k === "sl-synced") localStorage.removeItem(k); } catch { /* no storage */ }
  if (!deviceCacheOn) return false;
  try { await Promise.race([waitForPendingWrites(db), new Promise(r => setTimeout(r, 4000))]); } catch { /* offline — nothing to wait for */ }
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) {
    // Another tab still holding it: that tab clears it as it signs out too.
    console.warn("[firebase] could not clear the device cache:", e);
  }
  return true;
}

export const storage: FirebaseStorage = getStorage(app);

// Firebase Authentication — every user (admin, employee, client) signs in here.
export const auth: Auth = getAuth(app);

// Cloud Functions callables (mail, server totals) — region must match where the
// functions are deployed (see functions/src/index.ts).
export const functions: Functions = getFunctions(app, FUNCTIONS_REGION);

export const firebaseConfigPublic = firebaseConfig;

// Messaging isn't available in every browser/context (e.g. no service worker
// support, some privacy modes) — isSupported() must be checked before use
// rather than assuming getMessaging() will succeed everywhere.
let messagingInstance: Messaging | null | undefined;
export async function getMessagingIfSupported(): Promise<Messaging | null> {
  if (messagingInstance !== undefined) return messagingInstance;
  try {
    messagingInstance = (await isMessagingSupported()) ? getMessaging(app) : null;
  } catch {
    messagingInstance = null;
  }
  return messagingInstance;
}

/**
 * Create a Firebase Auth account WITHOUT disrupting the current (admin) session.
 *
 * `createUserWithEmailAndPassword` signs in as the new user on whichever Auth
 * instance runs it — so we run it on a throwaway *secondary* app, then discard
 * it. The primary `auth` session (the admin) is untouched. Returns the new uid.
 */
export async function createAuthUser(email: string, password: string): Promise<string> {
  const secondary = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth).catch(() => { /* ignore */ });
    return cred.user.uid;
  } finally {
    await deleteApp(secondary).catch(() => { /* ignore */ });
  }
}
