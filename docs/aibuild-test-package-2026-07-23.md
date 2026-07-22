# AIBuild 测试交接包

版本：2026-07-23
当前分支：`codex/aibuild-platform`

## 当前范围

本包是开发测试快照，包含：

- 图片创作基础模式：宣传图、电商图、模板入口；
- 电商场景、推荐比例和用户自定义比例；
- 后端隐藏式模板 guidance / Skill 路由；
- CainFlow-inspired 高级工作台：节点、连线、布局、撤销重做、保存加载和版本恢复；
- 前后端测试与 OpenSpec 变更记录。

内部 Skill 和 Prompt 不在前端目录展示，仍由后端模板目录组装后传给图片模型。

## 尚未完成

以下能力还不能按生产功能验收：

- 真正的 6/9/16 张套图异步任务；
- 高级画布中的“优化当前图片”和“按模板重做”；
- 单图取消、重试；
- 生产级队列、对象存储和 GGOO 真实扣费闭环。

## 本地运行

1. 复制 `backend/.env.example` 为 `backend/.env`，填入实际 GGOO 配置。不要把真实 Key 写入代码或提交到 Git。
2. 启动后端：

```powershell
cd backend
& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

3. 新开终端启动前端：

```powershell
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

4. 打开：

- 普通图片工具：`http://localhost:5173/tools/image`
- 高级工作台：`http://localhost:5173/tools/image/canvas`
- 后端接口文档：`http://localhost:8000/docs`

前端的 `/api` 代理配置在 `frontend/vite.config.ts`。如果前端和后端不是本机运行，需要同步修改代理和 `ALLOWED_ORIGINS`。

## 正式测试顺序

先测试不调用模型的界面流程：登录门控、三类模板切换、电商场景、比例选择、画布节点、连线、撤销重做、保存加载。

再使用真实 GGOO 登录和有效模型配置测试：上传商品图、生成单张宣传图、生成单张电商图、轮询任务结果和历史记录。每次测试记录输入模板、比例、任务状态和返回结果，不要把真实 Token、Key 或用户数据放进测试截图和日志。

## 交接说明

这是用于另一个 AI 模拟运行和人工实测的源码包，不是生产部署包，也不代表可以直接合并主分支。测试通过后，再单独整理提交和 Pull Request。
