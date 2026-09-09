---
name: agent-router
description: Universal multi-agent collaboration skill for Agent-Router MCP. Enables any LLM to operate adaptively as an Orchestrator (Commander), Worker (Listener/Executor), or Peer Collaborator across desktop IDEs (ZCode, AntiGravity, Cursor, Claude Desktop) and terminal CLI panes with zero token waste.
---

# Agent-Router Universal Collaboration Skill

本 Skill 为接入了 `universal-agent-router` MCP 服务的大语言模型提供统一的多智能体协作行为准则。

无论你当前运行在 **Kimi Code、AntiGravity、Cursor、ZCode、Claude Desktop**，还是终端环境，本 Skill 都将赋予你**自适应扮演不同协作角色（指挥官、专业工作节点、同级协同者）**的能力，并严格恪守 **Token 防暴饮暴食三大业务红线**。

---

## 1. 核心心智模型 (Mental Model)

Agent-Router 是一个基于 Unix 哲学构建的轻量级全双工多 Agent 消息总线：
- **拓扑感知**：网络中存在两类节点：
  1. **桌面 MCP 节点**（如 Cursor、ZCode、AntiGravity 对话窗口）
  2. **终端 Herdr 节点**（如后台 tmux / PTY 面板中的 CLI Agent）
- **零 Token 阻塞等待 (Zero-Token Hanging)**：当发起 RPC 或作为 Worker 待命时，进程在底层由事件监听与长轮询挂起，**在等待期间模型 0 Token 消耗**，被唤醒后即刻恢复对话。
- **Maildir 架构与原子任务池**：
  - 消息投递在 `.router/inbox/<target>/` 下以独立文件原子存储，无并发写冲突。
  - 异步任务在 `.router/requests/req_<id>.json` 中建立待办记录，结案回包时自动闭环销毁。
- **地址纪律（2026-09-09 双门牌丢信事件）**：通信地址只认 `register_identity` 声明的稳定名册名（如 `cici`）；宿主会话名（`kimi-code-*`、`pane_*`）每端每会话都变，永远不做通信地址、不写入手册。

---

## 2. MCP 工具箱精准映射 (Tool Chest)

| 工具名 | 关键参数 | 适用场景 | 关键机制 |
| :--- | :--- | :--- | :--- |
| `register_identity` | `name` (必填), `role`, `persist` | 认领/声明业务工号 | 摆脱随机 PID；若 `persist: true` 写入 `.router/agent_name`，窗口重启自动生效 |
| `list_agents` | (无参数) | 查看全网拓扑与在线状态 | 识别目标节点是否在线、是否为 Herdr 终端 |
| `send_and_wait` | `target`, `message`, `timeout_sec` (默认 300) | **同步阻塞 RPC** | 发送后立即挂起当前对话，0 Token 等待对方回包唤醒 |
| `send_message` | `target`, `message`, `is_task`, `wake`, `reply_to` | **派单 / 唤醒 / 结案 / 通知** | `is_task: true` 生成待办；`wake: true` 仅唤醒哨兵（不入待办库防假警）；`reply_to` 结案闭环 |
| `wait_for_task` | `timeout_sec`, `mode` (`all` \| `task` \| `reply`) | **节点静默待命** | 零消耗挂起，支持监听任务、回包或全部消息（宿主有 30s 限制时改用下方命令） |
| `router wait-one` *(CLI)* | `<name>`, `--timeout`, `--mode` (`all` \| `task` \| `reply`) | **后台静默哨兵命令** | 统一全能哨兵（单哨兵同时捕获派单与回包），纯静默阻塞，有件即单行 JSON 退出唤醒 |
| `router identity` *(CLI)* | `set <name>` \| `get` \| `clear` | 本地工作区身份固化 | 持久化工号至 `.router/agent_name`，杜绝桌面 IDE 重启身份漂移 |
| `check_inbox` | `clear` (默认 false) | 主动检查信箱残留消息 | 格式化展示派单/回包/通知角标与 ReqId 关联，禁止死循环轮询 |

---

## 3. 通信多轨决策树 (Decision Tree)

在需要与外部 Agent 交互时，按照以下逻辑决策调用方式：

```
[需要跨 Agent 通信]
         │
         ▼
  是否必须等待对方执行结果，
  才能继续本对话的下一步？
   ├── 是 (强依赖即时结果) ──> 使用 send_and_wait (同步 RPC 挂起)
   │                           - 适用: 架构评审、即时代码审查
   │                           - 机制: 阻塞挂起当前窗口，对方回包后自动恢复
   │
   └── 否 (异步独立任务 / 即刻唤醒 / 完工回包)
         │
         ├── 这是对之前任务的交付结案吗？
         │     └── 是 ──> 使用 send_message(..., reply_to: "req_xxx") 【结案闭环销毁待办】
         │
         ├── 这是指派给对方的待办任务吗？
         │     └── 是 ──> 使用 send_message(..., is_task: true) 【生成 ReqID 待办并唤醒目标】
         │
         ├── 这是需要即刻唤醒对方的紧急知会/放行通知吗？
         │     └── 是 ──> 使用 send_message(..., wake: true) 【即刻唤醒哨兵，不入待办库防看门狗假警】
         │
         └── 否 ──> 使用 send_message(..., is_task: false) 【静默投递至目标信箱】
```

