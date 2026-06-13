# 睿策视界 · `war_room_plan` 后端 Composer 规则草案

- 日期：2026-06-13
- 状态：讨论版，供主分支后端直接拆实现
- 依赖文档：
  - [2026-06-13-war-room-product-spec.md](/Users/gaoyunhong/ai-diagnostic/docs/superpowers/specs/2026-06-13-war-room-product-spec.md)
  - [2026-06-13-war-room-ui-spec.md](/Users/gaoyunhong/ai-diagnostic/docs/superpowers/specs/2026-06-13-war-room-ui-spec.md)

## 一、文档目标

本文件定义 `war_room_plan` 的后端编排规则，回答 5 个问题：

- 后端为什么需要独立的 composer 层
- composer 读什么输入
- composer 产出什么结构
- 主要字段如何从专家结果推导出来
- 第一阶段应该做成“规则编排”还是“LLM 编排”

本文件不要求一次把所有规则做满，而是给主分支一个稳定的实现框架。

## 二、总原则

`war_room_plan` 不是专家结果的简单重命名，而是：

**把多专家诊断结果翻译成老板视角的部门作战方案。**

因此它应由独立的 composer 层生成，而不是：

- 让前端从 `results[]` 自己硬拼
- 让单个模块 Skill 自己决定整场仗怎么打

### Composer 的责任

- 选出主战场与次战场
- 将模块建议翻译成部门动作
- 生成老板拍板项
- 生成跨部门联动链
- 汇总证据与风险
- 生成复盘节奏

### Composer 不负责的事

- 不替代模块专家判断
- 不直接联网抓新数据
- 不定义模块内部分析方法
- 不改写证据包原始内容

## 三、为什么必须有 Composer 层

当前已有对象：

- `results[]`
- `triage`
- `evidence_package`
- `data_requests`

它们解决的是“专家怎么看问题”，但还没解决“老板怎么开仗”。

缺少 composer 会导致：

- 前端自己拼业务逻辑，难维护
- 各模块结果并列摆放，缺少总指挥视角
- 老板拍板项、联动链、复盘节奏无稳定生成规则

因此建议新增：

- `backend/app/warroom/` 或 `backend/app/composer/warroom/`

其中核心入口类似：

```python
def compose_war_room_plan(
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    triage: TriageSummary,
    skill_version_ids: dict[str, str],
) -> WarRoomPlan:
    ...
```

## 四、输入契约

Composer 第一阶段建议只读以下输入：

### 1. `Questionnaire`

用途：

- 获取用户填写过哪些模块
- 获取 `problem_map`
- 获取 `session_id/project_id`

关键字段：

- `answers`
- `problem_map`
- `project_id`

### 2. `results[]`

用途：

- 获取各模块 `signal`
- 获取结论、行动建议、证据、缺失数据
- 构造成部门动作卡与证据摘要

关键字段：

- `module`
- `signal`
- `conclusion`
- `actions`
- `evidence_package`
- `data_requests`

### 3. `triage`

用途：

- 确定主诊模块
- 使用现有冲突识别和依赖顺序
- 生成联动链和优先级总表的底层信号

关键字段：

- `primary_module`
- `selected_experts`
- `conflicts`
- `dependencies`
- `priority_actions`

### 4. `skill_version_ids`

用途：

- 写入审计或版本说明
- 帮助后续追溯“这版作战室基于哪些专家版本编排”

## 五、输出契约

Composer 输出对象建议叫：

- `WarRoomPlan`

如果主分支愿意一步到位，建议后端在 [backend/app/models/result.py](/Users/gaoyunhong/ai-diagnostic/backend/app/models/result.py) 新建平级模型文件，例如：

- `backend/app/models/warroom.py`

## 六、建议后端模型

