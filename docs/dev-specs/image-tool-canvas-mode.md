# 图片工具高级画布模式（步骤7）实施计划

> 对应主交接文档 §6.2 高级模式、§6.3 首版最小节点、§7 React Flow / XYFlow 审查结论
> 前置：步骤5-6 图片工具基础模式已完成（commit `6548be9`，已合并到 `codex/aibuild-platform`）

## 1. 目标

两件事一起做：

1. **基础模式增强**：上传参考图后显式反推提示词，用户可选「以原图二次创作（图生图）」或「基于反推提示词生成（文生图）」
2. **高级画布模式**：基于 `@xyflow/react` 的节点画布，首版只读展开

## 2. 入口设计（两条）

### 2.1 顶层直接进入（用户要求）

`ImageToolPage` 顶部增加「基础 / 高级」模式切换。选「高级」直接打开空白画布 +
节点工具箱。首版空白画布只展示工具箱，不可拖拽生成（步骤8做）。

### 2.2 从基础模式生成结果进入

`ImageGeneratePanel` 生成成功后的结果展示区增加「进入高级模式」按钮。点击后跳转
`/tools/image/canvas?taskId={taskId}`，画布自动展开该次任务的后台节点链。

## 3. 基础模式增强：参考图反推提示词 + 双路径生成

### 3.1 当前问题

步骤6 实现中，上传参考图后 `describe_image` 的结果存在 `ImageAsset.vision_description`，
但**用户看不到这个描述**。生成时只走纯文生图，参考图只影响 prompt 填充，没有真正的
图生图路径。

### 3.2 增强后的交互流程

```
上传参考图
  → 系统自动反推提示词（复用 describe_image，结果已存在 vision_description）
  → 展示反推结果（可编辑文本框，用户可修改）
  → 用户选择生成路径：
     A. 以原图二次创作（图生图）：传参考图 URL + 用户需求 → 生成
     B. 基于反推提示词生成（文生图）：传组装后的 prompt（不含原图）→ 生成
  → 报价 → 确认 → 轮询 → 结果
```

### 3.3 后端改动

**`imaging/client.py`**：`GGOOImageClient.generate_image` 增加可选参数
`reference_image_url: str | None`。当传入时走图生图模式：
- OpenAI 风格 body 增加 `image: reference_image_url` 字段
- env var `GGOO_IMAGE_EDIT_PATH` 覆盖图生图接口路径（默认复用 generations 路径）
- 接口未确认时沿用"自适应探测 + 永不编造"模式

**`imaging/jobs.py`**：
- 从 payload 读取 `generation_mode`（`"text2image"` 或 `"image2image"`）
- `image2image` 模式下传 `reference_image_url`（从 `ImageAsset.stored_path` 构造访问 URL）
- 把 `assembled_prompt` 存入 `payload_json`（画布展开需要）

**`api/image_assets.py`**：新增 `GET /image-assets/{id}/description` 返回反推描述
（或直接复用列表接口已有的 `vision_description` 字段，前端直接用）

**`api/image_tool.py`**：`POST /image-tool/tasks` 的 body 增加可选字段
`generation_mode` 和 `edited_description`（用户编辑后的反推提示词）。

### 3.4 前端改动

**`ImageGeneratePanel.tsx`**：
- 选择参考图后，展示反推提示词文本框（值来自 `asset.vision_description`）
- 文本框可编辑
- 下方两个按钮：「以原图二次创作」「基于提示词生成」
- 创建任务时传 `generation_mode` + `edited_description`

## 4. 首版最小节点集（更新，纳入反推 + 双路径）

| 节点 | 输入 | 输出 | 首版要求 | 数据来源 |
|---|---|---|---|---|
| 需求/模板 | 用户选择与业务字段 | 结构化需求 | 必须 | preset + user_intent |
| 素材 | 上传文件/素材库引用 | 图片素材引用 + 缩略图 | 必须 | ImageAsset |
| 反推提示词 | 素材 | 图转文描述 | 必须 | vision_description / edited_description |
| 提示词 | 需求 + 反推描述 | 组装后的 prompt | 必须 | build_generate_prompt 输出 |
| 模型 | 模型选择 | 模型名 + 参数 | 必须 | GGOO_IMAGE_MODEL env |
| 图片生成 | prompt + 模型 + (可选)参考图 | 生成任务 | 必须 | GGOOImageClient，区分图生图/文生图 |
| 结果 | 生成任务 | 图片 URL | 必须 | payload_json.result_image_url |
| 导出 | 选定图片 | 下载 | 必须 | 浏览器下载 |

节点链（图生图模式）：
```
需求/模板 → 素材 → 反推提示词 → 提示词 → 模型 → 图片生成(图生图) → 结果 → 导出
```

节点链（文生图模式，参考图只影响 prompt 不传入生成）：
```
需求/模板 → 素材 → 反推提示词 → 提示词 → 模型 → 图片生成(文生图) → 结果 → 导出
```

