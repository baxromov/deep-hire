export interface VacancyHhCounters {
  responses: number;
  views: number;
  invitations: number;
  unread_responses: number;
  resumes_in_progress: number;
  invitations_and_responses?: number;
}

export interface VacancyHhListItem {
  vacancy_id: string;
  name: string;
  region: string | null;
  created_at: string;
  url: string;
  counters: VacancyHhCounters;
}

export interface VacancyHhList {
  total: number;
  vacancies: VacancyHhListItem[];
}

export interface VacancyHhDetail {
  vacancy_id: string;
  name: string;
  status: string;
  region: string | null;
  address: string | null;
  department: string | null;
  created_at: string;
  published_at: string;
  experience: string | null;
  employment: string | null;
  schedule: string | null;
  work_format: string[] | null;
  salary: { from: number | null; to: number | null; currency: string | null } | null;
  key_skills: string[];
  professional_roles: string[];
  languages: { name: string; level: string }[];
  description: string;
  has_test: boolean;
  response_letter_required: boolean;
  counters: VacancyHhCounters;
  url: string;
  internal_vacancy_id: string;
}
