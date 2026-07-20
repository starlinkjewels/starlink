import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, Users, Briefcase, MessageSquare, Bell, FileText, BarChart3, Settings, Search, LogOut, Plus, User, ChevronDown, UserCircle, ListTodo, MoreHorizontal, X, ChevronRight, Search as SearchIcon, Wallet, BookOpen, FolderOpen } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import { loadDb } from "@/lib/db";
import { useEffect, useRef, useState } from "react";
import { TasksPanel } from "@/components/TasksPanel";

interface NavItem { to: string; label: string; icon: any; roles?: string[]; }
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/clients", label: "Clients", icon: Users, roles: ["admin","employee"] },
  { to: "/employees", label: "Employees", icon: Briefcase, roles: ["admin"] },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/expenses", label: "Expenses", icon: Wallet, roles: ["admin","employee"] },
  { to: "/income", label: "Passbook", icon: BookOpen },
  { to: "/catalog", label: "Catalog", icon: FolderOpen },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/notifications", label: "Alerts", icon: Bell },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin","employee"] },
];

/* Main 4 tabs always visible on mobile */
const MOBILE_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/messages", label: "Chat", icon: MessageSquare },
  { to: "/catalog", label: "Catalog", icon: FolderOpen },
];

/* Items shown inside the "More" drawer */
const MORE_NAV: NavItem[] = [
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/catalog",  label: "Catalog",  icon: FolderOpen },
  { to: "/income",   label: "Passbook", icon: BookOpen },
  { to: "/expenses", label: "Expenses", icon: Wallet, roles: ["admin","employee"] },
  { to: "/clients", label: "Clients", icon: Users, roles: ["admin","employee"] },
  { to: "/employees", label: "Employees", icon: Briefcase, roles: ["admin"] },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin","employee"] },
  { to: "/notifications", label: "Alerts", icon: Bell },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/profile", label: "My Profile", icon: User },
];

/* Map routes → page titles */
const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/orders": "Orders",
  "/orders/new": "New Order",
  "/clients": "Clients",
  "/employees": "Employees",
  "/invoices": "Invoices",
  "/income":   "Income Passbook",
  "/catalog":  "Catalog",
  "/expenses": "Expenses",
  "/messages": "Messages",
  "/notifications": "Notifications",
  "/reports": "Reports",
  "/settings": "Settings",
  "/search": "Search",
  "/profile": "My Profile",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  employee: "Employee",
  client: "Client",
};

