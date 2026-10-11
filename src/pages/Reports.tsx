import { useAuth } from "@/lib/auth";
import { ReportSections } from "@/components/reports/ReportSections";
import { ReportsHub } from "@/components/reports/ReportsHub";

/**
 * Reports. The team gets the full analytics page; a client keeps the simple
 * view of their own orders and deliveries they have always had.
 */
export function ReportsPage() {
  const { user } = useAuth();
  return user?.role === "client" ? <ReportSections /> : <ReportsHub />;
}
