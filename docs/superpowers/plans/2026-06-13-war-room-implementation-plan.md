# War Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready `war_room_plan` flow for RuiCeShiJie so diagnosis output becomes a boss-facing war room with decision items, department action cards, evidence/risk, and review checkpoints.

**Architecture:** Keep expert diagnosis, triage, evidence, and war-room composition as separate layers. Reuse the current diagnosis pipeline for module results and add a new composer layer that deterministically translates module outputs into a stable `war_room_plan` object, then render that object in a dedicated frontend route instead of hard-wiring boss-facing logic into the existing module dashboard.

**Tech Stack:** FastAPI, Pydantic/SQLModel, React, TypeScript, Vitest, Pytest

---

## File Structure

**Create**
- `backend/app/models/warroom.py`
- `backend/app/warroom/composer.py`
- `backend/tests/test_warroom_composer.py`
- `frontend/src/components/WarRoom/WarRoomPage.tsx`
- `frontend/src/components/WarRoom/WarRoomPage.css`
- `frontend/src/components/WarRoom/DecisionBoard.tsx`
- `frontend/src/components/WarRoom/BattleChainPanel.tsx`
- `frontend/src/components/WarRoom/DepartmentActionGrid.tsx`
- `frontend/src/components/WarRoom/DepartmentActionCard.tsx`
- `frontend/src/components/WarRoom/EvidenceRiskPanel.tsx`
- `frontend/src/components/WarRoom/ReviewCadencePanel.tsx`

**Modify**
- `backend/app/api/diagnose.py`
- `backend/app/models/result.py`
- `frontend/src/types.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/Dashboard/Dashboard.tsx`
- `frontend/tests/questionnaire.test.tsx`

**Optional second-pass files**
- `backend/app/db/models.py`
- `backend/tests/test_diagnose_api.py`
- `frontend/tests/war-room.test.tsx`

---

### Task 1: Lock The Backend `war_room_plan` Contract

**Files:**
- Create: `backend/app/models/warroom.py`
- Modify: `backend/app/api/diagnose.py`
- Modify: `frontend/src/types.ts`
- Test: `backend/tests/test_warroom_composer.py`

- [ ] **Step 1: Write the failing backend contract test**

```python
from app.models.questionnaire import Questionnaire, ModuleAnswer
from app.models.result import ModuleResult, Evidence, EvidencePackage, AuditTrail, DataRequest, TriageSummary
from app.models.warroom import WarRoomPlan
from app.warroom.composer import compose_war_room_plan


def _result(module: str, signal: str, conclusion: str, action: str) -> ModuleResult:
    return ModuleResult(
        module=module,
        signal=signal,
        conclusion=conclusion,
        evidence=[Evidence(text=f"{module} 证据", source="test")],
        actions=[action],
        evidence_package=EvidencePackage(
            confidence=0.72,
            confidence_reason="test",
            citations=[],
            benchmarks=[],
            audit_trail=AuditTrail(skill_version_id="v1", input_modules=[module], checks=[]),
        ),
        data_requests=[DataRequest(key=f"{module}_data", label=f"{module} 数据", reason="补齐关键数据")],
    )


def test_compose_war_room_plan_returns_boss_facing_shape():
    questionnaire = Questionnaire(
        answers=[ModuleAnswer(module="sales"), ModuleAnswer(module="market")],
        project_id="proj-1",
        problem_map={"goal": "30天提升高质量线索成交率"},
    )
    triage = TriageSummary(
        primary_module="sales",
        dependencies=["先清理渠道，再优化销售承接。"],
        priority_actions=["销售与增长：重分线索池"],
    )
    plan = compose_war_room_plan(
        questionnaire=questionnaire,
        results=[
            _result("sales", "red", "销售承接是当前主战场", "重分线索池"),
            _result("market", "yellow", "市场投放结构需要调整", "暂停低效渠道"),
        ],
        triage=triage,
        skill_version_ids={"sales": "v1", "market": "v2"},
    )

    assert isinstance(plan, WarRoomPlan)
    assert plan.primary_battlefield == "sales"
    assert plan.secondary_battlefield == "market"
    assert plan.decision_items
    assert plan.department_actions
    assert plan.battle_chain
    assert plan.data_gaps
    assert plan.checkpoints
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/pytest backend/tests/test_warroom_composer.py::test_compose_war_room_plan_returns_boss_facing_shape -q`

