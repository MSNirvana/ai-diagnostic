import type { WarRoomPlan } from "../../types";
import { battlefieldLabel, formatPercent } from "./warRoomViewModel";

interface WarRoomHeaderProps {
  plan: WarRoomPlan;
}

export function WarRoomHeader({ plan }: WarRoomHeaderProps) {
  const hasDataGap = plan.data_gaps.length > 0;

  return (
    <div className="war-room__brief">
      <div className="war-room__brief-copy">
        <span className="war-room__eyebrow">老板作战室</span>
        <h2>{plan.summary}</h2>
        <p>{plan.objective}</p>
        {hasDataGap && <span className="war-room__conservative">保守版方案 · 待补关键数据</span>}
      </div>
      <div className="war-room__brief-metrics" aria-label="本期战场摘要">
        <div>
          <span>主战场</span>
          <strong>{battlefieldLabel(plan.primary_battlefield)}</strong>
        </div>
        <div>
          <span>次战场</span>
          <strong>{battlefieldLabel(plan.secondary_battlefield)}</strong>
        </div>
        <div>
          <span>置信度</span>
          <strong>{formatPercent(plan.confidence)}</strong>
        </div>
        <div>
          <span>方案版本</span>
          <strong>{plan.id}</strong>
        </div>
      </div>
    </div>
  );
}
