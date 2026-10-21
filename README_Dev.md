# 二游日历 · 开发文档

> 面向开发与维护。用户向说明（功能、安装、数据来源）见 [README.md](README.md)。

## 构建

```bash
npm install            # 安装 gacha-calendar-core 与 esbuild
node make-icons.mjs    # 生成图标（仅首次或想改图标时；Node 内置 zlib 手写 PNG，字节可复现）
node build.mjs         # 产出 dist/
node build.mjs --zip   # 额外打出 release/*.zip（用于提交商店与 GitHub Release）
```

> 若 `npm install` 因环境限制跑不动（例如受限沙箱里 npm 无法 spawn 子进程），可退化为手工解包：
> `npm pack gacha-calendar-core @esbuild/win32-x64` 然后 `tar -xzf` 到 `node_modules/` 对应目录。
> `build.mjs` 会直接定位平台预编译二进制，不强依赖 npm 的 `.bin` 垫片。

### 为什么必须构建

MV3 **禁止远程代码**（不能从 CDN 取代码），所以 `gacha-calendar-core` 必须内联进扩展自己的 js。
`build.mjs` 用 esbuild 把依赖树打成 `dist/popup.js` 与 `dist/options.js`，构建产物带内容哈希便于核对；
`background.js` 不依赖 core，原样复制以保持可读可审。

### 升级抓取核心

```bash
# 1. 把 package.json 的 gacha-calendar-core 依赖改到目标版本并安装
# 2. 必须重新校验来源域名（core 扩表常带来新域名）
npm run verify:domains
# 3. 重建
node build.mjs --zip
```

> **当前内联的核心版本：`gacha-calendar-core@0.12.5`**（构建时会打印实际版本，设置页也能看到）。
> 注意：核心仓库的版本可能领先于 npm（未发布的修复拿不到），跟随 npm 上的最新版即可。

**这一步最容易出错**：`core` 一换来源，扩展就必须同步申请权限，否则那个来源在浏览器里
完全抓不到——不报错、不提示，只是那一行没数据，肉眼极难定位。真实发生过多次。

## 目录结构

```
manifest.json          MV3 清单（权限最小化：只申请 storage + 精确域名）
src/_locales/          i18n 消息（zh_CN / en）——**商店据此识别可用语言，不能删**
src/background.js      service worker：白名单代发跨域请求（唯一的"代理"）
src/transport.js       core 需要的 transport：直连 + 经 background 代发
src/storage.js         core 需要的 storage：chrome.storage.local 封装
src/view-helpers.js    展示层纯函数（倒计时/角色名精简/悬停文案/行渲染模型）
src/entry-meta.js      来源显示名口径（与 core 的 getDefaultSourceName 逐支对齐）
src/visibility.js      展示/隐藏判定与写回
src/popup.*            面板
src/options.*          设置页
src/panel.html         新日程面板（实验）的页面宿主
src/panel.js           新日程面板的挂载与数据装配（React root / 刷新 / 时钟）
src/schedule/          新日程面板：一比一移植自 DSH 插件的组件与样式
  schedule-view.js      组件本体（原样移植，见「设计要点 5」）
  schedule.css          从插件提取的 sched/slot 样式 + DSH 主题变量兜底
src/verify-boot.js     启动自检（仅 `--verify` 构建时打进 background.js，正常构建不含）
build.mjs              构建（内联 core + 校验清单 + 打包 zip）
verify.mjs             静态校验
verify-live.mjs        端到端校验（真网络抓 28 款 + 渲染模型）
make-icons.mjs         生成图标
tools/check-domains.mjs    来源域名守卫（已并入 verify.mjs，每次提交自动跑）
tools/check-listing.mjs    商店文案与素材的硬性限制校验
tools/edge-publish.mjs     自动发布到 Edge 加载项商店（官方 Update API v1.1）
tools/verify-zip.mjs       release zip 自校验（自己解压 + 核 CRC32；也可当模块调用）
tools/verify-chromium.mjs  Chromium 运行时验证（需在普通桌面环境跑）
tools/i18n.mjs             i18n 消息解析（校验 __MSG_ 能否解析成真实文案）
tools/probe-i18n.mjs       真实浏览器验证 i18n 已解析
tools/make-store-assets.mjs 生成离线渲染夹具 + 商店素材
tools/icon-art.mjs         图标绘制与 PNG 编码（扩展图标与商店徽标共用同一份）
tools/serve-shot.mjs       临时静态服务（给夹具截图用；Playwright 禁 file://）
tools/test-domain-guard.mjs  域名守卫自测
tools/test-entry-meta.mjs    来源显示名口径自测
tools/test-options.mjs       设置页行为自测（DOM shim）
store/                     上架资料：逐字段文案、素材、上架与发版手册
docs/                      GitHub Pages 站点（隐私政策 + 落地页）
.githooks/pre-commit       提交守卫：BOM 检查 + build + verify + 商店文案校验
```

