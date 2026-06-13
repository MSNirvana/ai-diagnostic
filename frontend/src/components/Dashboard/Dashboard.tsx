import type { ModuleResult, TriageSummary } from "../../types";
import { ModuleCard } from "../ModuleCard/ModuleCard";
import "./Dashboard.css";

interface DashboardProps {
  results: ModuleResult[];
  recordId?: string | null;
  skillVersionIds?: Record<string, string>;
  triage?: TriageSummary | null;
}

export function Dashboard({ results, recordId, skillVersionIds, triage }: DashboardProps) {
  const primaryLabel = triage?.selected_experts.find(
    (expert) => expert.module === triage.primary_module
  )?.label;

  return (
    <>
      {triage && triage.selected_experts.length > 0 && (
        <section className="triage-panel">
          <div className="triage-panel__intro">
            <span className="triage-panel__eyebrow">AI Consultant Router</span>
            <h2 className="triage-panel__title">多专家会诊路线</h2>
            <p className="triage-panel__primary">
              主诊专家：{primaryLabel ?? triage.primary_module ?? "待判定"}
            </p>
          </div>

          <div className="triage-panel__experts">
            {triage.selected_experts.map((expert) => (
              <article className="triage-expert" key={expert.module}>
                <span className="triage-expert__rank">P{expert.priority}</span>
                <h3>{expert.label}</h3>
                <p>{expert.reason}</p>
              </article>
            ))}
          </div>

          {(triage.conflicts.length > 0 || triage.dependencies.length > 0) && (
            <div className="triage-panel__signals">
              {triage.conflicts.length > 0 && (
                <div>
                  <h3>冲突识别</h3>
                  <ul>
                    {triage.conflicts.map((conflict, index) => (
                      <li key={`${conflict.modules.join("-")}-${index}`}>
                        {conflict.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {triage.dependencies.length > 0 && (
                <div>
                  <h3>依赖顺序</h3>
                  <ul>
                    {triage.dependencies.map((dependency) => (
                      <li key={dependency}>{dependency}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {triage.priority_actions.length > 0 && (
            <div className="triage-panel__actions">
              <span>优先动作</span>
              <ol>
                {triage.priority_actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      <div className="dashboard">
        {results.map((r) => (
          <ModuleCard
            key={r.module}
            result={r}
            recordId={recordId ?? undefined}
            skillVersionId={skillVersionIds?.[r.module]}
          />
        ))}
      </div>
    </>
  );
}
