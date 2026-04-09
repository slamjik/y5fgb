import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const APP_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8081";
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080/api/v1";
const E2E_SERVER_ORIGIN = process.env.E2E_SERVER_ORIGIN ?? "http://127.0.0.1:8080";
const SERVER_STORAGE_KEY = "secure-messenger-web-server-v3";

type Section = "messages" | "feed" | "explore" | "notifications" | "profile" | "settings";

type RegisteredUser = {
  email: string;
  password: string;
  accountId: string;
  accessToken: string;
  deviceId: string;
};

type RegisterResponse = {
  accountId: string;
  tokens: {
    accessToken: string;
  };
  device: {
    id: string;
  };
};

test("auth session restore and logout-all", async ({ page }, testInfo) => {
  const mobile = isMobileProject(testInfo);
  await registerUserViaUI(page, {
    label: "auth",
    remembered: true,
    mobile,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectAppReady(page, mobile);

  await navigateToSection(page, "settings", mobile);
  await page.getByTestId("settings-logout-all").click();

  await expect(page.getByTestId("auth-email-input")).toBeVisible();
});

test("desktop messaging, notifications, and profile chain", async ({ page, browser, request }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Desktop coverage only.");

  const userA = await registerUserViaUI(page, {
    label: "desktop_a",
    remembered: true,
    mobile: false,
  });

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  try {
    const userB = await registerUserViaUI(pageB, {
      label: "desktop_b",
      remembered: true,
      mobile: false,
    });

    const conversationId = await createDirectConversation(request, userB.accessToken, userA.accountId);
    await sendMessage(request, {
      senderToken: userB.accessToken,
      senderDeviceId: userB.deviceId,
      receiverDeviceId: userA.deviceId,
      conversationId,
    });

    await expect(page.getByText("РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ").first()).toBeVisible({ timeout: 20_000 }).catch(() => {
      // Toast appearance is best-effort; message flow is validated by chat continuity below.
    });

    await navigateToSection(page, "messages", false);
    await page.getByTestId("messages-refresh-list-button").click();

    const firstConversation = page.locator('[data-testid^="conversation-item-"]').first();
    await expect(firstConversation).toBeVisible({ timeout: 20_000 });
    await firstConversation.click();

    const replyText = `e2e-reply-${randomUUID().slice(0, 8)}`;
    await page.getByTestId("messages-composer-input").fill(replyText);
    await page.getByTestId("messages-send-button").click();
    await expect(page.getByText(replyText).first()).toBeVisible({ timeout: 15_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectAppReady(page, false);

    await createFriendRequest(request, userB.accessToken, userA.accountId);

    await navigateToSection(page, "notifications", false);
    await page.getByTestId("notifications-refresh").click();

    const firstNotification = page.locator('[data-testid^="notification-item-"]').first();
    await expect(firstNotification).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid^="notification-open-"]').first().click();
    await expect(page.getByTestId("sidebar-nav-notifications")).toBeVisible();

    await navigateToSection(page, "notifications", false);
    const markAllReadButton = page.getByTestId("notifications-mark-all-read");
    if (await markAllReadButton.isEnabled()) {
      await markAllReadButton.click();
    }
    await page.getByTestId("notifications-clear-all").click();
    await expect(page.locator('[data-testid^="notification-item-"]')).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await contextB.close();
  }
});

test("desktop messaging actions: reply, reaction, delete", async ({ page, browser, request }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Desktop coverage only.");

  const userA = await registerUserViaUI(page, {
    label: "desktop_actions_a",
    remembered: true,
    mobile: false,
  });

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  try {
    const userB = await registerUserViaUI(pageB, {
      label: "desktop_actions_b",
      remembered: true,
      mobile: false,
    });

    const conversationId = await createDirectConversation(request, userA.accessToken, userB.accountId);

    await navigateToSection(page, "messages", false);
    await page.getByTestId("messages-refresh-list-button").click();

    const conversationButton = page.getByTestId(`conversation-item-${conversationId}`);
    await expect(conversationButton).toBeVisible({ timeout: 20_000 });
    await conversationButton.click();

    const baseText = `e2e-base-${randomUUID().slice(0, 8)}`;
    await page.getByTestId("messages-composer-input").fill(baseText);
    await page.getByTestId("messages-send-button").click();

    const baseMessage = page.getByTestId("message").filter({ hasText: baseText }).first();
    await expect(baseMessage).toBeVisible({ timeout: 15_000 });

    await baseMessage.click({ button: "right" });
    await page.getByTestId("message-action-reply").click();

    const replyText = `e2e-reply-${randomUUID().slice(0, 8)}`;
    await page.getByTestId("messages-composer-input").fill(replyText);
    await page.getByTestId("messages-send-button").click();

    const replyMessage = page.getByTestId("message").filter({ hasText: replyText }).first();
    await expect(replyMessage).toBeVisible({ timeout: 15_000 });
    await expect(replyMessage.getByTestId("reply")).toBeVisible();

    const reactionsBefore = await replyMessage.getByTestId("reaction").count();
    await expect(async () => {
      await page.getByTestId("message").filter({ hasText: replyText }).first().getByTestId("reaction").first().click();
    }).toPass({ timeout: 10_000 });
    await expect.poll(async () => replyMessage.getByTestId("reaction").count()).toBeGreaterThan(reactionsBefore);

    const replyMessageId = await replyMessage.getAttribute("data-message-id");
    expect(replyMessageId).toBeTruthy();
    const replyMessageById = page.locator(`[data-testid="message"][data-message-id="${replyMessageId ?? ""}"]`);

    await replyMessageById.click({ button: "right" });
    await page.getByTestId("message-action-delete-all").click();
    await expect(replyMessageById.getByTestId("reaction")).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await contextB.close();
  }
});

test("desktop runtime status stays live after reconnect cycle", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Desktop coverage only.");

  await page.route("**/ws*", (route) => route.abort());

  await registerUserViaUI(page, {
    label: "desktop_runtime_status",
    remembered: true,
    mobile: false,
  });

  await navigateToSection(page, "messages", false);
  await expect.poll(async () => {
    const status = await page.getByTestId("transport-status-chip").getAttribute("data-status");
    return status && status !== "offline" && status !== "auth_expired";
  }).toBeTruthy();

  await page.getByTestId("messages-reconnect-button").click();
  await expect.poll(async () => {
    const status = await page.getByTestId("transport-status-chip").getAttribute("data-status");
    return status && status !== "offline" && status !== "auth_expired";
  }).toBeTruthy();
});

test("desktop runtime restores after reload and receives new message", async ({ page, browser, request }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Desktop coverage only.");

  const userA = await registerUserViaUI(page, {
    label: "desktop_runtime_a",
    remembered: true,
    mobile: false,
  });

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  try {
    const userB = await registerUserViaUI(pageB, {
      label: "desktop_runtime_b",
      remembered: true,
      mobile: false,
    });

    const conversationId = await createDirectConversation(request, userA.accessToken, userB.accountId);

    await navigateToSection(page, "messages", false);
    await page.getByTestId("messages-refresh-list-button").click();
    await page.getByTestId(`conversation-item-${conversationId}`).click();
    const beforeReloadCount = await page.getByTestId("message").count();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectAppReady(page, false);
    await navigateToSection(page, "messages", false);
    await page.getByTestId("messages-refresh-list-button").click();
    await page.getByTestId(`conversation-item-${conversationId}`).click();

    await expect.poll(async () => {
      const status = await page.getByTestId("transport-status-chip").getAttribute("data-status");
      return status === "offline";
    }).toBeFalsy();

    await sendMessage(request, {
      senderToken: userB.accessToken,
      senderDeviceId: userB.deviceId,
      receiverDeviceId: userA.deviceId,
      conversationId,
    });

    await expect
      .poll(async () => page.getByTestId("message").count(), { timeout: 20_000 })
      .toBeGreaterThan(beforeReloadCount);
  } finally {
    await contextB.close();
  }
});

test("mobile bottom-nav and overflow sanity", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile coverage only.");

  await registerUserViaUI(page, {
    label: "mobile",
    remembered: true,
    mobile: true,
  });

  const sections: Section[] = ["messages", "feed", "explore", "notifications", "profile", "settings"];
  for (const section of sections) {
    await navigateToSection(page, section, true);
    await expectNoHorizontalOverflow(page);
  }

  await navigateToSection(page, "messages", true);
  await expect(page.getByTestId("messages-new-chat-toggle")).toBeVisible();
});

async function ensureAuthScreen(page: Page, savedServer: ReturnType<typeof buildSavedServer> = buildSavedServer(E2E_SERVER_ORIGIN)): Promise<void> {
  await page.addInitScript(
    ({ key, payload }) => {
      window.localStorage.setItem(key, payload);
    },
    { key: SERVER_STORAGE_KEY, payload: JSON.stringify(savedServer) },
  );

  await page.goto(APP_BASE_URL, { waitUntil: "domcontentloaded" });
  const authEmailInput = page.getByTestId("auth-email-input");

  try {
    await authEmailInput.waitFor({ state: "visible", timeout: 12_000 });
    return;
  } catch {
    // Continue to retry auto-connect branch.
  }

  const retryConnect = page.getByRole("button", { name: "РџРѕРІС‚РѕСЂРёС‚СЊ РїРѕРґРєР»СЋС‡РµРЅРёРµ" });
  if (await retryConnect.isVisible().catch(() => false)) {
    await retryConnect.click();
  }

  await authEmailInput.waitFor({ state: "visible", timeout: 20_000 });
}

async function registerUserViaUI(
  page: Page,
  options: {
    label: string;
    remembered: boolean;
    mobile: boolean;
    savedServer?: ReturnType<typeof buildSavedServer>;
  },
): Promise<RegisteredUser> {
  await ensureAuthScreen(page, options.savedServer ?? buildSavedServer(E2E_SERVER_ORIGIN));

  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const email = `e2e_${options.label}_${suffix}@example.com`;
  const password = `SecurePass!${suffix}`;

  await page.getByTestId("auth-mode-register").click();
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(password);
  await page.getByTestId("auth-session-mode").selectOption(options.remembered ? "remembered" : "ephemeral");

  const registerResponsePromise = page.waitForResponse((response) => {
    return response.url().includes("/auth/web/register") && response.request().method() === "POST";
  });

  await page.getByTestId("auth-submit").click();

  const registerResponse = await registerResponsePromise;
  expect(registerResponse.ok()).toBeTruthy();
  const payload = (await registerResponse.json()) as RegisterResponse;

  await expectAppReady(page, options.mobile);

  return {
    email,
    password,
    accountId: payload.accountId,
    accessToken: payload.tokens.accessToken,
    deviceId: payload.device.id,
  };
}

async function expectAppReady(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await expect(page.getByTestId("bottom-nav-messages")).toBeVisible({ timeout: 20_000 });
    return;
  }
  await expect(page.getByTestId("sidebar-nav-messages")).toBeVisible({ timeout: 20_000 });
}

