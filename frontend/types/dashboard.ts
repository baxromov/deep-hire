export type TeamActivityEntry = {
  user_id: string;
  name: string;
  vacancies: number;
  matches: number;
};

export type DashboardStats = {
  scope: "admin" | "personal";
  vacancies: {
    total: number;
    by_status: Record<string, number>;
    hh_tracked: number;
  };
  candidates: {
    total: number;
    saved: number;
    staged: number;
    by_source: Record<string, number>;
  };
  matches: {
    total: number;
    by_source: Record<string, number>;
    staged_unconfirmed: number;
    today: number;
    trend: { date: string; count: number }[];
  };
  recent_activity: {
    vacancy_id: string;
    title: string | null;
    status: string;
    last_matched_at: string | null;
  }[];
  team_activity: TeamActivityEntry[] | null;
};

export type HhQuota = {
  resume_views: {
    limit: number;
    spent: number;
    left: number;
    used_percent: number;
    source: string;
    freshness: string;
  };
  resets: {
    at: string;
    in: string;
    timezone: string;
    note: string;
  };
  spent_today_by_tool: Record<string, number>;
  accounts: {
    account_id: string;
    label: string;
    status: string;
    cooldown_until: string | null;
    views_used_today: number;
    daily_view_cap: number;
    contacts_used_today: number;
    daily_contact_cap: number;
  }[];
  notes: string[];
};
