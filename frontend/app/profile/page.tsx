"use client";

import { authApi } from "@/lib/api";
import useSWR from "swr";
import { useLocale } from "@/lib/i18n/context";
import { LOCALES } from "@/lib/i18n";
import { Skeleton, SkeletonAvatar, SkeletonLine } from "@/components/ui/skeleton";

interface Profile {
  id: string;
  username: string;
  email: string;
  role: "admin" | "staff";
  full_name: string;
  is_active: boolean;
}

function Row({ label, value }: { label: string; value?: string | boolean | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-100 last:border-0">
      <span className="w-36 shrink-0 text-sm text-gray-400">{label}</span>
      <span className="text-sm text-gray-900">{String(value)}</span>
    </div>
  );
}

const LANGUAGE_KEYS = {
  uz: "profile.languageUz",
  ru: "profile.languageRu",
  en: "profile.languageEn",
} as const;

export default function ProfilePage() {
  const { t, locale, setLocale } = useLocale();
  const { data: profile, isLoading } = useSWR<Profile>(
    "me",
    () => authApi.me().then((r) => r.data)
  );

  if (isLoading) {
    return (
      <div className="max-w-xl">
        <Skeleton className="h-6 w-24 mb-6" />

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center gap-4 mb-6">
            <SkeletonAvatar className="h-14 w-14" />
            <div className="space-y-2">
              <SkeletonLine className="h-4 w-32" />
              <SkeletonLine className="h-3.5 w-20" />
            </div>
          </div>

          <div className="space-y-3">
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const displayName = profile.full_name || profile.username;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const roleLabel = t(profile.role === "admin" ? "nav.admin" : "nav.staff");

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">{t("profile.title")}</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center text-xl font-semibold text-gray-500">
            {initials}
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">{displayName}</p>
            <p className="text-sm text-gray-400">{roleLabel}</p>
          </div>
        </div>

        <div>
          <Row label={t("profile.username")} value={profile.username} />
          <Row label={t("profile.email")} value={profile.email} />
          <Row label={t("profile.role")} value={roleLabel} />
          <Row
            label={t("profile.active")}
            value={profile.is_active ? t("common.yes") : t("common.no")}
          />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">{t("profile.settingsTitle")}</h2>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-gray-400">{t("profile.languageLabel")}</span>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {LOCALES.map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  locale === l ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {t(LANGUAGE_KEYS[l])}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
