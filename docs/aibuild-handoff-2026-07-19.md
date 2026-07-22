# AIBuild 工作交接快照

日期：2026-07-19  
工作区：E:\文档\AIBuild  
分支：codex/aibuild-platform  
当前 HEAD：2bef228  
目的：供下一个窗口继续完成 OpenSpec 目标，不覆盖旧交接文档。

## 1. 目标与范围

本轮依据 openspec/README.md、openspec/project.md、openspec/architecture.md、openspec/development.md 和 ADR-0001 推进。

当前首要产品主线：

~~~text
平台底座
  → 图片基础任务向导
  → 产品视觉/宣传套图工作台
  → Konva 高级图片工作台
  → 结果筛选、分组与导出
~~~

明确不做：视频、音乐、图生视频、多人实时协作、公开广场、通用自由白板、未经确认的真实 GGOO 计费协议。

硬约束：

- 不编造余额、价格、模型能力、图片 URL 或生成结果；
- 画布只负责交互和呈现，任务执行、状态、计费、权限和持久化由后端负责；
- 不破坏既有经营增长诊断流程；
- 未确认的 GGOO 接口只能通过适配器和环境变量保守降级。

## 2. 本轮已经完成

### 2.1 Konva 高级工作台已接入当前分支

此前存在于 feat/image-tool-canvas 的提交已经按依赖顺序接入当前分支：

- 9bf6ea4：独立高级画布路由；
- 4af7e01：反推提示词与图生图/文生图双路径；
- 3a6f5d2：从 React Flow POC 替换为 Konva 素材导演台；
- 2bef228：连线、框选、多选、分组、图层、锁定/隐藏、Minimap 等交互。

关键文件：

- frontend/src/App.tsx：/tools/image 与 /tools/image/canvas 路由；
- frontend/src/components/ImageTool/canvas/CanvasStage.tsx；
- frontend/src/components/ImageTool/canvas/CanvasBoard.tsx；
- frontend/src/components/ImageTool/canvas/Minimap.tsx；
- frontend/src/components/ImageTool/canvas/useCanvasImage.ts；
- frontend/src/components/ImageTool/canvas/CanvasStage.css；
- frontend/src/types.ts；
- frontend/package.json：konva、react-konva。

高级画布节点已覆盖：

~~~text
需求/模板 → 素材 → 反推提示词 → 图片提示词
         → 图片模型 → 图片生成 → 结果 → 导出
~~~

画布当前是 AIBuild 自有的前端工作流编辑 POC，保存/加载/版本 API 已接入并由专项测试覆盖。

### 2.2 基础图片生成改为直接生成

frontend/src/components/ImageTool/ImageGeneratePanel.tsx 已完成：

- 移除报价确认 UI；
- 主按钮改为 生成图片；
- 创建任务后直接轮询；
- quoted、reserved、running 都按处理中处理；
- 保留失败状态和 GGOO 错误展示；
- 保留参考图反推提示词；
- 保留图生图/文生图双路径；
- 保留成功后进入高级工作台的入口。

后端仍保留旧 /image-tool/tasks/{task_id}/confirm API 和账本状态兼容性，但基础模式不再要求前端调用它。

### 2.3 结果筛选、选择和导出已完成

frontend/src/components/ImageTool/ImageHistoryList.tsx 已增加：

- 全部 / 已完成 / 处理中 / 失败筛选；
- 选择素材与取消选择；
- 单张下载；
- 导出 aibuild-material-pack.json 素材包清单；
- 选择状态和移动端响应式布局。

对应样式在 frontend/src/components/ImageTool/ImageHistoryList.css。

### 2.4 画布保存/加载后端接口已完成

以下工作区未提交修改已经实现并通过单测：

- backend/app/db/models.py 新增 CanvasScene：
  - id
  - user_id
  - task_id
  - name
  - version
  - scene_json
  - created_at
  - updated_at
- backend/app/api/image_tool.py 新增：
  - POST /image-tool/scenes
  - GET /image-tool/scenes/latest?task_id=...
  - GET /image-tool/scenes/{scene_id}

同一用户、同一 task_id 的保存操作会创建新版本，版本号递增。读取和任务关联均做用户隔离。

API 请求示例：

~~~json
{
  "task_id": "<image-task-id>",
  "name": "新品宣传套图",
  "scene": {
    "version": 1,
    "items": [],
    "edges": [],
    "groups": [],
    "viewport": { "x": 0, "y": 0, "scale": 1 }
  }
}
~~~

## 3. 当前未提交修改

git status --short 当前主要显示：

