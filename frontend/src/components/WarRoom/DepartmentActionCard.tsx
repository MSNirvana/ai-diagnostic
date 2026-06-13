import type { DepartmentAction } from "../../types";
import { formatPercent, PRIORITY_LABELS, priorityClass } from "./warRoomViewModel";

interface DepartmentActionCardProps {
  action: DepartmentAction;
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
      <p>{action.action_detail}</p>
      <dl className="department-card__meta">
        <div>
          <dt>负责人</dt>
          <dd>{action.owner_role}</dd>
        </div>
        <div>
          <dt>启动窗口</dt>
          <dd>{action.start_window}</dd>
        </div>
        <div>
          <dt>验收标准</dt>
          <dd>{action.acceptance_rule}</dd>
        </div>
      </dl>
      {action.metrics.length > 0 && (
        <div className="metric-row">
          {action.metrics.map((metric) => (
            <span key={`${action.id}-${metric.name}`}>
              {metric.name}：{metric.target}
            </span>
          ))}
        </div>
      )}
      {action.required_data.length > 0 && (
        <div className="data-gap-list department-card__gaps">
          {action.required_data.map((gap) => (
            <span className="data-gap-pill" key={gap.key}>
              {gap.label}
            </span>
          ))}
        </div>
      )}
      {action.risk_note && <p className="department-card__risk">{action.risk_note}</p>}
      {typeof action.confidence === "number" && (
        <span className="department-card__confidence">证据置信度 {formatPercent(action.confidence)}</span>
      )}
    </article>
  );
}
