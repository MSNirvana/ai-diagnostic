import type { ModuleResult } from "../../types";
import { ModuleCard } from "../ModuleCard/ModuleCard";
import "./Dashboard.css";

interface DashboardProps {
  results: ModuleResult[];
  recordId?: string | null;
  skillVersionIds?: Record<string, string>;
}

export function Dashboard({ results, recordId, skillVersionIds }: DashboardProps) {
  return (
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
  );
}
