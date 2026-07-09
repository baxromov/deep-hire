"use client";

import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CandidateDetail } from "@/types/candidate";
import { candidateApi, API_BASE } from "@/lib/api";
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

const SOURCE_CONFIG: Record<string, { label: string; cls: string; icon: string }> = {
  xlsx:         { label: "Импорт Excel",    cls: "bg-green-50 text-green-700 border-green-200",   icon: "📊" },
  file:         { label: "Загрузка файла",  cls: "bg-purple-50 text-purple-700 border-purple-200", icon: "📎" },
  hh:           { label: "HeadHunter",      cls: "bg-blue-50 text-blue-700 border-blue-200",       icon: "🔗" },
  cleverstaff:  { label: "Cleverstaff",     cls: "bg-teal-50 text-teal-700 border-teal-200",       icon: "🤝" },
};


export default function CandidateDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();

  const { data: candidate, mutate } = useSWR<CandidateDetail>(
    `candidate-${id}`,
    () => candidateApi.get(id).then((r) => r.data)
  );
  const [explaining, setExplaining] = useState(false);
  const [showMethod, setShowMethod] = useState(false);

  const explainScore = async () => {
    setExplaining(true);
    try {
      const { data } = await candidateApi.explainScore(id);
      await mutate(
        (prev) => prev && {
          ...prev,
          relevance_score: data.score,
          llm_score: data.score,
          score_reasoning: data.reasoning,
          score_criteria: data.criteria,
        },
        { revalidate: false }
      );
      toast.success("Оценка обновлена");
    } catch {
      toast.error("Не удалось получить объяснение оценки");
    } finally {
      setExplaining(false);
    }
  };

  if (!candidate) {
    return (
      <div className="flex justify-center pt-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")
    || candidate.title
    || "Аноним";

  const salary = candidate.salary_amount
    ? `${new Intl.NumberFormat("ru-RU").format(candidate.salary_amount)} ${candidate.salary_currency || ""}`
    : null;

  type ExpEntry = {
    company: unknown;
    position: string;
    start?: string;
    end?: string | null;
    from_date?: string;
    to_date?: string;
    description?: string;
  };
  // CS stores work history as "work_experience"; HH uses "experience"
  const experience: ExpEntry[] =
    (candidate.raw_resume_json?.work_experience as ExpEntry[]) ||
    (candidate.raw_resume_json?.experience as ExpEntry[]) ||
    [];

  function companyName(c: unknown): string {
    if (c && typeof c === "object" && "name" in c) return (c as { name: string }).name || "";
    return String(c || "");
  }

  function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  type EduEntry = { from_date?: string | null; to_date?: string | null; university?: string; speciality?: string };
  const education = (candidate.raw_resume_json?.education as EduEntry[]) || [];

  type LangEntry = { name: string; level: string };
  const languages = (candidate.raw_resume_json?.languages as LangEntry[]) || [];

  type LinkEntry = { resource_type: string; url?: string; value?: string };
  const profileLinks = ((candidate.raw_resume_json?.links as LinkEntry[]) || []).filter((l) => l.url);

  const LANG_LEVEL: Record<string, string> = {
    Native: "Родной", Basic: "Базовый", Intermediate: "Средний",
    Upper: "Выше среднего", Advanced: "Продвинутый", Fluent: "Свободный",
  };
  const LINK_LABEL: Record<string, string> = {
    hh: "HH.uz профиль", linkedin: "LinkedIn", github: "GitHub",
    telegram: "Telegram", facebook: "Facebook",
  };

  const sourceCfg = candidate.source ? (SOURCE_CONFIG[candidate.source] ?? null) : null;

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="mb-6 text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        ← Назад
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
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-semibold text-gray-900">{name}</h1>
                  {sourceCfg && (
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${sourceCfg.cls}`}>
                      {sourceCfg.icon} {sourceCfg.label}
                    </span>
                  )}
                </div>
                {candidate.title && (
                  <p className="mt-0.5 text-sm text-gray-500">{candidate.title}</p>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400">
              {candidate.area && <span>{candidate.area}</span>}
              {candidate.age && <span>{candidate.age} лет</span>}
              {salary && <span className="text-gray-700 font-medium">{salary}</span>}
              {candidate.phone && (
                <a
                  href={`tel:${candidate.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-blue-500 hover:text-blue-700 font-medium"
                >
                  📞 {candidate.phone}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Application Info — all sources */}
      {(candidate.phone || candidate.comment || candidate.title) && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Информация о кандидате">
            <div className="space-y-3">
              {candidate.phone && (
                <div className="flex items-start gap-3">
                  <span className="text-base w-5 text-center">📞</span>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Телефон</p>
                    <a href={`tel:${candidate.phone}`} className="text-sm font-medium text-blue-600 hover:underline">
                      {candidate.phone}
                    </a>
                  </div>
                </div>
              )}
              {candidate.title && (
                <div className="flex items-start gap-3">
                  <span className="text-base w-5 text-center">💼</span>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">
                      {candidate.source === "xlsx" ? "Желаемая стажировка" : "Должность"}
                    </p>
                    <p className="text-sm font-medium text-gray-800">{candidate.title}</p>
                  </div>
                </div>
              )}
              {candidate.comment && (
                <div className="flex items-start gap-3">
                  <span className="text-base w-5 text-center">💬</span>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Комментарий</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{candidate.comment}</p>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>
      )}

      {/* Match score — same badge/criteria style as the vacancy results table */}
      {(candidate.llm_score != null || candidate.relevance_score != null || candidate.score_reasoning || (candidate.score_criteria && candidate.score_criteria.length > 0)) && (() => {
        const score = candidate.llm_score ?? candidate.relevance_score;
        return (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
            <Section title="Оценка по вакансии">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {score != null && (
                    <span
                      className={`rounded-md px-2.5 py-1 text-sm font-semibold ${
                        score >= 70
                          ? "bg-green-50 text-green-700"
                          : score >= 40
                          ? "bg-yellow-50 text-yellow-700"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      {score}%
                    </span>
                  )}
                  {candidate.vector_score != null && (
                    <span className="text-xs text-gray-400">Вектор: {candidate.vector_score}%</span>
                  )}
                </div>
                <button
                  onClick={explainScore}
                  disabled={explaining}
                  className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-400 hover:text-blue-700 transition-colors disabled:opacity-50"
                >
                  {explaining ? "Оценка…" : "Объяснить оценку"}
                </button>
              </div>
              {candidate.score_reasoning && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <span className="text-lg leading-none">💡</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Summary</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-amber-900">{candidate.score_reasoning}</p>
                  </div>
                </div>
              )}
              {candidate.score_criteria && candidate.score_criteria.length > 0 && (
                <div className="mt-4 space-y-2">
                  {candidate.score_criteria.map((c, i) => {
                    const val = c.score ?? c.value ?? 0;
                    const tone =
                      val >= 70
                        ? { card: "border-green-200 bg-green-50/70", badge: "bg-green-600 text-white", text: "text-green-900" }
                        : val >= 40
                        ? { card: "border-yellow-200 bg-yellow-50/70", badge: "bg-yellow-500 text-white", text: "text-yellow-900" }
                        : { card: "border-red-200 bg-red-50/70", badge: "bg-red-500 text-white", text: "text-red-900" };
                    return (
                      <div key={i} className={`rounded-lg border p-3 ${tone.card}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm font-medium ${tone.text}`}>
                            {c.name} <span className="text-xs font-normal opacity-60">· вес {c.weight}%</span>
                          </p>
                          <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${tone.badge}`}>{val}%</span>
                        </div>
                        {c.comment && (
                          <p className={`mt-1.5 text-xs leading-relaxed opacity-80 ${tone.text}`}>{c.comment}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {candidate.score_criteria && candidate.score_criteria.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowMethod((v) => !v)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <span className={`inline-block transition-transform ${showMethod ? "rotate-90" : ""}`}>▸</span>
                    ⓘ Как считается итоговый балл?
                  </button>
                  {showMethod && (
                    <div className="mt-1.5 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-500">
                      <p>
                        Итоговый балл — средневзвешенная сумма оценок по каждому критерию вакансии,
                        округлённая до целого числа:
                      </p>
                      <p className="mt-1.5 font-mono text-[11px] text-gray-600">
                        {candidate.score_criteria
                          .map((c) => `${c.weight}% × «${c.name}»`)
                          .join(" + ")}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Section>
          </div>
        );
      })()}

      {/* Skills */}
      {candidate.skills.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Навыки">
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
          <Section title="Опыт работы">
            <div className="space-y-4">
              {experience.map((exp, i) => (
                <div key={i} className="flex gap-4">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{exp.position}</p>
                    <p className="text-sm text-gray-500">{companyName(exp.company)}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {exp.start?.slice(0, 7) || exp.from_date || ""} — {exp.end != null ? exp.end.slice(0, 7) : (exp.to_date && exp.to_date !== "сейчас" ? exp.to_date : "по настоящее время")}
                    </p>
                    {exp.description && (
                      <p className="mt-1.5 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                        {stripHtml(String(exp.description))}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Education */}
      {education.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Образование">
            <div className="space-y-3">
              {education.map((edu, i) => (
                <div key={i} className="flex gap-4">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{edu.university}</p>
                    {edu.speciality && <p className="text-sm text-gray-500">{edu.speciality}</p>}
                    {(edu.from_date || edu.to_date) && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        {edu.from_date || ""}{edu.from_date && edu.to_date ? " — " : ""}{edu.to_date || ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Languages */}
      {languages.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Языки">
            <div className="flex flex-wrap gap-2">
              {languages.map((lang, i) => (
                <span key={i} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700">
                  <span className="capitalize">{lang.name}</span>
                  {lang.level && (
                    <span className="ml-1.5 text-xs text-gray-400">
                      — {LANG_LEVEL[lang.level] ?? lang.level}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Profile links */}
      {profileLinks.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Профили">
            <div className="flex flex-wrap gap-3">
              {profileLinks.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                >
                  {LINK_LABEL[link.resource_type] ?? link.resource_type} ↗
                </a>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Resume */}
      {candidate.resume_url && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/40 p-6">
          <Section title="Резюме">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">
                  {candidate.source === "cleverstaff"
                    ? "Резюме из Cleverstaff"
                    : candidate.resume_url.startsWith("/api/")
                    ? "Загруженное резюме"
                    : "Полное резюме на HH.uz"}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {candidate.source === "cleverstaff"
                    ? "Оригинальный файл резюме из базы Cleverstaff"
                    : candidate.resume_url.startsWith("/api/")
                    ? "Просмотреть оригинальный файл резюме"
                    : "Открывает публичный профиль кандидата на HeadHunter Узбекистан"}
                </p>
              </div>
              <a
                href={candidate.resume_url.startsWith("/api/") ? `${API_BASE}${candidate.resume_url}` : candidate.resume_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                {candidate.source === "cleverstaff"
                  ? "Открыть резюме ↗"
                  : candidate.resume_url.startsWith("/api/")
                  ? "Скачать резюме ↓"
                  : "Открыть на HH.uz →"}
              </a>
            </div>

            {/* Inline PDF preview — shown for PDFs from any source */}
            {candidate.resume_url.startsWith("/api/") && (() => {
              const mimetype = candidate.raw_resume_json?.cs_mimetype as string | undefined;
              const filename = candidate.raw_resume_json?.filename as string | undefined;
              const isPdf =
                mimetype === "application/pdf" ||
                (!mimetype && filename?.toLowerCase().endsWith(".pdf"));
              if (!isPdf) return null;
              return (
                <div className="mt-4 overflow-hidden rounded-lg border border-blue-200 bg-white">
                  <iframe
                    src={`${API_BASE}${candidate.resume_url}`}
                    title="Резюме"
                    className="w-full"
                    style={{ height: "780px" }}
                  />
                </div>
              );
            })()}
          </Section>
        </div>
      )}

      {/* Footer */}
      {candidate.vacancy_id && (
        <div className="mt-4">
          <Link
            href={`/vacancies/${candidate.vacancy_id}`}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            ← Вернуться к вакансии
          </Link>
        </div>
      )}
    </div>
  );
}
