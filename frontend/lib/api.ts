import axios from "axios";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const BASE = API_BASE;

export const api = axios.create({ baseURL: BASE });

// --- Auth ---
export const authApi = {
  loginUrl: () => api.get<{ auth_url: string }>("/api/auth/hh/login"),
  callback: (code: string) => api.get(`/api/auth/hh/callback?code=${code}`),
  logout: () => api.delete("/api/auth/hh/logout"),
  me: () => api.get("/api/auth/me"),
};

// --- Vacancies ---
export const vacancyApi = {
  list: (params?: { status?: string; skip?: number; limit?: number }) =>
    api.get<{ items: unknown[]; total: number }>("/api/vacancies/", { params }),
  create: () => api.post("/api/vacancies/"),
  get: (id: string) => api.get(`/api/vacancies/${id}`),
  update: (id: string, data: Record<string, unknown>) => api.put(`/api/vacancies/${id}`, data),
  archive: (id: string) => api.post(`/api/vacancies/${id}/archive`),
  approve: (id: string) => api.post(`/api/vacancies/${id}/approve`),
  duplicate: (id: string) => api.post(`/api/vacancies/${id}/duplicate`),
  toggleOpen: (id: string) => api.patch(`/api/vacancies/${id}/toggle-open`),
};

// --- AI ---
export const aiApi = {
  extractFromFile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/api/ai/extract-from-file", fd);
  },
  extractFromText: (text: string) =>
    api.post("/api/ai/extract-from-text", { text }),
};

// --- Matching ---
export const matchingApi = {
  rematch: (vacancyId: string) => api.post(`/api/matching/vacancies/${vacancyId}/rematch`),
  status: (vacancyId: string) => api.get(`/api/matching/vacancies/${vacancyId}/status`),
  matchFromFile: (vacancyId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ id: string; name: string; score: number; total: number; pool_matched: number }>(
      `/api/matching/vacancies/${vacancyId}/match-from-file`,
      fd
    );
  },
  matchFromPool: (vacancyId: string) =>
    api.post<{ matched: number; total: number }>(`/api/matching/vacancies/${vacancyId}/match-from-pool`),
  matchFromLivePool: (vacancyId: string) =>
    api.post<{ matched: number; total: number }>(`/api/matching/vacancies/${vacancyId}/match-from-live-pool`),
};

// --- Talent Pool ---
export const talentPoolApi = {
  status: () =>
    api.get<{
      points_count: number;
      indexed_vectors_count: number;
      status: string;
      running: boolean;
      last_ingested_at: string | null;
    }>("/api/talent-pool/status"),
  ingest: (pages?: number) =>
    api.post<{ fetched: number; upserted: number; area_id: string; pages: number }>(
      "/api/talent-pool/ingest",
      { pages: pages ?? 10 }
    ),
  ingestBackground: (pages?: number) =>
    api.post("/api/talent-pool/ingest/background", { pages: pages ?? 10 }),
};

// --- Areas & Suggests ---
export const areasApi = {
  list: () =>
    api.get<{ id: string; name: string }[]>("/api/areas/list"),
  suggest: (text: string) =>
    api.get<{ id: string; text: string }[]>("/api/areas/suggest", { params: { text } }),
  suggestSkills: (text: string) =>
    api.get<{ id: string; text: string }[]>("/api/areas/suggest-skills", { params: { text } }),
};

// --- Candidates ---
export const candidateApi = {
  list: (params?: { skip?: number; limit?: number; vacancy_id?: string; search?: string }) =>
    api.get<{ items: unknown[]; total: number }>("/api/candidates/", { params }),
  byVacancy: (vacancyId: string) =>
    api.get(`/api/candidates/vacancy/${vacancyId}`),
  get: (id: string) => api.get(`/api/candidates/${id}`),
};
