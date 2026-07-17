# AIBuild 项目交接文档（进度快照 · 2026-07-18 · 步骤5-6完成后）

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
- 图片工具开发分支：`feat/image-tool-basic`（基于 `codex/aibuild-platform` 创建，
  尚未合并回 `codex/aibuild-platform`；合并后可删除此分支）
- 后端：FastAPI + SQLModel + async SQLAlchemy，`backend/`
- 前端：React + TypeScript + react-router-dom + vitest，`frontend/`

## 3. 已完成的开发步骤（对应主交接文档 §14 的11步开发顺序）

| 步骤 | 内容 | 状态 | commit |
|---|---|---|---|
| 1 | 建分支、摸底现有代码结构、跑通现有测试基线 | ✅完成 | 基线，无独立commit |
| 2 | 抽出平台外壳：首页 `/`、工具列表 `/tools`、工具注册表、导航 | ✅完成 | `a9fb1f3` |
| 3 | 验证 GGOO SSO / 用户映射 / 模型计费链路零改动 | ✅完成 | 随 `3870d36` |
| 4 | 积分余额显示（导航栏）+ 任务账本骨架（ToolTask + billing 模块） | ✅完成 | `3870d36` |
| 5 | 图片工具路由 `/tools/image` + 工具注册表注册 | ✅完成 | `6548be9` |
| 6 | 图片工具基础模式生成闭环（3入口 + 上传 + 报价 + 轮询 + 结果） | ✅完成 | `6548be9` |
| 7 | `@xyflow/react` 高级画布 | ⬜未开始（package.json 无 xyflow/reactflow 依赖） | — |
| 8-11 | 主交接文档 §14 后续步骤 | ⬜未细看 | — |

当前基线：步骤6完成后前端 vitest 113/113、后端 pytest 324/324 全绿，TypeScript
编译和 Vite build 均通过。

## 4. 步骤1-4 具体做了什么（未变更，保留上一版快照内容）

### 4.1 平台外壳（commit a9fb1f3）

- `frontend/src/platform/registry.ts`：`ToolDefinition` 数组 + `listVisibleTools()`/
  `getTool()`，当前注册了 `diagnostic` 和 `image` 两个工具。
- `frontend/src/App.tsx`：`/` → 平台首页，`/tools` → 工具列表，`/tools/diagnostic`
  → 重定向进诊断工具原流程，`/tools/image` → 图片工具页面，
  `/projects/*` → 诊断工具项目路由不变。`ProtectedRoute`/`AdminRoute` 是现成的
  路由保护包装组件。
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
  列表，只读）。图片工具已成为第一个真正写入账本的调用方。
- 前端 `PlatformNav.tsx`：登录后拉取余额，`available && points != null` 才渲染积分
  chip，否则静默隐藏；`types.ts` 新增 `CreditsBalance`；`client.ts` 新增
  `fetchCreditsBalance()`。

## 5. 步骤5-6 具体做了什么（commit 6548be9）

### 5.1 后端新增 `backend/app/imaging/` 包

- `imaging/client.py`：`GGOOImageClient` 类，调 GGOO OpenAI 兼容网关的
  `images/generations` 接口。沿用步骤4"自适应探测 + 永不编造"模式：
  - 默认 POST `{gateway_base_url}/images/generations`，body 走 OpenAI 风格
    `{"model": ..., "prompt": ..., "size": ..., "n": 1}`
  - env var 覆盖：`GGOO_IMAGE_GENERATIONS_PATH`（路径）、`GGOO_IMAGE_MODEL`
    （模型名，默认 `image2.0`）、`GGOO_IMAGE_RESPONSE_URL_FIELD`（响应 URL 字段，
    默认 `data.0.url`，支持点号路径）
  - 接口确认后改配置即可，不改代码
  - 失败永不返回假 URL：402 → "积分不足"；401/403 → `GGOOAuthenticationError`；
    429 → "过于频繁"；响应解析不到 URL → `GGOOError("生成结果格式异常")`
  - `_lookup_dotted(data, "data.0.url")` 辅助函数支持 dict/list 嵌套点号路径取值
