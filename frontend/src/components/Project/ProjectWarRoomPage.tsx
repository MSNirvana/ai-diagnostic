import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createDataSupplementRequest,
  deleteDataSupplementFile,
  downloadSessionFile,
  getSessionFileBlob,
  getProject,
  getProjectWarRoom,
  listDataSupplementRequests,
  listWarRoomFeedback,
  rediagnoseProjectDomain,
  getTransformationPlan,
  generateTransformationDomain,
  submitWarRoomFeedback,
  uploadSessionFile,
  viewSessionFile,
} from "../../api/client";
import type {
  ArchivePreviewBlock,
  DataRequest,
  DepartmentAction,
  DataSupplementFile,
  DataSupplementRequest,
  ProjectBrainstormBrief,
  ProjectDetail,
  ProjectSessionBrief,
  UploadedFileOut,
  WarRoomFeedbackCreate,
  WarRoomFeedbackEvent,
  WarRoomUrgency,
  WarRoomPlan,
  DomainTransformation,
} from "../../types";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { TransformationDetail } from "./TransformationDetail";
import { WarRoomIterations } from "../WarRoom/WarRoomPage";
import { cleanDisplayText, cleanSentenceText, ensureChineseSentence, extractSourceTitleLink, splitTextWithLinks } from "../../utils/displayText";
import { formatPercent, priorityClass } from "../WarRoom/warRoomViewModel";
import "./ProjectDetailPage.css";

type WarRoomSection = "overview" | "iterations";
type WarRoomBlockedState = "pending_review" | "rejected" | null;
type RecommendationSource = "action" | "decision";
type WarRoomProjectSnapshot = Pick<ProjectDetail, "id" | "name" | "status"> & {
  sessions?: ProjectSessionBrief[];
  brainstorm_sessions?: ProjectBrainstormBrief[];
  delivery_status?: ProjectDetail["delivery_status"];
  records?: ProjectDetail["records"];
};

interface ConsultingRecommendation {
  id: string;
  source: RecommendationSource;
  priority: WarRoomUrgency;
  index: number;
  title: string;
  essence: string;
  problem: string;
  conclusion: string;
  externalData: string[];
  internalData: string[];
  dataGaps: DataRequest[];
  action?: DepartmentAction;
  decisionDetail?: string;
  confidence?: number | null;
}

interface SectionConfig {
  key: WarRoomSection;
  title: string;
  description: string;
  navLabel: string;
  order: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "overview",
    title: "项目作战室",
    description: "查看项目状态、资料状态和关键咨询建议。",
    navLabel: "总览",
    order: "01",
  },
  {
    key: "iterations",
    title: "诊断迭代",
    description: "记录每次诊断、动作、反馈和时间变化。",
    navLabel: "迭代历史",
    order: "02",
  },
];

const SECTION_MAP = new Map(SECTIONS.map((section) => [section.key, section]));

function isWarRoomSection(value: string | undefined): value is WarRoomSection {
  if (value === "review" || value === "decisions" || value === "actions" || value === "data" || value === "evidence" || value === "recommendations") return false;
  return Boolean(value && SECTION_MAP.has(value as WarRoomSection));
}

function sectionPath(projectId: string, section: WarRoomSection) {
  if (section === "overview") return `/projects/${projectId}/war-room`;
  return `/projects/${projectId}/war-room/view/${section}`;
}

function navBadge(plan: WarRoomPlan, key: WarRoomSection): string {
  if (key === "overview") return "当前";
  return String(plan.iterations?.length ?? 0);
}

function leadingAction(plan: WarRoomPlan) {
  return plan.department_actions.find((action) => action.priority === "now") ?? plan.department_actions[0];
}

function priorityRank(priority: WarRoomUrgency): number {
  if (priority === "now") return 0;
  if (priority === "soon") return 1;
  return 2;
}

function consultingPriorityLabel(priority: WarRoomUrgency): string {
  if (priority === "now") return "高优先级";
  if (priority === "soon") return "中优先级";
  return "低优先级";
}

const CONSULTING_PRIORITY_GROUPS: Array<{ key: WarRoomUrgency; label: string; shortLabel: string; hint: string }> = [
  { key: "now", label: "高优先级建议", shortLabel: "立即处理", hint: "先开会拍板，避免继续拖累经营结果。" },
  { key: "soon", label: "中优先级建议", shortLabel: "近期推进", hint: "排进本轮行动计划，明确负责人和时间点。" },
  { key: "later", label: "低优先级建议", shortLabel: "后续观察", hint: "先保留跟踪，等关键数据补齐后再决定。" },
];

function evidenceForDepartment(plan: WarRoomPlan, department?: string): string[] {
  const action = department ? plan.department_actions.find((item) => item.department === department) : undefined;
  const label = action?.department_label ?? "";
  const matches = plan.evidence_summary.filter((item) => label && item.includes(label));
  return (matches.length ? matches : plan.evidence_summary).slice(0, 3);
}

// 证据来源含这些词 = 本项目自有事实（内部）；否则视为可公开溯源的外部证据。
// 与后端 composer._INTERNAL_SOURCE_MARKERS 对齐，用于旧方案 JSON 的前端兜底拆分。
const INTERNAL_EVIDENCE_MARKERS = ["客户自述", "客户上传", "上传", "自述", "问答"];

function isInternalEvidence(text: string): boolean {
  return INTERNAL_EVIDENCE_MARKERS.some((marker) => text.includes(marker));
}

function firstClause(value: unknown, maxLength = 28): string {
  const text = cleanDisplayText(value, "");
  if (!text) return "";
  const chunk = text.split(/[，。；：:、]/)[0]?.trim() || text;
  return chunk.length > maxLength ? `${chunk.slice(0, maxLength)}…` : chunk;
}

// 「问题是什么」=现象一句话：去掉末尾的（来源）后限长，保证读起来是句子。
function problemStatement(value: unknown, fallback: string, maxLength = 54): string {
  const raw = cleanDisplayText(value, "").replace(/（[^）]*）\s*$/u, "").trim();
  if (!raw) return ensureChineseSentence(fallback);
  return ensureChineseSentence(raw.length > maxLength ? `${raw.slice(0, maxLength)}…` : raw);
}

// 内/外证据：优先用后端结构化字段（新诊断）；为空则从 deptEvidence 按来源兜底拆（旧快照）。
function pickEvidence(structured: string[] | undefined, fallback: string[], wantInternal: boolean): string[] {
  const source = structured && structured.length
    ? structured
    : fallback.filter((item) => isInternalEvidence(item) === wantInternal);
  return source.map((item) => cleanSentenceText(item, "")).filter(Boolean).slice(0, 4);
}

