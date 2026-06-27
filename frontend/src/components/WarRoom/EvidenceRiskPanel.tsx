import { useState } from "react";
import type { DataRequest } from "../../types";
import { cleanDisplayList, cleanSentenceText } from "../../utils/displayText";

interface EvidenceRiskPanelProps {
  evidence: string[];
  risks: string[];
  dataGaps: DataRequest[];
}

function buildOwnerAsk(gap: DataRequest): string {
  const lines = [`【数据补充请求】麻烦帮忙提供：${gap.label}`];
  if (gap.reason) lines.push(`用途：${gap.reason}`);
  if (gap.source_hint) lines.push(`从哪取：${gap.source_hint}`);
  return lines.join("\n");
}

function DataGapItem({ gap }: { gap: DataRequest }) {
  const [copied, setCopied] = useState(false);
  const owner = gap.typical_owner;

  const copyAsk = async () => {
    try {
      await navigator.clipboard.writeText(buildOwnerAsk(gap));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  return (
    <div className="data-gap-item">
      <div className="data-gap-item__main">
        <span className="data-gap-item__label">{gap.label}</span>
        {owner && <span className="data-gap-item__owner">通常由 {owner} 提供</span>}
      </div>
      <button
        type="button"
        className={copied ? "data-gap-item__copy is-copied" : "data-gap-item__copy"}
        onClick={copyAsk}
      >
        <span aria-hidden="true">{copied ? "✓" : "↗"}</span>
        {copied ? "已复制" : "复制补资料链接"}
      </button>
    </div>
  );
}

export function EvidenceRiskPanel({ evidence, risks, dataGaps }: EvidenceRiskPanelProps) {
  const safeEvidence = cleanDisplayList(evidence, "当前还没有足够的可验证依据。").map((item) =>
    cleanSentenceText(item, "当前还没有足够的可验证依据。")
  );
  const safeRisks = cleanDisplayList(risks, "暂未发现重大冲突，但仍需按复盘节点校验。").map((item) =>
    cleanSentenceText(item, "暂未发现重大冲突，但仍需按复盘节点校验。")
  );

  return (
    <section className="war-panel">
      <div className="war-panel__heading">
        <span>证据与风险</span>
        <h3>校验证据与风险</h3>
      </div>
      <div className="evidence-grid">
        <div>
          <h4>已验证依据</h4>
          <ul>
            {safeEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>风险前提</h4>
          <ul>
            {safeRisks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        {dataGaps.length > 0 && (
          <div className="data-gap-box">
            <h4>待补数据</h4>
            <p className="data-gap-box__hint">
              点「复制请求」，直接转给对应负责人。
            </p>
            <div className="data-gap-list">
              {dataGaps.map((gap) => (
                <DataGapItem key={gap.key} gap={gap} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
