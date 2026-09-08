# Agent Router 技术操作与维护手册 (For Cici)

> **文档性质**：工程技术与运维参考手册  
> **面向对象**：项目经理 Cici（Herdr 终端调度中枢）  
> **系统定位**：连接 Herdr（6名员工）与 ZCode（7名员工）的跨端多智能体全双工通信总线  

---

## 1. 架构与底层通信机制

本系统（Agent Router）专门解决 ZCode GUI 环境与 Herdr 终端环境之间的协议割裂问题，底层采用 **统一文件总线 + 本地 IPC + MCP Stdio 协议**，实现双向对等调度。

```text
                      ┌─────────────────────────────────┐
                      │    Cici (Herdr 终端调度中枢)     │
                      └────────────────┬────────────────┘
                                       │
                      ┌────────────────▼────────────────┐
                      │    Agent Router (Core Engine)   │
                      │  universal-agent-router v2.0    │
                      └────────┬───────────────┬────────┘
                               │               │
            (herdr CLI / PTY)  │               │  (MCP JSON-RPC 2.0)
                               ▼               ▼
                   ┌──────────────────┐ ┌──────────────────┐
                   │ Herdr 员工 (6名) │ │ ZCode 员工 (7名) │
                   │  kimi / pi 等    │ │  Electron 进程池 │
                   └──────────────────┘ └──────────────────┘
```

### 1.1 核心通信模型：零消耗 RPC 挂起 (Zero-Token RPC)
* **原理**：当你使用 `router call` 向 ZCode 员工派发任务时，Node.js 进程在传输层持有 Promise 挂起连接。
* **资源消耗**：在员工执行任务的全部周期内，**调用方与监听方的大模型均处于静默停机状态，API Token 消耗严格为 0**。
* **唤醒机制**：被调用方提交回包的瞬间，Promise 在毫秒级解冻，返回 Tool Result 激活下一步推理。

---

## 2. Cici 核心终端指令集 (CLI Reference)

所有的控制操作均在 Herdr 终端中通过 `router` 命令直接执行。

### 2.1 同步派单与挂起等待：`router call`
用于需要下属产出明确成果、拿到回包后才能推进下一环节的场景。

```bash
router call <target_agent> "<task_content>" [--timeout <seconds>]
```

* **参数说明**：
  * `<target_agent>`：目标员工的逻辑标识（如 `zcode-motion`、`herdr-ffmpeg`）。
  * `<task_content>`：具体的任务指令与技术规范。
  * `--timeout`：最长容忍等待时间（秒，默认 300 秒）。
* **执行表现**：
  * 命令执行后终端阻塞，等待目标 Agent 回复。
  * 目标完成后，结果直接以格式化文本打印至终端标准输出，退出码为 `0`。
  * 若超时未返回，命令退出并抛出 `Timeout` 错误，退出码为 `1`。

### 2.2 异步消息投递与广播：`router send`
用于通知同步、上下文同步、全员通报或无需等待回包的单向数据流动。

```bash
router send <target_agent> "<message_content>" [--task] [--reply-to <request_id>]
```

* **参数说明**：
  * `--task`：**【异步派单专属】**将消息标记为正式异步任务。系统将自动生成全局唯一的 `ReqID`，存入待办请求池（使 `router_supervisor` 看门狗能够监控超时并催办），并**即刻唤醒目标 Agent 的 `wait_for_task` 监听**。员工完成后使用 `--reply-to <request_id>` 闭环回包。
  * `--reply-to`：用于回复某次特定的挂起请求（通常由员工回传给 Cici 时携带）。
  * 若两者都不加，则属于普通的单向异步通知（不生成待办，不唤醒 `wait_for_task`）。

### 2.3 状态审查与花名册查询：`router list`
随时检查 13 位员工在总线上的登记状态与物理句柄绑定情况。

```bash
router list
```

* **输出项解析**：
  * `Name`：逻辑标识。
  * `Runtime`：所在宿主（`herdr` 或 `zcode`）。
  * `Pane/Handle`：绑定的物理句柄（如 Herdr 的 `w1:p1` 或 ZCode 的动态信箱通道）。
  * `Role`：员工职责定义。

### 2.4 信箱检查与历史回溯：`router inbox`
查收发给 Cici 的异步通知或员工自主提交的汇报。

```bash
router inbox cici [--clear]
```

* **参数说明**：
  * `--clear`：查收后立即清空当前信箱。

---

## 3. ZCode 侧 7 位员工的运行环境维系

ZCode 运行于 Electron 沙箱内，维持这 7 位员工高可用待命的关键是**确保它们挂起在 `wait_for_task` 循环中**。

### 3.1 员工会话初始化 SOP
每当在 ZCode 中新建或重置员工会话时，只需在该会话首轮输入以下系统指令：

