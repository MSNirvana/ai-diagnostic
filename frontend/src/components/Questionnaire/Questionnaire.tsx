import { useState } from "react";
import { MODULES } from "./modules";
import type { ModuleAnswer } from "../../types";
import "./Questionnaire.css";

export function Questionnaire({ onSubmit }: { onSubmit: (a: ModuleAnswer[]) => void }) {
  const [pains, setPains] = useState<Record<string, string[]>>({});

  const togglePain = (mod: string, pain: string) => {
    setPains((prev) => {
      const cur = prev[mod] ?? [];
      return { ...prev, [mod]: cur.includes(pain) ? cur.filter((p) => p !== pain) : [...cur, pain] };
    });
  };

  const submit = () => {
    const answers: ModuleAnswer[] = MODULES
      .filter((m) => (pains[m.key] ?? []).length > 0)
      .map((m) => ({ module: m.key, facts: {}, pains: pains[m.key] }));
    onSubmit(answers);
  };

  return (
    <div className="questionnaire">
      <p className="questionnaire__intro">
        勾选每个模块中你最有感触的问题，我们据此为你诊断。
      </p>
      {MODULES.map((m) => (
        <section key={m.key} className="module-block">
          <h3 className="module-block__title">{m.label}</h3>
          <div className="chip-row">
            {m.pains.map((p) => {
              const selected = (pains[m.key] ?? []).includes(p);
              return (
                <button
                  type="button"
                  key={p}
                  className={selected ? "chip chip--selected" : "chip"}
                  aria-pressed={selected}
                  onClick={() => togglePain(m.key, p)}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <button type="button" className="diagnose-btn" onClick={submit}>
        开始诊断
      </button>
    </div>
  );
}
