"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Вакансии</h1>
          <p className="mt-0.5 text-sm text-slate-500">Управление открытыми позициями</p>
        </div>
        <button
          onClick={createNew}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Новая вакансия
        </button>
      </div>

      {/* Tabs */}
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

      {isLoading ? (
        <div className="flex justify-center pt-20">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : vacancies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center">
            <Plus className="h-5 w-5 text-slate-400" />
          </div>
          <p className="font-medium text-slate-700">Вакансий пока нет</p>
          <p className="mt-1 text-sm text-slate-400">Нажмите «Новая вакансия», чтобы начать</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="py-3 pl-5 pr-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Название</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Статус</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Город</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Зарплата</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Опыт</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Навыки</th>
                  <th className="px-3 py-3 pr-5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Создано</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vacancies.map((v) => (
                  <VacancyCard key={v.id} vacancy={v} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-slate-400">{total} вакансий</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Назад
                </button>
                <span className="px-3 text-slate-400">
                  {page + 1} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page + 1 >= pageCount}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
