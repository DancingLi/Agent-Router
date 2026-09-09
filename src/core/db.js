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

/**
 * Automatically clean up dead ephemeral agents or processes that exited
 */
function pruneStaleAgents() {
  ensureDirs();
  try {
    const files = fs.readdirSync(AGENTS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(AGENTS_DIR, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const name = path.basename(file, ".json");
        const isEphemeral = /^(agent-\d+|test-client-\d+|smoke-\d+|desktop-app-\d+)/.test(name);

        if (content.pid) {
          let alive = false;
          try {
            process.kill(content.pid, 0);
            alive = true;
          } catch (e) {
            if (e.code === "ESRCH") alive = false;
          }
          if (!alive) {
            try { fs.unlinkSync(filePath); } catch (e) {}
            continue;
          }
        } else if (content.status === "offline" && isEphemeral) {
          try { fs.unlinkSync(filePath); } catch (e) {}
          continue;
        }
      } catch (e) {}
    }
  } catch (e) {}
}

/**
 * Get full registry by scanning .router/agents/*.json (Race-condition free!)
 */
function getRegistry(autoPrune = true) {
  ensureDirs();
  if (autoPrune) {
    pruneStaleAgents();
  }
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
 * Unregister an agent (Removes ephemeral agents, marks persistent agents offline)
 */
function unregisterAgent(name) {
  ensureDirs();
  const agentFile = path.join(AGENTS_DIR, `${name}.json`);
  if (fs.existsSync(agentFile)) {
    const isEphemeral = /^(agent-\d+|test-client-\d+|smoke-\d+|desktop-app-\d+)/.test(name);
    if (isEphemeral) {
      try { fs.unlinkSync(agentFile); } catch (e) {}
      return;
    }
    try {
      const existing = JSON.parse(fs.readFileSync(agentFile, "utf8"));
      if (existing.pid) {
        let alive = false;
        try {
          process.kill(existing.pid, 0);
          alive = true;
        } catch (e) {
          alive = false;
        }
        if (!alive) {
          try { fs.unlinkSync(agentFile); } catch (e) {}
          return;
        }
      }
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

/**
 * Ensure directory for agent's message inbox and seamlessly migrate any legacy single-file inbox
 */
function ensureAgentInboxDir(target) {
  ensureDirs();
  const targetDir = path.join(INBOX_DIR, target);
  const legacyFile = path.join(INBOX_DIR, `${target}.json`);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Migrate legacy single JSON file into per-message files
  if (fs.existsSync(legacyFile) && !fs.statSync(legacyFile).isDirectory()) {
    try {
      const messages = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          const id = `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          fs.writeFileSync(path.join(targetDir, `${id}.json`), JSON.stringify({ ...msg, msg_id: id }, null, 2), "utf8");
        }
      }
      fs.unlinkSync(legacyFile);
    } catch (e) {}
  }

  return targetDir;
}

/**
 * Truly atomic inbox append (Zero-lock Maildir pattern)
 * Concurrent writers write unique files via temp-file rename, preventing any write race conditions.
 */
function appendInbox(target, message) {
  const targetDir = ensureAgentInboxDir(target);
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const id = `msg_${timestamp}_${rand}`;
  const data = {
    ...message,
    msg_id: id,
    received_at: timestamp
  };

  const finalFile = path.join(targetDir, `${id}.json`);
  fs.writeFileSync(finalFile, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Read all messages from target agent inbox. If clear=true, unlinks all messages.
 */
function readInbox(target, clear = false) {
  const targetDir = ensureAgentInboxDir(target);
  const messages = [];
  try {
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".json")).sort();
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        messages.push(content);
        if (clear) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
  messages.sort((a, b) => (a.received_at || a.timestamp || 0) - (b.received_at || b.timestamp || 0));
  return messages;
}

/**
 * Atomically dequeues only ONE matching message/task from target inbox without clearing other messages.
 * Options:
 *   mode: 'all' (default: matches rpc_request, rpc_reply, notice, message)
 *         'task' (matches only rpc_request)
 *         'reply' (matches only rpc_reply)
 *         'notice' (matches notice, message)
 */
function dequeueFromInbox(target, options = {}) {
  const targetDir = ensureAgentInboxDir(target);
  const mode = (options && options.mode) || "all";

  try {
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".json")).sort();
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        let match = false;
        if (mode === "all") {
          match = (content.type === "rpc_request" || content.type === "rpc_reply" || content.type === "notice" || !!content.wake);
        } else if (mode === "task") {
          match = (content.type === "rpc_request");
        } else if (mode === "reply") {
          match = (content.type === "rpc_reply");
        } else if (mode === "notice") {
          match = (content.type === "notice" || !!content.wake);
        } else if (mode === "any") {
          match = true;
        }

        if (match) {
          try { fs.unlinkSync(filePath); } catch (e) {}
          return content;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

/**
 * Backward-compatible task dequeue (only rpc_request)
 */
function dequeueTaskFromInbox(target) {
  return dequeueFromInbox(target, { mode: "task" });
}

const IDENTITY_FILE = path.join(ROUTER_DIR, "agent_name");

/**
 * Load persistent workspace default identity from .router/agent_name
 */
function loadPersistentIdentity() {
  ensureDirs();
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      const name = fs.readFileSync(IDENTITY_FILE, "utf8").trim();
      if (name) return name;
    }
  } catch (e) {}
  return null;
}

/**
 * Save persistent workspace default identity to .router/agent_name
 */
function savePersistentIdentity(name) {
  ensureDirs();
  try {
    if (!name) {
      if (fs.existsSync(IDENTITY_FILE)) fs.unlinkSync(IDENTITY_FILE);
    } else {
      fs.writeFileSync(IDENTITY_FILE, name.trim(), "utf8");
    }
    return true;
  } catch (e) {
    return false;
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
  pruneStaleAgents,
  saveRequest,
  getRequest,
  deleteRequest,
  saveResponse,
  getResponse,
  deleteResponse,
  appendInbox,
  readInbox,
  dequeueFromInbox,
  dequeueTaskFromInbox,
  loadPersistentIdentity,
  savePersistentIdentity,
  ensureAgentInboxDir,
  log
};
