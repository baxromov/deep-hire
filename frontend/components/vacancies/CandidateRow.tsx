"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { candidateApi, API_BASE } from "@/lib/api";
import { Candidate } from "@/types/candidate";
import { useLocale } from "@/lib/i18n/context";

export function CandidateRow({ candidate, score, onSaved }: { candidate: Candidate; score: number | null; onSaved: () => void }) {
  const router = useRouter();
  const { t } = useLocale();
  const [saving, setSaving] = useState(false);
  const name =
    [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
    t("matchingUi.noName");
  const salary = candidate.salary_amount
    ? `${new Intl.NumberFormat("ru-RU").format(candidate.salary_amount)} ${candidate.salary_currency || ""}`
    : null;

  const saveToDb = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try {
      await candidateApi.save(candidate.id);
      toast.success(t("matchingUi.savedToDb"));
      onSaved();
    } catch {
      toast.error(t("matchingUi.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

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
      <td className="px-3 py-3 text-sm text-gray-500 max-w-[160px] truncate">{candidate.title || t("common.none")}</td>
      <td className="px-3 py-3 text-sm text-gray-500">{candidate.area || t("common.none")}</td>
      <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">{salary || t("common.none")}</td>
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
      <td className="px-3 py-3">
        {candidate.resume_url ? (
          <a
            href={candidate.resume_url.startsWith("/api/") ? `${API_BASE}${candidate.resume_url}` : candidate.resume_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-400 hover:text-blue-700 transition-colors"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            {t("matchingUi.cv")}
          </a>
        ) : (
          <span className="text-sm text-gray-300">{t("common.none")}</span>
        )}
      </td>
      <td className="px-3 py-3">
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
                {candidate.score_criteria.map((c, i) => {
                  const val = c.score ?? c.value ?? 0;
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-400 truncate max-w-[80px]">{c.name}:</span>
                      <span className={`text-[10px] font-semibold ${
                        val >= 70 ? "text-green-600" : val >= 40 ? "text-yellow-600" : "text-red-500"
                      }`}>{val}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-3 pr-4">
        {!candidate.is_saved ? (
          <button
            onClick={saveToDb}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            {saving ? "…" : t("matchingUi.saveToDb")}
          </button>
        ) : (
          <span className="text-sm text-gray-300">{t("common.none")}</span>
        )}
      </td>
    </tr>
  );
}
