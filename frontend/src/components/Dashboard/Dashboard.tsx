import type { ModuleResult } from "../../types";
import { ModuleCard } from "../ModuleCard/ModuleCard";
import "./Dashboard.css";

export function Dashboard({ results }: { results: ModuleResult[] }) {
  return (
    <div className="dashboard">
      {results.map((r) => <ModuleCard key={r.module} result={r} />)}
    </div>
  );
}
