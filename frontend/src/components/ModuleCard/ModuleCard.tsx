import { useState } from "react";
import type { ModuleResult } from "../../types";
import { DrillDown } from "../DrillDown/DrillDown";
import "./ModuleCard.css";

const SIGNAL_LABEL: Record<string, string> = { red: "需关注", yellow: "观察", green: "健康" };

export function ModuleCard({ result }: { result: ModuleResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="module-card">
      <div className={`signal signal--${result.signal}`}>
        <span className="signal__dot" />
        <span className="signal__label">{SIGNAL_LABEL[result.signal]}</span>
        <span className="module-card__name">{result.module}</span>
      </div>
      <p className="module-card__conclusion">{result.conclusion}</p>
      <ul className="module-card__evidence">
        {result.evidence.map((e, i) => <li key={i}>{e.text}</li>)}
      </ul>
      <div className="module-card__actions">
        <span className="module-card__actions-label">建议</span>
        <ul>{result.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </div>
      {result.drilldown && (
        <>
          <button type="button" className="more-btn" onClick={() => setOpen(!open)}>
            {open ? "收起" : "查看更多"}
          </button>
          {open && <DrillDown data={result.drilldown} />}
        </>
      )}
    </div>
  );
}
