#!/usr/bin/env node
const readline = require("readline");
const router = require("../core/router");
const db = require("../core/db");

// Default or environment-assigned identity
let clientAppName = "desktop-app";
let currentAgentName = process.env.AGENT_NAME || db.loadPersistentIdentity() || `agent-${process.pid}`;
let registeredName = null;

// All available MCP tools
const TOOLS = [
  {
    name: "send_and_wait",
    description: "向指定的 Agent（无论是其他桌面端应用、ZCode其他窗口、还是Herdr命令行Agent）发送任务并【阻塞同步等待】其回包。等待期间大模型 0 Token 消耗，对方完成后将即刻唤醒本对话。",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "目标 Agent 名称（如 'antigravity-worker', 'zcode-frontend', 'kimi', 'pi' 或 Herdr 面板 ID）"
        },
        message: {
          type: "string",
          description: "需要派发给目标 Agent 的详细任务要求或消息内容"
        },
        timeout_sec: {
          type: "number",
          description: "最长等待超时时间（秒，默认 300）"
        }
      },
      required: ["target", "message"]
    }
  },
  {
    name: "wait_for_task",
    description: "【监听任务或回包】挂起等待其他 Agent 派发任务、交付回包或协同通知（0 Token 消耗）。一旦有指派给本 Agent 的信件到达，立即唤醒本对话开始执行。注意：若宿主客户端（如 ZCode、部分桌面 IDE）强制限制了单次工具调用不可超过 30 秒，请勿循环重试此工具（避免高频唤醒消耗大量 Token），建议通过终端后台运行 `router wait-one <agent-name>` 作为静默唤醒哨兵，任务消费与结案回包依然通过本 MCP 执行。",
    inputSchema: {
      type: "object",
      properties: {
        timeout_sec: {
          type: "number",
          description: "单次最长等待秒数（默认 86400 秒 = 24 小时；0 Token 挂起，超时静默重挂即可）"
        },
        mode: {
          type: "string",
          description: "监听捕获模式：'all'（默认：同时捕获新任务、回包与提醒通知）、'task'（仅监听新派发任务）、'reply'（仅监听完工交付回包）",
          enum: ["all", "task", "reply"]
        }
      }
    }
  },
  {
    name: "send_message",
    description: "向指定的 Agent 发送异步单向消息、即刻唤醒通知或对之前任务的回包。",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "目标 Agent 名称（如 'commander', 'kimi', 'zcode-frontend'）"
        },
        message: {
          type: "string",
          description: "消息内容或执行结果"
        },
        reply_to: {
          type: "string",
          description: "如果这是对某次任务的答复，请提供任务的 ReqId"
        },
        is_task: {
          type: "boolean",
          description: "是否作为异步任务派发（将生成 ReqId、写入待办队列并即刻唤醒目标 Agent 的 wait_for_task 监听）"
        },
        wake: {
          type: "boolean",
          description: "是否作为即刻唤醒通知（即刻唤醒目标哨兵，但不会在 requests/ 中生成强追踪待办，适合紧急更正、放行或知会，避免看门狗报假警）"
        }
      },
      required: ["target", "message"]
    }
  },
  {
    name: "check_inbox",
    description: "查收其他 Agent 发给当前 Agent 的未读消息。",
    inputSchema: {
      type: "object",
      properties: {
        clear: {
          type: "boolean",
          description: "是否在查收后清空信箱（默认 false）"
        }
      }
    }
  },
  {
    name: "list_agents",
    description: "列出当前消息网络中所有已登记的 Agent（包括所有桌面端窗口与终端各 Agent）及其在线状态和角色。",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "register_identity",
    description: "在全局消息中枢中声明或切换当前 Agent 的业务角色名（如 'architect', 'frontend-dev', 'cici'）。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "业务名称（如 'architect', 'zcode-frontend', 'cici'）"
        },
        role: {
          type: "string",
          description: "该 Agent 负责的角色描述"
        },
        persist: {
          type: "boolean",
          description: "是否将此工号持久化保存为本工作区的默认身份（后续切窗或会话重启自动生效，杜绝身份漂移）"
        }
      },
      required: ["name"]
    }
  }
];

