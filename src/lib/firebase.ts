// Firebase initialisation for Starlink Jewels / Diamond Flow.
//
// Uses the "diamondflow" named Firestore database (created in the Firebase
// console) rather than the project's "(default)" database — see getFirestore
// below. The web API key/config below is public by design (client SDK config);
// access is governed by Firestore/Storage security rules, not by hiding this.
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
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

export const app: FirebaseApp = initializeApp(firebaseConfig);

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
