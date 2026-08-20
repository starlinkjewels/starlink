import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "./lib/auth";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/Login";
import { InstallPrompt } from "./components/InstallPrompt";
import { NotificationPermissionModal } from "./components/NotificationPermissionModal";
import { initForegroundPush } from "./lib/push";
import { usePresenceHeartbeat } from "./lib/presence";
import type { Role } from "./lib/db";

// Route-level code splitting: each page is fetched on demand instead of riding
// in one giant boot bundle, so the app opens fast on mobile. Login + the layout
// shell stay eager (needed for the very first paint); everything else is lazy.
// Pages use named exports, so map the named export onto `default` for lazy().
const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const OrdersPage = lazy(() => import("./pages/Orders").then(m => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import("./pages/OrderDetail").then(m => ({ default: m.OrderDetailPage })));
const NewOrderPage = lazy(() => import("./pages/NewOrder").then(m => ({ default: m.NewOrderPage })));
const ClientsPage = lazy(() => import("./pages/Clients").then(m => ({ default: m.ClientsPage })));
const ClientHistoryPage = lazy(() => import("./pages/ClientHistory").then(m => ({ default: m.ClientHistoryPage })));
const EmployeesPage = lazy(() => import("./pages/Employees").then(m => ({ default: m.EmployeesPage })));
const EmployeeDetailPage = lazy(() => import("./pages/EmployeeDetail").then(m => ({ default: m.EmployeeDetailPage })));
const MessagesPage = lazy(() => import("./pages/Messages").then(m => ({ default: m.MessagesPage })));
const NotificationsPage = lazy(() => import("./pages/Notifications").then(m => ({ default: m.NotificationsPage })));
const ReportsPage = lazy(() => import("./pages/Reports").then(m => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then(m => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import("./pages/Profile").then(m => ({ default: m.ProfilePage })));
const InvoicesPage = lazy(() => import("./pages/Invoices").then(m => ({ default: m.InvoicesPage })));
const SearchPage = lazy(() => import("./pages/Search").then(m => ({ default: m.SearchPage })));
const ExpensesPage = lazy(() => import("./pages/Expenses").then(m => ({ default: m.ExpensesPage })));
const IncomePage = lazy(() => import("./pages/Income").then(m => ({ default: m.IncomePage })));
const CatalogPage = lazy(() => import("./pages/Catalog").then(m => ({ default: m.CatalogPage })));
const ProductPhotosPage = lazy(() => import("./pages/ProductPhotos").then(m => ({ default: m.ProductPhotosPage })));
const SharedGalleryPage = lazy(() => import("./pages/SharedGallery").then(m => ({ default: m.SharedGalleryPage })));
const StarlinkAiPage = lazy(() => import("./pages/StarlinkAi").then(m => ({ default: m.StarlinkAiPage })));
const LockerPage = lazy(() => import("./pages/Locker").then(m => ({ default: m.LockerPage })));
const SuppliersPage = lazy(() => import("./pages/Suppliers").then(m => ({ default: m.SuppliersPage })));
const SupplierHistoryPage = lazy(() => import("./pages/SupplierHistory").then(m => ({ default: m.SupplierHistoryPage })));
const StockPage = lazy(() => import("./pages/Stock").then(m => ({ default: m.StockPage })));
const StockSectionPage = lazy(() => import("./pages/StockSection").then(m => ({ default: m.StockSectionPage })));
const FactoriesPage = lazy(() => import("./pages/Factories").then(m => ({ default: m.FactoriesPage })));
const FactoryHistoryPage = lazy(() => import("./pages/FactoryHistory").then(m => ({ default: m.FactoryHistoryPage })));
const ReadyStockPage = lazy(() => import("./pages/ReadyStock").then(m => ({ default: m.ReadyStockPage })));
const GiftCardPage = lazy(() => import("./pages/GiftCard").then(m => ({ default: m.GiftCardPage })));
const GiftCardsAdminPage = lazy(() => import("./pages/GiftCardsAdmin").then(m => ({ default: m.GiftCardsAdminPage })));
const PaymentsPage = lazy(() => import("./pages/Payments").then(m => ({ default: m.PaymentsPage })));
const BuyAssignPage = lazy(() => import("./pages/BuyAssign").then(m => ({ default: m.BuyAssignPage })));

function Protected({ children, roles }: { children: React.ReactNode; roles?: Role[] }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const { user } = useAuth();

  usePresenceHeartbeat(user?.id);

  // Surface background save failures — writes are optimistic, so without this a
  // failed Firestore write is invisible and the user thinks the change saved.
  useEffect(() => {
    const onErr = () => toast.error("Couldn't save your last change — check your connection and try again.");
    window.addEventListener("starlink-db-error", onErr);
    return () => window.removeEventListener("starlink-db-error", onErr);
  }, []);

  // Foreground push handler — a notification that arrives while this tab is
  // focused shows as an in-app toast instead (FCM never fires an OS-level
  // notification for a foreground message by design).
  useEffect(() => {
    if (!user) return;
    initForegroundPush();
  }, [user]);

  // Warm the lazy page chunks in the background once logged in, during idle
  // time. Each page is code-split, so the FIRST visit would otherwise flash a
  // loading spinner; prefetching makes navigation instant (chunk already cached).
  useEffect(() => {
    if (!user) return;
    const warm = () => {
      const chunks: Array<() => Promise<unknown>> = [
        () => import("./pages/Orders"), () => import("./pages/OrderDetail"),
        () => import("./pages/Dashboard"), () => import("./pages/NewOrder"),
        () => import("./pages/Clients"), () => import("./pages/ClientHistory"),
        () => import("./pages/Invoices"), () => import("./pages/Expenses"),
        () => import("./pages/Payments"), () => import("./pages/ReadyStock"),
        () => import("./pages/Catalog"), () => import("./pages/Notifications"),
        () => import("./pages/Employees"), () => import("./pages/EmployeeDetail"),
        () => import("./pages/Suppliers"), () => import("./pages/SupplierHistory"),
        () => import("./pages/Factories"), () => import("./pages/FactoryHistory"),
        () => import("./pages/Stock"), () => import("./pages/StockSection"),
        () => import("./pages/Locker"), () => import("./pages/Reports"),
        () => import("./pages/Profile"), () => import("./pages/Settings"),
        () => import("./pages/Messages"), () => import("./pages/Income"),
        () => import("./pages/GiftCard"), () => import("./pages/GiftCardsAdmin"),
        () => import("./pages/BuyAssign"), () => import("./pages/ProductPhotos"),
      ];
      // Fetch a few at a time so we never contend with the current page's work.
      let i = 0;
      const step = () => {
        if (i >= chunks.length) return;
        chunks[i++]().catch(() => {});
        chunks[i++]?.().catch(() => {});
        window.setTimeout(step, 250);
      };
      step();
    };
    // Start after first paint so we never compete with the initial render.
    const id = window.setTimeout(warm, 1200);
    return () => clearTimeout(id);
  }, [user]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Public, no-login shared folder gallery */}
        <Route path="/s/:id" element={<Suspense fallback={<div className="min-h-screen grid place-items-center bg-[#F7F9FC] text-muted-foreground">Loading…</div>}><SharedGalleryPage /></Suspense>} />
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
          <Route path="product-photos" element={<ProductPhotosPage />} />
          <Route path="ai" element={<StarlinkAiPage />} />
          <Route path="locker" element={<Protected roles={["admin","employee"]}><LockerPage /></Protected>} />
          <Route path="suppliers" element={<Protected roles={["admin","employee"]}><SuppliersPage /></Protected>} />
          <Route path="suppliers/:id" element={<Protected roles={["admin","employee"]}><SupplierHistoryPage /></Protected>} />
          <Route path="stock" element={<Protected roles={["admin","employee"]}><StockPage /></Protected>} />
          <Route path="stock/:section" element={<Protected roles={["admin","employee"]}><StockSectionPage /></Protected>} />
          <Route path="factories" element={<Protected roles={["admin","employee"]}><FactoriesPage /></Protected>} />
          <Route path="factories/:id" element={<Protected roles={["admin","employee"]}><FactoryHistoryPage /></Protected>} />
          <Route path="ready-stock" element={<Protected roles={["admin","employee","client"]}><ReadyStockPage /></Protected>} />
          <Route path="giftcard" element={<Protected roles={["client"]}><GiftCardPage /></Protected>} />
          <Route path="gift-cards" element={<Protected roles={["admin","employee"]}><GiftCardsAdminPage /></Protected>} />
          <Route path="payments" element={<Protected roles={["admin","employee"]}><PaymentsPage /></Protected>} />
          <Route path="buy-assign" element={<Protected roles={["admin","employee"]}><BuyAssignPage /></Protected>} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
      {user && <NotificationPermissionModal />}
    </>
  );
}