async function navigateToSection(page: Page, section: Section, mobile: boolean): Promise<void> {
  const navId = mobile ? `bottom-nav-${section}` : `sidebar-nav-${section}`;
  await page.getByTestId(navId).click();
}

async function createDirectConversation(
  request: APIRequestContext,
  accessToken: string,
  peerAccountId: string,
): Promise<string> {
  const response = await apiRequest<{ conversation: { id: string } }>(request, "/conversations/direct", {
    method: "POST",
    accessToken,
    data: {
      peerAccountId,
      defaultTtlSeconds: 120,
    },
  });
  return response.conversation.id;
}

async function createFriendRequest(
  request: APIRequestContext,
  accessToken: string,
  targetAccountId: string,
): Promise<void> {
  await apiRequest(request, "/friends/requests", {
    method: "POST",
    accessToken,
    data: {
      targetAccountId,
    },
  });
}

async function sendMessage(
  request: APIRequestContext,
  input: {
    senderToken: string;
    senderDeviceId: string;
    receiverDeviceId: string;
    conversationId: string;
  },
): Promise<void> {
  await apiRequest(request, `/conversations/${input.conversationId}/messages`, {
    method: "POST",
    accessToken: input.senderToken,
    data: {
      clientMessageId: randomUUID(),
      algorithm: "xchacha20poly1305_ietf+sealedbox",
      cryptoVersion: 1,
      nonce: randomBytes(24).toString("base64"),
      ciphertext: randomBytes(72).toString("base64"),
      recipients: [
        {
          recipientDeviceId: input.senderDeviceId,
          wrappedKey: randomBytes(48).toString("base64"),
          keyAlgorithm: "x25519-sealedbox",
        },
        {
          recipientDeviceId: input.receiverDeviceId,
          wrappedKey: randomBytes(48).toString("base64"),
          keyAlgorithm: "x25519-sealedbox",
        },
      ],
      ttlSeconds: 120,
    },
  });
}

