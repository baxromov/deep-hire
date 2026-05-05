"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Candidate } from "@/types/candidate";

function RelevanceBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color =
    score >= 70 ? "bg-green-50 text-green-700" :
    score >= 40 ? "bg-yellow-50 text-yellow-700" :
    "bg-red-50 text-red-600";
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}%
    </span>
  );
}

export function CandidateCard({ candidate }: { candidate: Candidate }) {
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
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
            {candidate.photo_url ? (
              <Image src={candidate.photo_url} alt={name} width={32} height={32} className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-400">
                {name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
            {name}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 text-sm text-gray-500 max-w-[180px] truncate">
        {candidate.title || "—"}
      </td>
      <td className="px-3 py-3 text-sm text-gray-500">{candidate.area || "—"}</td>
      <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">{salary || "—"}</td>
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
    </tr>
  );
}
