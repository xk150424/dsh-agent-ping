/**
 * agent-ping —— 跨会话「@」
 *
 * 让一个会话在【每一次都经用户当场授权】之后，呼叫另一个会话
 * （**睡着的会先被唤醒再送** —— 见下面「睡着也能叫」）。
 *
 * 机制（读源码确认过，不是猜的）：
 *   dsh-agent-loop/lib/index.js
 *     followup(input) { this.send(input, "next-turn", true); }   ← 送达 + 唤醒
 *     inject(input)   { this.send(input, "next-step", false); }  ← 只送，不唤醒
 *   叫一下要能把他叫醒，所以用 followup。消息体用 dsh-llm 的 createUserMessage(...)。
 *
 * 认人（不需要任何人跑命令）：
 *   1. _tools/_whoami.json 的登记表（有就用，最高优先）
 *   2. 会话标题 —— ctx.sessionTitle.get(session).title
 *
 * 授权：不是弹对话框，是【卡片】—— 画在 client.js，挂在 conversation.input.dock
 *   （"Full-width entries ABOVE the composer card"）。
 *   那个槽是 per-session 的，所以卡片会出现在【用户当前看的任何一个会话】里，
 *   他不用切到调用方这边来点。三个动作：允许 ✓ / 拒绝 ✕ / 稍后 表。
 *   Host 开两个本地路由给 Client 用：GET /agent-ping/state、POST /agent-ping/answer。
 *
 * 名册：_tools/_agent_ids.json（名字 -> 会话 id），每次调用顺手记活着的会话。
 *   【全程不读任何会话日志】—— 名册是插件自己的元数据，不是抄别人的记录。
 *
 * 【睡着也能叫】用户 2026-10-02 定为"按需唤醒"：
 *   目标是睡着的 → 从名册取 id → ctx.sessionController.resolveAgent(id) → 再送。
 *   名单不用配：**@ 到谁才叫醒谁**（不占着用不到的内存）。
 *
 *   这条路走过弯路，写在这儿省得再走：
 *   2026-10-01 那版直接调 ctx.agents.resume —— 那是工厂层裸接口。它"叫得醒"，
 *   但叫醒之后那一轮装配跑不起来（缺 agentOptions 报 prompt variable "{{model}}"；
 *   补了又报 tools: at least one tool must have defer_loading=false，还要 setup 挂 preset），
 *   于是当时把功能撤了。2026-10-02 查清：**正确入口是 sessionController.resolveAgent** ——
 *   它内部走 composeAgent()，把 agentOptions 和 preset mount 都补齐，
 *   还顺带校验 subagent 归属、去重并发恢复。界面上点开一个休眠会话走的就是它。
 *
 *   实测（2026-10-02，DSH 重启后六个会话只剩我一个活的、另外五个全睡着）：
 *   @ Creat001 → 回执「他原本睡着，已唤醒，耗时 30ms」，消息送达；
 *   who_can_i_call 随即把 Creat001 列为在线 —— **独立证据，不是插件自说自话**。
 *   名册（_tools/_agent_ids.json）就是 id 的来源，一直留着。
 *
 * 安全：
 *   每一次呼叫都要用户当场点头（卡片）。不点头，这条就发不出去。
 *   消息正文由插件盖章成「谁 @ 谁：内容」，双方都不用自我介绍，也不会被误认成"用户说的"。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'agent-ping';
export const inject = ['tools', 'agents', 'webServer', 'systemPrompt'];

// ── 第一层：常驻系统提示 ──
// 目的：让每个会话在【收到第一条 @ 之前】就知道有这么个通道、以及回话的两条路。
// 没有它，这功能只在"用过一次之后"才成立（新会话是空的）。
//
// 注册在插件根上下文 = 全局作用域 → 所有会话都拿到。
// 契约（cordis_inspect_query 查的，不是猜的）：
//   section(): "Register an ordered prompt section in the calling context's scope."
//   PromptSection = { name, order: number, text }
// order 取 3200：紧跟工具段落（TOOL_* 是 1000~3100）之后，排在 MCP_SERVERS 之后、TOOLS_SDK(5000) 之前。
//
// 成本：这一整段会出现在每个会话的每一轮里。**所以它必须短。**
const AGENT_PING_GUIDE =
  '【跨会话 @】你可以用 `call_agent` 呼叫同事（用 `who_can_i_call` 看有谁），每一次都会先请用户授权。'
  + '对方睡着也**照样叫得动**（会先把他唤醒再送）——别因为"他不在线"就不叫。'
  + '收到「X @ 你：」形式的消息时，**回它要用 `call_agent`**——你在自己会话里直接说的话，对方看不到。';
// 注意：这段**刻意不提任何具体文件**（板子之类）。
// 2026-10-01 用户定的：**插件只教插件自己**；工作区惯例（留言板、登记表）归各工作区的
// AGENTS.md 管。原文写了我们的板子文件名，结果别的 workspace 的会话（Creat001）
// 跑去找**我们的**板子，找了 1 分 48 秒 —— 【板子不跨工作区】。
// 摘掉之后这段对谁都成立，也不需要 Config。


// 待批的申请。**队列，不是单槽**（2026-10-01 修）。
// 原来是一个变量，两个会话同时 @ 就会互相踩，而且更毒的是：
// 前一条的兜底定时器到点后 `pendingReq = null`，会把【后一条】的卡片一起清掉
// —— 用户只看到卡片莫名消失，没人告诉他为什么（又一个"失败长得像成功"）。
const pendingQueue = [];

// 只摘掉【指定的那一条】。以前是 `pendingReq = null`，那是"清空整格"，
// 在单槽下等价，在队列下就会误伤别人。
function dropReq(req) {
  const i = pendingQueue.indexOf(req);
  if (i >= 0) pendingQueue.splice(i, 1);
}
let reqSeq = 0;

// 游标文件名用 ID（rexm），板子上署名用名字（RE-MK）——所以要有张别名表。
// 想加人只改 _tools/_whoami.json 的 aliases，不用动这个脚本。
const DEFAULT_ALIASES = { rexm: ['RE-MK'], frfl: ['FR-FL'], tswk: ['TS-WK'] };
// ⚠ 这里原来有个 FALLBACK_WS 硬编码指向【我们的】工作区。
// 用户 2026-10-01 发现并禁止：「不允许它（别的会话）进入这个工作区」。
// 那条兜底会让一个 cwd 取不到的**外部会话**去读、去写我们的 _tools/ —— 已删。
// 拿不到 cwd 就是拿不到：不读、不写任何工作区文件。

// defineTool 要求 output 必填（dsh-tools/lib/index.js L842 读 options.output.render）。
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: (typeof value === 'string') ? value : JSON.stringify(value) }]
};

/* ───────────────── 基础：路径 / 登记表 / 名册 ───────────────── */

