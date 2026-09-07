<div align="center">

# 🌐 Universal Agent Router (通用智能体路由总线)

**跨端多智能体全双工通信总线 & 零 Token 消耗 RPC 编排中枢**

*打通桌面级 AI 宿主（Claude Desktop、Cursor、Windsurf、ZCode、AntiGravity）与终端命令行 Agent（Claude Code、Kimi、Aider、Herdr）的物理壁垒*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20external-blue.svg)](#特性)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20JSON--RPC%202.0-orange.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/DancingLi/Agent-Router/actions/workflows/ci.yml/badge.svg)](https://github.com/DancingLi/Agent-Router/actions)

[English](README.md) | [中文说明文档](README_CN.md)

</div>

---

## 💡 为什么需要 Universal Agent Router？

在当下的 AI Agent 辅助研发实践中，开发者普遍面临两大核心痛点：**生态割裂**与**Token 浪费**。
- 开发者日常使用 **桌面端 IDE 应用**（如 Cursor、Claude Desktop、ZCode、AntiGravity）进行代码审查与可视化交互。
- 同时在后台运行 **自主终端 CLI Agent**（如 Claude Code、Kimi CLI、Aider、Herdr 多面板进程）执行高吞吐的自动化编码与重构任务。
- **痛点所在**：两类智能体彼此孤立，无法高效协作。一旦采用轮询或自然语言聊天来协调，在等待对方完成任务的过程中会白白消耗数百万无效的 API Token，且存在严重的死锁和超时风险。

**Universal Agent Router** 基于 **Model Context Protocol (MCP)** 标准协议，打造了一套超轻量、零外部依赖、面向全双工协同的跨端消息总线。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    桌面端 AI IDE 与图形化客户端                          │
│      Cursor    │    Claude Desktop    │    AntiGravity    │    ZCode    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (MCP stdio / JSON-RPC 2.0)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Universal Agent Router 路由中枢                      │
│            • 零消耗 RPC 挂起引擎 (`send_and_wait`)                       │
│            • 实时操作系统 PID 存活探测 (`isAgentAlive`)                 │
│            • 事件驱动多级信箱 (`waitForTask` / `fs.watch`)               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (PTY / CLI / IPC)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    终端控制台与自主命令行智能体                          │
│       Claude Code    │     Kimi CLI     │    Aider    │     Herdr       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ 核心特性

- ⚡ **零消耗阻塞式 RPC (`send_and_wait`)**：
  当智能体 A 向智能体 B 派发任务时，A 的 Node.js 运行时在传输层以事件驱动 Promise 进入挂起状态。**在智能体 B 执行任务的整个周期内，发起方的大模型停机等待，API Token 消耗严格为 0**！一旦对方完成并回包，毫秒级解冻并恢复执行。
- 🛡️ **实时 PID 存活探测与防假死自愈**：
  摒弃死板的静态注册表，每次派单前通过操作系统内核信号 (`process.kill(pid, 0)`) 实时检验目标进程存活。若目标窗口意外关闭或进程崩溃，立即抛出明确异常拦截盲目调用，绝不无谓等待超时。
- 📦 **100% 零外部依赖 (Zero Dependencies)**：
  完全基于 Node.js 原生模块（`fs`、`path`、`readline`、`child_process`）实现。无需执行繁琐耗时的 `npm install`，克隆即可秒级运行，杜绝臃肿依赖与供应链安全隐患。
- 🔄 **全双工对等协同模式**：
  任意接入的 Agent 既可以是指挥官（发起调用并等待结果），也可以是打工人 Worker（静默挂起监听任务），还可以是对等节点（发送单向异步通知）。
- 🧩 **原生兼容 MCP 标准规范**：
  对外暴露符合 JSON-RPC 2.0 规范的标准 MCP Tools，即插即用兼容现存所有支持 MCP 协议的客户端。
- 🖥️ **跨平台全局 CLI 工具**：
  内置独立的可执行程序 `router`，方便 Shell 脚本、CI/CD 流水线及终端复用器（如 tmux、Herdr）随时发起调度与状态查询。

---

## 🚀 60 秒极速上手

### 1. 克隆项目并全局链接
```bash
git clone https://github.com/DancingLi/Agent-Router.git
cd Agent-Router

# 全局软链接 router 与 router-setup 指令
npm link --force
```

### 2. 一键配置桌面端应用
运行内置的自动化客户端配置程序：
```bash
router-setup
# 或者直接执行: ./bin/setup-clients.sh
```
该脚本会自动为您配置：
- Claude Desktop（写入 `~/Library/Application Support/Claude/claude_desktop_config.json`）
- ZCode 与 AntiGravity 全局规范（写入 `~/.zcode/cli/config.json`、`~/.agents/mcp.json`）
- 为终端环境配置全局可执行命令软链接。

### 3. 运行全量自动化测试
```bash
npm test
```
*(仅需 2 秒即可跑通全部单元测试与跨进程端到端模拟测试！)*

---

## 🛠️ MCP 工具定义速查 (Tools Reference)

接入本 MCP 服务后，智能体将获得以下标准工具：

| 工具名称 (Tool) | 调用模型 | 功能说明 |
| :--- | :--- | :--- |
| `send_and_wait` | 同步阻塞 RPC | 向指定 Agent 派发任务并**阻塞同步等待回包**（等待期间 0 Token 消耗）。任务完成后直接接收对方返回的内容。 |
| `wait_for_task` | Worker 监听 | 进入 Worker 打工人模式，静默挂起等待外部派发给本 Agent 的任务（0 Token 消耗）。任务到达瞬间立即唤醒。 |
| `send_message` | 异步消息 | 向目标 Agent 发送单向消息或对历史任务进行回包（配合 `reply_to` 闭环挂起状态）。 |
| `list_agents` | 拓扑寻址 | 查看局域网内当前连接的所有 Agent 名录、操作系统 PID、运行环境与实时在线状态。 |
| `check_inbox` | 私人信箱 | 检查并清空派发给本 Agent 的未读单向通知信件。 |

---

## 💻 终端命令行指令 (CLI Reference)

人类开发者与命令行终端 Agent 可通过 `router` 命令与整个智能体集群互动：

```bash
# 1. 向 Kimi 派发代码重构任务并挂起等待结果（等待期间 0 Token 消耗）
router call kimi "请优化认证模块中间件并补充单测" --timeout 180

# 2. 完成任务后回包给调用方
router send architect "认证中间件已重构完毕，12 项单测全部通过！" --reply-to req_123456

# 3. 查看当前全域在线的智能体清单与存活 PID
router list

# 4. 查收指定智能体的未读信箱
router inbox kimi

# 5. 在拓扑网络中登记新的终端智能体
router register kimi coder w1:p1
```

---

## ⚙️ 手动配置文件参考

若需针对特定编辑器进行深度自定义配置：

### Cursor / VSCode / Windsurf (`mcp.json`)
```json
{
  "mcpServers": {
    "agent-router": {
      "command": "node",
      "args": ["/path/to/universal-agent-router/src/mcp/server.js"],
      "env": {
        "AGENT_NAME": "cursor-architect",
        "ROUTER_PROJECT_DIR": "/path/to/universal-agent-router"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)
- **macOS 路径**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows 路径**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agent-router": {
      "command": "node",
      "args": ["/path/to/universal-agent-router/src/mcp/server.js"],
      "env": {
        "AGENT_NAME": "claude-pm",
        "ROUTER_PROJECT_DIR": "/path/to/universal-agent-router"
      }
    }
  }
}
```

---

## 🧪 自动化测试体系

本项目自带一套纯原生的健壮测试套件：

```bash
npm test
```

测试覆盖范围包括：
1. Agent 注册、去重与全域寻址表发现。
2. 单向消息分发与信箱原子化清空。
3. 同步阻塞 RPC 派单与回包撮合 (`send_and_wait`)。
4. 反向 RPC 闭环（终端指挥官调用桌面 IDE 员工）。
5. 任务超时自动熔断与资源回收保护。
6. MCP JSON-RPC 2.0 Stdio 协议标准握手及工具调用。
7. 多进程跨桌面端应用端到端联动模拟及瞬时进程消亡（PID Liveness）熔断保护。

---

## 🤝 参与贡献

欢迎社区开发者提交 Issue 与 Pull Request！详情请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
