import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "@/i18n/locales/en";
import { ru as ruRaw } from "@/i18n/locales/ru";

export type AppLanguage = "ru" | "en";

export const LANGUAGE_STORAGE_KEY = "secure-messenger-language";

const supportedLanguages: AppLanguage[] = ["ru", "en"];

interface LocaleTree {
  [key: string]: LocaleNode;
}

type LocaleNode = string | LocaleTree;

function isRecord(value: unknown): value is LocaleTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCorruptedLocaleString(value: string) {
  if (!value.trim()) {
    return true;
  }

  if (value.includes("\uFFFD") || value.includes("????")) {
    return true;
  }

  // Typical mojibake markers when UTF-8 was decoded as CP-1251.
  return /(?:Р.|С.)[A-Za-z0-9]/.test(value);
}

function mergeLocaleNode(candidate: LocaleNode | undefined, fallback: LocaleNode): LocaleNode {
  if (typeof fallback === "string") {
    if (typeof candidate !== "string") {
      return fallback;
    }
    return isCorruptedLocaleString(candidate) ? fallback : candidate;
  }

  const candidateRecord = isRecord(candidate) ? candidate : {};
  const output: LocaleTree = {};

  for (const key of Object.keys(fallback)) {
    output[key] = mergeLocaleNode(candidateRecord[key], fallback[key]);
  }

  return output;
}

const ru = mergeLocaleNode(ruRaw, en) as typeof en;

export function detectPreferredLanguage(): AppLanguage {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : null;
  if (stored === "ru" || stored === "en") {
    return stored;
  }

  const navigatorLanguage = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "";
  if (navigatorLanguage.startsWith("en")) {
    return "en";
  }
  if (navigatorLanguage.startsWith("ru")) {
    return "ru";
  }
  return "ru";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: detectPreferredLanguage(),
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}

export function changeLanguage(nextLanguage: AppLanguage) {
  const normalized: AppLanguage = nextLanguage === "en" ? "en" : "ru";
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  }
  void i18n.changeLanguage(normalized);
}

export default i18n;
