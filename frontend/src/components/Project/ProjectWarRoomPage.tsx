import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getProject, getProjectWarRoom } from "../../api/client";
import type { ProjectDetail, ProjectSessionBrief, WarRoomPlan } from "../../types";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { BattleChainPanel } from "../WarRoom/BattleChainPanel";
import { DecisionBoard } from "../WarRoom/DecisionBoard";
import { DepartmentActionGrid } from "../WarRoom/DepartmentActionGrid";
import { EvidenceRiskPanel } from "../WarRoom/EvidenceRiskPanel";
import { PriorityTimeline } from "../WarRoom/PriorityTimeline";
import { ReviewCadencePanel } from "../WarRoom/ReviewCadencePanel";
import { WarRoomHeader } from "../WarRoom/WarRoomHeader";
import { WarRoomIterations } from "../WarRoom/WarRoomPage";
import { cleanDisplayText, cleanSentenceText, ensureChineseSentence } from "../../utils/displayText";

type WarRoomSection = "decisions" | "actions" | "chain" | "evidence" | "review" | "iterations";
type WarRoomBlockedState = "pending_review" | "rejected" | null;
type WarRoomProjectSnapshot = Pick<ProjectDetail, "id" | "name" | "status"> & {
  sessions?: ProjectSessionBrief[];
  delivery_status?: ProjectDetail["delivery_status"];
  records?: ProjectDetail["records"];
};

interface SectionConfig {
  key: WarRoomSection;
  eyebrow: string;
  title: string;
  description: string;
  navLabel: string;
  order: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "decisions",
    eyebrow: "Decision",
    title: "老板决策区",
    description: "只放需要老板拍板的关键选择，避免经营会被细节淹没。",
    navLabel: "拍板",
    order: "01",
  },
  {
    key: "actions",
    eyebrow: "Execution",
    title: "部门动作卡",
    description: "把战略判断拆成负责人、启动窗口、验收标准和风险提示。",
    navLabel: "动作",
    order: "02",
  },
  {
    key: "chain",
    eyebrow: "Alignment",
    title: "跨部门联动链",
    description: "明确先后依赖，避免市场、销售、产品、交付各打各的。",
    navLabel: "协同",
    order: "03",
  },
  {
    key: "evidence",
    eyebrow: "Evidence",
    title: "证据与风险",
    description: "集中查看依据、风险前提和待补数据，让方案可追溯。",
    navLabel: "证据",
    order: "04",
  },
  {
    key: "review",
    eyebrow: "Review",
    title: "复盘追踪",
    description: "把 7 天、14 天、30 天要看的指标和动作提前定下来。",
    navLabel: "复盘",
    order: "05",
  },
  {
    key: "iterations",
    eyebrow: "History",
    title: "迭代轨迹",
    description: "查看历次诊断如何更新当前项目作战室，而不是覆盖旧判断。",
    navLabel: "版本",
    order: "06",
  },
];

const SECTION_MAP = new Map(SECTIONS.map((section) => [section.key, section]));

function isWarRoomSection(value: string | undefined): value is WarRoomSection {
  return Boolean(value && SECTION_MAP.has(value as WarRoomSection));
}

function sectionPath(projectId: string, section: WarRoomSection) {
  return `/projects/${projectId}/war-room/view/${section}`;
}

function actionCount(plan: WarRoomPlan, key: WarRoomSection): number {
  if (key === "decisions") return plan.decision_items.length;
  if (key === "actions") return plan.department_actions.length;
  if (key === "chain") return plan.battle_chain.length;
  if (key === "evidence") return plan.evidence_summary.length + plan.risk_summary.length + plan.data_gaps.length;
  if (key === "review") return plan.checkpoints.length;
  return plan.iteration_count ?? plan.iterations?.length ?? 0;
}

function leadingAction(plan: WarRoomPlan) {
  return plan.department_actions.find((action) => action.priority === "now") ?? plan.department_actions[0];
}

