"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CandidateCard } from "@/components/candidates/CandidateCard";
import { candidateApi } from "@/lib/api";
import { Candidate } from "@/types/candidate";
import useSWR from "swr";
import { toast } from "sonner";
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

type UploadJobState = {
  status: string;
  total: number;
  processed: number;
  errors: number;
  error?: string | null;
} | null;

export default function CandidatesPage() {
  const { t } = useLocale();

  const SORT_OPTIONS = [
    { value: "score", label: t("candidatesList.sortScore") },
    { value: "date",  label: t("candidatesList.sortDate")  },
    { value: "name",  label: t("candidatesList.sortName") },
  ];

  const SOURCE_FILTERS = [
    { value: "",             label: t("candidatesList.sourceAll")           },
    { value: "xlsx",         label: t("candidatesList.sourceExcel")      },
    { value: "file",         label: t("candidatesList.sourceUpload")   },
    { value: "hh",           label: t("candidatesList.sourceHh")         },
    { value: "cleverstaff",  label: t("candidatesList.sourceCleverstaff") },
  ];

  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(0);
  const [sortBy, setSortBy]   = useState("score");
  const [source, setSource]   = useState("");
  const [uploading, setUploading]   = useState(false);
  const [importing, setImporting]   = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [cleverstaffSyncing, setCleverstaffSyncing] = useState(false);
  const [cleverstaffClearing, setCleverstaffClearing] = useState(false);
  const [vectorizeJob, setVectorizeJob] = useState<{ status: string; total: number; processed: number; vectorized: number; error?: string | null } | null>(null);
  const [uploadJob, setUploadJob]   = useState<UploadJobState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const xlsxInputRef  = useRef<HTMLInputElement>(null);
  const uploadPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const vectorizePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutateRef     = useRef<() => void>(() => {});
  const debouncedSearch = useDebounce(search, 300);

  // Reset page + selection on filter/sort change
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [debouncedSearch, sortBy, source]);

  // ── Vectorize polling ──────────────────────────────────────────────────────
  const stopVectorizePoll = useCallback(() => {
    if (vectorizePollRef.current) { clearInterval(vectorizePollRef.current); vectorizePollRef.current = null; }
  }, []);

  const startVectorizePoll = useCallback(() => {
    stopVectorizePoll();
    vectorizePollRef.current = setInterval(async () => {
      try {
        const res = await candidateApi.vectorizeStatus();
        const job = res.data;
        setVectorizeJob(job);
        if (job.status === "done") {
          stopVectorizePoll();
          setVectorizing(false);
          toast.success(t("candidatesList.toastVectorizeDone", { count: job.vectorized }));
          mutateRef.current();
        } else if (job.status === "error") {
          stopVectorizePoll();
          setVectorizing(false);
          toast.error(t("candidatesList.toastVectorizeError", { error: job.error ?? "" }));
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [stopVectorizePoll, t]);

  useEffect(() => () => stopVectorizePoll(), [stopVectorizePoll]);

  const handleVectorizeAll = async () => {
    try {
      await candidateApi.vectorizeAll();
      setVectorizing(true);
      setVectorizeJob({ status: "running", total: 0, processed: 0, vectorized: 0 });
      toast.info(t("candidatesList.toastVectorizeStarted"));
      startVectorizePoll();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      if (err?.response?.data?.detail === "Vectorize already running") {
        toast.warning(t("candidatesList.toastVectorizeAlreadyRunning"));
        setVectorizing(true);
        startVectorizePoll();
      } else {
        toast.error(t("candidatesList.toastVectorizeStartError"));
      }
    }
  };

  // ── Upload polling ─────────────────────────────────────────────────────────
  const stopUploadPoll = useCallback(() => {
    if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
  }, []);

  const startUploadPoll = useCallback(() => {
    stopUploadPoll();
    uploadPollRef.current = setInterval(async () => {
      try {
        const res = await candidateApi.uploadStatus();
        const job = res.data;
        setUploadJob({ status: job.status, total: job.total, processed: job.processed, errors: job.errors, error: job.error });
        if (job.status === "done") {
          stopUploadPoll();
          setUploading(false);
          if (job.results.length > 0) {
            toast.success(t("candidatesList.toastResumesAnalyzed", { count: job.results.length }));
            // Auto-start vectorization after upload completes
            try {
              await candidateApi.vectorizeAll();
              setVectorizing(true);
              setVectorizeJob({ status: "running", total: 0, processed: 0, vectorized: 0 });
              toast.info(t("candidatesList.toastVectorizeAutoStarted"));
              startVectorizePoll();
            } catch (e: unknown) {
              const err = e as { response?: { data?: { detail?: string } } };
              if (err?.response?.data?.detail === "Vectorize already running") {
                setVectorizing(true);
                startVectorizePoll();
              }
            }
          }
          if (job.errors > 0) {
            toast.warning(t("candidatesList.toastFilesFailed", { count: job.errors }));
          }
          if (job.results.length === 0 && job.errors === 0) {
            toast.error(t("candidatesList.toastNoResumesProcessed"));
          }
          mutateRef.current();
        } else if (job.status === "error") {
          stopUploadPoll();
          setUploading(false);
          toast.error(t("candidatesList.toastUploadError", { error: job.error ?? "" }));
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [stopUploadPoll, startVectorizePoll, t]);

  useEffect(() => () => stopUploadPoll(), [stopUploadPoll]);

  // On mount: resume any in-progress jobs
  useEffect(() => {
    candidateApi.uploadStatus().then((res) => {
      const job = res.data;
      if (job.status === "processing") {
        setUploading(true);
        setUploadJob({ status: job.status, total: job.total, processed: job.processed, errors: job.errors });
        startUploadPoll();
      } else if (job.status !== "idle") {
        setUploadJob({ status: job.status, total: job.total, processed: job.processed, errors: job.errors, error: job.error });
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleverstaff sync ──────────────────────────────────────────────────────
  const handleCleverstaffSync = async () => {
    try {
      setCleverstaffSyncing(true);
      await candidateApi.cleverstaffSync();
      toast.success(t("candidatesList.toastCleverstaffSyncStarted"));
    } catch {
      toast.error(t("candidatesList.toastCleverstaffSyncError"));
    } finally {
      setCleverstaffSyncing(false);
    }
  };

  const handleCleverstaffClear = async () => {
    if (!confirm(t("candidatesList.confirmClearCleverstaff"))) return;
    setCleverstaffClearing(true);
    try {
      const res = await candidateApi.cleverstaffClear();
      toast.success(t("candidatesList.toastCleverstaffCleared", { count: res.data.deleted }));
      mutateRef.current();
    } catch {
      toast.error(t("candidatesList.toastCleverstaffClearError"));
    } finally {
      setCleverstaffClearing(false);
    }
  };

  // ── SWR ───────────────────────────────────────────────────────────────────
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

  mutateRef.current = mutate;

  const candidates: Candidate[] = (data?.items as Candidate[]) ?? [];
  const total: number = data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const allOnPageSelected = candidates.length > 0 && candidates.every((c) => selectedIds.has(c.id));
  const someOnPageSelected = candidates.some((c) => selectedIds.has(c.id));

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
      if (allOnPageSelected) candidates.forEach((c) => next.delete(c.id));
      else candidates.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(t("candidatesList.confirmDeleteSelected", { count: selectedIds.size }))) return;
    setDeleting(true);
    try {
      const res = await candidateApi.deleteMany(Array.from(selectedIds));
      toast.success(t("candidatesList.toastDeleted", { count: res.data.deleted }));
      setSelectedIds(new Set());
      mutate();
    } catch {
      toast.error(t("candidatesList.toastDeleteError"));
    } finally {
      setDeleting(false);
    }
  };

  // ── File upload — non-blocking ─────────────────────────────────────────────
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = "";
    setUploading(true);
    setUploadJob({ status: "processing", total: files.length, processed: 0, errors: 0 });
    try {
      await candidateApi.upload(files);
      toast.info(t("candidatesList.toastResumesAnalyzing", { count: files.length }));
      startUploadPoll();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      if (err?.response?.data?.detail === "Upload already in progress") {
        toast.warning(t("candidatesList.toastUploadAlreadyInProgress"));
        startUploadPoll();
      } else {
        toast.error(t("candidatesList.toastUploadSendError"));
        setUploading(false);
        setUploadJob(null);
      }
    }
  };

  // ── Excel import ───────────────────────────────────────────────────────────
  const onXlsxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    const toastId = toast.loading(t("candidatesList.toastImportingExcel"));
    try {
      const res = await candidateApi.importXlsx(file);
      const { imported, skipped, total } = res.data;
      toast.success(t("candidatesList.toastImportResult", { imported, total, skipped }), { id: toastId });
      mutate();
    } catch {
      toast.error(t("candidatesList.toastImportError"), { id: toastId });
    } finally {
      setImporting(false);
    }
  };

  // ── Upload progress % ──────────────────────────────────────────────────────
  const uploadPct = uploadJob && uploadJob.total > 0
    ? Math.round((uploadJob.processed / uploadJob.total) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("candidatesList.title")}</h1>
          {total > 0 && <p className="mt-0.5 text-sm text-gray-400">{t("candidatesList.totalCandidates", { count: total })}</p>}
        </div>
        <div className="flex items-center gap-3">

          {/* Selected actions */}
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={handleVectorizeAll}
                disabled={vectorizing || uploading || importing}
                className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {vectorizing
                  ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                  : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                }
                {vectorizing ? t("candidatesList.vectorizing") : t("candidatesList.vectorizeSelected", { count: selectedIds.size })}
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting
                  ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                  : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                }
                {t("common.deleteSelected", { count: selectedIds.size })}
              </button>
            </>
          )}

          {/* Cleverstaff Sync */}
          <button onClick={handleCleverstaffSync} disabled={cleverstaffSyncing || cleverstaffClearing}
            className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {cleverstaffSyncing
              ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
              : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            }
            {cleverstaffSyncing ? t("candidatesList.cleverstaffSyncing") : t("candidatesList.cleverstaffSync")}
          </button>

          {/* Cleverstaff Clear */}
          <button onClick={handleCleverstaffClear} disabled={cleverstaffClearing || cleverstaffSyncing}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {cleverstaffClearing
              ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
              : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            }
            {cleverstaffClearing ? t("candidatesList.cleverstaffClearing") : t("candidatesList.cleverstaffClear")}
          </button>

          {/* Vectorize All (when nothing selected) */}
          {selectedIds.size === 0 && (
            <button onClick={handleVectorizeAll} disabled={vectorizing || uploading || importing}
              className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {vectorizing
                ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              }
              {vectorizing ? t("candidatesList.vectorizing") : t("candidatesList.vectorizeAll")}
            </button>
          )}

          {/* Import Excel */}
          <button onClick={() => xlsxInputRef.current?.click()} disabled={importing || uploading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {importing
              ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            }
            {importing ? t("candidatesList.importing") : t("candidatesList.importExcel")}
          </button>
          <input ref={xlsxInputRef} type="file" accept=".xlsx" className="hidden" onChange={onXlsxChange} />

          {/* Upload Resume */}
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading || importing}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {uploading
              ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            }
            {uploading ? t("candidatesList.uploadingBtn") : t("candidatesList.uploadResume")}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" multiple className="hidden" onChange={onFileChange} />

          {/* Search */}
          <div className="relative">
            <input type="text" placeholder={t("candidatesList.searchPlaceholder")} value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 w-52"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Upload progress banner */}
      {uploadJob && uploadJob.status !== "idle" && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${
          uploadJob.status === "processing" ? "border-blue-200 bg-blue-50"
          : uploadJob.status === "done"     ? "border-green-200 bg-green-50"
          : "border-red-200 bg-red-50"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-sm font-medium ${
              uploadJob.status === "processing" ? "text-blue-700"
              : uploadJob.status === "done"     ? "text-green-700"
              : "text-red-700"
            }`}>
              {uploadJob.status === "processing" && t("candidatesList.bannerAnalyzing", { processed: uploadJob.processed, total: uploadJob.total })}
              {uploadJob.status === "done"       && t("candidatesList.bannerAnalysisComplete")}
              {uploadJob.status === "error"      && t("candidatesList.bannerError")}
            </span>
            <span className="text-xs text-gray-500">
              {uploadJob.status === "processing" && `${uploadPct}%`}
              {uploadJob.status === "done"       && t("candidatesList.bannerSuccessCount", { success: uploadJob.total - uploadJob.errors, total: uploadJob.total })}
            </span>
          </div>

          {uploadJob.status === "processing" && (
            <>
              <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden">
                <div className="h-full rounded-full bg-blue-400 transition-all duration-500"
                  style={{ width: `${Math.max(uploadPct, 3)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-blue-400">
                {t("candidatesList.bannerCanClose")}
              </p>
            </>
          )}

          {uploadJob.status === "done" && (
            <div className="h-2 w-full rounded-full bg-green-100 overflow-hidden">
              <div className="h-full w-full rounded-full bg-green-400" />
            </div>
          )}
        </div>
      )}

      {/* Vectorize progress banner */}
      {vectorizeJob && vectorizeJob.status !== "idle" && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${
          vectorizeJob.status === "running" ? "border-violet-200 bg-violet-50"
          : vectorizeJob.status === "done"  ? "border-green-200 bg-green-50"
          : "border-red-200 bg-red-50"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-sm font-medium ${
              vectorizeJob.status === "running" ? "text-violet-700"
              : vectorizeJob.status === "done"  ? "text-green-700" : "text-red-700"
            }`}>
              {vectorizeJob.status === "running" && `${t("candidatesList.bannerVectorizing")}${vectorizeJob.total > 0 ? ` (${vectorizeJob.vectorized} / ${vectorizeJob.total})` : ""}`}
              {vectorizeJob.status === "done"    && t("candidatesList.bannerVectorizeComplete")}
              {vectorizeJob.status === "error"   && t("candidatesList.bannerVectorizeError")}
            </span>
            {vectorizeJob.status !== "error" && (
              <span className={`text-xs font-semibold ${vectorizeJob.status === "done" ? "text-green-600" : "text-violet-600"}`}>
                {vectorizeJob.vectorized}{vectorizeJob.total > 0 && ` / ${vectorizeJob.total}`}
              </span>
            )}
          </div>
          {vectorizeJob.status === "running" && (
            <div className="h-2 w-full rounded-full bg-violet-100 overflow-hidden">
              <div className="h-full rounded-full bg-violet-400 transition-all duration-500"
                style={{ width: vectorizeJob.total > 0 ? `${Math.round((vectorizeJob.vectorized / vectorizeJob.total) * 100)}%` : "3%" }} />
            </div>
          )}
          {vectorizeJob.status === "done" && (
            <div className="h-2 w-full rounded-full bg-green-100 overflow-hidden">
              <div className="h-full w-full rounded-full bg-green-400" />
            </div>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-1.5">
          {SOURCE_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setSource(f.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                source === f.value ? "bg-blue-600 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{t("candidatesList.sortByLabel")}</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none cursor-pointer">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading && candidates.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="py-2.5 pl-4 pr-2 w-8"></th>
                <th className="py-2.5 pl-1 pr-3 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colName")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colPosition")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colCity")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colSalary")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colSkills")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colVector")}</th>
                <th className="px-3 py-2.5 pr-4 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colCv")}</th>
              </tr>
            </thead>
            <SkeletonTableRows rows={8} cols={8} />
          </table>
        </div>
      ) : candidates.length === 0 ? (
        <div className="pt-16 text-center text-gray-400">
          {search || source ? <p>{t("candidatesList.emptyFiltered")}</p> : (
            <>
              <p>{t("candidatesList.emptyNone")}</p>
              <p className="mt-1 text-sm">{t("candidatesList.emptyHint")}</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-2 w-8">
                    <input type="checkbox" checked={allOnPageSelected}
                      ref={(el) => { if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected; }}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 pl-1 pr-3 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colName")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colPosition")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colCity")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colSalary")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colSkills")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colVector")}</th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium text-gray-400 uppercase tracking-wide">{t("candidatesList.colCv")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} selected={selectedIds.has(c.id)} onToggle={toggleSelect} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>{t("candidatesList.totalCandidates", { count: total })}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={page === 0}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {t("common.prev")}
                </button>
                <span className="text-gray-400">{page + 1} / {pageCount}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pageCount}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {t("common.next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
