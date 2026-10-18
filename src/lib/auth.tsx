import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  type User as FbUser,
} from "firebase/auth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { auth, isAdminEmail, clearDeviceCache } from "./firebase";
import { loadDb, updateDb, uid, startDb, stopDb, resolveScope, watchAccess, logEvent, type User } from "./db";
import { sendMail, MARKETING_EMAIL, clientLoginEmail } from "./email";

interface AuthCtx {
  user: User | null;
  login: (email: string, password: string) => Promise<User | null>;
  logout: () => void;
  refresh: () => void;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

/**
 * Unified authentication — EVERY user (admin, employee, client) signs in through
 * Firebase Authentication (email + password). Passwords live in Firebase Auth,
 * never in Firestore.
 *
 *  • The Firestore `users` collection holds only profile data (role, clientId,
 *    name…) linked to the Auth account by `authUid`.
 *  • Data is loaded from Firestore only AFTER sign-in (startDb) because the
 *    security rules reject unauthenticated reads; it is cleared on sign-out.
 *  • The first Firebase user on an empty database (or a seeded/legacy admin
 *    matched by email) becomes the admin; everyone else must be provisioned by
 *    an admin (which sets their `authUid`), otherwise they get no access.
 */
function Splash({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "radial-gradient(circle at 30% 25%, oklch(0.34 0.12 265) 0%, oklch(0.16 0.05 265) 55%, oklch(0.11 0.03 265) 100%)" }}
    >
      <div className="flex flex-col items-center gap-6">
        <img
          src="/starlink-logo.png"
          alt="Starlink Jewels"
          className="h-16 w-auto object-contain drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)] animate-pulse"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div className="text-white/90 font-display tracking-[0.3em] text-sm">STARLINK JEWELS</div>
        <div className="flex items-center gap-2 text-white/60 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

const AFTER_RELOAD_KEY = "sl-after-signout";
/** Sign-out reloads the page (see clearDeviceCache), which would swallow a
 *  toast shown just before it — keep the message for the sign-in screen. */
function noteAfterReload(msg: string) {
  try { sessionStorage.setItem(AFTER_RELOAD_KEY, msg); } catch { /* no storage */ }
}

/**
 * A client is using the portal: tell the team's inbox, once a day. This
 * device asks at most once a day, and the server keeps it to one across all
 * of the client's devices (onceKey). Covers a typed sign-in and a session the
 * app restored on opening alike — most clients stay signed in, so a typed
 * sign-in alone left the team hearing almost nothing.
 */
function alertClientActive(p: User, how: "signed in" | "opened the app") {
  if (p.role !== "client") return;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const key = `sl-active-alert:${p.id}`;
  try { if (localStorage.getItem(key) === day) return; localStorage.setItem(key, day); } catch { /* no storage */ }
  const client = loadDb().clients.find(c => c.id === p.clientId);
  const m = clientLoginEmail({ companyName: client?.companyName ?? p.name, email: p.email, at: new Date().toISOString(), how });
  void sendMail(MARKETING_EMAIL, m.subject, m.html, { onceKey: "client-active" });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const fbRef = useRef<FbUser | null>(null);
  /** True from a typed sign-in until its alert is sent (vs a restored session). */
  const typedSignInRef = useRef(false);
  const accessUnsubRef = useRef<null | (() => void)>(null);
  /** Set once the device copy is being wiped, so two sign-out events do it once. */
  const clearingRef = useRef(false);

  const clearAccessWatch = () => { accessUnsubRef.current?.(); accessUnsubRef.current = null; };

  /** Resolve the Firestore profile for a Firebase user (or null = no access). */
  const resolveProfile = useCallback((fb: FbUser): User | null => {
    const db = loadDb();
    const email = (fb.email ?? "").toLowerCase();

    // Admins are defined by the email allowlist (must match firestore.rules).
    if (isAdminEmail(email)) {
      // Reuse an existing admin profile for this account/email, or create one.
      const existing = db.users.find(x => x.authUid === fb.uid)
        ?? db.users.find(x => x.role === "admin" && x.email.toLowerCase() === email);
      if (existing) {
        if (existing.authUid !== fb.uid || existing.role !== "admin" || existing.status !== "active") {
          const id = existing.id;
          updateDb(d => { const a = d.users.find(x => x.id === id); if (a) { a.authUid = fb.uid; a.role = "admin"; a.status = "active"; } });
          return { ...existing, authUid: fb.uid, role: "admin", status: "active" };
        }
        return existing;
      }
      const admin: User = {
        id: uid("u_"), authUid: fb.uid, role: "admin", status: "active",
        username: fb.email ?? "admin", name: fb.displayName || "Administrator",
        email: fb.email ?? "", password: "", createdAt: new Date().toISOString(),
      };
      // Re-check against the LIVE cache, matching on the admin e-mail too — not
      // just authUid. The users list may not have arrived when this runs (or the
      // Firebase account was recreated with a new uid), and an authUid-only guard
      // then added a SECOND "Administrator" row every time. Adopt whatever is
      // already there instead of pushing a duplicate.
      let adopted: User | null = null;
      updateDb(d => {
        const found = d.users.find(x => x.authUid === fb.uid)
          ?? d.users.find(x => x.role === "admin" && (x.email ?? "").toLowerCase() === email);
        if (found) {
          found.authUid = fb.uid; found.role = "admin"; found.status = "active";
          adopted = { ...found };
          return;
        }
        d.users.push(admin);
      });
      return adopted ?? admin;
    }

    // Everyone else must have been provisioned by an admin (has an authUid).
    const byUid = db.users.find(x => x.authUid === fb.uid);
    if (byUid) return byUid;

    // Authenticated but unknown → no access.
    return null;
  }, []);

  /** React to an auth-state change: load data + resolve profile, or clear. */
  const handleAuth = useCallback(async (fb: FbUser | null) => {
    const wasSignedIn = !!fbRef.current;
    fbRef.current = fb;
    clearAccessWatch();
    if (!fb) {
      stopDb(); setUser(null);
      // Signed out on this device: wipe its saved copy of the data, so the next
      // person on a shared computer finds none of it. The database connection
      // is closed by that, so the page starts again at the sign-in screen.
      if (wasSignedIn && !clearingRef.current) {
        clearingRef.current = true;
        if (await clearDeviceCache()) window.location.replace("/login");
      }
      return;
    }
    let scope = await resolveScope(fb.uid); // client → scoped reads; staff → full
    // An admin loads the admin-only records: an owner (by the email list) or
    // an admin made in the app (by their index entry). The security rules
    // recognise exactly the same two, so the app and the server agree.
    if (scope.kind === "full") scope = { ...scope, admin: isAdminEmail(fb.email) || !!scope.admin };
    await startDb(scope);                      // load Firestore data (now authenticated)
    const profile = resolveProfile(fb);
    if (!profile) {
      toast.error("This account has no access. Contact your administrator.");
      noteAfterReload("This account has no access. Contact your administrator.");
      await signOut(auth).catch(() => {});
      stopDb(); setUser(null);
      return;
    }
    if (profile.status !== "active") {
      toast.error("Your account is inactive. Contact your administrator.");
      noteAfterReload("Your account is inactive. Contact your administrator.");
      await signOut(auth).catch(() => {});
      stopDb(); setUser(null);
      return;
    }
    setUser(profile);
    alertClientActive(profile, typedSignInRef.current ? "signed in" : "opened the app");
    typedSignInRef.current = false;
    // Auto-logout the instant an admin deactivates or removes this account.
    if (profile.role !== "admin") {
      accessUnsubRef.current = watchAccess(fb.uid, () => {
        toast.error("Your access has been revoked. Signing out…");
        noteAfterReload("Your access has been revoked.");
        signOut(auth).catch(() => {});
      });
    }
  }, [resolveProfile]);

  useEffect(() => {
    // A message from before the sign-out reload, shown on the sign-in screen.
    try {
      const m = sessionStorage.getItem(AFTER_RELOAD_KEY);
      if (m) { sessionStorage.removeItem(AFTER_RELOAD_KEY); setTimeout(() => toast.error(m), 300); }
    } catch { /* no storage */ }
    const unsub = onAuthStateChanged(auth, async fb => {
      await handleAuth(fb);
      setBooting(false);
    });
    // Keep the resolved profile fresh when the underlying data changes.
    const onDb = () => {
      const fb = fbRef.current;
      if (fb) { const p = resolveProfile(fb); if (p && p.status === "active") setUser(p); }
    };
    window.addEventListener("starlink-db-updated", onDb);
    return () => { unsub(); clearAccessWatch(); window.removeEventListener("starlink-db-updated", onDb); };
  }, [handleAuth, resolveProfile]);

  const login = useCallback(async (email: string, password: string): Promise<User | null> => {
    try {
      typedSignInRef.current = true;
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await handleAuth(cred.user);
      const p = resolveProfile(cred.user);
      if (!p || p.status !== "active") return null;
      // A real sign-in, typed in — not the session quietly restored on every
      // page load, which would bury the log in noise.
      logEvent("signin", `Signed in — ${p.name || p.email}`);
      // The team's "client is active" email goes out from handleAuth, for a
      // typed sign-in and a restored session alike — once a day.
      return p;
    } catch {
      typedSignInRef.current = false;
      return null;
    }
  }, [handleAuth, resolveProfile]);

  const logout = useCallback(() => {
    signOut(auth).catch(() => {}); // onAuthStateChanged handles cache/user teardown
  }, []);

  const refresh = useCallback(() => {
    const fb = fbRef.current;
    setUser(fb ? resolveProfile(fb) : null);
  }, [resolveProfile]);

  if (booting) return <Splash label="Connecting…" />;

  return <Ctx.Provider value={{ user, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
