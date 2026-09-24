/**
 * Translation key convention
 *
 * 1. Path: <namespace>.<section>.<element> — e.g. auth.login.title
 * 2. Namespace = JSON file name (auth, modals, errors, ...)
 * 3. Section = component / feature area (login, forgot, settings)
 * 4. Element = role of the string (title, description, placeholder, submit, success, fail)
 * 5. Keys are camelCase. Common abbreviations are OK (desc, aria, url)
 * 6. Plural keys use i18next's _one / _other suffix
 * 7. Shared strings live under common.*
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import common from "./locales/en/common.json";
import auth from "./locales/en/auth.json";
import modals from "./locales/en/modals.json";
import enums from "./locales/en/enums.json";
import errors from "./locales/en/errors.json";

const resources = {
  en: { common, auth, modals, enums, errors },
};

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: "en",
      supportedLngs: ["en"],
      defaultNS: "common",
      ns: ["common", "auth", "modals", "enums", "errors"],
      resources,
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "i18nextLng",
        caches: ["localStorage"],
      },
      react: { useSuspense: false },
      returnNull: false,
      saveMissing: process.env.NODE_ENV === "development",
      missingKeyHandler: (lngs, ns, key) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[i18n] Missing key "${ns}:${key}" for ${lngs?.join(",")}`);
        }
      },
    });
}

export default i18n;