- `imaging/presets.py`：3 个 `ImagePreset` dataclass（`promo`/`ecommerce`/`template`），
  每个 含 `id/name/tagline/default_style/default_size/prompt_skeleton`。`PRESETS` 字典 +
  `get_preset(id)` / `list_presets()` 函数。
- `imaging/prompts.py`：
  - `IMAGE_ANCHOR_SYSTEM` / `IMAGE_ANCHOR_PROMPT`：图转文 prompt，聚焦"商品/场景事实
    描述"，要求只描述可见特征、不虚构品牌/价格/商标（呼应主交接文档 §6.1）
  - `IMAGE_GENERATE_SYSTEM` + `build_generate_prompt(...)`：把锚点描述 + 用户意图 +
    风格 + 比例填入 prompt_skeleton 的占位符
- `imaging/jobs.py`：`run_image_generation_job(task_id, session_factory, authorization)`
  后台执行函数：
  1. `transition_task` quoted→reserved→running（注意：后台任务启动时可能还在 quoted
     状态，需要先 reserved 再 running，否则状态机会拒绝跳转）
  2. 从 `payload_json` 解析 preset/user_intent/reference_asset_id/style/size
  3. 若有参考素材，加载 `ImageAsset.vision_description` 作为锚点
  4. `build_generate_prompt(...)` 组装 prompt
  5. `ggoo_client.get_or_create_active_key(authorization)` 拿 API key
  6. `GGOOImageClient.generate_image(...)` 调网关拿图片 URL
  7. URL 写入 `payload_json`，`transition_task` → succeeded（actual_points=quote_points）
  8. 失败 → `transition_task` → failed（error_message=str(exc)），**不退款**
     （actual_points 留 None，GGOO 真实扣费接口未确认）

### 5.2 后端新增 `ImageAsset` 表

`backend/app/db/models.py` 新增 `ImageAsset`（`create_all` 自动建表）：
```
id / user_id / stored_path / original_name / content_type /
vision_description / vision_status(pending|parsed|failed|empty) / created_at
```
**为什么不复用 `UploadedFile`**：那张表和 `DiagnosisSession` 强绑定
（`session_id`/`module_key`/`field_key` 都是问卷概念），且无计费字段、无幂等键、
无状态机。`ImageAsset` 是平台级资产，不绑任何会话。

### 5.3 后端新增 `backend/app/api/image_assets.py`

`APIRouter(prefix="/image-assets", tags=["image-tool"])`：
- `POST /image-assets/`（201）：上传图片，校验 `content_type` 是 `image/*`，超 12MB
  拒绝，落盘 `data/image-assets/{user_id}/{id}_{原名}`，同步调
  `llm.describe_image(IMAGE_ANCHOR_SYSTEM, IMAGE_ANCHOR_PROMPT, ...)` 做图转文，
  失败降级 `vision_status=failed`（不阻塞上传）
- `GET /image-assets/`：列出当前用户的素材
- `GET /image-assets/{id}/file`：返回 `FileResponse`（鉴权后只允许本人访问）
- `DELETE /image-assets/{id}`（204）：删 DB 行 + 删磁盘文件

### 5.4 后端新增 `backend/app/api/image_tool.py`

`APIRouter(prefix="/image-tool", tags=["image-tool"])`：
- `POST /image-tool/tasks`（202）：创建生成任务。校验 preset_id 合法 +
  reference_asset_id 存在且属于本人 → `pricing.estimate_points("image", "basic")`
  拿报价（None 则前端显示"暂无法预估"）→ `ledger.create_task(tool="image",
  mode="basic", quote_points=..., payload_json=..., idempotency_key=...)` →
  `background_tasks.add_task(run_image_generation_job, task.id, AsyncSessionLocal,
  authorization)`（**传 AsyncSessionLocal 工厂而非请求级 session**）→ 返回 202 +
  task_id + status="quoted" + quote_points
