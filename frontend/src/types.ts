export interface Evidence {
  text: string;
  source: string;
}
export interface DrillDown {
  data_points: Evidence[];
  comparisons: string[];
}
export interface BenchmarkReference {
  name: string;
  source: string;
  value: string;
}
export interface AuditTrail {
  skill_version_id: string;
  input_modules: string[];
  checks: string[];
}
export interface EvidencePackage {
  confidence: number;
  confidence_reason: string;
  citations: Evidence[];
  benchmarks: BenchmarkReference[];
  audit_trail: AuditTrail;
}
export type Signal = "red" | "yellow" | "green";
export interface ModuleResult {
  module: string;
  signal: Signal;
  conclusion: string;
  evidence: Evidence[];
  actions: string[];
  drilldown: DrillDown | null;
  evidence_package?: EvidencePackage | null;
}
export interface ExpertRoute {
  module: string;
  label: string;
  reason: string;
  priority: number;
}
export interface TriageConflict {
  modules: string[];
  description: string;
}
export interface TriageSummary {
  primary_module: string | null;
  selected_experts: ExpertRoute[];
  conflicts: TriageConflict[];
  dependencies: string[];
  priority_actions: string[];
}
export interface DiagnoseResult {
  results: ModuleResult[];
  record_id: string | null;
  skill_version_ids: Record<string, string>;
  triage: TriageSummary;
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
  draft_json: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: string;
  memory_summary: string;
}

export interface ProjectSessionBrief {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}

export interface ProjectRecordBrief {
  id: string;
  created_at: string;
  module_count: number;
}

export interface ProjectMemoryEntry {
  id: string;
  created_at: string;
  entry_type: "problem_map" | "diagnosis" | "feedback" | string;
  summary: string;
  payload: Record<string, unknown>;
  source_id: string | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: string;
  memory_summary: string;
  memory_entries: ProjectMemoryEntry[];
  sessions: ProjectSessionBrief[];
  records: ProjectRecordBrief[];
}

export interface SkillVersionOut {
  id: string;
  module: string;
  version: number;
  system_prompt: string;
  method: string;
  is_active: boolean;
  change_reason: string | null;
  change_category: string | null;
  reviewed_by: string | null;
}

export interface LLMConfigOut {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_key_masked: string;
  base_url: string;
  priority: number;
  is_active: boolean;
}

export interface UploadedFileOut {
  id: string;
  module_key: string;
  field_key: string;
  original_name: string;
}
