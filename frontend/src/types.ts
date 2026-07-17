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
  typical_owner?: string;
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
  problem?: string;
  internal_evidence?: string[];
  external_evidence?: string[];
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
  accumulation_note?: string;
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

// V2 AI 改造方案（按域：每个诊断问题一个改造）
export interface BeforeAfterRow {
  dimension: string;
  before: string;
  after: string;
}
export interface TransformStage {
  window: string;
  result: string;
  how: string;
  ai_does?: string;
  you_do?: string;
  ai_capabilities?: string[];
}
export interface DomainTransformation {
  module: string;
  label?: string;
  problem?: string;
  redesign_headline?: string;
  before_after: BeforeAfterRow[];
  stages: TransformStage[];
  investment?: string;
  prereq_risk?: string;
  generated?: boolean;
}
export interface TransformationPlan {
  id: string;
  project_id?: string | null;
  record_id?: string | null;
  created_at?: string | null;
  items: Record<string, DomainTransformation>;
}
export type WarRoomFeedbackAdoptionStatus = "pending" | "adopted" | "deferred" | "rejected";
export type WarRoomFeedbackResult = "none" | "effective" | "no_change" | "new_issue" | "insufficient_data";
export type WarRoomFeedbackCardType = "decision" | "action" | "review";
export interface WarRoomFeedbackEvent {
  id: string;
  project_id: string;
  user_id?: string | null;
  created_at: string;
  war_room_plan_id: string;
  record_id?: string | null;
  card_type: WarRoomFeedbackCardType | string;
  card_id: string;
  card_title: string;
  adoption_status: WarRoomFeedbackAdoptionStatus | string;
  feedback_result: WarRoomFeedbackResult | string;
  note: string;
  owner: string;
  attachments: string[];
}
export interface WarRoomFeedbackAttachment {
  id: string;
  name: string;
}
export interface WarRoomFeedbackCreate {
  war_room_plan_id: string;
  record_id?: string | null;
  card_type: WarRoomFeedbackCardType;
  card_id: string;
  card_title: string;
  adoption_status: WarRoomFeedbackAdoptionStatus;
  feedback_result: WarRoomFeedbackResult;
  note?: string;
  owner?: string;
  attachments?: string[];
}
export interface DataSupplementFile {
  id: string;
  original_name: string;
  summary_text?: string;
  is_deleted?: boolean;
  content_type?: string;
  media_type?: string;
  preview_text?: string;
  preview_blocks?: Array<ArchivePreviewBlock | string>;
}
export interface DataSupplementSubmission {
  id: string;
  created_at: string;
  submitter_name: string;
  note: string;
  files: DataSupplementFile[];
}
export interface DataSupplementRequest {
  id: string;
  token: string;
  project_id: string;
  created_at: string;
  updated_at: string;
  war_room_plan_id: string;
  data_key: string;
  label: string;
  reason: string;
  source_hint: string;
  typical_owner: string;
  status: string;
  public_url: string;
  submissions: DataSupplementSubmission[];
}
export interface DiagnoseResult {
  results: ModuleResult[];
  record_id: string | null;
  skill_version_ids: Record<string, string>;
  triage: TriageSummary;
  war_room_plan?: WarRoomPlan;
  review_status?: string;   // pending_review | approved | rejected | anonymous
}

export interface DiagnosisJobCreated {
  job_id: string;
  status: string;
}

export interface DiagnosisJobStatus {
  id: string;
  status: string;
  current_step: string;
  progress: number;
  record_id: string | null;
  project_id: string | null;
  error: string | null;
  result_summary: Record<string, unknown> | null;
}

export interface ResearchEvidenceOut {
  id: string;
  job_id?: string;
  project_id?: string | null;
  record_id?: string | null;
  module: string;
  source_stage: string;
  provider: string;
  query: string;
  title: string;
  url: string;
  snippet: string;
  source_type: string;
  credibility: number;
  retrieved_at: string;
}
export interface ModuleAnswer {
  module: string;
  facts: Record<string, string>;
  pains: string[];
  uploaded_files?: string[];
  context?: Record<string, unknown>;
}

export interface DiagnosisSummary {
  id: string;
  created_at: string;
  module_count: number;
  review_status?: string;
  project_id?: string | null;
  project_name?: string;
  stage?: string;
  primary_module?: string;
  primary_module_label?: string;
}

