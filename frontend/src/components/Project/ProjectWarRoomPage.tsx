import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProjectWarRoom } from "../../api/client";
import type { WarRoomPlan } from "../../types";
import { AppShell } from "../Layout/AppShell";
import { BattleChainPanel } from "../WarRoom/BattleChainPanel";
import { DecisionBoard } from "../WarRoom/DecisionBoard";
import { DepartmentActionGrid } from "../WarRoom/DepartmentActionGrid";
import { EvidenceRiskPanel } from "../WarRoom/EvidenceRiskPanel";
import { PriorityTimeline } from "../WarRoom/PriorityTimeline";
import { ReviewCadencePanel } from "../WarRoom/ReviewCadencePanel";
import { WarRoomHeader } from "../WarRoom/WarRoomHeader";
import { WarRoomIterations } from "../WarRoom/WarRoomPage";
import { battlefieldLabel, formatPercent } from "../WarRoom/warRoomViewModel";

type WarRoomSection = "decisions" | "actions" | "chain" | "evidence" | "review" | "iterations";

interface SectionConfig {
  key: WarRoomSection;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "decisions",
    eyebrow: "Decision",
    title: "老板决策区",
    description: "只放需要老板拍板的关键选择，避免经营会被细节淹没。",
    actionLabel: "进入拍板",
  },
  {
    key: "actions",
    eyebrow: "Execution",
    title: "部门动作卡",
    description: "把战略判断拆成负责人、启动窗口、验收标准和风险提示。",
    actionLabel: "分配执行",
  },
  {
    key: "chain",
    eyebrow: "Alignment",
    title: "跨部门联动链",
    description: "明确先后依赖，避免市场、销售、产品、交付各打各的。",
    actionLabel: "查看联动",
  },
  {
    key: "evidence",
    eyebrow: "Evidence",
    title: "证据与风险",
    description: "集中查看依据、风险前提和待补数据，让方案可追溯。",
    actionLabel: "核验证据",
  },
  {
    key: "review",
    eyebrow: "Review",
    title: "复盘追踪",
    description: "把 7 天、14 天、30 天要看的指标和动作提前定下来。",
    actionLabel: "安排复盘",
  },
  {
    key: "iterations",
    eyebrow: "History",
    title: "迭代轨迹",
    description: "查看历次诊断如何更新当前项目作战室，而不是覆盖旧判断。",
    actionLabel: "查看演进",
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

export function ProjectWarRoomPage() {
  const { projectId, section } = useParams<{ projectId: string; section?: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<WarRoomPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getProjectWarRoom(projectId)
      .then(setPlan)
      .catch((e) => setError(e instanceof Error ? e.message : "作战室加载失败"));
  }, [projectId]);

  const activeSection = isWarRoomSection(section) ? section : null;
  const activeConfig = activeSection ? SECTION_MAP.get(activeSection) : null;
  const description = activeConfig
    ? activeConfig.description
    : "一个项目维护一个当前作战室；每次诊断都会作为迭代进入项目战场、动作、证据与复盘节奏。";

  return (
    <AppShell
      eyebrow="Project War Room"
      title={activeConfig ? activeConfig.title : "项目作战室"}
      description={description}
      actions={
        projectId ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => navigate(`/projects/${projectId}`)}>
              返回项目工作台
            </button>
            {activeSection && (
              <button type="button" className="btn-ghost" onClick={() => navigate(`/projects/${projectId}/war-room`)}>
                回到作战室总览
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => navigate(`/projects/${projectId}/diagnose`)}>
              新增诊断迭代
            </button>
          </>
        ) : null
      }
    >
      {error && <p className="state-note state-note--error">{error}</p>}
      {!plan && !error && <p className="state-note">正在加载项目作战室…</p>}
      {plan && projectId && (
        <ProjectWarRoom
          plan={plan}
          projectId={projectId}
          activeSection={activeSection}
          onNavigate={(path) => navigate(path)}
        />
      )}
    </AppShell>
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

  return (
    <section className="war-room project-war-room" aria-label="项目作战室">
      <WarRoomHeader plan={plan} />
      <WarRoomOverview plan={plan} projectId={projectId} onNavigate={onNavigate} />
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
          <span>{item.title}</span>
          <strong>{actionCount(plan, item.key)}</strong>
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
  const firstDecision = plan.decision_items[0];
  const topAction = leadingAction(plan);
  const primary = battlefieldLabel(plan.primary_battlefield);
  const secondary = battlefieldLabel(plan.secondary_battlefield);

  return (
    <>
      <section className="war-room-overview" aria-label="经营会总览">
        <div className="war-room-overview__main">
          <span className="war-room-overview__kicker">经营会总览</span>
          <h3>先看当前战场，再进入对应功能区处理细节。</h3>
          <p>
            当前主战场是 {primary}
            {secondary !== "待判定" ? `，协同 ${secondary}` : ""}。本页只保留经营会开场需要的信息，
            具体拍板、执行、证据与复盘分别进入子模块。
          </p>
          <div className="war-room-overview__stats">
            <article>
              <span>置信度</span>
              <strong>{formatPercent(plan.confidence)}</strong>
            </article>
            <article>
              <span>诊断迭代</span>
              <strong>{plan.iteration_count ?? plan.iterations?.length ?? 1} 次</strong>
            </article>
            <article>
              <span>待补数据</span>
              <strong>{plan.data_gaps.length} 项</strong>
            </article>
          </div>
        </div>
        <aside className="war-room-overview__focus">
          <span>本次会议先处理</span>
          <h4>{firstDecision ? firstDecision.title.replace(/^拍板[:：]\s*/, "") : "暂无必须拍板事项"}</h4>
          <p>{firstDecision?.detail ?? "当前作战室没有生成必须由老板立即拍板的事项。"}</p>
          <button type="button" className="btn-primary" onClick={() => onNavigate(sectionPath(projectId, "decisions"))}>
            进入老板决策区
          </button>
        </aside>
      </section>

      <section className="war-room-module-grid" aria-label="作战室模块入口">
        {SECTIONS.map((item) => (
          <button
            type="button"
            key={item.key}
            className="war-room-module-card"
            onClick={() => onNavigate(sectionPath(projectId, item.key))}
          >
            <span>{item.eyebrow}</span>
            <strong>{item.title}</strong>
            <small>{moduleSummary(plan, item.key)}</small>
            <em>{item.actionLabel}</em>
          </button>
        ))}
      </section>

      {topAction && (
        <section className="war-room-next-action" aria-label="首要动作">
          <div>
            <span>首要执行动作</span>
            <h3>{topAction.action_title}</h3>
            <p>{topAction.battle_goal}</p>
          </div>
          <button type="button" className="btn-ghost" onClick={() => onNavigate(sectionPath(projectId, "actions"))}>
            查看部门动作卡
          </button>
        </section>
      )}
    </>
  );
}

function moduleSummary(plan: WarRoomPlan, key: WarRoomSection): string {
  const count = actionCount(plan, key);
  if (key === "evidence") {
    return `${plan.evidence_summary.length} 条依据 · ${plan.risk_summary.length} 个风险 · ${plan.data_gaps.length} 项待补`;
  }
  if (key === "iterations") {
    return `${count || 1} 次诊断沉淀为当前作战室`;
  }
  if (key === "review") {
    return `${count} 个复盘节点`;
  }
  return `${count} 项内容`;
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
