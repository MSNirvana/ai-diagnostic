# AIBuild 项目交接文档（进度快照 · 2026-07-18）

> 本文档是当前代码进度的快照 + 可复用模式速查表，**不替代**权威产品设计文档
> `E:\文档\Obsidian Vault\wiki\overview\AIBuild构建交接文档.md`（下称"主交接文档"）。
> 任何设计疑问优先去查主交接文档对应章节；本文档只负责说清楚"代码现在在哪、
> 已经踩过哪些坑、下一步该从哪继续"。

## 1. 项目是什么

AIBuild 是 GGOO 旗下的多工具 AI 平台，前身是单一的"构造视界"经营增长诊断工具。
正在按统一平台架构（品牌壳 + 工具注册表 + 统一账户/计费）把诊断工具收纳为平台下
的一个工具，并新增图片创作等工具。完整产品设计见主交接文档 §14 的11步开发顺序。

## 2. 仓库信息

- 本地路径：`E:\文档\AIBuild`
- 远程：`https://github.com/castor9527-boop/ai-diagnostic.git`
- 开发分支：`codex/aibuild-platform`（**只在此分支提交，禁止合并 main**——main 是
  "构造视界"独立诊断产品的分支）
- 后端：FastAPI + SQLModel + async SQLAlchemy，`backend/`
- 前端：React + TypeScript + react-router-dom + vitest，`frontend/`

## 3. 已完成的开发步骤（对应主交接文档 §14 的11步开发顺序）

| 步骤 | 内容 | 状态 | commit |
|---|---|---|---|
| 1 | 建分支、摸底现有代码结构、跑通现有测试基线 | ✅完成 | 基线，无独立commit |
| 2 | 抽出平台外壳：首页 `/`、工具列表 `/tools`、工具注册表、导航 | ✅完成 | `a9fb1f3` |
| 3 | 验证 GGOO SSO / 用户映射 / 模型计费链路零改动 | ✅完成 | 随 `3870d36` |
| 4 | 积分余额显示（导航栏）+ 任务账本骨架（ToolTask + billing 模块） | ✅完成 | `3870d36` |
| 5 | 图片工具路由（首页/工具列表步骤2已做好，只差 `/tools/image` 具体路由） | 🔶设计中，未写代码 | — |
| 6 | 图片工具基础模式生成闭环 | 🔶设计中，未写代码 | — |
| 7 | `@xyflow/react` 高级画布 | ⬜未开始（package.json 无 xyflow/reactflow 依赖） | — |
| 8-11 | 主交接文档 §14 后续步骤 | ⬜未细看 | — |

当前基线：步骤4完成时前端 vitest 104/104、后端 pytest 271/271 全绿，之后未新增测试。

## 4. 步骤1-4 具体做了什么

### 4.1 平台外壳（commit a9fb1f3）

- `frontend/src/platform/registry.ts`：`ToolDefinition` 数组 + `listVisibleTools()`/
  `getTool()`，当前只注册了 `diagnostic`；文件里有注释预留图片工具注册位置。
- `frontend/src/App.tsx`：`/` → 平台首页，`/tools` → 工具列表，`/tools/diagnostic`
  → 重定向进诊断工具原流程，`/projects/*` → 诊断工具项目路由不变。`ProtectedRoute`/
  `AdminRoute` 是现成的路由保护包装组件。
- 诊断工具原有路由、数据模型、业务逻辑**完全没有改动**，只是被"包"进了平台壳。

### 4.2 GGOO 账户与计费验证 + 积分余额 + 账本骨架（commit 3870d36）

- `backend/app/integrations/ggoo.py` 新增 `GGOOClient.get_credit_balance(token) ->
  float | None`：GGOO 官方还没确认专用余额接口（主交接文档 §16 待确认项），采用
  **"自适应探测 + 永不编造"模式**：默认探测 `/api/v1/sys/users/me` 返回里常见的余额
  字段名（`balance/credits/points/credit_balance/remain_quota/quota`），支持环境变量
  `GGOO_BALANCE_PATH`（专用路径）/`GGOO_BALANCE_FIELD`（点号路径取字段）在接口确认后
  直接改配置生效、不改代码；查不到就返回 `None`，调用方必须隐藏显示，不能显示假数字。
  带 30 秒 TTL 缓存（`BALANCE_TTL`）。**这是后续所有"第三方接口没确认"场景的范式解法。**
