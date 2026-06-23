import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  ModuleAnswer,
  GeneratedModule,
  ProblemSummary,
  ProblemMap,
  ChatMessage,
  UploadedFileOut,
  DiagnosisDetail,
} from "../../types";
import { generateFromSummary, getSessionDetail, saveSessionDraft, uploadSessionFile, listSessionFiles, deleteSessionFile } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { saveDraft, loadDraft, clearDraft, clearLegacyDraft } from "../../utils/draft";
import type { DraftState } from "../../utils/draft";
import { StepIndicator } from "./StepIndicator";
import { ChatStep, type ProjectChatMode } from "./ChatStep";
import "./Questionnaire.css";

const MODULE_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "销售与增长",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
  legal_compliance: "法务合规",
  tax: "税务与财务合规",
  policy: "政策与监管",
  ip: "知识产权",
  supply_chain: "供应链",
  channel_franchise: "渠道与加盟",
  data_systems: "数据系统",
};

const uniqueByKey = <T extends { key: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
};

function problemSummaryFromRecord(record: DiagnosisDetail): ProblemSummary | null {
  const problemMap = record.answers.problem_map;
  if (!problemMap) return null;
  return {
    core_problem: problemMap.core_problem ?? "",
    context: problemMap.context ?? "",
    suspected_cause: problemMap.suspected_cause ?? "",
    tried: problemMap.tried ?? "",
    company_name: problemMap.company_name ?? "",
    industry: problemMap.industry ?? "",
    main_business: problemMap.main_business ?? "",
    business_model: problemMap.business_model ?? "",
    scale: problemMap.scale ?? "",
    stage: problemMap.stage ?? "",
  };
}

function factsFromRecord(record: DiagnosisDetail): Record<string, Record<string, string>> {
  return Object.fromEntries(
    record.answers.answers.map((answer) => [answer.module, { ...answer.facts }])
  );
}

function painsFromRecord(record: DiagnosisDetail): Record<string, string[]> {
  return Object.fromEntries(
    record.answers.answers.map((answer) => [answer.module, [...answer.pains]])
  );
}

function modulesFromRejectedRecord(record: DiagnosisDetail): GeneratedModule[] {
  const previousByModule = new Map(record.answers.answers.map((answer) => [answer.module, answer]));
  const requestModules = record.results
    .filter((result) => (result.data_requests ?? []).length > 0)
    .map((result) => result.module);
  const moduleKeys = Array.from(new Set([...requestModules, ...previousByModule.keys()]));

  if (moduleKeys.length === 0) {
    return [{
      key: "supplement",
      label: "补充材料",
      subtitle: "请按顾问意见补充说明、截图、表格或其他能支撑复审的材料。",
      fields: [{
        key: "supplement_note",
        label: "补充说明",
        placeholder: "例如：已补充近 30 天投放后台截图、渠道消耗、线索转化和合同材料。",
        hint: "如果没有明确字段，也可以先把材料变化说明清楚。",
        accept_file: true,
      }],
      pains: [],
      free_text_label: "还有哪些需要顾问复核的补充信息？",
    }];
  }

  return moduleKeys.map((moduleKey) => {
    const result = record.results.find((item) => item.module === moduleKey);
    const previous = previousByModule.get(moduleKey);
    const existingFields = Object.keys(previous?.facts ?? {}).map((key) => ({
      key,
      label: key,
      placeholder: "沿用上一轮已填信息，可在这里修正。",
      hint: "上一轮已提供，复审时可修正。",
      accept_file: false,
      prefilled_value: previous?.facts[key] ?? "",
      known_source: "上一轮诊断",
    }));
    const requestFields = (result?.data_requests ?? []).map((request) => ({
      key: request.key,
      label: request.label,
      placeholder: request.source_hint
        ? `请填写或上传：${request.source_hint}`
        : "请填写或上传对应补充材料。",
      hint: request.reason,
      accept_file: true,
      prefilled_value: previous?.facts[request.key] ?? null,
      known_source: previous?.facts[request.key] ? "上一轮诊断" : null,
    }));
    const fields = uniqueByKey([...requestFields, ...existingFields]);

    return {
      key: moduleKey,
      label: MODULE_LABELS[moduleKey] ?? moduleKey,
      subtitle: result?.conclusion
        ? `上一轮判断：${result.conclusion}`
        : "请补齐本模块复审所需的关键事实和证据材料。",
      fields: fields.length ? fields : [{
        key: `${moduleKey}_supplement_note`,
        label: "补充说明",
        placeholder: "请说明本次新增、修正或可供复核的材料。",
        hint: "用于顾问复审时快速定位变化。",
        accept_file: true,
      }],
      pains: previous?.pains ?? [],
      free_text_label: `补充说明：${MODULE_LABELS[moduleKey] ?? moduleKey} 本次新增了哪些材料或判断？`,
    };
  });
}

