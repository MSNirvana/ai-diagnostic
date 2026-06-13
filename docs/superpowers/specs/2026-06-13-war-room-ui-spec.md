# 睿策视界 · 作战室页面线框与数据结构补充规格

- 日期：2026-06-13
- 状态：讨论版，供主分支直接拆前后端任务
- 依赖文档：[2026-06-13-war-room-product-spec.md](/Users/gaoyunhong/ai-diagnostic/docs/superpowers/specs/2026-06-13-war-room-product-spec.md)

## 一、文档目标

本文件只解决 4 件事：

- 作战室页面应该长什么样
- 页面应该拆成哪些组件
- 页面各区块应消费什么数据
- 后端应返回什么结构，前端才能稳定实现

它不是视觉稿，也不是最终技术实现方案。它是主分支可直接据此拆任务的中间规格。

## 二、页面对象

当前诊断结果页的对象是：

- `多专家诊断结果`
- `模块卡片列表`

作战室页面的对象应升级为：

- `本期作战判断`
- `部门作战方案`
- `跨部门联动链`
- `证据与风险`
- `复盘追踪`

也就是说，页面的主对象不再是 `results[]`，而是 `war_room_plan`。

## 三、页面骨架

推荐使用单页纵向结构，桌面端以“上层决策 + 中层动作 + 下层证据/复盘”组织。

## 四、桌面端线框

```text
+----------------------------------------------------------------------------------+
| AppShell / 项目上下文 / 返回项目工作台                                               |
+----------------------------------------------------------------------------------+
| 战情简报 War Room Eyebrow                                                       |
| [一句话总判断]                                                                    |
| 主战场 | 次战场 | 本期目标 | 置信度 | 方案版本                                      |
| [老板今天要拍板的 3 件事]                                                         |
+----------------------------------------------------------------------------------+
| 左侧：跨部门联动链              | 右侧：老板决策摘要                               |
| 市场 -> 销售 -> 运营 -> 财务    | 立即拍板 / 2周内拍板 / 暂缓                      |
+----------------------------------------------------------------------------------+
| 部门动作区（主内容）                                                               |
| [市场动作卡] [销售动作卡]                                                          |
| [运营动作卡] [财务动作卡]                                                          |
| [产品动作卡] [组织动作卡]                                                          |
+----------------------------------------------------------------------------------+
| 优先级总表                                                                         |
| 立即做 | 两周内做 | 一个月内做                                                     |
+----------------------------------------------------------------------------------+
| 证据与风险                                                                         |
| 已验证数据 | 待补数据 | 风险前提 | 关键引用                                         |
+----------------------------------------------------------------------------------+
| 复盘追踪                                                                           |
| 7天检查项 | 14天复盘项 | 30天验收项 | 失效后的下一轮调整                            |
+----------------------------------------------------------------------------------+
```

## 五、移动端线框

移动端不做双栏，按同样的决策顺序垂直堆叠：

1. 一句话总判断
2. 主战场/次战场/本期目标
3. 老板拍板清单
4. 跨部门联动链
5. 部门动作卡
6. 优先级总表
7. 证据与风险
8. 复盘追踪

移动端原则：

- 每张部门动作卡支持折叠
- 老板拍板清单始终靠前
- 证据区默认收起，只在需要时展开

## 六、核心组件清单

建议新增一个独立页面组件，而不是继续在现有 `Dashboard` 上硬叠逻辑。

### 页面级组件

- `WarRoomPage`
- `WarRoomHeader`
- `DecisionBoard`
- `BattleChainPanel`
- `DepartmentActionGrid`
- `PriorityTimeline`
- `EvidenceRiskPanel`
- `ReviewCadencePanel`

### 领域组件

- `DepartmentActionCard`
- `DecisionItem`
- `DependencyEdge`
- `DataRequestBadge`
- `EvidenceRefList`
- `RiskCallout`
- `CheckpointCard`

### 兼容旧结构的组件

- 保留 `ModuleCard` 作为“专家诊断原始视图”或“查看更多”模式
- `WarRoomPage` 应是新的老板视图，不建议把 `ModuleCard` 直接当主卡片

## 七、页面状态模型

作战室页面至少有 4 种状态：

### 1. `building`

系统正在根据诊断结果生成作战方案。

页面表现：

- 显示作战室骨架 loading
- 明确提示“正在将诊断转成部门作战方案”

### 2. `ready`

已生成首版作战方案。

页面表现：

- 正常展示全部区块

### 3. `data_gap`

有方案，但证据不足，仍缺关键数据。

页面表现：

- 头部显示“保守版方案”
- 证据区强调待补数据
- 部门动作卡中出现 `required_data`

### 4. `reviewing`

方案已执行一段时间，进入复盘。

页面表现：

- 顶部增加“本期执行状态”
- 复盘追踪区提升权重

## 八、前端建议路由

建议新增独立路由，而不是复用当前 dashboard 页。

建议路由：

- `/projects/:projectId/war-room/:recordId`

可选兼容：

