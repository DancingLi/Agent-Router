<div align="center">

# 🌐 Universal Agent Router

**The Universal Multi-Agent Communication Bus & Zero-Token RPC Orchestrator**

*Bridge Desktop AI IDEs (Claude Desktop, Cursor, Windsurf, ZCode, AntiGravity) and Terminal CLI Agents (Claude Code, Kimi, Aider, Herdr) seamlessly.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20external-blue.svg)](#features)
[![Protocol](https://img.shields.io/badge/protocol-MCP%20JSON--RPC%202.0-orange.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/DancingLi/Agent-Router/actions/workflows/ci.yml/badge.svg)](https://github.com/DancingLi/Agent-Router/actions)

[English](README.md) | [中文说明文档](README_CN.md)

</div>

---

## 💡 Why Universal Agent Router?

Modern software engineering with AI agents faces a major bottleneck: **fragmentation and token waste**.
- Developers use **Desktop IDEs** (Cursor, Claude Desktop, ZCode, AntiGravity) for visual code reviews and editing.
- At the same time, developers run **Autonomous CLI Agents** (Claude Code, Kimi CLI, Aider, Herdr) for heavy refactoring and terminal commands.
- **The Problem**: These agents run in isolated silos. When they coordinate by polling or chatting, they burn millions of unnecessary LLM tokens while waiting.

**Universal Agent Router** solves this with an ultra-lightweight, zero-dependency inter-agent communication bus powered by the **Model Context Protocol (MCP)**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Desktop AI IDEs & Applications                       │
│      Cursor    │    Claude Desktop    │    AntiGravity    │    ZCode    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (MCP stdio / JSON-RPC 2.0)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Universal Agent Router Core                        │
│            • Zero-Token RPC Engine (`send_and_wait`)                    │
│            • Real-Time PID Liveness Probes (`isAgentAlive`)             │
│            • Event-Driven Task Inboxes (`waitForTask` / `fs.watch`)      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (PTY / CLI / IPC)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Terminal & Autonomous CLI Agents                     │
│       Claude Code    │     Kimi CLI     │    Aider    │     Herdr       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

- ⚡ **Zero-Token Blocking RPC (`send_and_wait`)**:
  When Agent A dispatches a task to Agent B, Agent A's Node.js runtime suspends in an event-driven Promise. **During the entire task execution, the calling LLM consumes exactly 0 API tokens.** As soon as Agent B completes the task, Agent A is woken up in milliseconds.
- 🛡️ **Real-Time PID Liveness & Anti-Deadlock**:
  Unlike naive shared-file registries, the router inspects operating system PIDs (`process.kill(pid, 0)`) in real time. If a target editor window is closed or a process crashes, callers fail over instantly rather than hanging until timeout.
- 📦 **100% Zero External Dependencies**:
  Engineered purely with Node.js built-ins (`fs`, `path`, `readline`, `child_process`). Clone and run immediately — zero `npm install`, zero bloated `node_modules`, zero supply-chain vulnerabilities.
- 🔄 **Full-Duplex Orchestration**:
  Any agent can act as a Commander (dispatching tasks and awaiting replies), a Worker (passively listening for tasks), or a Peer (sending async status updates).
- 🧩 **Universal Model Context Protocol (MCP) Support**:
  Exposes standard JSON-RPC 2.0 tools compatible with any MCP client out of the box.
- 🖥️ **Cross-Platform CLI**:
  Includes a standalone `router` CLI utility for bash scripts, tmux, and terminal multiplexers (such as Herdr).

---

## 🚀 Quick Start (In 60 Seconds)

### 1. Clone & Link Globally
```bash
git clone https://github.com/DancingLi/Agent-Router.git
cd Agent-Router

# Make `router` and `router-setup` available globally
npm link --force
```

### 2. Auto-Configure Desktop Clients
Run the automated client configurator:
```bash
router-setup
# Or: ./bin/setup-clients.sh
```
This automatically registers the MCP server with:
- Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)
- ZCode & AntiGravity (`~/.zcode/cli/config.json`, `~/.agents/mcp.json`)
- Creates global symlinks for terminal agents.

### 3. Verify Everything Works
```bash
npm test
```
*(All unit and multi-process simulation tests run in ~2 seconds!)*

---

## 🛠️ MCP Tools Reference

When connected via MCP, the following tools are available to your agents:

| Tool Name | Type | Description |
| :--- | :--- | :--- |
| `send_and_wait` | Synchronous RPC | Dispatches a task to a target agent and **suspends until completion** (0 token waste). Returns the reply content directly. |
| `wait_for_task` | Event Loop | Puts an agent in Worker mode, listening for incoming tasks (0 token consumption while idle). Wakes immediately upon task receipt. |
| `send_message` | Asynchronous | Sends an async notification or replies to a previous request via `reply_to`. |
| `list_agents` | Discovery | Inspects the live status, PID, role, and host of all connected agents in the local network. |
| `check_inbox` | Mailbox | Checks and optionally clears unread messages in the agent's private inbox. |

---

## 💻 CLI Commands Reference

Developers and CLI agents can interact with the router directly from the shell:

```bash
# 1. Dispatch a task and wait for completion (0 token consumption while waiting)
router call kimi "Please refactor the authentication middleware and write tests" --timeout 180

# 2. Reply to a task or send an async message
router send architect "Auth middleware refactored and all 12 tests passed." --reply-to req_123456

# 3. View live status of all active agents
router list

# 4. Check an agent's inbox
router inbox kimi

# 5. Register an agent manually
router register kimi coder w1:p1
```

---

## ⚙️ Manual Configuration

If you prefer configuring your MCP clients manually:

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
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

## 🧪 Testing

Universal Agent Router comes with a zero-dependency test suite:

```bash
# Run all unit tests and multi-process simulation tests
npm test
```

Test coverage includes:
1. Agent registration & auto-discovery.
2. Unidirectional message delivery and atomic inbox clearing.
3. Synchronous RPC dispatching & reply matching (`send_and_wait`).
4. Reverse RPC (terminal commander dispatching to IDE agent).
5. RPC timeout protection and resource reclamation.
6. MCP JSON-RPC 2.0 Stdio protocol handshake and tool invocation.
7. Multi-process cross-desktop simulation with instant PID failure detection.

---

## 🤝 Contributing

Contributions are warmly welcomed! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on code style, architectural conventions, and the pull request process.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
