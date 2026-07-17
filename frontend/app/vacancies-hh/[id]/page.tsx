"use client";

import { use, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonLine, SkeletonTableRows } from "@/components/ui/skeleton";
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/context";
import { InfoItem } from "@/components/vacancies/InfoItem";
import { MethodCard } from "@/components/vacancies/MethodCard";
import { MatchTimeline, MatchStep, HH_MATCH_PHASES } from "@/components/vacancies/MatchTimeline";
import { CandidateRow } from "@/components/vacancies/CandidateRow";
import { CriteriaEditor, Criterion } from "@/components/vacancies/CriteriaEditor";
import { hhVacancyApi, candidateApi, matchingApi, vacancyApi } from "@/lib/api";
import { VacancyHhDetail } from "@/types/vacancyHh";
import { Vacancy } from "@/types/vacancy";
import { Candidate } from "@/types/candidate";
import useSWR from "swr";
import { usePersistedSteps } from "@/lib/usePersistedSteps";

type Props = { params: Promise<{ id: string }> };
type ResultTab = "llm" | "vector" | "hh_responses" | "hh" | "combined";

// hh.ru returns the posting's own HTML; render as plain text (paragraph breaks kept) to avoid
// injecting untrusted markup into the page.
function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fmtSalary(salary: VacancyHhDetail["salary"]): string | null {
  if (!salary || (salary.from == null && salary.to == null)) return null;
  const f = salary.from != null ? new Intl.NumberFormat("ru-RU").format(salary.from) : null;
  const t = salary.to != null ? new Intl.NumberFormat("ru-RU").format(salary.to) : null;
  return [f, t].filter(Boolean).join(" – ") + (salary.currency ? ` ${salary.currency}` : "");
}

const byBestScore = (a: Candidate, b: Candidate) =>
  (b.llm_score ?? b.vector_score ?? b.relevance_score ?? 0) - (a.llm_score ?? a.vector_score ?? a.relevance_score ?? 0);

