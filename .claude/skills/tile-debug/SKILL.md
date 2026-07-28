---
name: tile-debug
description: 调试地图瓦片加载和缓存问题
---

# 瓦片调试技能

诊断地图瓦片代理服务的常见问题。

## 调试步骤

### 1. 检查缓存配置
```bash
# 验证环境变量
echo $CACHE_MAX_SIZE
echo $CACHE_RESET_INTERVAL
```

### 2. 验证 MAP_SOURCE URL 模板
- 确保格式正确：`https://api.example.com/{z}/{x}/{y}.jpg`
- 检查 API key 是否有效
- 测试单个瓦片请求

### 3. 测试 S3 连接
```bash
# 检查 AWS 凭证
aws sts get-caller-identity

# 列出 S3 存储桶内容
aws s3 ls s3://$S3_BUCKET/$S3_PREFIX/ --endpoint-url $S3_ENDPOINT
```

### 4. 检查瓦片加载超时
- 默认：30000ms
- 高延迟源可能需要增加 `TILE_LOAD_TIMEOUT`

### 5. 查看日志
```bash
# Pino 日志会显示详细错误
pnpm run dev 2>&1 | grep -i "error\|timeout\|fail"
```

## 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 瓦片加载慢 | 源服务器延迟高 | 增加 CACHE_MAX_SIZE |
| 403 错误 | API key 无效 | 检查 MAP_SOURCE 中的 key |
| S3 存储失败 | 凭证错误 | 验证 AWS 环境变量 |
| 内存溢出 | 缓存过大 | 减少 CACHE_MAX_SIZE |

## 坐标系统问题

项目使用 `gcj02.ts` 处理中国坐标偏移。如果瓦片位置不对：
- 确认源坐标系（WGS84 vs GCJ-02）
- 检查是否需要坐标转换
