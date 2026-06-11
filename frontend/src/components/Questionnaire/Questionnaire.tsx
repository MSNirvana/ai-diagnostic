import { useMemo, useState } from "react";
import { MODULES_AS_GENERATED } from "./modules";
import type { ModuleAnswer, BusinessProfile, GeneratedModule } from "../../types";
import { generateQuestionnaire } from "../../api/client";
import { StepIndicator } from "./StepIndicator";
import { ProfileStep } from "./ProfileStep";
import "./Questionnaire.css";

interface QuestionnaireProps {
  onSubmit: (
    answers: ModuleAnswer[],
    files: { moduleKey: string; file: File }[]
  ) => void;
}

type Mode = "profile" | "generating" | "ready";

export function Questionnaire({ onSubmit }: QuestionnaireProps) {
  const [mode, setMode] = useState<Mode>("profile");
  const [activeModules, setActiveModules] = useState<GeneratedModule[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  const [current, setCurrent] = useState(0);
  const [facts, setFacts] = useState<Record<string, Record<string, string>>>({});
  const [pains, setPains] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<{ moduleKey: string; file: File }[]>([]);

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

  const handleGenerate = async (profile: BusinessProfile) => {
    setMode("generating");
    setGenError(null);
    try {
      const modules = await generateQuestionnaire(profile);
      setActiveModules(modules);
      setMode("ready");
      setCurrent(0);
    } catch {
      // 降级：使用通用固定问卷
      setActiveModules(MODULES_AS_GENERATED);
      setMode("ready");
      setCurrent(0);
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

  const addFiles = (modKey: string, list: FileList | null) => {
    if (!list) return;
    const added = Array.from(list).map((file) => ({ moduleKey: modKey, file }));
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

  if (mode === "profile" || mode === "generating") {
    return (
      <ProfileStep
        onGenerate={handleGenerate}
        generating={mode === "generating"}
        error={genError}
      />
    );
  }

  const module = activeModules[current];
  const isLast = current === activeModules.length - 1;
  const showFiles = module.fields.some((f) => f.accept_file);

  const goNext = () =>
    setCurrent((c) => Math.min(c + 1, activeModules.length - 1));
  const goPrev = () => setCurrent((c) => Math.max(c - 1, 0));

  const moduleFiles = files
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.moduleKey === module.key);

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

        {showFiles && (
          <div className="file-section">
            <label className="file-drop" htmlFor={`${module.key}-files`}>
              <span className="file-drop__title">上传相关数据文件</span>
              <span className="file-drop__hint">
                支持 CSV / Excel（.csv .xlsx .xls），可多选
              </span>
              <input
                id={`${module.key}-files`}
                className="file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                onChange={(e) => {
                  addFiles(module.key, e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {moduleFiles.length > 0 && (
              <ul className="file-list">
                {moduleFiles.map((entry) => (
                  <li className="file-item" key={entry.index}>
                    <span className="file-item__name">{entry.file.name}</span>
                    <button
                      type="button"
                      className="file-item__remove"
                      aria-label={`删除 ${entry.file.name}`}
                      onClick={() => removeFile(entry.index)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
