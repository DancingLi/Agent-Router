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

---

## 2. MCP 工具箱精准映射 (Tool Chest)

| 工具名 | 关键参数 | 适用场景 | 关键机制 |
| :--- | :--- | :--- | :--- |
| `register_identity` | `name` (必填), `role` | 认领/声明业务工号 | 摆脱随机 PID，窗口关闭时自动优雅注销 |
| `list_agents` | (无参数) | 查看全网拓扑与在线状态 | 识别目标节点是否在线、是否为 Herdr 终端 |
| `send_and_wait` | `target`, `message`, `timeout_sec` (默认 300) | **同步阻塞 RPC** | 发送后立即挂起当前对话，0 Token 等待对方回包唤醒 |
| `send_message` | `target`, `message`, `is_task`, `reply_to` | **异步派单 / 结案回包 / 普通通知** | `is_task: true` 生成待办并唤醒目标；`reply_to` 结案闭环 |
| `wait_for_task` | `timeout_sec` (默认 86400) | **Worker 节点静默待命** | 24小时超长零消耗挂起，有任务即刻唤醒 |
| `check_inbox` | `clear` (默认 false) | 主动检查信箱残留消息 | 仅在异常恢复或排查时调用，禁止死循环轮询 |

---

## 3. 通信双轨决策树 (Decision Tree)

在需要与外部 Agent 交互时，按照以下逻辑决策调用方式：

```
[需要跨 Agent 通信]
         │
         ▼
  是否必须等待对方执行结果，
  才能继续本对话的下一步？
   ├── 是 (强依赖即时结果) ──> 使用 send_and_wait
   │                           - 适用: 架构评审、接口查询、即时代码审查
   │                           - 机制: 阻塞挂起当前窗口，对方回包后自动恢复
   │
   └── 否 (异步独立任务 / 单向通知)
         │
         ▼
     这是指派给对方的工作任务吗？
      ├── 是 ──> 使用 send_message(..., is_task: true)
      │           - 适用: 功能开发、测试执行、复杂文档撰写
      │           - 机制: 生成 ReqID 待办，即刻唤醒 Worker 的 wait_for_task
      │
      └── 否 (普通通知或进度同步)
            │
            ├── 这是对之前任务的回包吗？
            │     ├── 是 ──> 使用 send_message(..., reply_to: "req_xxx") 【结案闭环】
            │     └── 否 ──> 使用 send_message(..., is_task: false) 【单向通知】
```

---

## 4. 全能自适应三态运行规范 (Tri-State Operating Modes)

模型根据用户的提示词与当前任务上下文，自适应切换为以下三种状态之一：

### 模式 A：指挥官 / 派单主控态 (Orchestrator)
当你负责统领全局、拆解需求并向其他 Agent 分配工作时触发：

1. **查验网络拓扑**：
   - 首先调用 `list_agents()`，确认目标执行者（如 `frontend-dev`, `tester`）当前是否在线。
2. **任务包落地（遵守文件指针红线）**：
   - 将复杂需求、接口规范或设计文档写入本地文件（例如 `.router/tasks/TASK_user_auth.md`）。
3. **派发任务**：
   - **异步批处理任务**：
     ```json
     send_message({
       "target": "frontend-dev",
       "message": "请根据任务包要求实现用户认证界面，完成后请结案回包。\n任务包路径: /absolute/path/.router/tasks/TASK_user_auth.md",
       "is_task": true
     })
     ```
   - **即时阻塞任务**：调用 `send_and_wait`，等待回包后汇总输出给用户。
4. **追踪与收尾**：
   - 当 Worker 结案回包后，校验交付成果并向用户汇报整体完成进展。

---

### 模式 B：专业工作节点态 (Worker / Specialist)
当你被指定担任某个具体开发、测试或评审工种，或需要待机接单时触发：

1. **认领专属身份**：
   ```json
   register_identity({
     "name": "frontend-dev",
     "role": "负责 Web 界面组件与客户端逻辑实现"
   })
   ```
2. **进入 24 小时零消耗待命**：
   - 调用 `wait_for_task`，**必须**使用默认的 86400 秒超时：
     ```json
     wait_for_task({
       "timeout_sec": 86400
     })
     ```
   - *提示：此阶段完全 0 Token 消耗，模型静默挂起。*
3. **被唤醒与消费任务**：
   - 外部派单到达时，你将立刻被系统唤醒，并在上下文中获得收到的任务文本及对应的 `ReqID`（例如 `req_1773048924040_29`）。
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
> 若你的宿主环境单次 MCP 工具调用超过 30 秒即被宿主强行中断报错，**严禁死循环重复调用 `wait_for_task`**（否则每 30 秒超时重试会疯狂消耗 Token！）。请改用官方推荐的 **后台静默哨兵 + MCP 结案** 混合方案：
> 1. **认领身份**：先调用 MCP `register_identity(name="<工号>", role="...")` 声明身份；
> 2. **启动后台静默哨兵**：在终端后台运行命令：
>    ```bash
>    router wait-one <工号> --timeout 86400
>    ```
>    *底层特性：纯静默阻塞，0 心跳日志、0 调试输出，挂起等待期间 0 Token 消耗。*
> 3. **精准唤醒**：外部派单到达时，该命令单次输出 JSON `{"status":"task_received","req_id":"...","message":"..."}` 并立即退出，宿主终端将精准唤醒你 1 次；
> 4. **消费交付与结案**：解析任务并执行交付后，**统一调用 MCP `send_message(target=..., reply_to=req_id)`** 结案回包并清理待办池；
> 5. **再次挂载哨兵**：重新在终端执行 `router wait-one <工号> --timeout 86400` 待命，并在适当时机提醒用户使用 `/clear` 防止上下文滚雪球。

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
| **`send_and_wait` 超时** | 目标处理极其耗时，或被其他复杂逻辑阻塞 | 1. 勿盲目重发；<br>2. 降级为异步派单：调用 `send_message(..., is_task: true)`；<br>3. 提醒用户当前主控将继续执行其它独立步骤。 |
| **信箱堆积过多已读消息** | 长期多轮交互未清空历史文件 | 在确认所有关键任务已处理后，调用一次 `check_inbox(clear=true)` 归档。 |
| **收到重复的任务消息** | 网络异常或重试机制触发 | 通过任务内的 `reqId` 进行幂等性判断：已处理过的 `reqId` 直接简要回复已完成状态，不重复执行长流程。 |
