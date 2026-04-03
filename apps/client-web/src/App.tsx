import React from "react";

import { AppShell } from "./app/AppShell";
import { AuthProvider } from "./app/auth-context";
import { BootstrapProvider } from "./app/bootstrap-context";
import { TransportProvider } from "./app/transport-context";

export function App() {
  return (
    <BootstrapProvider>
      <AuthProvider>
        <TransportProvider>
          <AppShell />
        </TransportProvider>
      </AuthProvider>
    </BootstrapProvider>
  );
}
