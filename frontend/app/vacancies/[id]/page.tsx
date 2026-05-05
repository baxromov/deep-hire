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
};

function stepIcon(step: string, passed?: number) {
  if (step === "done") return "✓";
  if (step === "error") return "✕";
  if (step === "early_stop") return "✓";
  if (step === "no_results" || step === "switch_search") return "↺";
  if (step === "new_search") return "→";
  if (step === "queries_ready") return "✦";
  if (step === "filtered") return passed ? "✓" : "○";
  return "·";
}

function stepColors(step: string, passed?: number): string {
  if (step === "done" || step === "early_stop") return "text-green-700 bg-green-50 border-green-200";
  if (step === "error") return "text-red-600 bg-red-50 border-red-200";
  if (step === "no_results" || step === "switch_search") return "text-orange-600 bg-orange-50 border-orange-200";
  if (step === "new_search") return "text-purple-700 bg-purple-50 border-purple-200";
  if (step === "planning" || step === "embedding") return "text-indigo-600 bg-indigo-50 border-indigo-200";
  if (step === "queries_ready" || step === "fetched") return "text-indigo-700 bg-indigo-50 border-indigo-200";
  if (step === "filtered") return passed ? "text-green-700 bg-green-50 border-green-200" : "text-orange-600 bg-orange-50 border-orange-200";
  if (step === "scoring" || step === "fetching" || step === "searching") return "text-blue-700 bg-blue-50 border-blue-200";
  return "text-gray-600 bg-gray-50 border-gray-200";
}

