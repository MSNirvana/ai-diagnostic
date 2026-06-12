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

export interface ProblemMap {
  company_name: string;
  industry: string;
  main_business: string;
  business_model: string;
  scale: string;
  stage: string;
  core_problem: string;
  sub_problems: string[];
  goal: string;
  constraints: string;
  success_criteria: string;
  context: string;
  suspected_cause: string;
  tried: string;
  diagnosis_focus: string;
}

export interface ChatTurnResponse {
  message: string;
  done: boolean;
  phase: "intake" | "confirm" | "done";
  problem_map: ProblemMap | null;
  summary: ProblemSummary | null;
}

export interface SessionSummary {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  status: string;
}

export interface SessionDetail {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  status: string;
  messages: ChatMessage[];
  problem_map: ProblemMap | null;
  diagnosis_record_id: string | null;
}
