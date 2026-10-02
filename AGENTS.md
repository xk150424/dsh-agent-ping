# 给 agent 看的仓库说明

这个仓库是 **dsh-agent-ping**，一个 DeepSeek Harness（DSH）插件。你如果是被叫来改它的，先读这一页；深层的坑在 [`HANDOVER.md`](HANDOVER.md)。

## 一句话

跨会话 **@**：一个会话经用户当场授权后，把消息送进另一个会话；**对方睡着就先唤醒再送**。

## 仓库结构

```
.
├─ index.js            Host 半：两个工具（call_agent / who_can_i_call）、两条路由、待批队列、唤醒
├─ client.js           Client 半：授权卡片、入场动画、角标、会话内回执。**已构建产物**形态
├─ cordis.patch.yml    往 profile 里插一行；name 必须等于包名
├─ package.json        包声明；dsh 字段声明 bundle 与 client
├─ locale/{en,zh}.json 显示标题与描述（Plugin Manager / 市场读它，不激活插件就能读）
├─ icon.svg            图标，≤256 KiB，相对路径
├─ README.md           中文说明（主）
├─ README.en.md        英文说明
├─ HANDOVER.md         交接资料：三条命脉、七个坑、测试方法
└─ .github/workflows/ci.yml   零 secret 的检查型 CI
```

**零构建。** 源文件就是运行时文件，没有 `src/` → `lib/` 这一步，没有 `build` 脚本，没有运行时依赖。

## 三条不能破的约定

1. **包名要出现在三个地方，且必须完全相同**：`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`client.js` 里 `__ModuleLoader__.load({ id })` 的 `id`。CI 会检查这一条。
2. **`exports` 必须含 `"./package.json"`**。缺了它，前端那半**静默不加载**——没有报错，卡片就是不出现。
3. **行尾一律 LF**。`.gitattributes` 里钉死了 `* text=auto eol=lf`；本机 Git for Windows 的系统配置是 `core.autocrlf=true`，不覆盖它，一次检出就会把文件悄悄改成 CRLF。

## 改完什么时候生效

| 改了什么 | 怎么生效 |
|---|---|
| `client.js` | 刷新页面即可（**不用重启**） |
| `index.js` / `package.json` / `cordis.patch.yml` | **必须重启 DSH** |
| 替换一个已安装的旧版本 | **必须重启**（要加载新的 JS 模块版本） |

**「新文案出现了」不能证明发生了重启**——去看活会话名单：重启会顺手干掉无关的活会话，热重载不会。

## 常用命令

```sh
node --check index.js && node --check client.js     # 语法
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

## 不要做的事

- 不要为了让测试通过而放宽 `ci.yml` 里的断言——那几条恰恰都是**踩过、而且踩的时候不报错**的坑。
- 不要在 `client.js` 里打包自己的 React：React 来自外壳冻结的模块表，`require('react')` 就够了。
- 不要在 `dsh.bundle.patch` 之外再手动注册一次 patch——会双重注册，路由重复，启动崩溃。
- **不要把令牌、密钥、本机绝对路径写进仓库**。
