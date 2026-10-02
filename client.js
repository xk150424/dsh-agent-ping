/**
 * agent-ping —— Client 半（授权卡片）
 *
 * 挂在 conversation.input.dock 上：
 *   "Full-width entries ABOVE the composer card."  —— 就是草图上「输入框上方」那个位置。
 *
 * 关键：这个槽是 per-session 的。
 *   所以卡片会自动出现在【用户当前正在看的任何一个会话】里——
 *   不用他切到调用方那边去点。
 *
 * 数据来自 Host 半开的两个本地路由：
 *   GET  /agent-ping/state    当前有没有待批的申请
 *   POST /agent-ping/answer   { id, token, action }
 *
 * 三个动作（照用户的草图）：
 *   表  later  「等我一下」——不批也不毙，先挂着
 *   ✕  deny   拒绝
 *   ✓  allow  允许
 *
 * 样式只用 --dsw-alias-* 主题令牌，所以亮/暗主题都跟宿主一致。
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-ping',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    const STATE_URL = '/agent-ping/state';
    const ANSWER_URL = '/agent-ping/answer';

    function usePending() {
      const [pending, setPending] = useState(null);
      useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const r = await fetch(STATE_URL, { headers: { accept: 'application/json' } });
            if (!r.ok) return;
            const j = await r.json();
            if (alive) setPending(j && j.pending ? j.pending : null);
          } catch (e) { /* 路由还没起来时安静跳过 */ }
        };
        tick();
        const t = setInterval(tick, 800);
        return () => { alive = false; clearInterval(t); };
      }, []);
      return [pending, setPending];
    }

    function answer(id, token, action) {
      return fetch(ANSWER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, token, action }),
      }).catch(() => {});
    }

    /* 第三个键的图标 =「表」（手表）—— 圆圈 + 两根指针。
       用户 2026-10-01：他原来写汉字「表」，因为不会画；
       「〇」是他给的退路，但圆圈的**指针才带意思**（等一下）。 */
    function ClockIcon() {
      return h('svg', {
        width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true,
        style: { display: 'block' },
      }, [
        h('circle', { key: 'c', cx: 12, cy: 12, r: 9, fill: 'none', stroke: '#FFFFFF', strokeWidth: 2 }),
        h('path', { key: 'h', d: 'M12 7v5', fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { key: 'm', d: 'M12 12l3.4 1.9', fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, strokeLinecap: 'round' }),
      ]);
    }

    /* 配色 —— 用户 2026-10-01 给定，照他的草图（不是我自己挑的）：
         名称        #4D6BFE
         确认键      未浮 #7AAAFF / 浮上 #4176E6
         拒绝键      未浮 #AEAEAE / 浮上 #D1D1D1
         文字        白
         卡片背景    #2C2C2E
       注：这是一套**深色**配的值。亮色主题下卡片仍会是深色块——用户指定，暂不做双主题。 */
    function Btn(props) {
      const [hover, setHover] = useState(false);
      return h('button', {
        type: 'button',
        title: props.title,
        'aria-label': props.title,
        disabled: props.disabled,
        onClick: props.onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          width: 40, height: 40, borderRadius: '50%',
          border: 'none',
          background: hover ? props.hoverBg : props.bg,
          color: '#FFFFFF',
          cursor: props.disabled ? 'default' : 'pointer',
          fontSize: 16, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 120ms ease',
        },
      }, props.glyph);
    }

    function ApprovalCard() {
      const [pending, setPending] = usePending();
      const [busy, setBusy] = useState(false);
      // 入场动画：新请求出现时淡入 + 轻微上浮。
      // ⚠ 这两个钩子必须写在下面那句 `if (!pending) return null` **之前** ——
      //   写后面会违 React 的钩子规则（渲染次数不同、钩子数不同 → 崩）。
      const [shown, setShown] = useState(false);
      const pid = pending ? pending.id : null;
      useEffect(() => {
        if (!pid) return undefined;
        setShown(false);
        // 先让它以"未显示"的状态渲染一帧，再翻成"显示" —— 这样 transition 才有起点
        const t = setTimeout(() => setShown(true), 16);
        return () => clearTimeout(t);
      }, [pid]);
      if (!pending) return null;

      const act = (action) => () => {
        if (busy) return;
        setBusy(true);
        answer(pending.id, pending.token, action).then(() => {
          setPending(null);
          setBusy(false);
          // 用户 2026-10-01 问：「这个标是否在我做出选择后会重新计算」。
          // 会 —— waiting 是 Host 每次现算的。但**原来最多有 800ms 空白**：
          // setPending(null) 立刻抹掉卡片，而下一条要等下一次轮询才回来。
          // 所以这里点完立刻催一次，不干等那个间隔。
          //
          // 【2026-10-02 实测，探针记的原始时间戳】
          //   队里两条（002 在前、FR-FL 在后）：点掉显示的那条
          //   → POST 120461 → 这里催的 GET 120487（**晚 26ms**）
          //   → 120540 卡片换成下一条、角标从「＋1 条」变没。
          //   同轮轮询刻度是 800ms 一拍（前 119957、本该下一次 120757），
          //   **这次刷新不在刻度上** —— 确证走的是这条催，不是干等下个间隔。
          //   顺带测到：时钟连按 10 下，两张卡片来回翻，角标每次都跟对；
          //   waiting = pendingQueue.length - 1，总数不变时它本来就不该变。
          fetch(STATE_URL, { headers: { accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j) setPending(j && j.pending ? j.pending : null); })
            .catch(() => { /* 催不动就等下一次轮询，不影响正确性 */ });
        });
      };

      return h('div', {
        role: 'group',
        'aria-label': '跨会话呼叫申请',
        style: {
          // 位置靠槽给，但**左右方向要自己表态**。
          //
          // 走过的弯路（2026-10-01）：
          //   ① conversation.input.dock —— 流式、撑满宽、挤开内容（不是"浮"）
          //   ② shell.overlay + position:fixed right:20
          //      → 相对【视口】定位，视口比内容栏宽（旁边有侧栏/留白），
          //        卡片跑到文字右缘外面。用户：「太靠右了」。
          //   ③ conversation.input.overlay，但我一个定位属性都没写
          //      → 槽默认把条目摆在**左**边。用户：「靠得很齐，方向估计反了」。
          //      **边界是对的（=输入框边界），方向是我没表态。**
          //   ④ 加 marginLeft:'auto'。撑满宽的容器里它=推到最右；
          //      但在 conversation.input.dock 里**没推成功**（用户：「X轴又错了」）。
          //   ⑤ 现在：加 alignSelf:'flex-end'，marginLeft 留着当保险。
          //
          //   为什么是 alignSelf —— 两个症状合起来就指向它：
          //     · input.overlay：X 对、Y 在矩形里
          //     · input.dock   ：**Y 对、X 靠左**
          //   后者说明这个槽是**竖排弹性容器**：我的卡片是列里的一条，
          //   纵轴（前后顺序）它管得对，横轴按默认 flex-start 靠了左。
          //   弹性容器里让**单条目**贴横轴末尾的写法就是 align-self:flex-end。
          //   （margin-left:auto 要容器有剩余空间才推得动，收缩布局里推不动——这就是它失败的原因。）
          //
          // 【教训】"交给槽"要交**几何**，别把**方向**也一起交掉；
          //        而一旦两轴分别由不同槽/属性负责，**症状的二轴组合就是诊断**。
          //
          // ⑥ 2026-10-01 用 CDP 读了真实 DOM（--remote-debugging-port=9222）才定案：
          //    · 那个 dock 的容器是 display:contents → 卡片成了 composerStack 的**直接弹性条目**
          //    · composerStack 宽 1420、dir=column、ai=stretch
          //      → alignSelf:'flex-end' 把卡片推到 **281+1420=1701**
          //    · 但**输入框卡片只有 maxWidth=947.9 且居中**（x=517）
          //      → 输入框右边缘 = **1465**，比容器右边缘少 236
          //    所以"X 错"不是没贴右，是**贴到了外层的右边**，越过了输入框的右边。
          //    输入框卡片每边的留白 = (容器宽 − --dsh-composer-card-max-width) / 2
          //    —— 这个变量是现成的，所以不用写死 236。
          //
          // ⑦ 2026-10-01 用户："并不浮于文字上方，依然挤占正文位置。"
          //    原因：input.dock 是【流式】槽（"entries above the composer card"），
          //    它作为弹性条目**占位**，所以把正文顶上去了。
          //
          //    改成绝对定位。**定位祖先是谁，是读出来的，不是猜的**（CDP）：
          //      composerStack  pos=static    ← 不是
          //      composerSeat   pos=sticky    ← 是它，w=1420 h=128 top=854，且 ovf=visible
          //    sticky 也算定位上下文，而且它 overflow 是 visible，
          //    所以往上伸出去的卡片不会被裁掉。
          //
          //    bottom:100%  → 卡片底边落在 composerSeat 的顶边（就是输入框上方）
          //    right: 那个  → 百分比对 composerSeat(1420) 解析 = 236，右边缘仍落在 1465
          //    absolute     → **不在流里，所以不再占位、不再顶正文**
          //
          // ⑧ 2026-10-01 用户："它现在是紧贴着聊天框的，我觉得有一点点距离会更好"
          //    → bottom 从 100% 改成 calc(100% + 8px)，留 8px 缝。
          //    实测（CDP）：card.bottom=846  composer.top=854  →  缝=8px ✓
          //
          // ⑨ 用户："把圆角改成和聊天框差不多"
          //    → **聊天框的圆角是读出来的，不是估的**：computed border-radius = 28px（四角一致）
          //    → 卡片从 14px 改成 28px，和聊天框数值一致。
          //    （注意：卡片比聊天框小得多，28px 在它身上会显得更圆。用户要的是"数值一样"。）
          //
          // ⑩ 2026-10-01 用户："往左一点，与文本区对齐吧"
          //    文本区和输入框**不是同一条边**：输入框卡片有左右各 16px 内边距，文字在它里面。
          //    实测（CDP）：宽度 300~1100 的元素里，右边缘的分布是
          //        {1449: 29, 1450: 3, 1465: 1, ...}
          //    —— 1449 出现 29 次，那就是消息文字的右边缘；1465 是输入框卡片自己。
          //    所以 right 再加 16px，把卡片右边缘从 1465 挪到 1449。
          //    实测结果：卡片右边缘 = 1449 = 文本区 ✓
          //
          //    （那个 16px 是写字面量的。本来想用 --dsh-chat-content-width 推，
          //      但它挂在更下层，documentElement 上读不到，不硬凑。）
          // ⑪ 用户："改成文本框内 8px 我看看，这样太靠里了" → +8px（1457）
          // ⑫ 用户："还是有点，改成内 4px" → +4px：右边缘 = 1465 − 4 = 1461
          //    三档留给以后：+16 → 1449（与正文文字齐）/ +8 → 1457 / +4 → 1461 / +0 → 1465（与输入框齐）
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          right: 'calc((100% - var(--dsh-composer-card-max-width, 100%)) / 2 + 4px)',
          width: 340,
          maxWidth: '100%',
          boxSizing: 'border-box',
          background: '#2C2C2E',
          border: '1px solid rgba(255,255,255,0.08)',
          // 用户 2026-10-01 定稿：左右 14 -> 18px（在活卡片上试过 21/16/18，定 18）
          // ⑩ 用户 2026-10-01：加个像「推理强度滑块」那种小动画 —— 请求出现时淡入上浮。
          //    用 transition + 两帧状态翻转做，**不需要 <style> 标签**（插件里那东西不好放）。
          //    缓动取 cubic-bezier(0.22,1,0.36,1)：起步快、收尾极缓，是"液态"的手感。
          opacity: shown ? 1 : 0,
          transform: shown ? 'none' : 'translateY(10px) scale(0.98)',
          transition: 'opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          borderRadius: 28, padding: '12px 18px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        },
      }, [
        h('div', {
          key: 'head',
          // 名字蓝、**中间的 "To" 白**（用户 2026-10-01 要求）。
          // 原来整行一个 #4D6BFE，所以 To 也是蓝的；拆成三个 span 才能分色。
          // 用户 2026-10-01 定稿：标题下方 10px、行高 1.5
          // 排成 flex：这样角标能用 marginLeft:auto 推到**行尾**，
          // 右边缘正好落在卡片内容边界上（= 卡片的 18px 内边距），
          // 也就是用户说的「标题对右侧边框的那个间隔」。
          style: {
            fontSize: 14, fontWeight: 600, marginBottom: 10, lineHeight: 1.5,
            display: 'flex', alignItems: 'baseline',
          },
        }, [
          h('span', { key: 'f', style: { color: '#4D6BFE' } }, pending.from),
          h('span', { key: 't', style: { color: '#FFFFFF' } }, ' to '),
          // 名字蓝；**结尾那个「：」也要白**（用户 2026-10-01 要求）。
          // 原来冒号跟名字挤在同一个 span 里，所以它跟着蓝了 —— 拆开才能分色。
          h('span', { key: 'g', style: { color: '#4D6BFE' } }, pending.to),
          h('span', { key: 'c', style: { color: '#FFFFFF' } }, '：'),
          // 【a 方案】排队数 —— 用户 2026-10-01：「跟标题一排就好」。
          // 所以它是**行内元素**（不是绝对定位贴角），靠 marginLeft:auto 推到行尾。
          // 因为标题是 flex，它的右边缘正好落在卡片内容边界 = 18px 内边距，
          // 跟标题离右边框的距离是同一个值。
          // 纯提示，故意不做成按钮（b 方案被否的理由就是"看得见够不着"）。
          (pending.waiting > 0)
            ? h('span', {
                key: 'w',
                title: '后面还排着 ' + pending.waiting + ' 条；按时钟可以让它们浮上来',
                style: {
                  marginLeft: 'auto', paddingLeft: 8,
                  fontSize: 12, fontWeight: 400,
                  color: 'rgba(255,255,255,0.45)',
                  whiteSpace: 'nowrap',
                },
              }, '＋' + pending.waiting + ' 条')
            : null,
        ]),
        h('div', {
          key: 'body',
          // 用户 2026-10-01：「信息过多会堆砌高度，有好几次高度直接堆出屏幕外了」
          // → 给正文一个高度上限 + 滚动条；卡片整体就再也不会顶出屏幕。
          //    上限用 vh 而不是 px：窗口越小，卡得越紧。
          //    限在【正文】上而不是整个卡片上 —— 抬头和三个按钮必须一直看得见。
          //
          // 40vh 实测 393px（40 行消息卡在 393，卡片总高 495），用户说「再短一点」→ 26vh。
          // 26vh 在 982 高的窗口上 ≈ 255px，卡片总高 ≈ 357px。
          style: {
            fontSize: 14, color: '#FFFFFF',
            lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: '12vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',   // 在卡片里滚，别把页面一起带着滚
          },
        }, pending.message),
        h('div', {
          key: 'acts',
          style: { display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 },
        }, [
          h(Btn, { key: 'later', glyph: h(ClockIcon), title: '等我一下（先挂着，不批也不毙）',
            bg: '#AEAEAE', hoverBg: '#D1D1D1', disabled: busy, onClick: act('later') }),
          h(Btn, { key: 'deny', glyph: '✕', title: '拒绝这次呼叫',
            bg: '#AEAEAE', hoverBg: '#D1D1D1', disabled: busy, onClick: act('deny') }),
          h(Btn, { key: 'allow', glyph: '✓', title: '允许这次呼叫',
            bg: '#7AAAFF', hoverBg: '#4176E6', disabled: busy, onClick: act('allow') }),
        ]),
      ]);
    }

    /* ── 会话里的那一行：RE-MK To FR-FL：<内容>  + 状态标记 ──
       契约来自 tool.call.toolview 的 catalog（key 域 open，写工具名即可，拼错就不渲染）：
         未结算：block.argsRaw
         已结算：block.call.argsRaw / block.content / block.error / block.isError
       读法照抄 dsh-client-ui-skill 的 skillRowModel，不是猜的。 */
    function argsOf(block) {
      const settled = 'kind' in block;
      const raw = (settled ? (block.call && block.call.argsRaw) : block.argsRaw) || '';
      let target = '', message = '';
      try {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          if (typeof p.target === 'string') target = p.target;
          if (typeof p.message === 'string') message = p.message;
        }
      } catch (e) { /* 参数还在流 */ }
      return { settled: settled, target: target, message: message };
    }

    function outputOf(block) {
      if (!('kind' in block)) return '';
      const parts = [];
      for (const item of (block.content || [])) {
        parts.push(item && item.type === 'text' ? item.text : JSON.stringify(item, null, 2));
      }
      if (parts.length === 0 && block.error !== undefined) parts.push(block.error.name + ': ' + block.error.code);
      return parts.join('\n');
    }

    /** 状态：✓ 通过 / ✕ 拒绝 / # 等待 —— 从 Host 回执里认（回执带了「谁 → 谁：」）。 */
    function statusOf(block) {
      if (!('kind' in block)) return { mark: '#', label: '等你答复', color: 'var(--dsw-alias-state-warn-primary)' };
      const out = outputOf(block);
      if (block.isError || block.error !== undefined || /拒绝|没答复|没批准/.test(out)) {
        return { mark: '✕', label: '被拒绝', color: 'var(--dsw-alias-state-error-primary)' };
      }
      if (/稍等|挂着/.test(out)) return { mark: '#', label: '等你答复', color: 'var(--dsw-alias-state-warn-primary)' };
      if (/已送达/.test(out)) return { mark: '✓', label: '已送达', color: 'var(--dsw-alias-state-success-primary)' };
      return { mark: '·', label: '', color: 'var(--dsw-alias-label-secondary)' };
    }

    /** 回执开头的「谁 → 谁：」 */
    function namesOf(block) {
      const m = /^\s*(\S+)\s*→\s*(\S+?)\s*：/.exec(outputOf(block) || '');
      return m ? { from: m[1], to: m[2] } : null;
    }

    function CallAgentRow(props) {
      const block = props.block;
      const a = argsOf(block);
      const st = statusOf(block);
      const nm = namesOf(block);
      const from = nm ? nm.from : '（我）';
      const to = nm ? nm.to : (a.target || '?');

      return h('div', {
        style: {
          margin: '6px 0', padding: '10px 12px', borderRadius: 12,
          background: '#2C2C2E',
          border: '1px solid rgba(255,255,255,0.08)',
        },
      }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
        }, [
          // 名字蓝、**中间的 "To" 白**（用户 2026-10-01 要求）。会话里这一行同理。
          h('span', {
            key: 'n',
            style: { fontSize: 14, fontWeight: 600 },
          }, [
            h('span', { key: 'f', style: { color: '#4D6BFE' } }, from),
            h('span', { key: 't', style: { color: '#FFFFFF' } }, ' to '),
            h('span', { key: 'g', style: { color: '#4D6BFE' } }, to),
            h('span', { key: 'c', style: { color: '#FFFFFF' } }, '：'),
          ]),
          h('span', { key: 's', title: st.label, style: { fontSize: 13, color: st.color } }, st.mark),
        ]),
        h('div', {
          key: 'body',
          style: {
            fontSize: 14, color: '#FFFFFF',
            lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          },
        }, a.message || '（内容还没流出来…）'),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 卡片挂 conversation.input.dock —— "Full-width entries **above the
        // composer card**"。**Y 就是"输入框矩形上方"，正是用户要的那一层。**
        //
        // 第四次换位置了，每次错在哪都记一下：
        //   ① conversation.input.dock（不带任何样式）→ 整宽流式，撑开
        //   ② shell.overlay + position:fixed right:20 → 参照系是【视口】，跑到文字外
        //   ③ conversation.input.overlay → X 对了（右边界=输入框右边界），
        //      但那个槽是 "rendered **inside** the resident composer card" ——
        //      Y 卡在矩形【内】右上角。用户原话：「顶在矩形内右上角」。
        //   ④ 现在：回到 dock（Y 对），保留 width:340 + marginLeft:'auto'（X 对）。
        //      这个槽是竖排列表（现有 todo/goal/queue 都整宽），
        //      所以定宽块 + margin-left:auto 照样推到右边。
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'agent-ping-approval',
          order: 70,
          label: '跨会话 @',
        }, ApprovalCard));

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'call_agent',
        }, CallAgentRow));
      },
    };
  },
});