- `backend/app/billing/`（新模块）：
  - `ledger.py`：`ToolTask` 状态机 `quoted→{reserved,cancelled}`、
    `reserved→{running,cancelled,refunded}`、`running→{succeeded,failed,cancelled}`，
    `succeeded`/`refunded` 终态；非法迁移抛 `LedgerTransitionError`。`create_task(...)`
    支持 `idempotency_key` 幂等；`transition_task(...)` 校验合法性；`list_tasks(...)`
    按用户查询。
  - `pricing.py`：`estimate_points(tool, mode, model) -> int | None`，读环境变量
    `BUILD_PRICING_JSON`（嵌套 JSON 价目表，各级支持 `default` 兜底），没配置返回
    `None`，前端要显示"暂无法预估"而不是编个数字。
- `backend/app/db/models.py` 新增 `ToolTask` 表（`create_all` 自动建表，无需迁移）：
  `id/user_id/project_id/workflow_id/created_at/updated_at/
  source(build|codex|external_api)/tool/mode/model/status/quote_points/
  actual_points/idempotency_key/error_message/payload_json`。
- `backend/app/api/billing.py`：`GET /billing/balance`（永不抛错，查不到就
  `{available:false,points:null}`）、`GET /billing/tasks?tool=&limit=`（当前用户账本
  列表，只读）。**该文件模块注释明确写着"图片工具（步骤6）将是第一个真正写入账本
  的调用方"**——billing 模块本身不需要改，图片工具直接调用
  `ledger.create_task`/`transition_task` 即可。
- 前端 `PlatformNav.tsx`：登录后拉取余额，`available && points != null` 才渲染积分
  chip，否则静默隐藏；`types.ts` 新增 `CreditsBalance`；`client.ts` 新增
  `fetchCreditsBalance()`。

## 5. 步骤5-6（图片工具）现状：只做了调研+决策确认，未写任何代码

### 5.1 已经问过用户、确认下来的决策

1. **文生图接口怎么接**：GGOO 官方文生图接口（"image2.0"模型 + 中转站）具体接口
   形态**双方都不确定**。已确定沿用步骤4"余额自适应"的同一套思路：`GGOOClient`
   新增 `generate_image(...)`，默认尝试 OpenAI 兼容的 `images/generations` 风格调用，
   用环境变量（建议 `GGOO_IMAGE_GENERATIONS_PATH`/`GGOO_IMAGE_MODEL`，具体命名待定）
   做路径/模型覆盖；接口一旦确认，改配置即可，不用碰代码；调用失败或返回不可用内容
   时，任务必须走向账本的 `failed` 状态并给出清晰错误，**绝不能返回/展示假图片**。
2. **本轮做几个入口**：一次性做齐首批3个基础模式入口——一键生成宣传图 / 一键生成
   电商图 / 从模板开始。三者共用同一套后端报价→确认→执行→轮询逻辑，区别主要在
   前端预设数据（任务类型文案、默认风格、默认比例），不是3套后端逻辑。

### 5.2 已经确认可以复用的现成代码模式（继续开发时的关键参考）

- **图片理解（已有，可直接用于"锚定"生成提示词）**：`backend/app/llm/base.py` 的
  `LLMClient.describe_image(system, prompt, image_bytes, media_type)`，已在
  `GGOOLLMClient`（`backend/app/integrations/ggoo.py`）实现（base64 编码图片、走
  chat completion 的 `image_url` content block）。`backend/app/api/files.py` 的
  `_enrich_image_summary()`（79-129行）是现成的"图转文"调用范例，含 12MB 大小保护
  和失败降级。**图片工具应该复用 `describe_image` 把真实上传的商品/菜品照片转成
  文字描述，塞进生成提示词做事实锚定，而不是去猜一个没确认过的图生图/图片编辑
  接口格式**——这是本轮最重要的架构判断，呼应主交接文档 §6.1"真实商品照片是
  事实锚点，不能编造"的原则。
- **异步任务+轮询的 API 范式**：`backend/app/api/diagnosis_jobs.py`（161行）：
  `POST /diagnosis-jobs/` 建 DB 行（`status="queued"`）→
  `background_tasks.add_task(job_fn, job.id, AsyncSessionLocal, llm)`（传 session
  工厂而非 session 本身）→ 立即返回 202；`GET /diagnosis-jobs/{job_id}` 轮询状态，
  找不到或不是本人的都返回 404（不用 403，避免暴露存在性）。图片任务应该照抄这个
  结构，额外接入 `app/billing/ledger.py` 做钱包记账（诊断任务目前没有接账本）。