Expected: FAIL with import error or missing `compose_war_room_plan` / `WarRoomPlan`

- [ ] **Step 3: Write the minimal backend model and composer entrypoint**

```python
# backend/app/models/warroom.py
from pydantic import BaseModel, Field
from app.models.result import DataRequest


class DecisionItem(BaseModel):
    title: str
    detail: str
    urgency: str


class ActionMetric(BaseModel):
    name: str
    current: str | None = None
    target: str
    direction: str


class BattleChainStep(BaseModel):
    id: str
    label: str
    depends_on: list[str] = Field(default_factory=list)
    note: str = ""


class DepartmentAction(BaseModel):
    id: str
    department: str
    department_label: str
    battle_goal: str
    priority: str
    action_title: str
    action_detail: str
    owner_role: str
    start_window: str
    dependency: str = ""
    acceptance_rule: str
    required_data: list[DataRequest] = Field(default_factory=list)
    metrics: list[ActionMetric] = Field(default_factory=list)
    risk_note: str = ""
    confidence: float | None = None
    evidence_refs: list[str] = Field(default_factory=list)


class ReviewCheckpoint(BaseModel):
    window: str
    title: str
    checks: list[str] = Field(default_factory=list)


class PriorityBoard(BaseModel):
    now: list[str] = Field(default_factory=list)
    soon: list[str] = Field(default_factory=list)
    later: list[str] = Field(default_factory=list)


class WarRoomPlan(BaseModel):
    id: str
    record_id: str | None = None
    project_id: str | None = None
    summary: str
    primary_battlefield: str
    secondary_battlefield: str = ""
    objective: str
    confidence: float = 0
    decision_items: list[DecisionItem] = Field(default_factory=list)
    battle_chain: list[BattleChainStep] = Field(default_factory=list)
    department_actions: list[DepartmentAction] = Field(default_factory=list)
    priority_board: PriorityBoard = Field(default_factory=PriorityBoard)
    evidence_summary: list[str] = Field(default_factory=list)
    risk_summary: list[str] = Field(default_factory=list)
    data_gaps: list[DataRequest] = Field(default_factory=list)
    checkpoints: list[ReviewCheckpoint] = Field(default_factory=list)
```

```python
# backend/app/warroom/composer.py
from uuid import uuid4
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult, TriageSummary
from app.models.warroom import WarRoomPlan


def compose_war_room_plan(
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    triage: TriageSummary,
    skill_version_ids: dict[str, str],
) -> WarRoomPlan:
    if not results:
        return WarRoomPlan(
            id=str(uuid4()),
            project_id=questionnaire.project_id,
            summary="当前暂无足够诊断结果，暂不能生成部门作战方案。",
            primary_battlefield="",
            objective=questionnaire.problem_map.get("goal", "") if questionnaire.problem_map else "",
        )
    primary = triage.primary_module or results[0].module
    secondary = next((r.module for r in results if r.module != primary), "")
    return WarRoomPlan(
        id=str(uuid4()),
        project_id=questionnaire.project_id,
        summary=f"未来30天优先打{primary}这场仗。",
        primary_battlefield=primary,
        secondary_battlefield=secondary,
        objective=(questionnaire.problem_map or {}).get("goal", results[0].conclusion),
    )
```

- [ ] **Step 4: Extend diagnosis response contract**

```python
# backend/app/api/diagnose.py
from app.models.warroom import WarRoomPlan


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]
    record_id: str | None = None
    skill_version_ids: dict[str, str] = Field(default_factory=dict)
    triage: TriageSummary = Field(default_factory=TriageSummary)
    war_room_plan: WarRoomPlan | None = None
```

- [ ] **Step 5: Run test to verify it passes**

Run: `backend/.venv/bin/pytest backend/tests/test_warroom_composer.py::test_compose_war_room_plan_returns_boss_facing_shape -q`

Expected: PASS

---

### Task 2: Encode Boss-Facing Composition Rules

**Files:**
- Modify: `backend/app/warroom/composer.py`
- Test: `backend/tests/test_warroom_composer.py`

- [ ] **Step 1: Write the failing rule test**