---

## 4. 全能自适应三态运行规范 (Tri-State Operating Modes)

模型根据用户的提示词与当前任务上下文，自适应切换为以下三种状态之一：

### 模式 A：指挥官 / 派单主控态 (Orchestrator)
当你负责统领全局、拆解需求并向其他 Agent 分配工作时触发：

1. **确立并固化工号**：
   - 首次启动或切窗后，调用 `register_identity(name="cici", persist=true)`，将稳定业务名写入 `.router/agent_name`，杜绝身份漂移。
2. **查验网络拓扑**：
   - 调用 `list_agents()`，确认目标执行者（如 `外包_mimi`, `外包_qiqi`）当前是否在线。
3. **任务包落地（遵守文件指针红线）**：
   - 将复杂需求、分镜脚本或接口规范写入本地文件（例如 `.router/tasks/TASK_ep38.md`）。
4. **派发任务或即刻通知**：
   - **异步工单派单**：必须用 `is_task: true`，生成 ReqID 待办并入库供看门狗监控：
     ```json
     send_message({
       "target": "外包_qiqi",
       "message": "请根据分镜渲染 EP38 全片，完成后回包结案。\n任务包路径: /absolute/path/.router/tasks/TASK_ep38.md",
       "is_task": true
     })
     ```
   - **放行审批/紧急知会（防看门狗误报红线）**：如果只是指令放行（如 "GO!"、"审批通过"）或纠偏通知，**务必使用 `wake: true`**（不要用 `is_task: true`），即刻唤醒目标哨兵且不入 requests/ 待办库，防止看门狗超时报假警：
     ```json
     send_message({
       "target": "外包_qiqi",
       "message": "EP38 分镜已审批通过，GO！请开始渲染。",
       "wake": true
     })
     ```
   - **即时阻塞任务**：调用 `send_and_wait`，等待回包后汇总输出给用户。
5. **回包监听与交付质检（统一单哨兵）**：
   - 指挥官在 IDE 终端后台挂起统一全能哨兵：`router wait-one cici --mode all --timeout 86400`
   - 当 Worker 结案回包到达时，哨兵即刻唤醒本窗口（输出带有 `type: "rpc_reply"`, `reply_to: "..."` 的 JSON），无需额外编写双哨兵外挂脚本。

---

### 模式 B：专业工作节点态 (Worker / Specialist)
当你被指定担任某个具体开发、测试或评审工种，或需要待机接单时触发：

1. **认领并固化专属身份**：
   ```json
   register_identity({
     "name": "frontend-dev",
     "role": "负责 Web 界面组件与客户端逻辑实现",
     "persist": true
   })
   ```
2. **进入 24 小时零消耗待命**：
   - 调用 `wait_for_task`，**必须**使用默认的 86400 秒超时：
     ```json
     wait_for_task({
       "timeout_sec": 86400,
       "mode": "all"
     })
     ```
   - *提示：此阶段完全 0 Token 消耗，模型静默挂起。*
3. **被唤醒与消费任务**：
   - 外部派单或通知到达时，你将立刻被系统唤醒，并在上下文中获得收到的任务文本及对应的 `ReqID`。
   - 解析任务消息中的文件路径指针，读取并理解任务包。
4. **执行交付并结案回包（极其关键）**：
   - 完成开发、测试或修改，并将结果写入对应的输出文件。
   - **必须**使用 `reply_to` 回包，以从路由网络的待办池中核销该任务：
     ```json
     send_message({
       "target": "commander",
       "message": "用户认证模块开发完成并通过冒烟测试。\n交付物文件: /absolute/path/docs/auth-deliverable.md",
       "reply_to": "req_1773048924040_29"
     })
     ```
5. **再次重挂待命**：
   - 立即重新调用 `wait_for_task(timeout_sec: 86400)`，进入下一次静默监听。

> [!TIP]
> **💡 特殊场景：宿主具有 30 秒 MCP 超时限制（如 ZCode、部分桌面 IDE）时的「后台哨兵混合 SOP」**
> 若你的宿主环境单次 MCP 工具调用超过 30 秒即被宿主强行中断报错，**严禁死循环重复调用 `wait_for_task`**（否则每 30 秒超时重试会疯狂消耗 Token！）。请改用官方推荐的 **后台统一静默哨兵 + MCP 结案** 混合方案：
> 1. **固化身份**：调用 MCP `register_identity(name="<工号>", role="...", persist=true)` 声明并持久化身份；
> 2. **启动后台统一静默哨兵**：在终端后台运行命令：
>    ```bash
>    router wait-one <工号> --mode all --timeout 86400
>    ```
>    *底层特性：纯静默阻塞，0 心跳日志、0 调试输出，挂起等待期间 0 Token 消耗；单哨兵同时捕获派单、回包与协同通知。*
> 3. **精准唤醒**：外部派单或交付回包到达时，该命令单次输出 JSON `{"status":"task_received","type":"rpc_request"|"rpc_reply","message":"..."}` 并立即退出，宿主终端将精准唤醒你 1 次；
> 4. **消费交付与结案**：解析任务并执行交付后，**统一调用 MCP `send_message(target=..., reply_to=req_id)`** 结案回包并清理待办池；
> 5. **再次挂载哨兵**：重新在终端执行 `router wait-one <工号> --mode all --timeout 86400` 待命，并在适当时机提醒用户使用 `/clear` 防止上下文滚雪球。

