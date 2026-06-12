import type { ProblemMap } from "../../types";
import "./ProblemMapPanel.css";

const FOCUS_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "营销与销售",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
};

const focusLabel = (key: string): string => FOCUS_LABELS[key] ?? key;

interface ProblemMapPanelProps {
  problemMap: ProblemMap | null;
  phase: "intake" | "confirm" | "done";
}

export function ProblemMapPanel({ problemMap, phase }: ProblemMapPanelProps) {
  return (
    <aside className={phase === "confirm" ? "map-panel map-panel--active" : "map-panel"}>
      <h3 className="map-panel__title">问题地图</h3>
      {!problemMap ? (
        <p className="map-panel__placeholder">
          对话进行中，问题地图会在这里逐步成形…
        </p>
      ) : (
        <div className="map-panel__body">
          <div className="map-panel__block">
            <span className="map-panel__label">核心问题</span>
            <p className="map-panel__core">{problemMap.core_problem || "—"}</p>
          </div>

          {problemMap.sub_problems.length > 0 && (
            <div className="map-panel__block">
              <span className="map-panel__label">相关联的问题</span>
              <ul className="map-panel__list">
                {problemMap.sub_problems.map((sp, i) => (
                  <li key={i}>{sp}</li>
                ))}
              </ul>
            </div>
          )}

          {problemMap.goal && (
            <div className="map-panel__block">
              <span className="map-panel__label">目的</span>
              <p>{problemMap.goal}</p>
            </div>
          )}
          {problemMap.constraints && (
            <div className="map-panel__block">
              <span className="map-panel__label">约束</span>
              <p>{problemMap.constraints}</p>
            </div>
          )}
          {problemMap.success_criteria && (
            <div className="map-panel__block">
              <span className="map-panel__label">成功标准</span>
              <p>{problemMap.success_criteria}</p>
            </div>
          )}
          {problemMap.diagnosis_focus && (
            <div className="map-panel__block">
              <span className="map-panel__label">建议优先诊断</span>
              <p className="map-panel__focus">{focusLabel(problemMap.diagnosis_focus)}</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