// 会话自己的工作区根。**拿不到就 null，绝不兜底到别人的工作区**（用户 2026-10-01 的要求）。
function workspaceRoot(exec) {
  const c = exec?.agent?.session?.header?.cwd ?? exec?.agent?.session?.cwd;
  return (typeof c === 'string' && c) ? c : null;
}

function readJson(file, fallback) {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'));
    return (o && typeof o === 'object') ? o : fallback;
  } catch { return fallback; }
}

// root 为 null → 不读任何工作区文件（登记表当空）
function loadWhoami(root) { return root ? readJson(join(root, '_tools', '_whoami.json'), {}) : {}; }

function aliasList(whoami, code) {
  const k = String(code).toLowerCase();
  const listed = whoami.aliases?.[k];
  const arr = (Array.isArray(listed) && listed.length) ? listed : (DEFAULT_ALIASES[k] || []);
  return arr.length ? arr : [String(code)];
}

function aliasTable(whoami) { return { ...DEFAULT_ALIASES, ...(whoami.aliases || {}) }; }

// 名册：名字（小写）-> 会话 id。插件自己攒的，不读任何日志。
// root 为 null → 名册空，且不写（见 learnIds）
function idsPath(root) { return root ? join(root, '_tools', '_agent_ids.json') : null; }
function loadIds(root) {
  const p = idsPath(root);
  const o = p ? readJson(p, {}) : {};
  if (!o.names || typeof o.names !== 'object') o.names = {};
  return o;
}

