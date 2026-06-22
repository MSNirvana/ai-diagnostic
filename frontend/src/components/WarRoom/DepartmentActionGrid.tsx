import { useState } from "react";
import type { DepartmentAction } from "../../types";
import { DepartmentActionCard } from "./DepartmentActionCard";
import { PRIORITY_LABELS, priorityClass } from "./warRoomViewModel";

interface DepartmentActionGridProps {
  actions: DepartmentAction[];
}

export function DepartmentActionGrid({ actions }: DepartmentActionGridProps) {
  const firstAvailable = (["now", "soon", "later"] as const).find((priority) =>
    actions.some((action) => action.priority === priority)
  ) ?? "now";
  const [activePriority, setActivePriority] = useState<DepartmentAction["priority"]>(firstAvailable);
  const grouped = {
    now: actions.filter((action) => action.priority === "now"),
    soon: actions.filter((action) => action.priority === "soon"),
    later: actions.filter((action) => action.priority === "later"),
  };
  const visibleActions = grouped[activePriority];

  return (
    <section className="war-panel">
      <div className="war-panel__heading">
        <div>
          <span>Department Actions</span>
          <h3>分配执行动作</h3>
        </div>
        <strong className="war-panel__count">{visibleActions.length}/{actions.length} 项</strong>
      </div>
      <div className="department-tabs" role="tablist" aria-label="按优先级筛选部门动作">
        {(["now", "soon", "later"] as const).map((priority) => (
          <button
            type="button"
            role="tab"
            key={priority}
            aria-selected={activePriority === priority}
            className={activePriority === priority ? "department-tab is-active" : "department-tab"}
            onClick={() => setActivePriority(priority)}
          >
            <span className={priorityClass(priority)}>{PRIORITY_LABELS[priority]}</span>
            <strong>{grouped[priority].length}</strong>
          </button>
        ))}
      </div>
      <p className="department-tab-copy">
        {activePriority === "now"
          ? "先看今天必须马上分配的动作。"
          : activePriority === "soon"
            ? "这里保留两周内要接上的动作。"
            : "这里保留月内排期，今天不用全部展开。"}
      </p>
      <div className="department-grid">
        {visibleActions.map((action) => (
          <DepartmentActionCard action={action} key={action.id} />
        ))}
      </div>
      {visibleActions.length === 0 && (
        <p className="department-empty">当前优先级下暂无动作。</p>
      )}
    </section>
  );
}
