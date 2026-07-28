import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "./lib/auth";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { OrdersPage } from "./pages/Orders";
import { OrderDetailPage } from "./pages/OrderDetail";
import { NewOrderPage } from "./pages/NewOrder";
import { ClientsPage } from "./pages/Clients";
import { ClientHistoryPage } from "./pages/ClientHistory";
import { EmployeesPage } from "./pages/Employees";
import { EmployeeDetailPage } from "./pages/EmployeeDetail";
import { MessagesPage } from "./pages/Messages";
import { NotificationsPage } from "./pages/Notifications";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { ProfilePage } from "./pages/Profile";
import { InvoicesPage } from "./pages/Invoices";
import { SearchPage } from "./pages/Search";
import { ExpensesPage } from "./pages/Expenses";
import { IncomePage } from "./pages/Income";
import { CatalogPage } from "./pages/Catalog";
import { StarlinkAiPage } from "./pages/StarlinkAi";
import { LockerPage } from "./pages/Locker";
import { SuppliersPage } from "./pages/Suppliers";
import { SupplierHistoryPage } from "./pages/SupplierHistory";
import { StockPage } from "./pages/Stock";
import { FactoriesPage } from "./pages/Factories";
import { FactoryHistoryPage } from "./pages/FactoryHistory";
import { ReadyStockPage } from "./pages/ReadyStock";
import { InstallPrompt } from "./components/InstallPrompt";
import type { Role } from "./lib/db";

function Protected({ children, roles }: { children: React.ReactNode; roles?: Role[] }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  // Surface background save failures — writes are optimistic, so without this a
  // failed Firestore write is invisible and the user thinks the change saved.
  useEffect(() => {
    const onErr = () => toast.error("Couldn't save your last change — check your connection and try again.");
    window.addEventListener("starlink-db-error", onErr);
    return () => window.removeEventListener("starlink-db-error", onErr);
  }, []);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Protected><AppLayout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/new" element={<Protected roles={["client","admin","employee"]}><NewOrderPage /></Protected>} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="clients" element={<Protected roles={["admin","employee"]}><ClientsPage /></Protected>} />
          <Route path="clients/:id" element={<Protected roles={["admin","employee"]}><ClientHistoryPage /></Protected>} />
          <Route path="employees" element={<Protected roles={["admin"]}><EmployeesPage /></Protected>} />
          <Route path="employees/:id" element={<Protected roles={["admin"]}><EmployeeDetailPage /></Protected>} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<Protected roles={["admin"]}><SettingsPage /></Protected>} />
          <Route path="expenses" element={<Protected roles={["admin","employee"]}><ExpensesPage /></Protected>} />
          <Route path="income" element={<IncomePage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="ai" element={<StarlinkAiPage />} />
          <Route path="locker" element={<Protected roles={["admin","employee"]}><LockerPage /></Protected>} />
          <Route path="suppliers" element={<Protected roles={["admin","employee"]}><SuppliersPage /></Protected>} />
          <Route path="suppliers/:id" element={<Protected roles={["admin","employee"]}><SupplierHistoryPage /></Protected>} />
          <Route path="stock" element={<Protected roles={["admin","employee"]}><StockPage /></Protected>} />
          <Route path="factories" element={<Protected roles={["admin","employee"]}><FactoriesPage /></Protected>} />
          <Route path="factories/:id" element={<Protected roles={["admin","employee"]}><FactoryHistoryPage /></Protected>} />
          <Route path="ready-stock" element={<Protected roles={["admin","employee"]}><ReadyStockPage /></Protected>} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </>
  );
}