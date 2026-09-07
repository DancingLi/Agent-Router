# Contributing to Universal Agent Router

Thank you for your interest in contributing to **Universal Agent Router**! We welcome bug reports, feature suggestions, documentation enhancements, and code contributions.

---

## 🛠️ Development Principles

1. **Zero External Dependencies**:
   The entire router core and MCP server are intentionally written using pure Node.js built-in modules (`fs`, `path`, `readline`, `child_process`). Do not introduce third-party npm packages into the runtime unless absolutely essential.
2. **Zero-Token RPC Philosophy**:
   Any synchronous coordination between agents must not consume tokens while suspended. Always preserve the promise-based event-driven wait pattern.
3. **Cross-Platform Resilience**:
   Ensure file operations, path separators, and process liveness probes (`process.kill(pid, 0)`) work cleanly across macOS and Linux.

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18.0.0
- Git

### Setup
```bash
git clone https://github.com/DancingLi/Agent-Router.git
cd Agent-Router

# Link CLI globally for development testing
npm link --force
```

### Running Tests
Make sure all unit and multi-process simulation tests pass before opening a PR:
```bash
npm test
```

---

## 📁 Codebase Architecture

- **`src/core/db.js`**: Atomic agent state registry in `.router/agents/<name>.json`, real-time PID liveness probe (`isAgentAlive`), and transaction logging.
- **`src/core/router.js`**: Core routing bus handling `sendAndWait` (0-Token blocking RPC), `waitForTask` (fs.watch event loop), and `send`.
- **`src/core/herdr.js`**: PTY terminal multiplexer integration (supporting Herdr and standard terminal sessions).
- **`src/mcp/server.js`**: Model Context Protocol (MCP) JSON-RPC 2.0 stdio server, tool exposure (`send_and_wait`, `wait_for_task`, `send_message`, `list_agents`, `check_inbox`), and lifecycle cleanup.
- **`bin/router`**: Unified command-line interface for human developers and CLI agents.
- **`bin/setup-clients.sh`**: Automatic MCP configurator for Claude Desktop, ZCode, Cursor, and other IDEs.
- **`test/`**:
  - `test-router.js`: Core router function verification (registration, inbox, RPC, timeout).
  - `test-multi-app.js`: End-to-end multi-process cross-desktop simulation with PID death interception.

---

## 🔀 Submitting a Pull Request

1. **Fork the repository** and create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Make your changes**:
   - Write clean, commented code.
   - Update tests if necessary.
   - Verify `npm test` passes 100%.
3. **Commit your changes**:
   - Follow conventional commit messages: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`.
4. **Push and create a Pull Request**:
   - Describe what the PR solves and link any relevant issues.

---

## 🐛 Reporting Issues

If you encounter a bug or have a suggestion:
- Check existing [GitHub Issues](https://github.com/DancingLi/Agent-Router/issues) first.
- Open a new issue with reproducible steps, your operating system, Node.js version, and relevant log excerpts from `.router/logs/router.log`.
