import { Routes, Route, Navigate, useLocation } from "react-router-dom";
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
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Protected><AppLayout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/new" element={<Protected roles={["client","admin"]}><NewOrderPage /></Protected>} />
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
          <Route path="settings" element={<Protected roles={["admin","employee"]}><SettingsPage /></Protected>} />
          <Route path="expenses" element={<Protected roles={["admin","employee"]}><ExpensesPage /></Protected>} />
          <Route path="income" element={<IncomePage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </>
  );
}