"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Candidate } from "@/types/candidate";

function RelevanceBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-sm text-gray-300">—</span>;
  const color =
    score >= 70 ? "bg-green-50 text-green-700" :
    score >= 40 ? "bg-yellow-50 text-yellow-700" :
    "bg-red-50 text-red-600";
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${color}`}>
      {score}%
    </span>
  );
}

const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
  xlsx:  { label: "Excel",    cls: "bg-green-50 text-green-700" },
  file:  { label: "Загрузка", cls: "bg-purple-50 text-purple-700" },
  hh:    { label: "HH",       cls: "bg-indigo-50 text-indigo-600" },
};

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const cfg = SOURCE_LABELS[source] ?? { label: source, cls: "bg-gray-100 text-gray-500" };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export function CandidateCard({
  candidate,
  selected = false,
  onToggle,
}: {
  candidate: Candidate;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const router = useRouter();

  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")
    || candidate.title
    || "Аноним";

  const salary = candidate.salary_amount
    ? `${new Intl.NumberFormat("ru-RU").format(candidate.salary_amount)} ${candidate.salary_currency || ""}`
    : null;

  return (
    <tr
      className={`group cursor-pointer hover:bg-gray-50 transition-colors ${selected ? "bg-indigo-50 hover:bg-indigo-50" : ""}`}
      onClick={() => router.push(`/candidates/${candidate.id}`)}
    >
      {/* Checkbox */}
      <td className="py-3 pl-4 pr-2 w-8" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle?.(candidate.id)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
        />
      </td>

      {/* Name + source badge + phone */}
      <td className="py-3 pl-1 pr-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
            {candidate.photo_url ? (
              <Image src={candidate.photo_url} alt={name} width={32} height={32} className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-400">
                {name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                {name}
              </span>
              <SourceBadge source={candidate.source} />
            </div>
            {candidate.phone && (
              <p className="mt-0.5 text-xs text-gray-400">{candidate.phone}</p>
            )}
          </div>
        </div>
      </td>

      {/* Position */}
      <td className="px-3 py-3 text-sm text-gray-500 max-w-[180px] truncate">
        {candidate.title || "—"}
      </td>

      {/* Area */}
      <td className="px-3 py-3 text-sm text-gray-500">{candidate.area || "—"}</td>

      {/* Salary */}
      <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">{salary || "—"}</td>

      {/* Skills */}
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {candidate.skills.slice(0, 3).map((s) => (
            <span key={s} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
              {s}
            </span>
          ))}
          {candidate.skills.length > 3 && (
            <span className="text-xs text-gray-400">+{candidate.skills.length - 3}</span>
          )}
        </div>
      </td>

      {/* Score */}
      <td className="px-3 py-3">
        <RelevanceBadge score={candidate.relevance_score} />
      </td>

      {/* Resume */}
      <td className="px-3 py-3 pr-4">
        {candidate.resume_url ? (
          <a
            href={candidate.resume_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            CV
          </a>
        ) : (
          <span className="text-sm text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}
