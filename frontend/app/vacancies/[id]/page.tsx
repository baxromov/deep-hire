"use client";

import { use, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { vacancyApi, candidateApi, matchingApi, talentPoolApi, API_BASE } from "@/lib/api";
import { Vacancy, EXPERIENCE_OPTIONS, EMPLOYMENT_OPTIONS, SCHEDULE_OPTIONS } from "@/types/vacancy";
import { Candidate } from "@/types/candidate";
import useSWR from "swr";

// ─── Types ────────────────────────────────────────────────────────────────────

type MatchStep = {
  step: string;
  message: string;
  page?: number;
  count?: number;
  total?: number;
  passed?: number;
  matched?: number;
  qualifying?: number;
  collected?: number;
  needed?: number;
  pages?: number;
  top_score?: number;
  queries?: string[];
  hits?: number;
  upserted?: number;
  batch?: number;
  total_batches?: number;
  skills?: string[];
};

type MethodId = "rematch" | "pool" | "live" | "file" | "db";


// ─── Matching Method Card ─────────────────────────────────────────────────────

type MethodCardProps = {
  id: MethodId;
  icon: React.ReactNode;
  label: string;
  description: string;
  steps: string[];
  badge?: React.ReactNode;
  running: boolean;
  disabled: boolean;
  result?: number | null;   // matched count after last run
  onClick: () => void;
  onStop?: () => void;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
};

function MethodCard({ id, icon, label, description, steps, badge, running, disabled, result, onClick, onStop, accentColor, accentBg, accentBorder }: MethodCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const hasResult = result != null;

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={disabled || running}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="group relative flex w-full flex-col items-start gap-2 overflow-hidden rounded-xl border p-4 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          borderColor: running ? accentColor : hasResult && result! > 0 ? accentColor + "60" : "#e2e8f0",
          background: running ? accentBg : "white",
          boxShadow: running ? `0 0 0 2px ${accentColor}40, 0 4px 12px ${accentColor}20` : "none",
        }}
      >
        {/* Running shimmer */}
        {running && (
          <div
            className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
            style={{ background: `linear-gradient(90deg, transparent, ${accentColor}10, transparent)` }}
          />
        )}

        {/* Icon + badge row */}
        <div className="flex w-full items-start justify-between">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-base"
            style={{ background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}
          >
            {icon}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Result star badge */}
            {hasResult && !running && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: result! > 0 ? accentColor + "18" : "#64748b18",
                  color: result! > 0 ? accentColor : "#64748b",
                  border: `1px solid ${result! > 0 ? accentColor + "30" : "#64748b30"}`,
                }}
              >
                {result! > 0 ? "★" : "○"} {result! > 0 ? `${result} найдено` : "0 найдено"}
              </span>
            )}
            {badge}
          </div>
        </div>

        {/* Label */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-800 group-hover:text-gray-900">
            {label}
          </span>
          {running && (
            <span
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: accentBg, color: accentColor }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accentColor }} />
              Запуск
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-[11.5px] leading-relaxed text-gray-400">{description}</p>
      </button>

      {/* Stop button — shown when running */}
      {running && onStop && (
        <button
          onClick={(e) => { e.stopPropagation(); onStop(); }}
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:opacity-90 active:scale-95"
          style={{
            background: "#0f172a",
            color: "#f87171",
            border: "1px solid #ef444430",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
          title="Остановить подбор"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1.5"/>
          </svg>
          Stop
        </button>
      )}

      {/* Tooltip */}
      {showTooltip && !running && !disabled && (
        <div
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl p-3 shadow-xl"
          style={{
            background: "#0f172a",
            border: `1px solid ${accentColor}40`,
            boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${accentColor}20`,
          }}
        >
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: accentColor }}
          >
            Как работает
          </p>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] text-slate-300">
                <span
                  className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                  style={{ background: accentColor + "20", color: accentColor }}
                >
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          {/* Arrow */}
          <div
            className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45"
            style={{ background: "#0f172a", border: `1px solid ${accentColor}40`, borderTop: "none", borderLeft: "none" }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Match Timeline ────────────────────────────────────────────────────────────

const MATCH_PHASES = [
  { id: "search", label: "Поиск",      steps: ["planning", "embedding", "searching", "fetched"] },
  { id: "vector", label: "Векторный",  steps: ["reranking", "reranked"] },
  { id: "llm",    label: "LLM оценка", steps: ["llm_scoring", "llm_scored", "scoring"] },
  { id: "done",   label: "Готово",     steps: ["done"] },
] as const;

type PhaseStatus = "pending" | "active" | "done" | "skipped";

function MatchTimeline({ steps, running }: { steps: MatchStep[]; running: boolean }) {
  const stepNames = steps.map((s) => s.step);
  const lastStep = steps[steps.length - 1];
  const isDone = stepNames.includes("done");

  const getStatus = (phaseIdx: number): PhaseStatus => {
    const phase = MATCH_PHASES[phaseIdx];
    const next = MATCH_PHASES[phaseIdx + 1];
    const thisStarted = phase.steps.some((s) => stepNames.includes(s));
    const nextStarted = next ? next.steps.some((s) => stepNames.includes(s)) : false;
    if (isDone) return "done";
    if (nextStarted && !thisStarted) return "skipped";
    if (nextStarted) return "done";
    if (thisStarted) return "active";
    return "pending";
  };

  const activeMessage = running && lastStep && !isDone ? lastStep.message : null;

  return (
    <div className="mt-3 rounded-xl border border-pink-100 bg-pink-50/60 px-3 pt-3 pb-2">
      <div className="flex items-start">
        {MATCH_PHASES.map((phase, idx) => {
          const status = getStatus(idx);
          const isLast = idx === MATCH_PHASES.length - 1;
          const icons: Record<string, string> = { search: "🔍", vector: "⚡", llm: "🤖", done: "✅" };
          return (
            <div key={phase.id} className="flex flex-1 items-start">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm transition-all duration-300 ${
                    status === "done"
                      ? "bg-pink-500 text-white"
                      : status === "active"
                      ? "bg-pink-400 text-white ring-2 ring-pink-200 animate-pulse"
                      : status === "skipped"
                      ? "bg-gray-200 text-gray-400"
                      : "bg-gray-100 text-gray-300"
                  }`}
                >
                  {status === "done" ? "✓" : icons[phase.id]}
                </div>
                <span
                  className={`text-[9px] font-medium text-center whitespace-nowrap ${
                    status === "active" ? "text-pink-600" :
                    status === "done" ? "text-pink-500" :
                    status === "skipped" ? "text-gray-300" :
                    "text-gray-400"
                  }`}
                >
                  {phase.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 mt-3.5 h-0.5 mx-0.5 transition-all duration-300 ${
                    status === "done" || status === "skipped" ? "bg-pink-300" :
                    status === "active" ? "bg-pink-200" :
                    "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {activeMessage && (
        <p className="mt-1 text-[10px] text-pink-500 truncate">{activeMessage}</p>
      )}
    </div>
  );
}

// ─── Other helpers ────────────────────────────────────────────────────────────

type Props = { params: Promise<{ id: string }> };

const labelOf = (val: string | null, opts: { value: string; label: string }[]) =>
  opts.find((o) => o.value === val)?.label ?? val;

function CandidateRow({ candidate, score }: { candidate: Candidate; score: number | null }) {
  const router = useRouter();
  const name =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    candidate.title ||
    "Аноним";
  const salary = candidate.salary_amount
    ? `${new Intl.NumberFormat("ru-RU").format(candidate.salary_amount)} ${candidate.salary_currency || ""}`
    : null;

  return (
    <tr
      className="group cursor-pointer hover:bg-slate-50/60 transition-colors"
      onClick={() => router.push(`/candidates/${candidate.id}`)}
    >
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-gray-100">
            {candidate.photo_url ? (
              <Image src={candidate.photo_url} alt={name} width={28} height={28} className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-400">
                {name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
            {name}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 text-sm text-gray-500 max-w-[160px] truncate">{candidate.title || "—"}</td>
      <td className="px-3 py-3 text-sm text-gray-500">{candidate.area || "—"}</td>
      <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">{salary || "—"}</td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {candidate.skills.slice(0, 3).map((s) => (
            <span key={s} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{s}</span>
          ))}
          {candidate.skills.length > 3 && (
            <span className="text-xs text-gray-400">+{candidate.skills.length - 3}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 pr-4">
        {score != null && (
          <div>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                score >= 70
                  ? "bg-green-50 text-green-700"
                  : score >= 40
                  ? "bg-yellow-50 text-yellow-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {score}%
            </span>
            {candidate.score_criteria && candidate.score_criteria.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {candidate.score_criteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 truncate max-w-[80px]">{c.name}:</span>
                    <span className={`text-[10px] font-semibold ${
                      c.score >= 70 ? "text-green-600" : c.score >= 40 ? "text-yellow-600" : "text-red-500"
                    }`}>{c.score}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function InfoItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-800">{value}</p>
    </div>
  );
}

const PROGRESS_KEY = (id: string) => `rematch-progress-${id}`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VacancyDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();

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
  const [dbMinScore, setDbMinScore] = useState(40);

  const [resultTab, setResultTab] = useState<"llm" | "vector">("llm");

  // EventSource refs — used by stop handlers
  const rematchSourceRef = useRef<EventSource | null>(null);
  const poolSourceRef    = useRef<EventSource | null>(null);
  const liveSourceRef    = useRef<EventSource | null>(null);
  const dbSourceRef      = useRef<EventSource | null>(null);

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

  const vectorCandidates = [...rawCandidates].sort(
    (a, b) => (b.vector_score ?? b.relevance_score ?? 0) - (a.vector_score ?? a.relevance_score ?? 0)
  );
  const llmCandidates = rawCandidates
    .filter((c) => c.llm_score != null)
    .sort((a, b) => (b.llm_score ?? 0) - (a.llm_score ?? 0));
  const candidates = resultTab === "llm" ? llmCandidates : vectorCandidates;

  if (!vacancy) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  const duplicate = async () => {
    try {
      const res = await vacancyApi.duplicate(id);
      toast.success("Вакансия дублирована");
      router.push(`/vacancies/${res.data.id}/edit`);
    } catch {
      toast.error("Не удалось дублировать");
    }
  };

  const toggle = async () => {
    try {
      const res = await vacancyApi.toggleOpen(id);
      mutateVacancy(res.data);
      toast.success(res.data.is_open ? "Вакансия открыта" : "Вакансия закрыта");
    } catch {
      toast.error("Не удалось обновить статус");
    }
  };

  const approve = async () => {
    try {
      const res = await vacancyApi.approve(id);
      mutateVacancy(res.data);
      toast.success("Вакансия опубликована!");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Не удалось опубликовать";
      toast.error(msg);
    }
  };

  const archive = async () => {
    try {
      await vacancyApi.archive(id);
      toast.success("Вакансия архивирована");
      router.push("/vacancies");
    } catch {
      toast.error("Не удалось архивировать");
    }
  };

  const anyRunning = rematching || poolMatching || livePoolMatching || fileMatching || dbMatching;

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
        (event.matched ?? 0) > 0 ? toast.success(`Найдено ${event.matched} кандидатов`) : toast.info("Подходящих кандидатов не найдено.");
      }
      if (event.step === "error") {
        source.close(); rematchSourceRef.current = null;
        setRematching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); rematchSourceRef.current = null; setRematching(false);
      setMatchSteps((prev) => [...prev, { step: "error", message: "Соединение прервано. Попробуйте снова." }]);
    };
  };

  const stopRematch = () => {
    rematchSourceRef.current?.close();
    rematchSourceRef.current = null;
    setRematching(false);
    setMatchSteps((prev) => [...prev, { step: "error", message: "Остановлено пользователем." }]);
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
        (event.matched ?? 0) > 0 ? toast.success(`Найдено ${event.matched} кандидатов из пула`) : toast.info("Подходящих кандидатов не найдено в пуле.");
      }
      if (event.step === "error") {
        source.close(); poolSourceRef.current = null;
        setPoolMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); poolSourceRef.current = null; setPoolMatching(false);
      setPoolSteps((prev) => [...prev, { step: "error", message: "Соединение прервано. Попробуйте снова." }]);
    };
  };

  const stopPool = () => {
    poolSourceRef.current?.close();
    poolSourceRef.current = null;
    setPoolMatching(false);
    setPoolSteps((prev) => [...prev, { step: "error", message: "Остановлено пользователем." }]);
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
        (event.matched ?? 0) > 0 ? toast.success(`Найдено ${event.matched} кандидатов через живой пул`) : toast.info("Подходящих кандидатов не найдено в живом пуле.");
      }
      if (event.step === "error") {
        source.close(); liveSourceRef.current = null;
        setLivePoolMatching(false); toast.error(event.message);
      }
    };
    source.onerror = () => {
      source.close(); liveSourceRef.current = null; setLivePoolMatching(false);
      setLivePoolSteps((prev) => [...prev, { step: "error", message: "Соединение прервано. Попробуйте снова." }]);
    };
  };

  const stopLivePool = () => {
    liveSourceRef.current?.close();
    liveSourceRef.current = null;
    setLivePoolMatching(false);
    setLivePoolSteps((prev) => [...prev, { step: "error", message: "Остановлено пользователем." }]);
  };

  // ── From our DB ───────────────────────────────────────────────────────────
  const matchFromDb = () => {
    setDbMatching(true);
    setDbSteps([]);
    setDbResult(null);
    const url = matchingApi.matchFromDbStreamUrl(id, dbMinScore);
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
          toast.success(`Найдено ${event.matched} подходящих из базы`);
          // Explicitly fetch and push into SWR cache — avoids dedup/timing race with passive mutate()
          candidateApi.byVacancy(id).then((r) =>
            mutateCandidates(r.data as Candidate[], { revalidate: false })
          );
        } else {
          toast.info("Подходящих кандидатов не найдено.");
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
      setDbSteps((prev) => [...prev, { step: "error", message: "Соединение прервано. Попробуйте снова." }]);
    };
  };

  const stopDb = () => {
    dbSourceRef.current?.close();
    dbSourceRef.current = null;
    setDbMatching(false);
    setDbSteps((prev) => [...prev, { step: "error", message: "Остановлено пользователем." }]);
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
      const poolNote = pool_matched > 0 ? ` + ${pool_matched} похожих из пула` : "";
      toast.success(`${name} — балл: ${score}%${poolNote}`);
      mutateCandidates();
      setFileResult(total);
    } catch {
      toast.error("Не удалось обработать файл");
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
        ← Назад
      </button>

      {/* Vacancy card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">{vacancy.title || "Без названия"}</h1>
          <StatusBadge status={vacancy.status} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <InfoItem label="Город" value={vacancy.area} />
          <InfoItem label="Зарплата" value={salary ? `${salary} ${vacancy.currency}` : null} />
          <InfoItem label="Опыт" value={labelOf(vacancy.experience, EXPERIENCE_OPTIONS)} />
          <InfoItem label="Занятость" value={labelOf(vacancy.employment_type, EMPLOYMENT_OPTIONS)} />
          <InfoItem label="График" value={labelOf(vacancy.schedule, SCHEDULE_OPTIONS)} />
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
          <Button variant="outline" size="sm" onClick={() => router.push(`/vacancies/${id}/edit`)}>Редактировать</Button>
          <Button variant="outline" size="sm" onClick={duplicate}>Дублировать</Button>
          {vacancy.status === "draft" && vacancy.is_approvable && (
            <Button size="sm" onClick={approve}>Опубликовать</Button>
          )}
          {(vacancy.status === "approved" || vacancy.status === "closed") && (
            <Button variant="outline" size="sm" onClick={toggle}>
              {vacancy.is_open ? "Закрыть" : "Открыть"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {vacancy.status !== "archived" && (
              <Button variant="outline" size="sm" onClick={archive} className="text-red-400 hover:text-red-600 hover:border-red-200">
                Архив
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
            <span className="text-[13px] font-semibold text-gray-800">ИИ-подбор кандидатов</span>
            <span className="ml-auto text-[11px] text-gray-400">Наведите на карточку, чтобы увидеть как работает метод</span>
          </div>

          {/* Method cards grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">

            {/* ── Из нашей базы — ПЕРВЫЙ (активный) ── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs text-gray-500">Порог балла:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={dbMinScore}
                    disabled={dbMatching}
                    onChange={(e) => setDbMinScore(Math.max(0, Math.min(100, Number(e.target.value))))}
                    className="w-14 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-center focus:outline-none focus:ring-1 focus:ring-pink-400 disabled:opacity-50"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <input
                  type="range" min={0} max={100} step={5}
                  value={dbMinScore}
                  disabled={dbMatching}
                  onChange={(e) => setDbMinScore(Number(e.target.value))}
                  className="flex-1 h-1.5 accent-pink-500 disabled:opacity-50"
                />
              </div>
              <MethodCard
                id="db"
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
                  </svg>
                }
                label="Из нашей базы"
                description="Ищет кандидатов по векторной базе Qdrant, переранжирует кросс-энкодером и оценивает через LLM"
                steps={[
                  "Embed вакансии → поиск top-N в Qdrant",
                  "Кросс-энкодер переранжирует результаты",
                  "LLM оценивает каждого кандидата (0–100)",
                  `Сохраняет кандидатов с баллом ≥ ${dbMinScore}%`,
                ]}
                badge={<span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-600">≥{dbMinScore}%</span>}
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

            {/* Умный поиск HH — Скоро */}
            <div className="relative">
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="rematch"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>}
                  label="Умный поиск HH"
                  description="Поиск по HH.uz через ИИ-запросы"
                  steps={["ИИ генерирует поисковые запросы", "Поиск резюме на HH.uz", "Оценка кандидатов Ollama"]}
                  running={false} disabled={true} result={null} onClick={() => {}}
                  accentColor="#3b82f6" accentBg="#eff6ff" accentBorder="#bfdbfe"
                />
              </div>
              <div className="absolute inset-0 rounded-xl backdrop-blur-[2px] bg-white/70 flex items-center justify-center">
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">🔒 Скоро</span>
              </div>
            </div>

            {/* Векторный пул — Скоро */}
            <div className="relative">
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="pool"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>}
                  label="Векторный пул"
                  description="Поиск по предварительно проиндексированным кандидатам"
                  steps={["Векторное сходство (Qdrant)", "Переоценка через Ollama", "Сохранение топ кандидатов"]}
                  running={false} disabled={true} result={null} onClick={() => {}}
                  accentColor="#8b5cf6" accentBg="#f5f3ff" accentBorder="#ddd6fe"
                />
              </div>
              <div className="absolute inset-0 rounded-xl backdrop-blur-[2px] bg-white/70 flex items-center justify-center">
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">🔒 Скоро</span>
              </div>
            </div>

            {/* Живой пул — Скоро */}
            <div className="relative">
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="live"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>}
                  label="Живой пул HH"
                  description="2000 свежих резюме с HH.uz, временная индексация"
                  steps={["Загрузка 2000 резюме с HH.uz", "Временная индексация в Qdrant", "Векторный поиск + оценка"]}
                  running={false} disabled={true} result={null} onClick={() => {}}
                  accentColor="#10b981" accentBg="#ecfdf5" accentBorder="#a7f3d0"
                />
              </div>
              <div className="absolute inset-0 rounded-xl backdrop-blur-[2px] bg-white/70 flex items-center justify-center">
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">🔒 Скоро</span>
              </div>
            </div>

            {/* Загрузка файла — Скоро */}
            <div className="relative">
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={onFileChange} />
              <div className="pointer-events-none select-none opacity-70">
                <MethodCard
                  id="file"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>}
                  label="Загрузка файла"
                  description="Загрузите резюме — сохранит и найдёт похожих кандидатов из пула"
                  steps={[
                    "Извлечение текста из PDF/DOCX",
                    "ИИ парсит: имя, должность, навыки, зарплату",
                    "Ollama оценивает соответствие вакансии (0–100)",
                    "Сохраняет кандидата + ищет похожие профили",
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
                <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 tracking-wide shadow-sm">🔒 Скоро</span>
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
              Подходящие кандидаты ({candidates.length})
            </p>
            <div className="flex items-center gap-1.5 rounded-full bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setResultTab("llm")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "llm" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                LLM оценка ({llmCandidates.length})
              </button>
              <button
                type="button"
                onClick={() => setResultTab("vector")}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  resultTab === "vector" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Векторный поиск ({vectorCandidates.length})
              </button>
            </div>
          </div>
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              {resultTab === "llm"
                ? "Нет кандидатов, оценённых LLM — запустите поиск по базе (DB Search)."
                : "Нет кандидатов из векторного поиска."}
            </div>
          ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-gray-400">Имя</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">Должность</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">Город</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">Зарплата</th>
                  <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400">Навыки</th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium uppercase tracking-wide text-gray-400">Совпадение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    score={resultTab === "llm" ? c.llm_score : c.vector_score ?? c.relevance_score}
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
          <p className="text-sm text-gray-400">Пока нет кандидатов — выберите метод подбора выше.</p>
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
