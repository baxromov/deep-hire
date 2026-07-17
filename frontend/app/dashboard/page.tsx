"use client";

import Link from "next/link";
import useSWR from "swr";
import { Briefcase, Users, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { dashboardApi } from "@/lib/api";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CountUp } from "@/components/dashboard/CountUp";
import { RadialGauge } from "@/components/dashboard/RadialGauge";
import { TrendChart } from "@/components/dashboard/TrendChart";
import type { VacancyStatus } from "@/types/vacancy";
import type { DashboardStats, HhQuota, TeamActivityEntry } from "@/types/dashboard";

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
const LOCALE_MAP: Record<string, string> = { uz: "uz-UZ", ru: "ru-RU", en: "en-US" };

const SOURCE_KEY: Record<string, string> = {
  db_search: "dashboard.sourceDbSearch",
  hh: "dashboard.sourceHh",
  hh_responses: "dashboard.sourceHhResponses",
  combined: "dashboard.sourceCombined",
  cleverstaff: "dashboard.sourceCleverstaff",
  xlsx: "dashboard.sourceXlsx",
  file: "dashboard.sourceFile",
};

const STATUS_ORDER: VacancyStatus[] = ["approved", "draft", "closed", "archived"];

function Card({
  title, icon, accent, children, className = "", style,
}: { title?: string; icon?: React.ReactNode; accent?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-in fade-in-0 slide-in-from-bottom-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm duration-700 ${className}`}
      style={style}
    >
      {title && (
        <div className="mb-4 flex items-center gap-2.5">
          {icon && (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: `${accent}15`, color: accent, border: `1px solid ${accent}30` }}
            >
              {icon}
            </div>
          )}
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}

function SourceBars({ data, t }: { data: Record<string, number>; t: (k: string, vars?: Record<string, string | number>) => string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries.map(([key, count]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-gray-500">{t(SOURCE_KEY[key] || "dashboard.sourceUnknown")}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-400 transition-all duration-700" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right font-semibold text-gray-700">{fmt(count)}</span>
        </div>
      ))}
    </div>
  );
}

function TeamActivityList({ data, t }: { data: TeamActivityEntry[]; t: (k: string, vars?: Record<string, string | number>) => string }) {
  const max = Math.max(1, ...data.map((d) => d.vacancies + d.matches));
  return (
    <div className="space-y-3">
      {data.map((entry, i) => {
        const initials = (entry.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
        const total = entry.vacancies + entry.matches;
        return (
          <div key={entry.user_id} className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
              {i === 0 && total > 0 ? <Trophy className="h-4 w-4 text-amber-500" /> : initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-800">{entry.name}</span>
                <span className="shrink-0 text-xs text-gray-400">
                  {entry.vacancies} {t("dashboard.teamActivityVacancies")} · {entry.matches} {t("dashboard.teamActivityMatches")}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-700"
                  style={{ width: `${(total / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HeroChip({ icon, value, label, delay }: { icon: React.ReactNode; value: number; label: string; delay: number }) {
  return (
    <div
      className="animate-in fade-in-0 slide-in-from-bottom-3 flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm duration-700"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-white">{icon}</div>
      <div>
        <p className="text-xl font-bold text-white leading-none">
          <CountUp value={value} />
        </p>
        <p className="mt-1 text-[11px] font-medium text-white/70">{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const { data: stats, error: statsError } = useSWR<DashboardStats>(
    "dashboard-stats",
    () => dashboardApi.stats().then((r) => r.data),
    { refreshInterval: 60_000 }
  );
  const { data: quota, error: quotaError } = useSWR<HhQuota>(
    "dashboard-hh-quota",
    () => dashboardApi.hhQuota().then((r) => r.data),
    { refreshInterval: 60_000 }
  );

  const now = new Date();
  const hour = now.getHours();
  const greetKey = hour < 12 ? "dashboard.greetingMorning" : hour < 18 ? "dashboard.greetingDay" : "dashboard.greetingEvening";
  const firstName = (user?.full_name || user?.username || "").split(" ")[0];
  const dateLabel = new Intl.DateTimeFormat(LOCALE_MAP[locale] || "ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(now);

  const usedPercent = quota?.resume_views.used_percent ?? 0;
  const gaugeColor = usedPercent >= 90 ? "#ef4444" : usedPercent >= 70 ? "#f59e0b" : "#16a34a";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 via-emerald-600 to-teal-600 p-6 shadow-lg sm:p-8">
        <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <p className="animate-in fade-in-0 slide-in-from-bottom-2 text-xl font-bold text-white duration-700 sm:text-2xl">
            {firstName ? t(greetKey, { name: firstName }) : t("dashboard.title")}
          </p>
          <p className="animate-in fade-in-0 slide-in-from-bottom-2 mt-1 text-sm capitalize text-white/80 duration-700">{dateLabel}</p>
          {stats && (
            <p className="animate-in fade-in-0 slide-in-from-bottom-2 mt-0.5 text-xs text-white/60 duration-700">
              {t(stats.scope === "admin" ? "dashboard.subtitle" : "dashboard.subtitlePersonal")}
            </p>
          )}

          {stats && (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <HeroChip icon={<Briefcase className="h-4 w-4" />} value={stats.vacancies.total} label={t("dashboard.heroActiveVacancies")} delay={80} />
              <HeroChip icon={<Users className="h-4 w-4" />} value={stats.candidates.total} label={t("dashboard.heroCandidatePool")} delay={160} />
              <HeroChip icon={<Sparkles className="h-4 w-4" />} value={stats.matches.today} label={t("dashboard.heroMatchesToday")} delay={240} />
            </div>
          )}
        </div>
      </div>

      {/* HH.ru quota */}
      {quotaError ? (
        <Card><p className="text-sm text-red-500">{t("dashboard.hhQuotaError")}</p></Card>
      ) : !quota ? (
        <Card>
          <SkeletonLine className="mb-3 h-4 w-40" />
          <div className="flex gap-4">
            <Skeleton className="h-32 w-32 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          </div>
        </Card>
      ) : (
        <Card title={t("dashboard.hhQuotaTitle")} icon={<TrendingUp className="h-4 w-4" />} accent={gaugeColor} style={{ animationDelay: "60ms" }}>
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <RadialGauge percent={usedPercent} color={gaugeColor}>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">
                  <CountUp value={Math.round(usedPercent)} formatter={(n) => `${n}%`} />
                </p>
              </div>
            </RadialGauge>

            <div className="w-full flex-1 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <p className="text-lg font-bold text-gray-900">
                  {t("dashboard.hhQuotaViewsUsed", { spent: quota.resume_views.spent, limit: quota.resume_views.limit })}
                </p>
                <div className="text-right text-xs text-gray-400">
                  <p className="font-semibold" style={{ color: gaugeColor }}>{t("dashboard.hhQuotaLeft", { left: quota.resume_views.left })}</p>
                  <p>{t("dashboard.hhQuotaResetsIn", { time: quota.resets.in })}</p>
                </div>
              </div>

              {quota.accounts.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {quota.accounts.map((acc) => (
                    <div key={acc.account_id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">{acc.label || acc.account_id}</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${acc.status === "active" ? "bg-emerald-500" : "bg-gray-300"}`} />
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {t("dashboard.hhQuotaAccountViews", { used: acc.views_used_today, cap: acc.daily_view_cap })}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {t("dashboard.hhQuotaAccountContacts", { used: acc.contacts_used_today, cap: acc.daily_contact_cap })}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {Object.keys(quota.spent_today_by_tool).length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
                  {Object.entries(quota.spent_today_by_tool).map(([tool, count]) => (
                    <span key={tool} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                      {tool} · {fmt(count)}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-gray-400">{t("dashboard.hhQuotaSharedNote")}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Trend chart */}
      {stats && stats.matches.trend.some((d) => d.count > 0) && (
        <Card title={t("dashboard.trendTitle")} icon={<TrendingUp className="h-4 w-4" />} accent="#0d9488" style={{ animationDelay: "100ms" }}>
          <p className="-mt-2 mb-4 text-xs text-gray-400">{t("dashboard.trendSubtitle")}</p>
          <TrendChart data={stats.matches.trend} color="#0d9488" locale={locale} />
        </Card>
      )}

      {/* Project stats */}
      {statsError ? (
        <Card><p className="text-sm text-red-500">{t("dashboard.loadError")}</p></Card>
      ) : !stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card title={t("dashboard.vacanciesTitle")} icon={<Briefcase className="h-4 w-4" />} accent="#ec4899" style={{ animationDelay: "140ms" }}>
            <p className="text-3xl font-bold text-gray-900"><CountUp value={stats.vacancies.total} /></p>
            <p className="mb-3 text-xs text-gray-400">{t("dashboard.vacanciesTotal")}</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.filter((s) => stats.vacancies.by_status[s]).map((s) => (
                <span key={s} className="flex items-center gap-1 rounded-full border border-gray-100 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                  <StatusBadge status={s} />
                  <span className="font-semibold">{fmt(stats.vacancies.by_status[s])}</span>
                </span>
              ))}
            </div>
            {stats.vacancies.hh_tracked > 0 && (
              <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-400">
                {t("dashboard.vacanciesHhTracked")}: <span className="font-semibold text-gray-600">{fmt(stats.vacancies.hh_tracked)}</span>
              </p>
            )}
          </Card>

          <Card title={t("dashboard.candidatesTitle")} icon={<Users className="h-4 w-4" />} accent="#8b5cf6" style={{ animationDelay: "180ms" }}>
            <p className="text-3xl font-bold text-gray-900"><CountUp value={stats.candidates.total} /></p>
            <p className="mb-3 text-xs text-gray-400">{t("dashboard.candidatesTotal")}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-emerald-50 px-2.5 py-1.5">
                <p className="font-bold text-emerald-700">{fmt(stats.candidates.saved)}</p>
                <p className="text-emerald-600/70">{t("dashboard.candidatesSaved")}</p>
              </div>
              <div className="rounded-lg bg-amber-50 px-2.5 py-1.5">
                <p className="font-bold text-amber-700">{fmt(stats.candidates.staged)}</p>
                <p className="text-amber-600/70">{t("dashboard.candidatesStaged")}</p>
              </div>
            </div>
            {Object.keys(stats.candidates.by_source).length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <SourceBars data={stats.candidates.by_source} t={t} />
              </div>
            )}
          </Card>

          <Card title={t("dashboard.matchesTitle")} icon={<Sparkles className="h-4 w-4" />} accent="#3b82f6" style={{ animationDelay: "220ms" }}>
            <div className="flex items-baseline gap-3">
              <p className="text-3xl font-bold text-gray-900"><CountUp value={stats.matches.total} /></p>
              <span className="text-xs text-gray-400">
                {t("dashboard.matchesToday")}: <span className="font-semibold text-gray-600">{fmt(stats.matches.today)}</span>
              </span>
            </div>
            <p className="mb-3 text-xs text-gray-400">{t("dashboard.matchesTotal")}</p>
            {Object.keys(stats.matches.by_source).length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <SourceBars data={stats.matches.by_source} t={t} />
              </div>
            )}
            {stats.matches.staged_unconfirmed > 0 && (
              <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-400">
                {t("dashboard.matchesStaged")}: <span className="font-semibold text-gray-600">{fmt(stats.matches.staged_unconfirmed)}</span>
              </p>
            )}
          </Card>
        </div>
      )}

      {/* Team activity — admin only */}
      {stats?.team_activity && (
        <Card title={t("dashboard.teamActivityTitle")} icon={<Trophy className="h-4 w-4" />} accent="#f59e0b" style={{ animationDelay: "240ms" }}>
          {stats.team_activity.length === 0 ? (
            <p className="text-sm text-gray-400">{t("dashboard.teamActivityEmpty")}</p>
          ) : (
            <TeamActivityList data={stats.team_activity} t={t} />
          )}
        </Card>
      )}

      {/* Recent activity */}
      <Card title={t("dashboard.recentActivityTitle")} style={{ animationDelay: "260ms" }}>
        {!stats ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonLine key={i} className="h-8 w-full" />)}
          </div>
        ) : stats.recent_activity.length === 0 ? (
          <p className="text-sm text-gray-400">{t("dashboard.recentActivityEmpty")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {stats.recent_activity.map((item) => (
              <li key={item.vacancy_id}>
                <Link
                  href={`/vacancies/${item.vacancy_id}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-blue-600"
                >
                  <span className="flex items-center gap-2 truncate">
                    <StatusBadge status={item.status as VacancyStatus} />
                    <span className="truncate font-medium text-gray-800">{item.title || t("matchingUi.noName")}</span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {item.last_matched_at ? new Date(item.last_matched_at).toLocaleString("ru-RU") : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