export default function VacancyHhDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useLocale();

  const { data: vacancy } = useSWR<VacancyHhDetail>(
    `hh-vacancy-${id}`,
    () => hhVacancyApi.get(id).then((r) => r.data)
  );
  const internalId = vacancy?.internal_vacancy_id;

  const { data: rawCandidates = [], mutate: mutateCandidates } = useSWR<Candidate[]>(
    internalId ? `candidates-${internalId}` : null,
    () => candidateApi.byVacancy(internalId!).then((r) => r.data)
  );

  // Backing internal Vacancy — only fetched here for its score_criteria (LLM matching
  // weights), which every method above reads and this page lets a recruiter tune.
  const { data: internalVacancy, mutate: mutateInternalVacancy } = useSWR<Vacancy>(
    internalId ? `vacancy-${internalId}` : null,
    () => vacancyApi.get(internalId!).then((r) => r.data)
  );
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  useEffect(() => {
    if (internalVacancy?.score_criteria?.length) {
      setCriteria(internalVacancy.score_criteria);
    }
  }, [internalVacancy]);

  const saveCriteria = async () => {
    if (!internalId) return;
    setCriteriaSaving(true);
    try {
      const res = await vacancyApi.update(internalId, { score_criteria: criteria });
      mutateInternalVacancy(res.data as Vacancy, { revalidate: false });
      toast.success(t("vacanciesHhDetail.criteriaSaved"));
    } catch {
      toast.error(t("vacanciesHhDetail.criteriaSaveError"));
    } finally {
      setCriteriaSaving(false);
    }
  };

  // "Из нашей базы" only LLM-scores its top-N reranked hits — the rest only ever
  // got a vector/skill-bonus score. Split those into separate tabs, same as the
  // internal vacancy detail page does (frontend/app/vacancies/[id]/page.tsx).
  const dbCandidates = rawCandidates.filter((c) => c.match_source === "db_search");
  const llmCandidates = dbCandidates.filter((c) => c.llm_score != null).sort(byBestScore);
  const vectorCandidates = dbCandidates.filter((c) => c.llm_score == null).sort(byBestScore);
  const hhRespCandidates = rawCandidates.filter((c) => c.match_source === "hh_responses").sort(byBestScore);
  const hhCandidates = rawCandidates.filter((c) => c.match_source === "hh").sort(byBestScore);
  const combinedCandidates = rawCandidates.filter((c) => c.match_source === "combined").sort(byBestScore);

  const [resultTab, setResultTab] = useState<ResultTab>("llm");
  const candidates =
    resultTab === "llm" ? llmCandidates
    : resultTab === "vector" ? vectorCandidates
    : resultTab === "hh_responses" ? hhRespCandidates
    : resultTab === "combined" ? combinedCandidates
    : hhCandidates;

  const [minScore, setMinScore] = useState(40);

  const [dbMatching, setDbMatching] = useState(false);
  const [dbSteps, setDbSteps] = useState<MatchStep[]>([]);
  const [dbResult, setDbResult] = useState<number | null>(null);
  const dbSourceRef = useRef<EventSource | null>(null);

  const [hhRespMatching, setHhRespMatching] = useState(false);
  const [hhRespSteps, setHhRespSteps] = useState<MatchStep[]>([]);
  const [hhRespResult, setHhRespResult] = useState<number | null>(null);
  const hhRespSourceRef = useRef<EventSource | null>(null);

  const [hhMatching, setHhMatching] = useState(false);
  const [hhSteps, setHhSteps] = useState<MatchStep[]>([]);
  const [hhResult, setHhResult] = useState<number | null>(null);
  const hhSourceRef = useRef<EventSource | null>(null);
  const [includeCompanies, setIncludeCompanies] = useState("");
  const [excludeCompanies, setExcludeCompanies] = useState("");
  const [showHhSettings, setShowHhSettings] = useState(false);
  const [hhPage, setHhPage] = useState(0);

  const [combinedMatching, setCombinedMatching] = useState(false);
  const [combinedSteps, setCombinedSteps] = useState<MatchStep[]>([]);
  const [combinedResult, setCombinedResult] = useState<number | null>(null);
  const combinedSourceRef = useRef<EventSource | null>(null);

  const anyRunning = dbMatching || hhRespMatching || hhMatching || combinedMatching;

  const refreshCandidates = () => {
    if (!internalId) return;
    candidateApi.byVacancy(internalId).then((r) =>
      mutateCandidates(r.data as Candidate[], { revalidate: false })
    );
  };

  const scrollToCandidates = () => {
    setTimeout(() => {
      document.getElementById("candidates-section")?.scrollIntoView({ behavior: "smooth" });
    }, 400);
  };

  const matchFromDb = () => {
    if (!internalId) return;
    setDbMatching(true); setDbSteps([]); setDbResult(null);
    const source = new EventSource(matchingApi.matchFromDbStreamUrl(internalId, minScore), { withCredentials: true });
    dbSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setDbSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); dbSourceRef.current = null;
        setDbMatching(false); setDbResult(event.matched ?? 0);
        (event.matched ?? 0) > 0
          ? toast.success(t("vacanciesHhDetail.toastDbFound", { count: event.matched ?? 0 }))
          : toast.info(t("vacanciesHhDetail.toastNoCandidates"));
        refreshCandidates(); setResultTab("llm"); scrollToCandidates();
      }
      if (event.step === "error") {
        source.close(); dbSourceRef.current = null;
        setDbMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); dbSourceRef.current = null; setDbMatching(false);
      setDbSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastConnectionLost") }]);
    };
  };
  const stopDb = () => {
    dbSourceRef.current?.close(); dbSourceRef.current = null;
    setDbMatching(false);
    setDbSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastStoppedByUser") }]);
  };

  const matchFromHhResponses = () => {
    if (!internalId) return;
    setHhRespMatching(true); setHhRespSteps([]); setHhRespResult(null);
    const source = new EventSource(matchingApi.matchFromHhResponsesStreamUrl(internalId, minScore), { withCredentials: true });
    hhRespSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setHhRespSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); hhRespSourceRef.current = null;
        setHhRespMatching(false); setHhRespResult(event.matched ?? 0);
        (event.matched ?? 0) > 0
          ? toast.success(t("vacanciesHhDetail.toastHhRespFound", { count: event.matched ?? 0 }))
          : toast.info(t("vacanciesHhDetail.toastNoResponses"));
        refreshCandidates(); setResultTab("hh_responses"); scrollToCandidates();
      }
      if (event.step === "error") {
        source.close(); hhRespSourceRef.current = null;
        setHhRespMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); hhRespSourceRef.current = null; setHhRespMatching(false);
      setHhRespSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastConnectionLost") }]);
    };
  };
  const stopHhResponses = () => {
    hhRespSourceRef.current?.close(); hhRespSourceRef.current = null;
    setHhRespMatching(false);
    setHhRespSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastStoppedByUser") }]);
  };

  // Reset pagination whenever the search filters change — a new filter means a fresh search, not "more of the same".
  useEffect(() => { setHhPage(0); }, [includeCompanies, excludeCompanies]);

  // Timelines survive a page refresh instead of vanishing — restored as historical (never re-marked as "running").
  usePersistedSteps(`dh-match-steps-${id}-db`, dbSteps, setDbSteps);
  usePersistedSteps(`dh-match-steps-${id}-hh-responses`, hhRespSteps, setHhRespSteps);
  usePersistedSteps(`dh-match-steps-${id}-hh`, hhSteps, setHhSteps);
  usePersistedSteps(`dh-match-steps-${id}-combined`, combinedSteps, setCombinedSteps);

  const matchFromHh = () => {
    if (!internalId) return;
    setHhMatching(true); setHhSteps([]); setHhResult(null);
    const source = new EventSource(
      matchingApi.matchFromHhStreamUrl(internalId, minScore, includeCompanies || undefined, excludeCompanies || undefined, hhPage),
      { withCredentials: true }
    );
    hhSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setHhSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); hhSourceRef.current = null;
        setHhMatching(false); setHhResult(event.matched ?? 0);
        setHhPage((p) => p + 1);
        (event.matched ?? 0) > 0
          ? toast.success(t("vacanciesHhDetail.toastHhFound", { count: event.matched ?? 0 }))
          : toast.info(t("vacanciesHhDetail.toastNoCandidates"));
        refreshCandidates(); setResultTab("hh"); scrollToCandidates();
      }
      if (event.step === "error") {
        source.close(); hhSourceRef.current = null;
        setHhMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); hhSourceRef.current = null; setHhMatching(false);
      setHhSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastConnectionLost") }]);
    };
  };
  const stopHh = () => {
    hhSourceRef.current?.close(); hhSourceRef.current = null;
    setHhMatching(false);
    setHhSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastStoppedByUser") }]);
  };

  const matchFromCombined = () => {
    if (!internalId) return;
    setCombinedMatching(true); setCombinedSteps([]); setCombinedResult(null);
    const source = new EventSource(matchingApi.matchFromCombinedStreamUrl(internalId, minScore), { withCredentials: true });
    combinedSourceRef.current = source;
    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setCombinedSteps((prev) => [...prev, event]);
      if (event.step === "done") {
        source.close(); combinedSourceRef.current = null;
        setCombinedMatching(false); setCombinedResult(event.matched ?? 0);
        (event.matched ?? 0) > 0
          ? toast.success(t("vacanciesHhDetail.toastCombinedFound", { count: event.matched ?? 0 }))
          : toast.info(t("vacanciesHhDetail.toastNoCandidatesToCombine"));
        refreshCandidates(); setResultTab("combined"); scrollToCandidates();
      }
      if (event.step === "error") {
        source.close(); combinedSourceRef.current = null;
        setCombinedMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); combinedSourceRef.current = null; setCombinedMatching(false);
      setCombinedSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastConnectionLost") }]);
    };
  };
  const stopCombined = () => {
    combinedSourceRef.current?.close(); combinedSourceRef.current = null;
    setCombinedMatching(false);
    setCombinedSteps((prev) => [...prev, { step: "error", message: t("vacanciesHhDetail.toastStoppedByUser") }]);
  };

  if (!vacancy) {
    return (
      <div>
        {/* Vacancy card skeleton */}
        <Skeleton className="mb-6 h-4 w-16 rounded" />
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <SkeletonLine className="h-6 w-64" />
            <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonLine className="h-3 w-16" />
                <SkeletonLine className="h-4 w-24" />
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-full" />
            ))}
          </div>

          <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
            <SkeletonLine className="h-3.5 w-full" />
            <SkeletonLine className="h-3.5 w-full" />
            <SkeletonLine className="h-3.5 w-2/3" />
          </div>
        </div>

        {/* Method card grid skeleton */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>

        {/* Results table skeleton */}
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="py-2.5 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableName")}</th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tablePosition")}</th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.infoCity")}</th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.infoSalary")}</th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableSkills")}</th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableResume")}</th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableMatch")}</th>
                <th className="px-3 py-2.5 pr-4 text-xs font-medium uppercase tracking-wide text-gray-400"></th>
              </tr>
            </thead>
            <SkeletonTableRows rows={6} cols={8} />
          </table>
        </div>
      </div>
    );
  }

  const salary = fmtSalary(vacancy.salary);

  return (
    <div>
      <button
        onClick={() => router.push("/vacancies")}
        className="mb-6 text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        ← {t("common.back")}
      </button>

      {/* Vacancy card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">{vacancy.name}</h1>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 shrink-0">
            {vacancy.status}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <InfoItem label={t("vacanciesHhDetail.infoCity")} value={vacancy.region} />
          <InfoItem label={t("vacanciesHhDetail.infoSalary")} value={salary} />
          <InfoItem label={t("vacanciesHhDetail.infoExperience")} value={vacancy.experience} />
          <InfoItem label={t("vacanciesHhDetail.infoWorkFormat")} value={(vacancy.work_format ?? []).join(", ") || null} />
          <InfoItem label={t("vacanciesHhDetail.infoAddress")} value={vacancy.address} />
          <InfoItem
            label={t("vacanciesHhDetail.infoCounters")}
            value={`${vacancy.counters.responses} / ${vacancy.counters.views} / ${vacancy.counters.invitations}`}
          />
        </div>

        {vacancy.key_skills.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {vacancy.key_skills.map((s) => (
              <span key={s} className="rounded-md bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                {s}
              </span>
            ))}
          </div>
        )}

        {vacancy.description && (
          <p className="mt-5 border-t border-gray-100 pt-4 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">
            {htmlToText(vacancy.description)}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          <Button
            variant="outline"
            size="sm"
            render={<a href={vacancy.url} target="_blank" rel="noopener noreferrer">{t("vacanciesHhDetail.openOnHh")}</a>}
          />
        </div>
      </div>

      {/* AI Matching Panel */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-gray-800">{t("vacanciesHhDetail.aiPanelTitle")}</span>
          <span className="ml-auto text-[11px] text-gray-400">{t("vacanciesHhDetail.aiPanelHint")}</span>
        </div>

        {criteria.length > 0 && (
          <div className="mb-4">
            <CriteriaEditor criteria={criteria} onChange={setCriteria} />
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled={criteriaSaving} onClick={saveCriteria}>
                {criteriaSaving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        )}

        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="text-xs text-gray-500">{t("vacanciesHhDetail.scoreThreshold")}</span>
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Из нашей базы */}
          <div className="space-y-2">
            <MethodCard
              id="db"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
                </svg>
              }
              label={t("vacanciesHhDetail.methodDbLabel")}
              description={t("vacanciesHhDetail.methodDbDescription")}
              steps={[
                t("vacanciesHhDetail.methodDbStep1"),
                t("vacanciesHhDetail.methodDbStep2"),
                t("vacanciesHhDetail.methodDbStep3"),
                t("vacanciesHhDetail.stepSaveThreshold", { minScore }),
              ]}
              badge={<span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-600">≥{minScore}%</span>}
              running={dbMatching}
              disabled={anyRunning && !dbMatching}
              result={dbResult ?? (dbCandidates.length > 0 ? dbCandidates.length : null)}
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

          {/* Отклики на вакансию (HH) */}
          <div className="space-y-2">
            <MethodCard
              id="hh_responses"
              icon={<Image src="/hh-logo.svg" width={16} height={16} alt="hh.ru" />}
              label={t("vacanciesHhDetail.methodHhRespLabel")}
              description={t("vacanciesHhDetail.methodHhRespDescription")}
              steps={[
                t("vacanciesHhDetail.methodHhRespStep1"),
                t("vacanciesHhDetail.methodHhRespStep2"),
                t("vacanciesHhDetail.stepSaveThreshold", { minScore }),
              ]}
              badge={<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-600">≥{minScore}%</span>}
              running={hhRespMatching}
              disabled={anyRunning && !hhRespMatching}
              result={hhRespResult ?? (hhRespCandidates.length > 0 ? hhRespCandidates.length : null)}
              onClick={hhRespMatching ? stopHhResponses : matchFromHhResponses}
              onStop={stopHhResponses}
              accentColor="#7c3aed"
              accentBg="#f5f3ff"
              accentBorder="#ddd6fe"
            />
            {(hhRespMatching || hhRespSteps.length > 0) && (
              <MatchTimeline steps={hhRespSteps} running={hhRespMatching} phases={HH_MATCH_PHASES} />
            )}
          </div>

          {/* Умный поиск HH */}
          <div className="space-y-2">
            <Dialog open={showHhSettings} onOpenChange={setShowHhSettings}>
              <MethodCard
                id="hh"
                icon={<Image src="/hh-logo.svg" width={16} height={16} alt="hh.ru" />}
                label={t("vacanciesHhDetail.methodHhLabel")}
                description={t("vacanciesHhDetail.methodHhDescription")}
                steps={[
                  t("vacanciesHhDetail.methodHhStep1"),
                  t("vacanciesHhDetail.methodHhStep2"),
                  t("vacanciesHhDetail.methodHhStep3"),
                  t("vacanciesHhDetail.stepSaveThreshold", { minScore }),
                ]}
                badge={<span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600">≥{minScore}%</span>}
                running={hhMatching}
                disabled={anyRunning && !hhMatching}
                result={hhResult ?? (hhCandidates.length > 0 ? hhCandidates.length : null)}
                onClick={hhMatching ? stopHh : matchFromHh}
                onStop={stopHh}
                cornerAction={
                  <DialogTrigger
                    title={t("matchingUi.searchSettings")}
                    className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-blue-500 shadow-md transition-all hover:scale-110 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                  </DialogTrigger>
                }
                accentColor="#3b82f6" accentBg="#eff6ff" accentBorder="#bfdbfe"
              />
              <DialogContent>
                <DialogTitle>{t("matchingUi.searchSettings")}</DialogTitle>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-gray-500 mb-1">{t("vacanciesHhDetail.settingsIncludeLabel")}</label>
                    <input
                      value={includeCompanies}
                      onChange={(e) => setIncludeCompanies(e.target.value)}
                      placeholder={t("vacanciesHhDetail.settingsIncludePlaceholder")}
                      className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">{t("vacanciesHhDetail.settingsExcludeLabel")}</label>
                    <input
                      value={excludeCompanies}
                      onChange={(e) => setExcludeCompanies(e.target.value)}
                      placeholder={t("vacanciesHhDetail.settingsExcludePlaceholder")}
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
              label={t("vacanciesHhDetail.methodCombinedLabel")}
              description={t("vacanciesHhDetail.methodCombinedDescription")}
              steps={[
                t("vacanciesHhDetail.methodCombinedStep1"),
                t("vacanciesHhDetail.methodCombinedStep2"),
                t("vacanciesHhDetail.stepSaveThreshold", { minScore }),
              ]}
              badge={<span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-600">≥{minScore}%</span>}
              running={combinedMatching}
              disabled={(anyRunning && !combinedMatching) || rawCandidates.length === 0}
              result={combinedResult ?? (combinedCandidates.length > 0 ? combinedCandidates.length : null)}
              onClick={combinedMatching ? stopCombined : matchFromCombined}
              onStop={stopCombined}
              accentColor="#0d9488" accentBg="#f0fdfa" accentBorder="#99f6e4"
            />
            {(combinedMatching || combinedSteps.length > 0) && (
              <MatchTimeline steps={combinedSteps} running={combinedMatching} phases={HH_MATCH_PHASES} />
            )}
          </div>
        </div>
      </div>

      {/* Candidates */}
      {rawCandidates.length > 0 && (
        <div id="candidates-section" className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t("vacanciesHhDetail.candidatesHeading", { count: candidates.length })}
            </p>
            <div className="flex items-center gap-1.5 rounded-full bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setResultTab("llm")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "llm" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesHhDetail.tabLlm", { count: llmCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("vector")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "vector" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesHhDetail.tabVector", { count: vectorCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("hh_responses")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "hh_responses" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesHhDetail.tabHhResponses", { count: hhRespCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("hh")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "hh" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesHhDetail.tabHh", { count: hhCandidates.length })}
              </button>
              <button
                type="button"
                onClick={() => setResultTab("combined")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "combined" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t("vacanciesHhDetail.tabCombined", { count: combinedCandidates.length })}
              </button>
            </div>
          </div>
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              {t("vacanciesHhDetail.emptyTab")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="py-2.5 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableName")}</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tablePosition")}</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.infoCity")}</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.infoSalary")}</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableSkills")}</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableResume")}</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">{t("vacanciesHhDetail.tableMatch")}</th>
                    <th className="px-3 py-2.5 pr-4 text-xs font-medium uppercase tracking-wide text-gray-400"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {candidates.map((c) => (
                    <CandidateRow
                      key={c.id}
                      candidate={c}
                      score={resultTab === "vector" ? c.vector_score ?? c.relevance_score : c.llm_score}
                      onSaved={refreshCandidates}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {rawCandidates.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">{t("vacanciesHhDetail.emptyAll")}</p>
        </div>
      )}
    </div>
  );
}