```python
def test_compose_war_room_plan_prioritizes_primary_and_required_data():
    questionnaire = Questionnaire(
        answers=[ModuleAnswer(module="sales"), ModuleAnswer(module="finance")],
        problem_map={"goal": "30天改善成交率并控制现金风险"},
    )
    triage = TriageSummary(
        primary_module="sales",
        dependencies=["增长动作需要先经过现金流约束校验。"],
    )
    sales = _result("sales", "red", "销售承接效率低", "A类线索10分钟内首响")
    finance = _result("finance", "yellow", "现金流不能支撑无上限投放", "设置周投放上限")

    plan = compose_war_room_plan(
        questionnaire=questionnaire,
        results=[sales, finance],
        triage=triage,
        skill_version_ids={"sales": "v1", "finance": "v2"},
    )

    assert plan.decision_items[0].urgency == "now"
    assert any("sales" in item.title.lower() or "销售" in item.title for item in plan.decision_items)
    assert any(action.department == "sales" for action in plan.department_actions)
    assert any(action.department == "finance" for action in plan.department_actions)
    assert plan.priority_board.now
    assert plan.data_gaps
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/pytest backend/tests/test_warroom_composer.py::test_compose_war_room_plan_prioritizes_primary_and_required_data -q`

Expected: FAIL because current composer returns only a skeletal plan

- [ ] **Step 3: Implement deterministic composition rules**

```python
MODULE_LABELS = {
    "market": "市场",
    "sales": "销售",
    "ops": "运营",
    "finance": "财务",
    "product": "产品",
    "org": "组织",
}

OWNER_ROLE = {
    "market": "市场负责人",
    "sales": "销售负责人",
    "ops": "运营负责人",
    "finance": "财务负责人",
    "product": "产品负责人",
    "org": "组织负责人",
}

SIGNAL_PRIORITY = {"red": 0, "yellow": 1, "green": 2}


def _sorted_results(results: list[ModuleResult]) -> list[ModuleResult]:
    return sorted(results, key=lambda item: SIGNAL_PRIORITY.get(item.signal, 9))


def _priority_for(module: str, signal: str, primary: str) -> str:
    if module == primary and signal == "red":
        return "now"
    if signal in ("red", "yellow"):
        return "soon"
    return "later"
```

Add to `compose_war_room_plan(...)`:

```python
ordered = _sorted_results(results)
primary = triage.primary_module or ordered[0].module
secondary = next((r.module for r in ordered if r.module != primary), "")
department_actions = []
for index, result in enumerate(ordered[:6]):
    priority = _priority_for(result.module, result.signal, primary)
    department_actions.append(
        DepartmentAction(
            id=f"{result.module}-{index}",
            department=result.module,
            department_label=MODULE_LABELS.get(result.module, result.module),
            battle_goal=result.conclusion,
            priority=priority,
            action_title=result.actions[0],
            action_detail="；".join(result.actions[1:3]) if len(result.actions) > 1 else result.conclusion,
            owner_role=OWNER_ROLE.get(result.module, "部门负责人"),
            start_window="本周启动" if priority == "now" else "两周内启动" if priority == "soon" else "一个月内排期",
            dependency=triage.dependencies[0] if triage.dependencies else "",
            acceptance_rule="两周内看到过程指标改善，并在30天复盘目标结果。",
            required_data=result.data_requests,
            confidence=result.evidence_package.confidence if result.evidence_package else None,
            evidence_refs=[e.text for e in result.evidence[:2]],
        )
    )
```

- [ ] **Step 4: Populate decision items, chain, evidence, risk, checkpoints**

```python
decision_items = [
    DecisionItem(
        title=f"优先投入{MODULE_LABELS.get(primary, primary)}整改",
        detail=ordered[0].actions[0],
        urgency="now",
    )
]
if secondary:
    decision_items.append(
        DecisionItem(
            title=f"同步协调{MODULE_LABELS.get(secondary, secondary)}配合",
            detail=next(r.conclusion for r in ordered if r.module == secondary),
            urgency="soon",
        )
    )

battle_chain = [
    BattleChainStep(id=action.department, label=f"{action.department_label}先行动作：{action.action_title}")
    for action in department_actions[: min(3, len(department_actions))]
]

priority_board = PriorityBoard(
    now=[a.action_title for a in department_actions if a.priority == "now"],
    soon=[a.action_title for a in department_actions if a.priority == "soon"],
    later=[a.action_title for a in department_actions if a.priority == "later"],
)
```