function buildConsultingRecommendations(plan: WarRoomPlan): ConsultingRecommendation[] {
  const actionRecommendations = plan.department_actions.map((action, index): ConsultingRecommendation => {
    const deptEvidence = evidenceForDepartment(plan, action.department);
    const internalData = pickEvidence(action.internal_evidence, deptEvidence, true);
    const externalData = pickEvidence(action.external_evidence, deptEvidence, false);
    // 02 结论 = battle_goal（=诊断判断），单一来源、只出现一次
    const conclusion = cleanSentenceText(action.battle_goal, "建议先按保守路径推进，并在补齐数据后重新判断。");
    // 01 问题 = 大脑给的 problem（现象）；旧数据兜底：首条内部事实 ‖ 结论
    const brainProblem = (action.problem || "").trim();
    const fellBackToFact = !brainProblem && internalData.length > 0;
    const problem = problemStatement(
      brainProblem || internalData[0] || conclusion,
      "当前问题需要进一步明确。",
    );
    // 若问题兜底自首条内部事实，04 不再重复它（避免「重复」），但保证 04 不被掏空
    const internalForDisplay = fellBackToFact && internalData.length > 1 ? internalData.slice(1) : internalData;
    return {
      id: `action:${action.id}`,
      source: "action",
      priority: action.priority,
      index,
      title: recommendationTitle(action, "咨询建议"),
      essence: firstClause(conclusion, 28),
      problem,
      conclusion,
      externalData,
      internalData: internalForDisplay,
      dataGaps: action.required_data.length ? action.required_data : plan.data_gaps,
      action,
      confidence: action.confidence ?? plan.confidence,
    };
  });

  const actionTitles = new Set(actionRecommendations.map((item) => item.title));
  const decisionRecommendations = plan.decision_items
    .map((decision, index): ConsultingRecommendation => {
      const title = recommendationTitle(decision.title || decision.detail, "咨询建议");
      const conclusion = cleanSentenceText(`建议确认：${title}`, "建议先明确是否采纳该事项。");
      return {
        id: `decision:${index}`,
        source: "decision",
        priority: decision.urgency,
        index,
        title,
        essence: firstClause(decision.detail, 28),
        problem: problemStatement(decision.detail, "这个事项需要老板确认后才能继续推进。"),
        conclusion,
        externalData: pickEvidence(undefined, plan.evidence_summary, false),
        internalData: pickEvidence(undefined, plan.evidence_summary, true),
        dataGaps: plan.data_gaps,
        decisionDetail: decision.detail,
        confidence: plan.confidence,
      };
    })
    .filter((item) => !actionTitles.has(item.title));

  return [...actionRecommendations, ...decisionRecommendations]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.index - b.index);
}

function recommendationPath(projectId: string, recommendationId?: string) {
  const base = sectionPath(projectId, "overview");
  return recommendationId ? `${base}?recommendation=${encodeURIComponent(recommendationId)}` : base;
}

function firstRecommendationId(plan: WarRoomPlan): string | undefined {
  return buildConsultingRecommendations(plan)[0]?.id;
}

function recommendationTitle(value: unknown, fallback: string): string {
  const text = typeof value === "object" && value !== null
    ? [
        (value as Partial<DepartmentAction>).action_title,
        (value as Partial<DepartmentAction>).battle_goal,
        (value as Partial<DepartmentAction>).action_detail,
        (value as Partial<DepartmentAction>).department_label,
      ].filter(Boolean).join("；")
    : cleanDisplayText(value, fallback);
  const title = inferConsultingTitle(text);
  return compactTitle(title || text, fallback, 12);
}

function inferConsultingTitle(value: string): string {
  const text = cleanDisplayText(value, "").replace(/\s+/g, "");
  if (!text) return "";

  const rules: Array<[RegExp, string]> = [
    [/销售漏斗|线索.*咨询|咨询.*报价|报价.*成交|成交.*转化|转化率/, "销售漏斗复核"],
    [/首响|响应过慢|响应时长|跟进超时/, "线索响应提速"],
    [/推广账号|投放报表|广告后台|千川|巨量|百度投放|小红书|抖音/, "投放数据接入"],
    [/获客成本|投放效率|线索成本|ROI|ROAS/, "投放效率复盘"],
    [/招商.*合规|合规闸门|特许经营|备案|3C|认证|宣传口径|合同条款/, "招商合规闸门"],
    [/招商|加盟|代理商|渠道放量|招商页/, "招商放量评估"],
    [/数据流向|数据流|CRM|ERP|客服系统|广告系统|财务系统|系统对接/, "数据流向梳理"],
    [/经销商|渠道商|代理商名单|出货记录|渠道库存/, "经销商核验"],
    [/单店|样板店|直营|门店经济|坪效|食材成本|人力成本|成本率|门店模型/, "单店模型复核"],
    [/回款|应收|账期|现金流|资金周转|现金储备/, "现金回款复盘"],
    [/定价|价格带|毛利|利润率|折扣/, "定价利润复盘"],
    [/供应链|产能|交期|库存|备货|履约|采购/, "供应履约复盘"],
    [/售后|故障|客诉|满意度|复购|留存|私域/, "体验留存提升"],
    [/组织|岗位|绩效|招聘|人才|团队|责任人/, "组织责任拆解"],
    [/法务|合同|诉讼|资质|监管|政策/, "合规风险核验"],
    [/税务|发票|税负/, "税务风险核验"],
    [/商标|专利|知识产权|侵权/, "知产风险核验"],
    [/补齐关键数据|关键数据|待补数据|数据待补/, "补齐关键数据"],
  ];

  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "";
}

function compactTitle(value: unknown, fallback: string, maxLength = 14): string {
  const text = cleanDisplayText(value, fallback)
    .replace(/^拍板[:：]\s*/, "")
    .replace(/[（(][^)）]{4,}[)）]/g, "")
    .replace(/(?:是否|需要|先|立即|尽快|建议|请|进行)\s*/g, "")
    .trim();
  const firstChunk = text.split(/[，。；：:]/)[0]?.trim() || "";
  if (!firstChunk) return fallback;
  return firstChunk.length > maxLength ? `${firstChunk.slice(0, maxLength)}…` : firstChunk;
}

function compactReason(value: unknown, fallback: string, maxLength = 32): string {
  const text = cleanDisplayText(value, fallback)
    .replace(/^是否/, "")
    .replace(/^避免/, "为避免")
    .trim();
  const firstChunk = text.split(/[。；]/)[0]?.trim() || "";
  if (!firstChunk) return ensureChineseSentence(fallback);
  return ensureChineseSentence(firstChunk.length > maxLength ? `${firstChunk.slice(0, maxLength)}...` : firstChunk);
}

function detailLines(value: unknown, fallback: string, maxItems = 2): string[] {
  const text = cleanDisplayText(value, fallback);
  const chunks = text
    .split(/[。；]/)
    .flatMap((part) => part.split(/[，]/))
    .map((part) => part.trim())
    .filter(Boolean);
  const picked = chunks.slice(0, maxItems).map((part) => ensureChineseSentence(part));
  return picked.length ? picked : [ensureChineseSentence(fallback)];
}

function isSupplementImageFile(file: DataSupplementFile): boolean {
  if (file.content_type === "image") return true;
  if (file.media_type?.startsWith("image/")) return true;
  return /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.original_name);
}

function textPreviewBlock(text: string | ArchivePreviewBlock, index: number): ArchivePreviewBlock | null {
  if (typeof text !== "string" && text.type === "table") return null;
  const rawText = typeof text === "string" ? text : text.text;
  const clean = rawText.trim();
  if (!clean) return null;
  if (index === 0 && clean.length <= 80) return { type: "title", text: clean, level: 1 };
  if (/^[一二三四五六七八九十]+[、.．]\s*/.test(clean)) return { type: "heading", text: clean, level: 2 };
  if (/^\d+(?:\.\d+)+\s+/.test(clean)) return { type: "heading", text: clean, level: 3 };
  return { type: "paragraph", text: clean };
}

function normalizePreviewBlock(block: ArchivePreviewBlock | string, index: number): ArchivePreviewBlock | null {
  if (typeof block === "string") return textPreviewBlock(block, index);
  if (block.type === "table") {
    const rows = block.rows
      ?.map((row) => row.map((cell) => String(cell || "").trim()))
      .filter((row) => row.some(Boolean)) ?? [];
    return rows.length > 0 ? { type: "table", rows } : null;
  }
  const text = String(block.text || "").trim();
  if (!text) return null;
  return {
    type: block.type || "paragraph",
    text,
    level: block.level,
  };
}

