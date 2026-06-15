import type { DepartmentAction } from "../../types";
import { formatPercent, PRIORITY_LABELS, priorityClass } from "./warRoomViewModel";

interface DepartmentActionCardProps {
  action: DepartmentAction;
}

function primaryMetric(action: DepartmentAction): string {
  const metric = action.metrics[0];
  if (metric) return `${metric.name}：${metric.target}`;
  return action.acceptance_rule;
}

export function DepartmentActionCard({ action }: DepartmentActionCardProps) {
  return (
    <article className="department-card">
      <div className="department-card__topline">
        <span>{action.department_label}</span>
        <span className={priorityClass(action.priority)}>{PRIORITY_LABELS[action.priority]}</span>
      </div>
      <h4>{action.action_title}</h4>
      <p className="department-card__goal">{action.battle_goal}</p>

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
            <p>{action.action_detail}</p>
          </section>
          <section>
            <span>验收标准</span>
            <p>{action.acceptance_rule}</p>
          </section>
          {action.metrics.length > 1 && (
            <section>
              <span>其他指标</span>
              <div className="metric-row metric-row--muted">
                {action.metrics.slice(1).map((metric) => (
                  <span key={`${action.id}-${metric.name}`}>
                    {metric.name}：{metric.target}
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
          {action.risk_note && (
            <section>
              <span>风险提示</span>
              <p className="department-card__risk">{action.risk_note}</p>
            </section>
          )}
          {action.confidence_reason && (
            <section>
              <span>置信度依据</span>
              <p>{action.confidence_reason}</p>
            </section>
          )}
        </div>
      </details>

      {typeof action.confidence === "number" && (
        <span className="department-card__confidence">证据置信度 {formatPercent(action.confidence)}</span>
      )}
    </article>
  );
}
