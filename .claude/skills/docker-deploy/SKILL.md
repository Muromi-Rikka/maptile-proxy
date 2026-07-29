---
name: docker-deploy
description: Build, test, and publish Docker images for maptile-proxy
disable-model-invocation: true
---

# Docker 部署技能

管理 maptile-proxy 的 Docker 镜像构建、本地测试和发布流程。

## 使用方式

```
/docker-deploy build    - 本地构建镜像
/docker-deploy up       - 使用 docker compose 启动服务
/docker-deploy down     - 停止服务
/docker-deploy logs     - 查看容器日志
/docker-deploy publish  - 推送镜像到 registry
```

## 前置条件

- Docker Desktop 已安装并运行
- 已配置 `.env.local`（参考 `.env.example`）
- 如需推送镜像，已登录 container registry

## 流程

### 1. 构建镜像

```bash
# 构建镜像（使用 .env.local 注入构建参数）
docker build -t maptile-proxy:local .
```

### 2. 本地运行

```bash
# 使用环境变量文件运行
docker run --rm -it \
  --env-file .env.local \
  -p 3000:3000 \
  maptile-proxy:local
```

### 3. 健康检查

```bash
# 验证服务是否正常
curl -f http://localhost:3000/health || echo "Health check failed"
```

### 4. 查看日志

```bash
# 查看最近的日志
docker logs --tail 100 -f $(docker ps -q -f ancestor=maptile-proxy:local)
```

### 5. 发布镜像

```bash
# 标记镜像
docker tag maptile-proxy:local ghcr.io/$GITHUB_REOWNER/maptile-proxy:latest

# 推送镜像
docker push ghcr.io/$GITHUB_REOWNER/maptile-proxy:latest
```

## 故障排查

| 问题 | 排查步骤 |
|------|----------|
| 构建失败 | 检查 `Dockerfile` 中的基础镜像是否可用 |
| 启动崩溃 | 查看 `docker logs` 输出，检查环境变量 |
| 端口冲突 | 使用 `-p <host_port>:3000` 指定其他端口 |
| 内存不足 | 添加 `--memory=4g` 限制容器内存 |
