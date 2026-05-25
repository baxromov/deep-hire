"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Vacancy, EXPERIENCE_OPTIONS } from "@/types/vacancy";

function fmt(from: number | null, to: number | null, currency: string) {
  const f = from ? new Intl.NumberFormat("ru-RU").format(from) : null;
  const t = to ? new Intl.NumberFormat("ru-RU").format(to) : null;
  if (!f && !t) return null;
  return [f, t].filter(Boolean).join(" – ") + " " + currency;
}

const expLabel = (v: string | null) =>
  EXPERIENCE_OPTIONS.find((o) => o.value === v)?.label ?? v;

export function VacancyCard({ vacancy }: { vacancy: Vacancy }) {
  const router = useRouter();

  return (
    <tr
      className="group cursor-pointer hover:bg-gray-50 transition-colors"
      onClick={() => router.push(`/vacancies/${vacancy.id}`)}
    >
      <td className="py-3 pl-4 pr-3">
        <span className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
          {vacancy.title || <span className="text-gray-400 italic">Без названия</span>}
        </span>
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={vacancy.status} />
      </td>
      <td className="px-3 py-3 text-sm text-gray-500">{vacancy.area || "—"}</td>
      <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">
        {fmt(vacancy.salary_from, vacancy.salary_to, vacancy.currency) || "—"}
      </td>
      <td className="px-3 py-3 text-sm text-gray-500">{expLabel(vacancy.experience) || "—"}</td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {(vacancy.skills ?? []).slice(0, 3).map((s) => (
            <span key={s} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
              {s}
            </span>
          ))}
          {(vacancy.skills?.length ?? 0) > 3 && (
            <span className="text-xs text-gray-400">+{(vacancy.skills?.length ?? 0) - 3}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 pr-4 text-sm text-gray-400 whitespace-nowrap">
        {new Date(vacancy.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
      </td>
    </tr>
  );
}
