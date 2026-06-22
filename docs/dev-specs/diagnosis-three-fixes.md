# 开发说明：诊断产品「取数 + 累积 + 诚实」三处改动

> 自包含文档，实现者无需了解历史上下文。
> 技术栈：后端 FastAPI + SQLModel(SQLite/aiosqlite)；前端 React + TypeScript + Vite。
> 目标：把"AI 咨询诊断"产品的三个体验硬伤补上，使其能进入真实客户试用(pilot)。

---

## 〇、背景（为什么做这三处）

产品是"AI 企业经营诊断"：老板描述问题 → 系统分诊到多个专家 skill → 输出诊断结论 + 作战方案(war room)。
当前阻塞真实试用的三个问题，本次只解决这三个，**其余一律不动**：

1. **取数摩擦**：老板被要求一个个上传文件/数据，但他不知道资料在哪、也不该自己找——该派给对应部门负责人。
2. **累积不可见**：产品的护城河是"每次诊断都沉淀，复诊越来越准"，但用户感受不到这个累积。
3. **对数据不全不够诚实**：数据缺失时，AI 不能装得很确定；要明确告诉老板"我看了什么、缺什么、置信度多少"。

**核心数据模型（已存在）：**
- `DiagnosisRecord`：一次诊断记录（属于某个 `Project`）。
- `Project` + `ProjectMemoryEntry`：企业长期档案，跨多次诊断累积。
- `ModuleResult`：单个专家模块的诊断结果，含 `signal(red/yellow/green)`、`conclusion`、`evidence[]`、`actions[]`、`evidence_package.confidence`、`data_requests[]`。
- `WarRoomPlan`：作战方案，含 `iteration_count`、`iterations[]`、`source_record_ids[]`、`confidence`、`data_gaps[]`。
- `DataRequest`：一条待补数据 `{key, label, reason, source_hint, required}`。
- `CaseAsset`：脱敏后的历史案例，诊断时由 `retrieve_similar_cases()` 召回注入（案例飞轮）。

---

## 一、改动1：待补数据「派给对的人」（已在主仓库实现，以下为等效说明）

**目标**：每条待补数据标出"通常由哪个角色提供"，老板可一键复制成一段请求文本，转发给对应负责人——而不是自己去翻资料。

### 后端
1. `app/models/result.py` — `DataRequest` 增加字段：
   ```python
   typical_owner: str = ""   # 这条数据通常由公司哪个角色掌握
   ```
2. `app/warroom/composer.py` — 已有 `OWNER_ROLES`（module → 负责人角色 的映射），确保覆盖所有 skill 的 module key。例如：
   ```python
   OWNER_ROLES = {
     "market": "市场负责人", "sales": "销售负责人", "finance": "财务负责人",
     "acquisition_efficiency": "投放 / 营销负责人",
     "private_traffic": "私域 / 用户运营负责人",
     "channel_expansion": "渠道 / 招商负责人",
     # ...覆盖全部 module
   }
   ```
3. `app/warroom/composer.py` — 在汇总待补数据的 `_dedupe_data_requests()` 里，按 `result.module` 注入 `typical_owner`（用 `model_copy(update=...)`，不要原地改共享对象）：
   ```python
   def _dedupe_data_requests(results):
       collected = {}
       for result in results:
           owner = OWNER_ROLES.get(result.module, "")
           for request in result.data_requests:
               if request.key in collected:
                   continue
               collected[request.key] = (
                   request.model_copy(update={"typical_owner": owner})
                   if owner and not request.typical_owner else request
               )
       return sorted(collected.values(), key=lambda r: (not r.required, r.key))
   ```

### 前端
4. `src/types.ts` — `DataRequest` 接口加 `typical_owner?: string;`
5. `src/components/WarRoom/EvidenceRiskPanel.tsx` — 待补数据从"纯标签"改成"行项"，每行显示 `通常由 {typical_owner} 提供` + 一个「复制请求发给负责人」按钮。按钮复制的文本：
   ```
   【数据补充请求】麻烦帮忙提供：{label}
   用途：{reason}
   从哪取：{source_hint}
   ```
   用 `navigator.clipboard.writeText()`，复制后按钮短暂变「已复制 ✓」。
6. 对应 CSS（`WarRoomPage.css`）：`.data-gap-list` 改纵向排列；新增 `.data-gap-item`、`.data-gap-item__owner`、`.data-gap-item__copy` 样式。

### 验收
- 诊断结果的「待补数据」每条都显示"通常由 X 提供"。
- 点「复制请求」能把一段完整可转发的文本拷到剪贴板。
- 后端 `_dedupe_data_requests` 的单测仍通过。

---

## 二、改动2：让「累积上下文」看得见

**目标**：复诊时，在显眼位置告诉老板"这是第 N 次诊断，已基于你过去的沉淀，所以比首次更准"。这是产品"越用越准"护城河的体感证据。