提交前先跑 `node verify.mjs && node verify-live.mjs`。仓库带了 `.githooks/pre-commit`
（BOM 检查 + 构建 + 静态校验 + 商店文案校验），启用方式：`git config core.hooksPath .githooks`；
单次跳过用 `DSH_SKIP_VERIFY=1 git commit ...`。

## 设计要点（改动前请先读）

### 0. i18n：`_locales` 既是给浏览器用的，也是给商店用的

`manifest.json` 的 `name` / `description` 是 `__MSG_extensionName__` / `__MSG_extensionDescription__`
占位符，靠 `src/_locales/<locale>/messages.json` 解析，并显式声明 `"default_locale": "zh_CN"`。

**为什么不能省**：除了浏览器要靠它解析扩展名，**Edge 商店也只把包里 `_locales` 声明的语言
列为可用的商店一览语言**。最早没有 `_locales`（硬编码中文）时，Partner Center 只认出
`English (United States)`，于是只能把中文塞进 en-US 那一行；补上 i18n 后才显示
**Chinese (China) + English** 两行语言。

改动注意：

- 新增语言 → 加 `src/_locales/<locale>/messages.json`，然后**重传包**；语言列表不能手工加
- `build.mjs` 会把 `src/_locales/**` 复制到 `dist/_locales/**`。漏了这步，扩展名会直接
  显示成字面量 `__MSG_extensionName__`（`verify.mjs` 与 `tools/check-listing.mjs` 都会拦）
- 验证真实浏览器里确实解析成功：`node tools/probe-i18n.mjs`

### 1. core 的 transport 契约（**最容易踩的坑**）

```js
transport = {
  // 直连：CORS 放行的源 → 返回 WHATWG Response（core 自己看 ok/status/text()/json()）
  fetchRaw(url, opts),
  // 代发：没有 ACAO 的源 → 返回**目标站原始 body 字符串**（不是 { status, body } 对象！）
  fetchViaProxy(url, { referer, headers, body })
}
```

`fetchViaProxy` 返回错形状**不会报契约错误**，只会让每一款游戏都静默变成"抓取异常"，非常难定位。

### 2. 为什么必须经 background 代发

约**六成**的来源站在响应里**没有** `access-control-allow-origin`（如 Bwiki / canmoe / fz.wiki /
万美 / 蔚蓝国服 / Nexon / GameKee / 赛马娘 / FGO / p5x / 少前2 / 1999 / 崩坏3 等），
浏览器在页面上下文里会直接拦掉这类跨域请求；而 service worker 凭 `host_permissions`
可以真正跨域，并能自行设置 `Referer` / `Origin`。

> 具体比例随 core 换来源而变，**不要照抄数字**。复测方法：对每个主来源域名发一次请求，
> 看响应有没有 `access-control-allow-origin`。当前清单以 `npm run verify:domains` 的输出为准。

### 3. 安全红线与来源域名守卫

- `src/background.js` 的 `ALLOW_HOSTS` **必须保留**：没有它就是"任意内网地址请求器"（SSRF）
- 消息来源做校验（只接受本扩展自己的页面），否则任何网页都能驱使扩展发请求
- `manifest.host_permissions` 不申请 `<all_urls>`：既是商店审核要求，也让权限提示可接受

**来源域名守卫**（`tools/check-domains.mjs`，已并入 `verify.mjs`，每次提交都会跑）：
它把 core 实际抓取的每个域名，与 `manifest.host_permissions` 和 `background` 白名单逐一对齐，
并反向报告"已申请但 core 当前不再使用"的域名，便于精简权限面。

```bash
npm run verify:domains     # 只看域名覆盖
npm run test:domains       # 测守卫自身：该失败时失败、该通过时通过
```

> 图标域名（仅用于 `<img>`）与抓取域名分开统计：前者只要在 `host_permissions` 里，
> 不需要进代发白名单。**这张清单必须从 core 动态推导，不要写死**——core 换图标源会让
> 写死的名单过期，进而让校验器对不存在的问题报错（已踩过一次）。

### 4. `Referer` 的已知限制

`fetch` 的 `Referer` 在部分浏览器实现中是禁止由脚本设置的。本扩展在 service worker 里尝试设置
（比页面上下文权限更高），但**不能保证一定生效**。若某个源因校验来源而拒绝，core 会把它记为
`down` 并沿用上次成功数据、在面板上标出——不会静默显示错误内容。

### 5. 新日程面板：从 DSH 插件一比一移植（实验特性）

新日程面板**不是重写**，而是把插件的组件与样式**原样搬过来**，只在边界上做适配。

