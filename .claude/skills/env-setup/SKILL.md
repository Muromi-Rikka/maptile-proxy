---
name: env-setup
description: Interactive environment setup from .env.example
disable-model-invocation: true
---

# 环境配置技能

引导式配置 maptile-proxy 的环境变量。

## 使用方式

```
/env-setup          - 交互式配置环境
/env-setup check    - 检查当前配置是否完整
/env-setup diff     - 对比 .env.example 和 .env.local 的差异
```

## 流程

### 1. 检查现有配置

```bash
# 对比 .env.example 和 .env.local
diff .env.example .env.local || echo "配置文件不一致"
```

### 2. 必需的环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `MAP_SOURCE` | 瓦片源 URL 模板 | `https://tile.example.com/{z}/{x}/{y}.png` |
| `S3_BUCKET` | S3 存储桶名称 | `my-tile-cache` |
| `S3_PREFIX` | S3 对象前缀 | `tiles/` |
| `AWS_REGION` | AWS 区域 | `ap-northeast-1` |
| `AWS_ACCESS_KEY_ID` | AWS 访问密钥 ID | - |
| `AWS_SECRET_ACCESS_KEY` | AWS 访问密钥 | - |

### 3. 可选的环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `S3_ENDPOINT` | 自定义 S3 端点 | - |
| `S3_FORCE_PATH_STYLE` | 使用路径风格访问 | `false` |
| `CACHE_MAX_SIZE` | 最大缓存条目数 | `10000` |
| `CACHE_RESET_INTERVAL` | 缓存重置间隔(ms) | `3600000` |
| `TILE_LOAD_TIMEOUT` | 瓦片加载超时(ms) | `30000` |

### 4. 生成 .env.local

将 `.env.example` 复制为 `.env.local` 并填入实际值：

```bash
cp .env.example .env.local
```

### 5. 验证配置

```bash
# 检查必需变量是否都已设置
grep -v "^#" .env.local | grep -v "^$" | sort
```

## 安全提醒

- ⚠️ **永远不要** 将 `.env.local` 提交到 git
- ✅ `.env.local` 已在 `.gitignore` 中
- ✅ 只提交 `.env.example`（不含实际密钥）
