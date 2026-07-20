import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { loadDb, saveDb, type User } from "./db";

interface AuthCtx {
  user: User | null;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => void;
  refresh: () => void;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const refresh = useCallback(() => {
    const db = loadDb();
    const uid = db.session.userId;
    setUser(uid ? db.users.find(u => u.id === uid) ?? null : null);
  }, []);

  useEffect(() => {
    refresh();
    const h = () => refresh();
    window.addEventListener("starlink-db-updated", h);
    return () => window.removeEventListener("starlink-db-updated", h);
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const db = loadDb();
    const u = db.users.find(x => x.username.toLowerCase() === username.toLowerCase() && x.password === password && x.status === "active");
    if (!u) return null;
    db.session.userId = u.id;
    saveDb(db);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    const db = loadDb();
    db.session.userId = null;
    saveDb(db);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);