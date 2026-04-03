import { HttpRequestError, requestJSON } from "./http";
import { buildApiURL } from "./api-url";

export interface AuthRequestContext {
  apiBaseUrl: string;
  apiPrefix: string;
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<boolean>;
  onForbidden?: () => void;
}

export async function requestJSONWithAuth<T>(
  context: AuthRequestContext,
  options: {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<T> {
  let accessToken = await context.getAccessToken();
  if (!accessToken) {
    const refreshed = await context.refreshAccessToken();
    if (!refreshed) {
      context.onForbidden?.();
      throw new HttpRequestError("missing access token", 401, "unauthorized");
    }
    accessToken = await context.getAccessToken();
  }

  if (!accessToken) {
    context.onForbidden?.();
    throw new HttpRequestError("missing access token", 401, "unauthorized");
  }

  const url = buildApiURL(context.apiBaseUrl, context.apiPrefix, options.path);

  try {
    return await requestJSON<T>({
      method: options.method,
      url,
      body: options.body,
      accessToken,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    if (error instanceof HttpRequestError && (error.status === 401 || error.status === 403)) {
      const refreshed = await context.refreshAccessToken();
      if (!refreshed) {
        context.onForbidden?.();
        throw error;
      }

      const refreshedToken = await context.getAccessToken();
      if (!refreshedToken) {
        context.onForbidden?.();
        throw error;
      }

      return requestJSON<T>({
        method: options.method,
        url,
        body: options.body,
        accessToken: refreshedToken,
        timeoutMs: options.timeoutMs,
      });
    }

    throw error;
  }
}
