#!/usr/bin/env bash
set -e

# Dynamically resolve router root directory from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_JS="$ROUTER_DIR/src/mcp/server.js"

echo "🔧 开始为本机各桌面端 Agent 应用配置通用 Router MCP 总线..."

# 1. 配置 ZCode 全局与标准 agents
mkdir -p ~/.zcode/cli ~/.agents
cat << CONFIG > ~/.zcode/cli/config.json
{
  "mcp.servers": {
    "agent-router": {
      "command": "node",
      "args": ["$SERVER_JS"],
      "env": {
        "ROUTER_PROJECT_DIR": "$ROUTER_DIR"
      }
    }
  }
}
CONFIG
cp ~/.zcode/cli/config.json ~/.agents/mcp.json
echo "  ✓ 已配置 ZCode 全局及标准 Agents MCP"

# 2. 配置 Claude Desktop (如果存在目录或为其创建)
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
if [ -d "$CLAUDE_DIR" ] || [ -d "$HOME/Library/Application Support" ]; then
  mkdir -p "$CLAUDE_DIR"
  CLAUDE_CONFIG="$CLAUDE_DIR/claude_desktop_config.json"
  if [ -f "$CLAUDE_CONFIG" ]; then
    echo "  ! 检测到已有 claude_desktop_config.json，已备份为 .bak"
    cp "$CLAUDE_CONFIG" "${CLAUDE_CONFIG}.bak"
  fi
  cat << CONFIG > "$CLAUDE_CONFIG"
{
  "mcpServers": {
    "agent-router": {
      "command": "node",
      "args": ["$SERVER_JS"],
      "env": {
        "ROUTER_PROJECT_DIR": "$ROUTER_DIR"
      }
    }
  }
}
CONFIG
  echo "  ✓ 已配置 Claude Desktop MCP"
fi

# 3. 创建软链接以便终端随时调用 router
if [ -w "/usr/local/bin" ]; then
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
