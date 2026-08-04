// Firebase initialisation for Flenix Jewels / Diamond Flow.
//
// Uses the "diamondflowdemo" named Firestore database (created in the Firebase
// console) rather than the project's "(default)" database — see getFirestore
// below. The web API key/config below is public by design (client SDK config);
// access is governed by Firestore/Storage security rules, not by hiding this.
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";
import {
  getAuth, createUserWithEmailAndPassword, signOut, type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCOkXybrDQX9TLbHs9fyLvrKLt5XWAIgwI",
  authDomain: "flenix-jewels.firebaseapp.com",
  projectId: "flenix-jewels",
  storageBucket: "flenix-jewels.firebasestorage.app",
  messagingSenderId: "758181914278",
  appId: "1:758181914278:web:cb951281b928920a2cf667",
  measurementId: "G-4CN8M7YR2P",
};

/** The Firestore named database id this app reads/writes. */
export const DATABASE_ID = "diamondflowdemo";

/**
 * Admin accounts, identified by their Firebase Auth email. Anyone signing in
 * with one of these emails is treated as the admin (full access).
 *
 * ⚠️ KEEP THIS IN SYNC with the `isAdmin()` allowlist in firestore.rules — both
 *    must list the same email(s), or the admin will be blocked by the rules.
 */
export const ADMIN_EMAILS = [
  "marketing.starlinkjewels@gmail.com",
  "admin@starlinkjewels.com",
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
 * SETUP (then it activates automatically):
 *  1. Firebase Console → App Check → Apps → register this web app with
 *     reCAPTCHA v3, and copy the reCAPTCHA v3 **site key**.
 *  2. Paste it below (or set VITE_RECAPTCHA_SITE_KEY in the build env).
 *  3. App Check → APIs → set Firestore & Storage to "Enforced".
 * Left empty, App Check stays OFF and nothing changes.
 */
// reCAPTCHA v3 SITE key (public — safe to commit). Overridable via env var.
// Demo (flenix-jewels): App Check is OFF unless a reCAPTCHA key for THIS project
// is provided via VITE_RECAPTCHA_SITE_KEY (the old key was bound to another project).
const RECAPTCHA_SITE_KEY =
  (import.meta.env?.VITE_RECAPTCHA_SITE_KEY as string | undefined)
  || "";
if (RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("[firebase] App Check init failed:", e);
  }
}

// getFirestore(app, databaseId) targets the named database instead of "(default)".
export const db: Firestore = getFirestore(app, DATABASE_ID);

export const storage: FirebaseStorage = getStorage(app);

// Firebase Authentication — every user (admin, employee, client) signs in here.
export const auth: Auth = getAuth(app);

// Cloud Functions callables (e.g. Flenix AI) — region must match where the
// functions are deployed (see functions/src/index.ts).
export const functions: Functions = getFunctions(app, "us-central1");

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
