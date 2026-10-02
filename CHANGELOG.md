# 更新日志

本文件记录所有值得注意的改动。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [1.1.1] - 2026-10-02

### 修改

- **README 的安装说明与事实对齐**：原先把 npm 写成首选、GitHub 写成"尚未发布 npm 时"的退路。
  实际决定不发布到 npm，现在 GitHub 直装是唯一路径，并写明了它是实测过的（空 profile 里 13.3 秒装完，
  `--dump-config` 出现 `# == dsh-agent-ping` 层）。
  代价说清楚：DSH Desktop 内置市场只认 npm 包，所以那里不会有"一键安装"按钮。

- **HANDOVER.md 与事实对齐**：里面有三处仍写着旧包名 `@local/agent-ping`，已改为 `dsh-agent-ping`。
  开头另加一段说明：这份文档是作者的工作笔记，里面的 `_tools/`、会话代号是**环境细节，不是插件的要求**。

## [1.1.0] - 2026-10-02

### 新增

- **睡着的人也叫得动**：`call_agent` 命中一个不在线的会话时，先把它唤醒再投递。
  走 `ctx.sessionController.resolveAgent()`，由它补齐 `agentOptions`（`{{model}}` 的来源）
  与 `setup`（preset 与 tools 的来源）——直接调 `ctx.agents.resume` 会得到"叫得醒但装配跑不起来"。
- `who_can_i_call` 增加【睡着（叫得醒）】一栏，把名册里已知但当前不在线的会话列出来。
- 唤醒回执带实测毫秒数；**只有测量过才敢说"已唤醒"**——调用前先查 `ctx.agents.get(id)`，
  命中活会话时不报唤醒（`resolveAgent` 在活会话上同样返回成功，这是个会骗人的返回值）。

### 修复

- 投递回执不再把"活会话标题没认出来"说成"已唤醒"。
  区分办法：调 `resolveAgent` **之前**先 `ctx.agents.get(id)`——拿得到就是本来就活着。

## [1.0.0] - 2026-10-01

### 新增

- 首个版本：跨会话呼叫。
  - `call_agent`：向用户申请授权，卡片浮在输入框上方（允许 / 拒绝 / 稍后）。
  - `who_can_i_call`：列出当前活着的会话。
  - 授权队列：卡片显示最新一条；「稍后」把当前条挪到队首；允许/拒绝按 id 精确摘除。
  - 会话内回执行 + 待批角标 `＋N 条`。

[未发布]: https://github.com/xk150424/dsh-agent-ping/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/xk150424/dsh-agent-ping/releases/tag/v1.1.1
[1.1.0]: https://github.com/xk150424/dsh-agent-ping/releases/tag/v1.1.0
[1.0.0]: https://github.com/xk150424/dsh-agent-ping/releases/tag/v1.0.0
