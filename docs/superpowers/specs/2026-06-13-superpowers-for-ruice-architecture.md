# 睿策视界 · Superpowers-for-RuiCe 架构说明

- 日期：2026-06-13
- 状态：内部架构说明，供主分支统一方法论与系统边界
- 适用范围：产品架构、后端能力组织、Skill 治理、反馈进化

## 一、这份文档回答什么

这份文档回答 4 个核心问题：

- 是否有必要把 `Superpowers` 的思维方式嵌入睿策视界
- 应该嵌到哪一层，而不是塞到用户表层
- Superpowers 的核心理念分别对应睿策视界哪些后端对象与流程
- 哪些术语和能力只对内使用，哪些可以对外转译给用户

一句话结论：

**有必要，而且非常有必要。**

但正确方式不是“把 Superpowers 产品化给老板看”，而是：

**把 Superpowers 变成睿策视界的内部咨询操作系统。**

## 二、为什么有必要

如果不嵌入这种方法论，睿策视界很容易退化成：

- 几个 prompt
- 几个专家卡片
- 一堆看似聪明但不稳定的建议

这类系统通常有 5 个问题：

- 诊断过程不稳定
- 结论强弱不一
- 缺证据门槛
- 没有版本治理
- 无法真正从反馈中进化

而 Superpowers 的价值不在“多 agent”本身，而在它代表了一整套更像专业团队的工作纪律：

- 先问清问题，再给答案
- 先路由任务，再并行执行
- 先验证证据，再下结论
- 先评测候选版本，再发布升级

这和你想打造的“AI 咨询系统”本质上是同一路。

## 三、总体原则

Superpowers-for-RuiCe 的总体原则是：

### 1. 方法论对内，产品体验对外

内部保留：

- intake discipline
- orchestration
- evidence gate
- release governance

对老板只展示：

- 信息还不够，请补这几项
- 这是主战场
- 这是部门动作
- 这是证据与风险
- 这是下次复盘点

### 2. 不暴露 agent 术语

老板不需要知道：

- brainstorming
- dispatching
- composer
- verification
- release candidate

老板只应感受到：

- 系统更严谨
- 建议更可信
- 动作更可执行

### 3. 不把 Superpowers 简化成 prompt 管理

在睿策视界里，`skill` 不是一段 prompt，而是一个完整的能力单元，至少包含：

- 能力边界
- 必要输入
- 可选输入
- 证据要求
- 输出结构
- 缺数据时的降级规则
- 反馈与版本归属

## 四、Superpowers 在睿策视界里的五层映射

建议把 Superpowers 的思维方式嵌入到 5 层。

### 第 1 层：Problem Intake Layer

对应 Superpowers 思维：

- `brainstorming`
- `clarify before action`

在睿策视界中的作用：

- 不让系统在问题没问清时过早输出诊断
- 先形成结构化问题地图
- 先明确目标、约束、成功标准、影响与数据准备度

当前对应对象：

- [ProblemMap](/Users/gaoyunhong/ai-diagnostic/backend/app/models/conversation.py:23)
- [intake_completeness.py](/Users/gaoyunhong/ai-diagnostic/backend/app/skills/intake_completeness.py:1)
- [conversation.py](/Users/gaoyunhong/ai-diagnostic/backend/app/api/conversation.py:1)

在这一层，Superpowers 不是“多问几个问题”，而是：

**把问题澄清本身视为系统级门槛。**

### 第 2 层：Expert Skill Layer

对应 Superpowers 思维：

- `skills as reusable capability units`
- `clear contracts`

在睿策视界中的作用：

- 每个专家都是标准化能力单元
- 专家不只是输出文本，而是对输入、证据和输出负责

当前对应对象：

- [Skill base](/Users/gaoyunhong/ai-diagnostic/backend/app/skills/base.py)
- [registry.py](/Users/gaoyunhong/ai-diagnostic/backend/app/skills/registry.py:1)
- [market.py](/Users/gaoyunhong/ai-diagnostic/backend/app/skills/market.py:1)
- [generic.py](/Users/gaoyunhong/ai-diagnostic/backend/app/skills/generic.py:1)
- [SkillVersion](/Users/gaoyunhong/ai-diagnostic/backend/app/db/models.py:107)

这里的核心要求是：

- 专家 Skill 必须有契约
- 契约必须比 prompt 更重要
- 同一模块的 Skill 升级必须可版本化、可回滚

### 第 3 层：Orchestration Layer

对应 Superpowers 思维：

- `dispatch before output`
- `parallel specialists under coordination`

在睿策视界中的作用：

- 不让单个专家直接生成最终交付
- 先分诊，再并行专家，再冲突识别，再汇总

当前对应对象：

- [diagnose_all](/Users/gaoyunhong/ai-diagnostic/backend/app/orchestrator/dispatcher.py:38)
- [TriageSummary](/Users/gaoyunhong/ai-diagnostic/backend/app/models/result.py:73)

这一层的意义是：

**睿策视界不是“一个模型回答问题”，而是“一个编排器组织专家会诊”。**

### 第 4 层：Evidence and Verification Layer

对应 Superpowers 思维：

- `verification-before-completion`
- `evidence before claims`

在睿策视界中的作用：

- 任何强结论都必须绑定证据包
- 没有足够证据时自动降级输出
- 缺数据时给出明确 `data_requests`

当前对应对象：

- [EvidencePackage](/Users/gaoyunhong/ai-diagnostic/backend/app/models/result.py:39)
- [DataRequest](/Users/gaoyunhong/ai-diagnostic/backend/app/models/result.py:29)
- [evidence.py](/Users/gaoyunhong/ai-diagnostic/backend/app/skills/evidence.py:1)

