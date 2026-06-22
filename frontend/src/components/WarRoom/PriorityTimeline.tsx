import type { PriorityBoard, WarRoomUrgency } from "../../types";
import { cleanDisplayText } from "../../utils/displayText";
import { PRIORITY_LABELS, priorityClass } from "./warRoomViewModel";

interface PriorityTimelineProps {
  board: PriorityBoard;
}

export function PriorityTimeline({ board }: PriorityTimelineProps) {
  return (
    <section className="war-panel">
      <div className="war-panel__heading">
        <span>Priority Timeline</span>
        <h3>优先级总表</h3>
      </div>
      <div className="priority-board">
        {(["now", "soon", "later"] as WarRoomUrgency[]).map((priority) => (
          <article className="priority-column" key={priority}>
            <span className={priorityClass(priority)}>{PRIORITY_LABELS[priority]}</span>
            <ul>
              {board[priority].map((item) => (
                <li key={`${priority}-${item}`}>{cleanDisplayText(item)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