- [ ] **Step 5: Run composer tests**

Run: `backend/.venv/bin/pytest backend/tests/test_warroom_composer.py -q`

Expected: PASS

---

### Task 3: Attach `war_room_plan` To Diagnosis API And Persistence

**Files:**
- Modify: `backend/app/api/diagnose.py`
- Modify: `backend/app/db/models.py`
- Modify: `backend/tests/test_diagnose_api.py`

- [ ] **Step 1: Write the failing API test**

```python
def test_diagnose_returns_war_room_plan(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    resp = client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}]},
    )
    app.dependency_overrides.pop(get_llm_client, None)
    body = resp.json()
    assert resp.status_code == 200
    assert body["war_room_plan"]["summary"]
    assert body["war_room_plan"]["department_actions"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/pytest backend/tests/test_diagnose_api.py::test_diagnose_returns_war_room_plan -q`

Expected: FAIL because response currently omits the composed plan

- [ ] **Step 3: Generate plan during diagnose flow**

```python
# backend/app/api/diagnose.py
from app.warroom.composer import compose_war_room_plan

outcome = await diagnose_all(questionnaire, llm, session)
war_room_plan = compose_war_room_plan(
    questionnaire=questionnaire,
    results=outcome.results,
    triage=outcome.triage,
    skill_version_ids=outcome.skill_version_ids,
)
record_id = await _save_history(session, user, questionnaire, outcome.results, outcome.triage)
return DiagnoseResponse(
    results=outcome.results,
    record_id=record_id,
    skill_version_ids=outcome.skill_version_ids,
    triage=outcome.triage,
    war_room_plan=war_room_plan,
)
```

- [ ] **Step 4: Add optional persistence slot**

```python
# backend/app/db/models.py
class DiagnosisRecord(SQLModel, table=True):
    ...
    war_room_plan_json: str | None = None
```

And in `_save_history(...)`:

```python
record = DiagnosisRecord(
    ...,
    war_room_plan_json=war_room_plan.model_dump_json() if war_room_plan else None,
)
```

- [ ] **Step 5: Run API test and full backend suite**

Run: `backend/.venv/bin/pytest backend/tests/test_diagnose_api.py::test_diagnose_returns_war_room_plan -q`

Expected: PASS

Run: `backend/.venv/bin/pytest backend/tests -q`

Expected: PASS

---

### Task 4: Add Boss-Facing Frontend Types And Route

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/WarRoom/WarRoomPage.tsx`
- Create: `frontend/src/components/WarRoom/WarRoomPage.css`
- Test: `frontend/tests/war-room.test.tsx`

- [ ] **Step 1: Write the failing frontend route test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WarRoomPage } from "../src/components/WarRoom/WarRoomPage";

test("renders boss-facing war room sections", () => {
  render(
    <MemoryRouter initialEntries={["/projects/p1/war-room/r1"]}>
      <Routes>
        <Route path="/projects/:projectId/war-room/:recordId" element={<WarRoomPage />} />
      </Routes>
    </MemoryRouter>
  );

  expect(screen.getByText("战情简报")).toBeInTheDocument();
  expect(screen.getByText("部门动作")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run tests/war-room.test.tsx`

Expected: FAIL because `WarRoomPage` does not yet exist

- [ ] **Step 3: Add frontend types**

