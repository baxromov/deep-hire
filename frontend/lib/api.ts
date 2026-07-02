import axios from "axios";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const BASE = API_BASE;

export const api = axios.create({ baseURL: BASE });

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dh_token");
    if (token) {
      config.headers = config.headers ?? {};
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      if (!path.startsWith("/auth")) {
        window.location.href = "/auth/login";
      }
    }
    return Promise.reject(err);
  }
);

// --- Auth ---
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ access_token: string; token_type: string; user: { id: string; username: string; email: string; role: "admin" | "staff"; full_name: string; is_active: boolean } }>(
      "/api/auth/login",
      { username, password }
    ),
  me: (token?: string) =>
    api.get<{ id: string; username: string; email: string; role: "admin" | "staff"; full_name: string; is_active: boolean }>(
      "/api/auth/me",
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    ),
  logout: () => {
    localStorage.removeItem("dh_token");
    return Promise.resolve();
  },
  changePassword: (current_password: string, new_password: string) =>
    api.post("/api/auth/change-password", { current_password, new_password }),
  // Admin: user management
  listUsers: () => api.get("/api/auth/users"),
  createUser: (data: { username: string; email?: string; password: string; role: string; full_name?: string }) =>
    api.post("/api/auth/users", data),
  updateUser: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/auth/users/${id}`, data),
  deleteUser: (id: string) =>
    api.delete(`/api/auth/users/${id}`),
};

// --- HH Integrations ---
export const integrationApi = {
  listHH: () => api.get("/api/integrations/hh"),
  getHHConnectUrl: () => api.get<{ auth_url: string }>("/api/integrations/hh/connect-url"),
  disconnectHH: (tokenId: string) => api.delete(`/api/integrations/hh/${tokenId}`),
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
  matchFromDbStreamUrl: (vacancyId: string, minScore = 60) =>
    `${API_BASE}/api/matching/vacancies/${vacancyId}/match-from-db-stream?min_score=${minScore}`,
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
  list: (params?: { skip?: number; limit?: number; vacancy_id?: string; search?: string; sort_by?: string; source?: string }) =>
    api.get<{ items: unknown[]; total: number }>("/api/candidates/", { params }),
  byVacancy: (vacancyId: string) =>
    api.get(`/api/candidates/vacancy/${vacancyId}`),
  get: (id: string) => api.get(`/api/candidates/${id}`),
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    return api.post<{ status: string; total: number }>(
      "/api/candidates/upload",
      fd
    );
  },
  uploadStatus: () =>
    api.get<{
      status: string;
      total: number;
      processed: number;
      results: Array<{ id: string; name: string; score: number; vacancy_title: string; vacancy_id: string }>;
      errors: number;
      error: string | null;
    }>("/api/candidates/upload-status"),
  importXlsx: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ imported: number; skipped: number; total: number }>(
      "/api/candidates/import-xlsx",
      fd
    );
  },
  explainScore: (id: string) =>
    api.post<{ reasoning: string; score: number; criteria: import("@/types/candidate").ScoreCriterion[] }>(
      `/api/candidates/${id}/explain-score`
    ),
  rescoreAll: (resume = false) =>
    api.post<{ status: string }>(`/api/candidates/rescore-all?resume=${resume}`),
  rescoreStatus: () =>
    api.get<{ status: string; total: number; processed: number; updated: number; error: string | null; can_resume: boolean }>(
      "/api/candidates/rescore-status"
    ),
  vectorizeAll: () =>
    api.post<{ status: string }>("/api/candidates/vectorize-all"),
  vectorizeStatus: () =>
    api.get<{ status: string; total: number; processed: number; vectorized: number; error: string | null }>(
      "/api/candidates/vectorize-status"
    ),
  cleverstaffSync: () =>
    api.post<{ status: string }>("/api/sync/cleverstaff"),
  delete: (id: string) =>
    api.delete<{ ok: boolean }>(`/api/candidates/${id}`),
  deleteMany: (ids: string[]) =>
    api.delete<{ deleted: number }>("/api/candidates/bulk", { data: { ids } }),
};
