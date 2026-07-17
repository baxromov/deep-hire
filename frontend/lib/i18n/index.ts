import { admin } from "./dict/admin";
import { authLogin } from "./dict/authLogin";
import { candidateShared } from "./dict/candidateShared";
import { candidatesDetail } from "./dict/candidatesDetail";
import { candidatesList } from "./dict/candidatesList";
import { common } from "./dict/common";
import { dashboard } from "./dict/dashboard";
import { matchingUi } from "./dict/matchingUi";
import { nav } from "./dict/nav";
import { profileSettings } from "./dict/profileSettings";
import { vacanciesDetail } from "./dict/vacanciesDetail";
import { vacanciesEdit } from "./dict/vacanciesEdit";
import { vacanciesHhDetail } from "./dict/vacanciesHhDetail";
import { vacanciesList } from "./dict/vacanciesList";
import { vacancyCard } from "./dict/vacancyCard";
import { vacancyForm } from "./dict/vacancyForm";

// Each entry contributes { uz, ru, en } string maps for its own namespace.
// New dict files get added here as they're written — dict files themselves
// are never touched by more than one editor at a time, only this list is.
const PARTS = [
  common,
  authLogin,
  dashboard,
  nav,
  vacancyCard,
  vacancyForm,
  matchingUi,
  candidateShared,
  vacanciesDetail,
  vacanciesEdit,
  vacanciesList,
  vacanciesHhDetail,
  candidatesList,
  candidatesDetail,
  admin,
  profileSettings,
];

export type Locale = "uz" | "ru" | "en";
export const LOCALES: Locale[] = ["uz", "ru", "en"];
export const DEFAULT_LOCALE: Locale = "ru";

export const LOCALE_LABELS: Record<Locale, string> = {
  uz: "UZ",
  ru: "RU",
  en: "EN",
};

function merge(locale: Locale): Record<string, string> {
  return Object.assign({}, ...PARTS.map((p) => p[locale]));
}

export const dictionaries: Record<Locale, Record<string, string>> = {
  uz: merge("uz"),
  ru: merge("ru"),
  en: merge("en"),
};