这层要明确一个产品纪律：

**没有证据支持的强建议，不允许直接进入老板作战室主交付。**

### 第 5 层：Release Governance Layer

对应 Superpowers 思维：

- `review before merge`
- `candidate -> evaluate -> approve -> release`

在睿策视界中的作用：

- 用户反馈不能直接改线上 Skill
- 新的 Skill / Prompt 版本必须先进入候选态
- 经过离线评测、人工审核，再激活

当前对应对象：

- [DiagnosisFeedback](/Users/gaoyunhong/ai-diagnostic/backend/app/db/models.py:128)
- [SkillVersion](/Users/gaoyunhong/ai-diagnostic/backend/app/db/models.py:107)
- [admin.py](/Users/gaoyunhong/ai-diagnostic/backend/app/api/admin.py:1)

这一层是咨询系统的“质量闸门”。

## 五、六个应内化的 Superpowers 内核能力

对睿策视界来说，最值得长期内化的不是全部 Superpowers 能力，而是这 6 个内核。

### 1. Intake Discipline

意思：

- 不在问题模糊时给出完整作战方案

系统表现：

- 问题地图必须达到可诊断阈值
- 未达阈值时继续追问或要求补数

### 2. Skill Contract System

意思：

- 每个专家是标准化能力单元，而不是散乱 prompt

系统表现：

- 每个模块有固定输入/输出/证据要求
- 市场专家必须说明推广账号、投放报表、外部基准的需求

### 3. Orchestrated Multi-Expert Delivery

意思：

- 最终结论来自编排，而不是单点输出

系统表现：

- 分诊编排
- 冲突识别
- 依赖链生成
- 主战场/次战场排序

### 4. Evidence Gate

意思：

- 强结论必须过证据闸门

系统表现：

- 证据包
- 置信度
- 缺数据任务
- 保守版作战方案

### 5. Composer Layer

意思：

- 专家结果不是最终交付，老板看到的是作战室对象

系统表现：

- `war_room_plan`
- 部门动作卡
- 老板拍板项
- 跨部门联动链
- 复盘节奏

### 6. Skill Release Governance

意思：

- 反馈驱动进化，但必须先评测后发布

系统表现：

- 反馈样本池
- Skill candidate
- 离线评测
- 人工审核
- 激活与回滚

## 六、RuiCe 内部能力分层图

建议在主分支架构上，把能力组织成下面的分层。

```text
用户体验层
  - 对话 intake
  - 数据上传 / 连接
  - 作战室页面
  - 复盘追踪

业务编排层
  - intake gate
  - triage dispatcher
  - war room composer
  - review scheduler

专家能力层
  - market skill
  - sales skill
  - ops skill
  - finance skill
  - product skill
  - org skill

证据与数据层
  - evidence package
  - data requests
  - uploaded files / parsed summary
  - external benchmarks / connectors

治理与进化层
  - feedback
  - skill versioning
  - candidate evaluation
  - release approval
```

这个分层本身，就是 Superpowers 思维在睿策视界里的系统化落点。

## 七、对内术语与对外术语映射

建议明确哪些词只在内部使用，哪些词可以对外展示。

### 仅内部使用

- brainstorming
- intake gate
- dispatching
- composer
- release candidate
- verification gate
- fallback

### 对外展示

- 信息完整度
- 多专家会诊
- 待补关键数据
- 主战场 / 次战场
- 部门作战方案
- 证据与风险
- 复盘节奏

### 原则

内部语言强调严谨性，外部语言强调老板理解成本。

## 八、哪些地方不该硬套 Superpowers

不是所有 Superpowers 思维都适合直接照搬到产品系统。

### 1. 不要把开发工作流直接暴露成产品流程

例如：

- TDD
- code review
- task execution

这些是内部研发纪律，不是老板产品体验。

### 2. 不要把多 agent 数量当成产品卖点

真正的卖点不是“我们内部有几个 agent”，而是：

- 结论更稳
- 动作更清楚
- 证据更可信

### 3. 不要让系统过度自解释内部过程

老板不需要知道：

- 为什么先调哪个专家
- 使用了哪种内部 routing 规则
- 哪个 composer 规则命中了

老板只需要知道结果是否可信、是否可执行。

## 九、当前项目与该架构的贴合度

从现有代码看，睿策视界已经部分具备这套架构的雏形。

### 已经具备

- `intake completeness` 闸门
- `problem_map` 问题地图
- `diagnose_all` 多专家分诊
- `evidence_package`
- `data_requests`
- `SkillVersion`
- `DiagnosisFeedback`
- `ProjectMemoryEntry`

### 还缺

- 真正独立的六专家 Skill 体系
- `war_room_plan` 作为稳定主交付对象
- 数据接入与 connector 层
- feedback -> candidate -> evaluation -> activate 闭环
- 匿名学习层与治理层

## 十、对主分支的直接建议

如果主分支要把这套架构吸收进去，建议按顺序推进，不要同时改太多。

### 第一阶段

- 把 `intake gate + expert contracts + evidence gate` 立住

### 第二阶段

- 引入 `war_room_plan + composer`

### 第三阶段

- 引入 `feedback sample + candidate evaluation + release governance`

### 第四阶段

- 引入 `anonymous learning sample + aggregated learning loop`

## 十一、最终判断

Superpowers-for-RuiCe 的本质，不是“让睿策视界像一个 agent 框架”，而是：

**让睿策视界像一个有纪律、有审计、有治理能力的 AI 咨询组织。**

这套方法论一旦嵌进去，睿策视界和普通 AI 产品的差距就不再只是：

- 会不会写得更像顾问

而是：

- 会不会像一个真正的咨询系统那样稳定地产生可信、可执行、可进化的经营方案。
