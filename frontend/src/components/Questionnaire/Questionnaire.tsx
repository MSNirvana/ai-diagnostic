import { useEffect, useMemo, useRef, useState } from "react";
import { MODULES_AS_GENERATED } from "./modules";
import type {
  ModuleAnswer,
  GeneratedModule,
  ABQuestionnaire,
  ProblemSummary,
  ProblemMap,
  ChatMessage,
  UploadedFileOut,
} from "../../types";
import { generateABFromSummary, recordPreference, getSessionDetail, saveSessionDraft, uploadSessionFile, listSessionFiles, deleteSessionFile } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { saveDraft, loadDraft, clearDraft } from "../../utils/draft";
import type { DraftState } from "../../utils/draft";
import { StepIndicator } from "./StepIndicator";
import { ChatStep } from "./ChatStep";
import { ABChoicePage } from "./ABChoicePage";
import "./Questionnaire.css";

interface QuestionnaireProps {
  onSubmit: (
    answers: ModuleAnswer[],
    files: { moduleKey: string; fieldKey: string; file: File }[],
    sessionId?: string,
    projectId?: string,
    problemMap?: ProblemMap
  ) => void;
  projectId?: string;          // 当前所属项目（从项目页进入）
  resumeSessionId?: string;    // 续聊：要恢复的会话 id（从项目/历史页进入）
}

type Mode = "chatting" | "generating" | "ab_choice" | "ready";

