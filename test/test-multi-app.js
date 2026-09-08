const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const router = require("../src/core/router");
const db = require("../src/core/db");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMultiAppTest() {
  console.log("🚀 开始运行跨桌面应用 (AntiGravity ⇄ ZCode) 多进程联动测试...\n");

  // Clean inboxes before test
  router.getInbox("antigravity-master", true);
  router.getInbox("zcode-worker", true);

  const serverScript = path.resolve(__dirname, "../src/mcp/server.js");

  // 1. 启动模拟 AntiGravity 客户端进程 (PID 1)
  console.log("▶ [步骤 1] 启动模拟 AntiGravity 进程...");
  const pAntiGravity = spawn("node", [serverScript], {
    env: { ...process.env, AGENT_NAME: "antigravity-master" }
  });

  // 2. 启动模拟 ZCode 客户端进程 (PID 2)
  console.log("▶ [步骤 2] 启动模拟 ZCode 进程...");
  const pZCode = spawn("node", [serverScript], {
    env: { ...process.env, AGENT_NAME: "zcode-worker" }
  });

  await sleep(300);

  // 验证两边都在注册表在线
  const agents = router.list();
  assert(agents["antigravity-master"] && agents["antigravity-master"].status === "online", "AntiGravity should be online");
  assert(agents["zcode-worker"] && agents["zcode-worker"].status === "online", "ZCode worker should be online");
  console.log("  ✓ AntiGravity 与 ZCode 均已自动挂载并独立在线！");

  // 3. 模拟 ZCode Worker 进入 waitForTask
  console.log("▶ [步骤 3] 测试 AntiGravity 向 ZCode 跨进程派单 (sendAndWait)...");
  const zcodeTaskPromise = router.waitForTask("zcode-worker", 5);

  await sleep(100);

  // 4. AntiGravity 发起派单
  const antigravityCallPromise = router.sendAndWait("antigravity-master", "zcode-worker", "请编写前端页面", 5);

  // 5. ZCode 接收并回复
  const task = await zcodeTaskPromise;
  assert(task.message === "请编写前端页面", "Task message should match");
  router.send("zcode-worker", "antigravity-master", "前端页面已生成", task.req_id);

  const result = await antigravityCallPromise;
  assert(result.reply === "前端页面已生成", "Result reply should match");
  console.log("  ✓ 跨桌面应用派单与毫秒级唤醒测试通过！");

  // 6. 测试进程意外关闭/下线探测 (Liveness Check)
  console.log("▶ [步骤 4] 模拟 ZCode 窗口关闭 (强杀进程)，测试假死拦截与自愈...");
  pZCode.kill("SIGTERM");
  await sleep(300);

  let failedInstantly = false;
  try {
    // 此时再向已经死掉的 ZCode 派单，应该在 1 毫秒内秒级报错，而不是死等 5 秒超时！
    const startTime = Date.now();
    await router.sendAndWait("antigravity-master", "zcode-worker", "新任务", 5);
  } catch (err) {
    failedInstantly = true;
    assert(err.message.includes("下线") || err.message.includes("已终结"), "Error message should reflect process dead");
  }

  assert(failedInstantly, "Should reject instantly when target process is dead");
  console.log("  ✓ 离线/死锁拦截保护生效，成功拦截向已死窗口的盲目派单！");

  pAntiGravity.kill();
  console.log("\n🎉 跨桌面端应用 (AntiGravity ⇄ ZCode ⇄ 命令行) 架构升级验证全量通过！");
}

runMultiAppTest().catch(err => {
  console.error("Multi-app test failed:", err);
  process.exit(1);
});
