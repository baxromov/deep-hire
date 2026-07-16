"use client";

import { useLocale } from "@/lib/i18n/context";

export type Criterion = { name: string; weight: number };

export function CriteriaEditor({ criteria, onChange }: { criteria: Criterion[]; onChange: (next: Criterion[]) => void }) {
  const { t } = useLocale();

  function changeWeight(idx: number, newVal: number) {
    const clamped = Math.max(0, Math.min(100, isNaN(newVal) ? 0 : newVal));
    onChange(criteria.map((c, i) => i === idx ? { ...c, weight: clamped } : c));
  }

  function addCriterion() {
    onChange([...criteria, { name: "", weight: 0 }]);
  }

  function removeCriterion(idx: number) {
    if (criteria.length <= 2) return;
    onChange(criteria.filter((_, i) => i !== idx));
  }

  const weightSum = criteria.reduce((s, c) => s + c.weight, 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-700">{t("vacancyForm.criteriaTitle")}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {t("vacancyForm.criteriaHint")}
          </p>
        </div>
        <span className={`shrink-0 text-sm font-bold px-2.5 py-1 rounded-lg transition-colors ${
          weightSum === 100
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-600"
        }`}>
          {weightSum === 100 ? "✓" : "✗"} {weightSum}%
        </span>
      </div>

      {weightSum !== 100 && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
          {t("vacancyForm.weightSumPrefix")} <span className="font-bold">{weightSum}%</span> {t("vacancyForm.weightSumTarget")} <span className="font-bold">100%</span>.
          {weightSum > 100
            ? ` ${t("vacancyForm.weightDecrease", { amount: weightSum - 100 })}`
            : ` ${t("vacancyForm.weightIncrease", { amount: 100 - weightSum })}`}
        </div>
      )}

      <div className="space-y-3">
        {criteria.map((c, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={c.name}
                placeholder={t("vacancyForm.criterionPlaceholder", { number: idx + 1 })}
                onChange={(e) =>
                  onChange(criteria.map((item, i) => i === idx ? { ...item, name: e.target.value } : item))
                }
                className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <div className="relative shrink-0 w-16">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={c.weight}
                  onChange={(e) => changeWeight(idx, Number(e.target.value))}
                  className={`w-full rounded-md border px-1.5 py-1 text-xs font-bold text-center focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                    c.weight >= 40 ? "bg-indigo-50 border-indigo-200 text-indigo-700" :
                    c.weight >= 20 ? "bg-violet-50 border-violet-200 text-violet-700" :
                                     "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-50">%</span>
              </div>
              {criteria.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeCriterion(idx)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors text-sm"
                  title={t("vacancyForm.removeCriterionTitle")}
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={c.weight}
              onChange={(e) => changeWeight(idx, Number(e.target.value))}
              className="w-full h-1.5 rounded-full cursor-pointer accent-indigo-500"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addCriterion}
        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors"
      >
        <span className="text-base leading-none">+</span> {t("vacancyForm.addCriterionButton")}
      </button>
    </div>
  );
}
