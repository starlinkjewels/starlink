// Firebase initialisation for Starlink Jewels / Diamond Flow.
//
// Uses the "diamondflow" named Firestore database (created in the Firebase
// console) rather than the project's "(default)" database — see getFirestore
// below. The web API key/config below is public by design (client SDK config);
// access is governed by Firestore/Storage security rules, not by hiding this.
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence, waitForPendingWrites, connectFirestoreEmulator, type Firestore,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator, type FirebaseStorage } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator, type Functions } from "firebase/functions";
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";
import {
  getAuth, createUserWithEmailAndPassword, signOut, connectAuthEmulator, type Auth,
} from "firebase/auth";

/**
 * LOCAL TEST MODE — only `VITE_EMULATORS=1` with the dev server (never a built
 * app: import.meta.env.DEV is false there). The app then talks to the Firebase
 * emulators on this computer under the offline "demo-starlink" project, so no
 * request can reach the live project or its data.
 */
export const EMULATORS = !!import.meta.env?.DEV && import.meta.env?.VITE_EMULATORS === "1";

const firebaseConfig = EMULATORS ? {
  apiKey: "demo-key",
  authDomain: "demo-starlink.firebaseapp.com",
  projectId: "demo-starlink",
  storageBucket: "demo-starlink.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
} : {
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

/** The assistant (/ai): the name it goes by in this app, and whether it is on. */
export const AI_NAME = "Starlink AI";
export const AI_ENABLED = true;

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
 * It is OFF, deliberately. With the key below Google's reCAPTCHA refused to
 * issue a token on these sites ("AppCheck: ReCAPTCHA error" on every start,
 * production included), so no request ever carried an App Check token: it
 * protected nothing, filled the console with errors, and made sign-in wait on
 * failed attempts — opening offline most of all.
 *
 * TO TURN IT ON PROPERLY
 *  1. Google reCAPTCHA admin console → this site key → Domains: add every
 *     address the app is served from (the production domain(s) and
 *     ssdiamdemo.web.app). Or create a new reCAPTCHA v3 key with them.
 *  2. Firebase Console → App Check → Apps → this web app → reCAPTCHA v3 with
 *     that key (and its secret).
 *  3. Build with VITE_APP_CHECK=on (and VITE_RECAPTCHA_SITE_KEY if the key is
 *     new), deploy, and confirm App Check → Metrics shows verified requests.
 *  4. Only then: App Check → APIs → set Firestore, Storage and Functions to
 *     "Enforced". Enforcing before step 3 shows verified traffic would lock
 *     every user out.
 */
// reCAPTCHA v3 SITE key (public — safe to commit). Overridable via env var.
const RECAPTCHA_SITE_KEY =
  (import.meta.env?.VITE_RECAPTCHA_SITE_KEY as string | undefined)
  || "6Le2pFwtAAAAALa3qinV6qPapcFGgYiSgp1VeP1Z";
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
  if (EMULATORS) {
    // VITE_EMU_CACHE=1: the device cache on, as on a phone — for testing opening from it.
    deviceCacheOn = import.meta.env.VITE_EMU_CACHE === "1" && typeof indexedDB !== "undefined";
    const f = deviceCacheOn
      ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, DATABASE_ID)
      : getFirestore(app, DATABASE_ID);
    connectFirestoreEmulator(f, "127.0.0.1", 8085);
    return f;
  }
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

// Cloud Functions callables (e.g. Starlink AI) — region must match where the
// functions are deployed (see functions/src/index.ts).
export const functions: Functions = getFunctions(app, "us-central1");

if (EMULATORS) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

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
    if (EMULATORS) connectAuthEmulator(secondaryAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth).catch(() => { /* ignore */ });
    return cred.user.uid;
  } finally {
    await deleteApp(secondary).catch(() => { /* ignore */ });
  }
}