画布展开时，素材节点到生成节点之间会标注走的是哪条路径。高清放大、图生视频为
非首版节点，工具箱里灰色展示「即将上线」。

## 5. 文件级改动

### 5.1 后端

```
backend/app/imaging/
├─ client.py          # generate_image 增加 reference_image_url 参数
├─ jobs.py            # 读取 generation_mode，图生图传参考图URL，存 assembled_prompt
└─ presets.py         # 不变

backend/app/api/
├─ image_assets.py    # 可能新增 description 端点（或前端直接用列表字段）
└─ image_tool.py      # task body 增加 generation_mode + edited_description
```

### 5.2 前端

```
frontend/src/components/ImageTool/
├─ ImageGeneratePanel.tsx   # 增加反推提示词展示 + 双路径选择按钮
├─ ImageToolPage.tsx        # 顶部基础/高级 tab 切换
├─ CanvasMode.tsx           # 画布主容器（新增）
├─ buildCanvasNodes.ts      # 从 payload 反推节点+边（新增）
├─ nodes/                   # 7+1 个节点组件（新增）
│  ├─ RequirementNode.tsx
│  ├─ AssetNode.tsx
│  ├─ ReversePromptNode.tsx   # 反推提示词节点（新增）
│  ├─ PromptNode.tsx
│  ├─ ModelNode.tsx
│  ├─ GenerateNode.tsx
│  ├─ ResultNode.tsx
│  └─ ExportNode.tsx
├─ CanvasMode.css           # 新增
└─ nodes/Nodes.css          # 新增

frontend/src/
├─ App.tsx                  # 新增 /tools/image/canvas 路由
├─ types.ts                 # 新增 CanvasNodeData 等类型
└─ api/client.ts            # createImageTask 增加 generation_mode 参数
```

### 5.3 测试

后端：
- `test_imaging_client.py`：增加图生图模式测试（传 reference_image_url）
- `test_image_tool_api.py`：增加 generation_mode 参数测试

前端：
- `tests/image-tool.test.tsx`：增加反推提示词展示 + 双路径按钮测试
- `tests/image-canvas.test.tsx`（新增）：画布渲染 + 节点链展开测试

## 6. 实施阶段

### 阶段 A：后端图生图支持 + payload 增强
1. `client.py`：`generate_image` 增加 `reference_image_url` 参数 + env var 覆盖
2. `jobs.py`：读取 `generation_mode`，图生图传参考图 URL，存 `assembled_prompt`
3. `image_tool.py`：task body 增加 `generation_mode` + `edited_description`
4. 跑后端测试

### 阶段 B：前端基础模式增强（反推 + 双路径）
1. `ImageGeneratePanel.tsx`：选择参考图后展示反推提示词（可编辑）+ 两个生成按钮
2. `client.ts`：`createImageTask` 增加 `generation_mode` + `edited_description` 参数
3. `types.ts`：扩展类型
4. 跑前端测试

### 阶段 C：画布节点组件骨架
1. 建 `nodes/` 目录，8 个节点组件（含反推提示词节点）
2. `buildCanvasNodes.ts`：从 payload 反推 nodes + edges，根据 generation_mode 标注路径
3. `CanvasMode.tsx`：用 `ReactFlow` 渲染，`Background` + `Controls` + `MiniMap`

### 阶段 D：入口接线
1. `ImageToolPage.tsx`：基础/高级 tab 切换
2. `ImageGeneratePanel.tsx`：结果区「进入高级模式」按钮
3. `App.tsx`：`/tools/image/canvas` 路由
4. 从基础模式进入时，`CanvasMode` 根据 taskId 拉取 task 详情展开节点链

### 阶段 E：测试 + 提交
1. 写 `image-canvas.test.tsx` + 扩展 `image-tool.test.tsx`
2. 跑全量测试
3. 提交到 `feat/image-canvas` 分支

## 7. 待确认项

1. **图生图接口形态**：GGOO 文生图网关是否支持图生图？参数名是什么（`image` / `image_url` / `input_image`）？— 首版用 env var 覆盖，默认尝试 OpenAI 风格 `image` 字段
2. **空白画布首版交互范围**：顶层「高级」模式的空白画布，首版是否只展示节点工具箱（不可拖拽生成）？— 推荐：是
3. **节点布局**：首版手动指定坐标还是 dagre 自动布局？— 推荐：首版手动
4. **payload 是否存 assembled_prompt**：推荐存（画布展开需要）
5. **节点状态着色**：首版是否只对「图片生成」节点按 task status 着色？— 推荐：是
6. **画布是否保存**：首版不保存，纯只读展开？— 推荐：是
7. **反推提示词是否自动触发**：上传参考图后自动调 describe_image 展示，还是用户点按钮触发？— 推荐：自动（当前上传时已做了 describe_image，直接展示即可）
