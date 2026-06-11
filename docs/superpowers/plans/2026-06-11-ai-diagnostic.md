# AI 咨询诊断系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 AI 企业诊断系统：老板按模块问卷提交现状，后端按模块调用专家 skill（抓数据、内外对比、分析），前端分模块卡片展示"结论+证据+行动"，可下钻看事实支撑。

**Architecture:** FastAPI 后端承载分诊编排中枢 + skill 执行层 + LLM 抽象层；React 前端承载问卷、结果看板、卡片下钻。第一版先做"通用骨架 + 1 个完整样板模块（市场与客户）"跑通端到端闭环，其余 5 模块照样板复制。

**Tech Stack:** Python 3.11 / FastAPI / Pydantic / pytest（后端）；React 18 / TypeScript / Vite / Vitest（前端）；LLMClient 抽象层支持 Claude + OpenAI 切换。

---

## 文件结构

### 后端 `backend/`

```
backend/
  app/
    main.py                    # FastAPI 入口，挂载路由
    config.py                  # 配置（API keys、模型选择）从环境变量读
    llm/
      base.py                  # LLMClient 抽象基类（接口契约）
      anthropic_client.py      # Claude 实现
      openai_client.py         # OpenAI 实现
      factory.py               # 按配置返回对应 LLMClient
    skills/
      base.py                  # Skill 抽象基类 + SkillInput/SkillOutput 数据模型
      registry.py              # skill 注册表：模块名 -> Skill 实例
      market.py                # 样板 skill：市场与客户
    orchestrator/
      dispatcher.py            # 分诊中枢：读问卷 -> 选 skill -> 执行 -> 汇总
    data/
      uploads.py               # 解析上传的表格（CSV/Excel）-> 结构化
      external.py              # 外部数据抓取接口（联网拿行业基准/竞品）
    filters/
      moat.py                  # 护城河过滤：拦截/改写方法论术语
    models/
      questionnaire.py         # 问卷数据模型（模块、题目、答案）
      result.py                # 结果卡片数据模型（结论/证据/行动/下钻包）
    api/
      diagnose.py              # POST /diagnose 端点
  tests/
    test_llm_factory.py
    test_skill_base.py
    test_market_skill.py
    test_dispatcher.py
    test_moat_filter.py
    test_uploads.py
    test_diagnose_api.py
  pyproject.toml
  .env.example
```

### 前端 `frontend/`

```
frontend/
  src/
    api/client.ts              # 调后端 /diagnose
    types.ts                   # 与后端 result 模型对应的 TS 类型
    components/
      Questionnaire/           # 模块化问卷（含自适应追问）
      Dashboard/               # 6 模块卡片看板（健康度信号）
      ModuleCard/              # 单模块卡片（结论先行表层）
      DrillDown/               # 查看更多（只露事实的下钻）
    App.tsx
  tests/
  package.json
  vite.config.ts
```

### 职责边界（每个文件一个清晰责任）

