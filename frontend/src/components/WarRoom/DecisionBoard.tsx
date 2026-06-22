import type { DecisionItem } from "../../types";
import { cleanDisplayText, cleanSentenceText } from "../../utils/displayText";
import { priorityClass, URGENCY_LABELS } from "./warRoomViewModel";

interface DecisionBoardProps {
  items: DecisionItem[];
}

function decisionTitle(title: string): string {
  return cleanDisplayText(title.replace(/^拍板[:：]\s*/, "").trim(), "待确认事项");
}

function decisionPrompt(item: DecisionItem): string {
  const action = decisionTitle(item.title);
  let prompt = item.detail.trim();
  if (action) {
    prompt = prompt.replace(action, "该事项");
  }
  return cleanSentenceText(prompt.replace(/「该事项」/g, "该事项").replace(/\s+/g, " "));
}

export function DecisionBoard({ items }: DecisionBoardProps) {
  const urgentCount = items.filter((item) => item.urgency === "now").length;
  const displayCount = urgentCount || items.length;

  return (
    <section className="war-panel war-panel--decision">
      <div className="war-panel__heading">
        <div>
          <span>Decision Board</span>
          <h3>先拍板的事项</h3>
        </div>
        <strong className="war-panel__count">{displayCount} 项</strong>
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