// Handle tool execution
async function handleToolCall(name, args) {
  db.log(`[MCP Server (${currentAgentName})] Tool call: ${name} with args: ${JSON.stringify(args)}`);

  switch (name) {
    case "send_and_wait": {
      const { target, message, timeout_sec = 300 } = args;
      try {
        const result = await router.sendAndWait(currentAgentName, target, message, timeout_sec);
        return {
          content: [
            {
              type: "text",
              text: `✅ [任务完成 - 回复来自 ${result.from} (ReqId: ${result.req_id})]:\n\n${result.reply}`
            }
          ]
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `❌ [等待超时或失败]: ${err.message}`
            }
          ]
        };
      }
    }

    case "wait_for_task": {
      const timeoutSec = args?.timeout_sec || 86400;
      const mode = args?.mode || "all";
      const res = await router.waitForTask(currentAgentName, timeoutSec, { mode });
      if (res.timeout) {
        return {
          content: [{ type: "text", text: `⏳ [暂无新信件]: ${res.message}` }]
        };
      }

      let badge = "🎯 [新任务到达]";
      let tip = `👉 提示：完成任务后，请调用 send_message(target="${res.from}", message="...", reply_to="${res.req_id}") 向调用方回传结果！`;

      if (res.type === "rpc_reply") {
        badge = "📦 [完工交付回包]";
        tip = `👉 提示：调用方结案/质检。原任务ID: ${res.reply_to || "N/A"}`;
      } else if (res.type === "notice") {
        badge = "🔔 [协同即刻通知]";
        tip = `👉 提示：此消息为协同唤醒通知，无需结案回包。`;
      }

      return {
        content: [
          {
            type: "text",
            text: `${badge} - 来自 ${res.from}${res.req_id ? ` (ReqId: ${res.req_id})` : ""}:\n\n${res.message}\n\n${tip}`
          }
        ]
      };
    }

    case "send_message": {
      const { target, message, reply_to, is_task, wake } = args;
      const res = router.send(currentAgentName, target, message, reply_to || null, { isTask: !!is_task, wake: !!wake });
      if (reply_to) {
        return {
          content: [
            {
              type: "text",
              text: `✅ 已向 [${target}] 回传任务结果 (已闭环解除请求: ${reply_to})`
            }
          ]
        };
      }
      if (res.status === "task_dispatched") {
        return {
          content: [
            {
              type: "text",
              text: `📋 已作为异步任务成功派发给 [${target}] (任务ID: ${res.req_id}，已入待办队列并触发即时唤醒)`
            }
          ]
        };
      }
      if (res.status === "wake_sent") {
        return {
          content: [
            {
              type: "text",
              text: `⚡ 已向 [${target}] 发送即刻唤醒通知（已触发目标哨兵唤醒，不生成 requests/ 强追踪待办）`
            }
          ]
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `📨 消息已成功投递给 [${target}]`
          }
        ]
      };
    }

    case "check_inbox": {
      const clear = !!args?.clear;
      const messages = router.getInbox(currentAgentName, clear);
      if (!messages || messages.length === 0) {
        return {
          content: [{ type: "text", text: `📭 当前信箱为空（无发给 ${currentAgentName} 的新消息）` }]
        };
      }
      const formatted = messages.map((m, idx) => {
        let typeBadge = "📨 普通消息";
        if (m.type === "rpc_request") typeBadge = "🎯 任务派单";
        else if (m.type === "rpc_reply") typeBadge = "📦 完工回包";
        else if (m.type === "notice") typeBadge = "🔔 协同通知";

        const reqInfo = m.req_id ? ` | 关联ReqId: ${m.req_id}` : (m.reply_to ? ` | 回复ReqId: ${m.reply_to}` : "");
        return `[#${idx + 1}] [${typeBadge}${reqInfo}] 来自: ${m.from} (${new Date(m.received_at || Date.now()).toLocaleTimeString()})\n内容: ${m.message}`;
      }).join("\n\n---\n\n");
      return {
        content: [{ type: "text", text: `📬 收到 ${messages.length} 条消息:\n\n${formatted}` }]
      };
    }

    case "list_agents": {
      const agents = router.list();
      const listStr = Object.entries(agents).map(([name, info]) => {
        const isCurrent = name === currentAgentName ? " (👈 当前 Agent)" : "";
        const statusBadge = info.status === "offline" ? "🔴 离线" : "🟢 在线";
        return `* **${name}**${isCurrent} [${statusBadge}]:\n  - 宿主应用: ${info.runtime || "unknown"}\n  - 职责: ${info.role || "无"}\n  - 进程 PID: ${info.pid || "N/A"}`;
      }).join("\n\n");
      return {
        content: [{ type: "text", text: `📋 当前网络内注册的 Agent 列表:\n\n${listStr}` }]
      };
    }

    case "register_identity": {
      const { name, role = "Desktop Agent", persist } = args;
      // If renaming, mark old one offline
      if (currentAgentName && currentAgentName !== name) {
        router.unregister(currentAgentName);
      }
      currentAgentName = name;
      router.register(name, {
        role,
        runtime: clientAppName,
        pid: process.pid,
        description: `Registered from ${clientAppName} (PID: ${process.pid})`
      });
      registeredName = name;

      let extraMsg = "";
      if (persist) {
        const saved = db.savePersistentIdentity(name);
        if (saved) {
          extraMsg = "（已持久化写入 .router/agent_name，后续会话重启与切窗自动生效）";
        }
      }

      return {
        content: [{ type: "text", text: `✅ 当前 Agent 身份已确立为 [${name}]（职责：${role}）${extraMsg}` }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC processing loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result, error = null) {
  const payload = { jsonrpc: "2.0", id };
  if (error) {
    payload.error = error;
  } else {
    payload.result = result;
  }
  process.stdout.write(JSON.stringify(payload) + "\n");
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (e) {
    db.log(`[MCP Server] Invalid JSON input: ${trimmed}`, "ERROR");
    return;
  }

  const { id, method, params } = request;

  try {
    if (method === "initialize") {
      // Auto-detect client info
      if (params && params.clientInfo && params.clientInfo.name) {
        clientAppName = params.clientInfo.name.toLowerCase();
      }
      // Auto-disambiguate agent name if no custom name provided
      if (!process.env.AGENT_NAME) {
        const persistent = db.loadPersistentIdentity();
        if (persistent) {
          if (registeredName && registeredName !== persistent) {
            router.unregister(registeredName);
          }
          currentAgentName = persistent;
        } else {
          const previousName = registeredName;
          currentAgentName = `${clientAppName}-${process.pid}`;
          if (previousName && previousName !== currentAgentName) {
            router.unregister(previousName);
          }
        }
      }

      // Register with PID and app metadata
      router.register(currentAgentName, {
        role: "desktop-agent",
        runtime: clientAppName,
        pid: process.pid,
        description: `Active session in ${clientAppName}`
      });
      registeredName = currentAgentName;

      db.log(`[MCP Server] Client connected: ${clientAppName}, registered as [${currentAgentName}] (PID: ${process.pid})`);

      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "universal-agent-router",
          version: "2.0.0"
        }
      });
    } else if (method === "notifications/initialized") {
      db.log(`[MCP Server] Initialized notification received`);
    } else if (method === "ping") {
      sendResponse(id, {});
    } else if (method === "tools/list") {
      sendResponse(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      const result = await handleToolCall(name, args || {});
      sendResponse(id, result);
    } else {
      if (id !== undefined) {
        sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
      }
    }
  } catch (err) {
    db.log(`[MCP Server] Error handling ${method}: ${err.message}`, "ERROR");
    if (id !== undefined) {
      sendResponse(id, null, { code: -32603, message: err.message });
    }
  }
});

// Process Exit & Cleanup Handlers (Prevent zombie registrations)
function cleanupAndExit() {
  try {
    if (registeredName) {
      db.log(`[MCP Server] Cleaning up and unregistering [${registeredName}]`);
      router.unregister(registeredName);
      registeredName = null;
    }
  } catch (e) {}
}

process.on("exit", cleanupAndExit);
process.on("SIGINT", () => { cleanupAndExit(); process.exit(0); });
process.on("SIGTERM", () => { cleanupAndExit(); process.exit(0); });
rl.on("close", () => { cleanupAndExit(); process.exit(0); });

// Initial registration
router.register(currentAgentName, {
  role: "worker",
  runtime: clientAppName,
  pid: process.pid,
  description: `Active session (PID: ${process.pid})`
});
registeredName = currentAgentName;

db.log(`[MCP Server] Process started as [${currentAgentName}] (PID: ${process.pid})`);
