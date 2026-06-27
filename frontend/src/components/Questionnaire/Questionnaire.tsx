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
  onBeforeSend?: (text: string) => boolean | Promise<boolean>;
  autoSendInitialPrompt?: boolean;
  onProblemMapChange?: (problemMap: ProblemMap | null) => void;
  onSessionStarted?: (sessionId: string, firstMessage?: string) => void;
  onModeChange?: (mode: Mode) => void;
  openDataCollectionRequestId?: number;
  rediagnoseRequestId?: number;
  onRediagnoseBlocked?: (reason: string) => void;
}

type Mode = "chatting" | "generating" | "ready" | "gen_error";
type InlinePlanStatus = "idle" | "generating" | "ready" | "error";

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
  onBeforeSend,
  autoSendInitialPrompt = false,
  onProblemMapChange,
  onSessionStarted,
  onModeChange,
  openDataCollectionRequestId = 0,
  rediagnoseRequestId = 0,
  onRediagnoseBlocked,
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
  const [inlinePlanStatus, setInlinePlanStatus] = useState<InlinePlanStatus>("idle");
  const [inlinePlanError, setInlinePlanError] = useState<string | null>(null);
  const inlinePlanSeq = useRef(0);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);
  const lastRediagnoseRequestRef = useRef(0);
  const lastOpenDataCollectionRequestRef = useRef(0);

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
        onProblemMapChange?.(detail.problem_map);
        // 已进入后台定制/尽调的会话再次打开时应回到对话页；
        // 资料采集草稿只服务于未提交诊断的中途流程，避免页面切换后误回到表单。
        if (detail.diagnosis_record_id || diagnosisPlanActive) {
          setMode("chatting");
          setResumeReady(true);
          return;
        }
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
              onProblemMapChange?.(d.problemMap ?? detail.problem_map);
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
    onProblemMapChange?.(supplementRecord.answers.problem_map ?? null);
    setStoredSummary(problemSummaryFromRecord(supplementRecord));
    setActiveModules(modules);
    setCurrent(0);
    setFacts(factsFromRecord(supplementRecord));
    setPains(painsFromRecord(supplementRecord));
    setMode("ready");
  }, [onProblemMapChange, supplementRecord]);

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

  useEffect(() => {
    if (!isProjectInline || !diagnosisPlanActive || mode !== "ready") return;
    if (lastOpenDataCollectionRequestRef.current > 0) return;
    setMode("chatting");
  }, [diagnosisPlanActive, isProjectInline, mode]);

  const resumeDraft = () => {
    const d = pendingDraft;
    if (!d) return;
    setMode(d.mode);
    setChatMessages(d.messages);
    setStoredSummary(d.chatSummary);
    setStoredProblemMap(d.problemMap ?? null);
    onProblemMapChange?.(d.problemMap ?? null);
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

  const runInlinePlanGeneration = async (
    summary: ProblemSummary,
    problemMap: ProblemMap,
    sessionId: string,
  ) => {
    const seq = inlinePlanSeq.current + 1;
    inlinePlanSeq.current = seq;
    setInlinePlanStatus("generating");
    setInlinePlanError(null);
    try {
      const modules = await generateModules(summary, problemMap);
      if (inlinePlanSeq.current !== seq) return;
      applyModules(modules, false);
      await saveSessionDraft(sessionId, JSON.stringify({
        activeModules: modules,
        current: 0,
        facts,
        pains,
        freeText,
        fileNames: {},
        chatSummary: summary,
        problemMap,
      })).catch(() => {});
      setInlinePlanStatus("ready");
    } catch (e) {
      if (inlinePlanSeq.current !== seq) return;
      console.error("项目诊断方案生成失败：", e);
      setInlinePlanError(e instanceof Error ? e.message : String(e));
      setInlinePlanStatus("error");
    }
  };

  const handleChatComplete = async (problemMap: ProblemMap, sessionId: string) => {
    setStoredSessionId(sessionId);
    setStoredProblemMap(problemMap);
    onProblemMapChange?.(problemMap);
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
      // 诊断前置：对话产出问题地图后【直接起诊断】（空 answers，后端按问题地图 + 外部搜索起步），
      // 不再前置问卷表单——缺的关键内部数据等诊断出来后，在结果里「提交关键信息」定向补刀再复诊。
      await onSubmit([], [], sessionId, projectId, problemMap);
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

  const retryInlinePlanGeneration = async () => {
    if (storedSummary && storedProblemMap && storedSessionId) {
      await runInlinePlanGeneration(storedSummary, storedProblemMap, storedSessionId);
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

  // 「暂时没有」跳过：让没资料的字段也能明确标记并往下走，不必盯着空框（纯前端体感，提交时空值本就被丢弃）。
  const [skippedKeys, setSkippedKeys] = useState<string[]>([]);
  const skipId = (modKey: string, fieldKey: string) => `${modKey}__${fieldKey}`;
  const isSkipped = (modKey: string, fieldKey: string) => skippedKeys.includes(skipId(modKey, fieldKey));
  const toggleSkip = (modKey: string, fieldKey: string) => {
    const id = skipId(modKey, fieldKey);
    setSkippedKeys((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setFacts((prev) => ({ ...prev, [modKey]: { ...(prev[modKey] ?? {}), [fieldKey]: "" } }));
  };

  const setFact = (modKey: string, fieldKey: string, value: string) => {
    setFacts((prev) => ({
      ...prev,
      [modKey]: { ...(prev[modKey] ?? {}), [fieldKey]: value },
    }));
    if (value.trim()) {
      // 用户开始填 → 自动取消「暂时没有」标记
      setSkippedKeys((prev) => prev.filter((x) => x !== skipId(modKey, fieldKey)));
    }
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
    const fileNames: Record<string, string[]> = {};
    for (const f of files) {
      const k = `${f.moduleKey}__${f.fieldKey}`;
      (fileNames[k] ??= []).push(f.file.name);
    }
    if (isProjectInline && storedSessionId) {
      await saveSessionDraft(storedSessionId, JSON.stringify({
        activeModules,
        current,
        facts,
        pains,
        freeText,
        fileNames,
        chatSummary: storedSummary,
        problemMap: storedProblemMap,
      })).catch(() => {});
    }
    // 独立问卷提交即完成；项目内诊断要保留采集表，便于审核中查看进度/复诊复用。
    if (!isProjectInline) clearDraft(userId, projectId);
    await onSubmit(
      answers,
      files,
      storedSessionId ?? undefined,
      projectId,
      storedProblemMap ?? undefined
    );
    if (isProjectInline) {
      setInlinePlanStatus("idle");
      setInlinePlanError(null);
      setMode("chatting");
    }
  };

  useEffect(() => {
    if (!isProjectInline || rediagnoseRequestId <= 0) return;
    if (lastRediagnoseRequestRef.current === rediagnoseRequestId) return;
    lastRediagnoseRequestRef.current = rediagnoseRequestId;
    if (!storedProblemMap || !storedSessionId) {
      onRediagnoseBlocked?.("请先继续对话更新问题地图，再重新诊断。");
      return;
    }
    if (activeModules.length === 0) {
      onRediagnoseBlocked?.("请先补齐关键数据后，再重新诊断。");
      return;
    }
    if (!anyFilled && storedFiles.length === 0) {
      onRediagnoseBlocked?.("当前还没有可复用的数据，请先补充关键数据。");
      return;
    }
    void handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rediagnoseRequestId]);

  useEffect(() => {
    if (!isProjectInline || openDataCollectionRequestId <= 0) return;
    if (lastOpenDataCollectionRequestRef.current === openDataCollectionRequestId) return;
    lastOpenDataCollectionRequestRef.current = openDataCollectionRequestId;
    if (activeModules.length > 0) {
      setMode("ready");
      return;
    }
    const sessionId = storedSessionId ?? resumeSessionId ?? resumeFromNav;
    if (sessionId) {
      void getSessionDetail(sessionId).then((detail) => {
        if (!detail.draft_json) return;
        const d = JSON.parse(detail.draft_json);
        if (!d.activeModules?.length) return;
        setActiveModules(d.activeModules);
        setCurrent(d.current ?? 0);
        setFacts(d.facts ?? {});
        setPains(d.pains ?? {});
        setFreeText(d.freeText ?? {});
        setRestoredFileNames(d.fileNames ?? {});
        if (d.chatSummary) setStoredSummary(d.chatSummary);
        setStoredProblemMap(d.problemMap ?? detail.problem_map);
        onProblemMapChange?.(d.problemMap ?? detail.problem_map);
        setMode("ready");
      }).catch(() => {});
      return;
    }
    if (storedSummary && storedProblemMap && storedSessionId) {
      void runInlinePlanGeneration(storedSummary, storedProblemMap, storedSessionId).then(() => {
        setMode("ready");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDataCollectionRequestId]);

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

  const inlinePlanNotice = isProjectInline && inlinePlanStatus !== "idle" ? (
    <div className={
      inlinePlanStatus === "ready"
        ? "inline-plan-notice inline-plan-notice--ready"
        : inlinePlanStatus === "error"
          ? "inline-plan-notice inline-plan-notice--error"
          : "inline-plan-notice"
    }>
      <div>
        <strong>
          {inlinePlanStatus === "ready"
            ? "诊断方案已定制完成，请先补充关键数据。"
            : inlinePlanStatus === "error"
              ? "诊断方案生成失败，请稍后重试。"
              : "正在基于你的问题定制诊断方案…（这需要几分钟）"}
        </strong>
        <span>
          {inlinePlanStatus === "ready"
            ? "补齐关键数据后，系统才会启动后端深度尽调。"
            : inlinePlanStatus === "error"
              ? inlinePlanError || "你的对话和问题地图已保留，可以继续补充或重试生成。"
              : "你可以继续对话，系统会根据最新问题地图更新采集表。"}
        </span>
      </div>
      {inlinePlanStatus === "ready" && (
        <button type="button" onClick={() => setMode("ready")}>
          补充数据
        </button>
      )}
      {inlinePlanStatus === "error" && (
        <button type="button" onClick={() => void retryInlinePlanGeneration()}>
          重试生成
        </button>
      )}
    </div>
  ) : null;

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
          inputNotice={inlinePlanNotice ?? inputNotice}
          diagnosisPlanActive={diagnosisPlanActive || inlinePlanStatus !== "idle"}
          initialProblemMap={storedProblemMap}
          onProblemMapChange={(problemMap) => {
            setStoredProblemMap(problemMap);
            onProblemMapChange?.(problemMap);
          }}
          onSessionStarted={onSessionStarted}
          brainstormMessages={brainstormMessages}
          brainstormDraft={brainstormDraft}
          brainstormLoading={brainstormLoading}
          brainstormError={brainstormError}
          brainstormUseProjectContext={brainstormUseProjectContext}
          onBrainstormDraftChange={onBrainstormDraftChange}
          onBrainstormSend={onBrainstormSend}
          onBrainstormContextChange={onBrainstormContextChange}
          onBeforeSend={onBeforeSend}
          autoSendInitialPrompt={autoSendInitialPrompt}
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
  const rootClassName = variant === "project-inline"
    ? "questionnaire questionnaire--project-inline questionnaire--project-inline-form"
    : "questionnaire";

  const goNext = () =>
    setCurrent((c) => Math.min(c + 1, activeModules.length - 1));
  const goPrev = () => setCurrent((c) => Math.max(c - 1, 0));

  const fieldFiles = (modKey: string, fieldKey: string) =>
    files
      .map((entry, index) => ({ ...entry, index }))
      .filter((e) => e.moduleKey === modKey && e.fieldKey === fieldKey);

  return (
    <div className={rootClassName}>
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
          {module.fields.map((field, index) => (
            <div className="field" key={field.key}>
              <span className="field__index">{String(index + 1).padStart(2, "0")}</span>
              <div className="field__body">
                <label className="field__label" htmlFor={`${module.key}-${field.key}`}>
                  {field.label}
                  {field.known_source && (
                    <span className="field__known">已知 · {field.known_source} · 可修正</span>
                  )}
                </label>
                <div className={field.accept_file ? "field__input-wrap field__input-wrap--with-upload" : "field__input-wrap"}>
                  <input
                    id={`${module.key}-${field.key}`}
                    className={isSkipped(module.key, field.key) ? "field__input field__input--skipped" : "field__input"}
                    type="text"
                    placeholder={isSkipped(module.key, field.key) ? "已标记：暂时没有（可点右侧撤销）" : field.placeholder}
                    value={facts[module.key]?.[field.key] ?? ""}
                    onChange={(e) => setFact(module.key, field.key, e.target.value)}
                    disabled={isSkipped(module.key, field.key)}
                  />
                  <button
                    type="button"
                    className={isSkipped(module.key, field.key) ? "field__skip field__skip--on" : "field__skip"}
                    onClick={() => toggleSkip(module.key, field.key)}
                    title="暂时拿不到这个数据？点一下跳过，诊断照常进行，之后补了还能更新"
                  >
                    {isSkipped(module.key, field.key) ? "已跳过·撤销" : "暂时没有"}
                  </button>
                  {field.accept_file && (
                    <label
                      className="field__upload-plus"
                      htmlFor={`${module.key}-${field.key}-file`}
                      title="上传文件"
                      aria-label={`为${field.label}上传文件`}
                    >
                      +
                    </label>
                  )}
                </div>
                {field.accept_file && (
                  <div className="field__file">
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
                      <span className="field__file-uploading">上传中</span>
                    )}
                    {/* 已上传到后端的文件（跨设备复用，可删） */}
                    {storedFiles
                      .filter((f) => f.module_key === module.key && f.field_key === field.key)
                      .map((f) => (
                        <span className="field__file-item" key={f.id}>
                          {f.original_name}
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
            </div>
          ))}
        </div>

        <div className="pains-section">
          <h3 className="section-title">你最有感触的问题（可多选）</h3>
          <div className="choice-list">
            {module.pains.map((p, index) => {
              const selected = (pains[module.key] ?? []).includes(p);
              const optionLabel = String.fromCharCode(65 + index);
              return (
                <button
                  type="button"
                  key={p}
                  className={selected ? "choice-option choice-option--selected" : "choice-option"}
                  aria-pressed={selected}
                  onClick={() => togglePain(module.key, p)}
                >
                  <span className="choice-option__letter">{optionLabel}</span>
                  <span className="choice-option__text">{p}</span>
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
                onClick={() => void handleSubmit()}
              >
                {anyFilled ? "开始诊断" : "资料不全，先出初步诊断"}
              </button>
            )}
          </div>
        </nav>
      </section>
    </div>
  );
}