/* ───────────────── 认人：登记表 → 会话标题 ───────────────── */

/** 读会话标题。拿不到就 null（服务没挂 / 还没生成）。 */
function titleOf(ctx, agent) {
  try {
    const svc = ctx.get('sessionTitle');
    const t = svc?.get?.(agent.session)?.title;
    return (typeof t === 'string' && t.trim()) ? t.trim() : null;
  } catch { return null; }
}

/** 这个 agent 是谁？登记表优先，其次会话标题；都没有 → null（不猜）。 */
function identify(ctx, whoami, agent) {
  const reg = whoami.sessions?.[agent.id];
  if (reg) return { code: reg, name: aliasList(whoami, reg)[0], via: '登记表' };

  const t = titleOf(ctx, agent);
  if (!t) return null;
  const t2 = t.toLowerCase();

  // ① 标题命中别名表 → 用别名表里的正式写法
  for (const [code, aliases] of Object.entries(aliasTable(whoami))) {
    const list = Array.isArray(aliases) ? aliases : [];
    if (list.some((a) => String(a).toLowerCase() === t2)) {
      return { code, name: list[0], via: '会话标题', title: t };
    }
  }

  // ② 别名表里没有 → 【直接用标题本身当名字】。
  // 2026-10-01 补。它在两个地方同时咬人，而且是同一个不对称：
  //   · 显示：who_can_i_call 把明明能 @ 到的会话报成「认不出」——骗我
  //   · 发送：findLive 用标题逐字找得到它，但 identify 认不出"我是谁"，
  //           于是那个会话【收得到、回不了】。
  // 来历：Creat001（新工作区的白板会话）实测撞上第②条，当时它自己建了登记表才绕过去。
  // **2026-10-01 复验：它把自己的登记表删掉后重测 —— 收 / 回都正常，
  //   报「我是：Creat001（会话标题）」。绕道已不再需要。**（它自己提的这条复验。）
  // 我们三个不受影响——标题本来就是代号。
  return { code: t, name: t, via: '会话标题', title: t };
}

/** 名字 -> 活着的 agent。登记表优先，其次会话标题。 */
function findLive(ctx, whoami, name) {
  const want = String(name).trim().toLowerCase();
  const live = ctx.agents.list();
  for (const a of live) {
    const reg = whoami.sessions?.[a.id];
    if (reg && aliasList(whoami, reg).some((x) => String(x).toLowerCase() === want)) return a;
  }
  for (const a of live) {
    const t = titleOf(ctx, a);
    if (t && t.toLowerCase() === want) return a;
  }
  return null;
}

/** 活着的会话 + 各自认出来的名字 */
function roster(ctx, whoami) {
  return ctx.agents.list().map((a) => {
    const id = identify(ctx, whoami, a);
    return { agent: a, name: id?.name ?? null, via: id?.via ?? null, title: titleOf(ctx, a) };
  });
}

/**
 * 把当前活着的会话记进名册。每次工具调用都顺手做一次。
 * 只写"名字 -> id"，不抄任何会话内容。
 */
