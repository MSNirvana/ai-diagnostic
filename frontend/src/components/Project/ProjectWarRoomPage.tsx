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

export function ProjectWarRoomPage() {
  const { projectId, section } = useParams<{ projectId: string; section?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as {
    projectSnapshot?: Pick<ProjectDetail, "id" | "name" | "status"> & { sessions?: ProjectSessionBrief[] };
  } | null) ?? {};
  const initialProject = navState.projectSnapshot && navState.projectSnapshot.id === projectId
    ? navState.projectSnapshot
    : null;
  const [project, setProject] = useState<(Pick<ProjectDetail, "id" | "name" | "status"> & { sessions?: ProjectSessionBrief[] }) | null>(initialProject);
  const [plan, setPlan] = useState<WarRoomPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "项目加载失败"));
    getProjectWarRoom(projectId)
      .then(setPlan)
      .catch((e) => setError(e instanceof Error ? e.message : "作战室加载失败"));
  }, [projectId]);

  const activeSection = isWarRoomSection(section) ? section : null;
  const activeConfig = activeSection ? SECTION_MAP.get(activeSection) : null;
  if (!projectId) {
    return <p className="state-note state-note--error">缺少项目 ID。</p>;
  }

  if (!project && error) {
    return <p className="state-note state-note--error">{error}</p>;
  }

  const shellProject = project ?? {
    id: projectId,
    name: "项目作战室",
    status: "active",
    sessions: [],
  };

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
                onClick={() => navigate(`/projects/${projectId}/diagnose`)}
              >
                新增诊断迭代
              </button>
            )}
          </div>
        </div>

        {error && <p className="state-note state-note--error">{error}</p>}
        {!plan && !error && <p className="state-note">正在加载项目作战室…</p>}
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
