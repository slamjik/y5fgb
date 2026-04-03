import { Navigate, createBrowserRouter } from "react-router-dom";

import { RequireAnonymous, RequireAuth, RequireMissingServerConnection } from "@/app/guards";
import { AppLayout } from "@/components/AppLayout";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { TwoFAVerifyPage } from "@/features/auth/TwoFAVerifyPage";
import { DevicesPage } from "@/features/devices/DevicesPage";
import { FriendsPage } from "@/features/friends/FriendsPage";
import { HomePage } from "@/features/home/HomePage";
import { ConversationListPage } from "@/features/messaging/ConversationListPage";
import { ConversationPage } from "@/features/messaging/ConversationPage";
import { GroupMembersPage } from "@/features/messaging/GroupMembersPage";
import { PendingQueuePage } from "@/features/messaging/PendingQueuePage";
import { TransportHealthPage } from "@/features/messaging/TransportHealthPage";
import { OnboardingPage } from "@/features/onboarding/OnboardingPage";
import { PendingApprovalPage } from "@/features/pending/PendingApprovalPage";
import { PluginPanelPage } from "@/features/plugins/PluginPanelPage";
import { PluginsPage } from "@/features/plugins/PluginsPage";
import { SecurityEventsPage } from "@/features/security/SecurityEventsPage";
import { ServerConnectPage } from "@/features/server/ServerConnectPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      {
        element: <RequireMissingServerConnection />,
        children: [{ path: "connect-server", element: <ServerConnectPage /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <ConversationListPage /> },
          { path: "home", element: <HomePage /> },
          { path: "devices", element: <DevicesPage /> },
          { path: "friends", element: <FriendsPage /> },
          { path: "security-events", element: <SecurityEventsPage /> },
          { path: "plugins", element: <PluginsPage /> },
          { path: "plugins/panels/:pluginId/:panelId", element: <PluginPanelPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "onboarding", element: <OnboardingPage /> },
          { path: "conversations/:conversationId", element: <ConversationPage /> },
          { path: "conversations/:conversationId/members", element: <GroupMembersPage /> },
          { path: "messaging/outbox", element: <PendingQueuePage /> },
          { path: "messaging/transport", element: <TransportHealthPage /> },
        ],
      },
      {
        element: <RequireAnonymous />,
        children: [
          { path: "auth/login", element: <LoginPage /> },
          { path: "auth/register", element: <RegisterPage /> },
          { path: "auth/2fa", element: <TwoFAVerifyPage /> },
        ],
      },
      { path: "pending-approval", element: <PendingApprovalPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
