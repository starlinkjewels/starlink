import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Keep in sync with DATABASE_ID in src/lib/firebase.ts — this app uses a named
// Firestore database ("diamondflow"), not the "(default)" database.
const DATABASE_ID = "diamondflow";

const app = initializeApp();
export const db = getFirestore(app, DATABASE_ID);
