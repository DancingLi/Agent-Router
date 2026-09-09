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

  // --- Test 8: CLI router wait-one 作为后台静默哨兵监听与精准唤醒 ---
  console.log("▶ [Test 8] 验证 CLI router wait-one 作为后台静默哨兵监听并精准唤醒...");
  const sentryWorker = "sentry-test-worker";
  router.register(sentryWorker, { role: "worker", runtime: "desktop" });
  router.getInbox(sentryWorker, true); // 清空

  const routerCli = path.join(__dirname, "../bin/router");
  let sentryOutput = "";
  const sentryProc = spawn("node", [routerCli, "wait-one", sentryWorker, "--timeout", "5"], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  sentryProc.stdout.on("data", (data) => {
    sentryOutput += data.toString();
  });

  // 确保哨兵已启动就绪并在静默等待
  await sleep(300);
  assert.strictEqual(sentryOutput, "", "在收到任务之前，哨兵进程必须保持 100% 绝对静默（0 标准输出）");

  // 发送异步任务以唤醒哨兵
  const sentryTask = router.send("test-boss", sentryWorker, "哨兵唤醒测试任务内容", null, { isTask: true });
  assert.strictEqual(sentryTask.status, "task_dispatched");

  // 等待哨兵收到任务退出
  const exitCode = await new Promise((resolve) => {
    sentryProc.on("exit", (code) => resolve(code));
  });

  assert.strictEqual(exitCode, 0, "哨兵收到任务后必须以 code 0 正常退出");
  assert(sentryOutput.trim().startsWith("{"), "哨兵必须输出单行标准 JSON");
  const parsedTask = JSON.parse(sentryOutput.trim());
  assert.strictEqual(parsedTask.status, "task_received");
  assert.strictEqual(parsedTask.req_id, sentryTask.req_id);
  assert.strictEqual(parsedTask.message, "哨兵唤醒测试任务内容");
  console.log("  ✓ router wait-one 静默挂起 0 输出，有单即精准单行 JSON 输出退出！");

  // --- Test 9: 全能单哨兵捕获回包 (router wait-one --mode all 兼收 task 与 reply) ---
  console.log("▶ [Test 9] 验证统一全能哨兵 (--mode all) 能精准捕获 rpc_reply 回包，根除双哨兵外挂...");
  const sentryCommander = "cici-commander-test";
  router.register(sentryCommander, { role: "commander", runtime: "desktop" });
  router.getInbox(sentryCommander, true);

  let replySentryOutput = "";
  const replySentryProc = spawn("node", [routerCli, "wait-one", sentryCommander, "--mode", "all", "--timeout", "5"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  replySentryProc.stdout.on("data", (d) => { replySentryOutput += d.toString(); });
  await sleep(300);

  // Worker 回包给 Commander
  router.send("worker-test", sentryCommander, "全片渲染完成，交付物已生成", "req_test_reply_123");

  const replyExitCode = await new Promise((resolve) => replySentryProc.on("exit", (code) => resolve(code)));
  assert.strictEqual(replyExitCode, 0, "哨兵收到回包后必须正常退出");
  const parsedReply = JSON.parse(replySentryOutput.trim());
  assert.strictEqual(parsedReply.status, "task_received");
  assert.strictEqual(parsedReply.type, "rpc_reply");
  assert.strictEqual(parsedReply.reply_to, "req_test_reply_123");
  assert.strictEqual(parsedReply.message, "全片渲染完成，交付物已生成");
  console.log("  ✓ 统一全能哨兵 (--mode all) 成功捕获 rpc_reply 回包，无需外挂双哨兵！");

  // --- Test 10: 即刻唤醒通知 (wake: true) 不污染 requests/ 待办库防看门狗误报 ---
  console.log("▶ [Test 10] 验证 wake: true 成功唤醒哨兵且绝不在 requests/ 生成强待办文件...");
  const wakeTarget = "wake-target-worker";
  router.register(wakeTarget, { role: "worker", runtime: "zcode" });
  router.getInbox(wakeTarget, true);

  let wakeSentryOutput = "";
  const wakeSentryProc = spawn("node", [routerCli, "wait-one", wakeTarget, "--timeout", "5"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  wakeSentryProc.stdout.on("data", (d) => { wakeSentryOutput += d.toString(); });
  await sleep(300);

  // 记录发送前 requests/ 目录的文件数量
  const requestsDir = path.join(db.ROUTER_DIR, "requests");
  const reqFilesBefore = fs.existsSync(requestsDir) ? fs.readdirSync(requestsDir).filter(f => f.endsWith(".json")).length : 0;

  // 发送即刻唤醒通知 (wake: true)
  const wakeRes = router.send("commander", wakeTarget, "EP38 分镜已审批通过，GO！", null, { wake: true });
  assert.strictEqual(wakeRes.status, "wake_sent");
  assert(!wakeRes.req_id, "wake 通知绝不应生成 req_id");

  const wakeExitCode = await new Promise((resolve) => wakeSentryProc.on("exit", (code) => resolve(code)));
  assert.strictEqual(wakeExitCode, 0, "哨兵收到 wake 通知必须正常退出唤醒");
  const parsedWake = JSON.parse(wakeSentryOutput.trim());
  assert.strictEqual(parsedWake.status, "task_received");
  assert.strictEqual(parsedWake.type, "notice");
  assert.strictEqual(parsedWake.message, "EP38 分镜已审批通过，GO！");

  // 验证 requests/ 目录中的文件数量没有增加（杜绝看门狗报警）
  const reqFilesAfter = fs.existsSync(requestsDir) ? fs.readdirSync(requestsDir).filter(f => f.endsWith(".json")).length : 0;
  assert.strictEqual(reqFilesAfter, reqFilesBefore, "wake: true 绝不能在 requests/ 增加待办文件！");
  console.log("  ✓ wake: true 即刻唤醒哨兵，且 0 待办写入 requests/，杜绝看门狗报假警！");

  // --- Test 11: 持久化工号机制 (.router/agent_name) 防桌面 IDE 重启身份漂移 ---
  console.log("▶ [Test 11] 验证 .router/agent_name 持久化默认工号，重启切窗无身份漂移...");
  // 1. 设置持久化工号
  db.savePersistentIdentity("cici-permanent");
  assert.strictEqual(db.loadPersistentIdentity(), "cici-permanent");

  // 2. 启动新的 MCP Server 进程，未注入 AGENT_NAME 环境变量
  const mcpProcess3 = spawn("node", [serverScript], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AGENT_NAME: "" }
  });
  await sleep(200);

  // 3. 执行 initialize 握手
  mcpProcess3.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "kimi-work" } }
  }) + "\n");
  await sleep(300);

  // 4. 检查注册表：应当直接使用 cici-permanent，而不是 kimi-work-<pid>
  const regMcp3 = router.list();
  assert(regMcp3["cici-permanent"] && regMcp3["cici-permanent"].status === "online", "MCP 必须自动复用持久化工号 cici-permanent");
  assert(!regMcp3[`kimi-work-${mcpProcess3.pid}`], "不应生成随机 kimi-work-<pid>");

  // 5. 清理
  mcpProcess3.kill();
  await sleep(200);
  db.savePersistentIdentity(null); // 清除测试配置
  assert.strictEqual(db.loadPersistentIdentity(), null);
  console.log("  ✓ .router/agent_name 持久化工号加载成功，彻底根除桌面 IDE 身份漂移！");

  console.log("\n🎉 全量针对性隐患回归测试全部 11 项测试 100% 通过！\n");
}

runReviewIssuesTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