/* Color map for More drawer icons */
const ICON_COLORS: Record<string, string> = {
  "/invoices":   "bg-blue-500/15 text-blue-600",
  "/catalog":    "bg-amber-500/15 text-amber-600",
  "/income":     "bg-emerald-500/15 text-emerald-600",
  "/expenses":   "bg-rose-500/15 text-rose-600",
  "/clients":    "bg-violet-500/15 text-violet-600",
  "/employees":  "bg-orange-500/15 text-orange-600",
  "/reports":    "bg-emerald-500/15 text-emerald-600",
  "/settings":   "bg-slate-500/15 text-slate-600",
  "/search":     "bg-primary/15 text-primary",
  "/profile":    "bg-brand-dark/15 text-brand-dark",
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingTasks, setPendingTasks] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calc = () => {
      const db = loadDb();
      setUnread(db.notifications.filter(n => n.userId === user?.id && !n.read).length);
      setPendingTasks((db.tasks ?? []).filter(t => t.assignedTo === user?.id && !t.completed).length);
    };
    calc();
    window.addEventListener("starlink-db-updated", calc);
    return () => window.removeEventListener("starlink-db-updated", calc);
  }, [user?.id]);

  /* Close profile dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* Close More drawer when route changes */
  useEffect(() => { setMoreOpen(false); }, [loc.pathname]);

  const nav = NAV.filter(n => !n.roles || n.roles.includes(user!.role));
  const moreNav = MORE_NAV.filter(n => !n.roles || n.roles.includes(user!.role));
  const canCreateOrder = user?.role === "client" || user?.role === "admin";

  /* Resolve page title — handle dynamic segments like /orders/:id */
  const pageTitle = PAGE_TITLES[loc.pathname] ??
    (loc.pathname.startsWith("/orders/") ? "Order Detail" :
     loc.pathname.startsWith("/clients/") ? "Client History" :
     loc.pathname.startsWith("/employees/") ? "Employee Detail" : "");

  const initials = user?.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() ?? "?";

  /* Is the current path one of the More items? (highlight "More" tab) */
  const isMoreActive = moreNav.some(item => {
    if (item.to === "/") return loc.pathname === "/";
    return loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
  });

  return (
    <div className="h-[100dvh] overflow-hidden bg-background flex">
      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden md:flex shrink-0 flex-col border-r bg-sidebar h-screen" style={{ width: '16rem', minWidth: '16rem' }}>
        <div className="px-5 py-5 flex items-center">
          <img src="/starlink-logo.png" alt="Starlink Jewels" className="h-10 w-auto object-contain" />
        </div>
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {nav.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                 ${isActive ? "bg-primary text-primary-foreground shadow-soft" : "text-foreground/70 hover:bg-secondary hover:text-foreground"}`}>
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {item.to === "/notifications" && unread > 0 && (
                <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar user card */}
        <div className="p-3 border-t space-y-1">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/50">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-xs font-bold grid place-items-center shrink-0 shadow-soft">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{user?.name}</p>
              <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[user?.role ?? ""] ?? user?.role}</p>
            </div>
          </div>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">

        {/* ── Top bar ── */}
        <header className="shrink-0 sticky top-0 z-30 glass border-b px-4 md:px-6 flex items-center gap-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0px)", height: "calc(env(safe-area-inset-top) + 4rem)" }}>

          {/* Mobile logo */}
          <div className="md:hidden flex items-center shrink-0">
            <img src="/starlink-logo.png" alt="Starlink Jewels" className="h-8 w-auto object-contain" />
          </div>

          {/* Page title (desktop) */}
          {pageTitle && (
            <div className="hidden md:flex flex-col justify-center shrink-0">
              <h1 className="text-base font-semibold text-brand-dark leading-tight">{pageTitle}</h1>
              <p className="text-[11px] text-muted-foreground leading-tight capitalize">{user?.role} portal</p>
            </div>
          )}

          {/* Divider (desktop) */}
          {pageTitle && <div className="hidden md:block h-6 w-px bg-border/60 shrink-0" />}

          {/* Search bar */}
          <button
            onClick={() => navigate("/search")}
            className="flex-1 max-w-xs md:max-w-sm flex items-center gap-2 px-3 h-9 rounded-xl border border-border/80 bg-white/70 text-sm text-muted-foreground hover:border-primary hover:bg-white transition-all ml-auto md:ml-0">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline truncate">Search orders, clients…</span>
          </button>

          {/* Spacer */}
          <div className="flex-1 hidden md:block" />

          {/* Notification bell */}
          <button
            onClick={() => navigate("/notifications")}
            className="relative h-9 w-9 rounded-xl hover:bg-secondary flex items-center justify-center transition-colors shrink-0">
            <Bell className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center leading-none">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {/* Profile dropdown */}
          <div className="relative shrink-0" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(v => !v)}
              className="flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-xl hover:bg-secondary transition-colors group">
              {/* Avatar */}
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-xs font-bold grid place-items-center shadow-soft">
                {initials}
              </div>
              {/* Name + role (desktop only) */}
              <div className="hidden md:flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold text-foreground">{user?.name.split(" ")[0]}</span>
                <span className="text-[10px] text-muted-foreground capitalize">{user?.role}</span>
              </div>
              <ChevronDown className={`hidden md:block h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown menu */}
            <AnimatePresence>
              {profileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-border/80 bg-white shadow-lg overflow-hidden z-50">

                  {/* User info header */}
                  <div className="px-4 py-3 bg-secondary/40 border-b border-border/60">
                    <p className="text-sm font-semibold text-brand-dark truncate">{user?.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ROLE_LABEL[user?.role ?? ""] ?? user?.role}</p>
                  </div>

                  {/* Actions */}
                  <div className="p-1.5 space-y-0.5">
                    <button
                      onClick={() => { setProfileOpen(false); navigate("/profile"); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-foreground hover:bg-secondary transition-colors text-left">
                      <UserCircle className="h-4 w-4 text-muted-foreground" /> My Profile
                    </button>
                    {user?.role !== "client" && (
                      <button
                        onClick={() => { setProfileOpen(false); navigate("/settings"); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-foreground hover:bg-secondary transition-colors text-left">
                        <Settings className="h-4 w-4 text-muted-foreground" /> Settings
                      </button>
                    )}
                    <div className="h-px bg-border/60 my-1" />
                    <button
                      onClick={() => { logout(); navigate("/login"); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors text-left">
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* ── Page content ── */}
        <motion.main
          key={loc.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-24 md:pb-8 px-4 md:px-8 pt-6">
          <Outlet />
        </motion.main>

        {/* ── Bottom nav (mobile) — 5 items: 4 tabs + More ── */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-40 glass border-t flex items-center justify-around"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)", paddingTop: "0.5rem" }}>

          {MOBILE_NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-medium transition relative
                 ${isActive ? "text-primary" : "text-muted-foreground"}`}>
              <div className="relative">
                <item.icon className="h-5 w-5" />
                {item.to === "/notifications" && unread > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold grid place-items-center leading-none">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </div>
              {item.label}
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-medium transition
              ${isMoreActive ? "text-primary" : "text-muted-foreground"}`}>
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </nav>

        {/* ── FAB (mobile) ── */}
        {canCreateOrder && (
          <button
            onClick={() => navigate("/orders/new")}
            className="md:hidden fixed right-4 z-40 h-14 w-14 rounded-full btn-hero grid place-items-center shadow-lg"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}>
            <Plus className="h-6 w-6" />
          </button>
        )}

        {/* ── My Tasks floating button (employee + admin) ── */}
        {(user?.role === "employee" || user?.role === "admin") && (
          <>
            {/* Desktop: text pill bottom-right */}
            <button
              onClick={() => setTasksOpen(v => !v)}
              className="hidden md:flex fixed right-5 z-40 items-center gap-2 px-4 h-11 rounded-full bg-white border border-border shadow-lg hover:shadow-xl hover:border-primary/40 transition-all text-sm font-medium text-foreground"
              style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
            >
              <ListTodo className="h-4 w-4 text-primary shrink-0" />
              My Tasks
              {pendingTasks > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                  {pendingTasks > 99 ? "99+" : pendingTasks}
                </span>
              )}
            </button>
            {/* Mobile: icon-only circle on LEFT side, above bottom nav */}
            <button
              onClick={() => setTasksOpen(v => !v)}
              className="md:hidden fixed left-4 z-40 h-12 w-12 rounded-full bg-white border border-border shadow-lg hover:shadow-xl transition-all grid place-items-center"
              style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
            >
              <ListTodo className="h-5 w-5 text-primary" />
              {pendingTasks > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center leading-none">
                  {pendingTasks > 99 ? "99+" : pendingTasks}
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* ── Tasks Panel (my own tasks) ── */}
      {user && (user.role === "employee" || user.role === "admin") && (
        <TasksPanel
          userId={user.id}
          open={tasksOpen}
          onClose={() => setTasksOpen(false)}
        />
      )}

      {/* ── More Drawer (mobile) ── */}
      <AnimatePresence>
        {moreOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="more-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setMoreOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              key="more-drawer"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-3xl shadow-2xl flex flex-col"
              style={{ maxHeight: "90vh" }}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
                <div>
                  <p className="font-display text-lg text-brand-dark">More</p>
                  <p className="text-xs text-muted-foreground capitalize">{user?.name} · {user?.role}</p>
                </div>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="h-8 w-8 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {/* User avatar strip */}
                <div className="px-5 py-4 flex items-center gap-3 bg-secondary/30">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-base font-bold grid place-items-center shrink-0 shadow-soft">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-dark truncate">{user?.name}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABEL[user?.role ?? ""] ?? user?.role}</p>
                  </div>
                </div>

                {/* Nav items grid */}
                <div className="px-4 pt-4 pb-2">
                  <div className="grid grid-cols-4 gap-3">
                    {moreNav.map(item => {
                      const isActive = loc.pathname === item.to || (item.to !== "/" && loc.pathname.startsWith(item.to + "/"));
                      const colorClass = ICON_COLORS[item.to] || "bg-primary/15 text-primary";
                      return (
                        <button
                          key={item.to}
                          onClick={() => { navigate(item.to); setMoreOpen(false); }}
                          className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all active:scale-95
                            ${isActive ? "bg-primary/10 ring-2 ring-primary/20" : "hover:bg-secondary/60"}`}
                        >
                          <div className={`h-12 w-12 rounded-2xl grid place-items-center ${colorClass}`}>
                            <item.icon className="h-6 w-6" />
                          </div>
                          <span className={`text-[11px] font-medium text-center leading-tight ${isActive ? "text-primary" : "text-foreground"}`}>
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Divider + Sign out */}
                <div className="mx-4 mt-3 pt-3 border-t border-border/60"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
                >
                  <button
                    onClick={() => { logout(); navigate("/login"); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-xl bg-destructive/10 grid place-items-center shrink-0">
                      <LogOut className="h-5 w-5" />
                    </div>
                    <span className="font-medium">Sign Out</span>
                    <ChevronRight className="h-4 w-4 ml-auto opacity-50" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
