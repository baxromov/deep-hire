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
  });

  return (
    <div className="space-y-5">
      <div>
        <Label>Job Title</Label>
        <Input
          className="mt-1"
          placeholder="e.g. Senior QA Engineer"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </div>

      <div>
        <Label>Experience</Label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={form.experience}
          onChange={(e) => set("experience", e.target.value)}
        >
          <option value="">— select —</option>
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
          {showOptional ? "Hide optional fields" : "Add city, salary, employment & schedule"}
        </button>
      </div>

      {showOptional && (
        <>
          <div>
            <Label>City / Region</Label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.area_hh_id}
              onChange={(e) => {
                const selected = areaList.find((a) => a.id === e.target.value);
                if (selected) selectArea(selected.id, selected.name);
                else { set("area", ""); set("area_hh_id", ""); }
              }}
            >
              <option value="">— select city —</option>
              {areaList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Salary from</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="1 000 000"
                value={form.salary_from}
                onChange={(e) => set("salary_from", e.target.value)}
              />
            </div>
            <div>
              <Label>Salary to</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="2 000 000"
                value={form.salary_to}
                onChange={(e) => set("salary_to", e.target.value)}
              />
            </div>
            <div>
              <Label>Currency</Label>
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
              <Label>Employment</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.employment_type}
                onChange={(e) => set("employment_type", e.target.value)}
              >
                <option value="">— select —</option>
                {EMPLOYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Schedule</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.schedule}
                onChange={(e) => set("schedule", e.target.value)}
              >
                <option value="">— select —</option>
                {SCHEDULE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div>
        <Label>Skills</Label>
        <div ref={skillRef} className="relative mt-1">
          <div className="flex gap-2">
            <Input
              placeholder="Add skill..."
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
              Add
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
        <Label>Description</Label>
        <Textarea
          className="mt-1"
          rows={6}
          placeholder="Describe the role, responsibilities and requirements..."
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => onSaveDraft(collect())}
        >
          Save Draft
        </Button>
        <Button
          type="button"
          disabled={loading}
          onClick={() => onPublish(collect())}
        >
          Approve & Publish
        </Button>
      </div>
    </div>
  );
}
