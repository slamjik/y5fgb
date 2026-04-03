import React from "react";

import { AppShell } from "./app/AppShell";
import { AuthProvider } from "./app/auth-context";
import { BootstrapProvider } from "./app/bootstrap-context";
import { MessagingProvider } from "./app/messaging-context";
import { TransportProvider } from "./app/transport-context";

export function App() {
  return (
    <BootstrapProvider>
      <AuthProvider>
        <MessagingProvider>
          <TransportProvider>
            <AppShell />
          </TransportProvider>
        </MessagingProvider>
      </AuthProvider>
    </BootstrapProvider>
  );
}
