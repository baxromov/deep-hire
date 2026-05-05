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
  { value: "noExperience", label: "No experience" },
  { value: "between1And3", label: "1–3 years" },
  { value: "between3And6", label: "3–6 years" },
  { value: "moreThan6", label: "6+ years" },
];

export const EMPLOYMENT_OPTIONS = [
  { value: "full", label: "Full-time" },
  { value: "part", label: "Part-time" },
  { value: "project", label: "Project" },
  { value: "volunteer", label: "Volunteer" },
  { value: "probation", label: "Probation" },
];

export const SCHEDULE_OPTIONS = [
  { value: "fullDay", label: "Full day" },
  { value: "shift", label: "Shift" },
  { value: "flexible", label: "Flexible" },
  { value: "remote", label: "Remote" },
  { value: "flyInFlyOut", label: "Fly-in fly-out" },
];

export const CURRENCY_OPTIONS = [
  { value: "UZS", label: "UZS" },
  { value: "USD", label: "$ USD" },
  { value: "RUB", label: "₽ RUB" },
  { value: "EUR", label: "€ EUR" },
];
