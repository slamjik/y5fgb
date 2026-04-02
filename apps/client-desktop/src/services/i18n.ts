import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "@/i18n/locales/en";
import { ru } from "@/i18n/locales/ru";

export type AppLanguage = "ru" | "en";

export const LANGUAGE_STORAGE_KEY = "secure-messenger-language";

const supportedLanguages: AppLanguage[] = ["ru", "en"];

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
    fallbackLng: "ru",
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

