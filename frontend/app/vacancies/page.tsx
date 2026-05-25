"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VacancyCard } from "@/components/vacancies/VacancyCard";
import { vacancyApi } from "@/lib/api";
import { Vacancy } from "@/types/vacancy";
import useSWR from "swr";

const TABS = [
  { label: "Все", value: undefined },
  { label: "Черновик", value: "draft" },
  { label: "Опубликовано", value: "approved" },
  { label: "Закрыто", value: "closed" },
  { label: "Архив", value: "archived" },
];

const PAGE_SIZE = 20;

export default function VacanciesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useSWR(
    ["vacancies", tab, page],
    () => vacancyApi.list({ status: tab, skip: page * PAGE_SIZE, limit: PAGE_SIZE }).then((r) => r.data),
    { refreshInterval: 0 }
  );

  const vacancies: Vacancy[] = (data?.items as Vacancy[]) ?? [];
  const total: number = data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const switchTab = (val: string | undefined) => {
    setTab(val);
    setPage(0);
  };

  const createNew = async () => {
    try {
      const res = await vacancyApi.create();
      router.push(`/vacancies/${res.data.id}/edit`);
    } catch {
      toast.error("Не удалось создать вакансию");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Вакансии</h1>
        <Button onClick={createNew} size="sm">+ Новая вакансия</Button>
      </div>

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit mb-5">
        {TABS.map((t) => (
          <button
            key={t.label}
            onClick={() => switchTab(t.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center pt-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : vacancies.length === 0 ? (
        <div className="pt-16 text-center text-gray-400">
          <p>Вакансий пока нет</p>
          <p className="mt-1 text-sm">Нажмите «+ Новая вакансия», чтобы начать</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Название</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Статус</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Город</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Зарплата</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Опыт</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Навыки</th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Создано</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vacancies.map((v) => (
                  <VacancyCard key={v.id} vacancy={v} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>{total} вакансий</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Назад
                </button>
                <span className="text-gray-400">
                  {page + 1} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page + 1 >= pageCount}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
