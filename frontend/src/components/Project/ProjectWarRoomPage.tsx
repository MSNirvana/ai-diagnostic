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
  submitWarRoomFeedback,
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
  WarRoomFeedbackCreate,
  WarRoomFeedbackEvent,
  WarRoomUrgency,
  WarRoomPlan,
} from "../../types";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { WarRoomIterations } from "../WarRoom/WarRoomPage";
import { cleanDisplayText, cleanSentenceText, ensureChineseSentence } from "../../utils/displayText";
import { formatPercent, priorityClass } from "../WarRoom/warRoomViewModel";
import "./ProjectDetailPage.css";

type WarRoomSection = "overview" | "recommendations" | "iterations";
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
    key: "recommendations",
    title: "咨询建议",
    description: "一条建议一个完整咨询页，按重要程度排序。",
    navLabel: "咨询建议",
    order: "02",
  },
  {
    key: "iterations",
    title: "诊断迭代",
    description: "记录每次诊断、动作、反馈和时间变化。",
    navLabel: "迭代历史",
    order: "03",
  },
];

const SECTION_MAP = new Map(SECTIONS.map((section) => [section.key, section]));

function isWarRoomSection(value: string | undefined): value is WarRoomSection {
  if (value === "review" || value === "decisions" || value === "actions" || value === "data" || value === "evidence") return false;
  return Boolean(value && SECTION_MAP.has(value as WarRoomSection));
}

function sectionPath(projectId: string, section: WarRoomSection) {
  if (section === "overview") return `/projects/${projectId}/war-room`;
  return `/projects/${projectId}/war-room/view/${section}`;
}

