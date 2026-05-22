"use client";

import { use } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CandidateDetail } from "@/types/candidate";
import { candidateApi } from "@/lib/api";
import useSWR from "swr";

type Props = { params: Promise<{ id: string }> };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</p>
      {children}
    </div>
  );
}

export default function CandidateDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();

  const { data: candidate } = useSWR<CandidateDetail>(
    `candidate-${id}`,
    () => candidateApi.get(id).then((r) => r.data)
  );

  if (!candidate) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")
    || candidate.title
    || "Anonymous";

  const salary = candidate.salary_amount
    ? `${new Intl.NumberFormat("ru-RU").format(candidate.salary_amount)} ${candidate.salary_currency || ""}`
    : null;

  type ExpEntry = {
    company: unknown;
    position: string;
    start: string;
    end: string | null;
    description?: string;
  };
  const experience: ExpEntry[] =
    (candidate.raw_resume_json?.experience as ExpEntry[]) || [];

  function companyName(c: unknown): string {
    if (c && typeof c === "object" && "name" in c) return (c as { name: string }).name || "";
    return String(c || "");
  }

  const score = candidate.relevance_score;

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="mb-6 text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        ← Back
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gray-100">
            {candidate.photo_url ? (
              <Image src={candidate.photo_url} alt={name} width={56} height={56} className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-gray-400">
                {name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{name}</h1>
                {candidate.title && (
                  <p className="mt-0.5 text-sm text-gray-500">{candidate.title}</p>
                )}
              </div>
              {score != null && (
                <span className={`shrink-0 rounded-lg px-3 py-1 text-sm font-semibold ${
                  score >= 70 ? "bg-green-50 text-green-700" :
                  score >= 40 ? "bg-yellow-50 text-yellow-700" :
                  "bg-red-50 text-red-600"
                }`}>
                  {score}% match
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400">
              {candidate.area && <span>{candidate.area}</span>}
              {candidate.age && <span>{candidate.age} y.o.</span>}
              {salary && <span className="text-gray-700 font-medium">{salary}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Skills */}
      {candidate.skills.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Skills">
            <div className="flex flex-wrap gap-2">
              {candidate.skills.map((s) => (
                <span key={s} className="rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-700">
                  {s}
                </span>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Experience */}
      {experience.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Experience">
            <div className="space-y-4">
              {experience.map((exp, i) => (
                <div key={i} className="flex gap-4">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{exp.position}</p>
                    <p className="text-sm text-gray-500">{companyName(exp.company)}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {exp.start?.slice(0, 7)} — {exp.end?.slice(0, 7) || "present"}
                    </p>
                    {exp.description && (
                      <p className="mt-1.5 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                        {exp.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Resume */}
      {candidate.resume_url && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/40 p-6">
          <Section title="Resume">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">
                  {candidate.resume_url.startsWith("/api/") ? "Uploaded Resume" : "Full resume on HH.uz"}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {candidate.resume_url.startsWith("/api/")
                    ? "View the original uploaded resume file"
                    : "Opens the candidate's public profile on HeadHunter Uzbekistan"}
                </p>
              </div>
              <a
                href={candidate.resume_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                {candidate.resume_url.startsWith("/api/") ? "View Resume →" : "View on HH.uz →"}
              </a>
            </div>
          </Section>
        </div>
      )}

      {/* Footer */}
      <div className="mt-4">
        <Link
          href={`/vacancies/${candidate.vacancy_id}`}
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          ← Back to vacancy
        </Link>
      </div>
    </div>
  );
}
