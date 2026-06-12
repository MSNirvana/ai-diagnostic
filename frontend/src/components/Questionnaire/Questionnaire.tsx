import { useMemo, useState } from "react";
import { MODULES_AS_GENERATED } from "./modules";
import type {
  ModuleAnswer,
  GeneratedModule,
  ABQuestionnaire,
  ProblemSummary,
} from "../../types";
import { generateABFromSummary, recordPreference } from "../../api/client";
import { StepIndicator } from "./StepIndicator";
import { ChatStep } from "./ChatStep";
import { ABChoicePage } from "./ABChoicePage";
import "./Questionnaire.css";

interface QuestionnaireProps {
  onSubmit: (
    answers: ModuleAnswer[],
    files: { moduleKey: string; fieldKey: string; file: File }[]
  ) => void;
}

type Mode = "chatting" | "generating" | "ab_choice" | "ready";

export function Questionnaire({ onSubmit }: QuestionnaireProps) {
  const [mode, setMode] = useState<Mode>("chatting");
  const [activeModules, setActiveModules] = useState<GeneratedModule[]>([]);
  const [abOptions, setAbOptions] = useState<ABQuestionnaire | null>(null);
  const [storedSummary, setStoredSummary] = useState<ProblemSummary | null>(null);

  const [current, setCurrent] = useState(0);
  const [facts, setFacts] = useState<Record<string, Record<string, string>>>({});
  const [pains, setPains] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<
    { moduleKey: string; fieldKey: string; file: File }[]
  >([]);

  const moduleFilled = (key: string): boolean => {
    const f = facts[key] ?? {};
    const hasFacts = Object.values(f).some((v) => v.trim() !== "");
    const hasPains = (pains[key] ?? []).length > 0;
    const hasFree = (freeText[key] ?? "").trim() !== "";
    return hasFacts || hasPains || hasFree;
  };

  const filled = useMemo(
    () => activeModules.map((m) => moduleFilled(m.key)),
    [facts, pains, freeText, activeModules]
  );

  const anyFilled = filled.some(Boolean);

  const handleChatComplete = async (summary: ProblemSummary) => {
    setMode("generating");
    setStoredSummary(summary);
    try {
      const ab = await generateABFromSummary(summary);
      setAbOptions(ab);
      setMode("ab_choice");
    } catch {
      // 降级：使用通用固定问卷
      setActiveModules(MODULES_AS_GENERATED);
      setMode("ready");
      setCurrent(0);
    }
  };

  const handleChoose = (chosen: "a" | "b", modules: GeneratedModule[]) => {
    setActiveModules(modules);
    setMode("ready");
    setCurrent(0);
    if (abOptions && storedSummary) {
      const profileLike = {
        company_name: storedSummary.company_name,
        industry: storedSummary.industry,
        main_business: storedSummary.main_business,
        business_model: storedSummary.business_model,
        scale: storedSummary.scale,
        stage: storedSummary.stage,
      };
      recordPreference(
        profileLike,
        abOptions.option_a,
        abOptions.option_b,
        chosen
      ).catch(() => {});
    }
  };

  const setFact = (modKey: string, fieldKey: string, value: string) => {
    setFacts((prev) => ({
      ...prev,
      [modKey]: { ...(prev[modKey] ?? {}), [fieldKey]: value },
    }));
  };

  const togglePain = (modKey: string, pain: string) => {
    setPains((prev) => {
      const cur = prev[modKey] ?? [];
      return {
        ...prev,
        [modKey]: cur.includes(pain)
          ? cur.filter((p) => p !== pain)
          : [...cur, pain],
      };
    });
  };

  const addFiles = (modKey: string, fieldKey: string, list: FileList | null) => {
    if (!list) return;
    const added = Array.from(list).map((file) => ({
      moduleKey: modKey,
      fieldKey,
      file,
    }));
    setFiles((prev) => [...prev, ...added]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const answers: ModuleAnswer[] = [];
    for (const m of activeModules) {
      if (!moduleFilled(m.key)) continue;
      const rawFacts = facts[m.key] ?? {};
      const cleanFacts: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawFacts)) {
        if (v.trim() !== "") cleanFacts[k] = v.trim();
      }
      const free = (freeText[m.key] ?? "").trim();
      if (free !== "") cleanFacts["补充说明"] = free;
      answers.push({
        module: m.key,
        facts: cleanFacts,
        pains: pains[m.key] ?? [],
      });
    }
    onSubmit(answers, files);
  };

  if (mode === "chatting") {
    return <ChatStep onComplete={handleChatComplete} />;
  }

  if (mode === "generating") {
    return (
      <div className="questionnaire">
        <div className="wizard-card">
          <p style={{ color: "var(--ink-soft)" }}>
            正在基于你的问题定制诊断方案…
          </p>
        </div>
      </div>
    );
  }

  if (mode === "ab_choice" && abOptions) {
    return (
      <ABChoicePage
        optionA={abOptions.option_a}
        optionB={abOptions.option_b}
        onChoose={handleChoose}
      />
    );
  }

  const module = activeModules[current];
  const isLast = current === activeModules.length - 1;

  const goNext = () =>
    setCurrent((c) => Math.min(c + 1, activeModules.length - 1));
  const goPrev = () => setCurrent((c) => Math.max(c - 1, 0));

  const fieldFiles = (modKey: string, fieldKey: string) =>
    files
      .map((entry, index) => ({ ...entry, index }))
      .filter((e) => e.moduleKey === modKey && e.fieldKey === fieldKey);

  return (
    <div className="questionnaire">
      <StepIndicator
        steps={activeModules.map((m) => ({ label: m.label }))}
        current={current}
        filled={filled}
      />

      <section className="wizard-card">
        <header className="module-head">
          <h2 className="module-head__title">{module.label}</h2>
          <p className="module-head__subtitle">{module.subtitle}</p>
        </header>

        <div className="fields-grid">
          {module.fields.map((field) => (
            <div className="field" key={field.key}>
              <label className="field__label" htmlFor={`${module.key}-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`${module.key}-${field.key}`}
                className="field__input"
                type="text"
                placeholder={field.placeholder}
                value={facts[module.key]?.[field.key] ?? ""}
                onChange={(e) => setFact(module.key, field.key, e.target.value)}
              />
              {field.hint && <span className="field__hint">{field.hint}</span>}
              {field.accept_file && (
                <div className="field__file">
                  <label
                    className="field__file-label"
                    htmlFor={`${module.key}-${field.key}-file`}
                  >
                    + 附数据文件（CSV/Excel）
                  </label>
                  <input
                    id={`${module.key}-${field.key}-file`}
                    className="file-input"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    multiple
                    onChange={(e) => {
                      addFiles(module.key, field.key, e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {fieldFiles(module.key, field.key).map((entry) => (
                    <span className="field__file-item" key={entry.index}>
                      {entry.file.name}
                      <button
                        type="button"
                        className="field__file-remove"
                        aria-label={`删除 ${entry.file.name}`}
                        onClick={() => removeFile(entry.index)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="pains-section">
          <h3 className="section-title">你最有感触的问题（可多选）</h3>
          <div className="chip-row">
            {module.pains.map((p) => {
              const selected = (pains[module.key] ?? []).includes(p);
              return (
                <button
                  type="button"
                  key={p}
                  className={selected ? "chip chip--selected" : "chip"}
                  aria-pressed={selected}
                  onClick={() => togglePain(module.key, p)}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div className="free-section">
          <label className="section-title" htmlFor={`${module.key}-free`}>
            {module.free_text_label}
          </label>
          <textarea
            id={`${module.key}-free`}
            className="free-text"
            value={freeText[module.key] ?? ""}
            onChange={(e) =>
              setFreeText((prev) => ({ ...prev, [module.key]: e.target.value }))
            }
          />
        </div>

        <nav className="wizard-nav">
          <div className="wizard-nav__left">
            {current > 0 && (
              <button type="button" className="btn-ghost" onClick={goPrev}>
                上一步
              </button>
            )}
            {!isLast && (
              <button type="button" className="btn-text" onClick={goNext}>
                跳过此模块
              </button>
            )}
          </div>
          <div className="wizard-nav__right">
            {!isLast ? (
              <button type="button" className="btn-primary" onClick={goNext}>
                下一步
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary btn-primary--final"
                disabled={!anyFilled}
                onClick={handleSubmit}
              >
                开始诊断
              </button>
            )}
          </div>
        </nav>
      </section>
    </div>
  );
}
