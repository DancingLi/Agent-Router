const { execFileSync } = require("child_process");
const fs = require("fs");

// Path to herdr binary
const HERDR_BIN = fs.existsSync("/opt/homebrew/bin/herdr")
  ? "/opt/homebrew/bin/herdr"
  : "herdr";

/**
 * Execute a herdr CLI command safely
 */
function runHerdr(args, options = {}) {
  try {
    const stdout = execFileSync(HERDR_BIN, args, {
      encoding: "utf8",
      timeout: options.timeout || 15000,
      stdio: ["ignore", "pipe", "pipe"], // ignore stdin, capture stdout and stderr cleanly
      env: { ...process.env, ...options.env }
    });
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      stderr: err.stderr ? err.stderr.toString().trim() : "",
      stdout: err.stdout ? err.stdout.toString().trim() : ""
    };
  }
}

/**
 * Prompt an agent in herdr (triggers prompt turn)
 * @param {string} target - pane_id (w1:p1) or agent name (kimi, pi)
 * @param {string} text - The prompt message to deliver
 * @param {object} options - wait, timeout
 */
function promptAgent(target, text, options = {}) {
  const args = ["agent", "prompt", target, text];
  if (options.wait) {
    args.push("--wait");
  }
  if (options.timeout) {
    args.push("--timeout", String(options.timeout));
  }
  return runHerdr(args, { timeout: (options.timeout || 30000) + 5000 });
}

/**
 * Send raw text into a pane
 */
function sendPaneText(paneId, text) {
  return runHerdr(["pane", "send-text", paneId, text]);
}

/**
 * Send key presses into a pane
 */
function sendPaneKeys(paneId, ...keys) {
  return runHerdr(["pane", "send-keys", paneId, ...keys]);
}

/**
 * Run a command in a pane
 */
function runPaneCommand(paneId, command) {
  return runHerdr(["pane", "run", paneId, command]);
}

/**
 * List all active agents in herdr
 */
function listHerdrAgents() {
  return runHerdr(["agent", "list"]);
}

/**
 * List all panes in herdr
 */
function listHerdrPanes() {
  return runHerdr(["pane", "list"]);
}

module.exports = {
  HERDR_BIN,
  runHerdr,
  promptAgent,
  sendPaneText,
  sendPaneKeys,
  runPaneCommand,
  listHerdrAgents,
  listHerdrPanes
};
