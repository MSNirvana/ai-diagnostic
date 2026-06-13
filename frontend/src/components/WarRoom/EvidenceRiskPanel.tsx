import type { DataRequest } from "../../types";

interface EvidenceRiskPanelProps {
  evidence: string[];
  risks: string[];
  dataGaps: DataRequest[];
}

export function EvidenceRiskPanel({ evidence, risks, dataGaps }: EvidenceRiskPanelProps) {
  return (
    <section className="war-panel">
      <div className="war-panel__heading">
        <span>Evidence & Risk</span>
        <h3>证据与风险</h3>
      </div>
      <div className="evidence-grid">
        <div>
          <h4>已验证依据</h4>
          <ul>
            {evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>风险前提</h4>
          <ul>
            {risks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        {dataGaps.length > 0 && (
          <div className="data-gap-box">
            <h4>待补数据</h4>
            <div className="data-gap-list">
              {dataGaps.map((gap) => (
                <span className="data-gap-pill" key={gap.key}>
                  {gap.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
