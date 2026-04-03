export type BrowserTokenStorageStrategy = "memory+refresh-cookie" | "memory+rotating-refresh-token";

export interface BrowserSecurityBaseline {
  tokenStorageStrategy: BrowserTokenStorageStrategy;
  requireCSP: boolean;
  requireTrustedOrigins: boolean;
  denyLocalStorageForAccessToken: boolean;
  denySessionStorageForAccessToken: boolean;
  requireCsrfProtectionForCookieFlow: boolean;
}

export const browserSecurityBaselineV1: BrowserSecurityBaseline = {
  tokenStorageStrategy: "memory+rotating-refresh-token",
  requireCSP: true,
  requireTrustedOrigins: true,
  denyLocalStorageForAccessToken: true,
  denySessionStorageForAccessToken: true,
  requireCsrfProtectionForCookieFlow: true,
};

