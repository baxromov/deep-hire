"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ExternalLink } from "lucide-react";
import { VacancyCard } from "@/components/vacancies/VacancyCard";
import { vacancyApi, hhVacancyApi } from "@/lib/api";
import { Vacancy } from "@/types/vacancy";
import { VacancyHhListItem } from "@/types/vacancyHh";
import useSWR from "swr";
import { useLocale } from "@/lib/i18n/context";
import { SkeletonTableRows } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function VacanciesPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [source, setSource] = useState<"internal" | "hh">("internal");

  const SOURCE_TABS = [
    { label: t("vacanciesList.sourceTabInternal"), value: "internal" as const },
    { label: t("vacanciesList.sourceTabHh"), value: "hh" as const },
  ];

  const TABS = [
    { label: t("vacanciesList.tabAll"), value: undefined },
    { label: t("statusBadge.draft"), value: "draft" },
    { label: t("statusBadge.approved"), value: "approved" },
    { label: t("statusBadge.closed"), value: "closed" },
    { label: t("statusBadge.archived"), value: "archived" },
  ];

  // ── Наши вакансии ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, mutate } = useSWR(
    source === "internal" ? ["vacancies", tab, page] : null,
    () => vacancyApi.list({ status: tab, skip: page * PAGE_SIZE, limit: PAGE_SIZE }).then((r) => r.data),
    { refreshInterval: 0 }
  );

  const vacancies: Vacancy[] = (data?.items as Vacancy[]) ?? [];
  const total: number = data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const isDeletableTab = tab === "archived" || tab === "draft";

  const allOnPageSelected = vacancies.length > 0 && vacancies.every((v) => selectedIds.has(v.id));
  const someOnPageSelected = vacancies.some((v) => selectedIds.has(v.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) vacancies.forEach((v) => next.delete(v.id));
      else vacancies.forEach((v) => next.add(v.id));
      return next;
    });
  };

  const switchTab = (val: string | undefined) => {
    setTab(val);
    setPage(0);
    setSelectedIds(new Set());
  };

  const createNew = async () => {
    try {
      const res = await vacancyApi.create();
      router.push(`/vacancies/${res.data.id}/edit`);
    } catch {
      toast.error(t("vacanciesList.createError"));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(t("vacanciesList.deleteConfirm", { count: selectedIds.size }))) return;
    setDeleting(true);
    try {
      const res = await vacancyApi.deleteMany(Array.from(selectedIds));
      toast.success(t("vacanciesList.deleteSuccess", { count: res.data.deleted }));
      setSelectedIds(new Set());
      mutate();
    } catch {
      toast.error(t("vacanciesList.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  // ── Вакансии HH ──────────────────────────────────────────────────────────
  const [hhSearch, setHhSearch] = useState("");
  const debouncedHhSearch = useDebounce(hhSearch, 400);

  const { data: hhData, isLoading: hhLoading } = useSWR(
    source === "hh" ? ["hh-vacancies", debouncedHhSearch] : null,
    () => hhVacancyApi.list(debouncedHhSearch || undefined).then((r) => r.data),
    { refreshInterval: 0 }
  );

  const hhVacancies: VacancyHhListItem[] = hhData?.vacancies ?? [];
  const hhTotal: number = hhData?.total ?? 0;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("vacanciesList.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {source === "internal" ? t("vacanciesList.subtitleInternal") : t("vacanciesList.subtitleHh")}
          </p>
        </div>
        {source === "internal" && (
          <div className="flex items-center gap-2">
            {isDeletableTab && selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                )}
                {t("common.deleteSelected", { count: selectedIds.size })}
              </button>
            )}
            <button
              onClick={createNew}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              {t("vacanciesList.newVacancy")}
            </button>
          </div>
        )}
      </div>

      {/* Source tabs */}
      <div className="flex gap-0.5 rounded-xl bg-slate-100 p-1 w-fit mb-4">
        {SOURCE_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setSource(t.value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              source === t.value
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {source === "internal" ? (
        <>
          {/* Status tabs */}
          <div className="flex gap-0.5 rounded-xl bg-slate-100 p-1 w-fit mb-6">
            {TABS.map((t) => (
              <button
                key={t.label}
                onClick={() => switchTab(t.value)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.value
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {!isLoading && vacancies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center">
                <Plus className="h-5 w-5 text-slate-400" />
              </div>
              <p className="font-medium text-slate-700">{t("vacanciesList.emptyInternalTitle")}</p>
              <p className="mt-1 text-sm text-slate-400">{t("vacanciesList.emptyInternalHint")}</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      {isDeletableTab && (
                        <th className="py-3 pl-5 pr-2 w-8">
                          <input
                            type="checkbox"
                            checked={allOnPageSelected}
                            ref={(el) => { if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected; }}
                            onChange={toggleAll}
                            className="h-4 w-4 rounded border-gray-300 text-green-700 focus:ring-green-500 cursor-pointer"
                          />
                        </th>
                      )}
                      <th className={`py-3 pr-3 text-xs font-semibold text-slate-400 uppercase tracking-wider ${isDeletableTab ? "pl-1" : "pl-5"}`}>{t("vacanciesList.colName")}</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colStatus")}</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colCity")}</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colSalary")}</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colExperience")}</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colSkills")}</th>
                      <th className="px-3 py-3 pr-5 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colCreated")}</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows rows={8} cols={isDeletableTab ? 8 : 7} />
                  ) : (
                    <tbody className="divide-y divide-slate-100">
                      {vacancies.map((v) => (
                        <VacancyCard
                          key={v.id}
                          vacancy={v}
                          selectable={isDeletableTab}
                          selected={selectedIds.has(v.id)}
                          onToggle={toggleSelect}
                        />
                      ))}
                    </tbody>
                  )}
                </table>
              </div>

              {pageCount > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-slate-400">{t("vacanciesList.totalCount", { total })}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page === 0}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t("common.prev")}
                    </button>
                    <span className="px-3 text-slate-400">
                      {t("vacanciesList.pagePosition", { page: page + 1, pageCount })}
                    </span>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page + 1 >= pageCount}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t("common.next")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {/* Search */}
          <div className="mb-6">
            <input
              type="text"
              value={hhSearch}
              onChange={(e) => setHhSearch(e.target.value)}
              placeholder={t("vacanciesList.searchPlaceholder")}
              className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
            />
          </div>

          {!hhLoading && hhVacancies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
              <p className="font-medium text-slate-700">{t("vacanciesList.emptyHh")}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    <th className="py-3 pl-5 pr-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colName")}</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colCity")}</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colResponses")}</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colViews")}</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colInvitations")}</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("vacanciesList.colCreated")}</th>
                    <th className="px-3 py-3 pr-5 text-xs font-semibold text-slate-400 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                {hhLoading ? (
                  <SkeletonTableRows rows={8} cols={7} />
                ) : (
                <tbody className="divide-y divide-slate-100">
                  {hhVacancies.map((v) => (
                    <tr
                      key={v.vacancy_id}
                      className="cursor-pointer hover:bg-green-50/50 transition-colors"
                      onClick={() => router.push(`/vacancies-hh/${v.vacancy_id}`)}
                    >
                      <td className="py-3.5 pl-5 pr-3 font-semibold text-slate-800">{v.name}</td>
                      <td className="px-3 py-3.5 text-sm text-slate-500">{v.region || t("common.none")}</td>
                      <td className="px-3 py-3.5 text-sm text-slate-500">{v.counters.responses}</td>
                      <td className="px-3 py-3.5 text-sm text-slate-500">{v.counters.views}</td>
                      <td className="px-3 py-3.5 text-sm text-slate-500">{v.counters.invitations}</td>
                      <td className="px-3 py-3.5 text-sm text-slate-400 whitespace-nowrap">
                        {new Date(v.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-3 py-3.5 pr-5 text-right">
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-green-600 transition-colors"
                        >
                          hh.ru <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
                )}
              </table>
            </div>
          )}

          {hhTotal > 0 && (
            <p className="mt-4 text-sm text-slate-400">{t("vacanciesList.hhTotalFooter", { total: hhTotal })}</p>
          )}
        </>
      )}
    </div>
  );
}
