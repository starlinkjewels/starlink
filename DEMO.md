# `ssdiamdemo` — the demo branch

**Live at https://ssdiamdemo.web.app**

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
| Hosting / domain | `ssdiamdemo.web.app` | Vercel | No |

## The three rules

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

**2. Deploy to this branch's own targets, never a bare `--only hosting`.**

The project has three hosting sites: `starlinkjewels109` (the default, and
production's app id), `patelsamajdevgam` (someone else's app) and this one.
`firebase.json` here pins `"site": "ssdiamdemo"`, but always name the target
anyway:

```
npx vite build
firebase deploy --only hosting:ssdiamdemo
```

Every line of the output should read `hosting[ssdiamdemo]`. If it does not,
stop.

**3. Deploy rules with the database named.**

`firebase.json` on this branch points firestore at `ssdiamdemo`, so from this
branch:

```
firebase deploy --only firestore:rules
```

**⚠️ `--only firestore:rules` silently does nothing** with this `firebase.json`
— it prints "Deploy complete!" and uploads no rules at all, because with the
multi-database array form the deploy targets are named `firestore:<database>`,
not `firestore:rules`. Use `--only firestore` (as above) or
`--only firestore:ssdiamdemo`. A working run prints *uploading rules* and
*deployed indexes … for ssdiamdemo database*; if those lines are missing,
nothing happened.

The CLI never prints which database the rules were released to — it logs
"released rules to cloud.firestore" whatever the target. It does pass the
database id through (`release(file, "cloud.firestore", databaseId)` in
`lib/deploy/firestore/release.js`), so the real release is
`cloud.firestore/ssdiamdemo`. Trust the *indexes* line, which does name the
database.

**The same trap applies on `main`.** Its `firebase.json` has the same array
shape, so any `--only firestore:rules` run there also did nothing.

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

## App Check

Not a problem, as it turns out. The project initialises App Check with
reCAPTCHA v3, but enforcement is **off**: an unauthenticated read of the demo
database comes back `PERMISSION_DENIED — Missing or insufficient permissions`,
which is the security rules refusing it, not App Check. An App Check rejection
would say so explicitly. So the demo works on its own domain even though the
reCAPTCHA key does not list it.

If App Check is ever switched to Enforced, add `ssdiamdemo.web.app` to the
reCAPTCHA key first, or this demo stops working the moment it is.

## The demo database starts empty

Sign in with an admin email (see `ADMIN_EMAILS`) and the app boots on an empty
database — no orders, clients or stock. Whatever is entered during the demo
stays in `ssdiamdemo` and is invisible to the live app.
