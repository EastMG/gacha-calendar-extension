# 二游日历 · 浏览器扩展

**28 款**二次元手游的**当期卡池与活动起止**一览，点浏览器工具栏图标即可查看。

> 米哈游（原神 / 星穹铁道 / 绝区零 / 崩坏3）、库洛（鸣潮）、鹰角（明日方舟 / 终末地）、
> 悠星（蔚蓝档案国服·国际服·日服 / 星塔旅人）、万代（学园偶像大师 等）、
> BanG Dream 系列、赛马娘（国服·日服·国际服）、少女前线2、Fate/Grand Order、
> 初音未来：缤纷舞台、物华弥新、战双帕弥什、重返未来：1999、异环 等共 28 款。

抓取逻辑来自独立包 **[`gacha-calendar-core`](https://www.npmjs.com/package/gacha-calendar-core)**
与 [DSH 桌面端插件](https://github.com/EastMG/dsh-gacha-calendar) 共用同一份核心。

> **当前内联的核心版本：`gacha-calendar-core@0.11.1`**（构建时会打印实际版本，设置页也能看到）。
> 升级核心只需改 `package.json` 的依赖版本并重新 `node build.mjs`；
> **但 core 扩表常带来新域名**，务必跑一次 `npm run verify:domains`（提交钩子也会自动跑）。
> 注意：核心仓库的版本可能领先于 npm（未发布的修复拿不到），跟随 npm 上的最新版即可。

---

## 安装（加载已解压的扩展程序）

1. 构建：`node build.mjs`（或直接下载 Release 里的 `.zip` 解压）
2. 打开 `edge://extensions` 或 `chrome://extensions`
3. 打开右下角/右上角的 **开发人员模式**
4. 点 **加载解压缩的扩展**，选择本项目的 `dist/` 目录（或Release `.zip` 解压后的目录）
5. 点工具栏的「二游日历」图标 → 首次打开会自动抓一轮

## 使用

- **卡池 / 活动**：外显角色名与活动名；**鼠标悬停**可看完整池名、UP 角色与时间原文
- **起止**：显示"还剩 X 天 X 小时 X 分钟"的倒计时
- **右上角按钮**：刷新 / 打开设置页
- **设置页**：展示开关、条目排序与删除、卡池与活动来源各自切换（含自定义地址）、
  刷新频率、**解析器自检**

### 设置页的能力边界

- **出厂默认隐藏**：28 款里有 5 款（崩坏3 / BanG Dream！OurNotes 日服·国际服 / 卡厄斯梦境 /
  嘟嘟脸恶作剧）**出厂不勾选**。这是 core 的设计，避免首次打开就铺满 28 行。
  在设置页勾上即会写入 `shown` 键并开始抓取（实现见 `src/visibility.js`）。
- **自定义来源地址**：可在每条目内联填写，但**必须落在扩展已声明的主机列表内**
  （浏览器扩展的 `host_permissions` 是构建期静态声明的，运行期无法添加）。
  输入框自带候选主机提示；超范围填写不会被抓取，且无错误提示。
- **不提供新增"自定义条目"**：原因同上——自定义条目几乎必然指向未声明域名，
  做出来只会"填了却抓不到"。
- **删除条目**：内置条目记入 `removed`，可在「已删除的条目」区单独或一次性恢复。
- **「未配置」条目**：有几款（崩坏3、OurNotes 日服·国际服、卡厄斯梦境）出厂**不抓取**——
  它们只挂了备选源、没有默认地址。这些条目在来源下拉里显示**「未配置」**（与 core 同一口径），
  在设置页选一个备选源即可启用。它们同时也是出厂默认隐藏项。

## 构建

```bash
npm install          # 安装 gacha-calendar-core 与 esbuild
node make-icons.mjs  # 生成图标（仅首次或想改图标时）
node build.mjs       # 产出 dist/
node build.mjs --zip # 额外打出 release/*.zip（用于提交商店）
```

> 若 `npm install` 因环境限制跑不动（例如受限沙箱里 npm 无法 spawn 子进程），
> 可退化为手工解包：
> `npm pack gacha-calendar-core @esbuild/win32-x64` 然后 `tar -xzf` 到 `node_modules/` 对应目录。
> `build.mjs` 会直接定位平台预编译二进制，不强依赖 npm 的 `.bin` 垫片。

> **提交前先跑 `node verify.mjs && node verify-live.mjs`。** 仓库带了
> `.githooks/pre-commit`（BOM 检查 + 构建 + 静态校验），启用方式：
> `git config core.hooksPath .githooks`。单次跳过用 `DSH_SKIP_VERIFY=1 git commit ...`。
>
> Windows 上若 `git push` 报 `error setting certificate verify locations`，是 CA 路径没配：
> `git config http.sslCAInfo "D:/Program Files/Git/mingw64/ssl/certs/ca-bundle.crt"`（按本机实际路径改）。

### 为什么必须构建

MV3 **禁止远程代码**（不能从 CDN 取代码），所以 `gacha-calendar-core` 必须内联进扩展自己的 js。
`build.mjs` 用 esbuild 把依赖树打成 `dist/popup.js` 与 `dist/options.js`。
构建产物带内容哈希便于核对；`background.js` 不依赖 core，原样复制以保持可读可审。

### 目录

```
manifest.json          MV3 清单（权限最小化：只申请 storage + 精确域名）
src/background.js      service worker：白名单代发跨域请求（唯一的"代理"）
src/transport.js       core 需要的 transport：直连 + 经 background 代发
src/storage.js         core 需要的 storage：chrome.storage.local 封装
src/view-helpers.js    展示层纯函数（倒计时/角色名精简/悬停文案/行渲染模型）
src/popup.*            面板
src/options.*          设置页
src/verify-boot.js     启动自检（仅 `--verify` 构建时打进 background.js，正常构建不含）
tools/verify-chromium.mjs  Chromium 运行时验证（需在普通桌面环境跑）
tools/check-domains.mjs    来源域名守卫（已并入 verify.mjs，每次提交自动跑）
tools/test-domain-guard.mjs   域名守卫自测
tools/test-entry-meta.mjs     来源显示名口径自测
tools/test-options.mjs        设置页行为自测（DOM shim）
tools/make-popup-shot.mjs     生成面板截图夹具（真抓一轮 + chrome 桩）
tools/serve-shot.mjs          临时静态服务（给截图夹具用；Playwright 禁 file://）
tools/verify-zip.mjs          release zip 自校验（自己解压 + 核 CRC32）
build.mjs              构建（内联 core + 校验清单 + 打包 zip）
verify.mjs             静态校验
verify-live.mjs        端到端校验（真网络抓 28 款 + 渲染模型）
make-icons.mjs         生成图标（Node 内置 zlib 手写 PNG，字节可复现）
.githooks/pre-commit   提交守卫：BOM 检查 + build + verify
```

## 设计要点（改动前请先读）

### 1. core 的 transport 契约（**最容易踩的坑**）

```js
transport = {
  // 直连：CORS 放行的源 → 返回 WHATWG Response（core 自己看 ok/status/text()/json()）
  fetchRaw(url, opts),
  // 代发：没有 ACAO 的源 → 返回**目标站原始 body 字符串**（不是 { status, body } 对象！）
  fetchViaProxy(url, { referer, headers, body })
}
```

`fetchViaProxy` 返回错形状**不会报契约错误**，只会让每一款游戏都静默变成"抓取异常"，
非常难定位。（开发过程中就踩过一次：返回了 `{status, contentType, body}` → 几乎全部条目都报「抓取异常」。）

### 2. 为什么必须经 background 代发

实测 22 个主来源域名里，只有 **4 个**回 `access-control-allow-origin`
（`aki-gm-resources-back.aki-game.com`、`api-takumi-static.mihoyo.com`、
`api-web.bluearchive.jp`、`sekai-world.github.io`）；其余 **18 个**
（Bwiki / canmoe / fz.wiki / 万美 / 蔚蓝国服 / Nexon / GameKee / 赛马娘 / FGO / p5x /
少前2 / 1999 / 崩坏3 等）**没有 ACAO**，浏览器在页面上下文里会直接拦掉。
而 service worker 凭 `host_permissions` 可以真正跨域，并能自行设置 `Referer` / `Origin`。

> 这条数字随 core 换来源而变，所以别照抄旧值。复测方法：对每个主来源域名发一次请求，
> 看响应有没有 `access-control-allow-origin`。core 抓取域名共 **43** 个
> （另有 6 个仅用于 `<img>` 图标），完整清单见 `manifest.host_permissions`。

### 3. 安全红线与来源域名守卫

- `src/background.js` 的 `ALLOW_HOSTS` **必须保留**：没有它就是"任意内网地址请求器"（SSRF）
- 消息来源做校验（只接受本扩展自己的页面），否则任何网页都能驱使扩展发请求
- `manifest.host_permissions` 不申请 `<all_urls>`：既是商店审核要求，也让权限提示可接受

**来源域名守卫**（`tools/check-domains.mjs`，已并入 `verify.mjs`，因此**每次提交都会跑**）：
它把 core 实际抓取的每个域名，与 `manifest.host_permissions` 和 `background` 白名单逐一对齐。

为什么这条最重要：**core 一换来源，扩展就必须同步申请权限，否则那个来源在浏览器里
完全抓不到** —— 不报错、不提示，只是那一行没数据，肉眼极难定位。真实发生过两次：

| 漏配域名 | 后果 |
|---|---|
| `ak.hypergryph.com`、`zzz.mihoyo.com` | 方舟 / 绝区零部分来源失效 |
| `notice.sl916.com`、`www.sl916.com` | **重返未来 1999 完全抓不到**（core 换成了官方游戏内公告接口） |

守卫还会**反向报告**"已申请但 core 当前不再使用"的域名，方便精简权限面
（对上架审核友好）。单独运行：

```bash
npm run verify:domains     # 只看域名覆盖
npm run test:domains       # 测守卫自身：该失败时失败、该通过时通过
```

### 测试

```bash
npm test                   # 跑下面三个自测
npm run test:domains       # 域名守卫的通过与拒绝路径（在沙箱副本里用"冒牌 core"）
npm run test:meta          # 来源显示名口径（标签 / 域名兜底 / 未配置 / 容错）
npm run test:options       # 设置页行为（用极简 DOM shim 在 Node 里跑真实 src/options.js）
```

`test:meta` 锁住 `defaultSourceName` 与 core 的 `getDefaultSourceName` **逐支同口径**：
有标签用标签 → 无标签有地址退到域名（去 `www.`）→ 都没有则显示**裸「未配置」**。
这三支里第 2、3 支都曾写错（第 2 支缺失、第 3 支误写成「默认来源」），
而「未配置」正好覆盖那几款出厂不抓取的条目，是设置页上最容易看出问题的位置。

`test:options` 覆盖：条目渲染、**来源下拉文案**、切「自定义…」后出现内联输入框、地址落盘、
删除条目、单独恢复、批量删除 + 全部恢复、**出厂默认隐藏的三态**。之所以用 DOM shim 而不是浏览器：
本机的浏览器自动化取证一直不稳定（CDP 求值不通、扩展页 dump 受限），
而设置页逻辑用假 DOM 驱动更确定，也能直接断言"点了删除之后 storage 里究竟写了什么"。

副本会**整份复制 `src/*.js`**（再覆盖 transport / core-version 两个需伪造的），
所以新增模块不会再让测试报 `ERR_MODULE_NOT_FOUND`。

### 4. `Referer` 的已知限制

`fetch` 的 `Referer` 在部分浏览器实现中是禁止由脚本设置的。本扩展在 service worker 里尝试设置
（比页面上下文权限更高），但**不能保证一定生效**。若某个源因校验来源而拒绝，core 会把它记为
`down` 并沿用上次成功数据、在面板上标出 —— 不会静默显示错误内容。

## 验证状态（诚实说明）

| 验证 | 结果 |
|---|---|
| 静态校验（manifest 合法性、零远程代码、权限最小化、来源域名覆盖、图标、版本一致） | **通过（含 core 运行时条目数校验）** |
| 设置页行为自测（渲染 / 内联自定义地址 / 删除 / 单独恢复 / 全部恢复 / **defaultHidden 三态**） | **通过** |
| 域名守卫自测（该失败时失败、该通过时通过） | **4/4 通过** |
| 端到端：真网络抓 **28 款**（与扩展同一份 transport 契约、同一份 core） | **通过（卡池 22/28、活动 22/28）** |
| 端到端：渲染模型（与 popup 同一份纯函数）逐项断言 | **通过** |
| **真实 Chromium：渲染构建产物（面板）** | **✅ 已取证**（见 `assets/popup.png`，当前版本，含 23 行可见条目与真实抓取结果） |
| **真实 Chromium：加载扩展本体并实抓落库** | ⚠️ 未在本机取证，请在普通桌面环境跑 `node tools/verify-chromium.mjs` |

### 已取证的部分：面板渲染

`assets/popup.png` 是用**真实浏览器**渲染 `dist/` 的构建产物（`popup.js` + `popup.css`）得到的，
数据是**真网络抓的一轮结果**（`成功 21/23`）。图里可以看到：

- 面板标题「二游日历」、刷新按钮、设置按钮
- 状态栏「数据：联网数据 · 成功 21/23」与抓取结论行
- 游戏行：原神、崩坏：星穹铁道、绝区零、鸣潮……，每行为「卡池 / 起止 / 活动 / 起止」四段结构
- 页脚「更新：…」与「悬停查看池名与时间明细」

复现方式：`node tools/make-popup-shot.mjs` 生成离线夹具（Node 真抓一轮拿缓存 → 灌进 chrome 桩），
再用 `node tools/serve-shot.mjs` 起临时静态服务、浏览器打开 `_shot/popup.html` 截图。
之所以这么绕：真实扩展里截图要靠 CDP，而 CDP 在本机不通（见下），
且 Playwright 禁止 `file://`。夹具渲染的是**同一份构建产物**，只是数据来自离线种子。

> 历史截图留在 `assets/popup-old-11games.png`（11 款时期、旧名「二游排期」），仅作对照，勿再引用。

同一轮验证里还确认了：`/json/list` 中扩展的 popup 页面标题就是扩展名，
且扩展的 service worker 在 `chrome.storage` 下创建了自己的存储目录（即 worker 确实执行了）。

### 尚未取证的部分及原因

**"实抓结果写进浏览器 storage"这一步未能在本机截到**，两个具体原因：

1. `--virtual-time-budget` 会**快进虚拟时间**，而 headless 截图在 load 事件即触发，
   **不等真实网络** → 截图里数据列仍是占位符 `—`
2. service worker 写 `chrome.storage` 后，Edge 的 LevelDB 在进程退出前未把内容刷到可读的
   `.log/.ldb` 里（运行中轮询文件数始终不变），所以从 profile 里读不到报告

**这两条是实现细节，不代表功能有问题**：数据侧的正确性已由 `verify-live.mjs` 覆盖
（真网络抓 28 款、render 模型与 popup 同一份纯函数、逐字段断言通过）。

### 环境侧的一个真实约束（记录以免重复踩）

在有**文件沙箱**的环境里，Chromium 系浏览器**根本无法执行扩展代码**：

- 浏览器日志持续报 `Failed to grant sandbox access to ... 拒绝访问 (0x5)`
- 用 3 个文件的"最小扩展"（零依赖、零打包）做对照，service worker 连一行 `console.log` 都没有
- headless 模式直接崩溃（`crash server failed to launch, self-terminating`）
- Node 内置 WebSocket 与 DevTools 协议层不通（能握手、命令零响应）

**解除文件沙箱限制后立刻恢复**：同一套脚本下，Edge 成功加载扩展、popup 页面正常打开、
service worker 正常执行并创建存储目录。所以在受限环境里跑验证脚本前，先确认浏览器能正常启动。

### 人工确认清单（30 秒）

在 `edge://extensions` 加载 `dist/` 后：

- [ ] 工具栏出现「二游日历」图标，点击能弹出面板
- [ ] 面板显示条目行（默认 **23 行**：28 款减去 5 款出厂默认隐藏）
- [ ] 顶部显示「数据：联网数据 · 成功 N/28」（首次打开会自动抓一轮，约 5～15 秒）
- [ ] 卡池列显示角色名（如原神「菲林斯、伊涅芙」），**悬停**能看到池名与时间
- [ ] 起止列显示「还剩 X 天 X 小时 X 分钟」倒计时
- [ ] 点右上角齿轮能打开设置页；设置页「开始自检」能跑出报告
- [ ] 切换某项的「展示」后，回到面板该行消失

## 上架商店前的待办

- [ ] 截图：`assets/` 下需放 1280×800 或 640×400 的商店截图（本仓库尚未提供）
- [ ] 隐私说明：本扩展**不收集任何个人数据**；所有请求由用户浏览器直接发往来源站。
      商店要求一个可公开访问的隐私政策 URL（可用仓库内的 `PRIVACY.md` 配合 GitHub Pages）
- [ ] 主渠道建议 **Edge 加载项商店**（中国大陆可访问；Chrome 网上应用店不可直连），
      配 ZIP/CRX 手动加载兜底
- [ ] 版本号规则：`manifest.json` 与 `package.json` 必须一致（`build.mjs` 会强制校验）

## 许可

MIT
