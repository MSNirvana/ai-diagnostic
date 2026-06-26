# 上海服务器部署

当前线上部署结构：

- 后端目录：`/home/ubuntu/ai-diagnostic`
- 后端服务：`ai-diagnostic.service`
- 前端中转目录：`/home/ubuntu/ai-diagnostic-frontend`
- nginx 静态目录：`/var/www/ai-diagnostic`
- 服务器：`111.231.168.75`
- 用户：`ubuntu`

## 一键部署

在本地仓库根目录执行：

```bash
DEPLOY_PASSWORD='你的服务器密码' ./scripts/deploy_shanghai.sh
```

脚本会自动执行：

1. 本地前端类型检查
2. 本地后端测试
3. 本地前端构建
4. 同步代码到服务器后端目录
5. 同步前端 `dist` 到 nginx 静态目录
6. 重启 `ai-diagnostic.service`
7. 做基础健康检查

## 可选参数

```bash
SKIP_TESTS=1 DEPLOY_PASSWORD='***' ./scripts/deploy_shanghai.sh
SKIP_BUILD=1 DEPLOY_PASSWORD='***' ./scripts/deploy_shanghai.sh
SKIP_BACKEND_PIP=1 DEPLOY_PASSWORD='***' ./scripts/deploy_shanghai.sh
```

## 注意

- 密码通过环境变量 `DEPLOY_PASSWORD` 传入，不写进仓库。
- 默认会 `rsync --delete`，确保线上目录与本地一致。
- 后端不会同步本地 `.venv`、数据库和上传文件。
