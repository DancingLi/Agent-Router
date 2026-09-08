#!/usr/bin/env bash
set -e

# Dynamically resolve router root directory from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_JS="$ROUTER_DIR/src/mcp/server.js"

# ZCode-style config (.zcode/config.json / ~/.zcode/cli/config.json):
# server entries live under the NESTED path mcp.servers, and any other
# keys already in the file (plugins, etc.) must be preserved.
merge_zcode() {
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
    cfg.mcp = (cfg.mcp && typeof cfg.mcp === "object") ? cfg.mcp : {};
    cfg.mcp.servers = (cfg.mcp.servers && typeof cfg.mcp.servers === "object") ? cfg.mcp.servers : {};
    // Migrate from the legacy literal "mcp.servers" key (written by old versions
    // of this script) and remove it, so the file holds only valid shapes.
    const legacy = (cfg["mcp.servers"] && typeof cfg["mcp.servers"] === "object") ? cfg["mcp.servers"] : {};
    const prev = cfg.mcp.servers["agent-router"] || legacy["agent-router"] || {};
    cfg.mcp.servers["agent-router"] = {
      command: "node",
      args: [process.argv[2]],
      env: Object.assign({}, prev.env || {}, { ROUTER_PROJECT_DIR: process.argv[3] })
    };
    delete cfg["mcp.servers"];
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  ' "$1" "$SERVER_JS" "$ROUTER_DIR"
}

# .agents/mcp.json and Claude Desktop use a TOP-LEVEL mcpServers key instead.
merge_agents() {
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
    cfg.mcpServers = (cfg.mcpServers && typeof cfg.mcpServers === "object") ? cfg.mcpServers : {};
    const legacy = (cfg["mcp.servers"] && typeof cfg["mcp.servers"] === "object") ? cfg["mcp.servers"] : {};
    const prev = cfg.mcpServers["agent-router"] || legacy["agent-router"] || {};
    cfg.mcpServers["agent-router"] = {
      command: "node",
      args: [process.argv[2]],
      env: Object.assign({}, prev.env || {}, { ROUTER_PROJECT_DIR: process.argv[3] })
    };
    delete cfg["mcp.servers"];
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  ' "$1" "$SERVER_JS" "$ROUTER_DIR"
}

echo "🔧 开始为本机各桌面端 Agent 应用配置通用 Router MCP 总线..."

# 1. ZCode 全局 MCP + agents 兼容配置（合并写入，保留既有设置）
mkdir -p ~/.zcode/cli ~/.agents
merge_zcode "$HOME/.zcode/cli/config.json"
merge_agents "$HOME/.agents/mcp.json"
echo "  ✓ 已配置 ZCode 全局 MCP (~/.zcode/cli/config.json, 嵌套 mcp.servers)"
echo "  ✓ 已配置 agents 兼容文件 (~/.agents/mcp.json, 顶层 mcpServers)"

# 2. 配置 Claude Desktop（合并写入，覆盖前备份）
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$HOME/Library/Application Support" ]; then
  mkdir -p "$CLAUDE_DIR"
  CLAUDE_CONFIG="$CLAUDE_DIR/claude_desktop_config.json"
  if [ -f "$CLAUDE_CONFIG" ]; then
    cp "$CLAUDE_CONFIG" "${CLAUDE_CONFIG}.bak"
    echo "  ! 已将原 claude_desktop_config.json 备份为 .bak"
  fi
  merge_agents "$CLAUDE_CONFIG"
  echo "  ✓ 已配置 Claude Desktop MCP"
fi

# 3. 创建软链接以便终端随时调用 router
if command -v router >/dev/null 2>&1; then
  echo "  ✓ router CLI 已在 PATH 中: $(command -v router)"
elif [ -w "/usr/local/bin" ]; then
  ln -sf "$ROUTER_DIR/bin/router" /usr/local/bin/router
  echo "  ✓ 已在 /usr/local/bin/router 创建全局软链接"
else
  mkdir -p "$HOME/bin"
  ln -sf "$ROUTER_DIR/bin/router" "$HOME/bin/router"
  echo "  ✓ 已在 $HOME/bin/router 创建软链接 (请确保 $HOME/bin 在 PATH 中)"
fi

echo ""
echo "🎉 全平台 MCP 配置完毕！"
echo "支持的应用包括: ZCode, AntiGravity, Claude Desktop, Cursor, Codex 等。"
echo "在任意应用中均可直接使用 send_and_wait, wait_for_task, list_agents 工具进行跨端调度！"
