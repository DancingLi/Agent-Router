const fs = require("fs");
const path = require("path");
const db = require("./db");
const herdr = require("./herdr");

class AgentRouter {
  constructor() {
    this.pendingResolvers = new Map(); // reqId -> { resolve, reject, timer }
  }

  register(name, info) {
    db.log(`Registering agent: ${name} (${JSON.stringify(info)})`);
    return db.registerAgent(name, info);
  }

  unregister(name) {
    db.log(`Unregistering agent: ${name}`);
    return db.unregisterAgent(name);
  }

  list() {
    const registry = db.getRegistry();
    const herdrResult = herdr.listHerdrAgents();
    if (herdrResult.ok && herdrResult.output) {
      const lines = herdrResult.output.split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const [agentName, paneId] = parts;
          if (agentName && !registry[agentName]) {
            registry[agentName] = {
              role: "herdr-agent",
              runtime: "herdr",
              pane_id: paneId,
              status: "online",
              auto_discovered: true
            };
          }
        }
      }
    }
    return registry;
  }

  /**
   * Send a message and wait synchronously for a reply (Zero-Token RPC)
   */
  async sendAndWait(from, target, message, timeoutSec = 300) {
    // 1. Proactive Liveness Check: don't wait for timeout if target is already dead/closed
    const liveness = db.isAgentAlive(target);
    if (liveness.exists && !liveness.alive) {
      const reason = liveness.reason === "process_dead" ? "窗口进程已终结" : "已下线";
      throw new Error(`无法投递：目标 Agent [${target}] ${reason}，请确认其应用窗口是否已关闭。`);
    }

    const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const registry = this.list();
    const targetInfo = registry[target] || { runtime: "herdr", pane_id: target };

    db.log(`[sendAndWait] ${from} -> ${target} (ReqId: ${reqId}, Timeout: ${timeoutSec}s)`);

    const taskPayload = {
      id: reqId,
      from,
      target,
      message,
      created_at: Date.now(),
      status: "pending"
    };

    // 2. Save pending request to shared disk
    db.saveRequest(taskPayload);

    // 3. Append to target inbox (triggers cross-process file-watcher)
    db.appendInbox(target, {
      req_id: reqId,
      from,
      type: "rpc_request",
      message
    });

    // 4. If target is in Herdr, prompt Herdr terminal
    if (targetInfo.runtime === "herdr" || targetInfo.pane_id) {
      const herdrTarget = targetInfo.pane_id || target;
      const promptText = `【来自 ${from} 的协同任务】\n${message}\n\n[完成后请在终端运行回复]:\nrouter send ${from} "<你的结果/回复>" --reply-to ${reqId}`;
      db.log(`[sendAndWait] Prompting Herdr target: ${herdrTarget}`);
      const promptResult = herdr.promptAgent(herdrTarget, promptText);
      if (!promptResult.ok && targetInfo.pane_id) {
        herdr.sendPaneText(targetInfo.pane_id, `\n# 新任务:\n${promptText}\n`);
      }
    }

    // 5. Block and wait for response (Zero-Token Promise Wait)
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        if (watcher) {
          try { watcher.close(); } catch (e) {}
        }
        db.deleteRequest(reqId);
        db.deleteResponse(reqId);
        this.pendingResolvers.delete(reqId);
      };

      const handleSuccess = (responseData) => {
        if (settled) return;
        cleanup();
        db.log(`[sendAndWait] Resolved ${reqId} successfully`);
        resolve(responseData);
      };

      const handleTimeout = () => {
        if (settled) return;
        cleanup();
        db.log(`[sendAndWait] Timeout waiting for reply to ${reqId} after ${timeoutSec}s`, "ERROR");
        reject(new Error(`Timeout: Target agent "${target}" did not reply within ${timeoutSec} seconds.`));
      };

      const timer = setTimeout(handleTimeout, timeoutSec * 1000);

      this.pendingResolvers.set(reqId, {
        resolve: handleSuccess,
        reject: (err) => { cleanup(); reject(err); }
      });

      const interval = setInterval(() => {
        const resp = db.getResponse(reqId);
        if (resp) handleSuccess(resp);
      }, 200);

      let watcher = null;
      try {
        watcher = fs.watch(db.RESPONSES_DIR, (eventType, filename) => {
          if (filename === `${reqId}.json`) {
            const resp = db.getResponse(reqId);
            if (resp) handleSuccess(resp);
          }
        });
      } catch (e) {}
    });
  }

  /**
   * Worker Agent waits for an incoming task (Cross-process, cross-application file watcher)
   */
  async waitForTask(agentName, timeoutSec = 120) {
    db.log(`[waitForTask] ${agentName} started waiting for task (Timeout: ${timeoutSec}s)`);

    // Check inbox first
    const checkCurrentInbox = () => {
      const inbox = db.readInbox(agentName, false);
      const pendingReq = inbox.find(m => m.type === "rpc_request");
      if (pendingReq) {
        db.readInbox(agentName, true);
        return pendingReq;
      }
      return null;
    };

    const immediate = checkCurrentInbox();
    if (immediate) {
      return {
        req_id: immediate.req_id,
        from: immediate.from,
        message: immediate.message
      };
    }

    // Cross-process file watching on .router/inbox/<agentName>.json
    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        if (watcher) {
          try { watcher.close(); } catch (e) {}
        }
      };

      const handleTaskArrived = (task) => {
        if (settled) return;
        cleanup();
        resolve({
          req_id: task.id || task.req_id,
          from: task.from,
          message: task.message
        });
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ timeout: true, message: `在 ${timeoutSec} 秒内未收到新任务` });
      }, timeoutSec * 1000);

      // Fast polling fallback (200ms)
      const interval = setInterval(() => {
        const found = checkCurrentInbox();
        if (found) handleTaskArrived(found);
      }, 200);

      // File-system watcher for instant reaction
      let watcher = null;
      try {
        const targetInboxFile = `${agentName}.json`;
        watcher = fs.watch(db.INBOX_DIR, (eventType, filename) => {
          if (filename === targetInboxFile) {
            const found = checkCurrentInbox();
            if (found) handleTaskArrived(found);
          }
        });
      } catch (e) {}
    });
  }

  send(from, target, message, replyTo = null) {
    db.log(`[send] ${from} -> ${target} (replyTo: ${replyTo || "none"})`);

    if (replyTo) {
      const responseData = {
        req_id: replyTo,
        from,
        to: target,
        reply: message,
        timestamp: Date.now()
      };

      const resolver = this.pendingResolvers.get(replyTo);
      if (resolver) {
        resolver.resolve(responseData);
      }

      db.saveResponse(responseData);
      db.appendInbox(target, {
        from,
        type: "rpc_reply",
        reply_to: replyTo,
        message
      });

      return { ok: true, status: "replied", req_id: replyTo };
    }

    db.appendInbox(target, {
      from,
      type: "message",
      message
    });

    const registry = this.list();
    const targetInfo = registry[target] || { runtime: "herdr", pane_id: target };
    if (targetInfo.runtime === "herdr" || targetInfo.pane_id) {
      const herdrTarget = targetInfo.pane_id || target;
      const promptText = `【来自 ${from} 的消息】\n${message}`;
      herdr.promptAgent(herdrTarget, promptText);
    }

    return { ok: true, status: "sent", target };
  }

  getInbox(target, clear = false) {
    return db.readInbox(target, clear);
  }
}

const routerInstance = new AgentRouter();
module.exports = routerInstance;
