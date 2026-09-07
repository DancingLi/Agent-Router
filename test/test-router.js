const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const router = require("../src/core/router");
const db = require("../src/core/db");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("🚀 开始运行 Agent Router 完整测试套件 (覆盖全双工架构)...\n");

  // Clean inboxes before test
  router.getInbox("kimi", true);
  router.getInbox("pi", true);
  router.getInbox("architect", true);
  router.getInbox("agent-b", true);
  router.getInbox("commander", true);

  // Test 1: Registry and listing
  console.log("▶ [Test 1] 测试 Agent 注册与寻址表列表...");
  router.register("kimi", { role: "coder", runtime: "herdr", pane_id: "w1:p1" });
  router.register("pi", { role: "reviewer", runtime: "herdr", pane_id: "w1:p2" });
  router.register("architect", { role: "architect", runtime: "zcode" });

  const agents = router.list();
  assert(agents.kimi && agents.kimi.role === "coder", "Kimi registration failed");
  assert(agents.pi && agents.pi.role === "reviewer", "Pi registration failed");
  assert(agents.architect && agents.architect.runtime === "zcode", "Architect registration failed");
  console.log("  ✓ Agent 注册与寻址表通过！");

  // Test 2: Asynchronous Send & Inbox
  console.log("▶ [Test 2] 测试单向消息投递与信箱查收 (Send & Inbox)...");
  router.send("kimi", "pi", "请帮忙 review 一下 PR #102 的提交");
  const piInbox = router.getInbox("pi", true);
  assert(piInbox.length > 0, "Pi inbox should have received message");
  assert(piInbox[piInbox.length - 1].message.includes("PR #102"), "Message content mismatch");
  console.log("  ✓ 单向消息投递与信箱读取通过！");

  // Test 3: RPC sendAndWait with simulated Kimi reply (ZCode Master -> Herdr Worker)
  console.log("▶ [Test 3] 测试 ZCode 主导调度 Herdr Worker (sendAndWait)...");
  const waitPromise = router.sendAndWait("architect", "kimi", "请在 auth.ts 中编写 JWT 鉴权逻辑", 5);

  await sleep(200);
  const requests = router.getInbox("kimi");
  const rpcReq = requests.filter((r) => r.type === "rpc_request").pop();
  assert(rpcReq, "Kimi should have received rpc_request in inbox");

  const reqId = rpcReq.req_id;
  router.send("kimi", "architect", "JWT 逻辑已编写完毕", reqId);

  const rpcResult = await waitPromise;
  assert(rpcResult.reply === "JWT 逻辑已编写完毕", "RPC reply content mismatch");
  assert(rpcResult.from === "kimi", "Sender mismatch");
  console.log("  ✓ ZCode 派单给 Herdr Kimi 闭环成功！");

  // Test 4: Reverse flow - Herdr Commander calls ZCode Agent B (Herdr Master -> ZCode Worker)
  console.log("▶ [Test 4] 测试 Herdr 指挥官调度 ZCode Agent B (Herdr Master -> ZCode Worker)...");
  router.register("agent-b", { role: "backend", runtime: "zcode" });

  // 1. ZCode Agent B starts listening for task
  const zcodeListeningPromise = router.waitForTask("agent-b", 5);
  await sleep(100);

  // 2. Herdr Commander calls agent-b
  const commanderCallPromise = router.sendAndWait("commander", "agent-b", "请编写数据库模型 User", 5);

  // 3. ZCode Agent B receives task
  const receivedTask = await zcodeListeningPromise;
  assert(receivedTask.req_id, "ZCode Agent B should receive task with req_id");
  assert(receivedTask.message.includes("数据库模型"), "Task message mismatch");

  // 4. ZCode Agent B executes and replies back
  router.send("agent-b", "commander", "User 模型已创建完成", receivedTask.req_id);

  // 5. Commander receives reply
  const commanderResult = await commanderCallPromise;
  assert(commanderResult.reply === "User 模型已创建完成", "Commander reply mismatch");
  console.log("  ✓ Herdr 指挥官调度 ZCode Agent B 闭环成功！");

  // Test 5: Timeout handling
  console.log("▶ [Test 5] 测试 RPC 等待超时异常保护...");
  let timeoutTriggered = false;
  try {
    await router.sendAndWait("architect", "ghost_agent", "这条消息不会有人回复", 1);
  } catch (err) {
    if (err.message.includes("Timeout")) {
      timeoutTriggered = true;
    }
  }
  assert(timeoutTriggered, "Timeout should have been triggered cleanly");
  console.log("  ✓ 超时机制正确生效，未发生死锁！");

  // Test 6: MCP JSON-RPC Stdio Server Protocol
  console.log("▶ [Test 6] 测试 MCP Stdio Server 标准协议 (JSON-RPC 2.0)...");
  await testMcpServerStdio();
  console.log("  ✓ MCP Stdio Server 协议兼容性测试通过！");

  console.log("\n🎉 全双工双向架构全部 6 项自动化测试完美通过！");
}

function testMcpServerStdio() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, "../src/mcp/server.js");
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let buffer = "";
    const responses = [];

    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        responses.push(msg);

        if (msg.id === 2) {
          assert(msg.result && msg.result.tools, "Tools list missing");
          const toolNames = msg.result.tools.map((t) => t.name);
          assert(toolNames.includes("send_and_wait"), "send_and_wait tool missing");
          assert(toolNames.includes("wait_for_task"), "wait_for_task tool missing");
          assert(toolNames.includes("list_agents"), "list_agents tool missing");

          child.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "list_agents",
              arguments: {}
            }
          }) + "\n");
        }

        if (msg.id === 3) {
          assert(msg.result && msg.result.content, "Tool call result content missing");
          child.kill();
          resolve();
        }
      }
    });

    child.on("error", reject);

    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    }) + "\n");

    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    }) + "\n");
  });
}

runTests().catch((err) => {
  console.error("\n❌ 测试失败:", err);
  process.exit(1);
});
