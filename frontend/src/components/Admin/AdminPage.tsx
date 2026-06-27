import { useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listSkillRegistry,
  listSkillVersions,
  addSkillVersion,
  activateSkillVersion,
  listLLMConfigs,
  createLLMConfig,
  deleteLLMConfig,
  patchLLMConfig,
  probeLLMConfig,
  fetchL2Stats,
  fetchL4Stats,
  fetchReviewQueue,
  fetchReviewDetail,
  submitReview,
  fetchCaseProductGroups,
  fetchCaseProjectDetail,
  fetchCaseInsights,
} from "../../api/client";
import type {
  SkillRegistryItem,
  SkillVersionOut,
  LLMConfigOut,
  L2Stats,
  L4Stats,
  ReviewQueueItem,
  ReviewDetail,
  ModuleResult,
  ResearchEvidenceOut,
  CaseProductGroups,
  CaseProjectDetail,
  CaseInsights,
  CaseDistItem,
  CaseProjectFilters,
} from "../../types";
import { cleanDisplayText, cleanSentenceText, dataRequirementLabel, displayModuleLabel, formatEvidenceSource } from "../../utils/displayText";
import { AppShell } from "../Layout/AppShell";
import { EvidencePackPanel } from "../Evidence/EvidencePackPanel";
import "./AdminPage.css";

type Tab = "skills" | "models" | "review" | "cases" | "health";

type SkillGroupKey = "intake" | "questionnaire" | "engine" | "core" | "professional" | "capability" | "delivery" | "assistant" | "other";
type SkillFilterKey = SkillGroupKey | "all";

// 按诊断流水线顺序分组：客户进入 → 数据采集 → 诊断引擎(脑子) → 诊断域(核心/专业/能力) → 证据交付；头脑风暴为辅助。
const SKILL_GROUPS: Array<{
  key: SkillGroupKey;
  title: string;
  shortTitle: string;
}> = [
  { key: "intake", title: "① 客户进入与问题地图", shortTitle: "进入" },
  { key: "questionnaire", title: "② 数据采集与诊断问卷", shortTitle: "采集" },
  { key: "engine", title: "③ 诊断引擎（调度脑子 + 方法脑子）", shortTitle: "引擎" },
  { key: "core", title: "④ 诊断域 · 核心经营", shortTitle: "经营" },
  { key: "professional", title: "④ 诊断域 · 专业风险", shortTitle: "专业" },
  { key: "capability", title: "④ 诊断域 · 诊断能力", shortTitle: "能力" },
  { key: "delivery", title: "⑤ 证据与交付", shortTitle: "交付" },
  { key: "assistant", title: "辅助 · 头脑风暴", shortTitle: "脑暴" },
  { key: "other", title: "其他方法", shortTitle: "其他" },
];
const SKILL_GROUP_ORDER = SKILL_GROUPS.reduce<Record<SkillGroupKey, number>>((acc, group, index) => {
  acc[group.key] = index;
  return acc;
}, { intake: 0, questionnaire: 0, engine: 0, core: 0, professional: 0, capability: 0, delivery: 0, assistant: 0, other: 0 });

const SKILL_CATEGORY_ORDER: Record<string, number> = {
  intake: 10,
  questionnaire: 20,
  system: 30,
  core: 40,
  professional: 50,
  capability: 60,
  delivery: 70,
  assistant: 80,
  industry: 85,
  other: 90,
};

function normalizeGroup(category: string, skillType?: string): SkillGroupKey {
  if (skillType === "assistant" || category === "assistant") return "assistant";
  if (skillType === "conversation" || category === "intake") return "intake";
  if (skillType === "questionnaire" || category === "questionnaire") return "questionnaire";
  if (skillType === "method" || category === "system") return "engine";   // 诊断引擎（调度脑子 + 方法脑子）
  if (category === "core") return "core";
  if (category === "professional") return "professional";
  if (category === "capability") return "capability";                     // 诊断能力域
  if (skillType === "delivery" || category === "delivery") return "delivery";
  if (skillType === "diagnosis") return "core";                           // 兜底：未归类的诊断域
  return "other";
}

export function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("skills");

  return (
    <AppShell
      eyebrow="运营后台"
      title="后台管理"
      description="维护专家方法库、模型通道与版本留痕，让前台交付稳定、可追溯、可持续优化。"
      actions={
        <button type="button" className="btn-ghost" onClick={() => navigate("/projects")}>
          返回项目组合
        </button>
      }
    >
      <section className="admin-shell">
        <div className="admin-tabs" aria-label="后台模块切换">
          <button type="button" className={tab === "review" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("review")}>审核队列</button>
          <button type="button" className={tab === "skills" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("skills")}>专家方法库</button>
          <button type="button" className={tab === "models" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("models")}>模型通道</button>
          <button type="button" className={tab === "cases" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("cases")}>案例库</button>
          <span className="admin-tab-divider" />
          <button type="button" className={tab === "health" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("health")}>系统健康</button>
        </div>

        {tab === "review" && <ReviewTab />}
        {tab === "skills" && <SkillsTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "cases" && <CaseLibraryTab />}
        {tab === "health" && <SystemHealthTab />}
      </section>
    </AppShell>
  );
}

