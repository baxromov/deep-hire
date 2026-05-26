"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CandidateCard } from "@/components/candidates/CandidateCard";
import { candidateApi } from "@/lib/api";
import { Candidate } from "@/types/candidate";
import useSWR from "swr";
import { toast } from "sonner";

const PAGE_SIZE = 20;

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const SORT_OPTIONS = [
  { value: "score", label: "По баллу ↓" },
  { value: "date",  label: "По дате ↓"  },
  { value: "name",  label: "По имени А–Я" },
];

const SOURCE_FILTERS = [
  { value: "",     label: "Все"     },
  { value: "xlsx", label: "📊 Excel" },
  { value: "file", label: "📎 Загрузка" },
  { value: "hh",   label: "🔗 HH"    },
];

export default function CandidatesPage() {
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(0);
  const [sortBy, setSortBy]   = useState("score");
  const [source, setSource]   = useState("");
  const [uploading, setUploading]   = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [importing, setImporting]   = useState(false);
  const [rescoring, setRescoring]   = useState(false);
  const [rescoreJob, setRescoreJob] = useState<{ status: string; total: number; processed: number; updated: number; can_resume?: boolean; error?: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutateRef    = useRef<() => void>(() => {});
  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 0 on filter/sort change
  useEffect(() => { setPage(0); }, [debouncedSearch, sortBy, source]);

  // Poll rescore status
  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await candidateApi.rescoreStatus();
        const job = res.data;
        setRescoreJob(job);
        if (job.status === "done") {
          stopPoll();
          setRescoring(false);
          toast.success(`✅ Пересчёт завершён — обновлено ${job.updated} кандидатов`);
          mutateRef.current();
        } else if (job.status === "error") {
          stopPoll();
          setRescoring(false);
          toast.error(`Ошибка пересчёта: ${job.error}`);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // On mount: check if a rescore job is already running (survives page refresh)
  useEffect(() => {
    candidateApi.rescoreStatus().then((res) => {
      const job = res.data;
      if (job.status === "running") {
        setRescoring(true);
        setRescoreJob(job);
        startPoll();
      } else if (job.status !== "idle") {
        setRescoreJob(job);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRescoreAll = async (resume = false) => {
    try {
      await candidateApi.rescoreAll(resume);
      setRescoring(true);
      if (!resume) setRescoreJob({ status: "running", total: 0, processed: 0, updated: 0 });
      toast.info(resume ? "Пересчёт возобновлён…" : "Пересчёт запущен…");
      startPoll();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      if (err?.response?.data?.detail === "Rescore already running") {
        toast.warning("Пересчёт уже выполняется");
        setRescoring(true);
        startPoll();
      } else {
        toast.error("Не удалось запустить пересчёт");
      }
    }
  };

  const { data, isLoading, mutate } = useSWR(
    ["all-candidates", debouncedSearch, page, sortBy, source],
    () =>
      candidateApi
        .list({
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          sort_by: sortBy,
          source: source || undefined,
        })
        .then((r) => r.data),
    { keepPreviousData: true }
  );

  mutateRef.current = mutate;   // keep ref in sync — safe to call from poll interval

  const candidates: Candidate[] = (data?.items as Candidate[]) ?? [];
  const total: number = data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = "";
    setUploadCount(files.length);
    setUploading(true);
    try {
      const res = await candidateApi.upload(files);
      res.data.forEach(({ name, score, vacancy_title }) => {
        toast.success(`${name} — "${vacancy_title}" — ${score}%`);
      });
      if (res.data.length === 0) {
        toast.error("Ни одно резюме не удалось обработать");
      }
      mutate();
    } catch {
      toast.error("Не удалось обработать резюме");
    } finally {
      setUploading(false);
      setUploadCount(0);
    }
  };

  const onXlsxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    const toastId = toast.loading("Импорт кандидатов из Excel…");
    try {
      const res = await candidateApi.importXlsx(file);
      const { imported, skipped, total } = res.data;
      toast.success(`Импортировано ${imported} из ${total} (${skipped} уже есть)`, { id: toastId });
      mutate();
    } catch {
      toast.error("Не удалось импортировать файл", { id: toastId });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Кандидаты</h1>
          {total > 0 && (
            <p className="mt-0.5 text-sm text-gray-400">{total} кандидатов</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Rescore All / Resume */}
          {rescoreJob?.can_resume ? (
            <button
              onClick={() => handleRescoreAll(true)}
              disabled={rescoring}
              title={`Продолжить с ${rescoreJob.processed} / ${rescoreJob.total}`}
              className="flex items-center gap-1.5 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Продолжить ({rescoreJob.processed}/{rescoreJob.total})
            </button>
          ) : (
            <button
              onClick={() => handleRescoreAll(false)}
              disabled={rescoring || uploading || importing}
              title="Пересчитать баллы всех кандидатов с новым AI-промптом"
              className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-600 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {rescoring ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {rescoring ? "Пересчёт…" : "Пересчитать все баллы"}
            </button>
          )}

          {/* Import Excel */}
          <button
            onClick={() => xlsxInputRef.current?.click()}
            disabled={importing || uploading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {importing ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            {importing ? "Импорт…" : "Импорт Excel"}
          </button>
          <input ref={xlsxInputRef} type="file" accept=".xlsx" className="hidden" onChange={onXlsxChange} />

          {/* Upload Resume */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || importing}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            {uploading ? `Анализ ${uploadCount} резюме…` : "Загрузить резюме"}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" multiple className="hidden" onChange={onFileChange} />

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 w-52"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Rescore progress / result banner */}
      {rescoreJob && rescoreJob.status !== "idle" && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${
          rescoreJob.status === "running"
            ? "border-orange-200 bg-orange-50"
            : rescoreJob.status === "done"
            ? "border-green-200 bg-green-50"
            : "border-red-200 bg-red-50"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-sm font-medium ${
              rescoreJob.status === "running" ? "text-orange-700" :
              rescoreJob.status === "done"    ? "text-green-700"  : "text-red-700"
            }`}>
              {rescoreJob.status === "running" && `⏳ Пересчёт баллов… ${rescoreJob.total > 0 ? `(${rescoreJob.processed} / ${rescoreJob.total} групп)` : ""}`}
              {rescoreJob.status === "done"    && `✅ Пересчёт завершён`}
              {rescoreJob.status === "error"   && `❌ Ошибка пересчёта`}
            </span>
            <span className={`text-xs font-semibold ${
              rescoreJob.status === "done" ? "text-green-600" : "text-orange-500"
            }`}>
              обновлено: {rescoreJob.updated}
              {rescoreJob.total > 0 && ` / ${rescoreJob.total * 1} групп`}
            </span>
          </div>

          {rescoreJob.status === "running" && (
            <>
              <div className="h-2 w-full rounded-full bg-orange-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-orange-400 transition-all duration-500"
                  style={{
                    width: rescoreJob.total > 0
                      ? `${Math.round((rescoreJob.processed / rescoreJob.total) * 100)}%`
                      : "3%"
                  }}
                />
              </div>
              <p className="mt-1.5 text-xs text-orange-400">
                Страницу можно закрыть — процесс продолжается на сервере
              </p>
            </>
          )}

          {rescoreJob.status === "done" && (
            <div className="h-2 w-full rounded-full bg-green-100 overflow-hidden">
              <div className="h-full w-full rounded-full bg-green-400" />
            </div>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        {/* Source filter chips */}
        <div className="flex items-center gap-1.5">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setSource(f.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                source === f.value
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Сортировка:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none cursor-pointer"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading && candidates.length === 0 ? (
        <div className="flex justify-center pt-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="pt-16 text-center text-gray-400">
          {search || source ? (
            <p>Нет кандидатов по заданным фильтрам</p>
          ) : (
            <>
              <p>Кандидатов пока нет</p>
              <p className="mt-1 text-sm">Загрузите резюме или импортируйте Excel</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Имя</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Должность</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Город</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Зарплата</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Навыки</th>
                  <th
                    className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide cursor-pointer select-none transition-colors text-blue-500"
                    onClick={() => setSortBy(sortBy === "score" ? "date" : "score")}
                    title="Нажмите для смены сортировки"
                  >
                    Балл {sortBy === "score" ? "↓" : ""}
                  </th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium text-gray-400 uppercase tracking-wide">CV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>{total} кандидатов</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Назад
                </button>
                <span className="text-gray-400">{page + 1} / {pageCount}</span>
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