```ts
export interface DecisionItem {
  title: string;
  detail: string;
  urgency: "now" | "soon" | "later";
}

export interface ActionMetric {
  name: string;
  current?: string;
  target: string;
  direction: "up" | "down" | "stable";
}

export interface DataRequestItem {
  key: string;
  label: string;
  reason: string;
  required: boolean;
  source_hint?: string;
}

export interface DepartmentAction {
  id: string;
  department: "market" | "sales" | "ops" | "finance" | "product" | "org";
  department_label: string;
  battle_goal: string;
  priority: "now" | "soon" | "later";
  action_title: string;
  action_detail: string;
  owner_role: string;
  start_window: string;
  dependency?: string;
  acceptance_rule: string;
  required_data: DataRequestItem[];
  metrics: ActionMetric[];
  risk_note?: string;
  confidence?: number;
  evidence_refs?: string[];
}

export interface BattleChainStep {
  id: string;
  label: string;
  depends_on?: string[];
  note?: string;
}

export interface ReviewCheckpoint {
  window: "7d" | "14d" | "30d";
  title: string;
  checks: string[];
}

export interface WarRoomPlan {
  id: string;
  record_id: string;
  project_id?: string;
  summary: string;
  primary_battlefield: string;
  secondary_battlefield?: string;
  objective: string;
  confidence: number;
  decision_items: DecisionItem[];
  battle_chain: BattleChainStep[];
  department_actions: DepartmentAction[];
  priority_board: { now: string[]; soon: string[]; later: string[] };
  evidence_summary: string[];
  risk_summary: string[];
  data_gaps: DataRequestItem[];
  checkpoints: ReviewCheckpoint[];
}
```

- [ ] **Step 4: Create minimal page and route**

```tsx
// frontend/src/components/WarRoom/WarRoomPage.tsx
export function WarRoomPage() {
  return (
    <section className="war-room-page">
      <header className="war-room-page__header">
        <span>战情简报</span>
        <h1>部门作战方案</h1>
      </header>
      <section>
        <h2>部门动作</h2>
      </section>
    </section>
  );
}
```