- **账本/计费**：`backend/app/billing/ledger.py`/`pricing.py` 已完整可用，**零改动
  直接调用**：创建任务时 `pricing.estimate_points()` 拿预估积分（拿不到显示"暂无法
  预估"）→ `ledger.create_task(..., quote_points=...)`（`quoted` 状态）→ 用户确认后
  `transition_task(..., "reserved")` → 后台任务开始 `transition_task(..., "running")`
  → 成功 `transition_task(..., "succeeded", actual_points=...)` / 失败
  `transition_task(..., "failed", error_message=...)`。
- **前端轮询 UI 范式**：`frontend/src/components/Project/ProjectDetailPage.tsx` 第
  868-899行，`useEffect` 里用**递归 `setTimeout`**（不是 `setInterval`）：
  `timer = setTimeout(poll, 1800)` 首次触发，`poll()` 内部成功后
  `timer = setTimeout(poll, 3500)` 自我重新调度，配合 `cancelled` 标志位和
  `clearTimeout` 清理；模块级 `TERMINAL_DIAGNOSIS_JOB_STATUSES = new Set([...])`
  判断是否该停止轮询。`frontend/src/types.ts` 第258-267行 `DiagnosisJobStatus` 是
  状态返回值的类型范例。
- **鉴权取原始 token**：`backend/app/auth/jwt.py` 的
  `_extract_bearer_token(authorization)` / `get_current_user`（必须登录）/
  `get_optional_user`（可选登录），`app/api/billing.py::get_balance` 已示范"既要
  `User` 行、又要原始 token 去调 `ggoo_client`"的写法。

### 5.3 本轮设计中做出的判断（未与用户逐条确认，但有明确理由）

- **图片工具的素材上传要新建一套独立机制**，不复用诊断工具的
  `UploadedFile`/`POST /session/{id}/files`——那张表和接口是诊断会话
  （`DiagnosisSession`）强绑定的（`session_id`/`module_key`/`field_key` 都是问卷
  概念），不适合没有"诊断会话"概念的图片工具。倾向新建一张小表（暂定名
  `ImageAsset`：id/user_id/stored_path/original_name/content_type/
  vision_description/created_at）+ 独立上传接口，磁盘路径类似
  `data/image-assets/{user_id}/...`。
- **不新建结果表**：生成任务的输入参数、锚定文字、结果图片路径等，计划塞进
  `ToolTask.payload_json`（JSON 字符串），不单独建表。
- **历史列表复用已有接口**：`GET /billing/tasks?tool=image` 就能查图片任务历史，
  不用单独做历史接口。
- **不强行关联诊断工具的 `Project` 表**：`Project` 模型和诊断强耦合
  （`profile_json`/`war_room_plan_json` 等诊断专属字段），图片任务的 `project_id`
  暂时留空/独立，不强行打通。

### 5.4 尚未解决、需要继续确认或调查的

- `GGOOClient.generate_image()` 的具体 env var 命名、response 解析细节，以及新建
  `backend/app/imaging/` 包的模块划分——**设计到一半，中途被用户暂停**，还没定稿
  写入正式实现计划。
- 首版每种任务类型（宣传图/电商图）到底需要哪些"最少必填字段"——主交接文档 §16
  明确写着这是业务侧待确认项，不要凭空杜撰成硬性表单，先做保守的小字段集（上传
  参考图 + 简短文字描述 + 风格/比例选择），方便以后加字段。
- 还没最终确定图片工具的路由方案：单一参数化路由（如 `/tools/image/:preset`）还是
  3条独立路由。
- 还没写测试计划的具体文件名/断言，只确定了要照抄
  `tests/test_diagnosis_jobs_api.py` 的 autouse mock 背景任务模式 +
  `tests/platform-credits.test.tsx` 的前端 API mock 模式。

## 6. 给接手者（人类或AI）的建议

1. 先读主交接文档 §5、§6（尤其 §6.1"真实商品照片是事实锚点，不能编造"原则）、
   §8、§9、§12、§16，再看本文件第5节的现有决策，避免重复问用户已经回答过的问题。
2. 步骤5-6 还没有定稿的实现计划，下一步应该是把第5节内容整理成具体的文件级计划
   （新建哪些文件、每个函数签名是什么），跟用户过一遍再动手写代码。
3. 全程遵守三条硬约束：**绝不编造数据**（余额、价格、生成结果，拿不到就明确隐藏/
   报错，不能造假）、**不动诊断工具现有流程**、**只在 `codex/aibuild-platform` 分支
   提交，不合并 main**。
4. 每完成一个可验证的阶段就跑一遍全量测试再提交：
   `cd backend && .venv/Scripts/python.exe -m pytest tests -q`；
   `cd frontend && npm test && npm run build`。
