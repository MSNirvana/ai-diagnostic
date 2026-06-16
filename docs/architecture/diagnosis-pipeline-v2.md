# 诊断流水线 v2：五阶段异步流程 + 顾问审核 + 真实数据

- 日期：2026-06-16
- 状态：设计已确认，待实现
- 适用范围：把"同步一次性诊断"升级为"异步五阶段流水线 + 内部顾问审核 + 真实内外数据对比"

## 一、决策固化（来自产品确认）

| 维度 | 决策 |
|---|---|
| 触发方式 | 老板主动发起 |
| 商业模式 | SaaS 订阅，老板自助 |
| 审核主体 | 内部顾问团队，按行业/能力分派 |
| 审核 SLA | 24 小时 |
| 外部数据 | LLM+web search 实时抓，**抓取即沉淀**进知识库 |
| 抓取时机 | 提交后异步预抓 |
| 基准过期 | 按数据类型分级（基准30天/竞品7天/政策1天） |
| 结果透明度 | 全透明（每条结论标注数据来源 + 置信度） |

## 二、核心架构变更：同步 → 异步

### 现状（同步）
`POST /diagnose` 一个请求里跑完：合并文件 → 诊断 → 作战室 → 归档 → 返回。老板在线等。

### 目标（异步五阶段）
```
[阶段1 问题澄清]   已有 conversation + 问题地图，补"数据采集清单"
      ↓
[阶段2 数据采集]   提交即触发：① 解析上传数据 ② 异步预抓外部数据
      ↓
[阶段3 机器诊断]   多专家并行，每个 Skill 做真实内外对比 + 案例参考
      ↓  产出"诊断草稿"，状态 = pending_review
[阶段4 顾问审核]   按行业/能力分派队列，24h SLA，顾问审核/补充/修改
      ↓  状态 = approved
[阶段5 作战室交付] 老板收到通知 → 看到经审核的全透明报告
```

老板感知：提交 → "24h 内出报告" → 收到通知 → 看报告。像真请了顾问。

## 三、五个阶段的实现细节

### 阶段 2：数据采集（当前最大缺口）

**A. 用户上传数据真正注入（小改动，P0）**
- 现状：`parse_table()` 已解析，`_merge_stored_files` 已合并进 facts，但解析摘要质量待验证
- 改动：确保解析后的结构化数据真正进入 `answer.facts`，Skill 能读到

**B. 外部数据真实抓取 + 沉淀（中改动，P0）**
- 现状：`external.py::fetch_industry_benchmark` 返回桩，但**调用点已在 configured.py:65**
- 改动：把桩换成真实实现，三层逻辑：
  ```
  ① 查 IndustryBenchmark 表：同 scenario+module，未过期 → 直接用
  ② 未命中 → LLM+web search 抓 → 结构化
  ③ 写入 IndustryBenchmark 表（带 fetched_at + data_type 用于分级过期）
  ```
- 新增表 `IndustryBenchmark`：scenario_key / module / data_type / payload_json / fetched_at / expires_at
- 过期分级：benchmark=30天 / competitor=7天 / policy=1天

### 阶段 3：机器诊断（补案例注入）

**历史案例注入 Skill（中改动，P1）**
- 现状：`CaseAsset` 在归档，但从不被读回注入诊断
- 改动：诊断时按 industry+scenario 查相似 CaseAsset（top 2-3），作为 few-shot 注入 prompt
- Skill 输入升级为完整五要素：
  ```
  company_context + user_data + external_benchmark + similar_cases + problem_focus
  ```

### 阶段 4：顾问审核（全新，P0）

**数据模型**：`DiagnosisRecord` 加字段
```
review_status: str = "pending_review"  # pending_review | approved | rejected
assigned_to: str | None                # 分派给哪个顾问
reviewed_by / reviewed_at
consultant_notes_json                  # 顾问补充的判断
```

