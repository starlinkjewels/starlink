import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LogOut, PenTool, Wallet } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { ImageViewer } from "@/components/ImageViewer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";

const DesignerJobsPage = lazy(() => import("./DesignerJobs").then(m => ({ default: m.DesignerJobsPage })));
const DesignerJobPage = lazy(() => import("./DesignerJob").then(m => ({ default: m.DesignerJobPage })));
const DesignerMoneyPage = lazy(() => import("./DesignerMoney").then(m => ({ default: m.DesignerMoneyPage })));

/**
 * A CAD designer's own login (role "designer"): their own screens, and nothing
 * of the staff's — the designs given to them, one design's brief, pictures and
 * files, and (a freelancer) their money. Every other address comes back here.
 * What they can read is decided by the database rules (their profile, their
 * designer record, their jobs); what they do goes through the server
 * (lib/designerWork.ts) — never written from this device.
 */
export default function DesignerPortal() {
  const { user, logout } = useAuth();
  const db = useDb();
  const designer = (db.designers ?? []).find(d => d.id === user?.designerId);
  const freelance = designer?.kind === "freelance";
  const link = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/95 backdrop-blur">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3 min-w-0">
          <BrandLogo className="h-8 w-auto shrink-0" wide />
          <nav className="flex items-center gap-1 min-w-0" aria-label="Designer">
            <NavLink to="/" end className={link}><PenTool className="h-4 w-4" />Designs</NavLink>
            {freelance && <NavLink to="/money" className={link}><Wallet className="h-4 w-4" />Money</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-2 min-w-0">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[12rem]">{user?.name}</span>
            <Button type="button" variant="outline" size="sm" className="rounded-lg gap-1.5 shrink-0" onClick={logout}><LogOut className="h-3.5 w-3.5" /><span className="max-sm:hidden">Sign out</span></Button>
          </div>
        </div>
      </header>
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6">
        {!user?.designerId && (
          <div className="card-luxe p-8 text-center text-sm text-muted-foreground">This login is not linked to a designer yet — ask the office.</div>
        )}
        {!!user?.designerId && !designer && <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>}
        {designer?.active === false && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            Your designer account is switched off — you can look, but not add files or hand anything in. Ask the office.
          </div>
        )}
        {designer && (
          <Suspense fallback={<div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>}>
            <Routes>
              <Route index element={<DesignerJobsPage />} />
              <Route path="design/:jobId" element={<DesignerJobPage />} />
              {freelance && <Route path="money" element={<DesignerMoneyPage />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        )}
      </main>
      <ImageViewer />
    </div>
  );
}