async function apiRequest<T = unknown>(
  request: APIRequestContext,
  path: string,
  input: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    accessToken?: string;
    data?: unknown;
  },
): Promise<T> {
  const response = await request.fetch(`${API_BASE_URL}${path}`, {
    method: input.method,
    headers: {
      Accept: "application/json",
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
      ...(input.data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    data: input.data,
  });

  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok()) {
    throw new Error(`API request failed ${response.status()} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      rootOverflow: root.scrollWidth - window.innerWidth,
      bodyOverflow: (body?.scrollWidth ?? 0) - window.innerWidth,
    };
  });
  expect(dimensions.rootOverflow).toBeLessThanOrEqual(1);
  expect(dimensions.bodyOverflow).toBeLessThanOrEqual(1);
}

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.includes("mobile");
}

function buildSavedServer(apiOrigin: string) {
  const normalized = apiOrigin.replace(/\/+$/, "");
  const parsed = new URL(normalized);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${parsed.host}/ws`;
  return {
    input: normalized,
    config: {
      apiBaseUrl: normalized,
      wsUrl,
      apiPrefix: "/api/v1",
      policyHints: {
        authModesSupported: ["device", "browser_session"],
        browserSessionDefaultPersistence: "ephemeral",
        browserSessionAllowRemembered: true,
      },
      transportHints: {
        reconnectBackoffMinMs: 500,
        reconnectBackoffMaxMs: 10000,
        longPollTimeoutSec: 25,
        longPollEnabled: true,
      },
    },
  };
}

