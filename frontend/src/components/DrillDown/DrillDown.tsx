import type { DrillDown as DD } from "../../types";
import "./DrillDown.css";

export function DrillDown({ data }: { data: DD }) {
  return (
    <div className="drilldown">
      <h4 className="drilldown__heading">数据依据</h4>
      <ul className="drilldown__list">
        {data.data_points.map((d, i) => <li key={i}>{d.text}（{d.source}）</li>)}
      </ul>
      <h4 className="drilldown__heading">对比基准</h4>
      <ul className="drilldown__list">
        {data.comparisons.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </div>
  );
}
