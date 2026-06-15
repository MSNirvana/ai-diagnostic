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
} from "../../api/client";
import type { SkillRegistryItem, SkillVersionOut, LLMConfigOut } from "../../types";
import { AppShell } from "../Layout/AppShell";
import "./AdminPage.css";

type Tab = "skills" | "models";

type SkillGroupKey = "intake" | "questionnaire" | "core" | "professional" | "industry" | "delivery" | "other";
type SkillFilterKey = SkillGroupKey | "all";

const SKILL_GROUPS: Array<{
  key: SkillGroupKey;
  title: string;
  shortTitle: string;
}> = [
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
}, { intake: 0, questionnaire: 0, core: 0, professional: 0, industry: 0, delivery: 0, other: 0 });

const SKILL_CATEGORY_ORDER: Record<string, number> = {
  intake: 10,
  questionnaire: 20,
  core: 30,
  professional: 40,
  industry: 50,
  delivery: 60,
  other: 90,
};

function normalizeGroup(category: string, skillType?: string): SkillGroupKey {
  if (category === "intake" || category === "questionnaire" || category === "core" || category === "professional" || category === "industry" || category === "delivery") {
    return category;
  }
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
          返回项目中心
        </button>
      }
    >
      <section className="admin-shell">
        <div className="admin-tabs" aria-label="后台模块切换">
          <button
            type="button"
            className={tab === "skills" ? "admin-tab admin-tab--on" : "admin-tab"}
            onClick={() => setTab("skills")}
          >
            专家方法库
          </button>
          <button
            type="button"
            className={tab === "models" ? "admin-tab admin-tab--on" : "admin-tab"}
            onClick={() => setTab("models")}
          >
            模型通道
          </button>
        </div>

        {tab === "skills" ? <SkillsTab /> : <ModelsTab />}
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
  }, { intake: 0, questionnaire: 0, core: 0, professional: 0, industry: 0, delivery: 0, other: 0 });
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
