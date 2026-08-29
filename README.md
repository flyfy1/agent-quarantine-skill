# Agent Quarantine Pre-install Skill

[中文](#中文) · [English](#english)

## 中文

这是一个面向 Codex 和 Claude Code 的公开 Skill。在安装或更新第三方 Skill 前，
它会调用 Agent Quarantine REST API。相同 repo、git hash 和 Skill 路径已经完成验证时，
API 会直接返回缓存结果；尚未验证时，API 返回异步任务，客户端自动轮询。只有 API 明确返回
`decision: "allow"` 且 `installAllowed: true` 时，Agent 才能继续安装。

它不依赖 MCP，也不会把本地文件上传到平台。API 请求只包含公开 GitHub URL、
可选 Skill 路径、Agent 类型和可选 session ID。

### 安装

让 Codex 执行：

```text
请使用 $skill-installer 安装这个 Skill：
https://github.com/flyfy1/agent-quarantine-skill/tree/main/skills/agent-quarantine-preinstall
```

让 Claude Code 执行：

```text
请检查并把这个公开 Skill 安装到我的个人 Skills 目录：
https://github.com/flyfy1/agent-quarantine-skill/tree/main/skills/agent-quarantine-preinstall
目标目录：~/.claude/skills/agent-quarantine-preinstall
```

也可以手动 clone，然后把 `skills/agent-quarantine-preinstall` 复制到：

- Codex：`~/.codex/skills/agent-quarantine-preinstall`
- Claude Code：`~/.claude/skills/agent-quarantine-preinstall`

首次安装这个 gate Skill 本身仍需要人工检查；仓库刻意保持很小，便于审计。

### 配置

先在 Agent Quarantine 注册账号，并在 Account 页面创建 `aq_` 开头的个人 API key。
当前平台尚未配置公开服务地址；本地运行 MVP 时使用：

```bash
export AGENT_QUARANTINE_API_URL=http://localhost:3000
export AGENT_QUARANTINE_API_KEY=aq_your_key
```

建议让调用方标记运行来源：

```bash
export AGENT_QUARANTINE_CLIENT=codex       # 或 claude-code
export AGENT_QUARANTINE_SESSION_ID=optional-session-id
```

API key 只应放在环境变量或本地 secret manager 中，不要写进仓库、Skill、prompt
或命令行参数。

### 使用

安装完成后，可以直接对 Agent 说：

```text
安装这个 Skill；安装前必须先用 Agent Quarantine API 检查：
https://github.com/owner/repo/tree/main/skills/example
```

客户端退出码：

- `0`：API 明确允许安装。
- `3`：`review` 或 `block`，禁止安装。
- `2`：配置、网络、鉴权、额度、服务器或响应格式失败，禁止安装。

### REST API

```http
POST /api/v1/skill-checks
Authorization: Bearer aq_...
Content-Type: application/json
```

```json
{
  "source": {
    "url": "https://github.com/owner/repo/tree/main/skills/example"
  },
  "client": {
    "name": "codex",
    "sessionId": "optional-session-id"
  }
}
```

Agent 必须同时检查 HTTP 成功、`decision === "allow"` 和
`installAllowed === true`。API 不可达不代表安全，必须 fail closed。

首次提交可能返回：

```json
{
  "jobId": "check-...",
  "checkStatus": "queued",
  "pollUrl": "/api/v1/skill-checks/check-...",
  "retryAfterSeconds": 2
}
```

客户端使用相同 Bearer key 对 `pollUrl` 发起 `GET`，直到拿到最终决定。

## English

This public Skill gates third-party Codex and Claude Code Skill installations
through the Agent Quarantine REST API. Completed revisions return immediately;
new revisions return a pollable job that the client follows automatically.
Installation continues only when the API returns both `decision: "allow"` and
`installAllowed: true`.

Install the directory at
`skills/agent-quarantine-preinstall` into `~/.codex/skills/` or
`~/.claude/skills/`, then configure `AGENT_QUARANTINE_API_URL` and
`AGENT_QUARANTINE_API_KEY`. The included Node 18+ client fails closed on denied,
unavailable, unauthenticated, over-quota, or malformed API responses.

## Development

```bash
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/agent-quarantine-preinstall
```

No npm dependencies are required.
