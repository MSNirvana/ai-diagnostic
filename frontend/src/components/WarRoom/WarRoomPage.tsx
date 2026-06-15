import type { WarRoomPlan } from "../../types";
import { BattleChainPanel } from "./BattleChainPanel";
import { DecisionBoard } from "./DecisionBoard";
import { DepartmentActionGrid } from "./DepartmentActionGrid";
import { EvidenceRiskPanel } from "./EvidenceRiskPanel";
import { PriorityTimeline } from "./PriorityTimeline";
import { ReviewCadencePanel } from "./ReviewCadencePanel";
import { WarRoomHeader } from "./WarRoomHeader";
import "./WarRoomPage.css";

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
        <BattleChainPanel chain={plan.battle_chain} />
      </div>

      <DepartmentActionGrid actions={plan.department_actions} />
      <PriorityTimeline board={plan.priority_board} />

      <div className="war-room__bottom-grid">
        <EvidenceRiskPanel
          evidence={plan.evidence_summary}
          risks={plan.risk_summary}
          dataGaps={plan.data_gaps}
        />
        <ReviewCadencePanel checkpoints={plan.checkpoints} />
      </div>

      {showIterations && <WarRoomIterations plan={plan} />}
    </section>
  );
}

export function WarRoomIterations({ plan }: { plan: WarRoomPlan }) {
  const iterations = [...(plan.iterations ?? [])].reverse();
  if (iterations.length === 0) return null;

  return (
    <section className="war-panel war-iterations" aria-label="作战室迭代轨迹">
      <div className="war-panel__heading">
        <div>
          <span>Iteration Trail</span>
          <h3>作战室迭代轨迹</h3>
        </div>
        <strong>{plan.iteration_count ?? iterations.length} 次诊断迭代</strong>
      </div>
      <div className="war-iteration-list">
        {iterations.map((item, index) => (
          <article key={item.record_id} className="war-iteration-card">
            <div className="war-iteration-card__meta">
              <span>第 {iterations.length - index} 轮</span>
              <time>{new Date(item.created_at).toLocaleString("zh-CN")}</time>
            </div>
            <h4>{item.summary}</h4>
            <p>{item.objective}</p>
            <ul>
              {(item.changes.length ? item.changes : ["本轮诊断补充了作战室依据"]).map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