~~~text
 M backend/app/api/image_tool.py
 M backend/app/db/models.py
 M backend/tests/test_image_tool_api.py
 M frontend/src/components/ImageTool/ImageGeneratePanel.tsx
 M frontend/src/components/ImageTool/ImageHistoryList.css
 M frontend/src/components/ImageTool/ImageHistoryList.tsx
 M frontend/src/components/ImageTool/canvas/CanvasStage.tsx
 M frontend/src/components/ImageTool/canvas/Minimap.tsx
 M frontend/tests/image-tool.test.tsx
 M frontend/tests/setup.ts
?? frontend/tests/image-canvas.test.tsx
?? openspec/
?? docs/dev-specs/image-tool-basic-mode.md
?? docs/superpowers/plans/2026-07-18-image-credit-generation.md
~~~

.agents、.codex、.superpowers 也可能是当前工作区已有的环境/技能文件，不要随意删除或重置。

不要使用：

~~~powershell
git reset --hard
git checkout -- .
~~~

这些文件包含本轮和用户已有的未提交内容。

## 4. 当前验证证据

已通过：

~~~powershell
cd frontend
npm install
npm test -- tests/image-tool.test.tsx
~~~

最近结果：图片工具及结果交付测试 7 passed。

已通过：

~~~powershell
cd backend
& .venv\Scripts\python.exe -m pytest tests/test_image_tool_api.py tests/test_imaging_client.py -q
~~~

最近结果：23 passed，有 1 个既有 Starlette/httpx 弃用警告。

已通过：

~~~powershell
cd backend
& .venv\Scripts\python.exe -m pytest tests/test_image_tool_api.py::test_canvas_scene_save_and_load_versions -q
~~~

结果：1 passed。

此前通过过：

~~~powershell
cd frontend
npm run build
~~~

结果：TypeScript 编译和 Vite 构建通过；但结果交付、后端场景 API 等后续修改发生在该次 build 之后，因此必须重新运行。

此前画布基础路由测试通过；随后测试被扩展为要求保存/加载按钮，当前会因为前端尚未接入按钮而失败。这是当前最明确的下一步红灯。

## 5. 下一步必须按此顺序执行

### Step 1：补前端类型和 API 客户端

在 frontend/src/types.ts 增加：

~~~ts
export interface CanvasSceneResponse {
  id: string;
  task_id: string | null;
  name: string;
  version: number;
  scene: CanvasScene;
  created_at: string;
  updated_at: string;
}
~~~

在 frontend/src/api/client.ts 增加：

~~~ts
saveCanvasScene({
  task_id?: string | null;
  name?: string;
  scene: CanvasScene;
}): Promise<CanvasSceneResponse>

getLatestCanvasScene(taskId: string): Promise<CanvasSceneResponse>
~~~

复用现有 authHeaders() 和 errorMessage()，不要直接拼接未鉴权请求。

### Step 2：接入 CanvasStage

文件：frontend/src/components/ImageTool/canvas/CanvasStage.tsx

要求：

- 导入 saveCanvasScene、getLatestCanvasScene；
- 增加保存中状态和场景版本状态；
- 增加 保存画布 按钮，保存当前 scene；
- 增加 加载最近版本 按钮；
- 有 taskId 时通过 GET /scenes/latest 加载；
- 没有保存版本时保留 buildSceneFromTask() 或 buildEmptyScene() 回退；
- 保存成功后显示版本号，不编造持久化成功；
- 加载/保存失败显示明确错误；
- 保存时不要把 viewport 丢掉；
- CanvasScene.version 是前端场景结构版本，后端 response 的 version 是持久化快照版本，二者不要混淆。

当前红灯测试已经要求：

~~~text
保存画布
加载最近版本
~~~

### Step 3：补隔离测试

至少增加：

- 他人不能读取自己的 scene_id；
- 他人不能以他人的 task_id 保存场景；
- 没有最近版本时返回 404，前端应保留任务展开结果而不是清空画布。

### Step 4：同步 OpenSpec

更新 openspec/status.md 和旧交接文档（或在旧文档中指向本快照）。

状态应明确区分：

- Konva 高级工作台：工程 POC 已接入，交互已验证；
- 画布保存/加载/版本：后端已实现，前端接入待完成；
- 结果筛选/导出：前端已实现，测试已覆盖；
- 产品宣传套图 planner/planResult：仍未开始；
- 真实 GGOO 扣费、退款和生产队列：仍待确认/未完成。

不要写 完整产品已完成。

### Step 5：全量验证

