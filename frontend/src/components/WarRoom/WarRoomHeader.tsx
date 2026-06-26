import type { WarRoomPlan } from "../../types";
import { cleanDisplayText, ensureChineseSentence } from "../../utils/displayText";
import { battlefieldLabel, formatPercent } from "./warRoomViewModel";

interface WarRoomHeaderProps {
  plan: WarRoomPlan;
  showActiveVersion?: boolean;
  meetingFocus?: {
    title: string;
    lines: string[];
    ctaLabel?: string;
    onClick?: () => void;
  };
}

export function WarRoomHeader({ plan, showActiveVersion = false, meetingFocus }: WarRoomHeaderProps) {
  const hasDataGap = plan.data_gaps.length > 0;
  const primary = battlefieldLabel(plan.primary_battlefield);
  const secondary = battlefieldLabel(plan.secondary_battlefield);
  const headline = buildHeadline(plan);
  const summaryPoints = buildSummaryPoints(plan, primary, secondary);
  const accumulationNote = cleanDisplayText(plan.accumulation_note, "");
  const confidenceTone = confidenceClass(plan.confidence);
  const versionNumber = plan.iteration_count ?? plan.iterations?.length ?? 1;
  const versionLabel = `V${versionNumber}`;

  return (
    <div className="war-room__brief">
      <div className="war-room__brief-copy">
        {showActiveVersion ? (
          <div className="war-room__title-row">
            <span className="war-room__eyebrow">老板作战室</span>
            <span className="war-room__active-version">当前生效版本 · {versionLabel}</span>
          </div>
        ) : (
            <span className="war-room__eyebrow">老板作战室</span>
        )}
        <h2>{headline}</h2>
        <p className="war-room__objective">{formatObjective(plan.objective)}</p>
        <div className="war-room__brief-summary">
          <span>顾问摘要</span>
          <div className="war-room__summary-points">
            {summaryPoints.map((item) => (
              <article className="war-room__summary-point" key={item.label}>
                <strong>{item.label}</strong>
                <p>{item.value}</p>
              </article>
            ))}
          </div>
        </div>
        {meetingFocus && (
          <div className="war-room__meeting-focus">
            <span>本次会议先处理</span>
            <h3>{meetingFocus.title}</h3>
            <ul className="war-room-point-list war-room-point-list--compact">
              {meetingFocus.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {meetingFocus.onClick && meetingFocus.ctaLabel && (
              <button type="button" className="btn-primary war-room__meeting-focus-action" onClick={meetingFocus.onClick}>
                {meetingFocus.ctaLabel}
              </button>
            )}
          </div>
        )}
        {accumulationNote && <span className="war-room__accumulation">累积诊断 · {accumulationNote}</span>}
        {hasDataGap && <span className="war-room__conservative">证据待补齐 · 暂不建议直接加码</span>}
      </div>
      <div className="war-room__brief-metrics" aria-label="本期战场摘要">
        <div>
          <span>牵头部门</span>
          <strong>{primary}</strong>
        </div>
        <div>
          <span>协同部门</span>
          <strong>{secondary}</strong>
        </div>
        <div>
          <span>证据完整度</span>
          <strong className={`war-room__confidence war-room__confidence--${confidenceTone}`}>
            {formatPercent(plan.confidence)}
            {plan.confidence < 0.5 ? <em>低置信 / 待验证</em> : null}
          </strong>
        </div>
        <div>
          <span>{showActiveVersion ? "当前生效版本" : "作战室版本"}</span>
          <strong>{versionLabel}</strong>
        </div>
      </div>
    </div>
  );
}

function confidenceClass(confidence: number): "low" | "medium" | "high" {
  if (confidence < 0.5) return "low";
  if (confidence < 0.75) return "medium";
  return "high";
}

function buildHeadline(plan: WarRoomPlan): string {
  const firstAction = plan.department_actions.find((action) => action.priority === "now")
    ?? plan.department_actions[0];
  const firstDecision = plan.decision_items[0]?.title.replace(/^拍板[:：]\s*/, "");
  const objective = cleanObjective(plan.objective);
  if (firstAction?.action_title) return compactHeadline(firstAction.action_title);
  if (firstDecision) return compactHeadline(firstDecision);
  if (objective && objective.length <= 34 && !looksLikeTemplateObjective(objective)) return objective;
  return "先把本轮最关键的经营动作定下来";
}

function cleanObjective(value: string): string {
  return (value || "")
    .replace(/^未来\s*30\s*天[内]?\s*/, "")
    .replace(/^30\s*天[内]?\s*/, "")
    .replace(/^改善[:：]\s*/, "")
    .trim();
}

function formatObjective(value: string): string {
  const objective = cleanObjective(value);
  if (!objective || looksLikeTemplateObjective(objective)) {
    return "这里只放已审核的判断、动作和复盘节点。";
  }
  return cleanDisplayText(`经营目标：${objective}`);
}

function looksLikeTemplateObjective(value: string): boolean {
  const compact = value.replace(/\s/g, "");
  return (
    compact.startsWith("未来30天优先打")
    || compact.startsWith("未来30天主攻")
    || compact.includes("主战场")
    || compact.includes("次战场")
    || (compact.includes("主攻") && compact.includes("协同"))
  );
}

function compactHeadline(value: string): string {
  const text = cleanDisplayText(value, "先把本轮最关键的经营动作定下来");
  const withoutHint = text
    .replace(/[（(][^)）]{6,}[)）]/g, "")
    .replace(/(?:，|。|；).*/g, "")
    .replace(/^先(?:补齐|补全|核验|确认)\s*/, "")
    .trim();
  if (withoutHint && withoutHint.length <= 24) return ensureChineseSentence(withoutHint).replace(/。$/, "");
  const firstChunk = text.split(/[，。；]/)[0]?.trim();
  if (firstChunk) return firstChunk.length > 24 ? `${firstChunk.slice(0, 24)}...` : firstChunk;
  return "先把本轮最关键的经营动作定下来";
}

function buildSummaryPoints(plan: WarRoomPlan, primary: string, secondary: string) {
  const firstAction = plan.department_actions.find((action) => action.priority === "now")
    ?? plan.department_actions[0];
  const firstGap = plan.data_gaps[0];
  const firstRisk = cleanDisplayText(plan.risk_summary[0], "");
  const summary = cleanDisplayText(plan.summary, "");
  const lead = !summary || looksLikeTemplateObjective(summary)
    ? ensureChineseSentence(`本轮先由${primary}牵头${secondary !== "待判定" ? `，${secondary}协同支持` : ""}`)
    : ensureChineseSentence(summary);

  return [
    {
      label: "当前判断",
      value: lead,
    },
    {
      label: "先做什么",
      value: firstAction
        ? ensureChineseSentence(cleanDisplayText(firstAction.battle_goal || firstAction.action_title, "先把关键动作落到负责人"))
        : "先把关键动作落到负责人。",
    },
    {
      label: hasGap(plan)
        ? "先补什么"
        : "当前边界",
      value: hasGap(plan)
        ? ensureChineseSentence(`${cleanDisplayText(firstGap?.label, "关键数据待补齐")}，补齐前先按保守方案推进`)
        : ensureChineseSentence(firstRisk || "当前没有明显前提冲突，可以按复盘节点继续推进"),
    },
  ];
}

function hasGap(plan: WarRoomPlan): boolean {
  return plan.data_gaps.length > 0;
}
