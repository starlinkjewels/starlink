# `ssdiamdemo` — Shree Suktam Diamond (SS Diam)

**Live at https://ssdiam.web.app** (the old address https://diamondflow-35f6e.web.app forwards to it)

This branch is **Shree Suktam Diamond's live app**: a separate company, with a
separate Firebase project. Starlink Jewels is `main`, on its own project.
The two never share data, logins, files, functions or mail.

| | SS Diam (this branch) | Starlink Jewels (`main`) |
|---|---|---|
| Firebase project | `diamondflow-35f6e` | `starlinkjewels109` |
| Firestore database | `diamondflow` (asia-south1) | `diamondflow` (nam5) |
| Functions region | `asia-south1` | `us-central1` |
| Hosting | Firebase Hosting site `ssdiam` (`diamondflow-35f6e` only forwards) | Vercel |
| Admin (owner) | `online@ssdiam.in` | Starlink's own |
| Mail | `sendMail` function, sent from `harshil@ssdiam.in` | Starlink's mail service |
| Assistant (AI) | `starlinkAiChat`, SS Diam's own Sarvam key (secret) | Starlink's own key |

## Rules

1. **Never merge this branch into `main`, and never deploy it to `starlinkjewels109`.**
   `.firebaserc` here names `diamondflow-35f6e`. Before any `firebase` command, run
   `firebase login:list` and check that the account is SS Diam's.
2. **Bring features across with `git merge main`.** Then keep this branch's own
   versions of `src/lib/firebase.ts`, `src/sw.ts`, `firebase.json`, `.firebaserc`,
   the rules files, `functions/src/index.ts`, `functions/src/summaries.ts`
   (owner email and region), `src/lib/email.ts`, and the brand (logo files, colours
   in `src/styles.css`, names).
3. **Secrets are never committed.** The mailbox's app password is the functions
   secret `SMTP_PASSWORD`: `firebase functions:secrets:set SMTP_PASSWORD`.

## Deploy (from this branch)

```
npm run build                                   # the web app
firebase deploy --only firestore                # rules + indexes of "diamondflow"
firebase deploy --only storage                  # storage rules
firebase deploy --only functions                # sendMail, sendNotificationPush, sumProd, starlinkAiChat
firebase deploy --only hosting
```

## Switched off for now

- (The assistant (/ai) is ON since 2026-10-18: function `starlinkAiChat`, secret
  `SARVAM_API_KEY` = SS Diam's own Sarvam key, `AI_ENABLED = true` in `src/lib/firebase.ts`.)
- **Google Drive backup.** Build with `VITE_GOOGLE_CLIENT_ID` set to an OAuth client from SS Diam's Google Cloud.
- **App Check.** See the note in `src/lib/firebase.ts`.
