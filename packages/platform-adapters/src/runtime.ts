import { detectClientRuntime } from "@project/client-core";

export function detectRuntime() {
  return detectClientRuntime(typeof window !== "undefined" ? window : undefined);
}

export function isTauriDesktopRuntime(): boolean {
  return detectRuntime().platform === "desktop-tauri";
}

