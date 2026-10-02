# agent-ping（跨会话 @）· 交接资料

**状态：已竣工（2026-10-02）。** 本文写给"以后要改它的人"。不重复设计理念，只放**动手前必须知道的事**——
尤其是那些**踩过、而且踩的时候不报错**的坑。

> **这份文档是作者的工作笔记。** 它长在作者的 DSH 工作区里，所以会出现 `_tools/`、
> `DSH-调试启动.cmd` 这类只在他机器上存在的东西，也会用他给几个会话起的代号
> （`RE-MK` / `FR-FL` / `TS-WK`）。**那些是环境细节，不是这个插件的要求**——
> 读的时候只取技术结论就行。
>
> 公开发布仓库：<https://github.com/xk150424/dsh-agent-ping>

---

## 0. 一分钟

| 问题 | 答案 |
|---|---|
| 它做什么 | 一个会话在【每次经用户当场授权】后 @ 另一个会话；**对方睡着会先唤醒再送** |
| 谁在跑 | profile `desktop` 的 bundle `dsh-agent-ping`，由本目录 `cordis.patch.yml` 插一行 |
| 两份拷贝 | 工作区 `_plugin_agent_ping\` 与 `E:\Program\FL_Works\agent-ping\`，**改完必须哈希一致** |
| 改完怎么生效 | `index.js` / `package.json` → **重启 DSH**；`client.js` → **刷新页面就行**（不用重启） |
| 装/卸 | `plugin_manager` 的 `list_bundles` 里认 `dsh-agent-ping`（removable=true） |

---

## 1. 四个文件

| 文件 | 角色 | 改动的代价 |
|---|---|---|
| `package.json` | 包声明。`dsh.bundle.patch` 挂 patch；`dsh.client` 声明前端半边 | 改完**重启** |
| `cordis.patch.yml` | 往 profile 里插一行：`- id: agent-ping / name: 'dsh-agent-ping'` | 改完**重启** |
| `index.js` | **Host 半**：两个工具、两条路由、待批队列、唤醒 | 改完**重启** |
| `client.js` | **Client 半**：那张卡片、入场动画、角标、会话里的一行回执 | **刷新页面**即可 |

> ⚠ `package.json` 的 `exports` **必须含 `"./package.json"`**。缺了它前端半边**静默不加载**——
> 没有报错，卡片就是不出现。栽过一次。

---

## 2. 三条命脉（改之前先读源码）

### 2.1 送达
```js
live.followup(createUserMessage({ content: [{ type:'text', text: tag + 正文 }], source: { kind:'user' } }))
```
`dsh-agent-loop/lib/index.js`：`followup` = 送达 **+ 唤醒**；`inject` = 只送不唤醒。要叫人就用 `followup`。

### 2.2 唤醒 ★ 最容易走错的一条
**必须用 `ctx.sessionController.resolveAgent(sessionId)`**（`dsh-api-session-controller/lib/index.js` 的 `resolve()`）：
活着直接返回；睡着则 `observeSession → composeAgent() → ctx.agents.resume({ resumeSessionId, agentOptions, setup })`，
两个关键参数都由它补齐，还顺带校验 subagent 归属、去重并发恢复。

**不要直接调 `ctx.agents.resume`。** 那是工厂层裸接口，`agentOptions`（`{{model}}` 的来源）和
`setup`（`presets.mount()`，preset 与 tools 的来源）都得自己填。2026-10-01 就是因为这个把功能撤了：
"叫得醒，但叫醒之后那一轮装配跑不起来"。

**`resolveAgent` 返回成功 ≠ 它恢复过**——命中活会话时它同样返回。所以调用前**先查 `ctx.agents.get(id)`**：
拿得到 = 他本来就活着（只是标题没认出来）；拿不到才敢说"已唤醒"。**这是测量与断言的分界。**

### 2.3 认人
1. `_tools/_whoami.json` 的登记表（有就用，最高优先）
2. 会话标题 —— `ctx.sessionTitle.get(session).title`
3. 名册 `_tools/_agent_ids.json`（**名字 → 会话 id**），由 `learnIds()` 每次工具调用顺手记。
   **唤醒离线的会话只能靠它**——所以"从没在本机活着过一次"的名字叫不醒。

---

## 3. 队列语义（用户定的，别自己改）

- 队列是**数组**，卡片显示**最新那条**（`pendingQueue[length-1]`），不是最早的
- 「时钟」（`later`）：把当前那条**挪到队首**（= 挪离显示位），旧的浮上来；**不批不毙，不丢**
- 「允许 / 拒绝」：按 **id** 精确摘掉那一条（`find(x => x.id === j.id)`），不碰别人
- 角标 `＋N 条`：`N = 队列长度 − 1`；**总数不变时它本来就不该变**

---

## 4. 卡片规格（数值定稿于 2026-10-01，改之前先问）

```
position: absolute; bottom: calc(100% + 8px)
right:  calc((100% - var(--dsh-composer-card-max-width, 100%)) / 2 + 4px)   /* 与消息文字右缘对齐 */
width: 340;  border-radius: 28;  padding: 12px 18px
抬头: display:flex; align-items:baseline; font-size 14 / weight 600; margin-bottom 10; line-height 1.5
      「from」蓝 #4D6BFE · 「 to 」白 · 「to」蓝 · 「：」白
