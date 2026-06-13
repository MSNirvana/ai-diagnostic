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
}

export function WarRoomPage({ plan }: WarRoomPageProps) {
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
    </section>
  );
}
