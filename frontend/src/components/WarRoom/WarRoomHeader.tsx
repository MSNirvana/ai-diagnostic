import type { WarRoomPlan } from "../../types";
import { battlefieldLabel, formatPercent } from "./warRoomViewModel";

interface WarRoomHeaderProps {
  plan: WarRoomPlan;
}

export function WarRoomHeader({ plan }: WarRoomHeaderProps) {
  const hasDataGap = plan.data_gaps.length > 0;
  const primary = battlefieldLabel(plan.primary_battlefield);
  const secondary = battlefieldLabel(plan.secondary_battlefield);
  const headline = secondary === "待判定"
    ? `未来 30 天主攻${primary}`
    : `未来 30 天主攻${primary}，协同${secondary}`;

  return (
    <div className="war-room__brief">
      <div className="war-room__brief-copy">
        <span className="war-room__eyebrow">老板作战室</span>
        <h2>{headline}</h2>
        <p className="war-room__objective">{plan.objective}</p>
        <div className="war-room__brief-summary">
          <span>本轮判断</span>
          <p>{plan.summary}</p>
        </div>
        {hasDataGap && <span className="war-room__conservative">保守版方案 · 待补关键数据</span>}
      </div>
      <div className="war-room__brief-metrics" aria-label="本期战场摘要">
        <div>
          <span>主战场</span>
          <strong>{primary}</strong>
        </div>
        <div>
          <span>次战场</span>
          <strong>{secondary}</strong>
        </div>
        <div>
          <span>置信度</span>
          <strong>{formatPercent(plan.confidence)}</strong>
        </div>
        <div>
          <span>迭代次数</span>
          <strong>{plan.iteration_count ? `${plan.iteration_count} 次` : plan.id}</strong>
        </div>
      </div>
    </div>
  );
}
