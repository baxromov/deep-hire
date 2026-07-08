export interface Candidate {
  id: string;
  vacancy_id: string | null;
  hh_resume_id: string;
  first_name: string | null;
  last_name: string | null;
  age: number | null;
  gender: string | null;
  area: string | null;
  title: string | null;
  salary_amount: number | null;
  salary_currency: string | null;
  skills: string[];
  photo_url: string | null;
  resume_url: string | null;
  relevance_score: number | null;
  vector_score: number | null;
  llm_score: number | null;
  is_vectorized: boolean;
  matched_at: string;
  // Source & contact (from raw_resume_json)
  source: string | null;       // "xlsx" | "file" | "hh" | null
  phone: string | null;
  comment: string | null;
  score_reasoning: string | null;
  score_criteria: ScoreCriterion[] | null;
}

export interface ScoreCriterion {
  name: string;
  weight: number;
  score: number;
  comment: string;
}

export interface CandidateDetail extends Candidate {
  raw_resume_json: Record<string, unknown>;
}

