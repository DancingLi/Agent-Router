const fs = require("fs");
const path = require("path");

const ROUTER_DIR = process.env.ROUTER_PROJECT_DIR
  ? path.resolve(process.env.ROUTER_PROJECT_DIR, ".router")
  : path.resolve(__dirname, "../../.router");
const AGENTS_DIR = path.join(ROUTER_DIR, "agents");
const REQUESTS_DIR = path.join(ROUTER_DIR, "requests");
const RESPONSES_DIR = path.join(ROUTER_DIR, "responses");
const INBOX_DIR = path.join(ROUTER_DIR, "inbox");
const LOGS_DIR = path.join(ROUTER_DIR, "logs");

function ensureDirs() {
  for (const dir of [ROUTER_DIR, AGENTS_DIR, REQUESTS_DIR, RESPONSES_DIR, INBOX_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirs();

function initDefaultAgents() {
  const defaults = {
    kimi: { role: "coder", runtime: "herdr", pane_id: "w1:p1", status: "online", description: "Kimi Code CLI in Herdr" },
    pi: { role: "reviewer", runtime: "herdr", pane_id: "w1:p2", status: "online", description: "Pi CLI in Herdr" }
  };
  for (const [name, info] of Object.entries(defaults)) {
    const file = path.join(AGENTS_DIR, `${name}.json`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({ name, ...info }, null, 2), "utf8");
    }
  }
}

initDefaultAgents();

/**
 * Get full registry by scanning .router/agents/*.json (Race-condition free!)
 */
function getRegistry() {
  ensureDirs();
  const registry = {};
  try {
    const files = fs.readdirSync(AGENTS_DIR);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const name = path.basename(file, ".json");
        try {
          const content = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), "utf8"));
          registry[name] = content;
        } catch (e) {}
      }
    }
  } catch (e) {}
  return registry;
}

/**
 * Register or update an agent (Atomic per-agent file write)
 */
function registerAgent(name, info) {
  ensureDirs();
  const agentFile = path.join(AGENTS_DIR, `${name}.json`);
  let existing = {};
  if (fs.existsSync(agentFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(agentFile, "utf8"));
    } catch (e) {}
  }
  const data = {
    ...existing,
    ...info,
    name,
    status: "online",
    updated_at: Date.now()
  };
  fs.writeFileSync(agentFile, JSON.stringify(data, null, 2), "utf8");
  return data;
}

/**
 * Mark an agent offline
 */
function unregisterAgent(name) {
  ensureDirs();
  const agentFile = path.join(AGENTS_DIR, `${name}.json`);
  if (fs.existsSync(agentFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(agentFile, "utf8"));
      existing.status = "offline";
      existing.offline_at = Date.now();
      fs.writeFileSync(agentFile, JSON.stringify(existing, null, 2), "utf8");
    } catch (e) {}
  }
}

/**
 * Check if target agent is alive
 */
function isAgentAlive(target) {
  const registry = getRegistry();
  const info = registry[target];
  if (!info) {
    return { exists: false, alive: false };
  }
  if (info.runtime === "herdr") {
    return { exists: true, alive: true, info };
  }
  if (info.status === "offline") {
    return { exists: true, alive: false, info, reason: "marked_offline" };
  }
  if (info.pid) {
    try {
      process.kill(info.pid, 0);
      return { exists: true, alive: true, info };
    } catch (e) {
      unregisterAgent(target);
      return { exists: true, alive: false, info, reason: "process_dead" };
    }
  }
  return { exists: true, alive: true, info };
}

function saveRequest(request) {
  ensureDirs();
  const filePath = path.join(REQUESTS_DIR, `${request.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(request, null, 2), "utf8");
}

function getRequest(reqId) {
  const filePath = path.join(REQUESTS_DIR, `${reqId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {}
  }
  return null;
}

function deleteRequest(reqId) {
  const filePath = path.join(REQUESTS_DIR, `${reqId}.json`);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

function saveResponse(response) {
  ensureDirs();
  const filePath = path.join(RESPONSES_DIR, `${response.req_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(response, null, 2), "utf8");
}

function getResponse(reqId) {
  const filePath = path.join(RESPONSES_DIR, `${reqId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {}
  }
  return null;
}

function deleteResponse(reqId) {
  const filePath = path.join(RESPONSES_DIR, `${reqId}.json`);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

function appendInbox(target, message) {
  ensureDirs();
  const inboxFile = path.join(INBOX_DIR, `${target}.json`);
  let messages = [];
  if (fs.existsSync(inboxFile)) {
    try {
      messages = JSON.parse(fs.readFileSync(inboxFile, "utf8"));
    } catch (e) {}
  }
  messages.push({
    ...message,
    received_at: Date.now()
  });
  fs.writeFileSync(inboxFile, JSON.stringify(messages, null, 2), "utf8");
}

function readInbox(target, clear = false) {
  const inboxFile = path.join(INBOX_DIR, `${target}.json`);
  if (!fs.existsSync(inboxFile)) {
    return [];
  }
  try {
    const messages = JSON.parse(fs.readFileSync(inboxFile, "utf8"));
    if (clear) {
      fs.writeFileSync(inboxFile, JSON.stringify([], null, 2), "utf8");
    }
    return messages;
  } catch (e) {
    return [];
  }
}

function log(msg, level = "INFO") {
  ensureDirs();
  const logFile = path.join(LOGS_DIR, "router.log");
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, line, "utf8");
  } catch (e) {}
}

module.exports = {
  ROUTER_DIR,
  AGENTS_DIR,
  REQUESTS_DIR,
  RESPONSES_DIR,
  INBOX_DIR,
  LOGS_DIR,
  getRegistry,
  registerAgent,
  unregisterAgent,
  isAgentAlive,
  saveRequest,
  getRequest,
  deleteRequest,
  saveResponse,
  getResponse,
  deleteResponse,
  appendInbox,
  readInbox,
  log
};