function supplementPreviewBlocks(file: DataSupplementFile): ArchivePreviewBlock[] {
  const blocks = file.preview_blocks
    ?.map((item, index) => normalizePreviewBlock(item, index))
    .filter((item): item is ArchivePreviewBlock => Boolean(item)) ?? [];
  if (blocks.length > 0) return blocks;
  const text = (file.preview_text || file.summary_text || "当前文件已保存原件，但没有可展示的文本预览。可下载原件查看完整内容。").trim();
  if (!text) return [];
  const byLines = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (byLines.length > 1) {
    return byLines
      .map((item, index) => textPreviewBlock(item, index))
      .filter((item): item is ArchivePreviewBlock => Boolean(item));
  }
  return text
    .replace(/([。！？；])\s*(?=(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|[（(]\d+[）)]))/g, "$1\n")
    .replace(/\s+(?=(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|[（(]\d+[）)]))/g, "\n")
    .split(/\n+/)
    .map((item, index) => textPreviewBlock(item, index))
    .filter((item): item is ArchivePreviewBlock => Boolean(item));
}

function previewBlockClass(block: ArchivePreviewBlock, index: number): string {
  if (block.type === "table") return "is-table";
  const text = "text" in block ? block.text : "";
  if (block.type === "title" || (index === 0 && text.length <= 80)) return "is-title";
  if (block.type === "heading") return `is-heading is-heading-level-${block.level || 3}`;
  if (/^(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|[（(]\d+[）)]|第[一二三四五六七八九十\d]+[章节部分])/.test(text)) {
    return "is-heading";
  }
  return "is-paragraph";
}

function isEmptyWarRoomError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("404") || message.includes("尚未建立");
}

function blockedWarRoomState(error: unknown): WarRoomBlockedState {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("403") || message.includes("审核中")) return "pending_review";
  if (message.includes("409") || message.includes("打回")) return "rejected";
  return null;
}

export function ProjectWarRoomPage() {
  const { projectId, section } = useParams<{ projectId: string; section?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as {
    projectSnapshot?: WarRoomProjectSnapshot;
  } | null) ?? {};
  const initialProject = navState.projectSnapshot && navState.projectSnapshot.id === projectId
    ? navState.projectSnapshot
    : null;
  const [project, setProject] = useState<WarRoomProjectSnapshot | null>(initialProject);
  const [plan, setPlan] = useState<WarRoomPlan | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [warRoomError, setWarRoomError] = useState<string | null>(null);
  const [isEmptyWarRoom, setIsEmptyWarRoom] = useState(false);
  const [blockedState, setBlockedState] = useState<WarRoomBlockedState>(null);
  const [feedbackEvents, setFeedbackEvents] = useState<WarRoomFeedbackEvent[]>([]);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then(setProject)
      .catch((e) => setProjectError(e instanceof Error ? e.message : "项目加载失败"));
    getProjectWarRoom(projectId)
      .then((nextPlan) => {
        setPlan(nextPlan);
        setWarRoomError(null);
        setIsEmptyWarRoom(false);
        setBlockedState(null);
        listWarRoomFeedback(projectId)
          .then(setFeedbackEvents)
          .catch(() => setFeedbackEvents([]));
      })
      .catch((e) => {
        const nextBlockedState = blockedWarRoomState(e);
        if (nextBlockedState) {
          setBlockedState(nextBlockedState);
          setWarRoomError(null);
          setIsEmptyWarRoom(false);
          return;
        }
        if (isEmptyWarRoomError(e)) {
          setIsEmptyWarRoom(true);
          setWarRoomError(null);
          setBlockedState(null);
          return;
        }
        setWarRoomError(e instanceof Error ? e.message : "作战室加载失败");
      });
  }, [projectId]);

  const activeSection: WarRoomSection = isWarRoomSection(section) ? section : "overview";
  useEffect(() => {
    if (section && !isWarRoomSection(section) && projectId) {
      const target = section === "review" ? "iterations" : "overview";
      navigate(sectionPath(projectId, target), { replace: true, preventScrollReset: true });
    }
  }, [navigate, projectId, section]);
  const activeConfig = activeSection ? SECTION_MAP.get(activeSection) : null;
  if (!projectId) {
    return <p className="state-note state-note--error">缺少项目 ID。</p>;
  }

  if (!project && projectError) {
    return <p className="state-note state-note--error">{projectError}</p>;
  }

  const shellProject = project ?? {
    id: projectId,
    name: "项目作战室",
    status: "active",
    sessions: [],
  };
  const openNewConversation = (extraState: Record<string, unknown> = {}) => {
    navigate(`/projects/${projectId}`, {
      preventScrollReset: true,
      state: {
        projectSnapshot: shellProject,
        newConversation: true,
        ...extraState,
      },
    });
  };
  const effectiveBlockedState = blockedState ?? (
    project?.delivery_status?.state === "pending_review"
      ? "pending_review"
      : project?.delivery_status?.state === "rejected"
        ? "rejected"
        : null
  );

  return (
    <ProjectWorkspaceShell
      project={shellProject}
      activeSection="warroom"
      onResumeSession={(sessionId) => navigate(`/projects/${projectId}`, {
        preventScrollReset: true,
        state: { resumeSessionId: sessionId, projectSnapshot: shellProject },
      })}
    >
      <section className="project-war-room-shell">
        <div className="project-war-room-shell__head pd-section__head">
          <div>
            <h1 className="pd-section__title">{activeConfig ? activeConfig.title : "项目作战室"}</h1>
          </div>
          <div className="project-war-room-shell__actions">
            {activeSection !== "overview" && (
              <button
                type="button"
                className="pd-section__link"
                onClick={() => navigate(`/projects/${projectId}/war-room`, {
                  preventScrollReset: true,
                  state: { projectSnapshot: shellProject },
                })}
              >
                返回作战室总览
              </button>
            )}
            {activeSection === "overview" && (
              <button
                type="button"
                className="pd-section__link"
                onClick={() => openNewConversation()}
              >
                新增诊断迭代
              </button>
            )}
          </div>
        </div>

        {warRoomError && <p className="state-note state-note--error">{warRoomError}</p>}
        {effectiveBlockedState === "pending_review" && !plan && (
          <WarRoomReviewState
            title="顾问深度判断中"
            eyebrow="审核阶段"
            description="系统已完成资料整理、外部预研和多专家诊断，当前正在由顾问复核证据、结论和行动建议。审核通过后，这里会展示正式作战室交付。"
            steps={[
              "已完成：问题地图、资料整理、外部证据预研。",
              "进行中：顾问核验证据是否足够支撑结论。",
              "下一步：审核通过后生成老板可开会使用的作战室。",
            ]}
            primaryLabel="回到对话继续补充"
            onPrimary={() => navigate(`/projects/${projectId}`, {
              preventScrollReset: true,
              state: { projectSnapshot: shellProject },
            })}
          />
        )}
        {effectiveBlockedState === "rejected" && !plan && (
          <WarRoomReviewState
            title="顾问已打回，需要补充资料"
            eyebrow="补充阶段"
            description="顾问认为当前证据不足或部分判断需要修正。请先补充关键数据和资料，复审通过后再进入正式作战室。"
            steps={[
              "先查看顾问打回意见，补齐缺失数据。",
              "重新提交诊断后，系统会更新证据包和专家判断。",
              "通过复审后，作战室会按项目维度迭代更新。",
            ]}
            primaryLabel="补充资料再诊断"
            onPrimary={() => {
              const rejectedRecord = project?.records?.find((record) => record.review_status === "rejected");
              openNewConversation({
                rejectedRecordId: rejectedRecord?.id,
                initialPrompt: "顾问已打回，请根据顾问意见补充资料并重新诊断。",
              });
            }}
          />
        )}
        {isEmptyWarRoom && !plan && !effectiveBlockedState && (
          <section className="war-room-empty-state" aria-label="作战室尚未建立">
            <span className="war-room-empty-state__eyebrow">初次咨询未开始</span>
            <h2>请先进行对话，完成初次咨询。</h2>
            <p>项目作战室会在你完成第一次 AI 咨询并通过诊断后自动生成，用来沉淀老板决策、部门动作和证据风险。</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => openNewConversation()}
            >
              开始新对话
            </button>
          </section>
        )}
        {!plan && !warRoomError && !isEmptyWarRoom && !effectiveBlockedState && <p className="state-note">正在加载项目作战室…</p>}
        {plan && (
          <ProjectWarRoom
            plan={plan}
            projectId={projectId}
            feedbackSessionId={project?.records?.find((record) => record.id === plan.record_id)?.session_id ?? null}
            feedbackEvents={feedbackEvents}
            onSubmitFeedback={async (body) => {
              const saved = await submitWarRoomFeedback(projectId, body);
              setFeedbackEvents((prev) => [saved, ...prev]);
              getProject(projectId).then(setProject).catch(() => {});
              return saved;
            }}
            activeSection={activeSection}
            onNavigate={(path) => navigate(path, {
              preventScrollReset: true,
              state: { projectSnapshot: shellProject },
            })}
            onRediagnoseDomain={async (domainKey) => {
              const newPlan = await rediagnoseProjectDomain(projectId, domainKey);
              setPlan(newPlan);
            }}
          />
        )}
      </section>
    </ProjectWorkspaceShell>
  );
}