**后端已具备**：`WarRoomPlan.iteration_count`、`iterations[]`、`source_record_ids[]` 已经在累积；诊断时 `retrieve_similar_cases()` 已注入历史案例。**主要工作在前端显性化 + 后端补一个累积摘要字段。**

### 后端（小改）
1. `app/models/warroom.py` — `WarRoomPlan` 增加一个只读展示字段：
   ```python
   accumulation_note: str = ""   # 累积体感文案，例：基于此前 3 次诊断 + 12 条企业档案沉淀
   ```
2. `app/warroom/composer.py` — `compose_war_room_plan()` 组装 plan 时填充它。数据来源：
   - `iteration_count`（本项目第几次诊断）
   - 项目记忆条数：查 `ProjectMemoryEntry` 中该 `project_id` 的条数（或从传入的 outcome 里取）
   - 注入的相似案例数（`retrieve_similar_cases` 返回条数，可由 dispatcher 透传到 outcome）
   - 文案规则：
     - 首次诊断（iteration_count ≤ 1 且无沉淀）：`accumulation_note = ""`（不显示）
     - 复诊：`f"本次基于此前 {iteration_count-1} 次诊断 + {memory_count} 条企业档案，结论比首次更贴合。"`
   - **注意**：这是旁路展示字段，计算失败就留空，绝不能影响诊断主流程。

### 前端
3. `src/types.ts` — `WarRoomPlan` 接口加 `accumulation_note?: string;`
4. `src/components/WarRoom/WarRoomHeader.tsx` — 在顶部(主结论附近)显示 `accumulation_note`（非空才显示），做成一个轻量徽章/小字，例如：
   ```tsx
   {plan.accumulation_note && (
     <span className="war-room__accumulation">📈 {plan.accumulation_note}</span>
   )}
   ```
5. 已有的 `WarRoomIterations` 组件(`WarRoomPage.tsx`)展示迭代轨迹，保留。改动只是把"累积"提到顶部显眼处，而不是只埋在底部迭代列表。

### 验收
- 首次诊断：不显示累积文案（避免"第1次"显得空）。
- 第二次及以后复诊：顶部显示"本次基于此前 N 次诊断 + M 条档案…"。
- 计算异常时该字段为空、页面正常，不报错。

---

## 三、改动3：对「数据不全」诚实展示

**目标**：数据缺失时，AI 不能装确定。明确呈现"我看了什么、缺什么、置信度多少"。

**后端已具备**：`ModuleResult.evidence_package.confidence`、`confidence_reason`、`data_requests[]`、`WarRoomPlan.confidence` 都已有。**主要工作是前端把它们显性、诚实地展示，并保证低置信度有视觉警示。**

### 前端（核对 + 补强）
1. `src/components/WarRoom/WarRoomHeader.tsx`：
   - 已有：有 data_gap 时显示「证据待补齐 · 暂不建议直接加码」、显示 `confidence` 百分比。**保留**。
   - 补强：置信度按区间上色——`<50%` 红、`50-75%` 黄、`≥75%` 绿。让"低置信度"一眼可见，而不是一个冷冰冰的数字。
2. `src/components/ModuleCard/ModuleCard.tsx`（单模块卡片）：
   - 核对：每条 evidence 显示 `source`（来源徽章）；展开后显示 `confidence` + `confidence_reason`。
   - 补强：当某模块 `evidence` 为空且有 `data_requests` 时，**不显示"结论"为确定结论**，改为显示"数据不足，需补齐后才能判断"的状态条，并列出该模块的 `data_requests`。
3. 全局原则（写进前端 code review checklist）：
   - 任何 `confidence < 0.5` 的结论，UI 必须带"低置信/待验证"标记。
   - 任何模块在 `data_requests` 非空时，措辞必须是"初步判断/需补数据"，不能用肯定句式。

### 验收
- 构造一个"几乎没填数据"的诊断：结果页明显标注低置信度 + 大量待补数据，不出现斩钉截铁的结论。
- 构造一个"数据充分"的诊断：置信度显示绿色、结论正常。

---

## 四、绝对不要动的部分（避免范围蔓延）

以下都**不在本次范围**，不要顺手改：
- 不接任何源系统 API（千川/有赞/用友/飞书…）——等业务定了"第一个楔子场景"再决定接哪 2-3 个。
- 不改诊断输出的定位（"给方案" vs "给视角"）——等"目标客户是想要答案的中小企业、还是要视角的老炮"定了再说。
- 不做计费/token 计量。
- 不做深度 OA 集成。
- 不重构 skill 体系。

---

## 五、整体验收

- 后端：`cd backend && .venv/bin/python -m pytest -q` 全绿（环境若缺 `socksio`，`test_llm_factory`/`test_llm_config_api` 的 3 个 ImportError 与本改动无关，可忽略）。
- 前端：`cd frontend && npx tsc --noEmit` 零报错；`npx vite build` 通过。
- 端到端：跑一次诊断 →（1）待补数据能复制转发给负责人；（2）复诊时顶部显示累积文案；（3）数据不全时明显标注低置信度 + 待补项。
