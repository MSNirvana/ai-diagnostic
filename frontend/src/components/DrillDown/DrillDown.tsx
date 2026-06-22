import type { DrillDown as DD } from "../../types";
import { cleanDisplayText, cleanSentenceText } from "../../utils/displayText";
import "./DrillDown.css";

export function DrillDown({ data }: { data: DD }) {
  return (
    <div className="drilldown">
      <h4 className="drilldown__heading">数据依据</h4>
      <ul className="drilldown__list">
        {data.data_points.map((d, i) => (
          <li key={i}>{cleanSentenceText(d.text)}（{cleanDisplayText(d.source, "未注明来源")}）</li>
        ))}
      </ul>
      <h4 className="drilldown__heading">对比基准</h4>
      <ul className="drilldown__list">
        {data.comparisons.map((c, i) => <li key={i}>{cleanSentenceText(c)}</li>)}
      </ul>
    </div>
  );
}
