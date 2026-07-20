// Firebase initialisation for Starlink Jewels / Diamond Flow.
//
// Uses the "diamondflow" named Firestore database (created in the Firebase
// console) rather than the project's "(default)" database — see getFirestore
// below. The web API key/config below is public by design (client SDK config);
// access is governed by Firestore/Storage security rules, not by hiding this.
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
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
export const DATABASE_ID = "diamondflow";

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

export const firebaseConfigPublic = firebaseConfig;

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
