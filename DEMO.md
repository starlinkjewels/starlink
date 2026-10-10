# `ssdiamdemo` — the demo branch

This branch exists to show the app to a prospective client. **It is not
production, and it must never become production's problem.**

Production is the `main` branch, writing to the `diamondflow` database.
This branch writes to `ssdiamdemo`. Both live in the same Firebase project
(`starlinkjewels109`), which already hosts several separate apps the same way.

## What is separate, and what is shared

| | Demo | Production | Shared? |
|---|---|---|---|
| Firestore database | `ssdiamdemo` | `diamondflow` | **No** — separate data, separate rules |
| Storage files | `ssdiamdemo/…` | everything else | Same bucket, different folder |
| Auth accounts | — | — | **Yes**, one user pool |
| Cloud Functions | — | — | **Yes**, one deployment |
| Hosting / domain | to be decided | Vercel | No |

## The two rules

**1. Never deploy functions from this branch.**

```
firebase deploy --only functions      ← NEVER, from this branch
```

The project has one set of functions, shared by both databases. Deploying
from here would replace production's `starlinkAiChat` and
`sendNotificationPush` with copies bound to the demo database — live push
notifications would stop and the live assistant would read demo data. The CLI
may also offer to delete functions it cannot find in the source; accepting
that deletes production's.

Because of this, the AI assistant is switched off on the demo (`IS_DEMO` in
`src/lib/firebase.ts`). Push notifications simply do not fire here — in-app
notifications still work, as they are only database rows.

**2. Deploy rules with the database named.**

`firebase.json` on this branch points firestore at `ssdiamdemo`, so from this
branch:

```
firebase deploy --only firestore:rules
```

targets the demo database. Check the output says `ssdiamdemo`. If it ever says
`diamondflow`, stop — you are on the wrong branch.

## Keeping the demo current

This branch is a copy of `main`. To bring new work across:

```
git checkout ssdiamdemo
git merge main
```

Only four things differ from `main`, so merges should stay clean:

- `src/lib/firebase.ts` — `DATABASE_ID`, `IS_DEMO`, `STORAGE_PREFIX`
- `src/lib/storage.ts` — the upload prefix
- `firebase.json` — the firestore database name
- `src/pages/StarlinkAi.tsx` — the assistant guard

Never merge this branch **into** `main`.

## When the demo is over

- Delete the database: `firebase firestore:databases:delete ssdiamdemo`
- Delete the `ssdiamdemo/` folder in Storage
- Remove any demo logins from Firebase Auth

## Still to confirm

**App Check.** The project uses reCAPTCHA v3, keyed to production's domains.
If the demo is served from a new domain, that domain has to be added to the
reCAPTCHA key (Firebase Console → App Check), or every request from the demo
is rejected. Decide where the demo is hosted first, then check this.