export interface DiagnosisDetail {
  id: string;
  created_at: string;
  answers: { answers: ModuleAnswer[]; problem_map?: ProblemMap | null };
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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: { id: string; name: string }[];
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

export interface FreeChatResponse {
  message: string;
  brainstorm_session_id?: string | null;
}

export interface BrainstormSessionSummary {
  id: string;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  is_pinned?: boolean;
  use_project_context?: boolean;
}

export interface BrainstormSessionDetail extends BrainstormSessionSummary {
  messages: ChatMessage[];
}

export interface IdeaCard {
  id?: string;
  project_id?: string | null;
  created_at?: string;
  updated_at?: string;
  status?: string;
  title: string;
  one_liner: string;
  source_context: string;
  target_customer: string;
  pain_point: string;
  value_proposition: string;
  core_assumption: string;
  contrary_risk: string;
  validation_action: string;
  next_step: string;
  confidence: string;
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
  is_pinned?: boolean;
  memory_enabled?: boolean;
}

export interface SessionDetail {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  status: string;
  is_pinned?: boolean;
  memory_enabled?: boolean;
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
  is_pinned?: boolean;
  memory_enabled?: boolean;
}

export interface ProjectBrainstormBrief {
  id: string;
  title: string;
  updated_at: string;
  is_pinned?: boolean;
  use_project_context?: boolean;
}

export interface ProjectRecordBrief {
  id: string;
  created_at: string;
  module_count: number;
  has_war_room_plan?: boolean;
  review_status?: "pending_review" | "approved" | "rejected" | string;
  session_id?: string | null;
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
  display?: {
    type?: "text" | "metric" | "list" | "table" | "trend" | "funnel" | "link_list";
    unit?: string;
    series?: unknown[];
  } | null;
  source_labels?: string[];
}

export interface ModuleFacts {
  module: string;
  label: string;
  facts: ProfileField[];
  has_data: boolean;
}

export interface ArchiveModuleOption {
  module: string;
  label: string;
  reason?: string;
}

export type ArchivePreviewBlock =
  | { type?: "title" | "heading" | "paragraph"; text: string; level?: number }
  | { type: "table"; rows: string[][] };

export interface ArchiveFile {
  id: string;
  name: string;
  module: string;
  field: string;
  uploaded_at: string;
  content_type?: string;
  media_type?: string;
  extraction_status?: "none" | "pending_confirm" | "confirmed" | string;
  extracted_highlights?: ProfileField[];
  preview_text?: string;
  preview_blocks?: Array<ArchivePreviewBlock | string>;
}

export interface ArchiveExtractionPreview {
  file_id: string;
  module: string;
  field: string;
  file_name: string;
  highlights: ProfileField[];
  summary: string;
  status: "pending_confirm" | "confirmed" | string;
}

export interface ProjectArchive {
  profile: ProfileField[];
  modules: ModuleFacts[];
  recommended_modules?: ArchiveModuleOption[];
  hidden_modules?: ArchiveModuleOption[];
  files: ArchiveFile[];
  last_updated: string | null;
}

export interface ProjectDeliveryStatus {
  state: "empty" | "pending_review" | "approved" | "rejected" | string;
  approved_count: number;
  pending_review_count: number;
  rejected_count: number;
  latest_review_status: string | null;
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
  brainstorm_sessions?: ProjectBrainstormBrief[];
  records: ProjectRecordBrief[];
  archive: ProjectArchive;
  war_room_plan?: WarRoomPlan | null;
  delivery_status?: ProjectDeliveryStatus;
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
  flow: string;
  fallback_prompt: string;
  industry_kpis: string[];
  judgment_hints: string[];
  card_json: string;
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
  runtime_status: string;
  cooldown_remaining_seconds: number;
  last_error: string;
  last_error_type: string;
  failure_count: number;
  success_count: number;
}

export interface UploadedFileOut {
  id: string;
  module_key: string;
  field_key: string;
  original_name: string;
  parsed_summary?: string;
  summary_text?: string;
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

// ── 当前用户 / 权限 ───────────────────────────────────────────────────────────

export interface MeResponse {
  id: string;
  email: string;
  is_admin: boolean;
}

// ── 平台计费（积分余额 / 任务账本）──────────────────────────────────────────────
// GGOO 余额接口尚未最终确认，available=false 时前端应隐藏展示，不出假数字。

export interface CreditsBalance {
  available: boolean;
  points: number | null;
}

// ── 图片工具类型 ──────────────────────────────────────────────────────────────

export interface ImageAssetOut {
  id: string;
  original_name: string;
  content_type: string;
  vision_description: string;
  vision_status: string;
  created_at: string;
}

export interface ImageTaskStatus {
  id: string;
  status: "quoted" | "reserved" | "running" | "succeeded" | "failed" | "cancelled" | "refunded";
  progress: number;
  quote_points: number | null;
  actual_points: number | null;
  error: string | null;
  result_image_url: string | null;
  created_at: string;
  updated_at: string;
  // Canvas-relevant payload fields (optional; populated after job runs).
  preset_id?: string | null;
  user_intent?: string | null;
  reference_asset_id?: string | null;
  reverse_prompt?: string | null;
  assembled_prompt?: string | null;
  generation_mode?: "text2image" | "image2image" | null;
}

export interface CreateImageTaskResponse {
  task_id: string;
  status: string;
  quote_points: number | null;
}

// ── 画布节点类型 ──────────────────────────────────────────────────────────────

export type CanvasNodeKind =
  | "requirement"
  | "asset"
  | "reversePrompt"
  | "prompt"
  | "model"
  | "generate"
  | "result"
  | "export";

export interface CanvasNodeData {
  kind: CanvasNodeKind;
  label: string;
  // Optional payload fields used by individual node renderers.
  presetName?: string;
  userIntent?: string;
  assetName?: string;
  assetThumbUrl?: string;
  reversePrompt?: string;
  assembledPrompt?: string;
  modelName?: string;
  generationMode?: "text2image" | "image2image";
  taskStatus?: string;
  resultImageUrl?: string;
  // Index signature required by @xyflow/react v12 Node<T> constraint.
  [key: string]: unknown;
}

// ── 案例库类型 ────────────────────────────────────────────────────────────────

export interface ProjectLedgerItem {
  id: string;
  name: string;
  user_email: string;
  industry: string;
  main_business: string;
  core_problem: string;
  product?: string;
  primary_module: string;
  latest_signal: "red" | "yellow" | "green" | "";
  diagnosis_count: number;
  delivery_state: string;
  review_status: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectLedgerPage {
  total: number;
  items: ProjectLedgerItem[];
  industries: string[];
}

export interface CaseProductModuleGroup {
  module: string;
  count: number;
  projects: ProjectLedgerItem[];
}

export interface CaseProductGroup {
  product: string;
  count: number;
  modules: CaseProductModuleGroup[];
}

export interface CaseProductGroups {
  total: number;
  groups: CaseProductGroup[];
  industries: string[];
}

export interface CaseModuleSignal {
  module: string;
  signal: string;
  conclusion: string;
  confidence: number | null;
}

export interface CaseRecordDetail {
  id: string;
  created_at: string;
  review_status: string;
  primary_module: string;
  signals: CaseModuleSignal[];
  consultant_notes: string[];
}

export interface CaseFeedback {
  count: number;
  avg_rating: number | null;
  useful_rate: number | null;
}

export interface CaseProjectDetail {
  id: string;
  name: string;
  user_email: string;
  status: string;
  created_at: string;
  updated_at: string;
  industry: string;
  main_business: string;
  core_problem: string;
  goal: string;
  company_name: string;
  records: CaseRecordDetail[];
  war_room_summary: string;
  war_room_objective: string;
  evidence_count: number;
  feedback: CaseFeedback;
}

export interface CaseDistItem {
  label: string;
  count: number;
}

export interface CaseModuleConfidence {
  module: string;
  avg_confidence: number;
  sample: number;
}

export interface CaseInsights {
  total_cases: number;
  industry_dist: CaseDistItem[];
  scenario_dist: CaseDistItem[];
  module_dist: CaseDistItem[];
  signal_dist: CaseDistItem[];
  avg_confidence_per_module: CaseModuleConfidence[];
  data_gaps_top: CaseDistItem[];
}

export interface CaseProjectFilters {
  industry?: string;
  primary_module?: string;
  signal?: string;
  delivery_state?: string;
  status?: string;
  q?: string;
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
  evidence_pack?: ResearchEvidenceOut[];
}