function learnIds(ctx, whoami, root) {
  const ids = loadIds(root);
  let changed = false;
  for (const a of ctx.agents.list()) {
    const id = identify(ctx, whoami, a);
    if (!id) continue;
    const key = id.name.toLowerCase();
    if (ids.names[key] !== a.id) { ids.names[key] = a.id; changed = true; }
  }
  if (changed) {
    const p = idsPath(root);
    // root 为 null（拿不到工作区）→ 不写。这不是失败，是"没有可写的地方"。
    if (p) {
      try { writeFileSync(p, JSON.stringify(ids, null, 2) + '\n', 'utf8'); }
      catch { /* 名册只是缓存：写不进去不影响 @ 功能，所以可以吞 */ }
    }
  }
  return ids;
}

function recordedId(ids, name) { return ids.names?.[String(name).trim().toLowerCase()] ?? null; }

/* ───────────────── 唤醒：把睡着的会话叫起来 ───────────────── */

/**
 * 把一个【睡着】的会话叫起来。
 *
 * 【2026-10-02】上次撤掉的离线自动启动，失败原因查清了，是**用错了层**。
 * 当时直接调 `ctx.agents.resume(...)` —— 那是工厂层的裸接口，两个关键参数
 * 都得调用方自己填，我们一个都没填：
 *   · agentOptions → 里面是 agentDefaultModel.currentSelection()，缺它就是
 *                    报 `prompt variable "{{model}}"` 的那个 model
 *   · setup        → composeAgent() 产出的回调，负责 presets.mount()（preset 与 tools）
 * 正确入口是 `ctx.sessionController.resolveAgent(id)`（dsh-api-session-controller/
 * lib/index.js 的 resolve()）：活着直接返回；睡着则 observeSession → composeAgent
 * → agents.resume，两个参数都由它补齐，还顺带校验 subagent 归属、去重并发恢复。
 * **界面上点开一个休眠会话走的就是这条路**，所以它是被日常使用验证过的，不是读着像行。
 *
 * 唤醒本身不发消息、不进 turn、不花钱；代价是那个会话从此常驻内存。
 */
async function wakeSession(ctx, sessionId) {
  const t0 = Date.now();
  // 用 ctx.get 而不是 inject：这个服务只在 web 组合里有，硬注入会让插件在
  // 缺它的组合里干脆不挂载（整包失效）。而"叫不醒"完全可以只是一条普通错误。
  const sc = ctx.get('sessionController');
  if (!sc || typeof sc.resolveAgent !== 'function') {
    return { ok: false, reason: '这个 DSH 版本没有 sessionController，叫不醒（旧内核）。' };
  }
  try {
    const r = await sc.resolveAgent(sessionId);
    if (r && r.error) return { ok: false, reason: r.error.message ?? String(r.error) };
    const agent = (r && r.agent) ?? ctx.agents.get(sessionId);
    if (!agent) return { ok: false, reason: 'resolveAgent 没报错，但拿不到 agent。' };
    return { ok: true, agent, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, reason: (e && e.message) ? e.message : String(e) };
  }
}

/* ───────────────── 工具 ───────────────── */