- `POST /image-tool/tasks/{id}/confirm`：用户确认报价，quoted→reserved（幂等：
  已 reserved/running/succeeded 直接返回当前状态）
- `GET /image-tool/tasks/{id}`：轮询状态，找不到或非本人均 404（不暴露存在性）
- `GET /image-tool/tasks`：历史列表（也可复用 `GET /billing/tasks?tool=image`）

**响应模型**：`ImageTaskStatus{id/status/progress/quote_points/actual_points/error/
result_image_url/created_at/updated_at}`，`result_image_url` 从 `payload_json` 解析。

### 5.5 后端路由注册

`backend/app/main.py` 新增两行：
```python
from app.api.image_assets import router as image_assets_router
from app.api.image_tool import router as image_tool_router
app.include_router(image_assets_router)
app.include_router(image_tool_router)
```
全局异常处理 `@app.exception_handler(GGOOError)` 已自动覆盖图片工具抛出的 GGOOError。

### 5.6 前端新增

- `frontend/src/platform/registry.ts`：`tools` 数组追加图片工具注册：
  `{id:"image", name:"图片创作", tagline:"...", entryPath:"/tools/image", status:"active"}`
- `frontend/src/App.tsx`：新增 `/tools/image` 路由，套 `ProtectedRoute`
- `frontend/src/types.ts`：新增 `ImageAssetOut` / `ImageTaskStatus` /
  `CreateImageTaskResponse` 类型
- `frontend/src/api/client.ts`：新增 7 个 API 函数
  （`uploadImageAsset` / `listImageAssets` / `deleteImageAsset` /
  `createImageTask` / `confirmImageTask` / `getImageTask` / `listImageTasks`），
  全部复用 `authHeaders()` + `apiFetch` 的 401 自动刷新管道
- `frontend/src/components/ImageTool/`（新目录）：
  - `ImageToolPage.tsx`：入口页，3 个 preset 卡片 + 登录门控 + 历史列表
  - `ImageGeneratePanel.tsx`：核心交互面板（上传参考图 + 需求描述 + 报价确认 +
    递归 setTimeout 轮询 + 结果展示/失败重试），轮询范式照搬
    `ProjectDetailPage.tsx` L868-899（cancelled 标志 + cleanup clearTimeout +
    终态集合 `TERMINAL_STATUSES`）
  - `ImageHistoryList.tsx`：历史任务列表，带状态标签
  - 3 个 CSS 文件

### 5.7 测试

后端新增 3 个测试文件共 32 个测试：
- `tests/test_imaging_client.py`（11个）：mock httpx 返回正常 URL / 401 / 402 / 429 /
  响应无 URL / 非法 JSON / env var 覆盖路径 / env var 覆盖响应字段 /
  `_lookup_dotted` 单元测试
- `tests/test_image_assets_api.py`（9个）：上传成功/拒绝非图片/拒绝超12MB/
  列表隔离/文件访问/文件访问隔离/删除/删除隔离/未登录401
- `tests/test_image_tool_api.py`（12个）：创建202+报价/报价None/未知preset 400/
  他人素材404/确认quoted→reserved/确认幂等/轮询状态/轮询404隔离/列表隔离/
  幂等键防重复/后台任务成功/后台任务失败

前端新增 `tests/image-tool.test.tsx`（5个）：工具卡片展示 / 链接指向 / 未登录跳转 /
preset 卡片展示 / 历史列表展示。测试范式照搬 `platform-credits.test.tsx`
（`vi.mock useAuth + api/client` + `MemoryRouter` 渲染 App）。

## 6. 关键架构决策与踩过的坑

### 6.1 三条硬约束（全程遵守）

1. **绝不编造数据**：余额、价格、生成结果，拿不到就明确隐藏/报错，不能造假
2. **不动诊断工具现有流程**
3. **只在 `codex/aibuild-platform` 分支提交，不合并 main**

### 6.2 状态机跳转坑

后台任务 `run_image_generation_job` 启动时，任务可能还在 `quoted` 状态（用户未
调用 `/confirm`）。状态机不允许 `quoted→running` 直接跳转，必须先
`quoted→reserved` 再 `reserved→running`。代码里的处理：
```python
if task.status == "quoted":
    await transition_task(session, task, "reserved")
await transition_task(session, task, "running")
```

