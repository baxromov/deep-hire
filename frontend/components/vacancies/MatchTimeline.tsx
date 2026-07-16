"use client";

import { useLocale } from "@/lib/i18n/context";

export type MatchStep = {
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

export const MATCH_PHASES = [
  { id: "search", label: "Поиск",      steps: ["planning", "embedding", "searching", "fetched"] },
  { id: "vector", label: "Векторный",  steps: ["reranking", "reranked"] },
  { id: "llm",    label: "LLM оценка", steps: ["llm_scoring", "llm_scored", "scoring"] },
  { id: "done",   label: "Готово",     steps: ["done"] },
] as const;

// HH search has no vector-reranking step (MCP tool searches, LLM reranks directly) — hide that phase
export type MatchPhase = (typeof MATCH_PHASES)[number];
export const HH_MATCH_PHASES: MatchPhase[] = MATCH_PHASES.filter((p) => p.id !== "vector");

type PhaseStatus = "pending" | "active" | "done" | "skipped";

export function MatchTimeline({ steps, running, phases = MATCH_PHASES }: { steps: MatchStep[]; running: boolean; phases?: readonly MatchPhase[] }) {
  const { t } = useLocale();
  const phaseLabels: Record<string, string> = {
    search: t("matchingUi.phaseSearch"),
    vector: t("matchingUi.phaseVector"),
    llm: t("matchingUi.phaseLlm"),
    done: t("matchingUi.phaseDone"),
  };
  const stepNames = steps.map((s) => s.step);
  const lastStep = steps[steps.length - 1];
  const isDone = stepNames.includes("done");

  const getStatus = (phaseIdx: number): PhaseStatus => {
    const phase = phases[phaseIdx];
    const next = phases[phaseIdx + 1];
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
        {phases.map((phase, idx) => {
          const status = getStatus(idx);
          const isLast = idx === phases.length - 1;
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
                  {phaseLabels[phase.id] ?? phase.label}
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