```tsx
// frontend/src/App.tsx
<Route
  path="/projects/:projectId/war-room/:recordId"
  element={
    <ProtectedRoute>
      <WarRoomPage />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 5: Run the frontend route test**

Run: `cd frontend && npm test -- --run tests/war-room.test.tsx`

Expected: PASS

---

### Task 5: Build The Real War Room UI

**Files:**
- Create: `frontend/src/components/WarRoom/DecisionBoard.tsx`
- Create: `frontend/src/components/WarRoom/BattleChainPanel.tsx`
- Create: `frontend/src/components/WarRoom/DepartmentActionGrid.tsx`
- Create: `frontend/src/components/WarRoom/DepartmentActionCard.tsx`
- Create: `frontend/src/components/WarRoom/EvidenceRiskPanel.tsx`
- Create: `frontend/src/components/WarRoom/ReviewCadencePanel.tsx`
- Modify: `frontend/src/components/WarRoom/WarRoomPage.tsx`
- Modify: `frontend/src/components/WarRoom/WarRoomPage.css`
- Test: `frontend/tests/war-room.test.tsx`

- [ ] **Step 1: Write the failing integration-style UI test**

```tsx
test("renders decision board, department cards, evidence, and checkpoints from war room plan", () => {
  const plan = {
    id: "wr-1",
    record_id: "rec-1",
    summary: "未来30天优先打销售承接这场仗。",
    primary_battlefield: "sales",
    secondary_battlefield: "market",
    objective: "提升高质量线索成交率",
    confidence: 0.76,
    decision_items: [{ title: "优先投入销售整改", detail: "A类线索10分钟内首响", urgency: "now" }],
    battle_chain: [{ id: "sales", label: "销售先行动作：A类线索10分钟内首响" }],
    department_actions: [{
      id: "sales-1",
      department: "sales",
      department_label: "销售",
      battle_goal: "销售承接效率低",
      priority: "now",
      action_title: "A类线索10分钟内首响",
      action_detail: "重分线索池并明确首响标准",
      owner_role: "销售负责人",
      start_window: "本周启动",
      acceptance_rule: "两周内看到首响时长改善",
      required_data: [],
      metrics: [],
      evidence_refs: ["销售证据"],
    }],
    priority_board: { now: ["A类线索10分钟内首响"], soon: [], later: [] },
    evidence_summary: ["线索响应慢于目标值"],
    risk_summary: ["若渠道质量不提升，销售动作改善会受限"],
    data_gaps: [],
    checkpoints: [{ window: "7d", title: "7天检查", checks: ["确认动作是否启动"] }],
  };

  render(<WarRoomPage plan={plan as any} />);
  expect(screen.getByText("优先投入销售整改")).toBeInTheDocument();
  expect(screen.getByText("销售")).toBeInTheDocument();
  expect(screen.getByText("7天检查")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run tests/war-room.test.tsx`

Expected: FAIL because the page still renders only static placeholders

- [ ] **Step 3: Implement page composition**

Use this page structure:

```tsx
export function WarRoomPage({ plan }: { plan: WarRoomPlan }) {
  return (
    <div className="war-room-page">
      <DecisionBoard plan={plan} />
      <BattleChainPanel chain={plan.battle_chain} />
      <DepartmentActionGrid actions={plan.department_actions} />
      <EvidenceRiskPanel
        evidence={plan.evidence_summary}
        risks={plan.risk_summary}
        dataGaps={plan.data_gaps}
      />
      <ReviewCadencePanel checkpoints={plan.checkpoints} />
    </div>
  );
}
```

- [ ] **Step 4: Add component-level rendering logic**

Each component should stay single-purpose:

```tsx
export function DepartmentActionGrid({ actions }: { actions: DepartmentAction[] }) {
  return (
    <section>
      <h2>部门动作</h2>
      <div className="war-room-grid">
        {actions.map((action) => (
          <DepartmentActionCard key={action.id} action={action} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run frontend suite and build**

Run: `cd frontend && npm test -- --run`

Expected: PASS

Run: `cd frontend && npm run build`

Expected: PASS

---

### Task 6: Replace Boss Entry Point From Dashboard To War Room

**Files:**
- Modify: `frontend/src/components/Dashboard/Dashboard.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/tests/questionnaire.test.tsx`

- [ ] **Step 1: Write the failing navigation test**

```tsx
test("after diagnosis, boss can enter war room instead of only reading module cards", async () => {
  render(<App />);
  expect(await screen.findByText("进入作战室")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run tests/questionnaire.test.tsx`

Expected: FAIL because current post-diagnosis flow only shows the module dashboard

- [ ] **Step 3: Add CTA from diagnosis result to war room**

```tsx
{diagnoseResult?.record_id && (
  <button
    type="button"
    className="btn-primary"
    onClick={() => navigate(`/projects/${projectId}/war-room/${diagnoseResult.record_id}`)}
  >
    进入作战室
  </button>
)}
```

- [ ] **Step 4: Keep expert dashboard as secondary view**

Do not delete `Dashboard`; make it the “专家诊断原始视图” below or behind a tab.

- [ ] **Step 5: Run relevant frontend tests**

Run: `cd frontend && npm test -- --run tests/questionnaire.test.tsx`

Expected: PASS

---

### Task 7: Verification And Handoff

**Files:**
- Review: `docs/superpowers/specs/2026-06-13-war-room-product-spec.md`
- Review: `docs/superpowers/specs/2026-06-13-war-room-ui-spec.md`
- Review: `docs/superpowers/specs/2026-06-13-war-room-composer-spec.md`

- [ ] **Step 1: Run backend tests**

Run: `backend/.venv/bin/pytest backend/tests -q`

Expected: PASS

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend && npm test -- --run`

Expected: PASS

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS

- [ ] **Step 4: Smoke-check local flow**

Run the app locally and verify:
- Diagnosis can still complete
- Boss can enter war room
- Department cards, data gaps, and checkpoints render

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/warroom.py \
  backend/app/warroom/composer.py \
  backend/app/api/diagnose.py \
  backend/app/db/models.py \
  backend/tests/test_warroom_composer.py \
  frontend/src/types.ts \
  frontend/src/App.tsx \
  frontend/src/components/WarRoom \
  frontend/tests/war-room.test.tsx \
  frontend/tests/questionnaire.test.tsx
git commit -m "feat: add boss-facing war room flow"
```

---

## Self-Review

**Spec coverage:** This plan covers the three confirmed specs: product positioning, UI shape, and backend composition. It does not yet implement feedback-driven release governance, anonymous learning, or connectors; those are explicitly deferred.

**Placeholder scan:** No `TODO` / `TBD` markers remain in the actionable tasks. All steps point to concrete files and commands.

**Type consistency:** The plan uses `WarRoomPlan`, `DepartmentAction`, `DecisionItem`, and `DataRequest` consistently across backend and frontend.

## Handoff Notes

This plan intentionally builds the first boss-facing `war_room_plan` as a stable deterministic layer, not an LLM-generated free-form object. Once this flow is working end-to-end, the next phase should focus on:

- richer expert-specific data requests
- persistent `war_room_plan` history in project timelines
- review-mode / checkpoint updates
- feedback -> candidate -> evaluate -> activate governance