```python
from pydantic import BaseModel, Field


class DecisionItem(BaseModel):
    title: str
    detail: str
    urgency: str  # now | soon | later


class ActionMetric(BaseModel):
    name: str
    current: str | None = None
    target: str
    direction: str  # up | down | stable


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
    priority: str  # now | soon | later
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
    window: str  # 7d | 14d | 30d
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

## 七、第一阶段实现路线

建议第一阶段做：

**规则型 composer**

而不是：

**完全让 LLM 临场生成 war_room_plan**

### 为什么第一阶段先规则型

- 结构稳定，便于前端开发
- 可测试、可审计
- 更适合积累老板视角模板
- 避免页面主对象结构抖动

### 第二阶段再引入 LLM 的位置

LLM 可以只参与这些局部：

- 一句话总判断润色
- 老板拍板项摘要
- 风险表述压缩

但 `war_room_plan` 的主字段和骨架，建议仍由规则生成。

## 八、字段编排规则

以下是第一阶段建议规则。

### 1. `primary_battlefield`

来源：

- 首选 `triage.primary_module`

规则：

- 若存在 `triage.primary_module`，直接使用
- 若不存在，则按 `results` 中最差 `signal` 的模块选取
- `red > yellow > green`

### 2. `secondary_battlefield`

来源：

- `triage.selected_experts`
- `triage.dependencies`
- `results`

规则：

- 优先选与主战场依赖最强的第二模块
- 若无依赖，则选第二差 `signal` 的模块

### 3. `summary`

作用：

- 给老板首屏一句话总判断

第一阶段规则：

- 由主战场模块结论 + 次战场约束拼接

建议格式：

`未来 30 天优先打{主战场}，当前最关键的约束不在{A}，而在{B}。`

第二阶段可引入 LLM 做压缩润色。

### 4. `objective`

来源：

- `questionnaire.problem_map.goal`
- 各模块行动建议

规则：

- 若 `problem_map.goal` 存在，直接作为作战目标基础
- 否则回退为主战场模块的核心改善方向

### 5. `confidence`

来源：

- 各模块 `evidence_package.confidence`
- 缺失数据数量

规则：

- 取主战场与次战场的置信度均值
- 若 `data_gaps` 中 `required=True` 的数量 >= 3，则整体置信度下调
- 输出范围维持在 `0-1`

## 九、老板拍板项生成规则

`decision_items` 是老板视角最重要的新增对象。

第一阶段建议规则：

- 从主战场与次战场的前 1-2 条动作中抽取
- 只选那些需要老板资源、组织或预算拍板的动作

建议优先识别以下决策类型：

- 停止某类投入
- 调整预算
- 调整线索/资源分配
- 调整部门优先级
- 允许试点方案
- 接入关键数据源

如果识别不到，保底输出 2-3 条：

- 是否优先投入主战场整改
- 是否补齐关键数据
- 是否允许两周试点

## 十、部门动作卡生成规则

### 基本映射

每个 `ModuleResult` 默认映射到一个部门：

- `market -> 市场`
- `sales -> 销售`
- `ops -> 运营`
- `finance -> 财务`
- `product -> 产品`
- `org -> 组织`

### 动作卡条数

第一阶段建议：

- 每个模块最多输出 2 张动作卡
- 全页最多 8-10 张动作卡

这样能保证页面像战情板，不会变成长列表。

### 字段生成规则

#### `battle_goal`

来源：

- 该模块的 `conclusion`

规则：

- 将结论压缩为“本部门这一战要解决什么”

#### `priority`

来源：

- `signal`
- 是否主战场

规则：

- 主战场且 `red` -> `now`
- 次战场且 `red/yellow` -> `soon`
- 其余 -> `later`

#### `action_title` / `action_detail`

来源：

- `result.actions`

规则：

- 第一条动作作为 `action_title`
- 若有第二条动作，合并进 `action_detail`
- 不要把 3 条以上动作都挤进一张卡

#### `owner_role`

第一阶段建议固定映射：

- `market -> 市场负责人`
- `sales -> 销售负责人`
- `ops -> 运营负责人`
- `finance -> 财务负责人`
- `product -> 产品负责人`
- `org -> HR / 组织负责人`

#### `start_window`

规则：

- `priority=now` -> `本周启动`
- `priority=soon` -> `两周内启动`
- `priority=later` -> `一个月内排期`

#### `required_data`

来源：

- `result.data_requests`

规则：

- 原样透传
- 同模块重复 key 去重

#### `confidence`

来源：

- `result.evidence_package.confidence`

#### `evidence_refs`

来源：

- `result.evidence[:2]`
- `result.evidence_package.benchmarks[:1]`

规则：

- 只保留适合卡片摘要的短证据文本

#### `risk_note`

规则：

- 如果该卡存在 `required_data.required=True`
- 或 `confidence < 0.65`
- 生成一条保守风险说明

## 十一、跨部门联动链生成规则

`battle_chain` 不应由前端自由推断。

第一阶段可基于模块间的固定依赖模板 + triage 依赖文本生成。

### 第一阶段模板

- `market + sales`
  - 市场清渠道 -> 销售重分层

- `sales + ops`
  - 销售提效 -> 运营补承接

- `sales + finance`
  - 销售试投放/扩动作 -> 财务设预算红线

- `market + finance`
  - 渠道重配 -> 财务控制现金节奏

- `ops + finance`
  - 运营降本 -> 财务跟踪现金释放

### 规则

- 至少生成 2 步
- 最多 4 步
- 优先把主战场模块放在第一步

## 十二、优先级总表生成规则

`priority_board` 不是重复动作卡，而是给老板一个汇总视图。

来源：

- `department_actions`

规则：

- 收集每张动作卡的 `action_title`
- 按 `priority` 分桶到：
  - `now`
  - `soon`
  - `later`

## 十三、证据与风险生成规则

### `evidence_summary`

来源：

- 主战场、次战场的 `evidence`
- `evidence_package.benchmarks`

规则：

- 只选 3-5 条最能支撑主战场判断的证据
- 优先保留：
  - 内外对比
  - 趋势恶化
  - 漏斗断层

### `risk_summary`

来源：

- `triage.conflicts`
- 低置信度模块
- 缺失数据

规则：

- 每类最多 1-2 条
- 不写成方法论，写成经营语言

### `data_gaps`

来源：

- 聚合所有 `result.data_requests`

规则：

- 去重
- 按主战场优先
- `required=True` 排前

## 十四、复盘节奏生成规则

第一阶段建议固定生成 3 个 checkpoint。

### `7d`

关注：

- 数据是否补齐
- 动作是否启动
- 部门负责人是否到位

### `14d`

关注：

- 过程指标是否变化
- 是否出现跨部门卡点
- 是否继续当前主战场

### `30d`

关注：

- 核心目标是否改善
- 哪些动作有效
- 下一轮该转向还是加码

## 十五、容错与降级策略

Composer 必须允许“数据不完美但仍能输出保守版方案”。

### 场景 1：只有 1 个模块结果

处理：

- 仍生成 `war_room_plan`
- `secondary_battlefield` 为空
- `battle_chain` 最少 1-2 步
- 强调“当前为单主战场方案”

### 场景 2：置信度普遍较低

处理：

- summary 保守表达
- 决策项里优先加入“补齐数据”
- 风险区权重抬高

### 场景 3：模块结果冲突

处理：

- `risk_summary` 必须反映冲突
- 不强行消灭冲突
- 决策区可加入老板拍板项

### 场景 4：无 `problem_map.goal`

处理：

- objective 回退到主战场改善目标

## 十六、存储建议

第一阶段有两种方案。

### 方案 A：只在诊断响应里实时返回

优点：

- 开发快
- 不动 DB

缺点：

- 后续复盘和历史作战室不方便

### 方案 B：落库

建议新增：

- `WarRoomRecord` 或在 `DiagnosisRecord` 增加 `war_room_plan_json`

我更推荐：

- 第一阶段先把 `war_room_plan_json` 挂在 `DiagnosisRecord`

原因：

- 跟当前诊断记录天然关联
- 方便从项目历史回看同一期作战室
- 改动比新表小

## 十七、接口建议

### 方案 1：在现有 `/diagnose` 返回中直接附带

```json
{
  "results": [],
  "record_id": "xxx",
  "skill_version_ids": {},
  "triage": {},
  "war_room_plan": {}
}
```

优点：

- 前端切换成本低

### 方案 2：新增独立接口

- `GET /records/{record_id}/war-room`

优点：

- 更适合异步生成
- 后续可支持重编排

建议主分支阶段性做法：

- 第一阶段：诊断响应中直接附带
- 第二阶段：补独立接口

## 十八、测试建议

至少增加 4 类测试。

### 1. 模型测试

- `WarRoomPlan` 序列化 / 反序列化
- `DepartmentAction` / `DecisionItem` 默认值

### 2. Composer 单测

- 主战场与次战场生成正确
- 动作卡优先级生成正确
- `data_gaps` 聚合与去重正确
- 低置信度时能降级输出保守版

### 3. 诊断 API 集成测试

- `/diagnose` 返回 `war_room_plan`
- 有 `record_id` 时落库
- 单模块和多模块场景都能返回

### 4. 前端契约测试

- `war_room_plan` 缺少非关键字段时前端仍可渲染
- 决策区与部门动作区能直接消费返回结构

## 十九、主分支第一阶段建议实现顺序

### Step 1

- 新建 `backend/app/models/warroom.py`

### Step 2

- 新建 `backend/app/warroom/composer.py`

### Step 3

- 在 `diagnose_all` 之后调用 composer

### Step 4

- 扩展 `DiagnoseResponse`

### Step 5

- 前端新增 `WarRoomPage` 读取 `war_room_plan`

## 二十、最终判断

如果主分支要把 `睿策视界` 从“诊断报告系统”推向“老板作战室系统”，后端最关键的新层不是再补一个专家，而是：

**把专家判断稳定翻译成老板可执行动作的 composer 层。**

没有这一层，前端只能展示专家观点。  
有了这一层，系统才开始像一个真正的经营作战系统。
