// Firebase initialisation for Starlink Jewels / Diamond Flow.
//
// ⚠️  DEMO BRANCH (ssdiamdemo) — NOT PRODUCTION.
//
// This branch exists to show the app to a prospective client without touching
// the live business. It shares the Firebase PROJECT with production, because
// that project already hosts several apps as separate named databases, but it
// reads and writes its own database and its own Storage folder. Production
// data is never read and never written from here.
//
// What is shared, and why it is safe:
//   • Firestore — NOT shared. "ssdiamdemo", its own database, its own rules.
//   • Storage   — same bucket, but every demo file goes under STORAGE_PREFIX,
//                  so nothing lands in a folder production reads.
//   • Auth      — shared user pool. A demo login is a real auth account; the
//                  app's own user records live in the demo database, so the
//                  live app never sees them.
//   • Functions — shared and DEPLOYED FROM MAIN ONLY. They are bound to the
//                  production database by name, so anything here that would
//                  call one is switched off instead (see IS_DEMO). Deploying
//                  functions from this branch would overwrite production's.
//
// Uses a named Firestore database (created in the Firebase console) rather
// than the project's "(default)" database — see getFirestore below. The web API key/config below is public by design (client SDK config);
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
  apiKey: "AIzaSyBse5vfsARbl8k6ub9Mir6qs-CsPdaNuGU",
  authDomain: "starlinkjewels109.firebaseapp.com",
  projectId: "starlinkjewels109",
  storageBucket: "starlinkjewels109.firebasestorage.app",
  messagingSenderId: "192385163202",
  appId: "1:192385163202:web:6499e21aa7c34cd9e7c05b",
  measurementId: "G-FFTQZDHDDM",
};

/** The Firestore named database id this app reads/writes. */
export const DATABASE_ID = "ssdiamdemo";

/**
 * This build is the demo, not the live business.
 *
 * Read by anything that would otherwise reach a shared, production-bound
 * resource — chiefly the Cloud Functions, which are deployed from main and
 * talk to the production database whatever this build points at.
 */
export const IS_DEMO = true;

/**
 * Every file this build uploads goes under this folder.
 *
 * The Storage bucket is shared with production, so without a prefix a demo
 * photo would land beside a real one and be indistinguishable later. With it,
 * the demo's files are one folder that can be deleted whole when the demo is
 * over, and nothing production reads is ever written to.
 */
export const STORAGE_PREFIX = "ssdiamdemo";

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
const RECAPTCHA_SITE_KEY =
  (import.meta.env?.VITE_RECAPTCHA_SITE_KEY as string | undefined)
  || "6Le2pFwtAAAAALa3qinV6qPapcFGgYiSgp1VeP1Z";
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

// Cloud Functions callables (e.g. Starlink AI) — region must match where the
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
