import type { DecisionItem } from "../../types";
import { priorityClass, URGENCY_LABELS } from "./warRoomViewModel";

interface DecisionBoardProps {
  items: DecisionItem[];
}

export function DecisionBoard({ items }: DecisionBoardProps) {
  return (
    <section className="war-panel war-panel--decision">
      <div className="war-panel__heading">
        <span>Decision Board</span>
        <h3>老板今天要拍板的事</h3>
      </div>
      <div className="decision-list">
        {items.map((item) => (
          <article className="decision-card" key={`${item.urgency}-${item.title}`}>
            <span className={priorityClass(item.urgency)}>{URGENCY_LABELS[item.urgency]}</span>
            <h4>{item.title}</h4>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
