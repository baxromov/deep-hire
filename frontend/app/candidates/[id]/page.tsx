"use client";

import { use, useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CandidateDetail, ScoreCriterion } from "@/types/candidate";
import { candidateApi, API_BASE } from "@/lib/api";
import useSWR from "swr";
import { toast } from "sonner";

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
  xlsx:  { label: "Импорт Excel",    cls: "bg-green-50 text-green-700 border-green-200",   icon: "📊" },
  file:  { label: "Загрузка файла",  cls: "bg-purple-50 text-purple-700 border-purple-200", icon: "📎" },
  hh:    { label: "HeadHunter",      cls: "bg-blue-50 text-blue-700 border-blue-200",       icon: "🔗" },
};


export default function CandidateDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [explaining, setExplaining] = useState(false);
  const [localReasoning, setLocalReasoning] = useState<string | null>(null);
  const [localCriteria, setLocalCriteria] = useState<ScoreCriterion[] | null>(null);
  const [localScore, setLocalScore] = useState<number | null>(null);

  const { data: candidate } = useSWR<CandidateDetail>(
    `candidate-${id}`,
    () => candidateApi.get(id).then((r) => r.data)
  );

  // Defined before early return so it can be referenced in useEffect below
  const handleExplain = async () => {
    if (!candidate) return;
    setExplaining(true);
    try {
      const res = await candidateApi.explainScore(id);
      setLocalReasoning(res.data.reasoning);
      setLocalCriteria(res.data.criteria ?? null);
      setLocalScore(res.data.score);
      const old = candidate.relevance_score ?? 0;
      const updated = res.data.score;
      const diff = updated - old;
      const sign = diff > 0 ? `+${diff}` : `${diff}`;
      toast.success(
        diff !== 0
          ? `Балл пересчитан: ${old}% → ${updated}% (${sign})`
          : `Балл подтверждён: ${updated}%`
      );
    } catch {
      toast.error("Не удалось сгенерировать объяснение");
    } finally {
      setExplaining(false);
    }
  };

  // Hooks MUST come before any conditional return — Rules of Hooks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!candidate) return;
    const score = localScore ?? candidate.relevance_score;
    const displayReasoning = localReasoning ?? candidate.score_reasoning;
    const displayCriteria = localCriteria ?? candidate.score_criteria;
    if (score != null && !displayReasoning && !displayCriteria && !explaining) {
      handleExplain();
    }
  }, [candidate?.id]);

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

  const score = localScore ?? candidate.relevance_score;
  const sourceCfg = candidate.source ? (SOURCE_CONFIG[candidate.source] ?? null) : null;
  const displayReasoning = localReasoning ?? candidate.score_reasoning;
  const displayCriteria = localCriteria ?? candidate.score_criteria;

  const matchedDate = new Date(candidate.matched_at).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

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
              {score != null && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {localScore !== null && localScore !== candidate.relevance_score && (
                    <span className="text-sm text-gray-300 line-through">{candidate.relevance_score}%</span>
                  )}
                  <span className={`rounded-lg px-3 py-1 text-sm font-semibold ${
                    score >= 70 ? "bg-green-50 text-green-700" :
                    score >= 40 ? "bg-yellow-50 text-yellow-700" :
                    "bg-red-50 text-red-600"
                  }`}>
                    {score}% совпадение
                  </span>
                </div>
              )}
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

      {/* Match Score */}
      {score != null && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <Section title="Оценка соответствия">
            <div className="space-y-4">

              {/* Total score bar */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-36 shrink-0">Итоговый балл</span>
                <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${score >= 70 ? "bg-green-500" : score >= 40 ? "bg-yellow-400" : "bg-red-400"}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
                <span className={`text-sm font-bold w-10 text-right ${score >= 70 ? "text-green-700" : score >= 40 ? "text-yellow-700" : "text-red-600"}`}>
                  {score}%
                </span>
              </div>

              {/* Criteria breakdown table */}
              {displayCriteria && displayCriteria.length > 0 && (() => {
                const contributions = displayCriteria.map(c => parseFloat((c.score * c.weight / 100).toFixed(2)));
                const rawSum = contributions.reduce((a, b) => a + b, 0);
                const formulaStr = contributions.map(v => v.toFixed(2)).join(" + ");
                const approxScore = Math.round(rawSum);
                return (
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Критерий</th>
                          <th
                            className="text-center px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide w-14 cursor-help"
                            title="Вес — фиксированный приоритет критерия, задан системой заранее. Чем выше вес, тем сильнее этот критерий влияет на итоговый балл."
                          >
                            Вес <span className="text-gray-300 normal-case">ⓘ</span>
                          </th>
                          <th
                            className="px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide w-44 cursor-help"
                            title="Балл — оценка ИИ от 0 до 100: насколько хорошо кандидат соответствует именно этому критерию."
                          >
                            Балл <span className="text-gray-300 normal-case">ⓘ</span>
                          </th>
                          <th
                            className="text-center px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide w-32 cursor-help"
                            title="Вклад = Балл × Вес. Показывает, сколько очков этот критерий добавляет в итоговую сумму."
                          >
                            Вклад <span className="text-gray-300 normal-case">ⓘ</span>
                          </th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Комментарий</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {displayCriteria.map((c, i) => {
                          const bar = c.score >= 70 ? "bg-green-400" : c.score >= 40 ? "bg-yellow-400" : "bg-red-400";
                          const txt = c.score >= 70 ? "text-green-700" : c.score >= 40 ? "text-yellow-700" : "text-red-600";
                          const contrib = contributions[i];
                          return (
                            <tr key={i} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{c.name}</td>
                              <td className="px-3 py-3 text-center text-xs text-gray-400">{c.weight}%</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${c.score}%` }} />
                                  </div>
                                  <span className={`text-xs font-semibold w-8 text-right ${txt}`}>{c.score}%</span>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className="text-xs text-gray-400 font-mono">
                                  {c.score} × {c.weight}% = <span className="font-semibold text-gray-600">{contrib.toFixed(2)}</span>
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500 leading-snug">{c.comment}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50/80 border-t-2 border-gray-200">
                          <td colSpan={3} className="px-4 py-2.5 text-xs text-gray-400 font-medium">
                            Итог = сумма вкладов
                          </td>
                          <td colSpan={2} className="px-3 py-2.5">
                            <span className="text-xs font-mono text-gray-500">
                              {formulaStr} = <span className="font-semibold text-gray-700">{rawSum.toFixed(2)}</span>
                              {" "}≈{" "}
                              <span className={`font-bold ${approxScore >= 70 ? "text-green-700" : approxScore >= 40 ? "text-yellow-700" : "text-red-600"}`}>
                                {approxScore}%
                              </span>
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="mt-2 px-1 space-y-1.5">
                      <p className="text-xs text-gray-400 leading-relaxed">
                        <span className="font-medium text-gray-500">Вес</span> — фиксированный приоритет критерия, задан системой (45% / 40% / 15%).{"  "}
                        <span className="font-medium text-gray-500">Балл</span> — оценка ИИ от 0 до 100, насколько кандидат соответствует критерию.{"  "}
                        <span className="font-medium text-gray-500">Вклад</span> = Балл × Вес.
                      </p>
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-blue-400 hover:text-blue-600 transition-colors select-none list-none flex items-center gap-1">
                          <span className="group-open:hidden">▶</span>
                          <span className="hidden group-open:inline">▼</span>
                          Почему именно такие коэффициенты?
                        </summary>
                        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-2">
                          <div className="flex items-start gap-2 text-xs text-gray-600">
                            <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 bg-indigo-100 text-indigo-700 font-bold">45%</span>
                            <div>
                              <span className="font-medium">Соответствие должности</span> — самый важный фактор.
                              Если кандидат претендует не на ту роль, то даже сильные навыки не помогут: человек просто не туда.
                              Этот критерий отвечает на вопрос «тот ли это специалист?»
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-xs text-gray-600">
                            <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 bg-violet-100 text-violet-700 font-bold">40%</span>
                            <div>
                              <span className="font-medium">Навыки и инструменты</span> — второй по важности.
                              Определяет, умеет ли кандидат реально выполнять работу.
                              Высокий вес потому, что навыки — это конкретное доказательство компетентности.
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-xs text-gray-600">
                            <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 font-bold">15%</span>
                            <div>
                              <span className="font-medium">Уровень опыта</span> — наименее весомый.
                              Опыт можно накопить в процессе работы, а нужные навыки — освоить.
                              Поэтому он учитывается, но не является решающим фактором.
                            </div>
                          </div>
                          <p className="pt-1 text-xs text-gray-400 border-t border-gray-200">
                            Итого: 45 + 40 + 15 = 100%. Коэффициенты подобраны так, чтобы роль и навыки
                            имели решающее значение, а опыт был дополнительным плюсом.
                          </p>
                        </div>
                      </details>

                      <details className="group">
                        <summary className="cursor-pointer text-xs text-blue-400 hover:text-blue-600 transition-colors select-none list-none flex items-center gap-1">
                          <span className="group-open:hidden">▶</span>
                          <span className="hidden group-open:inline">▼</span>
                          Как ИИ ставит баллы (0–100) по каждому критерию?
                        </summary>
                        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-3">

                          {/* Criterion 1 */}
                          <div>
                            <p className="text-xs font-semibold text-indigo-600 mb-1.5">Соответствие должности</p>
                            <p className="text-xs text-gray-500 mb-1.5">
                              ИИ сравнивает название желаемой должности кандидата с названием вакансии.
                            </p>
                            <div className="space-y-1">
                              {[
                                { range: "90–100", label: "Точное совпадение", color: "bg-green-100 text-green-700" },
                                { range: "70–89",  label: "Близкая роль / смежная специализация", color: "bg-lime-100 text-lime-700" },
                                { range: "40–69",  label: "Частичное совпадение", color: "bg-yellow-100 text-yellow-700" },
                                { range: "0–39",   label: "Роль не совпадает", color: "bg-red-100 text-red-700" },
                              ].map(({ range, label, color }) => (
                                <div key={range} className="flex items-center gap-2 text-xs">
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono font-semibold ${color}`}>{range}</span>
                                  <span className="text-gray-500">{label}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="border-t border-gray-200" />

                          {/* Criterion 2 */}
                          <div>
                            <p className="text-xs font-semibold text-violet-600 mb-1.5">Навыки и инструменты</p>
                            <p className="text-xs text-gray-500 mb-1.5">
                              ИИ считает, сколько навыков из требований вакансии есть у кандидата, и переводит в процент.
                            </p>
                            <div className="space-y-1">
                              {[
                                { range: "100",  label: "Все требуемые навыки присутствуют", color: "bg-green-100 text-green-700" },
                                { range: "~70",  label: "Большинство навыков есть", color: "bg-lime-100 text-lime-700" },
                                { range: "~50",  label: "Половина навыков присутствует", color: "bg-yellow-100 text-yellow-700" },
                                { range: "0–30", label: "Мало или ни одного нужного навыка", color: "bg-red-100 text-red-700" },
                              ].map(({ range, label, color }) => (
                                <div key={range} className="flex items-center gap-2 text-xs">
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono font-semibold ${color}`}>{range}</span>
                                  <span className="text-gray-500">{label}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="border-t border-gray-200" />

                          {/* Criterion 3 */}
                          <div>
                            <p className="text-xs font-semibold text-slate-600 mb-1.5">Уровень опыта</p>
                            <p className="text-xs text-gray-500 mb-1.5">
                              ИИ сопоставляет требуемый стаж вакансии с фактическим опытом кандидата.
                            </p>
                            <div className="space-y-1">
                              {[
                                { range: "100",  label: "Опыт точно соответствует требованию", color: "bg-green-100 text-green-700" },
                                { range: "70–90", label: "Небольшое несоответствие (чуть больше или меньше)", color: "bg-yellow-100 text-yellow-700" },
                                { range: "0–50", label: "Опыт существенно не совпадает", color: "bg-red-100 text-red-700" },
                              ].map(({ range, label, color }) => (
                                <div key={range} className="flex items-center gap-2 text-xs">
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono font-semibold ${color}`}>{range}</span>
                                  <span className="text-gray-500">{label}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                        </div>
                      </details>
                    </div>
                  </div>
                );
              })()}

              {/* Summary reasoning */}
              {displayReasoning && (
                <div className="bg-blue-50/50 border border-blue-100 rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1">Вывод</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{displayReasoning}</p>
                </div>
              )}

              {/* Auto-loading indicator — shown while explanation is being fetched */}
              {!displayReasoning && !displayCriteria && explaining && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-4 py-3 text-sm text-blue-500 w-full justify-center">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                  ИИ анализирует…
                </div>
              )}

              {/* Regenerate link — shown when data already exists */}
              {(displayReasoning || (displayCriteria && displayCriteria.length > 0)) && (
                <button
                  onClick={handleExplain}
                  disabled={explaining}
                  className="text-xs text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-50"
                >
                  {explaining ? "⏳ Обновляется…" : "↻ Пересчитать объяснение"}
                </button>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-400 pt-1 border-t border-gray-50">
                <span>Дата оценки: {matchedDate}</span>
                <Link
                  href={`/vacancies/${candidate.vacancy_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-blue-500 hover:text-blue-700"
                >
                  Открыть вакансию →
                </Link>
              </div>
            </div>
          </Section>
        </div>
      )}

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
                      {exp.start?.slice(0, 7)} — {exp.end?.slice(0, 7) || "по настоящее время"}
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
                  {candidate.resume_url.startsWith("/api/") ? "Загруженное резюме" : "Полное резюме на HH.uz"}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {candidate.resume_url.startsWith("/api/")
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
                {candidate.resume_url.startsWith("/api/") ? "Открыть резюме →" : "Открыть на HH.uz →"}
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
          ← Вернуться к вакансии
        </Link>
      </div>
    </div>
  );
}