### 6.3 "自适应探测 + 永不编造"范式

这是 GGOO 第三方接口未确认场景的标准解法，已在两处使用：
1. `get_credit_balance`（步骤4）：探测余额字段名，env var 覆盖路径/字段
2. `GGOOImageClient.generate_image`（步骤6）：默认 OpenAI 风格，env var 覆盖
   路径/模型/响应字段

**后续遇到任何"GGOO 接口形态未确认"的场景，照此模式实现**。

### 6.4 事实锚点原则（主交接文档 §6.1）

真实商品照片是事实锚点，**不能虚构商品/食材/份量/价格/商标**。图片工具的
`IMAGE_ANCHOR_PROMPT` 明确要求"只描述可见特征，不猜测品牌/价格/产地"，
`build_generate_prompt` 生成的 prompt 也声明"基于上传素材的事实描述"。

### 6.5 复用而非新建

- **账本**：直接用 `ToolTask` 表 + `ledger.py`，不建新表
- **异步任务范式**：照搬 `diagnosis_jobs.py` 的 `background_tasks.add_task` +
  传 `AsyncSessionLocal` 工厂
- **图转文**：复用 `LLMClient.describe_image`（已在 `GGOOLLMClient` 实现）
- **前端轮询**：照搬 `ProjectDetailPage.tsx` L868-899 的递归 setTimeout
- **鉴权**：复用 `get_current_user` + `Header authorization` 双依赖范式

## 7. 待确认项（实施时做的保守假设，需业务侧确认后调整）

1. **三条 preset 的具体文案与默认风格**：宣传图 / 电商图 / 从模板开始的
   `name`、`default_style`、`prompt_skeleton` 是保守草拟的，业务侧确认后可改
2. **`actual_points` 暂用 `quote_points`**：GGOO 真实扣费接口未确认，本期成功后
   按报价记账。待 GGOO 扣费接口确认后改为真实消耗
3. **失败不退款**：本期 `failed` 状态只记 `actual_points=None`，不主动走 `refunded`
   （因为 GGOO 是否真扣费未知）
4. **图片 URL 访问**：假设 GGOO 返回的图片 URL 可直接访问。如果需要鉴权，
   前端 `<img>` 直接用会 403，需要后端代理下载
5. **`GGOO_IMAGE_MODEL` 默认值 `image2.0`**：来自 handoff §5.1，是否准确需确认
6. **路由方案**：当前用单一入口 `/tools/image` + 内部按 preset 切换面板
   （非 3 条独立路由）

## 8. 给接手者（人类或AI）的建议

1. 先读主交接文档 §5、§6（尤其 §6.1"真实商品照片是事实锚点，不能编造"原则）、
   §8、§9、§12、§16，再看本文件第5-6节的实现细节。
2. 步骤5-6 已完成，下一步是步骤7（`@xyflow/react` 高级画布）。需要先
   `npm install @xyflow/react`，然后设计画布节点类型和交互。
3. 全程遵守三条硬约束（见 §6.1）。
4. 每完成一个可验证的阶段就跑一遍全量测试再提交：
   `cd backend && E:\文档\AIBuild\backend\.venv\Scripts\python.exe -m pytest tests -q`；
   `cd frontend && npx vitest run && npm run build`。
5. 如果 GGOO 文生图接口确认了具体形态，改 env var 即可（见 §6.3），不用改代码。
6. `feat/image-tool-basic` 分支需要合并回 `codex/aibuild-platform` 后才能继续在
   `codex/aibuild-platform` 上开发步骤7。

## 9. 快速验证命令

```bash
# 后端测试（324/324）
cd backend
E:\文档\AIBuild\backend\.venv\Scripts\python.exe -m pytest tests -q

# 前端测试（113/113）
cd frontend
npx vitest run

# 前端编译 + build
cd frontend
npx tsc --noEmit
npm run build
```