function MatchProgress({
  steps,
  running,
  onClear,
  label: progressLabel = "Smart Rematch Progress",
}: {
  steps: MatchStep[];
  running: boolean;
  onClear: () => void;
  label?: string;
}) {
  if (steps.length === 0 && !running) return null;
  const last = steps[steps.length - 1];
  const isDone = last?.step === "done" || last?.step === "error" || last?.step === "no_results";
  return (
    <div className="mt-4 rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {running && !isDone && (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        )}
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          {progressLabel}
        </span>
        {!running && steps.length > 0 && (
          <button
            onClick={onClear}
            className="ml-auto text-xs text-gray-300 hover:text-gray-500 transition-colors"
            title="Clear progress"
          >
            ✕ clear
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {steps.map((s, i) => {
          const isLatest = i === steps.length - 1;
          return (
            <div
              key={i}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-all ${stepColors(s.step, s.passed)} ${isLatest && running && !isDone ? "ring-1 ring-blue-300" : ""}`}
            >
              <span className="mt-px w-3 shrink-0 text-center font-bold leading-none">
                {isLatest && running && !isDone ? (
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-blue-400" />
                ) : (
                  stepIcon(s.step, s.passed)
                )}
              </span>
              <span className="leading-snug">{s.message}</span>
            </div>
          );
        })}
        {running && !isDone && steps.length === 0 && (
          <div className="flex items-center gap-2 px-1 text-sm text-gray-400">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-blue-400" />
            Connecting...
          </div>
        )}
      </div>
    </div>
  );
}

type Props = { params: Promise<{ id: string }> };

const label = (val: string | null, opts: { value: string; label: string }[]) =>
  opts.find((o) => o.value === val)?.label ?? val;

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")
    || candidate.title
    || "Anonymous";
  const salary = candidate.salary_amount
    ? `${new Intl.NumberFormat("ru-RU").format(candidate.salary_amount)} ${candidate.salary_currency || ""}`
    : null;

  return (
    <tr
      className="group cursor-pointer hover:bg-gray-50 transition-colors"
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
          <span className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{name}</span>
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
        {candidate.relevance_score != null && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
            candidate.relevance_score >= 70 ? "bg-green-50 text-green-700" :
            candidate.relevance_score >= 40 ? "bg-yellow-50 text-yellow-700" :
            "bg-red-50 text-red-600"
          }`}>
            {candidate.relevance_score}%
          </span>
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

export default function VacancyDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [rematching, setRematching] = useState(false);
  const [matchSteps, setMatchSteps] = useState<MatchStep[]>([]);
  const [poolMatching, setPoolMatching] = useState(false);
  const [poolSteps, setPoolSteps] = useState<MatchStep[]>([]);
  const [fileMatching, setFileMatching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore persisted progress on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PROGRESS_KEY(id));
      if (saved) setMatchSteps(JSON.parse(saved));
    } catch {}
  }, [id]);

  // Persist steps whenever they change
  useEffect(() => {
    if (matchSteps.length === 0) return;
    try {
      localStorage.setItem(PROGRESS_KEY(id), JSON.stringify(matchSteps));
    } catch {}
  }, [id, matchSteps]);

  const clearProgress = () => {
    setMatchSteps([]);
    try { localStorage.removeItem(PROGRESS_KEY(id)); } catch {}
  };

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
    vacancy?.status === "approved" || vacancy?.status === "closed" || vacancy?.status === "archived" ? `candidates-${id}` : null,
    () => candidateApi.byVacancy(id).then((r) => r.data)
  );
  // Sort candidates by relevance_score descending
  const candidates = [...rawCandidates].sort(
    (a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  );

  if (!vacancy) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const duplicate = async () => {
    try {
      const res = await vacancyApi.duplicate(id);
      toast.success("Vacancy duplicated");
      router.push(`/vacancies/${res.data.id}/edit`);
    } catch {
      toast.error("Failed to duplicate");
    }
  };

  const toggle = async () => {
    try {
      const res = await vacancyApi.toggleOpen(id);
      mutateVacancy(res.data);
      toast.success(res.data.is_open ? "Vacancy reopened" : "Vacancy closed");
    } catch {
      toast.error("Failed to update status");
    }
  };

  const approve = async () => {
    try {
      const res = await vacancyApi.approve(id);
      mutateVacancy(res.data);
      toast.success("Vacancy approved!");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Approval failed";
      toast.error(msg);
    }
  };

  const archive = async () => {
    try {
      await vacancyApi.archive(id);
      toast.success("Vacancy archived");
      router.push("/vacancies");
    } catch {
      toast.error("Failed to archive");
    }
  };

  const rematch = () => {
    setRematching(true);
    setMatchSteps([]);
    try { localStorage.removeItem(PROGRESS_KEY(id)); } catch {};

    const source = new EventSource(
      `${API_BASE}/api/matching/vacancies/${id}/rematch-stream`,
      { withCredentials: true }
    );

    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setMatchSteps((prev) => [...prev, event]);

      if (event.step === "done") {
        source.close();
        setRematching(false);
        mutateCandidates();
        if ((event.matched ?? 0) > 0) {
          toast.success(`Found ${event.matched} candidates`);
        } else {
          toast.info("No qualifying candidates found.");
        }
      }
      if (event.step === "error") {
        source.close();
        setRematching(false);
        toast.error(event.message);
      }
    };

    source.onerror = () => {
      source.close();
      setRematching(false);
      setMatchSteps((prev) => [
        ...prev,
        { step: "error", message: "Connection lost. Please try again." },
      ]);
    };
  };

  const matchFromPool = () => {
    setPoolMatching(true);
    setPoolSteps([]);

    const source = new EventSource(
      `${API_BASE}/api/matching/vacancies/${id}/match-from-pool-stream`,
      { withCredentials: true }
    );

    source.onmessage = (e) => {
      const event: MatchStep = JSON.parse(e.data);
      setPoolSteps((prev) => [...prev, event]);

      if (event.step === "done") {
        source.close();
        setPoolMatching(false);
        mutateCandidates();
        mutatePool();
        if ((event.matched ?? 0) > 0) {
          toast.success(`Found ${event.matched} candidates from talent pool`);
        } else {
          toast.info("No qualifying candidates found in talent pool.");
        }
      }
      if (event.step === "error") {
        source.close();
        setPoolMatching(false);
        toast.error(event.message);
      }
    };

    source.onerror = () => {
      source.close();
      setPoolMatching(false);
      setPoolSteps((prev) => [
        ...prev,
        { step: "error", message: "Connection lost. Please try again." },
      ]);
    };
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setFileMatching(true);
    try {
      const res = await matchingApi.matchFromFile(id, file);
      toast.success(`${res.data.name} — score: ${res.data.score}%`);
      mutateCandidates();
    } catch {
      toast.error("Failed to match from file");
    } finally {
      setFileMatching(false);
    }
  };

  const salary = [
    vacancy.salary_from ? new Intl.NumberFormat("ru-RU").format(vacancy.salary_from) : null,
    vacancy.salary_to ? new Intl.NumberFormat("ru-RU").format(vacancy.salary_to) : null,
  ].filter(Boolean).join(" – ");

  return (
    <div>
      <button
        onClick={() => router.push("/vacancies")}
        className="mb-6 text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        ← Back
      </button>

      {/* Main card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {/* Title + status */}
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">{vacancy.title || "Untitled"}</h1>
          <StatusBadge status={vacancy.status} />
        </div>

        {/* Meta grid */}
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <InfoItem label="Area" value={vacancy.area} />
          <InfoItem
            label="Salary"
            value={salary ? `${salary} ${vacancy.currency}` : null}
          />
          <InfoItem label="Experience" value={label(vacancy.experience, EXPERIENCE_OPTIONS)} />
          <InfoItem label="Employment" value={label(vacancy.employment_type, EMPLOYMENT_OPTIONS)} />
          <InfoItem label="Schedule" value={label(vacancy.schedule, SCHEDULE_OPTIONS)} />
        </div>

        {/* Skills */}
        {(vacancy.skills?.length ?? 0) > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {(vacancy.skills ?? []).map((s) => (
              <span key={s} className="rounded-md bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                {s}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {vacancy.description && (
          <p className="mt-5 border-t border-gray-100 pt-4 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">
            {vacancy.description}
          </p>
        )}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          <Button variant="outline" size="sm" onClick={() => router.push(`/vacancies/${id}/edit`)}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={duplicate}>
            Duplicate
          </Button>
          {vacancy.status === "draft" && vacancy.is_approvable && (
            <Button size="sm" onClick={approve}>Approve & Publish</Button>
          )}
          {(vacancy.status === "approved" || vacancy.status === "closed") && (
            <Button variant="outline" size="sm" onClick={toggle}>
              {vacancy.is_open ? "Close" : "Reopen"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {vacancy.status !== "archived" && (
              <Button
                variant="outline"
                size="sm"
                onClick={archive}
                className="text-red-400 hover:text-red-600 hover:border-red-200"
              >
                Archive
              </Button>
            )}
            {vacancy.status === "approved" && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fileMatching}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {fileMatching ? "Analyzing..." : "Match from File"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={matchFromPool}
                  disabled={poolMatching || rematching}
                  title={poolStatus?.points_count ? `Search ${poolStatus.points_count.toLocaleString()} indexed candidates` : "Talent pool is empty — run ingestion first"}
                >
                  {poolMatching ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Searching Pool...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs">⚡</span>
                      Talent Pool
                      {(poolStatus?.points_count ?? 0) > 0 && (
                        <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                          {poolStatus!.points_count.toLocaleString()}
                        </span>
                      )}
                    </span>
                  )}
                </Button>
                <Button size="sm" onClick={rematch} disabled={rematching || poolMatching}>
                  {rematching ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Running...
                    </span>
                  ) : "Smart Rematch"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Rematch progress */}
      <MatchProgress steps={matchSteps} running={rematching} onClear={clearProgress} />

      {/* Pool match progress */}
      <MatchProgress
        steps={poolSteps}
        running={poolMatching}
        onClear={() => setPoolSteps([])}
        label="Talent Pool Search Progress"
      />

      {/* Candidates */}
      {candidates.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
            Matched Candidates ({candidates.length})
          </p>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Name</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Position</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Area</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Salary</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Skills</th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => <CandidateRow key={c.id} candidate={c} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vacancy.status === "approved" && candidates.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No candidates yet.</p>
          <p className="mt-1 text-xs text-gray-300">
            Use <span className="font-medium">Smart Rematch</span> to search HH.uz live, or{" "}
            <span className="font-medium">Talent Pool</span> to search indexed Uzbek candidates.
          </p>
        </div>
      )}
    </div>
  );
}