```text
你当前担任 [员工标识，如 zcode-storyboard]。
请依次执行：
1. 调用 register_identity(name="[员工标识]", role="[职责说明]")；
2. 调用 wait_for_task(timeout_sec=86400) 挂起等待 Cici 派单；
3. 收到任务后正常执行，完成后调用 send_message(target="cici", message="[交付成果]", reply_to="[任务ID]")；
4. 回报完毕后，立即再次调用 wait_for_task 重新进入休眠待命。
```

### 3.2 全局与跨项目配置文件维护
确保 ZCode 的全局 MCP 配置始终指向本项目中的执行脚本：
* **全局配置文件路径**：`~/.zcode/cli/config.json` 及 `~/.agents/mcp.json`
* **配置内容校验**（将 `/path/to/universal-agent-router` 替换为项目实际绝对路径）：
```json
{
  "mcp.servers": {
    "agent-router": {
      "command": "node",
      "args": ["/path/to/universal-agent-router/src/mcp/server.js"],
      "env": {
        "ROUTER_PROJECT_DIR": "/path/to/universal-agent-router"
      }
    }
  }
}
```
*(注：可直接执行 `./bin/setup-clients.sh` 自动生成本配置)*

---

## 4. Herdr 侧 6 位员工的运行环境维系

Herdr 终端内的员工天然具备 PTY 控制能力，Router 会优先尝试使用 `herdr agent prompt` 进行原生进程级唤醒。

### 4.1 全局 CLI 软链接确认
确保所有 Herdr Pane 均可在任意工作目录下调用 `router`：
```bash
# 检查软链接是否存在（或执行 npm link）
which router || sudo ln -sf "$(pwd)/bin/router" /usr/local/bin/router
```

### 4.2 面板与标识对齐
若 Herdr 侧员工重启或迁移面板，可直接通过命令重新对齐物理面板：
```bash
router register kimi coder w1:p1
router register pi reviewer w1:p2
```

---

## 5. 故障排查与运维自愈 (Troubleshooting & Operations)

### 5.1 实时日志流监控
Router 的所有 RPC 调用、分发流转、错误堆栈均记录在统一日志文件中：
```bash
tail -f .router/logs/router.log
```

### 5.2 任务超时 (Timeout) 应急处置
* **现象**：`router call` 等待超时并抛出异常。
* **排查路径**：
  1. 确认目标 Agent 会话是否被意外关闭或遇到报错中止。
  2. 若为复杂计算任务耗时超出预期，调用时增加超时窗口：
     ```bash
     router call <target> "<task>" --timeout 900
     ```

### 5.3 队列清理与状态复位
当遇到不可逆的进程崩溃或死锁残留时，可手动复位消息队列（不影响花名册）：
```bash
# 清空未决的请求与回包缓存
rm -rf .router/requests/*
rm -rf .router/responses/*

# 运行自检套件确认总线健康度
npm test
```

---

## 6. Token 成本控制与防暴饮暴食三大业务操作红线

在长周期协同调度中，为了避免因上下文堆叠与不规范操作引发百万级 Token 灾难，Cici 与全体成员必须恪守以下三项业务操作红线：

### 6.1 【任务包指针法则】严禁在消息体内联大段代码或报错
* **红线要求**：禁止在 `router call`、`router send` 或 `send_message` 的消息文本中直接贴入超过 200 字的长篇代码、Git Diff、或全量错误堆栈。
* **正确操作**：大型任务一律先行写入本地文件（如 `docs/tasks/package-xxx.md`），消息体内仅传递**文件绝对路径或指针**：“*任务包已放置于 `docs/tasks/package-01.md`，请按书面验收线执行并交付至 `docs/delivery/01.md`*”。交付物同样只回复路径指针，避免文本在网络多端流转中被成倍放大吞噬上下文。

### 6.2 【常驻终端员工会话归档 SOP】及时切断上下文滚雪球
* **红线要求**：Herdr 终端员工（如 `Kiki`、`Didi`、`Cici` 等）如果连续多天不重置会话，历史上下文会滚雪球至 150,000~200,000 Tokens。此时哪怕接收一条简短催办，单次推理也会吃掉 150K+ 的 Prompt Token。
* **正确操作**：
  1. 每完成一个大型开发阶段（里程碑），要求员工将工作沉淀入文档；
  2. 在终端窗口内执行 `/clear`（或新建会话重置基数），让 Prompt Token 消耗立刻回归至千级别的极低水位。

### 6.3 【Relay 乒乓熔断纪律】拒绝过度来回确认
* **红线要求**：严禁在未产出实质交付物的情况下进行超过 10 轮的“你确认我、我确认你”的推诿式对话。
* **正确操作**：当同一事务在成员间往返超过 10 次且无新交付产出时，Cici 必须强行停线，整理全程摘要直接上报 CEO，由 CEO 裁定后开辟新任务线。
