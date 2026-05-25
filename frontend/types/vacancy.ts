export type VacancyStatus = "draft" | "approved" | "closed" | "archived";

export interface Vacancy {
  id: string;
  title: string | null;
  skills: string[] | null;
  area: string | null;
  area_hh_id: string | null;
  salary_from: number | null;
  salary_to: number | null;
  currency: string;
  experience: string | null;
  employment_type: string | null;
  schedule: string | null;
  description: string | null;
  status: VacancyStatus;
  is_open: boolean;
  is_approvable: boolean;
  last_matched_at: string | null;
  created_at: string;
  updated_at: string;
  score_criteria: { name: string; weight: number }[];
}

export interface AIFields {
  title?: string | null;
  skills?: string[] | null;
  area?: string | null;
  salary_from?: number | null;
  salary_to?: number | null;
  currency?: string | null;
  experience?: string | null;
  employment_type?: string | null;
  schedule?: string | null;
  description?: string | null;
}

export const EXPERIENCE_OPTIONS = [
  { value: "noExperience", label: "Без опыта" },
  { value: "between1And3", label: "1–3 года" },
  { value: "between3And6", label: "3–6 лет" },
  { value: "moreThan6", label: "6+ лет" },
];

export const EMPLOYMENT_OPTIONS = [
  { value: "full", label: "Полная занятость" },
  { value: "part", label: "Частичная занятость" },
  { value: "project", label: "Проектная работа" },
  { value: "volunteer", label: "Волонтёрство" },
  { value: "probation", label: "Стажировка" },
];

export const SCHEDULE_OPTIONS = [
  { value: "fullDay", label: "Полный день" },
  { value: "shift", label: "Сменный" },
  { value: "flexible", label: "Гибкий" },
  { value: "remote", label: "Удалённо" },
  { value: "flyInFlyOut", label: "Вахтовый метод" },
];

export const CURRENCY_OPTIONS = [
  { value: "UZS", label: "UZS" },
  { value: "USD", label: "$ USD" },
  { value: "RUB", label: "₽ RUB" },
  { value: "EUR", label: "€ EUR" },
];