function SkillsTab() {
  const [skills, setSkills] = useState<SkillRegistryItem[] | null>(null);
  const [versions, setVersions] = useState<SkillVersionOut[] | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<SkillFilterKey>("all");
  const [query, setQuery] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selectSkill = async (skill: SkillRegistryItem) => {
    setActiveModule(skill.key);
    // 诊断域编辑的是「卡片数据」(JSON)：有激活版本用它，否则用文件默认 card_json；其它 skill 编辑 prompt。
    setEditPrompt(
      skill.active_version?.system_prompt
      ?? (skill.skill_type === "diagnosis" ? skill.card_json : skill.fallback_prompt)
      ?? ""
    );
    setReason("");
    setMsg(null);
    setVersions(null);
    try {
      setVersions(await listSkillVersions(skill.key));
    } catch (e) {
      setVersions([]);
      setMsg(e instanceof Error ? e.message : "版本历史加载失败");
    }
  };

  const load = async (preferredModule?: string | null) => {
    setRegistryError(null);
    try {
      const nextSkills = await listSkillRegistry();
      setSkills(nextSkills);
      const nextActive =
        nextSkills.find((skill) => skill.key === preferredModule)
        ?? nextSkills[0]
        ?? null;
      if (nextActive) {
        await selectSkill(nextActive);
      } else {
        setActiveModule(null);
        setVersions([]);
      }
    } catch (e) {
      setSkills([]);
      setVersions([]);
      setActiveModule(null);
      setRegistryError(e instanceof Error ? e.message : "Skill 网络加载失败");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openSkill = async (skill: SkillRegistryItem) => {
    await selectSkill(skill);
  };

  const submit = async () => {
    if (!activeModule || !reason.trim()) {
      setMsg("请填写改动理由");
      return;
    }
    try {
      await addSkillVersion(activeModule, editPrompt, reason.trim(), {
        method: activeSkill?.method,
        skill_type: activeSkill?.skill_type,
        change_category: activeVersion ? "manual_upgrade" : "initialization",
      });
      setMsg("已保存并激活新版本");
      await load(activeModule);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const activate = async (versionId: string) => {
    if (!activeModule) return;
    await activateSkillVersion(activeModule, versionId);
    await load(activeModule);
  };

  const activeSkill = skills?.find((s) => s.key === activeModule) ?? null;
  const groupCounts = SKILL_GROUPS.reduce<Record<SkillGroupKey, number>>((acc, group) => {
    acc[group.key] = (skills ?? []).filter((skill) => normalizeGroup(skill.category, skill.skill_type) === group.key).length;
    return acc;
  }, { intake: 0, questionnaire: 0, engine: 0, core: 0, professional: 0, capability: 0, delivery: 0, assistant: 0, other: 0 });
  const visibleSkills = (skills ?? [])
    .filter((skill) => activeGroup === "all" || normalizeGroup(skill.category, skill.skill_type) === activeGroup)
    .filter((skill) => {
      if (!deferredQuery) return true;
      return [
        skill.label,
        skill.description,
        skill.key,
        skill.method,
        skill.skill_type,
        skill.category_label,
        ...skill.trigger_keywords,
      ].some((value) => value.toLowerCase().includes(deferredQuery));
    })
    .sort((a, b) => {
      const groupA = normalizeGroup(a.category, a.skill_type);
      const groupB = normalizeGroup(b.category, b.skill_type);
      return SKILL_GROUP_ORDER[groupA] - SKILL_GROUP_ORDER[groupB]
        || (SKILL_CATEGORY_ORDER[a.category] ?? 99) - (SKILL_CATEGORY_ORDER[b.category] ?? 99)
        || Number(!a.default_core) - Number(!b.default_core)
        || a.label.localeCompare(b.label, "zh-CN");
    });
  const totalSkills = skills?.length ?? 0;
  const activeSkillGroup = activeSkill ? normalizeGroup(activeSkill.category, activeSkill.skill_type) : "other";
  const activeSkillGroupTitle = activeSkill
    ? SKILL_GROUPS.find((group) => group.key === activeSkillGroup)?.title ?? activeSkill.category_label
    : "Expert Method";
  const activeVersion = activeSkill?.active_version ?? null;
  const initializedCount = (skills ?? []).filter((skill) => skill.active_version).length;
  const diagnosisCount = (skills ?? []).filter((skill) => skill.skill_type === "diagnosis").length;
  const professionalCount = (skills ?? []).filter((skill) => skill.category === "professional").length;

  return (
    <div className="admin-cols">
      <div className="admin-list">
        <div className="admin-library-head">
          <div>
            <span>Skill 网络</span>
            <h3>专家 Skill 网络</h3>
          </div>
          <strong>{totalSkills}</strong>
        </div>

        <div className="admin-library-stats">
          <span><strong>{diagnosisCount}</strong> 可诊断</span>
          <span><strong>{professionalCount}</strong> 专业风险</span>
          <span><strong>{initializedCount}</strong> 已版本化</span>
        </div>

        <div className="admin-library-toolbar">
          <input
            className="admin-search"
            type="search"
            placeholder="搜索名称 / key / 触发词 / method"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>
            {visibleSkills.length} / {totalSkills}
          </span>
        </div>

        <div className="admin-library-grid">
          <nav className="admin-skill-nav" aria-label="方法分类筛选">
            <button
              type="button"
              className={activeGroup === "all" ? "admin-skill-filter admin-skill-filter--on" : "admin-skill-filter"}
              onClick={() => setActiveGroup("all")}
            >
              <span>全部</span>
              <strong>{totalSkills}</strong>
            </button>
            {SKILL_GROUPS.filter((group) => groupCounts[group.key] > 0).map((group) => (
              <button
                key={group.key}
                type="button"
                className={activeGroup === group.key ? "admin-skill-filter admin-skill-filter--on" : "admin-skill-filter"}
                onClick={() => setActiveGroup(group.key)}
              >
                <span>{group.shortTitle}</span>
                <strong>{groupCounts[group.key]}</strong>
              </button>
            ))}
          </nav>

          <div className="admin-skill-table" role="table" aria-label="方法列表">
            <div className="admin-skill-row admin-skill-row--head" role="row">
              <span>Skill</span>
              <span>类型</span>
              <span>版本</span>
            </div>
            {skills === null && <p className="admin-muted admin-skill-state">加载中…</p>}
            {registryError && (
              <p className="admin-msg admin-msg--error admin-skill-state">{registryError}</p>
            )}
            {skills !== null && visibleSkills.length === 0 && (
              <p className="admin-muted admin-skill-state">没有匹配的方法。</p>
            )}
            {visibleSkills.map((s) => {
              const groupKey = normalizeGroup(s.category, s.skill_type);
              const group = SKILL_GROUPS.find((g) => g.key === groupKey);
              return (
                <button
                  key={s.key}
                  type="button"
                  className={activeModule === s.key ? "admin-skill-row admin-skill-row--on" : "admin-skill-row"}
                  onClick={() => openSkill(s)}
                  role="row"
                >
                  <span className="admin-skill-row__main">
                    <span className="admin-skill-row__title">
                      <strong>{s.label}</strong>
                      {s.flow && (
                        <span
                          className="admin-skill-help"
                          title={s.flow}
                          aria-label={`用途：${s.flow}`}
                        >
                          ?
                        </span>
                      )}
                    </span>
                    <em>{s.key}</em>
                  </span>
                  <span className="admin-skill-row__type">{group?.shortTitle ?? "其他"}</span>
                  <span
                    className={
                      s.active_version
                        ? "admin-skill-row__version"
                        : s.skill_type === "diagnosis"
                          ? "admin-skill-row__version admin-skill-row__version--data"
                          : "admin-skill-row__version admin-skill-row__version--draft"
                    }
                  >
                    {s.active_version
                      ? `v${s.active_version.version}`
                      : s.skill_type === "diagnosis"
                        ? "数据驱动"
                        : "待建"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="admin-editor">
        {!activeModule ? (
          <div className="admin-empty">
              <span>Skill 网络</span>
            <h3>选择一个 Skill</h3>
            <p>查看触发场景、数据需求、升级策略和版本历史。新增版本会留痕并可回滚。</p>
          </div>
        ) : (
          <>
            <div className="admin-editor__head">
              <span>{activeSkillGroupTitle}</span>
              <h3 className="admin-editor__title">
                {activeSkill?.label ?? activeModule} · 方法说明
              </h3>
              {activeSkill && (
                <>
                  <p>{activeSkill.description}</p>
                  <div className="admin-editor__meta">
                    <span>{activeSkill.key}</span>
                    <span>{activeSkill.skill_type}</span>
                    <span>{activeSkill.method}</span>
                    <span>{activeVersion ? `v${activeVersion.version}` : "未初始化版本"}</span>
                  </div>
                </>
              )}
            </div>

            {activeSkill && (
              <div className="admin-skill-brief">
                <div>
                  <h4>触发词</h4>
                  <div className="admin-tag-row">
                    {activeSkill.trigger_keywords.slice(0, 12).map((keyword) => (
                      <span key={keyword} className="admin-tag">{keyword}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <h4>升级策略</h4>
                  <p>{activeSkill.upgrade_policy}</p>
                </div>
                <div>
                  <h4>评估指标</h4>
                  <div className="admin-tag-row">
                    {activeSkill.evaluation_metrics.map((metric) => (
                      <span key={metric} className="admin-tag admin-tag--metric">{metric}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeSkill && (activeSkill.industry_kpis.length > 0 || activeSkill.judgment_hints.length > 0) ? (
              <div className="admin-skill-brief">
                {activeSkill.industry_kpis.length > 0 && (
                  <div>
                    <h4>关键指标（脑子现场生成判断的锚点）</h4>
                    <div className="admin-tag-row">
                      {activeSkill.industry_kpis.map((kpi) => (
                        <span key={kpi} className="admin-tag admin-tag--metric">{kpi}</span>
                      ))}
                    </div>
                  </div>
                )}
                {activeSkill.judgment_hints.length > 0 && (
                  <div>
                    <h4>易误判提示（喂给脑子的领域陷阱）</h4>
                    <ul className="admin-hint-list">
                      {activeSkill.judgment_hints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {activeSkill?.data_requirements.length ? (
              <div className="admin-data-needs">
                <h4>关键数据需求 / 取数项</h4>
                {activeSkill.data_requirements.slice(0, 4).map((item) => (
                  <div key={item.key} className="admin-data-need">
                    <strong>{item.label}</strong>
                    <span>{item.required ? "必需" : "可选"}</span>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {activeSkill?.skill_type === "diagnosis" ? (
              <p className="admin-skill-note">
                本域<strong>数据驱动</strong>：诊断判断由「诊断方法」脑子生成，本域只提供<strong>卡片数据</strong>（关键指标 / 易误判提示 / 取数项）。下方可直接编辑这张卡的 JSON，<strong>保存即新版本、可留痕回滚</strong>；留空或非卡片 JSON 则回退代码默认。要改全局判断逻辑，请编辑 <code>diagnostic_method</code> 这个脑子。
              </p>
            ) : null}

            <textarea
              className="admin-textarea"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              rows={activeSkill?.skill_type === "diagnosis" ? 16 : 14}
            />
            <input
              className="admin-input"
              placeholder="改动理由（必填，会留痕）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={submit}>
              {activeVersion ? "保存并启用新版本" : "创建 v1 并启用"}
            </button>
            {msg && <p className="admin-msg">{msg}</p>}

            <h4 className="admin-editor__subtitle">版本历史</h4>
            <div className="admin-versions">
              {versions === null && <p className="admin-muted">加载版本中…</p>}
              {versions?.length === 0 && <p className="admin-muted">还没有数据库版本，当前使用代码兜底 prompt。</p>}
              {versions?.map((v) => (
                <div key={v.id} className="admin-version">
                  <span>v{v.version} {v.is_active && <em className="admin-active">当前</em>}</span>
                  <span className="admin-version__reason">{v.change_reason}</span>
                  {!v.is_active && (
                    <button type="button" className="admin-mini" onClick={() => activate(v.id)}>
                      回滚到此版本
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModelsTab() {
  const [configs, setConfigs] = useState<LLMConfigOut[] | null>(null);
  const [form, setForm] = useState({ name: "", provider: "anthropic", model: "", api_key: "", base_url: "", priority: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    provider: "anthropic",
    model: "",
    api_key: "",
    base_url: "",
    priority: 0,
    is_active: true,
  });
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => { listLLMConfigs().then(setConfigs).catch(() => {}); };
  useEffect(load, []);

  const create = async () => {
    if (!form.name.trim() || !form.model.trim() || !form.api_key.trim()) {
      setMsg("名称、模型、API Key 必填");
      return;
    }
    try {
      await createLLMConfig(form);
      setForm({ name: "", provider: "anthropic", model: "", api_key: "", base_url: "", priority: 0 });
      setMsg("已添加");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "添加失败");
    }
  };

  const remove = async (id: string) => {
    await deleteLLMConfig(id);
    if (editingId === id) setEditingId(null);
    load();
  };

  const probe = async (config: LLMConfigOut) => {
    setProbingId(config.id);
    try {
      const result = await probeLLMConfig(config.id);
      setMsg(`${config.name}：${result.message}`);
      setConfigs((current) => current?.map((item) => item.id === config.id ? result.config : item) ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "测试失败");
    } finally {
      setProbingId(null);
    }
  };

  const toggle = async (c: LLMConfigOut) => {
    await patchLLMConfig(c.id, { is_active: !c.is_active });
    load();
  };

  const channelStatusLabel = (config: LLMConfigOut) => {
    if (!config.is_active) return "已停用";
    if (config.runtime_status === "healthy") return "可用";
    if (config.runtime_status === "cooldown") return `冷却中 ${config.cooldown_remaining_seconds}s`;
    if (config.runtime_status === "degraded") return "最近失败";
    return "待验证";
  };

  const channelStatusClass = (config: LLMConfigOut) => {
    if (!config.is_active) return "admin-config__status admin-config__status--off";
    if (config.runtime_status === "healthy") return "admin-config__status admin-config__status--healthy";
    if (config.runtime_status === "cooldown") return "admin-config__status admin-config__status--cooldown";
    if (config.runtime_status === "degraded") return "admin-config__status admin-config__status--degraded";
    return "admin-config__status admin-config__status--unknown";
  };

  const startEdit = (c: LLMConfigOut) => {
    setEditingId(c.id);
    setEditForm({
      name: c.name,
      provider: c.provider,
      model: c.model,
      api_key: "",
      base_url: c.base_url,
      priority: c.priority,
      is_active: c.is_active,
    });
    setMsg(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({
      name: "",
      provider: "anthropic",
      model: "",
      api_key: "",
      base_url: "",
      priority: 0,
      is_active: true,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!editForm.name.trim() || !editForm.model.trim()) {
      setMsg("名称和模型必填");
      return;
    }
    try {
      const payload: Parameters<typeof patchLLMConfig>[1] = {
        name: editForm.name.trim(),
        provider: editForm.provider,
        model: editForm.model.trim(),
        base_url: editForm.base_url.trim(),
        priority: editForm.priority,
        is_active: editForm.is_active,
      };
      if (editForm.api_key.trim()) {
        payload.api_key = editForm.api_key.trim();
      }
      await patchLLMConfig(editingId, payload);
      setMsg("模型通道已更新");
      cancelEdit();
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "更新失败");
    }
  };

  return (
    <div className="admin-models">
      <div className="admin-config-form">
        <div className="admin-editor__head">
          <span>模型路由</span>
          <h3 className="admin-editor__title">新增模型通道</h3>
        </div>
        <p className="admin-muted">优先级数字越小越靠前；主通道失败时自动切换到备用通道。</p>
        <div className="admin-form-grid">
          <input className="admin-input" placeholder="配置名（如 主力-claude）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="admin-input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="anthropic">anthropic</option>
            <option value="openai">openai</option>
          </select>
          <input className="admin-input" placeholder="模型（如 claude-opus-4-8）" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <input className="admin-input" placeholder="API Key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          <input className="admin-input" placeholder="Base URL（可选，自定义网关）" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          <input className="admin-input" type="number" placeholder="优先级 0=主" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        </div>
        <button type="button" className="btn-primary" onClick={create}>添加配置</button>
        {msg && <p className="admin-msg">{msg}</p>}
      </div>

      <div className="admin-config-list">
        {configs === null && <p className="admin-muted">加载中…</p>}
        {configs && configs.length === 0 && <p className="admin-muted">还没有配置，当前用环境变量默认模型。</p>}
        {configs?.map((c) => (
          <div key={c.id} className={editingId === c.id ? "admin-config admin-config--editing" : "admin-config"}>
            {editingId === c.id ? (
              <div className="admin-config-edit">
                <div className="admin-config-edit__head">
                  <strong>编辑模型通道</strong>
                  <span>{c.api_key_masked}</span>
                </div>
                <div className="admin-form-grid">
                  <input
                    className="admin-input"
                    placeholder="配置名"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                  <select
                    className="admin-input"
                    value={editForm.provider}
                    onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })}
                  >
                    <option value="anthropic">anthropic</option>
                    <option value="openai">openai</option>
                  </select>
                  <input
                    className="admin-input"
                    placeholder="模型"
                    value={editForm.model}
                    onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                  />
                  <input
                    className="admin-input"
                    placeholder="新 API Key（留空则不修改）"
                    value={editForm.api_key}
                    onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })}
                  />
                  <input
                    className="admin-input"
                    placeholder="Base URL（可选）"
                    value={editForm.base_url}
                    onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })}
                  />
                  <input
                    className="admin-input"
                    type="number"
                    placeholder="优先级"
                    value={editForm.priority}
                    onChange={(e) => setEditForm({ ...editForm, priority: Number(e.target.value) })}
                  />
                </div>
                <label className="admin-switch">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                  />
                  启用该通道
                </label>
                <div className="admin-config__actions admin-config__actions--edit">
                  <button type="button" className="btn-primary" onClick={saveEdit}>
                    保存修改
                  </button>
                  <button type="button" className="admin-mini" onClick={cancelEdit}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="admin-config__main">
                  <span className="admin-config__name">
                    {c.name} <em className="admin-config__pri">优先级 {c.priority}</em>
                    {!c.is_active && <em className="admin-config__off">已停用</em>}
                  </span>
                  <span className={channelStatusClass(c)}>{channelStatusLabel(c)}</span>
                  <span className="admin-config__meta">
                    {c.provider} · {c.model} · {c.api_key_masked}
                    {c.base_url ? ` · ${c.base_url}` : ""}
                  </span>
                  {(c.last_error || c.failure_count > 0 || c.success_count > 0) && (
                    <span className="admin-config__runtime">
                      {c.last_error
                        ? `最近错误：${c.last_error_type || "Error"} · ${c.last_error}`
                        : `成功 ${c.success_count} 次 · 失败 ${c.failure_count} 次`}
                    </span>
                  )}
                </div>
                <div className="admin-config__actions">
                  <button type="button" className="admin-mini" onClick={() => probe(c)} disabled={probingId === c.id}>
                    {probingId === c.id ? "测试中…" : "测试"}
                  </button>
                  <button type="button" className="admin-mini" onClick={() => startEdit(c)}>
                    编辑
                  </button>
                  <button type="button" className="admin-mini" onClick={() => toggle(c)}>
                    {c.is_active ? "停用" : "启用"}
                  </button>
                  <button type="button" className="admin-mini admin-mini--danger" onClick={() => remove(c.id)}>
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 顾问审核队列 ──────────────────────────────────────────────────────────────

const SIGNAL_LABEL: Record<string, string> = { red: "🔴 红灯", yellow: "🟡 黄灯", green: "🟢 绿灯" };
const SOURCE_STAGE_LABEL: Record<string, string> = {
  system_pre_research: "系统预研",
  expert_supplemental_research: "专家追搜",
};

function confidencePercent(result: ModuleResult): number | null {
  const confidence = result.evidence_package?.confidence;
  return typeof confidence === "number" && Number.isFinite(confidence)
    ? Math.round(confidence * 100)
    : null;
}

function buildReviewSummary(detail: ReviewDetail) {
  const results = detail.results ?? [];
  const evidence = detail.evidence_pack ?? [];
  const confidences = results
    .map(confidencePercent)
    .filter((value): value is number => value !== null);
  const dataRequestCount = results.reduce((sum, result) => sum + (result.data_requests?.length ?? 0), 0);
  const riskCount = results.filter((result) => result.signal === "red").length;
  const warningCount = results.filter((result) => result.signal === "yellow").length;
  const averageConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : null;

  return {
    moduleCount: results.length,
    riskCount,
    warningCount,
    dataRequestCount,
    averageConfidence,
    externalEvidenceCount: evidence.length,
    hasExternalResearch: evidence.length > 0,
  };
}

function evidenceProviderText(evidence: ResearchEvidenceOut[]): string {
  const providers = Array.from(new Set(evidence.map((item) => item.provider).filter(Boolean)));
  return providers.length > 0 ? providers.join(" / ") : "未记录";
}

function evidenceStageText(evidence: ResearchEvidenceOut[]): string {
  const stages = Array.from(new Set(evidence.map((item) => SOURCE_STAGE_LABEL[item.source_stage] ?? item.source_stage).filter(Boolean)));
  return stages.length > 0 ? stages.join(" / ") : "未记录";
}

function topEvidenceSources(evidence: ResearchEvidenceOut[], limit = 3): ResearchEvidenceOut[] {
  return [...evidence]
    .sort((a, b) => b.credibility - a.credibility)
    .slice(0, limit);
}

function ReviewTab() {
  const [queue, setQueue] = useState<ReviewQueueItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    fetchReviewQueue().then(setQueue).catch((e) => setErr(String(e)));
  }
  useEffect(reload, []);

  function open(recordId: string) {
    setSelected(recordId);
    setDetail(null);
    setMsg(null);
    fetchReviewDetail(recordId).then(setDetail).catch((e) => setErr(String(e)));
  }

  async function act(action: "approve" | "reject" | "annotate") {
    if (!selected) return;
    const notes = noteDraft.trim() ? [noteDraft.trim()] : [];
    try {
      const updated = await submitReview(selected, { action, notes, reviewer: reviewer.trim() || undefined });
      setDetail(updated);
      setNoteDraft("");
      setMsg(action === "approve" ? "已通过，老板可见报告" : action === "reject" ? "已打回" : "注释已保存");
      reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  if (err) return <div className="admin-empty">出错：{err}</div>;

  return (
    <div className="review-tab">
      <div className="review-layout">
        <aside className="review-queue">
          <h3 className="loop-tab__title">待审核队列（24h SLA）</h3>
          {queue === null
            ? <p className="admin-empty">加载中…</p>
            : queue.length === 0
              ? <p className="admin-empty">队列已清空 🎉</p>
              : (
                <ul className="review-queue__list">
                  {queue.map((item) => (
                    <li key={item.record_id}>
                      <button
                        type="button"
                        className={`review-queue__item ${selected === item.record_id ? "review-queue__item--on" : ""} ${item.overdue ? "review-queue__item--overdue" : ""}`}
                        onClick={() => open(item.record_id)}
                      >
                        <span className="review-queue__module">{item.primary_module || "通用"}</span>
                        <span className={`review-queue__sla ${item.overdue ? "is-overdue" : item.hours_remaining < 6 ? "is-urgent" : ""}`}>
                          {item.overdue ? `超期 ${Math.abs(item.hours_remaining).toFixed(0)}h` : `剩 ${item.hours_remaining.toFixed(0)}h`}
                        </span>
                        <span className="review-queue__time">{item.created_at.slice(0, 16)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
        </aside>

        <section className="review-detail">
          {!selected
            ? <p className="admin-empty">从左侧选一条诊断开始审核</p>
            : detail === null
              ? <p className="admin-empty">加载诊断内容…</p>
              : (
                <>
                  <div className="review-detail__head">
                    <div>
                      <span className="review-detail__eyebrow">顾问审核草稿</span>
                      <h3 className="loop-tab__title">诊断草稿 · {displayModuleLabel(detail.primary_module) || detail.primary_module || "通用"}</h3>
                    </div>
                    <span className={`review-status-badge review-status-badge--${detail.review_status}`}>
                      {detail.review_status === "approved" ? "已通过" : detail.review_status === "rejected" ? "已打回" : "待审核"}
                    </span>
                  </div>

                  <ReviewDraftOverview detail={detail} />
                  <ReviewResearchPanel evidence={detail.evidence_pack ?? []} />
                  <details className="review-evidence-details">
                    <summary>查看外部证据分析与审计底稿</summary>
                    <EvidencePackPanel
                      evidence={detail.evidence_pack ?? []}
                      title="外部证据包"
                      emptyText="这条诊断暂未沉淀外部证据。请重点核查专家结论是否需要补充来源。"
                      compact
                    />
                  </details>

                  <section className="review-draft-section" aria-label="专家诊断草稿">
                    <div className="review-section-title">
                      <span>专家诊断草稿</span>
                      <strong>{detail.results.length} 个判断模块</strong>
                    </div>
                    <div className="review-result-grid">
                      {detail.results.map((r, i) => (
                        <ReviewResultCard key={`${r.module}-${i}`} result={r} index={i} />
                      ))}
                    </div>
                  </section>

                  {detail.consultant_notes.length > 0 && (
                    <div className="review-notes">
                      <strong>顾问补充意见：</strong>
                      <ul>{detail.consultant_notes.map((n, i) => <li key={i}>{cleanSentenceText(n, "")}</li>)}</ul>
                    </div>
                  )}

                  {detail.review_status === "pending_review" && (
                    <div className="review-actions">
                      <input
                        className="review-actions__reviewer"
                        placeholder="审核人（选填）"
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                      />
                      <textarea
                        className="review-actions__note"
                        placeholder="补充判断 / 修改意见（选填）"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                      />
                      <div className="review-actions__btns">
                        <button type="button" className="btn-primary" onClick={() => act("approve")}>通过并交付</button>
                        <button type="button" className="btn-ghost" onClick={() => act("annotate")} disabled={!noteDraft.trim()}>仅保存注释</button>
                        <button type="button" className="btn-danger" onClick={() => act("reject")}>打回</button>
                      </div>
                    </div>
                  )}
                  {msg && <p className="review-msg">{msg}</p>}
                </>
              )}
        </section>
      </div>
    </div>
  );
}

function ReviewDraftOverview({ detail }: { detail: ReviewDetail }) {
  const summary = buildReviewSummary(detail);
  const confidenceClass = summary.averageConfidence === null
    ? "is-muted"
    : summary.averageConfidence < 50
      ? "is-low"
      : summary.averageConfidence < 75
        ? "is-mid"
        : "is-high";
  return (
    <section className="review-overview" aria-label="审核摘要">
      <div className="review-overview__main">
        <span>审核摘要</span>
        <h4>
          {summary.riskCount > 0
            ? `发现 ${summary.riskCount} 个高风险判断，建议先核证据再放行。`
            : summary.warningCount > 0
              ? `有 ${summary.warningCount} 个模块需要补充核验。`
              : "草稿整体风险较低，可进入交付前复核。"}
        </h4>
        <p>
          本草稿覆盖 {summary.moduleCount} 个专家模块，
          {summary.dataRequestCount > 0 ? `仍有 ${summary.dataRequestCount} 项关键数据待补。` : "暂无显式待补数据。"}
          {summary.hasExternalResearch ? ` 已沉淀 ${summary.externalEvidenceCount} 条外部证据。` : " 当前未检索到外部证据入库。"}
        </p>
      </div>
      <div className="review-overview__stats">
        <div>
          <strong>{summary.moduleCount}</strong>
          <span>模块</span>
        </div>
        <div>
          <strong>{summary.dataRequestCount}</strong>
          <span>待补数据</span>
        </div>
        <div className={confidenceClass}>
          <strong>{summary.averageConfidence === null ? "—" : `${summary.averageConfidence}%`}</strong>
          <span>平均置信度</span>
        </div>
      </div>
    </section>
  );
}

function ReviewResearchPanel({ evidence }: { evidence: ResearchEvidenceOut[] }) {
  const hasEvidence = evidence.length > 0;
  const sources = topEvidenceSources(evidence);
  return (
    <section className={`review-research ${hasEvidence ? "review-research--ready" : "review-research--missing"}`} aria-label="外部数据核验">
      <div className="review-section-title">
        <span>外部数据核验</span>
        <strong>{hasEvidence ? "已搜索并入库" : "未发现外部搜索证据"}</strong>
      </div>
      {hasEvidence ? (
        <>
          <div className="review-research__meta">
            <span>来源数量：{evidence.length}</span>
            <span>搜索通道：{evidenceProviderText(evidence)}</span>
            <span>检索阶段：{evidenceStageText(evidence)}</span>
          </div>
          <div className="review-research__sources">
            {sources.map((item, index) => (
              <a key={item.id} href={item.url || undefined} target={item.url ? "_blank" : undefined} rel={item.url ? "noreferrer" : undefined}>
                <small>来源 {index + 1} · {displayModuleLabel(item.module) || item.module || "通用"}</small>
                <span>{cleanDisplayText(item.title, item.query || "外部来源")}</span>
              </a>
            ))}
          </div>
        </>
      ) : (
        <p>
          这条待审核诊断没有关联 `researchevidence` 入库记录。顾问审核时应按“内部输入草稿”处理：
          重点检查结论是否过度确定，并决定是否打回补充外部行业、竞品、政策或官网来源。
        </p>
      )}
    </section>
  );
}

function ReviewResultCard({ result, index }: { result: ModuleResult; index: number }) {
  const confidence = confidencePercent(result);
  const confidenceClass = confidence === null
    ? "is-muted"
    : confidence < 50
      ? "is-low"
      : confidence < 75
        ? "is-mid"
        : "is-high";
  const evidence = result.evidence ?? [];
  const actions = (result.actions ?? []).map((action) => cleanDisplayText(action, "")).filter(Boolean);
  const requests = result.data_requests ?? [];
  return (
    <article className={`review-result-card review-result-card--${result.signal || "unknown"}`}>
      <div className="review-result-card__head">
        <div>
          <span>判断 {index + 1}</span>
          <h4>{displayModuleLabel(result.module) || result.module || "通用模块"}</h4>
        </div>
        <div className="review-result-card__badges">
          <span className={`review-signal review-signal--${result.signal || "unknown"}`}>{SIGNAL_LABEL[result.signal] ?? result.signal}</span>
          <span className={`review-confidence ${confidenceClass}`}>
            {confidence === null ? "置信度未标注" : `置信度 ${confidence}%`}
          </span>
        </div>
      </div>

      <div className="review-result-card__conclusion">
        <span>核心结论</span>
        <p>{cleanSentenceText(result.conclusion, "暂无明确结论。")}</p>
      </div>

      <div className="review-result-card__body">
        <section>
          <h5>依据</h5>
          {evidence.length > 0 ? (
            <ul className="review-evidence-list">
              {evidence.slice(0, 3).map((ev, j) => (
                <li key={j}>
                  <p>{cleanSentenceText(ev.text, "暂无可展示依据。")}</p>
                  <span>来源：{formatEvidenceSource(ev.source)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="review-muted">暂无逐条依据，需顾问补证后再通过。</p>
          )}
        </section>

        <section>
          <h5>建议动作</h5>
          {actions.length > 0 ? (
            <ol className="review-action-list">
              {actions.slice(0, 3).map((action, j) => <li key={j}>{action}</li>)}
            </ol>
          ) : (
            <p className="review-muted">暂无建议动作。</p>
          )}
        </section>
      </div>

      {(requests.length > 0 || result.evidence_package?.confidence_reason) && (
        <details className="review-result-card__more">
          <summary>查看置信度原因与待补数据</summary>
          {result.evidence_package?.confidence_reason && (
            <p className="review-confidence-reason">{cleanSentenceText(result.evidence_package.confidence_reason, "")}</p>
          )}
          {requests.length > 0 && (
            <ul className="review-data-requests">
              {requests.map((request) => (
                <li key={request.key || request.label}>
                  <strong>{cleanDisplayText(request.label, "待补数据")}</strong>
                  <span>{cleanDisplayText(request.reason, "补齐后用于提高判断可靠性。")}</span>
                  {request.source_hint && <em>取数建议：{cleanDisplayText(request.source_hint, "")}</em>}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </article>
  );
}

// ── 系统健康 ────────────────────────────────────────────────────────────────
// 两块内部体检信号：路由召回 / 交付质量。（案例沉淀已并入「案例库 → 洞察」。）
// 后端采集管线一直在跑，这里只是把数据摆出来给运营看，便于调优——不影响前台交付。

function SystemHealthTab() {
  return (
    <div className="loop-health">
      <p className="loop-tab__desc loop-health__intro">
        系统在每次诊断后自动采集这两类信号，供运营调优路由与观察交付口碑。纯只读，不影响前台交付。案例沉淀分析见「案例库 → 洞察」。
      </p>
      <RoutingHealthSection />
      <DeliveryQualitySection />
    </div>
  );
}

// 路由召回健康（每次诊断收口自动记录召回决策）
function RoutingHealthSection() {
  const [stats, setStats] = useState<L2Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchL2Stats().then(setStats).catch(e => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">路由健康加载失败：{err}</div>;
  if (!stats) return <div className="admin-empty">加载中…</div>;

  const fpRate = (stats.keyword_false_positive_rate * 100).toFixed(0);
  const missRate = (stats.missed_recall_rate * 100).toFixed(0);

  return (
    <div className="loop-tab">
      <h3 className="loop-tab__title">路由召回健康</h3>
      <p className="loop-tab__desc">大脑每次诊断都会记录"选了哪些诊断域"。样本攒够后可离线复盘漏召回与误召回，校准关键词权重。</p>
      <div className="loop-stats-row">
        <div className="loop-stat"><span className="loop-stat__num">{stats.total_samples}</span><span className="loop-stat__label">样本总数</span></div>
        <div className={`loop-stat ${parseFloat(missRate) > 10 ? "loop-stat--err" : "loop-stat--ok"}`}>
          <span className="loop-stat__num">{missRate}%</span><span className="loop-stat__label">漏召回率</span>
        </div>
        <div className={`loop-stat ${parseFloat(fpRate) > 30 ? "loop-stat--warn" : "loop-stat--ok"}`}>
          <span className="loop-stat__num">{fpRate}%</span><span className="loop-stat__label">关键词假阳性率</span>
        </div>
        <div className="loop-stat"><span className="loop-stat__num">{stats.keyword_recalls}</span><span className="loop-stat__label">关键词召回次数</span></div>
      </div>
      {stats.recent_missed.length > 0 && (
        <div className="loop-alert">⚠️ 近期漏召回模块：{stats.recent_missed.join("、")}</div>
      )}
      <h4 className="loop-tab__subtitle">各诊断域召回频次</h4>
      <table className="loop-table">
        <thead><tr><th>诊断域</th><th>召回次数</th><th>来源分布</th></tr></thead>
        <tbody>
          {stats.skill_recall_frequency.map(s => (
            <tr key={s.module}>
              <td><code>{s.module}</code></td>
              <td>{s.recall_count}</td>
              <td>
                {Object.entries(s.source_breakdown).map(([src, cnt]) => (
                  <span key={src} className="source-badge">{src}:{cnt}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 交付质量（诊断交付量 + 老板对结论的评分反馈）
function DeliveryQualitySection() {
  const [stats, setStats] = useState<L4Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchL4Stats().then(setStats).catch(e => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">交付质量加载失败：{err}</div>;
  if (!stats) return <div className="admin-empty">加载中…</div>;

  return (
    <div className="loop-tab">
      <h3 className="loop-tab__title">交付质量</h3>
      <p className="loop-tab__desc">作战室交付量与老板对结论的评分反馈。叙事改写若产出套话/编造，会回退到确定性原值。</p>
      <div className="loop-stats-row">
        <div className="loop-stat"><span className="loop-stat__num">{stats.total_diagnoses}</span><span className="loop-stat__label">总诊断次数</span></div>
        <div className="loop-stat"><span className="loop-stat__num">{stats.recent_feedback_count}</span><span className="loop-stat__label">近期反馈数</span></div>
        <div className={`loop-stat ${(stats.avg_rating ?? 0) >= 4 ? "loop-stat--ok" : stats.avg_rating !== null ? "loop-stat--warn" : ""}`}>
          <span className="loop-stat__num">{stats.avg_rating !== null ? stats.avg_rating.toFixed(1) : "—"}</span>
          <span className="loop-stat__label">平均评分（/5）</span>
        </div>
        <div className={`loop-stat ${(stats.useful_rate ?? 0) >= 0.7 ? "loop-stat--ok" : stats.useful_rate !== null ? "loop-stat--warn" : ""}`}>
          <span className="loop-stat__num">{stats.useful_rate !== null ? `${(stats.useful_rate * 100).toFixed(0)}%` : "—"}</span>
          <span className="loop-stat__label">有用率（👍）</span>
        </div>
      </div>
      {stats.recent_feedback_count === 0 && (
        <p className="admin-empty">暂无反馈——用户完成诊断并评分后这里会出现数据。</p>
      )}
    </div>
  );
}

// ── 案例库 ────────────────────────────────────────────────────────────────────
// 台账=真实项目（跨用户，看有哪些项目/卡在哪）；洞察=脱敏聚合（反哺平台）。

const CASE_SIGNAL_LABEL: Record<string, string> = { red: "🔴 高危", yellow: "🟡 关注", green: "🟢 健康", "": "—" };
const DELIVERY_LABEL: Record<string, string> = {
  approved: "已交付", pending_review: "审核中", rejected: "已打回", draft: "草稿", empty: "未出报告",
};

function CaseLibraryTab() {
  const [view, setView] = useState<"ledger" | "insights">("ledger");
  return (
    <div className="case-lib">
      <div className="case-lib__switch" role="tablist" aria-label="案例库视图">
        <button type="button" role="tab" className={view === "ledger" ? "is-on" : ""} onClick={() => setView("ledger")}>项目台账</button>
        <button type="button" role="tab" className={view === "insights" ? "is-on" : ""} onClick={() => setView("insights")}>案例洞察</button>
      </div>
      {view === "ledger" ? <LedgerView /> : <InsightsView />}
    </div>
  );
}

function LedgerView() {
  const [data, setData] = useState<CaseProductGroups | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<CaseProjectFilters>({});
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseProjectDetail | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setData(null);
    setErr(null);
    fetchCaseProductGroups({ ...filters, q: deferredQuery || undefined })
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, [filters, deferredQuery]);

  function open(id: string) {
    setSelected(id);
    setDetail(null);
    fetchCaseProjectDetail(id).then(setDetail).catch((e) => setErr(String(e)));
  }

  if (err) return <div className="admin-empty">案例库加载失败：{err}</div>;

  const groups = data?.groups ?? [];

  return (
    <div className="case-ledger">
      <div className="case-ledger__toolbar">
        <input
          className="case-ledger__search"
          placeholder="搜项目名 / 核心问题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          value={filters.industry ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, industry: e.target.value || undefined }))}
        >
          <option value="">全部行业</option>
          {(data?.industries ?? []).map((ind) => <option key={ind} value={ind}>{ind}</option>)}
        </select>
        <select
          value={filters.signal ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, signal: e.target.value || undefined }))}
        >
          <option value="">全部信号</option>
          <option value="red">🔴 高危</option>
          <option value="yellow">🟡 关注</option>
          <option value="green">🟢 健康</option>
        </select>
        <select
          value={filters.delivery_state ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, delivery_state: e.target.value || undefined }))}
        >
          <option value="">全部交付态</option>
          <option value="approved">已交付</option>
          <option value="pending_review">审核中</option>
          <option value="rejected">已打回</option>
          <option value="empty">未出报告</option>
        </select>
        <select
          value={filters.status ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
        >
          <option value="">在用项目</option>
          <option value="archived">已归档</option>
          <option value="all">全部含归档</option>
        </select>
        <span className="case-ledger__count">{data ? `${data.total} 个项目` : "加载中…"}</span>
      </div>

      <div className="review-layout">
        <aside className="case-ledger__list">
          {data === null
            ? <p className="admin-empty">加载中…</p>
            : groups.length === 0
              ? <p className="admin-empty">没有符合条件的项目</p>
              : groups.map((g) => (
                <div className="case-group" key={g.product}>
                  <button
                    type="button"
                    className="case-group__head"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.product]: !c[g.product] }))}
                  >
                    <span className="case-group__chevron">{collapsed[g.product] ? "▸" : "▾"}</span>
                    <span className="case-group__name">{g.product}</span>
                    <span className="case-group__count">{g.count}</span>
                  </button>
                  {!collapsed[g.product] && g.modules.map((mg) => (
                    <div className="case-subgroup" key={mg.module || "_none"}>
                      <div className="case-subgroup__head">
                        <span>{mg.module ? displayModuleLabel(mg.module) : "未诊断"}</span>
                        <span className="case-subgroup__count">{mg.count}</span>
                      </div>
                      {mg.projects.map((it) => (
                        <button
                          type="button"
                          key={it.id}
                          className={`case-row ${selected === it.id ? "case-row--on" : ""}`}
                          onClick={() => open(it.id)}
                        >
                          <span className={`case-row__dot case-row__dot--${it.latest_signal || "none"}`} aria-hidden="true" />
                          <span className="case-row__name">{it.name}</span>
                          <span className="case-row__meta">
                            {DELIVERY_LABEL[it.delivery_state] ?? it.delivery_state}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
        </aside>

        <section className="case-ledger__detail">
          {!selected
            ? <p className="admin-empty">从左侧选一个项目查看详情</p>
            : detail === null
              ? <p className="admin-empty">加载中…</p>
              : <CaseDetail detail={detail} />}
        </section>
      </div>
    </div>
  );
}

function CaseDetail({ detail }: { detail: CaseProjectDetail }) {
  return (
    <div className="case-detail">
      <div className="case-detail__head">
        <h3>{detail.name}</h3>
        <span className="case-detail__sub">{detail.user_email} · {detail.industry || "未填行业"} · {detail.status === "archived" ? "已归档" : "在用"}</span>
      </div>

      <div className="case-detail__profile">
        {detail.main_business && <div><span>主营业务</span><b>{detail.main_business}</b></div>}
        {detail.core_problem && <div><span>核心问题</span><b>{detail.core_problem}</b></div>}
        {detail.goal && <div><span>目标</span><b>{detail.goal}</b></div>}
        <div><span>诊断次数</span><b>{detail.records.length}</b></div>
        <div><span>外部证据</span><b>{detail.evidence_count} 条</b></div>
        {detail.feedback.count > 0 && (
          <div><span>反馈</span><b>{detail.feedback.avg_rating ?? "—"} 分 · 有用率 {detail.feedback.useful_rate !== null ? `${Math.round(detail.feedback.useful_rate * 100)}%` : "—"}</b></div>
        )}
      </div>

      {(detail.war_room_summary || detail.war_room_objective) && (
        <div className="case-detail__warroom">
          <h4 className="loop-tab__subtitle">作战室摘要</h4>
          {detail.war_room_objective && <p><b>目标：</b>{cleanSentenceText(detail.war_room_objective)}</p>}
          {detail.war_room_summary && <p>{cleanSentenceText(detail.war_room_summary)}</p>}
        </div>
      )}

      <h4 className="loop-tab__subtitle">诊断记录</h4>
      {detail.records.length === 0
        ? <p className="admin-empty">暂无诊断</p>
        : detail.records.map((rec) => (
          <div className="case-rec" key={rec.id}>
            <div className="case-rec__head">
              <span>{rec.created_at.slice(0, 16)}</span>
              <span className="case-rec__status">{rec.review_status === "approved" ? "已交付" : rec.review_status === "pending_review" ? "审核中" : rec.review_status === "rejected" ? "已打回" : rec.review_status}</span>
            </div>
            {rec.signals.map((s) => (
              <div className={`case-sig case-sig--${s.signal || "none"}`} key={s.module}>
                <span className="case-sig__mod">{CASE_SIGNAL_LABEL[s.signal] ?? "—"} {displayModuleLabel(s.module)}</span>
                <span className="case-sig__concl">{cleanSentenceText(s.conclusion)}</span>
              </div>
            ))}
            {rec.consultant_notes.length > 0 && (
              <ul className="case-rec__notes">
                {rec.consultant_notes.map((n, i) => <li key={i}>顾问：{n}</li>)}
              </ul>
            )}
          </div>
        ))}
    </div>
  );
}

function InsightsView() {
  const [ins, setIns] = useState<CaseInsights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchCaseInsights().then(setIns).catch((e) => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">案例洞察加载失败：{err}</div>;
  if (!ins) return <div className="admin-empty">加载中…</div>;
  if (ins.total_cases === 0) return <div className="admin-empty">暂无脱敏案例——用户完成诊断后这里会自动沉淀。</div>;

  return (
    <div className="case-insights">
      <p className="loop-tab__desc">基于 {ins.total_cases} 个脱敏案例聚合（项目名已抹除、金额已模糊）。看需求结构与诊断质量，反哺该深耕哪些行业、优先升级哪块大脑。</p>

      <h4 className="loop-tab__subtitle">需求结构</h4>
      <div className="case-insights__grid">
        <BarBlock title="行业分布" items={ins.industry_dist} />
        <BarBlock title="主战场（诊断域）分布" items={ins.module_dist.map((d) => ({ label: displayModuleLabel(d.label), count: d.count }))} />
        <BarBlock title="场景分布" items={ins.scenario_dist} />
      </div>

      <h4 className="loop-tab__subtitle">诊断质量</h4>
      <div className="case-insights__grid">
        <BarBlock title="信号分布" items={ins.signal_dist.map((d) => ({ label: CASE_SIGNAL_LABEL[d.label] ?? d.label, count: d.count }))} accent="var(--signal-red)" />
        <div className="case-bars-block">
          <h5>各域平均信心（低 = 优先升级）</h5>
          {ins.avg_confidence_per_module.length === 0
            ? <p className="admin-empty">暂无信心数据</p>
            : (
              <div className="case-bars">
                {ins.avg_confidence_per_module.map((m) => (
                  <div className="case-bar" key={m.module}>
                    <span className="case-bar__label">{displayModuleLabel(m.module)}</span>
                    <span className="case-bar__track"><span className="case-bar__fill" style={{ width: `${m.avg_confidence * 100}%` }} /></span>
                    <span className="case-bar__num">{m.avg_confidence.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
        <BarBlock title="最常缺的关键数据（反哺问卷）" items={ins.data_gaps_top.map((d) => ({ label: dataRequirementLabel(d.label), count: d.count }))} />
      </div>
    </div>
  );
}

function BarBlock({ title, items, accent }: { title: string; items: CaseDistItem[]; accent?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="case-bars-block">
      <h5>{title}</h5>
      {items.length === 0
        ? <p className="admin-empty">暂无数据</p>
        : (
          <div className="case-bars">
            {items.map((it) => (
              <div className="case-bar" key={it.label}>
                <span className="case-bar__label">{it.label}</span>
                <span className="case-bar__track">
                  <span className="case-bar__fill" style={{ width: `${(it.count / max) * 100}%`, background: accent }} />
                </span>
                <span className="case-bar__num">{it.count}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