| 部分 | 来源 | 处理 |
|---|---|---|
| 组件本体 | 插件 `src/client/80-components.js` 第 66-98 行（GameIcon）、第 192-1082 行（日程常量 / 纯函数 / 留白卡 SlotCard / ScheduleView） | 原样移出到 `src/schedule/schedule-view.js`。该文件是 JSX 的**转译产物**（直接调 `react/jsx-runtime`），因此保留其原始代码，不改写渲染逻辑 |
| 样式 | 插件 `src/client/70-styles.js` 的 `STYLE` | 按选择器提取 sched / slot / marq / inner 相关规则到 `src/schedule/schedule.css`，**规则本身零改动** |
| 主题变量 | 插件依赖 DSH 宿主的 `--dsw-alias-*` | 扩展里没有宿主，故按 DSH 主题包的**真实取值**补齐兜底（浅色为默认，深色走 `prefers-color-scheme`） |
| 依赖 | `react`、`react/jsx-runtime` 由宿主注入 | 改为 npm 依赖，构建时以**生产版**内联（见下） |
| 其它纯函数 | `60-helpers.js` / `15-env.js` / `25-parser-shared.js` | `normalizeFail`/`cleanRoleNames`/`parseDisplayRange`/`sideFailText`/`buildRowTitle` 从 `view-helpers.js` 引入（同一份实现）；时区换算（`sourceOffsetMinutes`/`sourceWallParts`）与窗口格式化（`fmtWindow` 等）随组件一并补齐 |
| 数据装配 | 插件 `CalendarPanel` 的 `visible → games` 合并 | 在 `src/panel.js` 里按同样的字段拼装（banner / event / roles / datesRaw / hover / 失败状态），并补 `tz` 与主题色 |

**为什么是独立页面而不是 popup**：该视图设计宽 690px、高度随条目增长（23 行约 2500px），
远超浏览器 popup 的尺寸上限（约 800×600）。所以开启开关后，`background.js` 会把
`chrome.action` 的 popup 置空，改由 `onClicked` 打开 `panel.html` 标签页；关闭时恢复原 popup。

> ⚠️ **要改新面板，请先改上游插件再重新移植**，不要在 `schedule-view.js` 里直接改，
> 否则两边实现会漂移（该文件顶部有同样的提示）。

> 📌 React 必须按生产版打包：`build.mjs` 里传了 `--define:process.env.NODE_ENV="production"`。
> 漏了它，esbuild 会保留开发版分支，`panel.js` 会从 ~700KB 涨到 ~1.5MB 并带调试告警。

#### 扩展侧改版（不属于上游）

在移植版基础上，本扩展对面板做了两处**有意偏离上游**的版式改动，均以组件可选 prop 实现
（不传时行为与上游一致）：

| prop | 取值 | 作用 |
|---|---|---|
| `topMode` | `"recent"` / `"slot"` | 顶部区域**同一个位置**二选一：近期列表 / 留白卡。两个 DOM 都挂载，用 CSS `display:none` 隐藏未选中的那个 |
| `stacked` | `true` | 游戏表改为**每款游戏两行**（第一行卡池、第二行活动），左侧游戏名跨两行 —— 目的是节省宽度 |

配套内容：

- 开关来自设置页「实验特性」：`newPanel`（总开关）与 `panelTop`（顶部区域二选一）
- 版式 CSS 追加在 `schedule.css` **末尾**的「扩展侧改版」区块，全部挂在修饰类上
  （`--stacked` / `--recent` / `--slot` / `.gacha-cal-sched-lines` / `.gacha-cal-sched-linecap`），
  不改动任何一条移植来的规则
- 面板宽度从上游的 690px 收窄到 **520px**（`panel.html` 的 `#root` 宽度），游戏名列 152px
- 上下排列时每行左侧新增「卡池 / 活动」小标（`capOf`），含类型图标与配色

> 组件文件顶部与改动点都标了「扩展侧改版」注释，便于日后与上游比对。


## 测试

```bash
npm test                   # 跑下面三个自测
npm run test:domains       # 域名守卫的通过与拒绝路径（在沙箱副本里用"冒牌 core"）
npm run test:meta          # 来源显示名口径（标签 / 域名兜底 / 未配置 / 容错）
npm run test:options       # 设置页行为（用极简 DOM shim 在 Node 里跑真实 src/options.js）
```

`test:meta` 锁住 `defaultSourceName` 与 core 的 `getDefaultSourceName` **逐支同口径**：
有标签用标签 → 无标签有地址退到域名（去 `www.`）→ 都没有则显示**裸「未配置」**。

`test:options` 覆盖条目渲染、来源下拉文案、内联自定义地址、删除与恢复、出厂默认隐藏三态。
用 DOM shim 而非浏览器：本机的浏览器自动化取证一直不稳定（CDP 求值不通、扩展页 dump 受限），
而设置页逻辑用假 DOM 驱动更确定，也能直接断言"点了删除之后 storage 里究竟写了什么"。

