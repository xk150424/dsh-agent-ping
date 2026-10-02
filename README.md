# dsh-agent-ping

[English](README.en.md) · [交接资料](HANDOVER.md)

跨会话 **@** —— 让一个 DeepSeek Harness 会话去呼叫另一个会话。**先经用户当场授权，再送达；对方睡着就先唤醒。**

> 一个会话想让另一个会话做点事，原本只能靠人手动切过去、复制、粘贴。
> 这个插件给它开一条通道：经用户点头后，把话直接送进对方那个会话里。
> 对方不在线也没关系——先把它叫醒，再送。

> **English** — `dsh-agent-ping` adds cross-session messaging to DeepSeek Harness.
> The agent asks the user for approval on a card floating above the composer
> (allow / deny / later); once allowed, the message is delivered into the target
> session — waking it first if it is asleep. Two tools: `call_agent` and
> `who_can_i_call`. Plain JavaScript, no build step, no runtime dependencies.

---

## 它长什么样

被呼叫方的会话里，输入框上方浮出一张卡片：

```
from  RE-MK  to  FR-FL            ＋2 条
─────────────────────────────────────────
帮我看一眼 _plugin_agent_ping 里的 index.js
第 380 行那个 target 参数还要不要。

                    [ 等我一下 ]   [ ✕ ]   [ ✓ ]
```

- **允许** —— 送达，卡片消失
- **拒绝** —— 丢弃，呼叫方会收到结果
- **等我一下** —— 不批也不毙，先挂到队尾，过会儿再说

卡片是**按会话独立**的：谁正在跟这个插件的调用方说话，卡片就出现在谁那儿，不用切过去点。

---

## 安装

**目前没有发布到 npm，直接从 GitHub 装。** 需要 **DSH 0.2.0-rc.1 或更新**。纯 JavaScript，**没有构建步骤**，装完即用。

```sh
dsh plugin --profile <你的 profile> add github:xk150424/dsh-agent-ping
```

### DSH Desktop

侧栏 **插件 → 添加插件**，把 `add` 后面那一段粘进去：

```
github:xk150424/dsh-agent-ping
```

> 这条路**实测过**：在一个全新的空 profile 里装完用 13.3 秒，`--dump-config` 里出现了 `# == dsh-agent-ping` 这一层——它成了一个**真正被激活的插件**，不是"只当普通依赖装上"。不需要授权任何构建脚本。

> **profile 名字**：命令行用户一般是 `web`；`desktop` 这个 profile 由桌面端自己持有，CLI 会拒绝管理它——桌面用户请用上面的图形界面。
>
> **装完**：刷新页面即可。如果是在**替换**一个已安装的旧版本，需要重启 DSH 进程。
>
> **升级**：目前 DSH 的插件界面不支持自动更新，升级要先卸载再装新版。

---

## 怎么用

插件给模型两个工具：

| 工具 | 作用 |
|---|---|
| `who_can_i_call` | 列出当前能叫的会话：在线的，以及名册里已知但**睡着（叫得醒）**的 |
| `call_agent` | 呼叫某个会话。**会先弹授权卡给你**，你同意后才送出去 |

模型看到的用法大致是：

```
who_can_i_call                      → 看看都有谁
call_agent { target: "FR-FL",
             message: "帮我看一眼 index.js 第 380 行" }
```

**授权卡是唯一闸门。** 插件不会绕过它做任何事——包括"先斩后奏"或者"叫醒了不告诉你"。

---

## 队列语义

同一时刻可能有好几条待批申请，规则是定死的：

- 卡片**只显示最新那条**
- 角标 `＋N 条` 里的 `N = 队列长度 − 1`，总数不变时它不会变
- **「等我一下」把当前这条挪到队首**（也就是挪离显示位），旧的浮上来；**不批、不毙、不丢**
- 「允许 / 拒绝」**按 id 精确摘除那一条**，不碰队列里的别人

---

## 它是怎么工作的

```
        ┌──────────── 被呼叫方的会话（Web GUI）────────────┐
        │  conversation.input.dock  ──  授权卡片           │
        └───────────────────────▲─────────────────────────┘
                                │  GET  /agent-ping/state
                                │  POST /agent-ping/answer
        ┌───────────────────────┴─────────────────────────┐
        │              Host 半（index.js）                 │
        │  两个工具：call_agent / who_can_i_call           │
        │  待批队列 · 授权路由 · 认人 · 唤醒                │
        └───────────────────────▲─────────────────────────┘
                                │ followup(createUserMessage(…))
                       另一个会话（活着 或 睡着）
```

**送达**用 `agent.followup(...)`（送达 **+** 唤醒），不是 `inject`（只送不唤醒）。

**唤醒只走一条正路**：`ctx.sessionController.resolveAgent(sessionId)`。它把 `agentOptions`（`{{model}}` 的来源）和 `setup`（preset 与 tools 的来源）都补齐了。直接调 `ctx.agents.resume` 会得到一个很难查的现象——**叫得醒，但醒来那一轮装配跑不起来**。

**「已唤醒」这句话只在测量过之后才说。** 唤醒前先查 `ctx.agents.get(id)`：拿得到就说明它本来就活着，只是标题一时没认出来；此时不报唤醒。`resolveAgent` 在活会话上同样返回成功，那是个会骗人的返回值。

**认人**按这个顺序：工作区里的登记表 → 会话标题 → 名册。名册（名字 → 会话 id）由插件自己每次调用时顺手记下来——**唤醒一个不在线的会话只能靠它**，所以一个从没在本机活着过的名字，叫不醒。

---

## 已知限制

- **只在本机**。它操作的是同一个 DSH 实例里的会话，不是网络服务。
- **需要有人点**。这是设计，不是缺陷。
- **唤醒依赖名册**。名册是从历次调用里攒出来的；全新的名字如果当前不在线，插件无凭无据，唤醒不了。
- **没有已读回执**。只能确认"送进去了"，不能确认"对方看懂了"。

### 尚未验证的（诚实记账）

- `resolveAgent` 命中一个**活着但标题取不到**的会话时那条分支——是推断，不是观测。真撞上时回执会这么写：`（名册按 id 命中：他其实活着，只是标题一时认不出来）`。
- 会话尚未落盘、或工作目录缺失时，`resolveAgent` 失败长什么样——错误会原样带出来，但没有实测过。

---

## 开发

| 文件 | 角色 | 改完的代价 |
|---|---|---|
| `index.js` | Host 半：工具、路由、队列、唤醒 | **重启 DSH** |
| `client.js` | Client 半：卡片、动画、角标、回执 | **刷新页面**即可 |
| `package.json` | 包声明与 `dsh` 字段 | **重启 DSH** |
| `cordis.patch.yml` | 往 profile 里插一行 | **重启 DSH** |
| `HANDOVER.md` | 交接资料：踩过的坑、测试方法 | — |

```js
// 写这些位置时请小心：
window.__ModuleLoader__.load({
  id: 'dsh-agent-ping',          // 必须等于包名
  factory(require) { … }         // 副作用一律放进 factory 闭包里
});
```

> ⚠ `package.json` 的 `exports` **必须含 `"./package.json"`**。缺了它，前端那半会**静默不加载**——没有报错，卡片就是不出现。
>
> ⚠ `cordis.patch.yml` 里的 `name:` **必须等于包名**，否则 Node 解析不到代码。

---

## 许可

[MIT](LICENSE)
