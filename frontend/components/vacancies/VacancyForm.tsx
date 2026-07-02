"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { areasApi } from "@/lib/api";
import {
  CURRENCY_OPTIONS,
  EMPLOYMENT_OPTIONS,
  EXPERIENCE_OPTIONS,
  SCHEDULE_OPTIONS,
} from "@/types/vacancy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Props {
  defaultValues?: Record<string, any>;
  onSaveDraft: (data: Record<string, unknown>) => Promise<void>;
  onPublish: (data: Record<string, unknown>) => Promise<void>;
  loading?: boolean;
}

function hasOptionalValues(dv?: Record<string, any>) {
  return !!(dv?.area || dv?.salary_from || dv?.salary_to || dv?.employment_type || dv?.schedule);
}

export function VacancyForm({ defaultValues, onSaveDraft, onPublish, loading }: Props) {
  const [showOptional, setShowOptional] = useState(() => hasOptionalValues(defaultValues));

  // Area list state
  const [areaList, setAreaList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    areasApi.list().then((res) => {
      const list = res.data ?? [];
      setAreaList(list);
      // Auto-match extracted area text to a list item if area_hh_id is missing
      setForm((prev) => {
        if (prev.area && !prev.area_hh_id) {
          const q = prev.area.toLowerCase();
          const match = list.find(
            (a) => a.name.toLowerCase() === q || a.name.toLowerCase().includes(q)
          );
          if (match) return { ...prev, area: match.name, area_hh_id: match.id };
        }
        return prev;
      });
    }).catch(() => {});
  }, []);

  // Skills autocomplete state
  const [skillSuggestions, setSkillSuggestions] = useState<{ id: string; text: string }[]>([]);
  const [skillOpen, setSkillOpen] = useState(false);
  const skillDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (skillRef.current && !skillRef.current.contains(e.target as Node)) {
        setSkillOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // When defaultValues change (e.g. after AI extraction), sync form and auto-match area
  useEffect(() => {
    if (!defaultValues) return;
    setForm((prev) => {
      const newArea = defaultValues.area ?? prev.area;
      const newAreaId = defaultValues.area_hh_id ?? prev.area_hh_id;
      let resolvedId = newAreaId;
      let resolvedName = newArea;
      if (newArea && !newAreaId && areaList.length > 0) {
        const q = newArea.toLowerCase();
        const match = areaList.find(
          (a) => a.name.toLowerCase() === q || a.name.toLowerCase().includes(q)
        );
        if (match) { resolvedId = match.id; resolvedName = match.name; }
      }
      if (defaultValues.score_criteria?.length) {
        setCriteria(defaultValues.score_criteria);
      }
      return {
        ...prev,
        title: defaultValues.title ?? prev.title,
        area: resolvedName ?? "",
        area_hh_id: resolvedId ?? "",
        salary_from: defaultValues.salary_from ?? prev.salary_from,
        salary_to: defaultValues.salary_to ?? prev.salary_to,
        currency: defaultValues.currency ?? prev.currency,
        experience: defaultValues.experience ?? prev.experience,
        employment_type: defaultValues.employment_type ?? prev.employment_type,
        schedule: defaultValues.schedule ?? prev.schedule,
        description: defaultValues.description ?? prev.description,
        skills: defaultValues.skills ?? prev.skills,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues]);

  const selectArea = (id: string, name: string) => {
    set("area", name);
    set("area_hh_id", id);
  };

  const onSkillInput = (value: string) => {
    set("skillInput", value);
    if (skillDebounce.current) clearTimeout(skillDebounce.current);
    if (value.length < 2) { setSkillSuggestions([]); setSkillOpen(false); return; }
    skillDebounce.current = setTimeout(async () => {
      try {
        const res = await areasApi.suggestSkills(value);
        setSkillSuggestions(res.data ?? []);
        setSkillOpen(true);
      } catch {
        setSkillSuggestions([]);
      }
    }, 300);
  };

  const selectSkill = (item: { id: string; text: string }) => {
    const s = item.text.trim();
    if (s && !form.skills.includes(s)) {
      set("skills", [...form.skills, s]);
    }
    set("skillInput", "");
    setSkillOpen(false);
    setSkillSuggestions([]);
  };

  const DEFAULT_CRITERIA = [
    { name: "Соответствие должности", weight: 45 },
    { name: "Навыки и инструменты",   weight: 40 },
    { name: "Уровень опыта",          weight: 15 },
  ];

  const [criteria, setCriteria] = useState<{ name: string; weight: number }[]>(
    () => defaultValues?.score_criteria?.length ? defaultValues.score_criteria : DEFAULT_CRITERIA
  );

  function changeWeight(idx: number, newVal: number) {
    const clamped = Math.max(0, Math.min(100, isNaN(newVal) ? 0 : newVal));
    setCriteria(prev => prev.map((c, i) => i === idx ? { ...c, weight: clamped } : c));
  }

  function addCriterion() {
    setCriteria(prev => [...prev, { name: "", weight: 0 }]);
  }

  function removeCriterion(idx: number) {
    if (criteria.length <= 2) return;
    setCriteria(prev => prev.filter((_, i) => i !== idx));
  }

  const weightSum = criteria.reduce((s, c) => s + c.weight, 0);

  const [form, setForm] = useState({
    title: defaultValues?.title ?? "",
    area: defaultValues?.area ?? "",
    area_hh_id: defaultValues?.area_hh_id ?? "",
    salary_from: defaultValues?.salary_from ?? "",
    salary_to: defaultValues?.salary_to ?? "",
    currency: defaultValues?.currency ?? "UZS",
    experience: defaultValues?.experience ?? "",
    employment_type: defaultValues?.employment_type ?? "",
    schedule: defaultValues?.schedule ?? "",
    description: defaultValues?.description ?? "",
    skillInput: "",
    skills: defaultValues?.skills ?? [],
  });

  const set = (field: string, val: unknown) =>
    setForm((prev) => ({ ...prev, [field]: val }));

  const addSkill = () => {
    const s = form.skillInput.trim();
    if (s && !form.skills.includes(s)) {
      set("skills", [...form.skills, s]);
    }
    set("skillInput", "");
  };

  const removeSkill = (s: string) =>
    set("skills", form.skills.filter((x: string) => x !== s));

  const collect = () => ({
    title: form.title || null,
    area: form.area || null,
    area_hh_id: form.area_hh_id || null,
    salary_from: form.salary_from ? Number(form.salary_from) : null,
    salary_to: form.salary_to ? Number(form.salary_to) : null,
    currency: form.currency,
    experience: form.experience || null,
    employment_type: form.employment_type || null,
    schedule: form.schedule || null,
    description: form.description || null,
    skills: form.skills,
    score_criteria: criteria,
  });

  return (
    <div className="space-y-5">
      <div>
        <Label>Название должности</Label>
        <Input
          className="mt-1"
          placeholder="например, Старший QA-инженер"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </div>

      <div>
        <Label>Опыт</Label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={form.experience}
          onChange={(e) => set("experience", e.target.value)}
        >
          <option value="">— выбрать —</option>
          {EXPERIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Optional fields toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          <span className={`transition-transform ${showOptional ? "rotate-90" : ""}`}>›</span>
          {showOptional ? "Скрыть доп. поля" : "Добавить город, зарплату, занятость и график"}
        </button>
      </div>

      {showOptional && (
        <>
          <div>
            <Label>Город / Регион</Label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.area_hh_id}
              onChange={(e) => {
                const selected = areaList.find((a) => a.id === e.target.value);
                if (selected) selectArea(selected.id, selected.name);
                else { set("area", ""); set("area_hh_id", ""); }
              }}
            >
              <option value="">— выбрать город —</option>
              {areaList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Зарплата от</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="1 000 000"
                value={form.salary_from}
                onChange={(e) => set("salary_from", e.target.value)}
              />
            </div>
            <div>
              <Label>Зарплата до</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="2 000 000"
                value={form.salary_to}
                onChange={(e) => set("salary_to", e.target.value)}
              />
            </div>
            <div>
              <Label>Валюта</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
              >
                {CURRENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Тип занятости</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.employment_type}
                onChange={(e) => set("employment_type", e.target.value)}
              >
                <option value="">— выбрать —</option>
                {EMPLOYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>График работы</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.schedule}
                onChange={(e) => set("schedule", e.target.value)}
              >
                <option value="">— выбрать —</option>
                {SCHEDULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div>
        <Label>Навыки</Label>
        <div ref={skillRef} className="relative mt-1">
          <div className="flex gap-2">
            <Input
              placeholder="Добавить навык..."
              value={form.skillInput}
              onChange={(e) => onSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addSkill(); setSkillOpen(false); setSkillSuggestions([]); }
                if (e.key === "Escape") { setSkillOpen(false); }
              }}
              onFocus={() => skillSuggestions.length > 0 && setSkillOpen(true)}
              autoComplete="off"
            />
            <Button type="button" variant="outline" onClick={() => { addSkill(); setSkillOpen(false); setSkillSuggestions([]); }}>
              Добавить
            </Button>
          </div>
          {skillOpen && skillSuggestions.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-auto text-sm">
              {skillSuggestions.map((item) => (
                <li
                  key={item.id}
                  className="cursor-pointer px-3 py-2 hover:bg-blue-50"
                  onMouseDown={() => selectSkill(item)}
                >
                  {item.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {form.skills.map((s: string) => (
            <span
              key={s}
              className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700"
            >
              {s}
              <button
                type="button"
                onClick={() => removeSkill(s)}
                className="ml-1 text-blue-400 hover:text-blue-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div>
        <Label>Описание</Label>
        <Textarea
          className="mt-1"
          rows={6}
          placeholder="Опишите роль, обязанности и требования к кандидату..."
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      {/* ── Score criteria editor (temporarily disabled) ────────────────────
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Критерии оценки кандидатов</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Настройте вес каждого критерия. Сумма должна быть ровно 100%.
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
            ⚠ Сумма весов <span className="font-bold">{weightSum}%</span> — должно быть ровно <span className="font-bold">100%</span>.
            {weightSum > 100
              ? ` Уменьшите на ${weightSum - 100}%.`
              : ` Добавьте ещё ${100 - weightSum}%.`}
          </div>
        )}

        <div className="space-y-3">
          {criteria.map((c, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={c.name}
                  placeholder={`Критерий ${idx + 1}`}
                  onChange={(e) =>
                    setCriteria(prev => prev.map((item, i) => i === idx ? { ...item, name: e.target.value } : item))
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
                    title="Удалить критерий"
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
          <span className="text-base leading-none">+</span> Добавить критерий
        </button>
      </div>
      ── end criteria editor ── */}

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => onSaveDraft(collect())}
        >
          Сохранить черновик
        </Button>
        <Button
          type="button"
          disabled={loading}
          onClick={() => onPublish(collect())}
        >
          Опубликовать
        </Button>
      </div>
    </div>
  );
}
