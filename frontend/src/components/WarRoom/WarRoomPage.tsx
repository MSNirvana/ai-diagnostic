import type { WarRoomPlan } from "../../types";
import { DecisionBoard } from "./DecisionBoard";
import { DepartmentActionGrid } from "./DepartmentActionGrid";
import { EvidenceRiskPanel } from "./EvidenceRiskPanel";
import { PriorityTimeline } from "./PriorityTimeline";
import { WarRoomHeader } from "./WarRoomHeader";
import "./WarRoomPage.css";
import { cleanDisplayText } from "../../utils/displayText";

interface WarRoomPageProps {
  plan: WarRoomPlan;
  showIterations?: boolean;
}

export function WarRoomPage({ plan, showIterations = false }: WarRoomPageProps) {
  return (
    <section className="war-room" aria-label="老板作战室">
      <WarRoomHeader plan={plan} />

      <div className="war-room__top-grid">
        <DecisionBoard items={plan.decision_items} />
      </div>

      <DepartmentActionGrid actions={plan.department_actions} />
      <PriorityTimeline board={plan.priority_board} />

      <EvidenceRiskPanel
        evidence={plan.evidence_summary}
        risks={plan.risk_summary}
        dataGaps={plan.data_gaps}
      />

      {showIterations && <WarRoomIterations plan={plan} />}
    </section>
  );
}

export function WarRoomIterations({ plan }: { plan: WarRoomPlan }) {
  const iterations = [...(plan.iterations ?? [])].reverse();
  if (iterations.length === 0) return null;
  const totalVersions = plan.iteration_count ?? iterations.length;

  return (
    <section className="war-panel war-iterations" aria-label="历史版本">
      <div className="war-panel__heading">
        <div>
          <span>历史版本</span>
          <h3>历史版本</h3>
        </div>
        <strong>当前第 {totalVersions} 版</strong>
      </div>
      <div className="war-iteration-list">
        {iterations.map((item, index) => {
          const versionNumber = iterations.length - index;
          const isCurrent = versionNumber === totalVersions;
          return (
          <article
            key={item.record_id}
            className={isCurrent ? "war-iteration-card war-iteration-card--current" : "war-iteration-card"}
          >
            <div className="war-iteration-card__meta">
              <span>第 {versionNumber} 版{isCurrent ? " · 当前" : ""}</span>
              <time>{new Date(item.created_at).toLocaleString("zh-CN")}</time>
            </div>
            <h4>{cleanDisplayText(item.summary)}</h4>
            <p>{cleanDisplayText(item.objective)}</p>
            <ul>
              {(item.changes.length ? item.changes : ["本轮诊断补充了作战室依据"]).map((change) => (
                <li key={change}>{cleanDisplayText(change)}</li>
              ))}
            </ul>
          </article>
          );
        })}
      </div>
    </section>
  );
}