export function Questionnaire({ onSubmit, projectId, resumeSessionId: resumeFromNav }: QuestionnaireProps) {
  const { token } = useAuth();
  const userId = token ? token.slice(0, 16) : "anon";

  const [mode, setMode] = useState<Mode>("chatting");
  const [activeModules, setActiveModules] = useState<GeneratedModule[]>([]);
  const [abOptions, setAbOptions] = useState<ABQuestionnaire | null>(null);
  const [storedSummary, setStoredSummary] = useState<ProblemSummary | null>(null);
  const [storedProblemMap, setStoredProblemMap] = useState<ProblemMap | null>(null);
  const [storedSessionId, setStoredSessionId] = useState<string | null>(null);

  const [current, setCurrent] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [facts, setFacts] = useState<Record<string, Record<string, string>>>({});
  const [pains, setPains] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<
    { moduleKey: string; fieldKey: string; file: File }[]
  >([]);
  const [restoredFileNames, setRestoredFileNames] = useState<Record<string, string[]>>({});
  // 已上传到后端的文件（跨设备复用，不用重传）
  const [storedFiles, setStoredFiles] = useState<UploadedFileOut[]>([]);
  const [uploadingFields, setUploadingFields] = useState<Record<string, boolean>>({});

  const [pendingDraft, setPendingDraft] = useState<DraftState | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [resumeMessages, setResumeMessages] = useState<ChatMessage[] | null>(null);
  // 续聊数据是否就绪：续聊场景下，加载完会话详情前不渲染 ChatStep（避免误建新会话）
  const [resumeReady, setResumeReady] = useState<boolean>(!resumeFromNav);

  // 续聊：从项目/历史页带 resumeSessionId 进来，加载会话详情后再渲染对话
  useEffect(() => {
    if (!resumeFromNav) return;
    setPendingDraft(null);
    getSessionDetail(resumeFromNav)
      .then((detail) => {
        setResumeSessionId(detail.id);
        setResumeMessages(detail.messages);
        setStoredSessionId(detail.id);
        // 拉该会话已上传的文件，跨设备复用、不用重传
        listSessionFiles(detail.id).then(setStoredFiles).catch(() => {});
        setChatMessages(detail.messages);
        setStoredProblemMap(detail.problem_map);
        // 有填写进度草稿 → 直接恢复到问卷填写阶段，不用重对话/重新生成问卷
        if (detail.draft_json) {
          try {
            const d = JSON.parse(detail.draft_json);
            if (d.activeModules?.length) {
              setActiveModules(d.activeModules);
              setCurrent(d.current ?? 0);
              setFacts(d.facts ?? {});
              setPains(d.pains ?? {});
              setFreeText(d.freeText ?? {});
              setRestoredFileNames(d.fileNames ?? {});
              if (d.chatSummary) setStoredSummary(d.chatSummary);
              setStoredProblemMap(d.problemMap ?? detail.problem_map);
              setMode("ready");
              setResumeReady(true);
              return;
            }
          } catch {
            // 草稿解析失败则退回对话
          }
        }
        setMode("chatting");
        setResumeReady(true);
      })
      .catch(() => {
        // 拉取失败则按新会话处理
        setResumeReady(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 挂载时读草稿（续聊场景不弹草稿）
  useEffect(() => {
    if (resumeFromNav) return;
    const draft = loadDraft(userId);
    if (draft && (draft.messages.length > 0 || draft.activeModules.length > 0)) {
      setPendingDraft(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防抖保存草稿（仅 chatting/ready 阶段）
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mode !== "chatting" && mode !== "ready") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const fileNames: Record<string, string[]> = {};
      for (const f of files) {
        const k = `${f.moduleKey}__${f.fieldKey}`;
        (fileNames[k] ??= []).push(f.file.name);
      }
      const snapshot = {
        mode,
        messages: chatMessages,
        chatSummary: storedSummary,
        problemMap: storedProblemMap,
        sessionId: storedSessionId,
        activeModules,
        current,
        facts,
        pains,
        freeText,
        fileNames,
      };
      // 本地兜底（离线也不丢）
      saveDraft(userId, snapshot);
      // 主存后端：进入填写阶段(ready)且有 sessionId 时，跨设备可恢复
      if (mode === "ready" && storedSessionId) {
        const draftJson = JSON.stringify({
          activeModules, current, facts, pains, freeText, fileNames,
          chatSummary: storedSummary,
          problemMap: storedProblemMap,
        });
        saveSessionDraft(storedSessionId, draftJson).catch(() => {});
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [mode, chatMessages, storedSummary, storedProblemMap, storedSessionId, activeModules, current, facts, pains, freeText, files, userId]);

  const resumeDraft = () => {
    const d = pendingDraft;
    if (!d) return;
    setMode(d.mode);
    setChatMessages(d.messages);
    setStoredSummary(d.chatSummary);
    setStoredProblemMap(d.problemMap ?? null);
    setStoredSessionId(d.sessionId ?? null);
    setActiveModules(d.activeModules);
    setCurrent(d.current);
    setFacts(d.facts);
    setPains(d.pains);
    setFreeText(d.freeText);
    setRestoredFileNames(d.fileNames ?? {});
    setPendingDraft(null);
  };

  const discardDraft = () => {
    clearDraft(userId);
    setPendingDraft(null);
  };

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

  const handleChatComplete = async (problemMap: ProblemMap, sessionId: string) => {
    setMode("generating");
    setStoredSessionId(sessionId);
    setStoredProblemMap(problemMap);
    // ProblemMap 投影成 ProblemSummary（后端忽略多余字段）
    const summary: ProblemSummary = {
      core_problem: problemMap.core_problem,
      context: problemMap.context,
      suspected_cause: problemMap.suspected_cause,
      tried: problemMap.tried,
      company_name: problemMap.company_name,
      industry: problemMap.industry,
      main_business: problemMap.main_business,
      business_model: problemMap.business_model,
      scale: problemMap.scale,
      stage: problemMap.stage,
    };
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

  const addFiles = async (modKey: string, fieldKey: string, list: FileList | null) => {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    // 有会话则即时上传到后端（跨设备复用）；否则退回内存暂存
    if (storedSessionId) {
      const fieldId = `${modKey}__${fieldKey}`;
      setUploadingFields((p) => ({ ...p, [fieldId]: true }));
      try {
        for (const file of arr) {
          const saved = await uploadSessionFile(storedSessionId, modKey, fieldKey, file);
          setStoredFiles((prev) => [...prev, saved]);
        }
      } catch {
        // 上传失败退回内存暂存，至少本次诊断能用
        setFiles((prev) => [...prev, ...arr.map((file) => ({ moduleKey: modKey, fieldKey, file }))]);
      } finally {
        setUploadingFields((p) => ({ ...p, [fieldId]: false }));
      }
    } else {
      setFiles((prev) => [...prev, ...arr.map((file) => ({ moduleKey: modKey, fieldKey, file }))]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeStoredFile = async (fileId: string) => {
    setStoredFiles((prev) => prev.filter((f) => f.id !== fileId));
    try {
      await deleteSessionFile(fileId);
    } catch {
      // 忽略：本地已移除
    }
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
    // 提交即视为完成，清掉草稿
    clearDraft(userId);
    onSubmit(
      answers,
      files,
      storedSessionId ?? undefined,
      projectId,
      storedProblemMap ?? undefined
    );
  };

  const resumeBanner = pendingDraft && (
    <div className="resume-banner">
      <span className="resume-banner__text">
        📋 检测到上次未完成的填写（保存于{" "}
        {new Date(pendingDraft.savedAt).toLocaleString("zh-CN", {
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        ）
      </span>
      <span className="resume-banner__actions">
        <button type="button" className="btn-primary resume-banner__btn" onClick={resumeDraft}>
          继续填写
        </button>
        <button type="button" className="btn-text" onClick={discardDraft}>
          重新开始
        </button>
      </span>
    </div>
  );

  if (mode === "chatting") {
    // 续聊场景：会话详情未加载完前，不渲染 ChatStep（避免它误建新会话）
    if (!resumeReady) {
      return (
        <div className="questionnaire">
          <div className="wizard-card">
            <p style={{ color: "var(--ink-soft)" }}>正在载入对话…</p>
          </div>
        </div>
      );
    }
    const sid = resumeSessionId ?? storedSessionId ?? undefined;
    const msgs =
      resumeMessages ?? (chatMessages.length > 0 ? chatMessages : undefined);
    return (
      <>
        {resumeBanner}
        <ChatStep
          key={sid ?? "new"}
          onComplete={handleChatComplete}
          resumeSessionId={sid}
          resumeMessages={msgs}
          projectId={projectId}
        />
      </>
    );
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
                  {uploadingFields[`${module.key}__${field.key}`] && (
                    <span className="field__file-uploading">上传中…</span>
                  )}
                  {/* 已上传到后端的文件（跨设备复用，可删） */}
                  {storedFiles
                    .filter((f) => f.module_key === module.key && f.field_key === field.key)
                    .map((f) => (
                      <span className="field__file-item" key={f.id}>
                        ✓ {f.original_name}
                        <button
                          type="button"
                          className="field__file-remove"
                          aria-label={`删除 ${f.original_name}`}
                          onClick={() => removeStoredFile(f.id)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  {/* 未登录/无会话时的内存暂存文件 */}
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
