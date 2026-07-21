import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Route, Switch } from "wouter";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import DashboardPage from "@/pages/dashboard";
import CustomersPage from "@/pages/customers";
import CustomerDetailPage from "@/pages/customer-detail";
import SubscriptionsPage from "@/pages/subscriptions";
import PlansPage from "@/pages/plans";
import InvoicesPage from "@/pages/invoices";
import VouchersPage from "@/pages/vouchers";
import RoutersPage from "@/pages/routers";
import RadiusPage from "@/pages/radius";
import NetworkMonitorPage from "@/pages/mikrotik-monitor";
import NotificationsPage from "@/pages/notifications";
import UsersPage from "@/pages/users";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import PendingApprovalsPage from "@/pages/pending-approvals";
import SetupWizardPage from "@/pages/setup-wizard";

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

export default function App() {
  return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}><QueryClientProvider client={client}><AuthProvider><Switch>
    <Route path="/login" component={LoginPage} />
    <Route path="/register" component={RegisterPage} />
    <Route path="/forgot-password" component={ForgotPasswordPage} />
    <Route path="/reset-password" component={ResetPasswordPage} />
    <Route path="/setup" component={SetupWizardPage} />
    <Route path="/" component={DashboardPage} />
    <Route path="/customers" component={CustomersPage} />
    <Route path="/customers/:id" component={CustomerDetailPage} />
    <Route path="/subscriptions" component={SubscriptionsPage} />
    <Route path="/plans" component={PlansPage} />
    <Route path="/invoices" component={InvoicesPage} />
    <Route path="/vouchers" component={VouchersPage} />
    <Route path="/routers" component={RoutersPage} />
    <Route path="/network-monitor" component={NetworkMonitorPage} />
    <Route path="/radius" component={RadiusPage} />
    <Route path="/notifications" component={NotificationsPage} />
    <Route path="/users" component={UsersPage} />
    <Route path="/pending-approvals" component={PendingApprovalsPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route><Redirect to="/" /></Route>
  </Switch><Toaster /></AuthProvider></QueryClientProvider></ThemeProvider>;
}