export function apply(ctx) {
  /* ── 申请卡片：Host 开两个本地路由，Client 轮询 + 回答案 ── */
  const sendJson = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  /* ── 第一层：常驻系统提示 —— 所有会话都拿到 ── */
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'TOOL_AGENT_PING',
    order: 3200,
    text: AGENT_PING_GUIDE
  }), 'agent-ping: system prompt section');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/agent-ping/state',
    handler: (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method' });
      // 卡片每次轮询都打这儿 —— 所以「有人来轮询过」= 卡片是活的。
      // call_agent 靠这个标记决定「该不该兜底」，而不是傻等固定秒数。
      //
      // 【显示最新那条】——用户 2026-10-01 定的语义：
      //   同时来两条时，卡片显示【新的】，旧的没丢、在后面等着；
      //   按「时钟」= 把当前这条挪到【队首】（挪离显示位置），旧的于是浮上来。
      //   （我一开始写成"显示队首"，那会让最新的干等在后面 —— 用户纠正了。）
      const head = pendingQueue[pendingQueue.length - 1] || null;
      if (head) head.seenByClient = true;
      sendJson(res, 200, {
        pending: head ? {
          id: head.id, token: head.token,
          from: head.from, to: head.to, message: head.message,
          waiting: pendingQueue.length - 1        // 后面还排着几条（给卡片显示用）
        } : null
      });
    }
  }), 'agent-ping: GET /agent-ping/state');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/agent-ping/answer',
    handler: (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try {
          const j = JSON.parse(body || '{}');
          // **按 id 找那一条**，不是"拿当前那条"——队首会变，拿当前条会结算错人。
          const r = pendingQueue.find((x) => x.id === j.id);
          if (r && j.token === r.token
              && (j.action === 'allow' || j.action === 'deny' || j.action === 'later')) {
            ok = true;
            if (j.action === 'later') {
              // 「时钟」：只叫醒等待者，卡片留着（不批也不毙）。
              // **挪到队首** —— 因为卡片显示的是**队尾（最新）**，
              // 所以"挪离显示位置"= 挪到队首。旧的这时候就浮上来了。
              // 它之后还会转回队尾再现身；那时路由这边没有 settle，
              // 用户点「允许」会走下面的 `r.deliver()` 分支，照样送得出去。
              const s = r.settle; r.settle = null; if (s) s('later');
              dropReq(r); pendingQueue.unshift(r);
            } else {
              dropReq(r);                                    // 只摘这一条，不碰别人
              const s = r.settle; r.settle = null;
              if (s) s(j.action);                            // 工具还在等 → 交给它
              else if (j.action === 'allow') r.deliver();    // 延后之后才点的「允许」
            }
          }
        } catch (e) { /* 坏 JSON 就当没答 */ }
        sendJson(res, ok ? 200 : 400, { ok });
      });
    }
  }), 'agent-ping: POST /agent-ping/answer');

  ctx.tools.register(defineTool({
    name: 'who_can_i_call',
    description: '列出活着的会话（以及名册里睡着、但叫得醒的），呼叫之前先看这个。',
    parameters: {},
    output: TEXT_OUTPUT,
    execute(_args, exec) {
      const root = workspaceRoot(exec);
      const whoami = loadWhoami(root);
      const me = identify(ctx, whoami, exec.agent);
      const ids = learnIds(ctx, whoami, root);
      const all = roster(ctx, whoami);

      const liveLines = all.map((x) => {
        const mark = x.agent.id === exec.agent.id ? '（我）' : '';
        const who = x.name ? x.name + (x.via === '会话标题' ? '（靠标题认的）' : '') : '**认不出**';
        return '  - ' + who + mark + (x.title ? '  标题=「' + x.title + '」' : '  标题=（还没有）');
      });

      const liveNames = new Set(all.filter((x) => x.name).map((x) => x.name.toLowerCase()));
      const offline = Object.keys(ids.names).filter((k) => !liveNames.has(k));

      return Promise.resolve(
        '我是：' + (me ? me.name + '（' + me.via + '）' : '**认不出我自己**') + '\n' +
        '【在线】' + all.length + ' 个：\n' + liveLines.join('\n') +
        '\n【睡着（叫得醒）】' + (offline.length ? offline.join('、') : '（没有）') +
        '\n\n睡着的也能叫：call_agent 会**先把他唤醒再送**，名单不用配。' +
        '\n名册里没有 id 的叫不醒——那说明这个名字从没在本机活着过一次。' +
        '\n认人的办法：**会话标题就是名字**——给对方起个标题就能叫到，不用跑任何命令。'
      );
    }
  }));

  ctx.tools.register(defineTool({
    name: 'call_agent',
    description:
      '呼叫另一个会话（跨会话 @）。' +
      '对方睡着也能叫——会先把他唤醒再送（唤醒不发消息、不进 turn、不花钱，但他之后会常驻内存）。' +
      '【每一次都先请用户授权】—— 会在他当前看的界面里弹一张卡片（允许 / 拒绝 / 稍后），他点了才送达。',
    parameters: {
      target: { type: 'string', required: true, description: '要叫谁，例如 TS-WK / FR-FL（等同他的会话标题）' },
      message: {
        type: 'string', required: true,
        description: '要说的话，会原样送达。尽量短——一句话能说清就别写三句。'
          + '需要对方回复时，在话里说清要不要回、希望怎么回。'
      }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const root = workspaceRoot(exec);
      const whoami = loadWhoami(root);

      const me = identify(ctx, whoami, exec.agent);
      if (!me) {
        // 认不出只有一个原因：**这个会话没有标题**。
        // （2026-10-01 起，任何标题都能当名字——不再要求标题等于某个代号，
        //   也不再要求跑什么登记命令。原文提了 `_tools/_board.cjs`，那是本工作区独有的工具，
        //   对别人是误导，已摘。）
        throw new Error(
          '我不知道"我是谁"，所以不知道是谁在叫。'
          + '给**我这个会话**起一个标题就能认出来了——标题就是名字。'
          + '（现在还没有标题。）'
        );
      }

      const ids = learnIds(ctx, whoami, root);

      // 先确定"叫谁"——在线的直接拿；睡着的**先叫醒再拿**。
      let live = findLive(ctx, whoami, args.target);
      let targetName = args.target;
      let wakeNote = '';

      if (live) {
        if (live.id === exec.agent.id) throw new Error('不能 @ 我自己。');
        targetName = identify(ctx, whoami, live)?.name ?? args.target;
      } else {
        // 【按需唤醒】用户 2026-10-02 定：睡着的会话先叫醒再送。
        // 名单不用配 —— 名册里谁都能叫，**@ 到谁才叫醒谁**，不占着不用的内存。
        // （上一版是"离线就叫不到"，注释留着当路标：改成现在这样是因为
        //   看清了 resolveAgent 才是正确入口，见上面的 wakeSession。）
        const saved = recordedId(ids, args.target);
        if (!saved) {
          const others = roster(ctx, whoami).filter((x) => x.agent.id !== exec.agent.id);
          const hint = others.length
            ? '现在活着的其他会话：' + others.map((x) => x.name ?? '（标题「' + (x.title ?? '无') + '」认不出）').join('、')
            : '现在没有别的会话活着。';
          throw new Error(
            '叫不到「' + args.target + '」——他睡着，而名册里也没有他的 id'
            + '（说明这个名字从没在本机活着过一次）。先把他开起来一次，名册就记住了。' + hint
          );
        }
        // 【用 id 再确认一次，别信标题】
        // findLive 是按【标题】认人的；标题取不到时，它会漏掉一个活着的会话。
        // 而 resolveAgent **无论"真恢复"还是"命中已活的会话"都同样返回** ——
        // 所以只看它返回成功就报"已唤醒"，那是**断言，不是测量**。
        //
        // 2026-10-02 栽的：@ 002 那次回执写着「他原本睡着，已唤醒，耗时 28ms」，
        // 002 随即回话说它一直在活跃会话里、没看到唤醒事件。它的证词既不能证实
        // 也不能反驳（**被恢复的会话从里面看没有缝**：日志整段回来，消息也只是
        // followup 送进去的一条普通入站消息）。所以不跟它辩，改成量 ——
        // 先问 ctx.agents.get(id)：拿得到 = 他本来就活着，只是名字没认出来。
        const already = ctx.agents.get(saved);
        if (already) {
          live = already;
          wakeNote = '（名册按 id 命中：他其实活着，只是标题一时认不出来）';
        } else {
          const woke = await wakeSession(ctx, saved);
          if (!woke.ok) {
            throw new Error('叫不到「' + args.target + '」——他睡着，我去叫，**没叫醒**：' + woke.reason);
          }
          live = woke.agent;
          // 走到这儿 `ctx.agents.get(id)` 是空过的，"已唤醒"才算量过。
          wakeNote = '（他原本睡着，已唤醒，耗时 ' + woke.ms + 'ms）';
        }
        if (live.id === exec.agent.id) throw new Error('不能 @ 我自己。');
        targetName = identify(ctx, whoami, live)?.name ?? args.target;
      }

      // ① 摆出申请卡片 —— 让用户在他【当前看的任何一个会话】里点。
      //    conversation.input.dock 是 per-session 槽，所以卡片跟着他的视线走，
      //    不用他切到调用方这个会话来点。
      const reqId = 'ap-' + Date.now() + '-' + (reqSeq++);
      const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

      const deliver = () => {
        live.followup(createUserMessage({
          content: [{ type: 'text', text: me.name + ' @ ' + targetName + '：' + args.message }],
          source: { kind: 'user' }
        }));
      };

      // 回执统一带上「谁 → 谁：」——
      // Client 那半靠它画会话里的那一行（tool.call.toolview）。
      const tag = me.name + ' → ' + targetName + '：';

      const req = {
        id: reqId, token, from: me.name, to: targetName, message: args.message,
        deliver, settle: null, timer: null, seenByClient: false
      };
      pendingQueue.push(req);      // 入队；**队尾（最新）才是卡片现在显示的那条**

      // 兜底要「看情况」，不能傻等固定秒数——否则卡片明明活着，时间一到照样被抢掉。
      //   阶段一：给 4 秒，看有没有客户端来轮询 /agent-ping/state
      //           有   → 卡片活着 → 阶段二：长等 10 分钟，真等用户点
      //           没有 → 卡片没加载 → 兜底，回退到 harness 自带的问答框
      const PROBE_MS = 4000;
      const WAIT_MS = 10 * 60 * 1000;

      const action = await new Promise((resolve) => {
        req.settle = resolve;
        req.timer = setTimeout(() => {
          if (!req.seenByClient) { resolve('fallback'); return; }
          req.timer = setTimeout(() => resolve('timeout'), WAIT_MS);
        }, PROBE_MS);
      });
      if (req.timer) clearTimeout(req.timer);

      if (action === 'fallback') {
        dropReq(req);              // 只摘自己 —— 以前是清空整格，会误伤后面那条
        const uq = (() => { try { return ctx.get('userQuestions'); } catch { return undefined; } })();
        if (!uq || typeof uq.ask !== 'function') {
          return tag + '界面没响应（授权卡片没加载），这次没发出去。';
        }
        const a = await uq.ask({
          questions: [{
            id: 'allow_call',
            header: '跨会话 @',
            question: tag + '\n\n允许这次呼叫吗？',
            options: [{ label: '允许' }, { label: '拒绝' }]
          }],
          agent: exec.agent,
          signal: exec.signal
        });
        const picked = [...(a?.answers?.[0]?.selected ?? []), a?.answers?.[0]?.custom ?? ''].join(' ');
        if (picked.includes('允许')) {
          deliver();
          return tag + '已送达。' + wakeNote;
        }
        return tag + '用户没批准这次呼叫，没有发出去。';
      }

      if (action === 'allow') {
        dropReq(req);              // 只摘自己
        deliver();
        return tag + '已送达。' + wakeNote;
      }
      if (action === 'later') {
        // 「表」= 先挂着，不批也不毙：卡片留着。
        // 用户之后点 ✓，路由那边会直接调 deliver() 把这条送出去；点 ✕ 就丢。
        req.settle = null;
        return tag + '用户让你稍等——申请还挂在卡片上，他点头我就发。' + wakeNote;
      }
      dropReq(req);                // 只摘自己（deny / timeout 都走这儿）
      if (action === 'deny') return tag + '用户拒绝了这次呼叫，没有发出去。';
      return tag + '没收到答复，这次没发出去。';
    }
  }));
}