- 从诊断完成页按钮进入“进入作战室”
- 从项目工作台历史诊断记录进入“查看本期作战室”

## 九、前端建议数据类型

建议在 [frontend/src/types.ts](/Users/gaoyunhong/ai-diagnostic/frontend/src/types.ts) 新增以下类型。

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
  priority_board: {
    now: string[];
    soon: string[];
    later: string[];
  };
  evidence_summary: string[];
  risk_summary: string[];
  data_gaps: DataRequestItem[];
  checkpoints: ReviewCheckpoint[];
}
```

## 十、后端返回结构建议

不建议让前端自己从 `results[] + triage + evidence_package` 拼装作战室。

建议后端新增一层结构化编排对象，例如：

```json
{
  "war_room_plan": {
    "id": "wr_xxx",
    "record_id": "rec_xxx",
    "project_id": "proj_xxx",
    "summary": "未来 30 天优先打销售承接战，而不是继续放大投放。",
    "primary_battlefield": "sales",
    "secondary_battlefield": "market",
    "objective": "30 天内提升高质量线索成交率并压低无效投放占比",
    "confidence": 0.76,
    "decision_items": [],
    "battle_chain": [],
    "department_actions": [],
    "priority_board": { "now": [], "soon": [], "later": [] },
    "evidence_summary": [],
    "risk_summary": [],
    "data_gaps": [],
    "checkpoints": []
  }
}
```

## 十一、后端编排建议

建议新增一层 `war room composer`，不要把这部分逻辑塞进现有模块 Skill。

### 责任分工

- `Expert Skills`
  - 输出模块判断、证据、动作建议、缺失数据

- `Triage / Dispatcher`
  - 选专家、排优先级、识别冲突

- `War Room Composer`
  - 把模块结果转成老板视角的部门作战方案
  - 生成老板拍板项
  - 生成跨部门联动链
  - 生成复盘节奏

### 好处

- 专家只管看问题
- composer 只管编排动作
- 前端拿到的是成品，而不是半成品

## 十二、与现有对象的映射关系

当前已有对象不需要废弃，但主分支要明确它们的新角色。

### 当前对象

- `results[]`
- `triage`
- `evidence_package`
- `data_requests`

### 新角色

- `results[]`：专家原始输出
- `triage`：专家会诊与冲突信号
- `evidence_package`：证据层依据
- `data_requests`：证据不足时的缺口输入
- `war_room_plan`：老板实际看到的主交付物

## 十三、页面区块与数据来源映射

### 老板决策区

来源：

- `war_room_plan.summary`
- `war_room_plan.primary_battlefield`
- `war_room_plan.secondary_battlefield`
- `war_room_plan.objective`
- `war_room_plan.decision_items`

### 跨部门联动区

来源：

- `war_room_plan.battle_chain`
- `triage.dependencies`

### 部门动作区

来源：

- `war_room_plan.department_actions`

### 优先级总表

来源：

- `war_room_plan.priority_board`

### 证据与风险区

来源：

- `war_room_plan.evidence_summary`
- `war_room_plan.risk_summary`
- `war_room_plan.data_gaps`
- 模块级 `evidence_package`

### 复盘追踪区

来源：

- `war_room_plan.checkpoints`

## 十四、第一阶段前端开发范围

建议主分支先做一个可落地 MVP，不要一开始把所有视图都做满。

### P0

- 新建 `WarRoomPage`
- 做 `老板决策区`
- 做 `跨部门联动区`
- 做 `部门动作区`

### P1

- 做 `优先级总表`
- 做 `证据与风险区`

### P2

- 做 `复盘追踪区`
- 接入项目历史 / 复诊入口

## 十五、第一阶段后端开发范围

### P0

- 新增 `WarRoomPlan` 后端模型
- 新增 `war room composer`
- 在诊断结果返回中附带 `war_room_plan`

### P1

- 支持 `department_actions.required_data`
- 支持 `decision_items`
- 支持 `battle_chain`

### P2

- 支持 `checkpoints`
- 支持项目下多期作战室记录对比

## 十六、验收标准

主分支开发完成后，至少满足以下验收标准：

### 产品验收

- 老板打开页面 30 秒内能回答：
  - 先打哪场仗
  - 哪两个部门先动
  - 今天要拍哪 3 个板
  - 两周后看什么结果

### 页面验收

- 首屏不是长篇报告
- 首屏不是数据大盘
- 动作区比证据区更显眼
- 每张部门动作卡都能独立阅读

### 数据验收

- 前端不需要自己从 `results[]` 手工硬拼部门作战方案
- `war_room_plan` 可以稳定驱动作战室页面

## 十七、最终建议

主分支开发时，建议把“诊断结果页改版”理解为：

**从模块诊断展示页，升级为老板作战室首页。**

如果只能先做一件最重要的事，那就是：

**先把老板决策区 + 部门动作区做对。**

因为这两块决定用户看到的是：

- “一份 AI 诊断”

还是：

- “一份可以拿去开会的经营作战方案”