## 验证状态（诚实说明）

| 验证 | 结果 |
|---|---|
| 静态校验（manifest 合法性、零远程代码、权限最小化、来源域名覆盖、图标、版本一致） | **通过** |
| 设置页行为自测（渲染 / 内联自定义地址 / 删除 / 恢复 / defaultHidden 三态） | **通过** |
| 域名守卫自测（该失败时失败、该通过时通过） | **通过** |
| 端到端：真网络抓 **28 款**（与扩展同一份 transport 契约、同一份 core） | **通过（卡池 22/28、活动 22/28）** |
| 端到端：渲染模型（与 popup 同一份纯函数）逐项断言 | **通过** |
| 真实 Chromium：渲染构建产物（面板） | **已取证**（见 `assets/popup.png`） |
| 真实 Chromium：加载扩展本体并实抓落库 | ⚠️ 未在本机取证，请在普通桌面环境跑 `node tools/verify-chromium.mjs` |

### 已取证的部分：面板渲染

`assets/popup.png` 是用**真实浏览器**渲染 `dist/` 的构建产物（`dist/popup.js` + `dist/popup.css`）得到的，
数据是**真网络抓的一轮结果**。复现方式：`node tools/make-store-assets.mjs` 生成离线夹具
（Node 真抓一轮拿缓存 → 灌进 chrome 桩），再用 `node tools/serve-shot.mjs` 起临时静态服务、
浏览器打开 `_lab/popup.html` 截图。之所以这么绕：真实扩展里截图要靠 CDP，而 CDP 在本机不通，
且 Playwright 禁止 `file://`。夹具渲染的是**同一份构建产物**，只是数据来自离线种子。

### 尚未取证的部分及原因

**"实抓结果写进浏览器 storage"这一步未能在本机截到**，两个具体原因：

1. `--virtual-time-budget` 会**快进虚拟时间**，而 headless 截图在 load 事件即触发，
   **不等真实网络** → 截图里数据列仍是占位符 `—`
2. service worker 写 `chrome.storage` 后，Edge 的 LevelDB 在进程退出前未把内容刷到可读的
   `.log/.ldb` 里，所以从 profile 里读不到报告

**这两条是实现细节，不代表功能有问题**：数据侧的正确性已由 `verify-live.mjs` 覆盖。

### 环境侧的一个真实约束（记录以免重复踩）

在有**文件沙箱**的环境里，Chromium 系浏览器**根本无法执行扩展代码**：浏览器日志持续报
`Failed to grant sandbox access to ... 拒绝访问 (0x5)`；用三个文件的最小扩展做对照，
service worker 连一行 `console.log` 都没有；headless 模式直接崩溃；Node 内置 WebSocket 与
DevTools 协议层不通（能握手、命令零响应）。

**解除文件沙箱限制后立刻恢复**：同一套脚本下，Edge 成功加载扩展、popup 页面正常打开、
service worker 正常执行并创建存储目录。所以在受限环境里跑验证脚本前，先确认浏览器能正常启动。

## 人工确认清单（30 秒）

在 `edge://extensions` 加载 `dist/` 后：

- [ ] 工具栏出现「二游日历」图标，点击能弹出面板
- [ ] 面板显示条目行（默认 **23 行**：28 款减去 5 款出厂默认隐藏）
- [ ] 顶部显示「数据：联网数据 · 成功 N/28」（首次打开会自动抓一轮，约 5～15 秒）
- [ ] 卡池列显示角色名，**悬停**能看到池名与时间
- [ ] 起止列显示「还剩 X 天 X 小时 X 分钟」倒计时
- [ ] 点右上角齿轮能打开设置页；设置页「开始自检」能跑出报告
- [ ] 切换某项的「展示」后，回到面板该行消失

## 上架与发版

**已上架**：[Edge 加载项商店页](https://microsoftedge.microsoft.com/addons/detail/mkfokebcmknjnbjceabimdchdfhbdhhc)
（Store ID `0RDCKFJTD9J2`）。

上架流程、平台限制、表单避坑与发版命令全部整理在 **[store/PUBLISHING.md](store/PUBLISHING.md)**。
要点摘录：

- 首次提交只能人工（官方 Update API 不提供"创建产品 / 修改商店元数据"的端点）；
  之后每次发版可用 `node tools/edge-publish.mjs` 一条命令完成
- 凭据走环境变量 `EDGE_CLIENT_ID` / `EDGE_API_KEY` / `EDGE_PRODUCT_ID`，**不进入仓库**
- **版本号必须递增**：`manifest.json` 与 `package.json` 必须一致（`build.mjs` 强制校验），
  且上传版本必须大于商店现有版本，否则 API 返回 400
- **审核期间无法发布新版本**：同一扩展只能有一个在审提交，需等前一版出结果

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