interface QuestionnaireProps {
  onSubmit: (
    answers: ModuleAnswer[],
    files: { moduleKey: string; fieldKey: string; file: File }[],
    sessionId?: string,
    projectId?: string,
    problemMap?: ProblemMap
  ) => void | Promise<void>;
  projectId?: string;          // 当前所属项目（从项目页进入）
  resumeSessionId?: string;    // 续聊：要恢复的会话 id（从项目/历史页进入）
  supplementRecord?: DiagnosisDetail | null; // 顾问打回后补充材料复审
  initialPrompt?: string;      // 从项目入口带入的待确认问题描述
  variant?: "default" | "project-inline";
  projectMode?: ProjectChatMode;
  onProjectModeChange?: (mode: ProjectChatMode) => void;
  inputNotice?: ReactNode;
  diagnosisPlanActive?: boolean;
  brainstormMessages?: ChatMessage[];
  brainstormDraft?: string;
  brainstormLoading?: boolean;
  brainstormError?: string | null;
  brainstormUseProjectContext?: boolean;
  onBrainstormDraftChange?: (value: string) => void;
  onBrainstormSend?: () => void;
  onBrainstormContextChange?: (enabled: boolean) => void;
  onProblemMapConfirmed?: (problemMap: ProblemMap, sessionId: string) => void | Promise<void>;
}

type Mode = "chatting" | "generating" | "ready" | "gen_error";

