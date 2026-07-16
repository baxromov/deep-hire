"use client";

import { use, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InfoItem } from "@/components/vacancies/InfoItem";
import { MethodCard } from "@/components/vacancies/MethodCard";
import { MatchTimeline, MatchStep, MATCH_PHASES, HH_MATCH_PHASES } from "@/components/vacancies/MatchTimeline";
import { CandidateRow } from "@/components/vacancies/CandidateRow";
import { vacancyApi, candidateApi, matchingApi, talentPoolApi, API_BASE } from "@/lib/api";
import { Vacancy, EXPERIENCE_OPTIONS, EMPLOYMENT_OPTIONS, SCHEDULE_OPTIONS } from "@/types/vacancy";
import { Candidate } from "@/types/candidate";
import useSWR from "swr";
import { useLocale } from "@/lib/i18n/context";
import { Skeleton, SkeletonLine, SkeletonTableRows } from "@/components/ui/skeleton";
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from "@/components/ui/dialog";

// ─── Other helpers ────────────────────────────────────────────────────────────

type Props = { params: Promise<{ id: string }> };

const labelOf = (val: string | null, opts: { value: string; label: string }[]) =>
  opts.find((o) => o.value === val)?.label ?? val;

const PROGRESS_KEY = (id: string) => `rematch-progress-${id}`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VacancyDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useLocale();

  // ── matching state ────────────────────────────────────────────────────────
  const [rematching, setRematching] = useState(false);
  const [matchSteps, setMatchSteps] = useState<MatchStep[]>([]);
  const [rematchResult, setRematchResult] = useState<number | null>(null);

  const [poolMatching, setPoolMatching] = useState(false);
  const [poolSteps, setPoolSteps] = useState<MatchStep[]>([]);
  const [poolResult, setPoolResult] = useState<number | null>(null);

  const [livePoolMatching, setLivePoolMatching] = useState(false);
  const [livePoolSteps, setLivePoolSteps] = useState<MatchStep[]>([]);
  const [liveResult, setLiveResult] = useState<number | null>(null);

  const [fileMatching, setFileMatching] = useState(false);
  const [fileResult, setFileResult] = useState<number | null>(null);

  const [dbMatching, setDbMatching] = useState(false);
  const [dbSteps, setDbSteps] = useState<MatchStep[]>([]);
  const [dbResult, setDbResult] = useState<number | null>(null);

  // Shared score threshold — applies to every active method (DB search, HH search)
  const [minScore, setMinScore] = useState(40);

  const [hhMatching, setHhMatching] = useState(false);
  const [hhSteps, setHhSteps] = useState<MatchStep[]>([]);
  const [hhResult, setHhResult] = useState<number | null>(null);
  const [includeCompanies, setIncludeCompanies] = useState("");
  const [excludeCompanies, setExcludeCompanies] = useState("");
  const [showHhSettings, setShowHhSettings] = useState(false);

  const [combinedMatching, setCombinedMatching] = useState(false);
  const [combinedSteps, setCombinedSteps] = useState<MatchStep[]>([]);
  const [combinedResult, setCombinedResult] = useState<number | null>(null);

  const [resultTab, setResultTab] = useState<"llm" | "vector" | "hh" | "combined">("llm");

  // EventSource refs — used by stop handlers
  const rematchSourceRef = useRef<EventSource | null>(null);
  const poolSourceRef    = useRef<EventSource | null>(null);
  const liveSourceRef    = useRef<EventSource | null>(null);
  const dbSourceRef      = useRef<EventSource | null>(null);
  const hhSourceRef      = useRef<EventSource | null>(null);
  const combinedSourceRef = useRef<EventSource | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: vacancy, mutate: mutateVacancy } = useSWR<Vacancy>(
    `vacancy-${id}`,
    () => vacancyApi.get(id).then((r) => r.data)
  );

  const { data: poolStatus, mutate: mutatePool } = useSWR(
    "talent-pool-status",
    () => talentPoolApi.status().then((r) => r.data),
    { refreshInterval: poolMatching ? 3000 : 0 }
  );

  const { data: rawCandidates = [], mutate: mutateCandidates } = useSWR<Candidate[]>(
    vacancy?.status === "approved" || vacancy?.status === "closed" || vacancy?.status === "archived"
      ? `candidates-${id}`
      : null,
    () => candidateApi.byVacancy(id).then((r) => r.data)
  );

  // Each candidate belongs to exactly one tab: HH-sourced first, then LLM-scored,
  // then whatever's left goes to Vector — no more overlap between tabs.
  const hhCandidates = rawCandidates
    .filter((c) => c.source === "hh")
    .sort((a, b) => (b.llm_score ?? b.relevance_score ?? 0) - (a.llm_score ?? a.relevance_score ?? 0));
  const llmCandidates = rawCandidates
    .filter((c) => c.source !== "hh" && c.llm_score != null)
    .sort((a, b) => (b.llm_score ?? 0) - (a.llm_score ?? 0));
  const vectorCandidates = rawCandidates
    .filter((c) => c.source !== "hh" && c.llm_score == null)
    .sort((a, b) => (b.vector_score ?? b.relevance_score ?? 0) - (a.vector_score ?? a.relevance_score ?? 0));
  const combinedCandidates = rawCandidates
    .filter((c) => c.match_source === "combined")
    .sort((a, b) => (b.llm_score ?? b.relevance_score ?? 0) - (a.llm_score ?? a.relevance_score ?? 0));
  const candidates =
    resultTab === "llm" ? llmCandidates
    : resultTab === "vector" ? vectorCandidates
    : resultTab === "combined" ? combinedCandidates
    : hhCandidates;

  if (!vacancy) {
    return (
      <div>
        <SkeletonLine className="mb-6 h-4 w-16" />

        {/* Vacancy card skeleton */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <SkeletonLine className="h-6 w-64" />
            <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonLine className="h-3 w-14" />
                <SkeletonLine className="h-4 w-24" />
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-md" />
            ))}
          </div>

          <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
            <SkeletonLine className="h-3.5 w-full" />
            <SkeletonLine className="h-3.5 w-full" />
            <SkeletonLine className="h-3.5 w-2/3" />
          </div>
        </div>

        {/* AI matching panel skeleton */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <Skeleton className="h-6 w-6 rounded-lg" />
            <SkeletonLine className="h-3.5 w-40" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>

        {/* Candidates table skeleton */}
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {Array.from({ length: 8 }).map((_, i) => (
                  <th key={i} className="py-2.5 px-3" />
                ))}
              </tr>
            </thead>
            <SkeletonTableRows rows={6} cols={8} />
          </table>
        </div>
      </div>
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  const duplicate = async () => {
    try {
      const res = await vacancyApi.duplicate(id);
      toast.success(t("vacanciesDetail.toastDuplicated"));
      router.push(`/vacancies/${res.data.id}/edit`);
    } catch {
      toast.error(t("vacanciesDetail.toastDuplicateFailed"));
    }
  };

  const toggle = async () => {
    try {
      const res = await vacancyApi.toggleOpen(id);
      mutateVacancy(res.data);
      toast.success(res.data.is_open ? t("vacanciesDetail.toastOpened") : t("vacanciesDetail.toastClosed"));
    } catch {
      toast.error(t("vacanciesDetail.toastToggleFailed"));
    }
  };

  const approve = async () => {
    try {
      const res = await vacancyApi.approve(id);
      mutateVacancy(res.data);
      toast.success(t("vacanciesDetail.toastPublished"));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        t("vacanciesDetail.toastPublishFailed");
      toast.error(msg);
    }
  };

  const archive = async () => {
    try {
      await vacancyApi.archive(id);
      toast.success(t("vacanciesDetail.toastArchived"));
      router.push("/vacancies");
    } catch {
      toast.error(t("vacanciesDetail.toastArchiveFailed"));
    }
  };

  const anyRunning = rematching || poolMatching || livePoolMatching || fileMatching || dbMatching || hhMatching || combinedMatching;

  // ── Smart Rematch ─────────────────────────────────────────────────────────
  const rematch = () => {
    setRematching(true);
    setMatchSteps([]);
    setRematchResult(null);
    try { localStorage.removeItem(PROGRESS_KEY(id)); } catch {}
    const source = new EventSource(`${API_BASE}/api/matching/vacancies/${id}/rematch-stream`, { withCredentials: true });
    rematchSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setMatchSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); rematchSourceRef.current = null;
        setRematching(false); mutateCandidates();
        setRematchResult(event.matched ?? 0);
        (event.matched ?? 0) > 0 ? toast.success(t("vacanciesDetail.foundCandidatesRematch", { count: event.matched ?? 0 })) : toast.info(t("vacanciesDetail.noCandidatesFound"));
      }
      if (event.step === "error") {
        source.close(); rematchSourceRef.current = null;
        setRematching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); rematchSourceRef.current = null; setRematching(false);
      setMatchSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.connectionLost") }]);
    };
  };

  const stopRematch = () => {
    rematchSourceRef.current?.close();
    rematchSourceRef.current = null;
    setRematching(false);
    setMatchSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.stoppedByUser") }]);
  };

  // ── Talent Pool ───────────────────────────────────────────────────────────
  const matchFromPool = () => {
    setPoolMatching(true);
    setPoolSteps([]);
    setPoolResult(null);
    const source = new EventSource(`${API_BASE}/api/matching/vacancies/${id}/match-from-pool-stream`, { withCredentials: true });
    poolSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setPoolSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); poolSourceRef.current = null;
        setPoolMatching(false); mutateCandidates(); mutatePool();
        setPoolResult(event.matched ?? 0);
        (event.matched ?? 0) > 0 ? toast.success(t("vacanciesDetail.foundCandidatesPool", { count: event.matched ?? 0 })) : toast.info(t("vacanciesDetail.noCandidatesInPool"));
      }
      if (event.step === "error") {
        source.close(); poolSourceRef.current = null;
        setPoolMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); poolSourceRef.current = null; setPoolMatching(false);
      setPoolSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.connectionLost") }]);
    };
  };

  const stopPool = () => {
    poolSourceRef.current?.close();
    poolSourceRef.current = null;
    setPoolMatching(false);
    setPoolSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.stoppedByUser") }]);
  };

  // ── Live Pool ─────────────────────────────────────────────────────────────
  const matchFromLivePool = () => {
    setLivePoolMatching(true);
    setLivePoolSteps([]);
    setLiveResult(null);
    const source = new EventSource(`${API_BASE}/api/matching/vacancies/${id}/match-from-live-pool-stream`, { withCredentials: true });
    liveSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setLivePoolSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); liveSourceRef.current = null;
        setLivePoolMatching(false); mutateCandidates();
        setLiveResult(event.matched ?? 0);
        (event.matched ?? 0) > 0 ? toast.success(t("vacanciesDetail.foundCandidatesLivePool", { count: event.matched ?? 0 })) : toast.info(t("vacanciesDetail.noCandidatesInLivePool"));
      }
      if (event.step === "error") {
        source.close(); liveSourceRef.current = null;
        setLivePoolMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); liveSourceRef.current = null; setLivePoolMatching(false);
      setLivePoolSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.connectionLost") }]);
    };
  };

  const stopLivePool = () => {
    liveSourceRef.current?.close();
    liveSourceRef.current = null;
    setLivePoolMatching(false);
    setLivePoolSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.stoppedByUser") }]);
  };

  // ── From our DB ───────────────────────────────────────────────────────────
  const matchFromDb = () => {
    setDbMatching(true);
    setDbSteps([]);
    setDbResult(null);
    const url = matchingApi.matchFromDbStreamUrl(id, minScore);
    const source = new EventSource(url, { withCredentials: true });
    dbSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setDbSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); dbSourceRef.current = null;
        setDbMatching(false);
        setDbResult(event.matched ?? 0);
        if ((event.matched ?? 0) > 0) {
          toast.success(t("vacanciesDetail.foundCandidatesDb", { count: event.matched ?? 0 }));
          // Explicitly fetch and push into SWR cache — avoids dedup/timing race with passive mutate()
          candidateApi.byVacancy(id).then((r) =>
            mutateCandidates(r.data as Candidate[], { revalidate: false })
          );
        } else {
          toast.info(t("vacanciesDetail.noCandidatesFound"));
        }
        setTimeout(() => {
          document.getElementById("candidates-section")?.scrollIntoView({ behavior: "smooth" });
        }, 400);
      }
      if (event.step === "error") {
        source.close(); dbSourceRef.current = null;
        setDbMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); dbSourceRef.current = null; setDbMatching(false);
      setDbSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.connectionLost") }]);
    };
  };

  const stopDb = () => {
    dbSourceRef.current?.close();
    dbSourceRef.current = null;
    setDbMatching(false);
    setDbSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.stoppedByUser") }]);
  };

  // ── HeadHunter (HH.ru) search ────────────────────────────────────────────
  const matchFromHh = () => {
    setHhMatching(true);
    setHhSteps([]);
    setHhResult(null);
    const url = matchingApi.matchFromHhStreamUrl(id, minScore, includeCompanies || undefined, excludeCompanies || undefined);
    const source = new EventSource(url, { withCredentials: true });
    hhSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setHhSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); hhSourceRef.current = null;
        setHhMatching(false);
        setHhResult(event.matched ?? 0);
        if ((event.matched ?? 0) > 0) {
          toast.success(t("vacanciesDetail.foundCandidatesHh", { count: event.matched ?? 0 }));
          candidateApi.byVacancy(id).then((r) =>
            mutateCandidates(r.data as Candidate[], { revalidate: false })
          );
        } else {
          toast.info(t("vacanciesDetail.noCandidatesFound"));
        }
        setTimeout(() => {
          document.getElementById("candidates-section")?.scrollIntoView({ behavior: "smooth" });
        }, 400);
      }
      if (event.step === "error") {
        source.close(); hhSourceRef.current = null;
        setHhMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); hhSourceRef.current = null; setHhMatching(false);
      setHhSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.connectionLost") }]);
    };
  };

  const stopHh = () => {
    hhSourceRef.current?.close();
    hhSourceRef.current = null;
    setHhMatching(false);
    setHhSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.stoppedByUser") }]);
  };

  // ── Combined rerank ───────────────────────────────────────────────────────
  const matchFromCombined = () => {
    setCombinedMatching(true);
    setCombinedSteps([]);
    setCombinedResult(null);
    const url = matchingApi.matchFromCombinedStreamUrl(id, minScore);
    const source = new EventSource(url, { withCredentials: true });
    combinedSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setCombinedSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); combinedSourceRef.current = null;
        setCombinedMatching(false);
        setCombinedResult(event.matched ?? 0);
        if ((event.matched ?? 0) > 0) {
          toast.success(t("vacanciesDetail.foundCandidatesCombined", { count: event.matched ?? 0 }));
          candidateApi.byVacancy(id).then((r) =>
            mutateCandidates(r.data as Candidate[], { revalidate: false })
          );
        } else {
          toast.info(t("vacanciesDetail.noCandidatesToCombine"));
        }
        setResultTab("combined");
        setTimeout(() => {
          document.getElementById("candidates-section")?.scrollIntoView({ behavior: "smooth" });
        }, 400);
      }
      if (event.step === "error") {
        source.close(); combinedSourceRef.current = null;
        setCombinedMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); combinedSourceRef.current = null; setCombinedMatching(false);
      setCombinedSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.connectionLost") }]);
    };
  };

  const stopCombined = () => {
    combinedSourceRef.current?.close();
    combinedSourceRef.current = null;
    setCombinedMatching(false);
    setCombinedSteps((prev) => [...prev, { step: "error", message: t("vacanciesDetail.stoppedByUser") }]);
  };

  // ── File upload ───────────────────────────────────────────────────────────
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setFileMatching(true);
    setFileResult(null);
    try {
      const res = await matchingApi.matchFromFile(id, file);
      const { name, score, total, pool_matched } = res.data;
      const poolNote = pool_matched > 0 ? t("vacanciesDetail.fileResultPoolNote", { count: pool_matched }) : "";
      toast.success(t("vacanciesDetail.fileResultSuccess", { name, score, poolNote }));
      mutateCandidates();
      setFileResult(total);
    } catch {
      toast.error(t("vacanciesDetail.fileProcessFailed"));
      setFileResult(0);
    } finally {
      setFileMatching(false);
    }
  };

  const salary = [
    vacancy.salary_from ? new Intl.NumberFormat("ru-RU").format(vacancy.salary_from) : null,
    vacancy.salary_to ? new Intl.NumberFormat("ru-RU").format(vacancy.salary_to) : null,
  ]
    .filter(Boolean)
    .join(" – ");

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <button
        onClick={() => router.push("/vacancies")}
        className="mb-6 text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        {t("vacanciesDetail.back")}
      </button>

      {/* Vacancy card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">{vacancy.title || t("vacanciesDetail.untitled")}</h1>
          <StatusBadge status={vacancy.status} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <InfoItem label={t("vacanciesDetail.infoCity")} value={vacancy.area} />
          <InfoItem label={t("vacanciesDetail.infoSalary")} value={salary ? `${salary} ${vacancy.currency}` : null} />
          <InfoItem label={t("vacanciesDetail.infoExperience")} value={labelOf(vacancy.experience, EXPERIENCE_OPTIONS)} />
          <InfoItem label={t("vacanciesDetail.infoEmployment")} value={labelOf(vacancy.employment_type, EMPLOYMENT_OPTIONS)} />
          <InfoItem label={t("vacanciesDetail.infoSchedule")} value={labelOf(vacancy.schedule, SCHEDULE_OPTIONS)} />
        </div>

        {(vacancy.skills?.length ?? 0) > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {(vacancy.skills ?? []).map((s) => (
              <span key={s} className="rounded-md bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                {s}
              </span>
            ))}
          </div>
        )}

        {vacancy.description && (
          <p className="mt-5 border-t border-gray-100 pt-4 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">
            {vacancy.description}
          </p>
        )}

        {/* General actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          <Button variant="outline" size="sm" onClick={() => router.push(`/vacancies/${id}/edit`)}>{t("common.edit")}</Button>
          <Button variant="outline" size="sm" onClick={duplicate}>{t("common.duplicate")}</Button>
          {vacancy.status === "draft" && vacancy.is_approvable && (
            <Button size="sm" onClick={approve}>{t("common.publish")}</Button>
          )}
          {(vacancy.status === "approved" || vacancy.status === "closed") && (
            <Button variant="outline" size="sm" onClick={toggle}>
              {vacancy.is_open ? t("common.close") : t("common.open")}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {vacancy.status !== "archived" && (
              <Button variant="outline" size="sm" onClick={archive} className="text-red-400 hover:text-red-600 hover:border-red-200">
                {t("common.archive")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── AI Matching Panel ───────────────────────────────────────────────── */}
      {vacancy.status === "approved" && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {/* Section header */}
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
              </svg>
            </div>
            <span className="text-[13px] font-semibold text-gray-800">{t("vacanciesDetail.aiPanelTitle")}</span>
            <span className="ml-auto text-[11px] text-gray-400">{t("vacanciesDetail.aiPanelHint")}</span>
          </div>

          {/* Shared score threshold — applies to every active method (DB search, HH search) */}
          <div className="mb-3 flex items-center gap-2 px-1">
            <span className="text-xs text-gray-500">{t("vacanciesDetail.scoreThreshold")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                value={minScore}
                disabled={anyRunning}
                onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-14 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-center focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
            <input
              type="range" min={0} max={100} step={5}
              value={minScore}
              disabled={anyRunning}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-40 h-1.5 accent-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Method cards grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">

            {/* ── Из нашей базы — ПЕРВЫЙ (активный) ── */}
            <div className="space-y-2">
              <MethodCard
                id="db"
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
                  </svg>
                }
                label={t("vacanciesDetail.dbLabel")}
                description={t("vacanciesDetail.dbDescription")}
                steps={[
                  t("vacanciesDetail.dbStep1"),
                  t("vacanciesDetail.dbStep2"),
                  t("vacanciesDetail.dbStep3"),
                  t("vacanciesDetail.dbStep4", { minScore }),
                ]}
                badge={<span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-600">≥{minScore}%</span>}
                running={dbMatching}
                disabled={anyRunning && !dbMatching}
                result={dbResult}
                onClick={dbMatching ? stopDb : matchFromDb}
                onStop={stopDb}
                accentColor="#ec4899"
                accentBg="#fdf2f8"
                accentBorder="#fbcfe8"
              />
              {(dbMatching || dbSteps.length > 0) && (
                <MatchTimeline steps={dbSteps} running={dbMatching} />
              )}
            </div>

            {/* Умный поиск HH */}
            <div className="space-y-2">
              <MethodCard
                id="rematch"
                icon={<Image src="/hh-logo.svg" width={16} height={16} alt="hh.ru" />}
                label={t("vacanciesDetail.hhLabel")}
                description={t("vacanciesDetail.hhDescription")}
                steps={[
                  t("vacanciesDetail.hhStep1"),
                  t("vacanciesDetail.hhStep2"),
                  t("vacanciesDetail.hhStep3"),
                  t("vacanciesDetail.hhStep4", { minScore }),
                ]}
                badge={<span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600">≥{minScore}%</span>}
                running={hhMatching}
                disabled={anyRunning && !hhMatching}
                result={hhResult}
                onClick={hhMatching ? stopHh : matchFromHh}
                onStop={stopHh}
                accentColor="#3b82f6" accentBg="#eff6ff" accentBorder="#bfdbfe"
              />
              <Dialog open={showHhSettings} onOpenChange={setShowHhSettings}>
                <DialogTrigger className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                  {t("matchingUi.searchSettings")}
                </DialogTrigger>
                <DialogContent>
                  <DialogTitle>{t("matchingUi.searchSettings")}</DialogTitle>
                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-gray-500 mb-1">{t("vacanciesDetail.hhIncludeCompanies")}</label>
                      <input
                        value={includeCompanies}
                        onChange={(e) => setIncludeCompanies(e.target.value)}
                        placeholder="Beeline, Yandex"
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">{t("vacanciesDetail.hhExcludeCompanies")}</label>
                      <input
                        value={excludeCompanies}
                        onChange={(e) => setExcludeCompanies(e.target.value)}
                        placeholder="TBC Bank"
                        className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              {(hhMatching || hhSteps.length > 0) && (
                <MatchTimeline steps={hhSteps} running={hhMatching} phases={HH_MATCH_PHASES} />
              )}
            </div>

            {/* Umumiy — combined rerank across every method already run */}
            <div className="space-y-2">
              <MethodCard
                id="combined"
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                }
                label={t("vacanciesDetail.combinedLabel")}
                description={t("vacanciesDetail.combinedDescription")}
                steps={[
                  t("vacanciesDetail.combinedStep1"),
                  t("vacanciesDetail.combinedStep2"),
                  t("vacanciesDetail.combinedStep3", { minScore }),
                ]}
                badge={<span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-600">≥{minScore}%</span>}
                running={combinedMatching}
                disabled={(anyRunning && !combinedMatching) || rawCandidates.length === 0}
                result={combinedResult}
                onClick={combinedMatching ? stopCombined : matchFromCombined}
                onStop={stopCombined}
                accentColor="#0d9488" accentBg="#f0fdfa" accentBorder="#99f6e4"
              />
              {(combinedMatching || combinedSteps.length > 0) && (
                <MatchTimeline steps={combinedSteps} running={combinedMatching} phases={HH_MATCH_PHASES} />
              )}
            </div>

            {/* Векторный пул — Скоро */}
            <div className="relative">
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="pool"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>}
                  label={t("vacanciesDetail.poolLabel")}
                  description={t("vacanciesDetail.poolDescription")}
                  steps={[t("vacanciesDetail.poolStep1"), t("vacanciesDetail.poolStep2"), t("vacanciesDetail.poolStep3")]}
                  running={false} disabled={true} result={null} onClick={() => {}}
                  accentColor="#8b5cf6" accentBg="#f5f3ff" accentBorder="#ddd6fe"
                />
              </div>
              <div className="absolute inset-0 rounded-xl backdrop-blur-[2px] bg-white/70 flex items-center justify-center">
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">{t("vacanciesDetail.comingSoon")}</span>
              </div>
            </div>

            {/* Живой пул — Скоро */}
            <div className="relative">
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="live"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>}
                  label={t("vacanciesDetail.liveLabel")}
                  description={t("vacanciesDetail.liveDescription")}
                  steps={[t("vacanciesDetail.liveStep1"), t("vacanciesDetail.liveStep2"), t("vacanciesDetail.liveStep3")]}
                  running={false} disabled={true} result={null} onClick={() => {}}
                  accentColor="#10b981" accentBg="#ecfdf5" accentBorder="#a7f3d0"
                />
              </div>
              <div className="absolute inset-0 rounded-xl backdrop-blur-[2px] bg-white/70 flex items-center justify-center">
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">{t("vacanciesDetail.comingSoon")}</span>
              </div>
            </div>

            {/* Загрузка файла — Скоро */}
            <div className="relative">
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={onFileChange} />
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="file"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>}
                  label={t("vacanciesDetail.fileLabel")}
                  description={t("vacanciesDetail.fileDescription")}
                  steps={[
                    t("vacanciesDetail.fileStep1"),
                    t("vacanciesDetail.fileStep2"),
                    t("vacanciesDetail.fileStep3"),
                    t("vacanciesDetail.fileStep4"),
                  ]}
                  running={fileMatching}
                  disabled={anyRunning && !fileMatching}
                  result={fileResult}
                  onClick={() => fileInputRef.current?.click()}
                  accentColor="#f59e0b"
                  accentBg="#fffbeb"
                  accentBorder="#fde68a"
                />
              </div>
              <div className="absolute inset-0 rounded-xl backdrop-blur-[2px] bg-white/70 flex items-center justify-center">
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">{t("vacanciesDetail.comingSoon")}</span>
              </div>
            </div>

          </div>
        </div>
      )}


      {/* ── Candidates ──────────────────────────────────────────────────────── */}
      {rawCandidates.length > 0 && (
        <div id="candidates-section" className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t("vacanciesDetail.candidatesHeading", { count: candidates.length })}
            </p>
            <div className="flex items-center gap-1.5 rounded-full bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setResultTab("llm")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "llm" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesDetail.tabLlm", { count: llmCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("vector")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "vector" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesDetail.tabVector", { count: vectorCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("hh")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "hh" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesDetail.tabHh", { count: hhCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("combined")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "combined" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesDetail.tabCombined", { count: combinedCandidates.length })}
              </button>
            </div>
          </div>
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              {resultTab === "llm"
                ? t("vacanciesDetail.emptyLlm")
                : resultTab === "vector"
                ? t("vacanciesDetail.emptyVector")
                : resultTab === "combined"
                ? t("vacanciesDetail.emptyCombined")
                : t("vacanciesDetail.emptyHh")}
            </div>
          ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colName")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colPosition")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colCity")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colSalary")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colSkills")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colResume")}</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesDetail.colMatch")}</th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium uppercase tracking-wide text-gray-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    score={resultTab === "vector" ? c.vector_score ?? c.relevance_score : c.llm_score}
                    onSaved={() => candidateApi.byVacancy(id).then((r) => mutateCandidates(r.data as Candidate[], { revalidate: false }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {vacancy.status === "approved" && candidates.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">{t("vacanciesDetail.noCandidatesYet")}</p>
        </div>
      )}

      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