**分派逻辑**：按 triage.primary_module 的行业/能力，匹配顾问的 `specialty` 标签。早期可先统一队列，预留分派字段。

**审核后台**（admin 新增 Tab "审核队列"）：
- 待审列表（按 SLA 剩余时间排序）
- 审核界面：诊断草稿 + 每条证据的来源标注 + 置信度
- 顾问操作：通过 / 补注释 / 改结论 / 打回
- 审核通过 → 触发老板通知

### 阶段 5：作战室交付（升级透明度）

**全透明改造**：每条 evidence 已有 source 字段，前端要显式渲染：
- 来源徽章："来自你上传的销售表" / "行业基准2026.06" / "相似案例参考"
- 置信度条：高/中/低 + 一句话解释
- 顾问补充的判断单独标注："顾问补充意见"

## 四、新增/改动文件清单

### 后端
| 文件 | 改动 | 优先级 |
|---|---|---|
| `app/data/external.py` | 桩 → LLM+websearch+缓存三层 | P0 |
| `app/data/benchmark_store.py` | 新建：知识库读写 | P0 |
| `app/db/models.py` | +IndustryBenchmark 表，DiagnosisRecord +审核字段 | P0 |
| `app/api/diagnose.py` | 同步 → 异步（提交即返回 record_id，状态 pending） | P0 |
| `app/api/review.py` | 新建：顾问审核端点（列表/审核/分派） | P0 |
| `app/cases/retriever.py` | 新建：相似案例检索注入 | P1 |
| `app/skills/configured.py` | 输入加 similar_cases | P1 |

### 前端
| 文件 | 改动 | 优先级 |
|---|---|---|
| Admin 新增"审核队列"Tab | 顾问审核界面 | P0 |
| 诊断提交后状态页 | "24h内出报告" + 状态轮询 | P0 |
| 作战室页 | 来源徽章 + 置信度透明展示 | P0 |
| 通知机制 | 审核完成提醒老板 | P1 |

## 五、开发顺序（P0 先行，保证第一个付费闭环）

**第一批 P0（核心闭环，让"提交→审核→交付"跑通）：**
1. 数据模型：IndustryBenchmark 表 + DiagnosisRecord 审核字段
2. external.py 真实抓取 + 知识库沉淀
3. diagnose.py 改异步（提交即 pending_review）
4. review.py 顾问审核端点
5. 前端：审核队列 Tab + 提交状态页 + 作战室透明化

**第二批 P1（提升质量）：**
6. 案例检索注入（retriever.py）
7. 顾问按行业分派
8. 老板通知机制

## 六、风险与边界

- **异步改造影响面大**：现有 `POST /diagnose` 是同步的，5 处调用 + 前端依赖。改异步要保证旧接口平滑过渡（保留同步路径作降级）。
- **web search 工具依赖**：external.py 实时抓需要 LLM 带 web search 能力。**已确认：当前 `LLMClient` 只有 `complete(system, prompt)`，无任何联网能力**。这是 P0 的硬前提，三个选项：
  - 选项A：扩展 LLMClient 加 `complete_with_search()`，用 Anthropic 原生 web_search tool（需网关支持）
  - 选项B：单独接一个搜索 API（如 Serper/Tavily），搜索结果喂给 complete()
  - 选项C：第一批先用"LLM 凭训练知识生成基准"（不联网，质量打折）跑通流程，联网作 P1
  - **建议选项C 起步**：先让流水线跑通，external 返回"LLM 估算的行业基准"并标注"待联网核实"，把联网作为质量升级项。这样 P0 不被搜索 API 集成阻塞。
- **顾问审核是人力瓶颈**：SaaS 自助 + 人工审核 24h，意味着诊断量上来后顾问是瓶颈。需要监控待审队列长度，超阈值预警。
- **YAGNI**：通知机制、按行业分派、案例检索都是 P1，第一批不做，先把核心闭环跑通。
