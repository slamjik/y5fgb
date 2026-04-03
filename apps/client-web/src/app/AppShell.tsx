import React, { FormEvent, useMemo, useState } from "react";

import { useAuth } from "./auth-context";
import { useBootstrap } from "./bootstrap-context";
import { useTransport } from "./transport-context";

export function AppShell() {
  const bootstrap = useBootstrap();
  const auth = useAuth();
  const transport = useTransport();

  const [serverInput, setServerInput] = useState(bootstrap.serverConfig?.inputHost ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const phaseLabel = useMemo(() => {
    if (bootstrap.status === "booting") {
      return "Bootstrapping server configuration";
    }
    if (bootstrap.status === "needs_server") {
      return "Server connection required";
    }
    if (bootstrap.status === "error") {
      return "Server bootstrap failed";
    }
    if (auth.phase === "restoring") {
      return "Restoring browser session";
    }
    if (auth.phase === "two_fa_required") {
      return "Two-factor verification required";
    }
    if (auth.phase === "authenticated") {
      return "Session connected";
    }
    return "Authentication required";
  }, [auth.phase, bootstrap.status]);

  if (bootstrap.status === "booting") {
    return <StatusPanel title="Booting" message={phaseLabel} />;
  }

  if (bootstrap.status === "needs_server" || bootstrap.status === "error") {
    return (
      <main className="shell">
        <section className="card">
          <h1>Secure Messenger Web Foundation</h1>
          <p className="muted">Enter relay domain or IP to bootstrap API and transport configuration.</p>
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault();
              await bootstrap.connectToServer(serverInput);
            }}
          >
            <label>
              Server address
              <input
                value={serverInput}
                onChange={(event) => setServerInput(event.target.value)}
                placeholder="chat.example.com or 203.0.113.10:8080"
              />
            </label>
            <button type="submit">Connect</button>
          </form>
          {bootstrap.errorMessage ? <p className="error">{bootstrap.errorMessage}</p> : null}
          <p className="hint">Supported input: domain, https://domain, ip, ip:port</p>
        </section>
      </main>
    );
  }

  if (auth.phase === "restoring") {
    return <StatusPanel title="Restoring Session" message={phaseLabel} />;
  }

  if (auth.phase === "two_fa_required") {
    return (
      <main className="shell">
        <section className="card">
          <h1>Two-Factor Verification</h1>
          <p className="muted">Enter TOTP code from authenticator app.</p>
          <form
            className="form"
            onSubmit={async (event: FormEvent) => {
              event.preventDefault();
              await auth.verifyTwoFactor(twoFactorCode);
            }}
          >
            <label>
              Code
              <input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} placeholder="123456" />
            </label>
            <button type="submit">Verify and continue</button>
          </form>
          {auth.errorMessage ? <p className="error">{auth.errorMessage}</p> : null}
        </section>
      </main>
    );
  }

  if (auth.phase !== "authenticated" || !auth.session) {
    return (
      <main className="shell">
        <section className="card">
          <h1>Web Session Login</h1>
          <p className="muted">Browser sessions are isolated from trusted desktop devices.</p>
          <form
            className="form"
            onSubmit={async (event: FormEvent) => {
              event.preventDefault();
              await auth.login(email, password);
            }}
          >
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label>
              Session persistence
              <select
                value={auth.persistenceMode}
                onChange={(event) => auth.setPersistenceMode(event.target.value === "remembered" ? "remembered" : "ephemeral")}
              >
                <option value="ephemeral">Ephemeral (memory-only)</option>
                <option value="remembered">Remembered (refresh token persisted)</option>
              </select>
            </label>
            <button type="submit">Login</button>
          </form>
          {auth.errorMessage ? <p className="error">{auth.errorMessage}</p> : null}
          <p className="hint">Current phase: {phaseLabel}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="card stack-gap">
        <header className="row between">
          <div>
            <h1>Connected Technical Shell</h1>
            <p className="muted">Foundation state for future full web messaging UI.</p>
          </div>
          <div className="row gap-sm">
            <button type="button" onClick={() => transport.reconnect()}>
              Reconnect transport
            </button>
            <button type="button" onClick={() => void auth.logoutAll()}>
              Logout all
            </button>
            <button type="button" onClick={() => void auth.logout()}>
              Logout
            </button>
            <button
              type="button"
              onClick={async () => {
                await auth.logout();
                bootstrap.resetServerConfig();
              }}
            >
              Change server
            </button>
          </div>
        </header>

        <section className="grid two">
          <InfoCard
            title="Session"
            items={[
              ["Account", auth.session.accountId],
              ["Email", auth.session.email || "(not provided by API)"],
              ["2FA", auth.session.twoFactorEnabled ? "enabled" : "disabled"],
              ["Class", auth.session.session.sessionClass ?? "browser"],
              ["Platform", auth.session.session.clientPlatform ?? "web-browser"],
              ["Persistent", auth.session.session.persistent ? "yes" : "no"],
              ["Access expires", auth.session.session.accessTokenExpiresAt],
              ["Refresh expires", auth.session.session.refreshTokenExpiresAt],
            ]}
          />
          <InfoCard
            title="Server bootstrap"
            items={[
              ["API base", bootstrap.serverConfig?.apiBaseUrl ?? "-"],
              ["WS URL", bootstrap.serverConfig?.wsUrl ?? "-"],
              ["API prefix", bootstrap.serverConfig?.apiPrefix ?? "-"],
              ["Source", bootstrap.serverConfig?.source ?? "-"],
              ["Policy default", bootstrap.serverConfig?.policyHints?.browserSessionDefaultPersistence ?? "-"],
            ]}
          />
        </section>

        <section className="grid two">
          <InfoCard
            title="Transport runtime"
            items={[
              ["Mode", transport.runtime.mode],
              ["Status", transport.runtime.status],
              ["Endpoint", transport.runtime.endpoint ?? "-"],
              ["Cursor", String(transport.runtime.cursor)],
              ["Queue size", String(transport.runtime.queueSize)],
              ["Updated", transport.runtime.updatedAt],
            ]}
          />
          <InfoCard
            title="Lifecycle state machine"
            items={[
              ["State", transport.lifecycle.state],
              ["Recent events", transport.lifecycle.recentEvents.join(", ") || "-"],
              ["Last update", transport.lifecycle.updatedAt],
            ]}
          />
        </section>

        {transport.lastError ? <p className="error">Transport note: {transport.lastError}</p> : null}
      </section>
    </main>
  );
}

function StatusPanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="shell">
      <section className="card">
        <h1>{title}</h1>
        <p className="muted">{message}</p>
      </section>
    </main>
  );
}

function InfoCard({ title, items }: { title: string; items: Array<[string, string]> }) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      <dl className="kv">
        {items.map(([label, value]) => (
          <div className="kv-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
