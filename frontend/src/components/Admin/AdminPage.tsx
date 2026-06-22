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
  fetchL1Stats,
  fetchL2Stats,
  fetchL3Stats,
  fetchL4Stats,
  fetchReviewQueue,
  fetchReviewDetail,
  submitReview,
} from "../../api/client";
import type {
  SkillRegistryItem,
  SkillVersionOut,
  LLMConfigOut,
  L1Stats,
  L2Stats,
  L3Stats,
  L4Stats,
  ReviewQueueItem,
  ReviewDetail,
} from "../../types";
import { cleanDisplayText, cleanSentenceText, displayModuleLabel } from "../../utils/displayText";
import { AppShell } from "../Layout/AppShell";
import { EvidencePackPanel } from "../Evidence/EvidencePackPanel";
import "./AdminPage.css";

type Tab = "skills" | "models" | "review" | "l1" | "l2" | "l3" | "l4";

type SkillGroupKey = "assistant" | "intake" | "questionnaire" | "core" | "professional" | "industry" | "delivery" | "other";
type SkillFilterKey = SkillGroupKey | "all";

const SKILL_GROUPS: Array<{
  key: SkillGroupKey;
  title: string;
  shortTitle: string;
}> = [
  {
    key: "assistant",
    title: "头脑风暴",
    shortTitle: "脑暴",
  },
  {
    key: "intake",
    title: "客户进入与问题地图",
    shortTitle: "进入",
  },
  {
    key: "questionnaire",
    title: "诊断问卷与数据采集",
    shortTitle: "问卷",
  },
  {
    key: "core",
    title: "核心经营 Skill",
    shortTitle: "经营",
  },
  {
    key: "professional",
    title: "专业风险 Skill",
    shortTitle: "专业",
  },
  {
    key: "industry",
    title: "行业场景 Skill",
    shortTitle: "行业",
  },
  {
    key: "delivery",
    title: "证据、交付与复盘",
    shortTitle: "交付",
  },
  {
    key: "other",
    title: "其他方法",
    shortTitle: "其他",
  },
];
const SKILL_GROUP_ORDER = SKILL_GROUPS.reduce<Record<SkillGroupKey, number>>((acc, group, index) => {
  acc[group.key] = index;
  return acc;
}, { assistant: 0, intake: 0, questionnaire: 0, core: 0, professional: 0, industry: 0, delivery: 0, other: 0 });

const SKILL_CATEGORY_ORDER: Record<string, number> = {
  assistant: 5,
  intake: 10,
  questionnaire: 20,
  core: 30,
  professional: 40,
  industry: 50,
  delivery: 60,
  other: 90,
};

function normalizeGroup(category: string, skillType?: string): SkillGroupKey {
  if (category === "assistant" || category === "intake" || category === "questionnaire" || category === "core" || category === "professional" || category === "industry" || category === "delivery") {
    return category;
  }
  if (skillType === "assistant") return "assistant";
  if (skillType === "conversation") return "intake";
  if (skillType === "questionnaire") return "questionnaire";
  if (skillType === "diagnosis") return "core";
  return "other";
}