function WarRoomReviewState({
  eyebrow,
  title,
  description,
  steps,
  primaryLabel,
  onPrimary,
}: {
  eyebrow: string;
  title: string;
  description: string;
  steps: string[];
  primaryLabel: string;
  onPrimary: () => void;
}) {
  return (
    <section className="war-room-empty-state war-room-review-state" aria-label={title}>
      <span className="war-room-empty-state__eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <ol className="war-room-review-state__steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button type="button" className="btn-primary" onClick={onPrimary}>
        {primaryLabel}
      </button>
    </section>
  );
}

function ProjectWarRoom({
  plan,
  projectId,
  feedbackSessionId,
  feedbackEvents,
  onSubmitFeedback,
  activeSection,
  onNavigate,
  onRediagnoseDomain,
}: {
  plan: WarRoomPlan;
  projectId: string;
  feedbackSessionId: string | null;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  activeSection: WarRoomSection;
  onNavigate: (path: string) => void;
  onRediagnoseDomain: (domainKey: string) => Promise<void>;
}) {
  return (
    <section className="war-room project-war-room" aria-label="项目作战室">
      <WarRoomSubnav
        plan={plan}
        projectId={projectId}
        activeSection={activeSection}
        onNavigate={onNavigate}
      />
      <WarRoomSectionContent
        plan={plan}
        projectId={projectId}
        feedbackSessionId={feedbackSessionId}
        section={activeSection}
        feedbackEvents={feedbackEvents}
        onSubmitFeedback={onSubmitFeedback}
        onNavigate={onNavigate}
        onRediagnoseDomain={onRediagnoseDomain}
      />
    </section>
  );
}

function WarRoomSubnav({
  plan,
  projectId,
  activeSection,
  onNavigate,
}: {
  plan: WarRoomPlan;
  projectId: string;
  activeSection: WarRoomSection;
  onNavigate: (path: string) => void;
}) {
  return (
    <nav className="war-room-subnav" aria-label="作战室功能区">
      {SECTIONS.map((item) => (
        <button
          type="button"
          key={item.key}
          className={item.key === activeSection ? "war-room-subnav__item is-active" : "war-room-subnav__item"}
          onClick={() => onNavigate(sectionPath(projectId, item.key))}
        >
          <span>{item.order} · {item.navLabel}</span>
          <strong>{navBadge(plan, item.key)}</strong>
        </button>
      ))}
    </nav>
  );
}