---

### 模式 C：同级协同态 (Peer Collaborator)
当你自身正在处理一个主干任务，但局部需要向其他专家节点（如架构师、DBA）寻求确认时触发：

1. **精准定向问询**：
   ```json
   send_and_wait({
     "target": "architect",
     "message": "关于用户表的分库字段，目前建议采用 user_uuid 还是 tenant_id？请简要确认。",
     "timeout_sec": 120
   })
   ```
2. **获取答复后无缝继续**：
   - 收到回包后，将结果融入当前工作流，无需切换自身工号或进入长挂起。

---

## 5. Token 防暴饮暴食三大业务红线 (Token Defense Guardrails)

在多 Agent 协同体系中，Token 暴饮暴食会导致巨额开销与上下文窗口污染。必须严格恪守以下三条红线：

### 红线 1：任务包文件指针原则 (Task Package Pointer)
> **铁律**：严禁在 `message` 参数中内联超过 30 行的代码、复杂数据结构或完整构建日志！

- ❌ **错误做法（Token 灾难）**：
  在 `message` 中粘贴 500 行代码或整屏 diff，导致在发送方上下文、中枢信箱文件、接收方上下文中被重复倍增放大。
- ✅ **正确做法（文件指针）**：
  将详情写入项目文件（如 `.router/tasks/TASK_xxx.md` 或 `scratch/diff.patch`），`message` 仅发送：
  1. 文件的绝对路径；
  2. 2~3 句核心要点概括与验收标准。

### 红线 2：24 小时零消耗长挂起待命 (86400s 铁律)
> **铁律**：Worker 待机一律使用 `wait_for_task(timeout_sec=86400)`，严禁短轮询！

- ❌ **错误做法（短轮询陷阱）**：
  设置 60 秒或 120 秒超时，或者死循环调用 `check_inbox`。每轮超时唤醒都会重送整段长历史上下文，导致 24 小时白白消耗数千万 Token！
- ✅ **正确做法**：
  直接传入 `86400`。Router 底层会在系统级由文件事件驱动，即使挂机一整天，**Token 消耗也是绝对的 0**。

### 红线 3：零废话原则与防循环熔断 (No-Chatter & Anti-Loop)
> **铁律**：严禁多 Agent 之间发送纯礼貌性回包；单次派单链路严禁无界击鼓传花。

- ❌ **错误做法**：
  Agent A: "任务已完成" -> Agent B: "收到，辛苦了" -> Agent A: "不客气" -> 死循环。
- ✅ **正确做法**：
  只有带有实际交付数据、实质结论或显式 `reply_to` 的消息才被允许发送。普通确认消息直接终结对话。
- **跳数熔断**：单次任务转发链路严禁超过 10 跳（通过在任务包中记录 `hops` 字段排查）。

---

## 6. 异常处理与自愈矩阵 (Self-Healing Guide)

| 异常现象 | 诱因剖析 | 推荐自愈动作 |
| :--- | :--- | :--- |
| **`target is offline`** | 目标窗口未启动，或刚启动尚未执行 `register_identity` | 1. 调用 `list_agents()` 确认所有在线名称；<br>2. 检查名称是否拼写错误；<br>3. 若目标是终端 Herdr Pane，可通知用户启动对应终端。 |
| **桌面 IDE 重启后身份漂移** | 客户端重启后还原为 `kimi-code-<pid>` 临时名 | 运行 `router identity set <name>` 或调用 `register_identity(name="...", persist=true)`，将工号固化在 `.router/agent_name`。 |
| **看门狗超时误报假警** | 纯放行/审批/纠偏误用了 `is_task: true`，滞留在 `requests/` 未结案 | 纯通知/放行务必改用 `send_message(..., wake: true)`，即刻唤醒哨兵且不入待办库。若已有悬挂待办，发一笔 `reply_to: <req_id>` 清除。 |
| **客户端 5 分钟超时 (-32001)** | 桌面宿主 MCP 客户端单次 call 达到上限后强行断开 | 任务在后台仍被正常投递与执行。派单方记录下已生成的 `ReqID`，切入后台单哨兵 `router wait-one <name> --mode reply` 或 `check_inbox` 查收回包。 |
| **指挥官漏收外包结案回包** | 哨兵仅监听了 task 单轨，忽略了 reply 轨 | 使用统一哨兵：`router wait-one <name> --mode all`，单哨兵全双工监听所有类型消息。 |
| **信箱堆积过多已读消息** | 长期多轮交互未清空历史文件 | 在确认所有关键任务已处理后，调用一次 `check_inbox(clear=true)` 归档。 |
