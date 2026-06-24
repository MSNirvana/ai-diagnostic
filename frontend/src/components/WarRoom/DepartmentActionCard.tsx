import type { DepartmentAction } from "../../types";
import { cleanDisplayText, cleanSentenceText } from "../../utils/displayText";
import { formatPercent, PRIORITY_LABELS, priorityClass } from "./warRoomViewModel";

interface DepartmentActionCardProps {
  action: DepartmentAction;
}

function primaryMetric(action: DepartmentAction): string {
  const metric = action.metrics[0];
  if (metric) return cleanDisplayText(`${metric.name}：${metric.target}`);
  return cleanDisplayText(action.acceptance_rule);
}

function plainConsultingText(value: string): string {
  return value.replace(/证据完整度/g, "把握度").replace(/低置信/g, "把握不足");
}

export function DepartmentActionCard({ action }: DepartmentActionCardProps) {
  const title = cleanDisplayText(action.action_title, "待明确执行动作。");
  const goal = cleanSentenceText(action.battle_goal, "待明确本动作要解决的问题。");
  const detail = cleanSentenceText(action.action_detail, "暂无更多执行说明。");
  const acceptance = cleanSentenceText(action.acceptance_rule, "下次复盘时提交执行记录和指标变化。");
  const risk = action.risk_note ? cleanSentenceText(action.risk_note, "") : "";
  const confidenceReason = action.confidence_reason ? plainConsultingText(cleanSentenceText(action.confidence_reason, "")) : "";

  return (
    <article className="department-card">
      <div className="department-card__topline">
        <span>{action.department_label}</span>
        <span className={priorityClass(action.priority)}>{PRIORITY_LABELS[action.priority]}</span>
      </div>
      <h4>{title}</h4>
      <p className="department-card__goal">{goal}</p>

      <dl className="department-card__meta department-card__meta--compact">
        <div>
          <dt>负责人</dt>
          <dd>{action.owner_role}</dd>
        </div>
        <div>
          <dt>启动窗口</dt>
          <dd>{action.start_window}</dd>
        </div>
      </dl>

      {action.metrics.length > 0 && (
        <div className="metric-row">
          <span>{primaryMetric(action)}</span>
        </div>
      )}

      <details className="war-detail department-card__detail">
        <summary>查看执行细节与风险</summary>
        <div className="department-card__detail-body">
          <section>
            <span>执行说明</span>
            <p>{detail}</p>
          </section>
          <section>
            <span>验收标准</span>
            <p>{acceptance}</p>
          </section>
          {action.metrics.length > 1 && (
            <section>
              <span>其他指标</span>
              <div className="metric-row metric-row--muted">
                {action.metrics.slice(1).map((metric) => (
                  <span key={`${action.id}-${metric.name}`}>
                    {cleanDisplayText(`${metric.name}：${metric.target}`)}
                  </span>
                ))}
              </div>
            </section>
          )}
          {action.required_data.length > 0 && (
            <section>
              <span>需要补齐的数据</span>
              <div className="data-gap-list department-card__gaps">
                {action.required_data.map((gap) => (
                  <span className="data-gap-pill" key={gap.key}>
                    {gap.label}
                  </span>
                ))}
              </div>
            </section>
          )}
          {risk && (
            <section>
              <span>风险提示</span>
              <p className="department-card__risk">{risk}</p>
            </section>
          )}
          {confidenceReason && (
            <section>
              <span>依据说明</span>
              <p>{confidenceReason}</p>
            </section>
          )}
        </div>
      </details>

      {typeof action.confidence === "number" && (
        <span className="department-card__confidence">把握度 {formatPercent(action.confidence)}</span>
      )}
    </article>
  );
}
