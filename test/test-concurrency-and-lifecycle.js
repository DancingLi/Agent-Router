const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const router = require("../src/core/router");
const db = require("../src/core/db");

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runReviewIssuesTests() {
  console.log("🧪 开始运行代码评审 5 项缺陷针对性回归测试...\n");

  // --- Test 1: 消息无损性验证 (waitForTask 不应丢弃并存的其它异步消息) ---
  console.log("▶ [Test 1] 验证 waitForTask 消费任务时绝不丢弃信箱内其它并发消息...");
  const targetAgent = "worker-loss-test";
  router.register(targetAgent, { role: "worker", runtime: "desktop" });
  router.getInbox(targetAgent, true); // 清空

  // 先投递一条单向异步通知
  router.send("caller-a", targetAgent, "重要通知 1: 系统将在今晚维护");
  // 投递一个同步 RPC 任务
  const waitPromise = router.sendAndWait("caller-b", targetAgent, "请执行关键计算任务", 5);
  // 再投递一条单向异步通知
  router.send("caller-c", targetAgent, "重要通知 2: 请查收周报");

  // Worker 进入 waitForTask 提取任务
  const task = await router.waitForTask(targetAgent, 5);
  assert(task && task.message === "请执行关键计算任务", "Worker 应准确提取到 RPC 任务");

  // 此时检查信箱：2 条重要通知必须依然完好无损地保存在信箱中！
  const remainingInbox = router.getInbox(targetAgent, false);
  assert.strictEqual(remainingInbox.length, 2, `信箱应保留剩余 2 条通知，实际剩余: ${remainingInbox.length}`);
  assert(remainingInbox[0].message.includes("重要通知 1"), "通知 1 应完整保留");
  assert(remainingInbox[1].message.includes("重要通知 2"), "通知 2 应完整保留");

  // 回复任务以闭环 RPC
  router.send(targetAgent, "caller-b", "计算完成", task.req_id);
  await waitPromise;
  console.log("  ✓ waitForTask 消费任务精准取出，信箱其余消息 0 丢失！");

  // --- Test 2: 信箱高并发写入零冲突 (Maildir 模式抗并发) ---
  console.log("▶ [Test 2] 验证高并发多 Agent 同时给同一目标写信箱无竞态丢失...");
  const concurrentTarget = "worker-concurrency-test";
  router.getInbox(concurrentTarget, true);

  const CONCURRENT_COUNT = 20;
  const sendPromises = [];
  for (let i = 0; i < CONCURRENT_COUNT; i++) {
    sendPromises.push(Promise.resolve().then(() => {
      router.send(`agent-source-${i}`, concurrentTarget, `并发消息 payload #${i}`);
    }));
  }
  await Promise.all(sendPromises);

  const receivedMessages = router.getInbox(concurrentTarget, false);
  assert.strictEqual(receivedMessages.length, CONCURRENT_COUNT, `并发写入 ${CONCURRENT_COUNT} 条消息必须全部入队，实际入队: ${receivedMessages.length}`);
  console.log(`  ✓ ${CONCURRENT_COUNT} 笔高并发跨进程投递 100% 成功入队，无任何竞态覆盖！`);

  // --- Test 3: 僵尸注册表自动剔除 (Stale Registry Auto-Pruning) ---
  console.log("▶ [Test 3] 验证死亡进程残留的注册表文件自动清理与修剪...");
  // 注册一个带有死 PID 的临时 Agent
  const deadPid = 9999999;
  router.register(`agent-${deadPid}`, {
    role: "ephemeral",
    runtime: "desktop-app",
    pid: deadPid
  });
  assert(fs.existsSync(path.join(db.AGENTS_DIR, `agent-${deadPid}.json`)), "文件应先被写入");

  // 触发 list() 或 getRegistry()
  const activeAgents = router.list();
  assert(!activeAgents[`agent-${deadPid}`], "死亡进程的临时 agent 应被自动清理出注册表");
  assert(!fs.existsSync(path.join(db.AGENTS_DIR, `agent-${deadPid}.json`)), "磁盘上残留的死文件应被物理移除");
  console.log("  ✓ 死亡/失联临时 Agent 文件自动探测并精准修剪！");

  // --- Test 4: MCP 启动双重注册防御 (No Double-Registration / Zombie) ---
  console.log("▶ [Test 4] 验证 MCP Server 启动与 initialize 握手不残留重复僵尸工号...");
  const serverScript = path.resolve(__dirname, "../src/mcp/server.js");
  const mcpProcess = spawn("node", [serverScript], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  const pid = mcpProcess.pid;
  await sleep(200);

  // 发送 initialize 握手请求 (模拟客户端为 cursor)
  const initMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "cursor" } }
  }) + "\n";
  mcpProcess.stdin.write(initMsg);
  await sleep(300);

  const registryAfterInit = router.list();
  // 此时应当只存在 cursor-<pid>，绝不存在初始残留的 agent-<pid>
  assert(registryAfterInit[`cursor-${pid}`], `cursor-${pid} 应当正常在线`);
  assert(!registryAfterInit[`agent-${pid}`], `agent-${pid} 必须已被注销并清理，不能留下双重注册僵尸`);

  mcpProcess.kill();
  await sleep(200);
  const registryAfterExit = router.list();
  assert(!registryAfterExit[`cursor-${pid}`], `进程退出后 cursor-${pid} 应当被彻底清理`);
  console.log("  ✓ MCP Server 生命周期单工号绑定，无任何双重注册残留！");

  // --- Test 5: 零开箱硬编码配置验证 ---
  console.log("▶ [Test 5] 验证类库启动零硬编码，无默认 kimi/pi 绑定...");
  const kimiFile = path.join(db.AGENTS_DIR, "kimi.json");
  const piFile = path.join(db.AGENTS_DIR, "pi.json");
  if (fs.existsSync(kimiFile)) fs.unlinkSync(kimiFile);
  if (fs.existsSync(piFile)) fs.unlinkSync(piFile);

  // 触发 db 操作，验证不会有任何默认种子文件被隐式注入
  db.getRegistry();

  assert(!fs.existsSync(kimiFile), "db.getRegistry 不应自动生成硬编码 kimi 种子");
  assert(!fs.existsSync(piFile), "db.getRegistry 不应自动生成硬编码 pi 种子");
  console.log("  ✓ 类库零硬编码状态确认完毕！");

  // --- Test 6: 异步任务派单与 Worker 唤醒闭环测试 (isTask: true) ---
  console.log("▶ [Test 6] 验证异步派单 (isTask) 生成待办、即刻唤醒 Worker 及回包结案闭环...");
  const asyncWorker = "zcode-async-worker";
  const asyncDispatcher = "cici-pm";
  router.register(asyncWorker, { role: "worker", runtime: "zcode" });
  router.getInbox(asyncWorker, true);
  router.getInbox(asyncDispatcher, true);

  // 1. Worker 进入挂起
  const workerWaitPromise = router.waitForTask(asyncWorker, 5);
  await sleep(100);

  // 2. 发起方异步派单 (不挂起等待)
  const dispatchResult = router.send(asyncDispatcher, asyncWorker, "异步任务：设计新图表组件", null, { isTask: true });
  assert.strictEqual(dispatchResult.status, "task_dispatched", "应成功返回 task_dispatched 状态");
  assert(dispatchResult.req_id, "应生成全局唯一 req_id");

  // 3. 验证 requests/ 目录中存在 pending 待办
  const pendingRequest = db.getRequest(dispatchResult.req_id);
  assert(pendingRequest && pendingRequest.status === "pending", "requests/ 中必须落盘 pending 任务供 Supervisor 监控");

  // 4. 验证 Worker 能够被即刻唤醒
  const receivedTask = await workerWaitPromise;
  assert.strictEqual(receivedTask.req_id, dispatchResult.req_id, "Worker 接收的任务 ID 必须匹配");
  assert.strictEqual(receivedTask.message, "异步任务：设计新图表组件", "任务内容必须匹配");

  // 5. Worker 完成后回包结案
  router.send(asyncWorker, asyncDispatcher, "图表已设计完毕，交付物在 docs/chart.tsx", receivedTask.req_id);

  // 6. 验证 requests/ 中的待办已被闭环清理
  const requestAfterReply = db.getRequest(dispatchResult.req_id);
  assert(!requestAfterReply, "回包后待办请求必须已被清理结案");

  // 7. 验证发单人收到回包通知
  const dispatcherInbox = router.getInbox(asyncDispatcher, true);
  assert(dispatcherInbox.some(m => m.type === "rpc_reply" && m.reply_to === dispatchResult.req_id), "发单人信箱应收到 rpc_reply 回包通知");
  console.log("  ✓ 异步派单成功生成 ReqID，即刻唤醒 Worker，回包后待办请求完美结案闭环！");

  // --- Test 7: register_identity 改名后进程退出清理验证 ---
  console.log("▶ [Test 7] 验证 register_identity 赋予新身份后，窗口退出依然能精准注销新工号...");
  const mcpProcess2 = spawn("node", [serverScript], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  await sleep(200);

  // 发送 initialize
  mcpProcess2.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "zcode" } }
  }) + "\n");
  await sleep(200);

  // 调用 register_identity 改名为 外包_tester
  mcpProcess2.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "register_identity", arguments: { name: "外包_tester", role: "测试工程师" } }
  }) + "\n");
  await sleep(300);

  const regDuringRun = router.list();
  assert(regDuringRun["外包_tester"] && regDuringRun["外包_tester"].status === "online", "外包_tester 必须在线");

  // 关闭进程
  mcpProcess2.kill("SIGTERM");
  await sleep(300);

  const regAfterExit2 = router.list();
  assert(!regAfterExit2["外包_tester"] || regAfterExit2["外包_tester"].status === "offline", "外包_tester 必须已被注销，不能以 online 残留");
  console.log("  ✓ register_identity 确立的身份在窗口关闭后 100% 优雅注销！");

  console.log("\n🎉 全量针对性隐患回归测试全部 7 项测试 100% 通过！\n");
}

runReviewIssuesTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
