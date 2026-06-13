import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listActiveSkills,
  listSkillVersions,
  addSkillVersion,
  activateSkillVersion,
  listLLMConfigs,
  createLLMConfig,
  deleteLLMConfig,
  patchLLMConfig,
} from "../../api/client";
import type { SkillVersionOut, LLMConfigOut } from "../../types";
import "./AdminPage.css";

type Tab = "skills" | "models";

export function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("skills");

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <header className="admin-head">
        <h1 className="admin-title">后台管理</h1>
        <button type="button" className="admin-back" onClick={() => navigate("/projects")}>
          ← 返回项目
        </button>
      </header>

      <div className="admin-tabs">
        <button
          type="button"
          className={tab === "skills" ? "admin-tab admin-tab--on" : "admin-tab"}
          onClick={() => setTab("skills")}
        >
          Skill 管理
        </button>
        <button
          type="button"
          className={tab === "models" ? "admin-tab admin-tab--on" : "admin-tab"}
          onClick={() => setTab("models")}
        >
          模型配置
        </button>
      </div>

      {tab === "skills" ? <SkillsTab /> : <ModelsTab />}
    </div>
  );
}

function SkillsTab() {
  const [skills, setSkills] = useState<SkillVersionOut[] | null>(null);
  const [versions, setVersions] = useState<SkillVersionOut[] | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => { listActiveSkills().then(setSkills).catch(() => {}); };
  useEffect(load, []);

  const openModule = async (module: string, currentPrompt: string) => {
    setActiveModule(module);
    setEditPrompt(currentPrompt);
    setReason("");
    setMsg(null);
    setVersions(await listSkillVersions(module));
  };

  const submit = async () => {
    if (!activeModule || !reason.trim()) {
      setMsg("请填写改动理由");
      return;
    }
    try {
      await addSkillVersion(activeModule, editPrompt, reason.trim());
      setMsg("已保存并激活新版本");
      setVersions(await listSkillVersions(activeModule));
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const activate = async (versionId: string) => {
    if (!activeModule) return;
    await activateSkillVersion(activeModule, versionId);
    setVersions(await listSkillVersions(activeModule));
    load();
  };

  return (
    <div className="admin-cols">
      <div className="admin-list">
        {skills === null && <p className="admin-muted">加载中…</p>}
        {skills?.map((s) => (
          <button
            key={s.id}
            type="button"
            className={activeModule === s.module ? "admin-skill admin-skill--on" : "admin-skill"}
            onClick={() => openModule(s.module, s.system_prompt)}
          >
            <span className="admin-skill__name">{s.module}</span>
            <span className="admin-skill__meta">v{s.version}</span>
          </button>
        ))}
      </div>

      <div className="admin-editor">
        {!activeModule ? (
          <p className="admin-muted">选择左侧一个 skill 查看/编辑其 prompt。</p>
        ) : (
          <>
            <h3 className="admin-editor__title">{activeModule} · 编辑 prompt</h3>
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
              保存为新版本并激活
            </button>
            {msg && <p className="admin-msg">{msg}</p>}

            <h4 className="admin-editor__subtitle">版本历史</h4>
            <div className="admin-versions">
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
    load();
  };

  const toggle = async (c: LLMConfigOut) => {
    await patchLLMConfig(c.id, { is_active: !c.is_active });
    load();
  };

  return (
    <div className="admin-models">
      <div className="admin-config-form">
        <h3 className="admin-editor__title">新增模型配置</h3>
        <p className="admin-muted">priority 小的为主，大的为备用；主失败自动切备用。</p>
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
          <div key={c.id} className="admin-config">
            <div className="admin-config__main">
              <span className="admin-config__name">
                {c.name} <em className="admin-config__pri">优先级 {c.priority}</em>
                {!c.is_active && <em className="admin-config__off">已停用</em>}
              </span>
              <span className="admin-config__meta">{c.provider} · {c.model} · {c.api_key_masked}</span>
            </div>
            <div className="admin-config__actions">
              <button type="button" className="admin-mini" onClick={() => toggle(c)}>
                {c.is_active ? "停用" : "启用"}
              </button>
              <button type="button" className="admin-mini admin-mini--danger" onClick={() => remove(c.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