~~~powershell
cd backend
& .venv\Scripts\python.exe -m pytest tests -q

cd ..\frontend
npm test
npm run build
git diff --check
git status --short
~~~

npm install 输出过 6 个依赖漏洞（3 moderate、2 high、1 critical）；这是依赖审计结果，不要在未评估升级影响前直接执行 npm audit fix --force。

## 6. 关键实现约束

- GGOO 图片生成和图生图接口仍是适配假设，通过环境变量配置：
  - GGOO_IMAGE_GENERATIONS_PATH
  - GGOO_IMAGE_EDIT_PATH
  - GGOO_IMAGE_REFERENCE_FIELD
  - GGOO_IMAGE_MODEL
  - GGOO_IMAGE_RESPONSE_URL_FIELD
- IMAGE_PUBLIC_BASE_URL 未配置时，图生图任务会保守回退文生图。
- 当前计费仍是本地 ToolTask 账本骨架；真实冻结、结算、释放、退款接口未确认。
- 当前基础设施仍是 SQLite、本地文件存储、FastAPI BackgroundTasks、前端轮询。
- 不要声称有 PostgreSQL、Redis/BullMQ、对象存储、SSE/WebSocket 或真实商业计费闭环。
- 图片事实锚点原则仍有效：不能虚构商品、品牌、规格、价格、商标或活动承诺。

## 7. 下一窗口的启动命令

~~~powershell
cd E:\文档\AIBuild
git status --short
Get-Content -Raw docs\aibuild-handoff-2026-07-19.md
Get-Content -Raw openspec\status.md
~~~

然后直接完成 Step 1 和 Step 2，先让：

~~~powershell
cd frontend
npm test -- tests/image-canvas.test.tsx
~~~

从失败变为通过，再跑全量验证。

## 8. 本快照结论

本轮已经把图片工具从基础生成原型推进到：

~~~text
基础生成
  → 反推提示词/双路径
  → Konva 高级工作台
  → 结果筛选/选择/单张下载/素材包清单
  → 后端画布版本 API
~~~

尚不能标记为 OpenSpec 全部完成。下一窗口的第一目标是把后端画布版本 API 接到前端，并完成全量验证和状态同步。

## 9. 2026-07-23 CainFlow-inspired 工作台 v1

已完成 `openspec/changes/2026-07-23-cainflow-inspired-workbench-v1/` 的第一阶段重建：

- 高级工作台增加工作流工具栏、撤销/重做、键盘快捷键和按连接关系自动整理；
- 自动布局按依赖方向从左到右分层，保留锁定节点位置，并保留节点、连线和当前选择；
- 快捷键不会拦截输入框和文本域的正常编辑；
- 现有保存、加载最近版本、套图规划和任务恢复保持不变；
- 只吸收 CainFlow 的节点式工作流交互思想，未复制 CainFlow 源码、资源或 GPLv3 代码，未引入本地 Python 服务、独立执行器或其 API Key 管理。

后续工作应另立 OpenSpec，逐步增加类型化端口、连接合法性校验、节点级 `idle/validating/queued/running/succeeded/failed/cancelled` 状态、单节点取消/重试、跨工作流复制粘贴和媒体引用缓存。本轮不把这些能力误报为已完成。

## 10. 2026-07-23 电商视觉 Skill v1

已完成第一阶段电商视觉 Skill 层：

- 后端新增 8 个电商场景、4 个风格变体、6 个品类提示和 3 个转化目标；
- 基础电商入口通过 skill-catalog 接收目录，不在前端复制完整模板；
- 任务快照保存 Skill 版本、场景、品类、转化目标、风格和 Prompt 组件；
- 非电商任务和旧客户端保持兼容；
- 尚未实现真实规划模型、Campaign Style Lock 持久化、套图逐图异步任务和共享素材库。

验证结果：后端 333 passed，前端 120 passed，前端生产构建通过，git diff --check 通过。

## 11. 2026-07-23 图片模板路由与隐藏式视觉 Skill v1

已完成第一阶段：

- `template_id` 已从模板选择进入图片任务请求、任务状态和高级画布恢复；
- 后端模板目录只返回业务元数据，内部 Prompt guidance 不暴露给前端；
- 电商模板和电商场景的推荐比例会在模型能力支持时自动联动；
- 宣传模板和电商模板分别使用后端隐藏规则，保留现有 AIBuild 任务、权限和计费边界。

尚未完成：套图规划到逐张异步任务的生产执行，以及高级画布中的单图优化/按模板重做入口。本阶段不把一次候选图生成称为完整套图。