export function Questionnaire({
  onSubmit,
  projectId,
  resumeSessionId: resumeFromNav,
  supplementRecord,
  initialPrompt,
  variant = "default",
  projectMode,
  onProjectModeChange,
  inputNotice,
  diagnosisPlanActive,
  brainstormMessages,
  brainstormDraft,
  brainstormLoading,
  brainstormError,
  brainstormUseProjectContext,
  onBrainstormDraftChange,
  onBrainstormSend,
  onBrainstormContextChange,
  onProblemMapConfirmed,
}: QuestionnaireProps) {
  const { token } = useAuth();
  const userId = token ? token.slice(0, 16) : "anon";
  const isProjectInline = variant === "project-inline";

  const [mode, setMode] = useState<Mode>("chatting");
  const [activeModules, setActiveModules] = useState<GeneratedModule[]>([]);
  const [storedSummary, setStoredSummary] = useState<ProblemSummary | null>(null);
  const [storedProblemMap, setStoredProblemMap] = useState<ProblemMap | null>(null);
  const [storedSessionId, setStoredSessionId] = useState<string | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(true);

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
  const [genError, setGenError] = useState<string | null>(null);

  // 续聊：从项目/历史页带 resumeSessionId 进来，加载会话详情后再渲染对话
  useEffect(() => {
    if (!resumeFromNav) return;
    setPendingDraft(null);
    getSessionDetail(resumeFromNav)
      .then((detail) => {
        setResumeSessionId(detail.id);
        setResumeMessages(detail.messages);
        setStoredSessionId(detail.id);
        setMemoryEnabled(detail.memory_enabled ?? true);
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

  useEffect(() => {
    if (!supplementRecord) return;
    const modules = modulesFromRejectedRecord(supplementRecord);
    setPendingDraft(null);
    setResumeReady(true);
    setResumeSessionId(null);
    setResumeMessages(null);
    setStoredSessionId(null);
    setChatMessages([]);
    setStoredProblemMap(supplementRecord.answers.problem_map ?? null);
    setStoredSummary(problemSummaryFromRecord(supplementRecord));
    setActiveModules(modules);
    setCurrent(0);
    setFacts(factsFromRecord(supplementRecord));
    setPains(painsFromRecord(supplementRecord));
    setMode("ready");
  }, [supplementRecord]);

  // 挂载时读草稿（续聊场景不弹草稿）
  useEffect(() => {
    if (isProjectInline) return;
    if (resumeFromNav) return;
    clearLegacyDraft(userId);
    const draft = loadDraft(userId, projectId);
    if (draft && (draft.messages.length > 0 || draft.activeModules.length > 0)) {
      setPendingDraft(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectInline, resumeFromNav, userId, projectId]);

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
      saveDraft(userId, snapshot, projectId);
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
  }, [mode, chatMessages, storedSummary, storedProblemMap, storedSessionId, activeModules, current, facts, pains, freeText, files, userId, projectId]);

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
    clearDraft(userId, projectId);
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

  // 应用生成好的问卷模块，进入填写。二次诊断的 prefilled_value 注入 facts（不覆盖已填）。
  const applyModules = (modules: GeneratedModule[], enterReady = true) => {
    setActiveModules(modules);
    if (enterReady) setMode("ready");
    setCurrent(0);
    setFacts((prev) => {
      const next = { ...prev };
      for (const module of modules) {
        for (const field of module.fields) {
          if (field.prefilled_value && !(next[module.key]?.[field.key])) {
            next[module.key] = { ...(next[module.key] ?? {}), [field.key]: field.prefilled_value };
          }
        }
      }
      return next;
    });
  };

  const generateModules = async (
    summary: ProblemSummary,
    problemMap: ProblemMap,
  ): Promise<GeneratedModule[]> => {
    const generated = await generateFromSummary(summary, projectId, problemMap);
    return generated.modules;
  };

  const runGeneration = async (
    summary: ProblemSummary,
    problemMap: ProblemMap,
  ) => {
    setMode("generating");
    setGenError(null);
    try {
      // 单份动态问卷（后端已做质量把关，保证不比基础模板差）
      const modules = await generateModules(summary, problemMap);
      applyModules(modules);
    } catch (e) {
      // 不降级到固定问卷——固定模块让用户填无关字段、填了也白填。
      // 直接报错，保留对话会话，让用户可重试生成或返回继续聊。
      console.error("动态问卷生成失败：", e);
      setGenError(e instanceof Error ? e.message : String(e));
      setMode("gen_error");
    }
  };

  const handleChatComplete = async (problemMap: ProblemMap, sessionId: string) => {
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
    if (isProjectInline) {
      await (onProblemMapConfirmed
        ? onProblemMapConfirmed(problemMap, sessionId)
        : onSubmit([], [], sessionId, projectId, problemMap));
      return;
    }
    await runGeneration(summary, problemMap);
  };

  // 生成失败后：重试动态生成
  const retryGeneration = async () => {
    if (storedSummary && storedProblemMap) {
      await runGeneration(storedSummary, storedProblemMap);
    }
  };

  // 生成失败后：返回继续聊（保留会话，重新载入对话历史）
  const backToChat = async () => {
    setGenError(null);
    if (storedSessionId) {
      try {
        const detail = await getSessionDetail(storedSessionId);
        setResumeSessionId(storedSessionId);
        setResumeMessages(detail.messages);
        setResumeReady(true);
      } catch {
        // 拉取失败也让用户回到对话（用内存里的消息兜底）
        setResumeReady(true);
      }
    }
    setMode("chatting");
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

  const handleSubmit = async () => {
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
    clearDraft(userId, projectId);
    await onSubmit(
      answers,
      files,
      storedSessionId ?? undefined,
      projectId,
      storedProblemMap ?? undefined
    );
    if (isProjectInline) {
      setMode("chatting");
    }
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

  const supplementBanner = supplementRecord && (
    <section className="review-supplement-banner">
      <span>顾问打回补充</span>
      <h2>先补齐关键材料，再重新进入审核。</h2>
      <p>
        本次不是从零开始诊断。系统已带入上一轮问题地图和已填事实，请按顾问意见补充缺失证据。
      </p>
      {supplementRecord.consultant_notes?.length ? (
        <div className="review-supplement-banner__notes">
          <strong>顾问意见</strong>
          <ul>
            {supplementRecord.consultant_notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
    const sid = resumeSessionId ?? (isProjectInline ? undefined : storedSessionId ?? undefined);
    const chatStepKey = sid ?? (isProjectInline ? "project-inline-new" : "new");
    const msgs =
      resumeMessages ?? (chatMessages.length > 0 ? chatMessages : undefined);
    return (
      <>
        {supplementBanner}
        {!isProjectInline && resumeBanner}
        <ChatStep
          key={chatStepKey}
          onComplete={handleChatComplete}
          resumeSessionId={sid}
          resumeMessages={msgs}
          initialMemoryEnabled={memoryEnabled}
          projectId={projectId}
          initialPrompt={initialPrompt}
          variant={variant}
          projectMode={projectMode}
          onProjectModeChange={onProjectModeChange}
          inputNotice={inputNotice}
          diagnosisPlanActive={diagnosisPlanActive}
          initialProblemMap={storedProblemMap}
          onProblemMapChange={setStoredProblemMap}
          brainstormMessages={brainstormMessages}
          brainstormDraft={brainstormDraft}
          brainstormLoading={brainstormLoading}
          brainstormError={brainstormError}
          brainstormUseProjectContext={brainstormUseProjectContext}
          onBrainstormDraftChange={onBrainstormDraftChange}
          onBrainstormSend={onBrainstormSend}
          onBrainstormContextChange={onBrainstormContextChange}
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

  if (mode === "gen_error") {
    return (
      <div className="questionnaire">
        <div className="wizard-card gen-error-card">
          <h2 className="gen-error-card__title">问卷生成失败</h2>
          <p className="gen-error-card__msg">
            没能基于你的问题生成定制问卷，可能是模型暂时不可用或网络波动。
            你的对话记录已保留，可以直接重试，或返回继续补充对话再生成。
          </p>
          {genError && (
            <p className="gen-error-card__detail">原因：{genError}</p>
          )}
          <div className="gen-error-card__actions">
            <button type="button" className="btn-primary" onClick={() => void retryGeneration()}>
              重试生成
            </button>
            <button type="button" className="btn-text" onClick={() => void backToChat()}>
              返回继续聊
            </button>
          </div>
        </div>
      </div>
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
    <div className={variant === "project-inline" ? "questionnaire questionnaire--project-inline" : "questionnaire"}>
      {supplementBanner}
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
                {field.known_source && (
                  <span className="field__known">已知 · {field.known_source} · 可修正</span>
                )}
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
                onClick={() => void handleSubmit()}
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
