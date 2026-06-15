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
export interface DataRequest {
  key: string;
  label: string;
  reason: string;
  source_hint: string;
  required: boolean;
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
  data_requests: DataRequest[];
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
export type WarRoomUrgency = "now" | "soon" | "later";
export interface DecisionItem {
  title: string;
  detail: string;
  urgency: WarRoomUrgency;
}
export interface ActionMetric {
  name: string;
  current?: string | null;
  target: string;
  direction: "up" | "down" | "stable";
}
export interface DepartmentAction {
  id: string;
  department: string;
  department_label: string;
  battle_goal: string;
  priority: WarRoomUrgency;
  action_title: string;
  action_detail: string;
  owner_role: string;
  start_window: string;
  dependency?: string;
  acceptance_rule: string;
  required_data: DataRequest[];
  metrics: ActionMetric[];
  risk_note?: string;
  confidence?: number | null;
  confidence_reason?: string;
  evidence_refs?: string[];
}
export interface BattleChainStep {
  id: string;
  label: string;
  depends_on: string[];
  note?: string;
}
export interface ReviewCheckpoint {
  window: "7d" | "14d" | "30d";
  title: string;
  checks: string[];
}
export interface PriorityBoard {
  now: string[];
  soon: string[];
  later: string[];
}
export interface WarRoomIteration {
  record_id: string;
  created_at: string;
  summary: string;
  primary_battlefield: string;
  objective: string;
  confidence: number;
  changes: string[];
}
export interface WarRoomPlan {
  id: string;
  record_id: string | null;
  project_id?: string | null;
  source_record_ids?: string[];
  iteration_count?: number;
  iterations?: WarRoomIteration[];
  summary: string;
  primary_battlefield: string;
  secondary_battlefield?: string;
  objective: string;
  confidence: number;
  decision_items: DecisionItem[];
  battle_chain: BattleChainStep[];
  department_actions: DepartmentAction[];
  priority_board: PriorityBoard;
  evidence_summary: string[];
  risk_summary: string[];
  data_gaps: DataRequest[];
  checkpoints: ReviewCheckpoint[];
}
export interface DiagnoseResult {
  results: ModuleResult[];
  record_id: string | null;
  skill_version_ids: Record<string, string>;
  triage: TriageSummary;
  war_room_plan?: WarRoomPlan;
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
  war_room_plan?: WarRoomPlan | null;
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
  impact: string;
  context: string;
  suspected_cause: string;
  tried: string;
  data_readiness: string;
  diagnosis_focus: string;
  information_score: number;
  missing_fields: string[];
  next_question_reason: string;
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
  has_war_room_plan?: boolean;
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
  war_room_plan?: WarRoomPlan | null;
}

export interface SkillVersionOut {
  id: string;
  module: string;
  skill_type?: string;
  version: number;
  system_prompt: string;
  method: string;
  is_active: boolean;
  change_reason: string | null;
  change_category: string | null;
  reviewed_by: string | null;
}

export interface SkillDataRequirement {
  key: string;
  label: string;
  reason: string;
  source_hint: string;
  required: boolean;
}

export interface SkillRegistryItem {
  key: string;
  label: string;
  category: string;
  category_label: string;
  skill_type: string;
  method: string;
  description: string;
  fallback_prompt: string;
  trigger_keywords: string[];
  data_requirements: SkillDataRequirement[];
  upgrade_policy: string;
  evaluation_metrics: string[];
  enabled: boolean;
  default_core: boolean;
  active_version: SkillVersionOut | null;
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