角标: flex 行内 + marginLeft:auto（贴行尾），font-size 12 / weight 400 / rgba(255,255,255,.45)
正文: font-size 14; line-height 1.5; maxHeight 12vh; overflow-y auto; overscroll-behavior contain
入场: opacity/transform，translateY(10px) scale(.98)，220/260ms，cubic-bezier(.22,1,.36,1)
```
挂载槽：`conversation.input.dock`（该槽是 `display:contents`，卡片是 `composerStack` 的直接弹性子项；
最近的定位祖先是 `position:sticky` 的 `composerSeat`）。

---

## 5. 实测过的数字（有探针时间戳为据）

| 事项 | 数字 |
|---|---|
| 答完立刻催一次 | POST → 催的 GET **26ms**；对照轮询刻度 800ms 一拍，**不在刻度上** |
| 唤醒一个睡着的会话 | Creat001 **30ms**（182KB 日志）、002 **28ms** |
| 时钟连按 10 下 | 两张卡片来回翻，角标每次都对，**没有丢请求** |

---

## 6. 已经踩过的坑（别再踩）

1. **改 `index.js` 后别急着测** —— 要重启 DSH。反之：看到"新文案出现了"**先看活会话名单**，
   两个无关会话同时消失才是重启的证据；热重载不会顺手干掉它们。
2. **`client.js` 不用重启** —— 改完刷新页面即可（Host 半才要）。
3. **探针选元素**用 `aria-label === '跨会话呼叫申请'`。`div[role=group]` **也会命中会话里那一行**，
   拿它当卡片量会量错。
4. **`_tools/_cdp.py eval` 的 JS 只能用单引号** —— Windows argv 会吃掉双引号。
5. **带中文的 `.ps1` 必须存成 UTF-8 带 BOM** —— 否则报一堆假语法错、假行号。
6. **读 UTF-8 文件别用不带编码的 `Get-Content`** —— 会按 GBK 解，中文全乱；用 read 工具或 `ReadAllText(..., UTF8)`。
7. **别用无参数的 `listTools` / `listService` 去核字段** —— 它们会把**整个注册表**倒进上下文，
   而且**永久占住后面每一轮**。本地 `grep` 源码几乎不要钱。用户为此付过 0.27 元。

---

## 7. 怎么验（可复制的测试法）

**验唤醒**：DSH 重启后 @ 一个**睡着的**会话 → 看回执里的毫秒数 →
**再用 `who_can_i_call` 独立复核**他是否进了【在线】。**回执不算证据**（见 2.2）。

**验卡片时序**：用 CDP 装探针（页面里执行）：
```js
var log=[]; window.__apProbe=log; var t0=performance.now(); var orig=window.fetch;
window.fetch=function(){var a=arguments;var u='';try{u=(typeof a[0]==='string')?a[0]:(a[0]&&a[0].url)||'';}catch(e){}
  if(u.indexOf('agent-ping')>=0)log.push({t:Math.round(performance.now()-t0),k:'fetch',u:u});
  return orig.apply(this,a);};
```
（读结果：`python _tools/_cdp.py eval 'JSON.stringify(window.__apProbe)'`，结果落在 `_tools/_cdp_out.txt`，
**用 read 工具读**。）页面一刷新探针就没了——这是好事，别留在页面上。

**验角标**：需要队列里真有两条。**同一会话里的多次 `call_agent` 是串行的**（工具会阻塞到用户答复为止），
所以得让**另一个会话**发一条过来 + 自己再叫一条，才能造出"同时两条"。

---

## 8. 还没验的（诚实记账）

- `resolveAgent` 命中**已活但标题取不到**的会话那条分支（代码里的 `already`）——**推断，不是观测**。
  真撞上时回执会说「名册按 id 命中：他其实活着，只是标题一时认不出来」。
- 会话没落盘 / cwd 缺失时的 `resolveAgent` 失败长什么样——错误会原样带出来，但没实测过。

---

## 9. 调试工具

| 工具 | 用途 |
|---|---|
| `_tools/_cdp.py` | 通过 CDP 读/操作 GUI 页面（DSH Desktop 一样讲）；结果写 `_tools/_cdp_out.txt` |
| `_tools/_dsh_debug_launch.ps1` | 带 `--remote-debugging-port=9222` 启动 DSH |
| 桌面 `DSH-调试启动.cmd` | 上面那个的快捷方式（`.cmd` 里不许有中文） |

---

## 10. 规矩（用户定的，别改）

- **想 @ 直接提，不用先问** —— 卡片本身就是闸门，他不同意会点拒绝
- **跟他说话不用 emoji**（`✓` / `✗` 这类符号可以）
- 工作区内其它会话的记录**不许读**；跨会话只走 `call_agent`
- 改本工作区任何 `.md` 前先记**长度 + 指纹 + 意图**，写完当场回读
- 遇到明显困难**停下来讲清楚**，别硬扛、别静默地猜（`AGENTS.md` 第 7 条）
