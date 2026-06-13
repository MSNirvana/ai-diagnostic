import type { DepartmentAction } from "../../types";
import { DepartmentActionCard } from "./DepartmentActionCard";

interface DepartmentActionGridProps {
  actions: DepartmentAction[];
}

export function DepartmentActionGrid({ actions }: DepartmentActionGridProps) {
  return (
    <section className="war-panel">
      <div className="war-panel__heading">
        <span>Department Actions</span>
        <h3>部门动作区</h3>
      </div>
      <div className="department-grid">
        {actions.map((action) => (
          <DepartmentActionCard action={action} key={action.id} />
        ))}
      </div>
    </section>
  );
}
