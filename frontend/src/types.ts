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
  review_status?: string;   // pending_review | approved | rejected | anonymous
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
  review_status?: string;
}

export interface DiagnosisDetail {
  id: string;
  created_at: string;
  answers: { answers: ModuleAnswer[] };
  results: ModuleResult[];
  war_room_plan?: WarRoomPlan | null;
  profile: Record<string, string> | null;
  review_status?: string;
  consultant_notes?: string[];
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
  prefilled_value?: string | null;
  known_source?: string | null;
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

export interface ProfileField {
  label: string;
  value: string;
}

export interface ModuleFacts {
  module: string;
  label: string;
  facts: ProfileField[];
  has_data: boolean;
}

export interface ArchiveFile {
  name: string;
  module: string;
  field: string;
  uploaded_at: string;
}

export interface ProjectArchive {
  profile: ProfileField[];
  modules: ModuleFacts[];
  files: ArchiveFile[];
  last_updated: string | null;
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
  archive: ProjectArchive;
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

// ── Loop 治理类型 ─────────────────────────────────────────────────────────────

export interface SkillCandidateItem {
  key: string;
  label: string | null;
  verdict: "pass" | "redo" | "fail" | "unknown";
  l1_passed: boolean;
  l2_rate: number;
  signal_accuracy: number;
  error_count: number;
  review_status: "pending_human" | "approved" | "rejected" | "not_ready" | "no_eval";
  review_notes: string | null;
}

export interface L1Stats {
  total_configs: number;
  pending_review: number;
  approved: number;
  failed: number;
  candidates: SkillCandidateItem[];
}

export interface SkillRecallItem {
  module: string;
  recall_count: number;
  source_breakdown: Record<string, number>;
}

export interface L2Stats {
  total_samples: number;
  missed_recall_rate: number;
  samples_with_missed: number;
  keyword_false_positive_rate: number;
  keyword_recalls: number;
  keyword_false_positives: number;
  skill_recall_frequency: SkillRecallItem[];
  recent_missed: string[];
}

export interface CaseIndustryItem {
  industry: string;
  count: number;
}

export interface RecentCaseItem {
  id: string;
  industry: string;
  company_profile: string;
  skills_used: string[];
  created_at: string;
}

export interface L3Stats {
  total_cases: number;
  industry_distribution: CaseIndustryItem[];
  recent_cases: RecentCaseItem[];
}

export interface L4Stats {
  total_diagnoses: number;
  recent_feedback_count: number;
  avg_rating: number | null;
  useful_rate: number | null;
}

// ── 顾问审核队列类型 ──────────────────────────────────────────────────────────

export interface ReviewQueueItem {
  record_id: string;
  user_id: string;
  primary_module: string;
  created_at: string;
  sla_deadline: string;
  hours_remaining: number;
  overdue: boolean;
  assigned_to: string | null;
}

export interface ReviewDetail {
  record_id: string;
  review_status: string;
  primary_module: string;
  results: ModuleResult[];
  war_room_plan: WarRoomPlan | null;
  consultant_notes: string[];
  created_at: string;
}