function WarRoomOverview({
  plan,
}: {
  plan: WarRoomPlan;
}) {
  const versionNumber = plan.iteration_count ?? plan.iterations?.length ?? 1;
  const statusCards = [
    { icon: "●", label: "项目状态", value: "已生成作战室", detail: `当前第 ${versionNumber} 版` },
    { icon: "◆", label: "资料状态", value: plan.data_gaps.length ? `${plan.data_gaps.length} 项待补` : "资料可支撑本轮判断", detail: plan.data_gaps.length ? "建议先补齐再加码" : "可进入建议执行" },
    { icon: "▲", label: "咨询把握度", value: formatPercent(plan.confidence), detail: plan.confidence < 0.5 ? "把握不足，需补数据" : plan.confidence < 0.75 ? "中等把握，谨慎推进" : "把握较高，可按建议推进" },
  ];

  return (
    <section className="boss-room" aria-label="作战室总览">
      <div className="boss-room__hero">
        <div className="boss-room__main">
          <span className="boss-room__eyebrow">项目总览</span>
          <h2>{compactTitle(plan.objective, "本轮项目判断已生成", 34)}</h2>
          <p>{cleanSentenceText(plan.summary, "这里汇总项目状态、资料缺口、咨询建议和迭代变化。")}</p>
          <div className="boss-room__notice-row">
            {plan.accumulation_note && <span className="boss-room__notice boss-room__notice--good">{cleanDisplayText(plan.accumulation_note, "")}</span>}
            {plan.data_gaps.length > 0 && <span className="boss-room__notice boss-room__notice--warn">资料还不够，先别加码。</span>}
          </div>
        </div>
        <aside className="boss-room__quick-facts" aria-label="项目状态信息">
          {statusCards.map((card) => (
            <div key={card.label}>
              <span>{card.icon} {card.label}</span>
              <strong>{card.value}</strong>
              <em>{card.detail}</em>
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}

function WarRoomSectionContent({
  plan,
  projectId,
  feedbackSessionId,
  section,
  feedbackEvents,
  onSubmitFeedback,
  onNavigate,
  onRediagnoseDomain,
}: {
  plan: WarRoomPlan;
  projectId: string;
  feedbackSessionId: string | null;
  section: WarRoomSection;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  onNavigate: (path: string) => void;
  onRediagnoseDomain: (domainKey: string) => Promise<void>;
}) {
  if (section === "overview") {
    return (
      <div className="war-room-detail-stack">
        <WarRoomOverview plan={plan} />
        <ConsultingRecommendationsPanel
          projectId={projectId}
          feedbackSessionId={feedbackSessionId}
          plan={plan}
          feedbackEvents={feedbackEvents}
          onSubmitFeedback={onSubmitFeedback}
          onNavigate={onNavigate}
          onRediagnoseDomain={onRediagnoseDomain}
        />
      </div>
    );
  }
  return (
    <div className="war-room-detail-stack">
      <WarRoomIterations plan={plan} />
    </div>
  );
}

const WR_FB_ADOPT_LABEL: Record<string, string> = { adopted: "已采纳", deferred: "暂缓", rejected: "不采纳", pending: "" };
const WR_FB_RESULT_LABEL: Record<string, string> = { effective: "有效", no_change: "无变化", new_issue: "有新问题", insufficient_data: "数据不足", none: "" };

function latestCardFeedback(
  events: WarRoomFeedbackEvent[],
  card: ConsultingRecommendation,
): WarRoomFeedbackEvent | undefined {
  return events
    .filter((event) => event.card_id === card.id || event.card_title === card.title)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

function cardFeedbackBadge(
  event?: WarRoomFeedbackEvent,
): { label: string; tone: "good" | "warn" | "muted" } | null {
  if (!event) return null;
  const adopt = WR_FB_ADOPT_LABEL[event.adoption_status] ?? "";
  const result = WR_FB_RESULT_LABEL[event.feedback_result] ?? "";
  const label = [adopt, result].filter(Boolean).join("·");
  if (!label) return null;
  let tone: "good" | "warn" | "muted" = "muted";
  if (event.feedback_result === "effective") tone = "good";
  else if (event.feedback_result === "no_change" || event.feedback_result === "new_issue") tone = "warn";
  else if (event.adoption_status === "adopted") tone = "good";
  return { label, tone };
}

function ConsultingRecommendationsPanel({
  projectId,
  feedbackSessionId,
  plan,
  feedbackEvents,
  onSubmitFeedback,
  onNavigate,
  onRediagnoseDomain,
}: {
  projectId: string;
  feedbackSessionId: string | null;
  plan: WarRoomPlan;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  onNavigate: (path: string) => void;
  onRediagnoseDomain: (domainKey: string) => Promise<void>;
}) {
  const recommendations = buildConsultingRecommendations(plan);
  const params = new URLSearchParams(window.location.search);
  const selectedId = params.get("recommendation") || recommendations[0]?.id || "";
  const selected = recommendations.find((item) => item.id === selectedId) ?? recommendations[0];
  // 每个问题的 AI 改造(module → DomainTransformation)。404 视为"还没生成",不报错。
  const [transformItems, setTransformItems] = useState<Record<string, DomainTransformation>>({});
  useEffect(() => {
    getTransformationPlan(projectId)
      .then((p) => setTransformItems(p.items ?? {}))
      .catch(() => setTransformItems({}));
  }, [projectId]);
  const recommendationsByPriority = new Map<WarRoomUrgency, ConsultingRecommendation[]>(
    CONSULTING_PRIORITY_GROUPS.map((group) => [
      group.key,
      recommendations.filter((item) => item.priority === group.key),
    ])
  );

  if (!selected) {
    return (
      <section className="war-panel consulting-recommendations">
        <div className="war-panel__heading">
          <div>
            <span>咨询建议</span>
            <h3>暂无咨询建议</h3>
          </div>
        </div>
        <p className="data-needs-panel__empty">当前作战室还没有生成可执行建议。</p>
      </section>
    );
  }

  return (
    <section className="consulting-recommendations" aria-label="咨询建议">
      <aside className="consulting-recommendations__list">
        <div className="consulting-recommendations__list-head">
          <span>建议清单</span>
          <strong>{recommendations.length} 条</strong>
        </div>
        <div className="consulting-priority-groups">
          {CONSULTING_PRIORITY_GROUPS.map((group) => {
            const items = recommendationsByPriority.get(group.key) ?? [];
            return (
              <section
                key={group.key}
                className={`consulting-priority-group consulting-priority-group--${group.key}`}
                aria-label={consultingPriorityLabel(group.key)}
              >
                <div className="consulting-priority-group__head">
                  <div>
                    <span>{group.label}</span>
                    <em>{group.shortLabel}</em>
                  </div>
                  <strong>{items.length} 条</strong>
                </div>
                <p className="consulting-priority-group__hint">{group.hint}</p>
                {items.length === 0 ? (
                  <p className="consulting-priority-group__empty">暂无建议</p>
                ) : (
                  <div className="consulting-priority-group__items">
                    {items.map((item, index) => {
                      const badge = cardFeedbackBadge(latestCardFeedback(feedbackEvents, item));
                      return (
                      <button
                        type="button"
                        key={item.id}
                        className={item.id === selected.id ? "consulting-recommendation-tab is-active" : "consulting-recommendation-tab"}
                        onClick={() => onNavigate(recommendationPath(projectId, item.id))}
                      >
                        <small>{String(index + 1).padStart(2, "0")}</small>
                        <span className="consulting-recommendation-tab__title">{item.title}</span>
                        {badge && <span className={`wr-fb-badge wr-fb-badge--${badge.tone}`}>{badge.label}</span>}
                      </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
      <RecommendationDetail
        projectId={projectId}
        feedbackSessionId={feedbackSessionId}
        plan={plan}
        recommendation={selected}
        feedbackEvents={feedbackEvents}
        onSubmitFeedback={onSubmitFeedback}
        onRediagnoseDomain={onRediagnoseDomain}
        transformation={selected.action ? transformItems[selected.action.department] : undefined}
        onGenerateTransformation={async (module) => {
          const next = await generateTransformationDomain(projectId, module);
          setTransformItems(next.items ?? {});
        }}
      />
    </section>
  );
}

function RecommendationDetail({
  projectId,
  feedbackSessionId,
  plan,
  recommendation,
  feedbackEvents,
  onSubmitFeedback,
  onRediagnoseDomain,
  transformation,
  onGenerateTransformation,
}: {
  projectId: string;
  feedbackSessionId: string | null;
  plan: WarRoomPlan;
  recommendation: ConsultingRecommendation;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  onRediagnoseDomain: (domainKey: string) => Promise<void>;
  transformation?: DomainTransformation;
  onGenerateTransformation: (module: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rediagnosing, setRediagnosing] = useState(false);
  const [rediagnoseError, setRediagnoseError] = useState<string | null>(null);
  const [transforming, setTransforming] = useState(false);
  const [transformError, setTransformError] = useState<string | null>(null);
  const relatedFeedback = feedbackEvents
    .filter((event) => event.card_id === recommendation.id || event.card_title === recommendation.title)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const action = recommendation.action;

  async function handleGenerateTransformation() {
    const module = action?.department;
    if (!module) return;
    setTransforming(true);
    setTransformError(null);
    try {
      await onGenerateTransformation(module);
    } catch (e) {
      setTransformError(e instanceof Error ? e.message : "生成改造方案失败，请重试");
    } finally {
      setTransforming(false);
    }
  }

  function openRediagnoseConversation() {
    const dept = action?.department_label || recommendation.title;
    navigate(`/projects/${projectId}`, {
      preventScrollReset: true,
      state: {
        newConversation: true,
        initialPrompt: `我对「${recommendation.title}」这条建议有质疑，请针对${dept}域重新诊断，并解释你的判断依据。`,
      },
    });
  }

  async function handleRediagnose() {
    const domainKey = action?.department;
    if (!domainKey) { openRediagnoseConversation(); return; }
    setRediagnosing(true);
    setRediagnoseError(null);
    try {
      await onRediagnoseDomain(domainKey);
    } catch (e) {
      setRediagnoseError(e instanceof Error ? e.message : "重新诊断失败，请稍后重试");
    } finally {
      setRediagnosing(false);
    }
  }

  return (
    <article className="recommendation-detail">
      <header className="recommendation-detail__hero">
        <div>
          <div className="recommendation-detail__tags">
            <span className={priorityClass(recommendation.priority)}>{consultingPriorityLabel(recommendation.priority)}</span>
            {(() => {
              const badge = cardFeedbackBadge(relatedFeedback[0]);
              return badge ? <span className={`wr-fb-badge wr-fb-badge--${badge.tone}`}>{badge.label}</span> : null;
            })()}
          </div>
          <h2>{recommendation.title}</h2>
          <p>{recommendation.essence || recommendation.conclusion}</p>
          <div className="recommendation-detail__actions">
            <button type="button" className="recommendation-rediagnose-link" onClick={openRediagnoseConversation}>
              质疑此建议，去对话
            </button>
          </div>
        </div>
        <aside>
          <span>咨询把握度</span>
          <strong>{formatPercent(recommendation.confidence ?? plan.confidence)}</strong>
          <em>{recommendation.dataGaps.length ? "仍有数据待补" : "资料可支撑本轮判断"}</em>
        </aside>
      </header>

      <div className="recommendation-framework">
        <section className="recommendation-cluster">
          <div className="recommendation-cluster__head">
            <span>01-04</span>
            <strong>诊断主线</strong>
          </div>
          <div className="recommendation-cluster__grid">
            <section className="recommendation-mini-card recommendation-mini-card--problem">
              <span>01</span>
              <h3>问题是什么？</h3>
              <p>{recommendation.problem}</p>
            </section>
            <section className="recommendation-mini-card recommendation-mini-card--conclusion">
              <span>02</span>
              <h3>结论是什么？</h3>
              <p>{recommendation.conclusion}</p>
            </section>
            <section className="recommendation-mini-card recommendation-mini-card--evidence">
              <span>03</span>
              <h3>外部数据与来源证明</h3>
              <EvidenceList items={recommendation.externalData} empty="本轮未引用外部证据；行业基准、竞品、政策等公开数据由系统自动检索，无需你提供。" />
            </section>
            <section className="recommendation-mini-card recommendation-mini-card--evidence">
              <span>04</span>
              <h3>内部数据与项目依据</h3>
              <EvidenceList items={recommendation.internalData} empty="本轮暂无可引用的内部经营事实，建议在下方补齐业务口径数据。" />
            </section>
          </div>
        </section>
        <section className="recommendation-block recommendation-block--wide recommendation-block--data">
          <span>05</span>
          <h3>数据缺口与补充</h3>
          <InlineDataNeeds projectId={projectId} plan={plan} gaps={recommendation.dataGaps} />
          {action?.department && (
            <div className="recommendation-rediagnose-bar">
              <p>补充数据后，可用新信息重新诊断此域（不影响其他建议）。</p>
              <div className="recommendation-rediagnose-bar__actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleRediagnose()}
                  disabled={rediagnosing}
                >
                  {rediagnosing ? "重新诊断中…" : "用新数据重新诊断此域"}
                </button>
              </div>
              {rediagnoseError && <p className="recommendation-rediagnose-bar__error">{rediagnoseError}</p>}
            </div>
          )}
        </section>
        <section className="recommendation-block recommendation-block--wide recommendation-block--action">
          <span>06</span>
          <h3>行动建议</h3>
          {action ? (
            <div className="recommendation-action">
              <div className="recommendation-action__detail"><span>具体动作</span><strong>{cleanSentenceText(action.action_detail || action.action_title, "待明确具体动作。")}</strong></div>
              <div><span>负责人</span><strong>{action.owner_role || "待确认"}</strong></div>
              <div><span>启动窗口</span><strong>{action.start_window || "待确认"}</strong></div>
              <div><span>验收标准</span><strong>{cleanSentenceText(action.acceptance_rule, "下次提交执行记录和指标变化。")}</strong></div>
              {action.metrics.filter((metric) => metric && metric.name).map((metric) => (
                <div key={metric.name}>
                  <span>{cleanDisplayText(metric.name, "关键指标")}</span>
                  <strong>{metric.current ? `${metric.current} → ` : ""}{cleanDisplayText(metric.target, "下次复盘可量化")}</strong>
                </div>
              ))}
              {action.risk_note && <p>{cleanSentenceText(action.risk_note, "")}</p>}
            </div>
          ) : (
            <p>{cleanSentenceText(recommendation.decisionDetail, "建议先确认是否采纳该方向，再拆解负责人和时间表。")}</p>
          )}
        </section>
        <section className="recommendation-block recommendation-block--wide recommendation-block--transform">
          <span>07</span>
          <h3>这个问题的 AI 改造</h3>
          {action?.department ? (
            transformation && transformation.generated !== false ? (
              <TransformationDetail item={transformation} />
            ) : (
              <div className="recommendation-transform-empty">
                <p>用 AI 把这个问题对应的环节重做一遍——给出改造前后对比 + 30 天落地路径。</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleGenerateTransformation()}
                  disabled={transforming}
                >
                  {transforming ? "生成中…（约需 10-30 秒）" : transformation ? "重新生成改造方案" : "为这个问题生成 AI 改造方案"}
                </button>
                {transformError && <p className="recommendation-transform-empty__error">{transformError}</p>}
              </div>
            )
          ) : (
            <p className="recommendation-empty">该建议暂不支持单独的 AI 改造。</p>
          )}
        </section>
        <section className="recommendation-block recommendation-block--wide recommendation-block--feedback">
          <span>08</span>
          <h3>反馈进展与迭代数据</h3>
          <div className="recommendation-feedback">
            <button type="button" className="recommendation-feedback__button" onClick={() => setFeedbackOpen(true)}>
              <span>记录反馈进展</span>
              <em>记录执行后的真实变化</em>
            </button>
            {relatedFeedback.length === 0 ? (
              <p>暂无反馈。执行后的真实变化会进入下一轮诊断迭代。</p>
            ) : (
              <ul>
                {relatedFeedback.map((event) => (
                  <li key={event.id}>
                    <strong>{feedbackStatusLabel(event.adoption_status)} · {feedbackResultLabel(event.feedback_result)}</strong>
                    <span>{new Date(event.created_at).toLocaleString("zh-CN")}</span>
                    {event.note && <p>{cleanSentenceText(event.note, "")}</p>}
                    {event.attachments.length > 0 && <small>附件：{event.attachments.length} 个</small>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      {feedbackOpen && (
        <RecommendationFeedbackDialog
          plan={plan}
          recommendation={recommendation}
          sessionId={feedbackSessionId}
          onClose={() => setFeedbackOpen(false)}
          onSubmit={onSubmitFeedback}
        />
      )}
    </article>
  );
}

function EvidenceList({ items, empty }: { items: string[]; empty: string }) {
  const cleanItems = items.map((item) => cleanSentenceText(item, "")).filter(Boolean);
  if (cleanItems.length === 0) return <p className="recommendation-empty">{empty}</p>;
  return (
    <ul className="recommendation-evidence-list">
      {cleanItems.map((item) => (
        <li key={item}>{renderLinkedText(item)}</li>
      ))}
    </ul>
  );
}

function renderLinkedText(value: string) {
  const sourceLink = extractSourceTitleLink(value);
  if (sourceLink) {
    return (
      <a href={sourceLink.href} target="_blank" rel="noreferrer">
        {sourceLink.title}
      </a>
    );
  }
  const parts = splitTextWithLinks(value);
  if (parts.length === 0) return value;
  return parts.map((part, index) => {
    if (part.type === "link" && part.href) {
      return (
        <a key={`${part.href}-${index}`} href={part.href} target="_blank" rel="noreferrer">
          {part.text}
        </a>
      );
    }
    return <span key={`${index}`}>{part.text}</span>;
  });
}

function feedbackStatusLabel(value: string) {
  if (value === "adopted") return "已采纳";
  if (value === "deferred") return "暂缓";
  if (value === "rejected") return "不采纳";
  return "待确认";
}

function feedbackResultLabel(value: string) {
  if (value === "effective") return "有效";
  if (value === "no_change") return "无明显变化";
  if (value === "new_issue") return "出现新问题";
  if (value === "insufficient_data") return "数据不足";
  return "暂未反馈效果";
}

function RecommendationFeedbackDialog({
  plan,
  recommendation,
  sessionId,
  onClose,
  onSubmit,
}: {
  plan: WarRoomPlan;
  recommendation: ConsultingRecommendation;
  sessionId?: string | null;
  onClose: () => void;
  onSubmit: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
}) {
  const [adoption, setAdoption] = useState<WarRoomFeedbackCreate["adoption_status"]>("adopted");
  const [result, setResult] = useState<WarRoomFeedbackCreate["feedback_result"]>("effective");
  const [owner, setOwner] = useState(recommendation.action?.owner_role ?? "");
  const [note, setNote] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<UploadedFileOut[]>([]);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!sessionId || files.length === 0 || uploadingFileName) return;
    setError(null);
    for (const file of files.slice(0, Math.max(0, 5 - selectedFiles.length))) {
      setUploadingFileName(file.name);
      try {
        const saved = await uploadSessionFile(sessionId, "war_room_feedback", "attachments", file);
        setSelectedFiles((prev) => [...prev, saved]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "附件上传失败");
      } finally {
        setUploadingFileName("");
      }
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        war_room_plan_id: plan.id,
        record_id: plan.record_id,
        card_type: recommendation.source === "decision" ? "decision" : "action",
        card_id: recommendation.id,
        card_title: recommendation.title,
        adoption_status: adoption,
        feedback_result: result,
        owner,
        note,
        attachments: selectedFiles.map((file) => file.id),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "反馈提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="decision-feedback-dialog" role="dialog" aria-modal="true" aria-label="建议反馈">
      <div className="decision-feedback-dialog__card">
        <div className="decision-feedback-dialog__head">
          <div>
            <span>反馈进展</span>
            <h4>记录这条建议执行后的真实变化</h4>
            <p>这些反馈会成为下一轮诊断迭代的数据来源。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭反馈">x</button>
        </div>
        <section className="decision-feedback-dialog__target" title={recommendation.title}>
          <span>咨询建议</span>
          <p>{recommendation.title}</p>
        </section>
        <div className="decision-feedback-dialog__body">
          <div className="decision-feedback-dialog__choice-grid">
            <fieldset className="decision-feedback-dialog__section">
              <legend>采纳情况</legend>
              <div className="decision-feedback-dialog__options">
                {[
                  { value: "adopted", label: "已采纳" },
                  { value: "deferred", label: "暂缓" },
                  { value: "rejected", label: "不采纳" },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={adoption === option.value ? "is-active" : ""}
                    onClick={() => setAdoption(option.value as WarRoomFeedbackCreate["adoption_status"])}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="decision-feedback-dialog__section">
              <legend>阶段结果</legend>
              <div className="decision-feedback-dialog__options">
                {[
                  { value: "effective", label: "有效" },
                  { value: "no_change", label: "无明显变化" },
                  { value: "new_issue", label: "有新问题" },
                  { value: "insufficient_data", label: "数据不足" },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={result === option.value ? "is-active" : ""}
                    onClick={() => setResult(option.value as WarRoomFeedbackCreate["feedback_result"])}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="decision-feedback-dialog__section decision-feedback-dialog__section--form">
            <label>
              反馈人/负责人
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="例如：销售负责人、老板本人" />
            </label>
            <label>
              现场说明
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="写清楚实际推进后的变化、新问题或需要系统下次重判的点。"
                rows={4}
              />
            </label>
            <label className="decision-feedback-dialog__upload">
              <span>补充资料（可选）</span>
              <div className="decision-feedback-dialog__upload-box">
                <input type="file" multiple onChange={(e) => void handleFilesChange(e)} disabled={!sessionId || Boolean(uploadingFileName)} />
                <div className="decision-feedback-dialog__upload-copy">
                  <strong>点击选择文件</strong>
                  <em>{sessionId ? "支持多文件上传，便于补充现场材料。" : "请先保存会话后再上传。"}</em>
                </div>
              </div>
            </label>
            {(selectedFiles.length > 0 || uploadingFileName) && (
              <div className="decision-feedback-dialog__files">
                {selectedFiles.map((file) => (
                  <div key={file.id} className="decision-feedback-dialog__file-item">
                    <span>{file.original_name}</span>
                    <button type="button" onClick={() => setSelectedFiles((prev) => prev.filter((item) => item.id !== file.id))}>
                      移除
                    </button>
                  </div>
                ))}
                {uploadingFileName && <p className="decision-feedback-dialog__uploading">正在上传 {uploadingFileName}…</p>}
              </div>
            )}
          </div>
          {error && <p className="decision-feedback-dialog__error">{error}</p>}
        </div>
        <div className="decision-feedback-dialog__actions">
          <button type="button" className="pd-section__link" onClick={onClose} disabled={submitting}>取消</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "提交中..." : "提交反馈"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DataNeedsPanel({ projectId, plan }: { projectId: string; plan: WarRoomPlan }) {
  return <InlineDataNeeds projectId={projectId} plan={plan} gaps={plan.data_gaps} panel />;
}

function InlineDataNeeds({
  projectId,
  plan,
  gaps,
  panel = false,
}: {
  projectId: string;
  plan: WarRoomPlan;
  gaps: DataRequest[];
  panel?: boolean;
}) {
  const dataGaps = gaps;
  const [requests, setRequests] = useState<DataSupplementRequest[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [fileBusyId, setFileBusyId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DataSupplementFile | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageLoading, setPreviewImageLoading] = useState(false);
  const [previewImageError, setPreviewImageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDataSupplementRequests(projectId)
      .then(setRequests)
      .catch(() => setRequests([]));
  }, [projectId]);

  useEffect(() => () => {
    if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
  }, [previewImageUrl]);

  async function copyRequest(item: WarRoomPlan["data_gaps"][number]) {
    setBusyKey(item.key);
    setError(null);
    try {
      let request = requests.find((row) => row.data_key === item.key && row.war_room_plan_id === plan.id);
      if (!request) {
        request = await createDataSupplementRequest(projectId, plan.id, item);
        setRequests((prev) => [request!, ...prev.filter((row) => row.id !== request!.id)]);
      }
      const url = new URL(request.public_url, window.location.origin).toString();
      const text = [
        `【资料补充】请提供：${item.label}`,
        item.reason ? `用途：${item.reason}` : "",
        `从哪取：${item.source_hint || "对应业务系统/负责人"}`,
        "",
        `请打开这个链接上传文件或填写说明：${url}`,
        "这个链接不需要登录，可以多次补充，历史提交会保留。",
      ].filter(Boolean).join("\n");
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前浏览器不支持自动复制，请手动打开补资料链接。");
      }
      await navigator.clipboard.writeText(text);
      setCopiedKey(item.key);
      window.setTimeout(() => setCopiedKey(null), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成补资料链接失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function openPreview(file: DataSupplementFile) {
    if (file.is_deleted) return;
    setError(null);
    setPreviewFile(file);
    setPreviewImageError(null);
    if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
    setPreviewImageUrl(null);
    if (!isSupplementImageFile(file)) {
      setPreviewImageLoading(false);
      return;
    }
    setPreviewImageLoading(true);
    try {
      const blob = await getSessionFileBlob(file.id);
      setPreviewImageUrl(URL.createObjectURL(blob));
    } catch (e) {
      setPreviewImageError(e instanceof Error ? e.message : "图片加载失败，可下载原件查看。");
    } finally {
      setPreviewImageLoading(false);
    }
  }

  function closePreview() {
    setPreviewFile(null);
    if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
    setPreviewImageUrl(null);
    setPreviewImageError(null);
    setPreviewImageLoading(false);
  }

  async function viewFile(fileId: string, fileName: string) {
    setError(null);
    setFileBusyId(`view:${fileId}`);
    try {
      await viewSessionFile(fileId, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "打开文件失败");
    } finally {
      setFileBusyId(null);
    }
  }

  async function downloadFile(fileId: string, fileName: string) {
    setError(null);
    setFileBusyId(`download:${fileId}`);
    try {
      await downloadSessionFile(fileId, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载文件失败");
    } finally {
      setFileBusyId(null);
    }
  }

  async function deleteFile(requestId: string, submissionId: string, fileId: string) {
    setError(null);
    setFileBusyId(`delete:${fileId}`);
    try {
      const updated = await deleteDataSupplementFile(projectId, requestId, submissionId, fileId);
      setRequests((prev) => prev.map((row) => row.id === updated.id ? updated : row));
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除文件失败");
    } finally {
      setFileBusyId(null);
    }
  }

  const content = (
    <>
      {dataGaps.length === 0 ? (
        <p className="data-needs-panel__empty">当前没有必须补齐的资料，可以先按本轮动作推进。</p>
      ) : (
        <div className="data-needs-list">
          {dataGaps.map((item) => (
            <article className="data-needs-card" key={item.key}>
              <div className="data-needs-card__head">
                <div>
                  <span>{item.typical_owner ? `通常找 ${item.typical_owner}` : "负责人待确认"}</span>
                  <h4>{cleanDisplayText(item.label, "待补资料")}</h4>
                </div>
                <button
                  type="button"
                  className={copiedKey === item.key ? "data-needs-card__copy is-copied" : "data-needs-card__copy"}
                  onClick={() => void copyRequest(item)}
                  disabled={busyKey === item.key}
                >
                  <span aria-hidden="true">
                    {busyKey === item.key ? "…" : copiedKey === item.key ? "✓" : "↗"}
                  </span>
                  {busyKey === item.key ? "生成中..." : copiedKey === item.key ? "已复制链接" : "复制补资料链接"}
                </button>
              </div>
              <div className="data-needs-card__body">
                <p>{cleanSentenceText(item.reason, "用于提高本轮判断把握度")}</p>
                {item.source_hint && <small>从哪取：{item.source_hint}</small>}
                <SupplementRequestStatus
                  request={requests.find((row) => row.data_key === item.key && row.war_room_plan_id === plan.id)}
                  fileBusyId={fileBusyId}
                  onPreviewFile={openPreview}
                  onDownloadFile={downloadFile}
                  onDeleteFile={deleteFile}
                />
              </div>
            </article>
          ))}
        </div>
      )}
      {error && <p className="data-needs-panel__error">{error}</p>}
      {previewFile && createPortal(
        <section className="project-archive-preview-modal" role="dialog" aria-label="资料在线预览">
          <div className="project-archive-preview-modal__card">
            <div className="project-archive-preview-modal__head">
              <div>
                <span>资料预览</span>
                <h3>{previewFile.original_name}</h3>
              </div>
              <button
                type="button"
                className="project-archive-preview-modal__close"
                onClick={closePreview}
              >
                关闭
              </button>
            </div>
            <div className="project-archive-preview-modal__body">
              {isSupplementImageFile(previewFile) ? (
                <div className="project-archive-preview-image">
                  {previewImageLoading && <p>图片加载中...</p>}
                  {previewImageError && <p className="project-archive-preview-image__error">{previewImageError}</p>}
                  {previewImageUrl && (
                    <img src={previewImageUrl} alt={previewFile.original_name} />
                  )}
                </div>
              ) : (
                <article className="project-archive-preview-document">
                  {supplementPreviewBlocks(previewFile).map((block, index) => (
                    block.type === "table" ? (
                      <div
                        key={`${previewFile.id}-preview-${index}`}
                        className="project-archive-preview-table-wrap"
                      >
                        <table className="project-archive-preview-table">
                          <tbody>
                            {block.rows.map((row, rowIndex) => (
                              <tr key={`${previewFile.id}-preview-${index}-${rowIndex}`}>
                                {row.map((cell, cellIndex) => (
                                  rowIndex === 0 ? (
                                    <th key={`${previewFile.id}-preview-${index}-${rowIndex}-${cellIndex}`}>
                                      {cell}
                                    </th>
                                  ) : (
                                    <td key={`${previewFile.id}-preview-${index}-${rowIndex}-${cellIndex}`}>
                                      {cell}
                                    </td>
                                  )
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p
                        key={`${previewFile.id}-preview-${index}`}
                        className={previewBlockClass(block, index)}
                      >
                        {block.text}
                      </p>
                    )
                  ))}
                </article>
              )}
            </div>
            <div className="project-archive-preview-modal__actions">
              <button
                type="button"
                className="project-archive-file-action"
                onClick={() => void viewFile(previewFile.id, previewFile.original_name)}
                disabled={fileBusyId === `view:${previewFile.id}`}
              >
                {fileBusyId === `view:${previewFile.id}` ? "打开中..." : "打开原文件"}
              </button>
              <button
                type="button"
                className="project-archive-file-action"
                onClick={() => void downloadFile(previewFile.id, previewFile.original_name)}
                disabled={fileBusyId === `download:${previewFile.id}`}
              >
                {fileBusyId === `download:${previewFile.id}` ? "下载中..." : "下载原件"}
              </button>
            </div>
          </div>
        </section>,
        document.body
      )}
    </>
  );

  if (!panel) {
    return <div className="data-needs-panel data-needs-panel--inline">{content}</div>;
  }

  return (
    <section className="war-panel data-needs-panel" aria-label="还缺什么资料">
      <div className="war-panel__heading">
        <div>
          <span>资料补充</span>
          <h3>还缺什么资料</h3>
        </div>
        <strong className="war-panel__count">{dataGaps.length} 项</strong>
      </div>
      {content}
    </section>
  );
}

function SupplementRequestStatus({
  request,
  fileBusyId,
  onPreviewFile,
  onDownloadFile,
  onDeleteFile,
}: {
  request?: DataSupplementRequest;
  fileBusyId: string | null;
  onPreviewFile: (file: DataSupplementFile) => Promise<void>;
  onDownloadFile: (fileId: string, fileName: string) => Promise<void>;
  onDeleteFile: (requestId: string, submissionId: string, fileId: string) => Promise<void>;
}) {
  if (!request) {
    return <em className="data-needs-card__status">还未生成链接。</em>;
  }
  if (request.submissions.length === 0) {
    return <em className="data-needs-card__status">链接已生成，等待对方提交。</em>;
  }
  return (
    <div className="data-needs-card__history">
      <strong>已提交 {request.submissions.length} 次</strong>
      <details open>
        <summary>查看提交记录</summary>
        <ul>
          {request.submissions.map((item) => (
            <li key={item.id}>
              <div className="data-needs-card__submission-head">
                <b>{item.submitter_name || "未填写姓名"}</b>
                <span>{new Date(item.created_at).toLocaleString("zh-CN")}</span>
              </div>
              {item.note && <p>{item.note}</p>}
              {item.files.length > 0 && (
                <div className="data-needs-card__files">
                  {item.files.map((file) => (
                    <div
                      className={file.is_deleted ? "data-needs-card__file is-deleted" : "data-needs-card__file"}
                      key={file.id}
                    >
                      <button
                        type="button"
                        className="data-needs-card__file-name"
                        onClick={() => void onPreviewFile(file)}
                        disabled={Boolean(file.is_deleted)}
                        title={file.is_deleted ? "文件已删除" : "点击在线预览"}
                      >
                        {file.original_name}
                      </button>
                      <div>
                        <button
                          type="button"
                          onClick={() => void onDownloadFile(file.id, file.original_name)}
                          disabled={Boolean(file.is_deleted) || fileBusyId === `download:${file.id}`}
                        >
                          {fileBusyId === `download:${file.id}` ? "下载中" : "下载"}
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => void onDeleteFile(request.id, item.id, file.id)}
                          disabled={Boolean(file.is_deleted) || fileBusyId === `delete:${file.id}`}
                        >
                          {file.is_deleted ? "已删除" : fileBusyId === `delete:${file.id}` ? "删除中" : "删除"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
