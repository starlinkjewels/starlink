import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  type User as FbUser,
} from "firebase/auth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { auth } from "./firebase";
import { loadDb, updateDb, uid, startDb, stopDb, resolveScope, watchAccess, type User } from "./db";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const fbRef = useRef<FbUser | null>(null);
  const accessUnsubRef = useRef<null | (() => void)>(null);

  const clearAccessWatch = () => { accessUnsubRef.current?.(); accessUnsubRef.current = null; };

  /** Resolve the Firestore profile for a Firebase user (or null = no access). */
  const resolveProfile = useCallback((fb: FbUser): User | null => {
    const db = loadDb();
    const email = (fb.email ?? "").toLowerCase();

    // 1. Match by stable Auth uid (set when the account was provisioned).
    const byUid = db.users.find(x => x.authUid === fb.uid);
    if (byUid) return byUid;

    // 2. A seeded/legacy admin without an authUid, matched by email → adopt uid.
    const adminByEmail = db.users.find(x => x.role === "admin" && !x.authUid && x.email.toLowerCase() === email);
    if (adminByEmail) {
      const id = adminByEmail.id;
      updateDb(d => { const a = d.users.find(x => x.id === id); if (a) a.authUid = fb.uid; });
      return { ...adminByEmail, authUid: fb.uid };
    }

    // 3. Bootstrap: no admin exists yet → this Firebase user becomes the admin.
    if (!db.users.some(x => x.role === "admin")) {
      const admin: User = {
        id: uid("u_"), authUid: fb.uid, role: "admin", status: "active",
        username: fb.email ?? "admin", name: fb.displayName || "Administrator",
        email: fb.email ?? "", password: "", createdAt: new Date().toISOString(),
      };
      updateDb(d => { if (!d.users.some(x => x.authUid === fb.uid)) d.users.push(admin); });
      return admin;
    }

    // 4. Authenticated but not provisioned by an admin → no access.
    return null;
  }, []);

  /** React to an auth-state change: load data + resolve profile, or clear. */
  const handleAuth = useCallback(async (fb: FbUser | null) => {
    fbRef.current = fb;
    clearAccessWatch();
    if (!fb) { stopDb(); setUser(null); return; }
    const scope = await resolveScope(fb.uid); // client → scoped reads; staff → full
    await startDb(scope);                      // load Firestore data (now authenticated)
    const profile = resolveProfile(fb);
    if (!profile) {
      toast.error("This account has no access. Contact your administrator.");
      await signOut(auth).catch(() => {});
      stopDb(); setUser(null);
      return;
    }
    if (profile.status !== "active") {
      toast.error("Your account is inactive. Contact your administrator.");
      await signOut(auth).catch(() => {});
      stopDb(); setUser(null);
      return;
    }
    setUser(profile);
    // Auto-logout the instant an admin deactivates or removes this account.
    if (profile.role !== "admin") {
      accessUnsubRef.current = watchAccess(fb.uid, () => {
        toast.error("Your access has been revoked. Signing out…");
        signOut(auth).catch(() => {});
      });
    }
  }, [resolveProfile]);

  useEffect(() => {
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
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await handleAuth(cred.user);
      const p = resolveProfile(cred.user);
      return p && p.status === "active" ? p : null;
    } catch {
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