function compactTitle(value: unknown, fallback: string, maxLength = 22): string {
  const text = cleanDisplayText(value, fallback)
    .replace(/^拍板[:：]\s*/, "")
    .replace(/[（(][^)）]{4,}[)）]/g, "")
    .replace(/(?:是否|需要|先|立即|尽快)\s*/g, "")
    .trim();
  const firstChunk = text.split(/[，。；]/)[0]?.trim() || "";
  if (!firstChunk) return fallback;
  return firstChunk.length > maxLength ? `${firstChunk.slice(0, maxLength)}...` : firstChunk;
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

  const activeSection = isWarRoomSection(section) ? section : null;
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
            {activeSection && (
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
            {!activeSection && (
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
  activeSection,
  onNavigate,
}: {
  plan: WarRoomPlan;
  projectId: string;
  activeSection: WarRoomSection | null;
  onNavigate: (path: string) => void;
}) {
  if (activeSection) {
    return (
      <section className="war-room project-war-room" aria-label="项目作战室">
        <WarRoomSubnav
          plan={plan}
          projectId={projectId}
          activeSection={activeSection}
          onNavigate={onNavigate}
        />
        <WarRoomSectionContent plan={plan} section={activeSection} />
      </section>
    );
  }

  const firstDecision = plan.decision_items[0];
  const decisionTitle = compactTitle(firstDecision?.title ?? firstDecision?.detail, "暂无必须拍板事项");
  const decisionLines = detailLines(
    firstDecision?.detail,
    "当前作战室没有生成必须由老板立即拍板的事项。"
  );

  return (
    <section className="war-room project-war-room" aria-label="项目作战室">
      <WarRoomHeader
        plan={plan}
        showActiveVersion
        meetingFocus={{
          title: decisionTitle,
          lines: decisionLines,
          ctaLabel: "查看拍板事项",
          onClick: () => onNavigate(sectionPath(projectId, "decisions")),
        }}
      />
      <WarRoomOverview plan={plan} />
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
          <strong>{actionCount(plan, item.key)}</strong>
        </button>
      ))}
    </nav>
  );
}

function WarRoomOverview({ plan }: { plan: WarRoomPlan }) {
  const topAction = leadingAction(plan);
  const firstGap = plan.data_gaps[0];
  const firstRisk = cleanSentenceText(plan.risk_summary[0], "当前没有暴露出必须立即上会处理的重大前提冲突。");
  const actionTitle = compactTitle(topAction?.action_title ?? topAction?.battle_goal, "待明确执行动作");
  const actionLines = [
    topAction
      ? `${topAction.owner_role} · ${topAction.start_window}`
      : "负责人待明确。",
    compactReason(topAction?.battle_goal, "待明确本动作要解决的问题"),
  ];
  const gapTitle = compactTitle(firstGap?.label ?? firstGap?.reason, "当前没有必须立即补齐的数据");
  const gapLines = [
    compactReason(firstGap?.reason, "当前判断可以先按现有依据推进"),
    ensureChineseSentence(firstGap?.typical_owner ? `通常由${firstGap.typical_owner}提供` : "顾问继续跟进"),
  ];
  const riskTitle = compactTitle(firstRisk, "暂无明显风险前提");
  const riskLines = [
    compactReason(firstRisk, "当前没有暴露出必须立即上会处理的重大前提冲突"),
    "判断失误会直接影响本轮动作是否继续加码。",
  ];

  return (
    <section className="war-room-priority-stack" aria-label="本轮重点">
      {topAction && (
        <article className="war-room-priority-card war-room-priority-card--lead">
          <span>先分给谁</span>
          <h3>{actionTitle}</h3>
          <ul className="war-room-point-list war-room-point-list--compact">
            {actionLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <strong>进入动作分配</strong>
        </article>
      )}
      <article className="war-room-priority-card">
        <span>先补哪项数据</span>
        <h3>{gapTitle}</h3>
        <ul className="war-room-point-list war-room-point-list--compact">
          {gapLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <strong>优先补齐再判断</strong>
      </article>
      <article className="war-room-priority-card">
        <span>先盯什么风险</span>
        <h3>{riskTitle}</h3>
        <ul className="war-room-point-list war-room-point-list--compact">
          {riskLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <strong>进入证据与风险核验</strong>
      </article>
    </section>
  );
}

function WarRoomSectionContent({ plan, section }: { plan: WarRoomPlan; section: WarRoomSection }) {
  if (section === "decisions") return <DecisionBoard items={plan.decision_items} />;
  if (section === "actions") {
    return (
      <>
        <DepartmentActionGrid actions={plan.department_actions} />
        <PriorityTimeline board={plan.priority_board} />
      </>
    );
  }
  if (section === "chain") return <BattleChainPanel chain={plan.battle_chain} />;
  if (section === "evidence") {
    return (
      <EvidenceRiskPanel
        evidence={plan.evidence_summary}
        risks={plan.risk_summary}
        dataGaps={plan.data_gaps}
      />
    );
  }
  if (section === "review") return <ReviewCadencePanel checkpoints={plan.checkpoints} />;
  return <WarRoomIterations plan={plan} />;
}
