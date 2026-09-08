# Herdr <-> ZCode 跨端多智能体（Multi-Agent）全双工通信使用指南

本项目为运行在 **Herdr 终端**（如 **Kimi Code CLI** 与 **Pi CLI**）与 **ZCode 桌面应用** 中的 Agent 提供了统一的全双工通信中枢。

无论是 **ZCode 作为主控大脑调度 Herdr**，还是 **Herdr 作为指挥官调度 ZCode**，均可无缝支持，且保持 **0 Token 空载等待**！

---

## 一、 跨项目使用配置（在任意其他项目文件夹中使用）

如果您在桌面应用（如 ZCode、Cursor 等）中打开了其他工作区项目（例如 `~/projects/my-app`），有两种方式使用本工具：

### 方式 1：一键安装全局配置（最推荐）
直接运行本项目提供的客户端配置脚本：
```bash
./bin/setup-clients.sh
# 或在 npm link 后直接执行
router-setup
```
脚本会自动将当前路由服务挂载到 `~/.zcode/cli/config.json`、`~/.agents/mcp.json` 以及 Claude Desktop 配置文件中。

也可以手动写入配置（将 `/path/to/universal-agent-router` 替换为实际项目所在路径）：
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

### 方式 2：单个项目局部配置
直接将当前项目的配置复制到新工作区中：
```bash
mkdir -p /path/to/my-app/.zcode
cp examples/mcp-config.example.json /path/to/my-app/.zcode/config.json
```

---

## 二、 场景：Herdr 中的 Agent A 担任指挥官，调度 ZCode 中的 Agent B 和 Agent C

这是经典的大脑在终端（如高算力/高自由度的 Kimi/Pi），Worker 在 IDE（专注局部编码）的模式。

### 1. ZCode 端准备（启动 Agent B 和 Agent C）
在 ZCode 中开启两个会话窗口：

* **窗口 1（Agent B - 后端开发）**：
  在对话开头输入提示词：
  > “你是专职后端研发 Agent B。请首先调用 register_identity(name="agent-b", role="后端研发")，随后调用 wait_for_task 工具挂起监听来自 Herdr 指挥官的任务。收到任务后执行，执行完毕后调用 send_message 回报结果，并再次调用 wait_for_task。”

* **窗口 2（Agent C - 前端开发）**：
  在对话开头输入提示词：
  > “你是专职前端研发 Agent C。请首先调用 register_identity(name="agent-c", role="前端研发")，随后调用 wait_for_task 工具挂起监听来自 Herdr 指挥官的任务。收到任务后执行，执行完毕后调用 send_message 回报结果，并再次调用 wait_for_task。”

*(提示：Agent B 和 C 在调用 wait_for_task 期间，大模型完全静止，**消耗 0 Token**。)*

---

## 三、 Herdr 端调度（指挥官 Agent A 发号施令）

在 Herdr 终端中，指挥官 Agent A 使用 router call 命令同步调度 Worker：

```bash
# 步骤 1: 指挥官调度 Agent B 编写后端接口
router call agent-b "任务 1: 请在 src/models/user.ts 中创建用户模型与数据迁移脚本" --timeout 300

# （此时终端命令挂起等待... ZCode Agent B 瞬间被唤醒并开始写代码... 完成后回传结果）
# 终端打印输出 Agent B 的回包内容，命令退出 code 0

# 步骤 2: 指挥官调度 Agent C 编写前端视图
router call agent-c "任务 2: 后端用户模型已就绪，请编写对应的注册登录表单页面" --timeout 300

# （终端再次挂起等待... ZCode Agent C 被唤醒写页面... 完成后回传结果）
```

整个流水线由 Herdr 终端的 Agent A 完全掌控，ZCode 的 Agent B 和 C 按需被唤醒，协同天衣无缝！

---

## 四、 常用管理命令汇总

| router list | Herdr / Bash | 查看当前网络内所有 Agent 及其在线状态 |
| router call <target> "<msg>" | Herdr 指挥官 | 派发任务并阻塞等待结果（RPC 同步调用） |
| router send <target> "<msg>" [--task] | 任意终端 | 异步发送普通消息或派发异步任务（--task 唤醒 wait_for_task） |
| router inbox [name] | 任意终端 | 查收指定 Agent 的信箱 |
| send_and_wait(...) | ZCode Agent | 派发任务给目标 Agent 并挂起等待（0 Token 消耗） |
| wait_for_task(...) | ZCode Agent | 作为 Worker 挂起监听任务（0 Token 消耗） |
| register_identity(...) | ZCode Agent | 确立或切换当前 Agent 的业务角色名 |

---

## 五、 Token 成本控制与防暴饮暴食红线

1. **任务包指针法则**：严禁在 `call`、`send` 或 `send_message` 参数中粘贴数百行代码或报错。大型任务包一律先行写入 `docs/tasks/package.md`，消息只传递文件路径指针。
2. **长会话上下文归档**：Herdr 常驻员工执行完阶段性重大任务后，及时在终端执行 `/clear`，避免会话历史滚雪球至 150K+ Tokens 导致单次推理成本失控。
3. **Relay 乒乓熔断**：事务往返超 10 轮无实质交付物，强制熔断并汇报 CEO。
