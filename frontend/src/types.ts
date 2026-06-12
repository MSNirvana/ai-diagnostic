export interface Evidence {
  text: string;
  source: string;
}
export interface DrillDown {
  data_points: Evidence[];
  comparisons: string[];
}
export type Signal = "red" | "yellow" | "green";
export interface ModuleResult {
  module: string;
  signal: Signal;
  conclusion: string;
  evidence: Evidence[];
  actions: string[];
  drilldown: DrillDown | null;
}
export interface DiagnoseResult {
  results: ModuleResult[];
  record_id: string | null;
  skill_version_ids: Record<string, string>;
}
export interface ModuleAnswer {
  module: string;
  facts: Record<string, string>;
  pains: string[];
  uploaded_files?: string[];
}

export interface DiagnosisSummary {
  id: string;
  created_at: string;
  module_count: number;
}

export interface DiagnosisDetail {
  id: string;
  created_at: string;
  answers: { answers: ModuleAnswer[] };
  results: ModuleResult[];
  profile: Record<string, string> | null;
}

export interface BusinessProfile {
  company_name: string;
  industry: string;
  main_business: string;
  business_model: string;
  scale: string;
  stage: string;
}
export interface GeneratedField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  accept_file: boolean;
}
export interface GeneratedModule {
  key: string;
  label: string;
  subtitle: string;
  fields: GeneratedField[];
  pains: string[];
  free_text_label: string;
}
export interface GeneratedQuestionnaire {
  modules: GeneratedModule[];
}
export interface ABQuestionnaire {
  option_a: GeneratedQuestionnaire;
  option_b: GeneratedQuestionnaire;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ProblemSummary {
  core_problem: string;
  context: string;
  suspected_cause: string;
  tried: string;
  company_name: string;
  industry: string;
  main_business: string;
  business_model: string;
  scale: string;
  stage: string;
}
export interface ChatResponse {
  message: string;
  done: boolean;
  summary: ProblemSummary | null;
}