- **llm/**：只管"怎么调模型"，不含业务。换模型只改这层。
- **skills/**：每个 skill 一个文件，自声明方法，服务端执行（护城河）。
- **orchestrator/**：只管"调谁、按什么顺序、怎么汇总"，不含具体诊断逻辑。
- **filters/moat.py**：输出离开后端前的最后一道术语过滤。
- **models/**：纯数据契约，前后端对齐的依据。

---

## Task 1: 后端项目骨架

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/app/__init__.py`、`backend/app/main.py`
- Create: `backend/tests/__init__.py`

- [ ] **Step 1: 创建 pyproject.toml**

```toml
[project]
name = "ai-diagnostic"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "uvicorn>=0.29",
  "pydantic>=2.6",
  "anthropic>=0.25",
  "openai>=1.30",
  "pandas>=2.2",
  "openpyxl>=3.1",
  "httpx>=0.27",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: 创建 .env.example**

```
LLM_PROVIDER=anthropic   # anthropic | openai
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
LLM_MODEL=claude-opus-4-8
```

- [ ] **Step 3: 创建最小 main.py**

```python
from fastapi import FastAPI

app = FastAPI(title="AI Diagnostic")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: 安装依赖并验证服务启动**

Run: `cd backend && pip install -e ".[dev]" && python -c "from app.main import app; print('ok')"`
Expected: 打印 `ok`，无导入错误

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "chore: 后端项目骨架"
```

---

## Task 2: LLM 抽象层基类与契约

**Files:**
- Create: `backend/app/llm/__init__.py`
- Create: `backend/app/llm/base.py`
- Test: `backend/tests/test_llm_factory.py`（本任务先建基类，工厂在 Task 3）

- [ ] **Step 1: 写失败测试 — 抽象基类定义了 complete 接口**

```python
# backend/tests/test_llm_factory.py
import pytest
from app.llm.base import LLMClient


def test_llmclient_is_abstract():
    with pytest.raises(TypeError):
        LLMClient()  # 抽象类不可实例化


def test_subclass_must_implement_complete():
    class Incomplete(LLMClient):
        pass
    with pytest.raises(TypeError):
        Incomplete()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_llm_factory.py -v`
Expected: FAIL，提示 `No module named 'app.llm.base'`

- [ ] **Step 3: 实现 LLMClient 抽象基类**

```python
# backend/app/llm/base.py
from abc import ABC, abstractmethod


class LLMClient(ABC):
    """所有模型实现的统一契约。业务层只依赖这个接口。"""

    @abstractmethod
    async def complete(self, system: str, prompt: str) -> str:
        """给定 system 指令和用户 prompt，返回模型文本输出。"""
        ...
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_llm_factory.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/ backend/tests/test_llm_factory.py
git commit -m "feat: LLMClient 抽象基类"
```

---

## Task 3: LLM 工厂 + 两家实现

**Files:**
- Create: `backend/app/llm/anthropic_client.py`
- Create: `backend/app/llm/openai_client.py`
- Create: `backend/app/llm/factory.py`
- Create: `backend/app/config.py`
- Modify: `backend/tests/test_llm_factory.py`

- [ ] **Step 1: 追加失败测试 — 工厂按配置返回正确实现**

```python
# 追加到 backend/tests/test_llm_factory.py
from app.llm.factory import make_llm_client
from app.llm.anthropic_client import AnthropicClient
from app.llm.openai_client import OpenAIClient


def test_factory_returns_anthropic():
    client = make_llm_client(provider="anthropic", api_key="x", model="claude-opus-4-8")
    assert isinstance(client, AnthropicClient)


def test_factory_returns_openai():
    client = make_llm_client(provider="openai", api_key="x", model="gpt-4o")
    assert isinstance(client, OpenAIClient)


def test_factory_rejects_unknown():
    with pytest.raises(ValueError):
        make_llm_client(provider="nope", api_key="x", model="m")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_llm_factory.py -v`
Expected: FAIL，`No module named 'app.llm.factory'`

- [ ] **Step 3: 实现两家 client（构造时不发请求）**

```python
# backend/app/llm/anthropic_client.py
from anthropic import AsyncAnthropic
from app.llm.base import LLMClient


class AnthropicClient(LLMClient):
    def __init__(self, api_key: str, model: str):
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text
```

```python
# backend/app/llm/openai_client.py
from openai import AsyncOpenAI
from app.llm.base import LLMClient


class OpenAIClient(LLMClient):
    def __init__(self, api_key: str, model: str):
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return resp.choices[0].message.content or ""
```

- [ ] **Step 4: 实现工厂**

```python
# backend/app/llm/factory.py
from app.llm.base import LLMClient
from app.llm.anthropic_client import AnthropicClient
from app.llm.openai_client import OpenAIClient


def make_llm_client(provider: str, api_key: str, model: str) -> LLMClient:
    if provider == "anthropic":
        return AnthropicClient(api_key=api_key, model=model)
    if provider == "openai":
        return OpenAIClient(api_key=api_key, model=model)
    raise ValueError(f"unknown LLM provider: {provider}")
```

- [ ] **Step 5: 实现 config.py（从环境变量读）**

```python
# backend/app/config.py
import os
from app.llm.base import LLMClient
from app.llm.factory import make_llm_client


def get_llm_client() -> LLMClient:
    provider = os.environ.get("LLM_PROVIDER", "anthropic")
    model = os.environ.get("LLM_MODEL", "claude-opus-4-8")
    key_var = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
    api_key = os.environ.get(key_var, "")
    return make_llm_client(provider=provider, api_key=api_key, model=model)
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd backend && pytest tests/test_llm_factory.py -v`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/llm/ backend/app/config.py backend/tests/test_llm_factory.py
git commit -m "feat: LLM 工厂 + Claude/OpenAI 双实现"
```

---

## Task 4: 核心数据模型（问卷 + 结果）

**Files:**
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/questionnaire.py`
- Create: `backend/app/models/result.py`
- Test: `backend/tests/test_models.py`

- [ ] **Step 1: 写失败测试 — 模型可构造且字段约束生效**

```python
# backend/tests/test_models.py
import pytest
from pydantic import ValidationError
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import Evidence, ModuleResult


def test_questionnaire_holds_module_answers():
    q = Questionnaire(answers=[
        ModuleAnswer(module="market", facts={"revenue": "1000万"}, pains=["打不过竞品"])
    ])
    assert q.answers[0].module == "market"


def test_module_result_caps_evidence_at_three():
    with pytest.raises(ValidationError):
        ModuleResult(
            module="market", signal="red", conclusion="x",
            evidence=[Evidence(text=f"e{i}", source="s") for i in range(4)],
            actions=["a"],
        )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_models.py -v`
Expected: FAIL，`No module named 'app.models.questionnaire'`

- [ ] **Step 3: 实现问卷模型**

```python
# backend/app/models/questionnaire.py
from pydantic import BaseModel, Field


class ModuleAnswer(BaseModel):
    module: str                       # market/product/sales/ops/org/finance
    facts: dict[str, str] = Field(default_factory=dict)   # 客观事实题
    pains: list[str] = Field(default_factory=list)        # 主观痛点题
    uploaded_files: list[str] = Field(default_factory=list)  # 上传文件路径


class Questionnaire(BaseModel):
    answers: list[ModuleAnswer]
```

- [ ] **Step 4: 实现结果模型**

```python
# backend/app/models/result.py
from typing import Literal
from pydantic import BaseModel, Field


class Evidence(BaseModel):
    text: str                 # "获客成本 ¥420，行业中位 ¥180"
    source: str               # "来自你上传的销售表" / "XX行业报告 2026.05"


class DrillDown(BaseModel):
    """下钻包：只露事实，不含方法。"""
    data_points: list[Evidence] = Field(default_factory=list)
    comparisons: list[str] = Field(default_factory=list)   # 数值对比描述


class ModuleResult(BaseModel):
    module: str
    signal: Literal["red", "yellow", "green"]
    conclusion: str                                  # 结论先行（So-What）
    evidence: list[Evidence] = Field(max_length=3)   # 表层 ≤3 条
    actions: list[str] = Field(min_length=1)         # 行动建议
    drilldown: DrillDown | None = None
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && pytest tests/test_models.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/ backend/tests/test_models.py
git commit -m "feat: 问卷与结果数据模型"
```

---

## Task 5: Skill 抽象基类与契约

**Files:**
- Create: `backend/app/skills/__init__.py`
- Create: `backend/app/skills/base.py`
- Test: `backend/tests/test_skill_base.py`

- [ ] **Step 1: 写失败测试 — Skill 契约：声明元信息 + 异步 diagnose**

```python
# backend/tests/test_skill_base.py
import pytest
from app.skills.base import Skill
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult


def test_skill_is_abstract():
    with pytest.raises(TypeError):
        Skill()


async def test_concrete_skill_returns_module_result():
    class FakeSkill(Skill):
        module = "market"
        method = "hypothesis"

        async def diagnose(self, answer, llm) -> ModuleResult:
            return ModuleResult(
                module="market", signal="green", conclusion="ok",
                evidence=[], actions=["维持现状"],
            )

    result = await FakeSkill().diagnose(
        ModuleAnswer(module="market"), llm=None
    )
    assert result.module == "market"
    assert FakeSkill().method == "hypothesis"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_skill_base.py -v`
Expected: FAIL，`No module named 'app.skills.base'`

- [ ] **Step 3: 实现 Skill 基类**

```python
# backend/app/skills/base.py
from abc import ABC, abstractmethod
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult


class Skill(ABC):
    """专家 skill 契约：只规定边界，不规定内部方法。

    子类声明 module（模块归属）和 method（自声明方法类型，
    如 hypothesis/metrics/framework/process）。内部怎么诊断由子类自由实现，
    全部在服务端执行——这是护城河。
    """

    module: str
    method: str

    @abstractmethod
    async def diagnose(self, answer: ModuleAnswer, llm: LLMClient) -> ModuleResult:
        ...
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_skill_base.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/skills/ backend/tests/test_skill_base.py
git commit -m "feat: Skill 抽象基类与契约"
```

---

## Task 6: 护城河术语过滤

**Files:**
- Create: `backend/app/filters/__init__.py`
- Create: `backend/app/filters/moat.py`
- Test: `backend/tests/test_moat_filter.py`

- [ ] **Step 1: 写失败测试 — 过滤方法论术语**

```python
# backend/tests/test_moat_filter.py
from app.filters.moat import scrub_method_language
from app.models.result import ModuleResult, Evidence


def test_scrub_removes_method_terms_from_conclusion():
    r = ModuleResult(
        module="market", signal="red",
        conclusion="我们先立假设，再做敏感性分析，发现定价偏高",
        evidence=[Evidence(text="定价高于竞品18%", source="行业报告")],
        actions=["下调定价"],
    )
    cleaned = scrub_method_language(r)
    assert "假设" not in cleaned.conclusion
    assert "敏感性分析" not in cleaned.conclusion
    # 事实证据不受影响
    assert cleaned.evidence[0].text == "定价高于竞品18%"


def test_scrub_is_idempotent():
    r = ModuleResult(
        module="market", signal="green", conclusion="定价合理",
        evidence=[], actions=["维持"],
    )
    assert scrub_method_language(r).conclusion == "定价合理"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_moat_filter.py -v`
Expected: FAIL，`No module named 'app.filters.moat'`

- [ ] **Step 3: 实现过滤器**

```python
# backend/app/filters/moat.py
import re
from app.models.result import ModuleResult

# 面向老板文案中禁止出现的方法论术语
BANNED_TERMS = [
    "假设", "敏感性分析", "框架", "方法论", "波特五力",
    "BCG", "MECE", "金字塔原理", "建模", "指标体检",
]

_PATTERN = re.compile("|".join(re.escape(t) for t in BANNED_TERMS))


def _scrub(text: str) -> str:
    # 去掉含术语的小句，保留事实陈述
    parts = re.split(r"[，。；]", text)
    kept = [p for p in parts if p and not _PATTERN.search(p)]
    return "，".join(kept) if kept else text


def scrub_method_language(result: ModuleResult) -> ModuleResult:
    """离开后端前最后一道过滤：清洗面向老板的文案，不动事实数据。"""
    return result.model_copy(update={
        "conclusion": _scrub(result.conclusion),
        "actions": [_scrub(a) for a in result.actions],
    })
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_moat_filter.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/filters/ backend/tests/test_moat_filter.py
git commit -m "feat: 护城河术语过滤"
```

---

## Task 7: 上传表格解析

**Files:**
- Create: `backend/app/data/__init__.py`
- Create: `backend/app/data/uploads.py`
- Test: `backend/tests/test_uploads.py`

- [ ] **Step 1: 写失败测试 — CSV 解析为结构化摘要**

```python
# backend/tests/test_uploads.py
import io
from app.data.uploads import parse_table


def test_parse_csv_returns_summary():
    csv_bytes = b"month,sales\n2026-01,100\n2026-02,150\n2026-03,90\n"
    summary = parse_table(filename="sales.csv", content=csv_bytes)
    assert summary["row_count"] == 3
    assert "sales" in summary["columns"]
    assert summary["numeric_stats"]["sales"]["sum"] == 340


def test_parse_rejects_unknown_extension():
    import pytest
    with pytest.raises(ValueError):
        parse_table(filename="x.txt", content=b"abc")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_uploads.py -v`
Expected: FAIL，`No module named 'app.data.uploads'`

- [ ] **Step 3: 实现解析**

```python
# backend/app/data/uploads.py
import io
import pandas as pd


def parse_table(filename: str, content: bytes) -> dict:
    """解析上传的 CSV/Excel，返回结构化摘要（喂给 skill 当内部数据）。"""
    name = filename.lower()
    if name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    elif name.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        raise ValueError(f"unsupported file type: {filename}")

    numeric = df.select_dtypes("number")
    stats = {
        col: {
            "sum": float(numeric[col].sum()),
            "mean": float(numeric[col].mean()),
        }
        for col in numeric.columns
    }
    return {
        "row_count": int(len(df)),
        "columns": list(df.columns),
        "numeric_stats": stats,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_uploads.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/ backend/tests/test_uploads.py
git commit -m "feat: 上传表格解析"
```

---

## Task 8: 市场样板 Skill

**Files:**
- Create: `backend/app/data/external.py`（外部数据抓取接口，先做可注入的桩）
- Create: `backend/app/skills/market.py`
- Create: `backend/app/skills/registry.py`
- Test: `backend/tests/test_market_skill.py`

- [ ] **Step 1: 写失败测试 — market skill 产出合规 ModuleResult**

测试用 fake LLM（返回固定 JSON），不打真实 API。

```python
# backend/tests/test_market_skill.py
import json
from app.skills.market import MarketSkill
from app.models.questionnaire import ModuleAnswer


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "定价高于竞品，价格是流失主因",
            "evidence": [{"text": "定价高于top3竞品18%", "source": "行业报告2026.05"}],
            "actions": ["下调定价至竞品区间", "强化差异化卖点"],
            "drilldown": {
                "data_points": [{"text": "你客单价¥420 vs 行业¥350", "source": "你上传的销售表"}],
                "comparisons": ["客单价高出行业20%"],
            },
        })


async def test_market_skill_declares_metadata():
    skill = MarketSkill()
    assert skill.module == "market"
    assert skill.method  # 自声明方法非空


async def test_market_skill_returns_valid_result():
    skill = MarketSkill()
    answer = ModuleAnswer(module="market", facts={"客单价": "420"}, pains=["打不过竞品"])
    result = await skill.diagnose(answer, llm=FakeLLM())
    assert result.module == "market"
    assert result.signal == "red"
    assert len(result.evidence) <= 3
    assert len(result.actions) >= 1
    assert result.drilldown is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_market_skill.py -v`
Expected: FAIL，`No module named 'app.skills.market'`

- [ ] **Step 3: 实现外部数据桩**

```python
# backend/app/data/external.py
async def fetch_industry_benchmark(module: str, keywords: list[str]) -> dict:
    """抓外部行业基准/竞品数据。第一版返回桩数据，后续接真实数据源。"""
    return {
        "module": module,
        "keywords": keywords,
        "benchmark": {"note": "external benchmark placeholder"},
    }
```

- [ ] **Step 4: 实现 MarketSkill**

```python
# backend/app/skills/market.py
import json
from app.skills.base import Skill
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult, Evidence, DrillDown
from app.data.external import fetch_industry_benchmark

# 护城河：方法/框架/提示词全部留在服务端这个常量里，绝不下发
_SYSTEM = """你是顶级管理咨询的市场与客户诊断专家。
基于给定的企业现状和行业基准，做内外对比诊断。
内部工作方法：先立假设，再用数据证实/证伪（不要在输出里暴露这套方法）。
严格输出 JSON：{signal, conclusion, evidence[], actions[], drilldown{data_points[], comparisons[]}}。
- signal: red/yellow/green
- conclusion: 结论先行，一句话讲清核心问题
- evidence: 最多3条，每条 {text, source}，用结果语言陈述事实
- actions: 2-3条按优先级
- drilldown: 只放事实数据和对比，不写方法/假设/框架"""


class MarketSkill(Skill):
    module = "market"
    method = "hypothesis"   # 自声明：假设驱动

    async def diagnose(self, answer: ModuleAnswer, llm: LLMClient) -> ModuleResult:
        benchmark = await fetch_industry_benchmark("market", answer.pains)
        prompt = json.dumps({
            "facts": answer.facts,
            "pains": answer.pains,
            "benchmark": benchmark,
        }, ensure_ascii=False)
        raw = await llm.complete(system=_SYSTEM, prompt=prompt)
        data = json.loads(raw)
        return ModuleResult(
            module=self.module,
            signal=data["signal"],
            conclusion=data["conclusion"],
            evidence=[Evidence(**e) for e in data["evidence"][:3]],
            actions=data["actions"],
            drilldown=DrillDown(
                data_points=[Evidence(**e) for e in data["drilldown"]["data_points"]],
                comparisons=data["drilldown"]["comparisons"],
            ),
        )
```

- [ ] **Step 5: 实现注册表**

```python
# backend/app/skills/registry.py
from app.skills.base import Skill
from app.skills.market import MarketSkill

_SKILLS: dict[str, Skill] = {
    "market": MarketSkill(),
}


def get_skill(module: str) -> Skill | None:
    return _SKILLS.get(module)


def registered_modules() -> list[str]:
    return list(_SKILLS.keys())
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd backend && pytest tests/test_market_skill.py -v`
Expected: 2 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/skills/ backend/app/data/external.py backend/tests/test_market_skill.py
git commit -m "feat: 市场样板 skill + 注册表 + 外部数据桩"
```

---

## Task 9: 分诊编排中枢

**Files:**
- Create: `backend/app/orchestrator/__init__.py`
- Create: `backend/app/orchestrator/dispatcher.py`
- Test: `backend/tests/test_dispatcher.py`

- [ ] **Step 1: 写失败测试 — 按问卷调用对应 skill 并过滤输出**

```python
# backend/tests/test_dispatcher.py
import json
from app.orchestrator.dispatcher import diagnose_all
from app.models.questionnaire import Questionnaire, ModuleAnswer


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "我们先立假设，定价偏高是主因",  # 含术语，应被过滤
            "evidence": [{"text": "定价高18%", "source": "行业报告"}],
            "actions": ["下调定价"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


async def test_dispatcher_runs_registered_module():
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["竞品强"])])
    results = await diagnose_all(q, llm=FakeLLM())
    assert len(results) == 1
    assert results[0].module == "market"
    # 护城河过滤已生效
    assert "假设" not in results[0].conclusion


async def test_dispatcher_skips_unregistered_module():
    q = Questionnaire(answers=[ModuleAnswer(module="unknown")])
    results = await diagnose_all(q, llm=FakeLLM())
    assert results == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_dispatcher.py -v`
Expected: FAIL，`No module named 'app.orchestrator.dispatcher'`

- [ ] **Step 3: 实现分诊中枢**

```python
# backend/app/orchestrator/dispatcher.py
import asyncio
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.skills.registry import get_skill
from app.filters.moat import scrub_method_language


async def diagnose_all(q: Questionnaire, llm: LLMClient) -> list[ModuleResult]:
    """读问卷 -> 对每个有对应 skill 的模块并行诊断 -> 护城河过滤后汇总。"""
    tasks = []
    for answer in q.answers:
        skill = get_skill(answer.module)
        if skill is not None:
            tasks.append(skill.diagnose(answer, llm))

    raw_results = await asyncio.gather(*tasks)
    return [scrub_method_language(r) for r in raw_results]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pytest tests/test_dispatcher.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestrator/ backend/tests/test_dispatcher.py
git commit -m "feat: 分诊编排中枢（并行调用+护城河过滤）"
```

---

## Task 10: 诊断 API 端点

**Files:**
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/diagnose.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_diagnose_api.py`

- [ ] **Step 1: 写失败测试 — POST /diagnose 返回模块结果**

用依赖覆盖注入 fake LLM，不打真实 API。

```python
# backend/tests/test_diagnose_api.py
import json
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_llm_client


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "定价偏高是流失主因",
            "evidence": [{"text": "定价高18%", "source": "行业报告"}],
            "actions": ["下调定价"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
client = TestClient(app)


def test_diagnose_returns_results():
    resp = client.post("/diagnose", json={
        "answers": [{"module": "market", "facts": {}, "pains": ["竞品强"]}]
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"][0]["module"] == "market"
    assert body["results"][0]["signal"] == "red"


def test_diagnose_empty_answers_returns_empty():
    resp = client.post("/diagnose", json={"answers": []})
    assert resp.status_code == 200
    assert resp.json()["results"] == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pytest tests/test_diagnose_api.py -v`
Expected: FAIL，`/diagnose` 404 或导入错误

- [ ] **Step 3: 实现端点**

```python
# backend/app/api/diagnose.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.orchestrator.dispatcher import diagnose_all

router = APIRouter()


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose(
    questionnaire: Questionnaire,
    llm: LLMClient = Depends(get_llm_client),
) -> DiagnoseResponse:
    results = await diagnose_all(questionnaire, llm)
    return DiagnoseResponse(results=results)
```

- [ ] **Step 4: 挂载路由到 main.py**

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.diagnose import router as diagnose_router

app = FastAPI(title="AI Diagnostic")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # 前端 dev
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(diagnose_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && pytest tests/test_diagnose_api.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/ backend/app/main.py backend/tests/test_diagnose_api.py
git commit -m "feat: POST /diagnose 端点"
```

---

## Task 11: 后端全量集成验证

**Files:**
- 无新增；运行全套测试 + 手动冒烟

- [ ] **Step 1: 运行全部后端测试**

Run: `cd backend && pytest -v`
Expected: 所有测试 PASS（test_llm_factory / test_models / test_skill_base / test_moat_filter / test_uploads / test_market_skill / test_dispatcher / test_diagnose_api）

- [ ] **Step 2: 手动冒烟（用真实 LLM，需配 .env）**

先把 `.env.example` 复制为 `.env` 并填入真实 key：

```bash
cd backend && cp .env.example .env
# 编辑 .env 填入 ANTHROPIC_API_KEY
```

启动服务：

Run: `cd backend && uvicorn app.main:app --reload`
Expected: 服务在 http://127.0.0.1:8000 启动

另开终端调用：

```bash
curl -X POST http://127.0.0.1:8000/diagnose \
  -H "Content-Type: application/json" \
  -d '{"answers":[{"module":"market","facts":{"客单价":"420"},"pains":["打不过竞品"]}]}'
```

Expected: 返回含 `results[0].module == "market"`、有 conclusion/evidence/actions/drilldown 的 JSON，且 conclusion 中不含"假设/框架"等术语

- [ ] **Step 3: Commit（若冒烟中有修正）**

```bash
git add -A
git commit -m "test: 后端集成验证通过"
```

---

## Task 12: 前端骨架 + 类型 + API 客户端

**Files:**
- Create: `frontend/package.json`、`frontend/vite.config.ts`、`frontend/tsconfig.json`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/main.tsx`、`frontend/src/App.tsx`
- Test: `frontend/tests/client.test.ts`

- [ ] **Step 1: 初始化 Vite React-TS 工程**

Run: `cd frontend && npm create vite@latest . -- --template react-ts && npm install && npm install -D vitest`
Expected: 生成标准 React-TS 工程，依赖安装成功

- [ ] **Step 2: 定义与后端对齐的类型**

```typescript
// frontend/src/types.ts
export interface Evidence {
  text: string;
  source: string;
}
export interface DrillDown {
  data_points: Evidence[];
  comparisons: string[];
}
export type Signal = "red" | "yellow" | "green";
export interface ModuleResult {
  module: string;
  signal: Signal;
  conclusion: string;
  evidence: Evidence[];
  actions: string[];
  drilldown: DrillDown | null;
}
export interface ModuleAnswer {
  module: string;
  facts: Record<string, string>;
  pains: string[];
  uploaded_files?: string[];
}
```

- [ ] **Step 3: 写失败测试 — API 客户端组装请求体**

```typescript
// frontend/tests/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { runDiagnose } from "../src/api/client";

describe("runDiagnose", () => {
  it("posts answers and returns results", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ module: "market", signal: "red", conclusion: "x", evidence: [], actions: ["a"], drilldown: null }] }),
    })) as any;
    const results = await runDiagnose([{ module: "market", facts: {}, pains: [] }]);
    expect(results[0].module).toBe("market");
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cd frontend && npx vitest run tests/client.test.ts`
Expected: FAIL，找不到 `../src/api/client`

- [ ] **Step 5: 实现 API 客户端**

```typescript
// frontend/src/api/client.ts
import type { ModuleAnswer, ModuleResult } from "../types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export async function runDiagnose(answers: ModuleAnswer[]): Promise<ModuleResult[]> {
  const resp = await fetch(`${BASE}/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body.results as ModuleResult[];
}
```

- [ ] **Step 6: 运行测试确认通过 + 提交**

Run: `cd frontend && npx vitest run tests/client.test.ts`
Expected: 1 passed

```bash
git add frontend/
git commit -m "feat: 前端骨架 + 类型 + API 客户端"
```

---

## Task 13: 问卷组件

**Files:**
- Create: `frontend/src/components/Questionnaire/Questionnaire.tsx`
- Create: `frontend/src/components/Questionnaire/modules.ts`（6 模块题目定义）
- Test: `frontend/tests/questionnaire.test.tsx`

- [ ] **Step 1: 定义 6 模块题目**

```typescript
// frontend/src/components/Questionnaire/modules.ts
export interface ModuleDef {
  key: string;
  label: string;
  facts: { key: string; label: string }[];   // 客观事实题
  pains: string[];                             // 主观痛点选项
}

export const MODULES: ModuleDef[] = [
  { key: "market", label: "市场与客户",
    facts: [{ key: "客单价", label: "平均客单价" }, { key: "主要竞品", label: "主要竞品" }],
    pains: ["打不过竞品", "客户在流失", "市场在萎缩"] },
  { key: "product", label: "产品与服务",
    facts: [{ key: "主力产品", label: "主力产品" }], pains: ["产品同质化", "迭代太慢"] },
  { key: "sales", label: "营销与销售",
    facts: [{ key: "获客成本", label: "获客成本" }], pains: ["获客太贵", "转化率低"] },
  { key: "ops", label: "运营与供应链",
    facts: [{ key: "交付周期", label: "平均交付周期" }], pains: ["成本过高", "交付太慢"] },
  { key: "org", label: "组织与人才",
    facts: [{ key: "员工数", label: "员工总数" }], pains: ["人效低", "留不住人"] },
  { key: "finance", label: "财务与资本",
    facts: [{ key: "毛利率", label: "毛利率" }], pains: ["现金流紧张", "不盈利"] },
];
```

- [ ] **Step 2: 写失败测试 — 选模块后能提交答案**

```tsx
// frontend/tests/questionnaire.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";

describe("Questionnaire", () => {
  it("collects answers and calls onSubmit", () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("打不过竞品"));
    fireEvent.click(screen.getByText("开始诊断"));
    expect(onSubmit).toHaveBeenCalled();
    const answers = onSubmit.mock.calls[0][0];
    expect(answers.some((a: any) => a.pains.includes("打不过竞品"))).toBe(true);
  });
});
```

需先安装：`npm install -D @testing-library/react @testing-library/dom jsdom`，并在 vite.config 设 `test.environment = "jsdom"`。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd frontend && npx vitest run tests/questionnaire.test.tsx`
Expected: FAIL，找不到 Questionnaire 组件

- [ ] **Step 4: 实现问卷组件**

```tsx
// frontend/src/components/Questionnaire/Questionnaire.tsx
import { useState } from "react";
import { MODULES } from "./modules";
import type { ModuleAnswer } from "../../types";

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
    <div>
      {MODULES.map((m) => (
        <section key={m.key}>
          <h3>{m.label}</h3>
          {m.pains.map((p) => (
            <label key={p}>
              <input type="checkbox" checked={(pains[m.key] ?? []).includes(p)}
                onChange={() => togglePain(m.key, p)} />
              {p}
            </label>
          ))}
        </section>
      ))}
      <button onClick={submit}>开始诊断</button>
    </div>
  );
}
```

> 注：第一版问卷先做痛点勾选 → 提交。客观事实题输入框与自适应追问作为同组件的增量（见 Task 14 后的迭代项），不阻塞端到端闭环。

- [ ] **Step 5: 运行测试确认通过 + 提交**

Run: `cd frontend && npx vitest run tests/questionnaire.test.tsx`
Expected: 1 passed

```bash
git add frontend/src/components/Questionnaire/ frontend/tests/questionnaire.test.tsx
git commit -m "feat: 模块化问卷组件"
```

---

## Task 14: 结果看板 + 卡片 + 下钻

**Files:**
- Create: `frontend/src/components/ModuleCard/ModuleCard.tsx`
- Create: `frontend/src/components/DrillDown/DrillDown.tsx`
- Create: `frontend/src/components/Dashboard/Dashboard.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/card.test.tsx`

- [ ] **Step 1: 写失败测试 — 卡片表层显示结论，下钻默认隐藏**

```tsx
// frontend/tests/card.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModuleCard } from "../src/components/ModuleCard/ModuleCard";

const result = {
  module: "market", signal: "red" as const,
  conclusion: "定价偏高是流失主因",
  evidence: [{ text: "定价高18%", source: "行业报告" }],
  actions: ["下调定价"],
  drilldown: { data_points: [{ text: "客单价¥420 vs ¥350", source: "销售表" }], comparisons: ["高出20%"] },
};

describe("ModuleCard", () => {
  it("shows conclusion, hides drilldown until clicked", () => {
    render(<ModuleCard result={result} />);
    expect(screen.getByText("定价偏高是流失主因")).toBeTruthy();
    expect(screen.queryByText("客单价¥420 vs ¥350")).toBeNull();
    fireEvent.click(screen.getByText("查看更多"));
    expect(screen.getByText("客单价¥420 vs ¥350")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run tests/card.test.tsx`
Expected: FAIL，找不到 ModuleCard

- [ ] **Step 3: 实现下钻组件（只露事实）**

```tsx
// frontend/src/components/DrillDown/DrillDown.tsx
import type { DrillDown as DD } from "../../types";

export function DrillDown({ data }: { data: DD }) {
  return (
    <div>
      <h4>数据依据</h4>
      <ul>{data.data_points.map((d, i) => <li key={i}>{d.text}（{d.source}）</li>)}</ul>
      <h4>对比基准</h4>
      <ul>{data.comparisons.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>
  );
}
```

- [ ] **Step 4: 实现卡片（结论先行 + 折叠下钻）**

```tsx
// frontend/src/components/ModuleCard/ModuleCard.tsx
import { useState } from "react";
import type { ModuleResult } from "../../types";
import { DrillDown } from "../DrillDown/DrillDown";

const SIGNAL_COLOR = { red: "🔴", yellow: "🟡", green: "🟢" } as const;

export function ModuleCard({ result }: { result: ModuleResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid #ddd", padding: 16, margin: 8 }}>
      <div>{SIGNAL_COLOR[result.signal]} {result.module}</div>
      <p><strong>{result.conclusion}</strong></p>
      <ul>{result.evidence.map((e, i) => <li key={i}>{e.text}</li>)}</ul>
      <div>建议：{result.actions.join("；")}</div>
      {result.drilldown && (
        <>
          <button onClick={() => setOpen(!open)}>查看更多</button>
          {open && <DrillDown data={result.drilldown} />}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 实现看板 + 接进 App**

```tsx
// frontend/src/components/Dashboard/Dashboard.tsx
import type { ModuleResult } from "../../types";
import { ModuleCard } from "../ModuleCard/ModuleCard";

export function Dashboard({ results }: { results: ModuleResult[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap" }}>
      {results.map((r) => <ModuleCard key={r.module} result={r} />)}
    </div>
  );
}
```

```tsx
// frontend/src/App.tsx
import { useState } from "react";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { runDiagnose } from "./api/client";
import type { ModuleResult, ModuleAnswer } from "./types";

export default function App() {
  const [results, setResults] = useState<ModuleResult[] | null>(null);

  const handleSubmit = async (answers: ModuleAnswer[]) => {
    setResults(await runDiagnose(answers));
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <h1>AI 企业诊断</h1>
      {results ? <Dashboard results={results} /> : <Questionnaire onSubmit={handleSubmit} />}
    </div>
  );
}
```

- [ ] **Step 6: 运行测试确认通过 + 提交**

Run: `cd frontend && npx vitest run tests/card.test.tsx`
Expected: 1 passed

```bash
git add frontend/src/components/ frontend/src/App.tsx frontend/tests/card.test.tsx
git commit -m "feat: 结果看板 + 卡片 + 下钻"
```

- [ ] **Step 7: 端到端冒烟**

后端 `uvicorn app.main:app` + 前端 `npm run dev`，浏览器打开 http://localhost:5173 ，勾选痛点 → 开始诊断 → 看到模块卡片 → 点"查看更多"展开下钻。

---

## 扩展：其余 5 个模块（照样板复制）

市场模块跑通后，product / sales / ops / org / finance 各自重复 **Task 8 的模式**：

每个模块新建 `backend/app/skills/<module>.py`，继承 `Skill`，声明 `module` 和 `method`（按 Task 4 表格：product=框架扫描、sales=漏斗分析、ops=流程建模、org=框架扫描、finance=指标体检），改写 `_SYSTEM` 为该领域专家提示词，实现 `diagnose`，并在 `registry.py` 注册。每个模块配一个 `test_<module>_skill.py`（仿 `test_market_skill.py`，用 FakeLLM）。前端无需改动——看板自动渲染新模块卡片。

每个模块独立一个 commit：`feat: <module> skill`。

---

## 自检结果

- **Spec 覆盖**：四段式架构（Task 1-14 全覆盖）、6 模块 MECE（modules.ts + 扩展节）、自适应问卷（Task 13，事实题/追问列为增量）、三层卡片（Task 14）、护城河过滤（Task 6+9）、LLM 多模型（Task 2-3）、内外对比（Task 7-8 数据引擎）、隐私第一层（CORS + 后续部署项）。✅
- **占位符扫描**：无 TBD/TODO；external.py 的桩数据已明确标注为"第一版桩、后续接真实源"，属有意设计非占位。✅
- **类型一致性**：后端 `ModuleResult/Evidence/DrillDown` 与前端 `types.ts` 字段逐一对应；`diagnose_all`、`get_skill`、`scrub_method_language`、`runDiagnose` 命名前后一致。✅

## 遗留增量（不阻塞第一版闭环，跑通后再加）

- 问卷客观事实题输入框 + 文件上传 UI + 自适应追问（Task 13 已留接口）
- 上传文件真正传到后端并入 skill 输入（Task 7 解析已就绪，缺 API 串接）
- external.py 接真实外部数据源
- 隐私第一层的部署配置（HTTPS、数据加密存储、租户隔离）