function navBadge(plan: WarRoomPlan, key: WarRoomSection): string {
  if (key === "overview") return "当前";
  if (key === "recommendations") return String(buildConsultingRecommendations(plan).length);
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

function riskForDepartment(plan: WarRoomPlan, department?: string): string[] {
  const action = department ? plan.department_actions.find((item) => item.department === department) : undefined;
  const label = action?.department_label ?? "";
  const matches = plan.risk_summary.filter((item) => label && item.includes(label));
  return (matches.length ? matches : plan.risk_summary).slice(0, 3);
}

function buildConsultingRecommendations(plan: WarRoomPlan): ConsultingRecommendation[] {
  const actionRecommendations = plan.department_actions.map((action, index): ConsultingRecommendation => ({
    id: `action:${action.id}`,
    source: "action",
    priority: action.priority,
    index,
    title: recommendationTitle(action, "咨询建议"),
    problem: cleanSentenceText(action.battle_goal, "当前问题需要进一步明确。"),
    conclusion: cleanSentenceText(action.action_detail || action.acceptance_rule, "建议先按保守路径推进，并在补齐数据后重新判断。"),
    externalData: evidenceForDepartment(plan, action.department),
    internalData: [
      ...action.metrics.map((metric) => cleanDisplayText(`${metric.name}：${metric.current ? `${metric.current} → ` : ""}${metric.target}`)),
      cleanDisplayText(action.acceptance_rule, "下次提交执行记录和指标变化。"),
      ...riskForDepartment(plan, action.department),
    ].filter(Boolean).slice(0, 4),
    dataGaps: action.required_data.length ? action.required_data : plan.data_gaps,
    action,
    confidence: action.confidence ?? plan.confidence,
  }));

  const actionTitles = new Set(actionRecommendations.map((item) => item.title));
  const decisionRecommendations = plan.decision_items
    .map((decision, index): ConsultingRecommendation => {
      const title = recommendationTitle(decision.title || decision.detail, "咨询建议");
      return {
        id: `decision:${index}`,
        source: "decision",
        priority: decision.urgency,
        index,
        title,
        problem: cleanSentenceText(decision.detail, "这个事项需要老板确认后才能继续推进。"),
        conclusion: cleanSentenceText(`建议确认：${title}`, "建议先明确是否采纳该事项。"),
        externalData: plan.evidence_summary.slice(0, 3),
        internalData: plan.risk_summary.slice(0, 3).map((item) => cleanSentenceText(item, "")),
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
  const base = sectionPath(projectId, "recommendations");
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
      const target = section === "review" ? "iterations" : "recommendations";
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
  feedbackEvents,
  onSubmitFeedback,
  activeSection,
  onNavigate,
}: {
  plan: WarRoomPlan;
  projectId: string;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  activeSection: WarRoomSection;
  onNavigate: (path: string) => void;
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
        section={activeSection}
        feedbackEvents={feedbackEvents}
        onSubmitFeedback={onSubmitFeedback}
        onNavigate={onNavigate}
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
  projectId,
  onNavigate,
}: {
  plan: WarRoomPlan;
  projectId: string;
  onNavigate: (path: string) => void;
}) {
  const recommendations = buildConsultingRecommendations(plan);
  const topRecommendation = recommendations[0];
  const versionNumber = plan.iteration_count ?? plan.iterations?.length ?? 1;
  const latestChange = plan.iterations?.[0]?.changes?.[0]
    ? cleanSentenceText(plan.iterations[0].changes[0], "本轮诊断已更新项目判断。")
    : "本轮诊断已更新项目判断。";
  const statusCards = [
    { icon: "●", label: "项目状态", value: "已生成作战室", detail: `当前第 ${versionNumber} 版` },
    { icon: "◆", label: "资料状态", value: plan.data_gaps.length ? `${plan.data_gaps.length} 项待补` : "资料可支撑本轮判断", detail: plan.data_gaps.length ? "建议先补齐再加码" : "可进入建议执行" },
    { icon: "▲", label: "咨询把握度", value: formatPercent(plan.confidence), detail: plan.confidence < 0.5 ? "把握不足，需补数据" : plan.confidence < 0.75 ? "中等把握，谨慎推进" : "把握较高，可按建议推进" },
    { icon: "■", label: "咨询建议", value: `${recommendations.length} 条`, detail: topRecommendation ? `优先看：${topRecommendation.title}` : "暂无建议" },
  ];

  return (
    <section className="boss-room" aria-label="作战室总览">
      <div className="boss-room__hero">
        <div className="boss-room__main">
          <span className="boss-room__eyebrow">项目总览</span>
          <h2>{topRecommendation?.title || compactTitle(plan.objective, "本轮项目判断已生成", 34)}</h2>
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

      <div className="boss-room__recommendations" aria-label="关键咨询建议">
        <div className="boss-room__section-head">
          <div>
            <span>关键咨询建议</span>
            <h3>优先处理这几件事</h3>
          </div>
          <button type="button" onClick={() => onNavigate(recommendationPath(projectId, firstRecommendationId(plan)))}>查看全部建议</button>
        </div>
        <div className="boss-room__flow">
          {recommendations.slice(0, 3).map((item, index) => (
            <RecommendationPreviewCard
              key={item.id}
              recommendation={item}
              index={index}
              onOpen={() => onNavigate(recommendationPath(projectId, item.id))}
            />
          ))}
          <article className="boss-room-card">
            <span>最新变化</span>
            <h3>第 {versionNumber} 版作战室</h3>
            <p>{latestChange}</p>
            <button type="button" onClick={() => onNavigate(sectionPath(projectId, "iterations"))}>看迭代历史</button>
          </article>
        </div>
      </div>
    </section>
  );
}

function RecommendationPreviewCard({
  recommendation,
  index,
  onOpen,
}: {
  recommendation: ConsultingRecommendation;
  index: number;
  onOpen: () => void;
}) {
  return (
    <article className={index === 0 ? "boss-room-card boss-room-card--lead" : "boss-room-card"}>
      <span>建议 {String(index + 1).padStart(2, "0")} · {consultingPriorityLabel(recommendation.priority)}</span>
      <h3>{recommendation.title}</h3>
      <p>{recommendation.problem}</p>
      <button type="button" onClick={onOpen}>查看建议</button>
    </article>
  );
}

function WarRoomSectionContent({
  plan,
  projectId,
  section,
  feedbackEvents,
  onSubmitFeedback,
  onNavigate,
}: {
  plan: WarRoomPlan;
  projectId: string;
  section: WarRoomSection;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  onNavigate: (path: string) => void;
}) {
  if (section === "overview") return <WarRoomOverview plan={plan} projectId={projectId} onNavigate={onNavigate} />;
  if (section === "recommendations") return (
    <ConsultingRecommendationsPanel
      projectId={projectId}
      plan={plan}
      feedbackEvents={feedbackEvents}
      onSubmitFeedback={onSubmitFeedback}
      onNavigate={onNavigate}
    />
  );
  return (
    <div className="war-room-detail-stack">
      <WarRoomIterations plan={plan} />
    </div>
  );
}

function ConsultingRecommendationsPanel({
  projectId,
  plan,
  feedbackEvents,
  onSubmitFeedback,
  onNavigate,
}: {
  projectId: string;
  plan: WarRoomPlan;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
  onNavigate: (path: string) => void;
}) {
  const recommendations = buildConsultingRecommendations(plan);
  const params = new URLSearchParams(window.location.search);
  const selectedId = params.get("recommendation") || recommendations[0]?.id || "";
  const selected = recommendations.find((item) => item.id === selectedId) ?? recommendations[0];
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
                    {items.map((item, index) => (
                      <button
                        type="button"
                        key={item.id}
                        className={item.id === selected.id ? "consulting-recommendation-tab is-active" : "consulting-recommendation-tab"}
                        onClick={() => onNavigate(recommendationPath(projectId, item.id))}
                      >
                        <small>{String(index + 1).padStart(2, "0")}</small>
                        <span>{item.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
      <RecommendationDetail
        projectId={projectId}
        plan={plan}
        recommendation={selected}
        feedbackEvents={feedbackEvents}
        onSubmitFeedback={onSubmitFeedback}
      />
    </section>
  );
}

function RecommendationDetail({
  projectId,
  plan,
  recommendation,
  feedbackEvents,
  onSubmitFeedback,
}: {
  projectId: string;
  plan: WarRoomPlan;
  recommendation: ConsultingRecommendation;
  feedbackEvents: WarRoomFeedbackEvent[];
  onSubmitFeedback: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const relatedFeedback = feedbackEvents
    .filter((event) => event.card_id === recommendation.id || event.card_title === recommendation.title)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const action = recommendation.action;

  return (
    <article className="recommendation-detail">
      <header className="recommendation-detail__hero">
        <div>
          <span className={priorityClass(recommendation.priority)}>{consultingPriorityLabel(recommendation.priority)}</span>
          <h2>{recommendation.title}</h2>
          <p>{recommendation.conclusion}</p>
        </div>
        <aside>
          <span>咨询把握度</span>
          <strong>{formatPercent(recommendation.confidence ?? plan.confidence)}</strong>
          <em>{recommendation.dataGaps.length ? "仍有数据待补" : "资料可支撑本轮判断"}</em>
        </aside>
      </header>

      <div className="recommendation-framework">
        <section className="recommendation-block recommendation-block--problem">
          <span>01</span>
          <h3>问题是什么？</h3>
          <p>{recommendation.problem}</p>
        </section>
        <section className="recommendation-block recommendation-block--conclusion">
          <span>02</span>
          <h3>结论是什么？</h3>
          <p>{recommendation.conclusion}</p>
        </section>
        <section className="recommendation-block">
          <span>03</span>
          <h3>外部数据与来源证明</h3>
          <EvidenceList items={recommendation.externalData} empty="当前缺少足够外部证据，建议补充行业、竞品、政策或公开评价数据。" />
        </section>
        <section className="recommendation-block">
          <span>04</span>
          <h3>内部数据与项目依据</h3>
          <EvidenceList items={recommendation.internalData} empty="当前缺少明确内部经营数据，建议先补齐业务口径。" />
        </section>
        <section className="recommendation-block recommendation-block--wide">
          <span>05</span>
          <h3>数据缺口与补充路径</h3>
          <InlineDataNeeds projectId={projectId} plan={plan} gaps={recommendation.dataGaps} />
        </section>
        <section className="recommendation-block recommendation-block--wide">
          <span>06</span>
          <h3>行动建议</h3>
          {action ? (
            <div className="recommendation-action">
              <div><span>具体动作</span><strong>{cleanSentenceText(action.action_title, "待明确具体动作。")}</strong></div>
              <div><span>负责人</span><strong>{action.owner_role || "待确认"}</strong></div>
              <div><span>启动窗口</span><strong>{action.start_window || "待确认"}</strong></div>
              <div><span>验收标准</span><strong>{cleanSentenceText(action.acceptance_rule, "下次提交执行记录和指标变化。")}</strong></div>
              {action.risk_note && <p>{cleanSentenceText(action.risk_note, "")}</p>}
            </div>
          ) : (
            <p>{cleanSentenceText(recommendation.decisionDetail, "建议先确认是否采纳该方向，再拆解负责人和时间表。")}</p>
          )}
        </section>
        <section className="recommendation-block recommendation-block--wide">
          <span>07</span>
          <h3>反馈进展与迭代数据</h3>
          <div className="recommendation-feedback">
            <button type="button" onClick={() => setFeedbackOpen(true)}>记录反馈进展</button>
            {relatedFeedback.length === 0 ? (
              <p>暂无反馈。执行后的真实变化会进入下一轮诊断迭代。</p>
            ) : (
              <ul>
                {relatedFeedback.map((event) => (
                  <li key={event.id}>
                    <strong>{feedbackStatusLabel(event.adoption_status)} · {feedbackResultLabel(event.feedback_result)}</strong>
                    <span>{new Date(event.created_at).toLocaleString("zh-CN")}</span>
                    {event.note && <p>{cleanSentenceText(event.note, "")}</p>}
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
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
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
  onClose,
  onSubmit,
}: {
  plan: WarRoomPlan;
  recommendation: ConsultingRecommendation;
  onClose: () => void;
  onSubmit: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
}) {
  const [adoption, setAdoption] = useState<WarRoomFeedbackCreate["adoption_status"]>("adopted");
  const [result, setResult] = useState<WarRoomFeedbackCreate["feedback_result"]>("effective");
  const [owner, setOwner] = useState(recommendation.action?.owner_role ?? "");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        attachments: [],
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
                <button type="button" onClick={() => void copyRequest(item)} disabled={busyKey === item.key}>
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
