import { useState } from "react";
import type { GeneratedQuestionnaire, GeneratedModule } from "../../types";
import "./ABChoicePage.css";

interface ABChoicePageProps {
  optionA: GeneratedQuestionnaire;
  optionB: GeneratedQuestionnaire;
  onChoose: (chosen: "a" | "b", modules: GeneratedModule[]) => void;
}

type Choice = "a" | "b" | null;

const MAX_FIELDS_SHOWN = 6;

function countFields(q: GeneratedQuestionnaire): number {
  return q.modules.reduce((sum, m) => sum + m.fields.length, 0);
}

interface OptionCardProps {
  id: "a" | "b";
  badgeText: string;
  questionnaire: GeneratedQuestionnaire;
  selected: boolean;
  onSelect: () => void;
}

function OptionCard({ id, badgeText, questionnaire, selected, onSelect }: OptionCardProps) {
  const total = countFields(questionnaire);
  return (
    <button
      type="button"
      className={selected ? "ab-card ab-card--selected" : "ab-card"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="ab-card__head">
        <span className={`ab-badge ab-badge--${id}`}>{badgeText}</span>
        <span className="ab-card__count">共 {total} 个诊断字段</span>
      </div>
      <div className="ab-card__body">
        {questionnaire.modules.map((m) => {
          const labels = m.fields.map((f) => f.label);
          const shown = labels.slice(0, MAX_FIELDS_SHOWN);
          const extra = labels.length - shown.length;
          return (
            <div className="ab-module" key={m.key}>
              <h4 className="ab-module__title">{m.label}</h4>
              <div className="ab-module__fields">
                {shown.map((label, i) => (
                  <span className="ab-field-tag" key={`${m.key}-${i}`}>
                    {label}
                  </span>
                ))}
                {extra > 0 && (
                  <span className="ab-field-tag ab-field-tag--more">
                    等 {extra} 项
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

export function ABChoicePage({ optionA, optionB, onChoose }: ABChoicePageProps) {
  const [selected, setSelected] = useState<Choice>(null);

  const handleConfirm = () => {
    if (!selected) return;
    const modules =
      selected === "a" ? optionA.modules : optionB.modules;
    onChoose(selected, modules);
  };

  return (
    <div className="ab-choice">
      <header className="ab-choice__head">
        <h1 className="ab-choice__title">为你生成了两份诊断方案</h1>
        <p className="ab-choice__subtitle">
          选择更贴合你实际情况的一份，我们会记住你的偏好，让方案越来越准
        </p>
      </header>

      <div className="ab-grid">
        <OptionCard
          id="a"
          badgeText="方案 A · 全面覆盖"
          questionnaire={optionA}
          selected={selected === "a"}
          onSelect={() => setSelected("a")}
        />
        <OptionCard
          id="b"
          badgeText="方案 B · 痛点聚焦"
          questionnaire={optionB}
          selected={selected === "b"}
          onSelect={() => setSelected("b")}
        />
      </div>

      <div className="ab-choice__action">
        <button
          type="button"
          className="btn-primary btn-primary--final ab-confirm"
          disabled={selected === null}
          onClick={handleConfirm}
        >
          用这份方案开始填写
        </button>
      </div>
    </div>
  );
}
