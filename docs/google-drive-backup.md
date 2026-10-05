# Connecting Google Drive for backups

The app can keep a second copy of the whole database in a Google Drive account.
It needs one piece of setup first, which has to be done by hand once because it
creates credentials tied to your own Google account.

## 1. Create the OAuth client

1. Go to <https://console.cloud.google.com/> and pick (or create) a project.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen**
   - User type: **External** (unless every admin is on a Google Workspace
     account, in which case **Internal** is simpler — no verification at all).
   - App name, support email, developer email. Nothing else is required.
   - **Scopes**: add `.../auth/drive.file` only. This is the narrow one — the app
     can see and touch *only files it created itself*, never anything else in
     the Drive. It keeps Google's review light and means a mistake here cannot
     expose the rest of the account.
   - **Test users**: add the admin Google accounts while the app is unpublished.
     (An unpublished External app works for test users straight away.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - **Authorised JavaScript origins** — add every address the app is opened at:
     ```
     https://app.starlinkjewels.com
     http://localhost:5173
     ```
     Add the Vercel preview domain too if previews are used.
   - Leave **Authorised redirect URIs** empty; this flow does not use one.
5. Copy the **Client ID**. It looks like `1234567890-abc123.apps.googleusercontent.com`.

## 2. Give it to the app

Set it as an environment variable where the app is built:

```
VITE_GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
```

On Vercel: **Project → Settings → Environment Variables**, then redeploy. For
local work put it in `.env.local` at the repo root.

Until this is set, the Settings page shows the Drive card greyed out and says it
is not configured. Nothing breaks.

## 3. Connect

**Settings → Google Drive Backup → Connect Google Drive.** Pick the account,
approve, done. Choose how often — every day, week, month or year.

Use a **dedicated company Google account with two-factor on**, not someone's
personal Drive. The backup file contains everything: every client, every
payment, every cost price. In Drive it is exactly as safe as the account it
sits in.

## How the schedule actually works

The backup runs **when an admin opens the app and one is due** — the same way
the daily Firebase Storage backup already works. There is no server involved,
so nothing runs while the app is closed. In practice someone opens it most
days; if nobody opens it for a week, that week has no Drive copy.

Google only grants permission for about an hour at a time and a browser cannot
renew it in the background. When it has lapsed the automatic run quietly skips,
and pressing **Back up now** in Settings renews it. If this matters more than it
sounds, the alternative is a scheduled Cloud Function holding a refresh token,
which needs the Firebase Blaze plan.