export function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("skills");

  return (
    <AppShell
      eyebrow="Operating Console"
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
          <span className="admin-tab-divider" />
          <button type="button" className={tab === "l1" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("l1")}>L1 Skill 生产</button>
          <button type="button" className={tab === "l2" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("l2")}>L2 Router 健康</button>
          <button type="button" className={tab === "l3" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("l3")}>L3 案例飞轮</button>
          <button type="button" className={tab === "l4" ? "admin-tab admin-tab--on" : "admin-tab"} onClick={() => setTab("l4")}>L4 Composer</button>
        </div>

        {tab === "review" && <ReviewTab />}
        {tab === "skills" && <SkillsTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "l1" && <L1Tab />}
        {tab === "l2" && <L2Tab />}
        {tab === "l3" && <L3Tab />}
        {tab === "l4" && <L4Tab />}
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
    setEditPrompt(skill.active_version?.system_prompt ?? skill.fallback_prompt ?? "");
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
  }, { assistant: 0, intake: 0, questionnaire: 0, core: 0, professional: 0, industry: 0, delivery: 0, other: 0 });
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
            <span>Skill Network</span>
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
            {SKILL_GROUPS.map((group) => (
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
                    <strong>{s.label}</strong>
                    <em>{s.key}</em>
                  </span>
                  <span className="admin-skill-row__type">{group?.shortTitle ?? "其他"}</span>
                  <span className={s.active_version ? "admin-skill-row__version" : "admin-skill-row__version admin-skill-row__version--draft"}>
                    {s.active_version ? `v${s.active_version.version}` : "待建"}
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
            <span>Skill Network</span>
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

            {activeSkill?.data_requirements.length ? (
              <div className="admin-data-needs">
                <h4>关键数据需求</h4>
                {activeSkill.data_requirements.slice(0, 4).map((item) => (
                  <div key={item.key} className="admin-data-need">
                    <strong>{item.label}</strong>
                    <span>{item.required ? "必需" : "可选"}</span>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <textarea
              className="admin-textarea"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              rows={14}
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

  const toggle = async (c: LLMConfigOut) => {
    await patchLLMConfig(c.id, { is_active: !c.is_active });
    load();
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
          <span>Model Routing</span>
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
                  <span className="admin-config__meta">
                    {c.provider} · {c.model} · {c.api_key_masked}
                    {c.base_url ? ` · ${c.base_url}` : ""}
                  </span>
                </div>
                <div className="admin-config__actions">
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
                    <h3 className="loop-tab__title">诊断草稿 · {detail.primary_module || "通用"}</h3>
                    <span className={`review-status-badge review-status-badge--${detail.review_status}`}>
                      {detail.review_status === "approved" ? "已通过" : detail.review_status === "rejected" ? "已打回" : "待审核"}
                    </span>
                  </div>

                  <EvidencePackPanel
                    evidence={detail.evidence_pack ?? []}
                    title="外部证据包"
                    emptyText="这条诊断暂未沉淀外部证据。请重点核查专家结论是否需要补充来源。"
                    compact
                  />

                  {detail.results.map((r, i) => (
                    <div key={i} className="review-result">
                      <div className="review-result__head">
                        <code>{displayModuleLabel(r.module) || r.module}</code>
                        <span>{SIGNAL_LABEL[r.signal] ?? r.signal}</span>
                      </div>
                      <p className="review-result__conclusion">{cleanSentenceText(r.conclusion, "暂无明确结论。")}</p>
                      {r.evidence.length > 0 && (
                        <ul className="review-result__evidence">
                          {r.evidence.map((ev, j) => (
                            <li key={j}>
                              {cleanSentenceText(ev.text, "暂无可展示依据。")}
                              {ev.source && <span className="source-badge">来源：{cleanDisplayText(ev.source, "未注明来源")}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.actions.length > 0 && (
                        <div className="review-result__actions">
                          <strong>建议行动：</strong>{r.actions.map((action) => cleanDisplayText(action, "")).filter(Boolean).join("；")}
                        </div>
                      )}
                    </div>
                  ))}

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

// ── L1 Skill 生产线 ──────────────────────────────────────────────────────────

function L1Tab() {
  const [stats, setStats] = useState<L1Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchL1Stats().then(setStats).catch(e => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">加载失败：{err}</div>;
  if (!stats) return <div className="admin-empty">加载中…</div>;

  const VERDICT_LABEL: Record<string, string> = { pass: "✅ 通过", redo: "🔄 重做", fail: "❌ 失败", unknown: "—" };
  const STATUS_LABEL: Record<string, string> = {
    pending_human: "⏳ 待人审",
    approved: "✅ 已上线",
    rejected: "❌ 已拒绝",
    not_ready: "🔴 未就绪",
    no_eval: "—",
  };

  return (
    <div className="loop-tab">
      <h3 className="loop-tab__title">Skill 生产线状态</h3>
      <div className="loop-stats-row">
        <div className="loop-stat"><span className="loop-stat__num">{stats.total_configs}</span><span className="loop-stat__label">配置文件总数</span></div>
        <div className="loop-stat loop-stat--warn"><span className="loop-stat__num">{stats.pending_review}</span><span className="loop-stat__label">待人审候选</span></div>
        <div className="loop-stat loop-stat--ok"><span className="loop-stat__num">{stats.approved}</span><span className="loop-stat__label">已上线</span></div>
        <div className="loop-stat loop-stat--err"><span className="loop-stat__num">{stats.failed}</span><span className="loop-stat__label">机器淘汰</span></div>
      </div>
      <h4 className="loop-tab__subtitle">候选详情</h4>
      {stats.candidates.length === 0
        ? <p className="admin-empty">暂无评测记录——先运行 /factory 生产候选</p>
        : (
          <table className="loop-table">
            <thead>
              <tr><th>Skill</th><th>机器判定</th><th>L1</th><th>L2通过率</th><th>信号准确率</th><th>异常</th><th>人审状态</th><th>人审备注</th></tr>
            </thead>
            <tbody>
              {stats.candidates.map(c => (
                <tr key={c.key} className={c.verdict === "fail" ? "loop-table__row--err" : c.review_status === "pending_human" ? "loop-table__row--warn" : ""}>
                  <td><code>{c.key}</code><br /><small>{c.label ?? ""}</small></td>
                  <td>{VERDICT_LABEL[c.verdict] ?? c.verdict}</td>
                  <td>{c.l1_passed ? "✅" : "❌"}</td>
                  <td>{(c.l2_rate * 100).toFixed(0)}%</td>
                  <td>{(c.signal_accuracy * 100).toFixed(0)}%</td>
                  <td>{c.error_count > 0 ? <span className="badge-err">{c.error_count}</span> : "—"}</td>
                  <td>{STATUS_LABEL[c.review_status] ?? c.review_status}</td>
                  <td><small>{c.review_notes ?? "—"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}

// ── L2 Router 健康 ────────────────────────────────────────────────────────────

function L2Tab() {
  const [stats, setStats] = useState<L2Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchL2Stats().then(setStats).catch(e => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">加载失败：{err}</div>;
  if (!stats) return <div className="admin-empty">加载中…</div>;

  const fpRate = (stats.keyword_false_positive_rate * 100).toFixed(0);
  const missRate = (stats.missed_recall_rate * 100).toFixed(0);

  return (
    <div className="loop-tab">
      <h3 className="loop-tab__title">Router 召回健康</h3>
      <p className="loop-tab__desc">收集器在每次诊断后自动记录召回决策。样本攒够 50 条后可离线重训关键词权重。</p>
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
      <h4 className="loop-tab__subtitle">各 Skill 召回频次</h4>
      <table className="loop-table">
        <thead><tr><th>Skill</th><th>召回次数</th><th>来源分布</th></tr></thead>
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

// ── L3 案例飞轮 ───────────────────────────────────────────────────────────────

function L3Tab() {
  const [stats, setStats] = useState<L3Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchL3Stats().then(setStats).catch(e => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">加载失败：{err}</div>;
  if (!stats) return <div className="admin-empty">加载中…</div>;

  return (
    <div className="loop-tab">
      <h3 className="loop-tab__title">案例飞轮资产</h3>
      <p className="loop-tab__desc">每次诊断完成后自动脱敏归档。案例越多，系统对各行业理解越深——这是真护城河。</p>
      <div className="loop-stats-row">
        <div className="loop-stat"><span className="loop-stat__num">{stats.total_cases}</span><span className="loop-stat__label">脱敏案例总数</span></div>
        <div className="loop-stat"><span className="loop-stat__num">{stats.industry_distribution.length}</span><span className="loop-stat__label">覆盖行业数</span></div>
      </div>
      <div className="loop-two-col">
        <div>
          <h4 className="loop-tab__subtitle">行业分布</h4>
          {stats.industry_distribution.length === 0
            ? <p className="admin-empty">暂无案例</p>
            : (
              <table className="loop-table">
                <thead><tr><th>行业</th><th>案例数</th></tr></thead>
                <tbody>
                  {stats.industry_distribution.map(d => (
                    <tr key={d.industry}><td>{d.industry}</td><td>{d.count}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <div>
          <h4 className="loop-tab__subtitle">最近归档</h4>
          {stats.recent_cases.length === 0
            ? <p className="admin-empty">暂无归档</p>
            : (
              <table className="loop-table">
                <thead><tr><th>行业</th><th>业务描述</th><th>召回 Skill</th><th>归档时间</th></tr></thead>
                <tbody>
                  {stats.recent_cases.map(c => (
                    <tr key={c.id}>
                      <td>{c.industry}</td>
                      <td><small>{c.company_profile || "—"}</small></td>
                      <td><small>{c.skills_used.join("、") || "—"}</small></td>
                      <td><small>{c.created_at.slice(0, 16)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}

// ── L4 Composer 质量 ─────────────────────────────────────────────────────────

function L4Tab() {
  const [stats, setStats] = useState<L4Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchL4Stats().then(setStats).catch(e => setErr(String(e))); }, []);

  if (err) return <div className="admin-empty">加载失败：{err}</div>;
  if (!stats) return <div className="admin-empty">加载中…</div>;

  return (
    <div className="loop-tab">
      <h3 className="loop-tab__title">Composer / 作战方案质量</h3>
      <p className="loop-tab__desc">Composer 三层架构（骨架→LLM叙事改写→critic回退）的运行指标与用户反馈。</p>
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
