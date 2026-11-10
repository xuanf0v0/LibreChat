# Trinity 部署方案（未执行）

本文记录在本机部署 Trinity 并接入 LibreChat 超级智能体的完整步骤与已核实的约束。**当前环境未部署 Trinity**：`GET /api/super-agent/trinity/health` 返回 `{"enabled":false,"ok":false}`。

## 接入点在 LibreChat 侧（已完成，无需改动）

| 层 | 位置 | 作用 |
|---|---|---|
| 执行器 | `packages/api/src/superagent/trinity.ts` | MCP `StreamableHTTPClientTransport`；`chat_with_agent` + `get_execution_result` 轮询；`trinityMetrics` 取 `cost`/`duration_ms`/`context_used`/`context_max` |
| 选择 | `api/server/services/SuperAgent/index.js` `resolveWorkerExecutor` | 按任务所有者配置 → 环境变量 → 本地执行器回退；规划/评估始终本地 |
| 路由 | `GET /api/super-agent/trinity/health` | 探活 |
| 配置 | `packages/data-provider/src/config.ts` `trinityConfigSchema` | `enabled` / `url` / `apiKey` / `agentName` / `timeoutMs` |
| 密钥 | `packages/api/src/admin/secrets.ts` | `trinity.apiKey` 加密存储、脱敏读取 |
| UI | `client/src/components/SuperAgent/TrinityStatus.tsx` | 仅 `enabled` 时显示徽章 |
| 每 Worker 映射 | `superagent_workers.trinityAgentName` | 优先级：节点映射 → 全局 `TRINITY_AGENT_NAME` → LibreChat agent ID |

## 已核实的本机约束

| 约束 | 实测值 | 影响 |
|---|---|---|
| 端口 8080 | `fullon-frontend-1` 占用（3 个 listener） | Trinity `mcp-server` 硬编码 `8080:8080`，必须改 |
| 内存 | 总 27.8 GB，空闲 9.5 GB | Trinity 平台服务上限合计约 6.6 GB，不含 agent 容器 |
| 磁盘 | 仅一块 NVMe（C: 45 GB 可用，D: 526 GB 可用） | 构建镜像与 agent 容器需要空间 |
| 权限 | 当前账户非管理员 | 无法注册 Windows 服务；Docker Desktop 可用 |
| 模型密钥 | 现有供应商为 Fullon（OpenAI 兼容） | Trinity 官方只读 `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`，需额外准备 |

## 方案 A：完整部署（12 容器）

### 前置

1. 准备 `ANTHROPIC_API_KEY` 或 `GOOGLE_API_KEY`（Trinity 内部 agent 需要）。
2. 确认 8080 可让出，或按下方第 3 步改端口。
3. 至少 15 GB 空闲内存总量，或接受构建期间其他服务变慢。

### 步骤

```powershell
# 1. 克隆（约 1-2 GB）
git clone https://github.com/Abilityai/trinity.git D:\trinity
cd D:\trinity

# 2. 生成 .env（install.sh 第 3 步的等价操作）
Copy-Item .env.example .env
# 必填：SECRET_KEY / ADMIN_PASSWORD / REDIS_PASSWORD / REDIS_BACKEND_PASSWORD
# 生成方式：openssl rand -hex 32 / openssl rand -hex 24
# 模型：ANTHROPIC_API_KEY=<key>
# 内存收紧：BACKEND_AGENT_CALL_LIMIT=4

# 3. 改 mcp-server 端口，避开 8080
#    docker-compose.yml 中 mcp-server 的
#      - "8080:8080"
#    改为
#      - "8090:8080"

# 4. 前端端口（默认 80，空闲）
#    FRONTEND_PORT=3000 写入 .env，避免与系统服务争 80

# 5. 构建基础 agent 镜像（最耗时）
./scripts/deploy/build-base-image.sh

# 6. 构建并启动
docker compose up -d

# 7. 等待健康
docker compose ps
```

### 首次登录与建 agent

1. 浏览器打开 `http://localhost:3000`（或 `.env` 里的 `FRONTEND_PORT`）。
2. `admin` / 第 2 步生成的 `ADMIN_PASSWORD`。
3. Settings 里填模型 Key。
4. 创建 agent，记下名称。
5. Settings → MCP Keys 创建 key，scope 选 **user**（不是 agent），前缀 `trinity_mcp_`。

### 接入 LibreChat

`librechat.yaml`（或管理端配置，二选一）：

```yaml
trinity:
  enabled: true
  url: http://127.0.0.1:8090/mcp
  apiKey: trinity_mcp_<your-key>
  agentName: <trinity-agent-name>   # 可选，省略则用每 worker 映射或 LibreChat agent ID
  timeoutMs: 300000
```

或环境变量（改 `.env` 后重启后端）：

```env
TRINITY_ENABLED=true
TRINITY_URL=http://127.0.0.1:8090/mcp
TRINITY_API_KEY=trinity_mcp_...
TRINITY_AGENT_NAME=my-agent
TRINITY_TIMEOUT_MS=300000
```

### 验证

```powershell
# 探活：期望 {"enabled":true,"ok":true}
curl -H "Authorization: Bearer <jwt>" http://localhost:3080/api/super-agent/trinity/health

# 端到端：创建超级智能体任务，观察 usage 账本出现 provider 耗时
```

## 方案 B：最小可行验证（不装全套）

只验证 LibreChat 侧的 Trinity 适配器能否正确调用任意 MCP 服务端：

1. 用一个最小 MCP 服务端（提供 `chat_with_agent` 与 `get_execution_result` 两个工具，返回固定文本）。
2. 配 `TRINITY_ENABLED=true` + `TRINITY_URL` 指向它。
3. 跑一次超级智能体任务，确认：
   - `trinity/health` 返回 `ok:true`
   - worker 节点的 `result.content` 来自该服务端
   - `usageEvents` 记录 provider 耗时与成本

这只证明适配器正确，不证明 Trinity 本身可用。

## 回滚

```powershell
cd D:\trinity
docker compose down          # 保留卷
docker compose down -v       # 连同 Postgres/SQLite 数据
```

LibreChat 侧把 `trinity.enabled` 改回 `false`（或删掉该配置块）并重启后端即可，其余功能不受影响。

## 已知待核项

- `trinity.ts` 注释与 `.env` 示例里写的 `http://localhost:8000` 是 Trinity **backend**，不是 MCP 端点。MCP 端点是 `http://localhost:8080/mcp`（改端口后为 `8090`）。接入时应填 MCP 端点。
- Trinity 回执的 `cost`/`duration_ms` 字段已按官方 `executions.ts` 实现映射，但**未对真实实例验证**。
- `trinityMetrics` 只在回执携带字段时记录，不虚构零值。
- Planner/Evaluator 始终走本地执行器，只有 Worker 可切到 Trinity。
