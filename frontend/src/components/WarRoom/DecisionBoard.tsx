import type { DecisionItem } from "../../types";
import { priorityClass, URGENCY_LABELS } from "./warRoomViewModel";

interface DecisionBoardProps {
  items: DecisionItem[];
}

function decisionTitle(title: string): string {
  return title.replace(/^拍板[:：]\s*/, "").trim();
}

function decisionPrompt(item: DecisionItem): string {
  const action = decisionTitle(item.title);
  let prompt = item.detail.trim();
  if (action) {
    prompt = prompt.replace(action, "该事项");
  }
  return prompt.replace(/「该事项」/g, "该事项").replace(/\s+/g, " ");
}

export function DecisionBoard({ items }: DecisionBoardProps) {
  const urgentCount = items.filter((item) => item.urgency === "now").length;

  return (
    <section className="war-panel war-panel--decision">
      <div className="war-panel__heading">
        <div>
          <span>Decision Board</span>
          <h3>老板今天要拍板的事</h3>
        </div>
        <strong className="war-panel__count">{urgentCount || items.length} 个重点</strong>
      </div>
      <div className="decision-list">
        {items.map((item, index) => (
          <article
            className={index === 0 ? "decision-card decision-card--lead" : "decision-card"}
            key={`${item.urgency}-${item.title}`}
          >
            <div className="decision-card__main">
              <span className={priorityClass(item.urgency)}>{URGENCY_LABELS[item.urgency]}</span>
              <h4 title={item.title}>{decisionTitle(item.title)}</h4>
              <p className="decision-card__brief">{decisionPrompt(item)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
