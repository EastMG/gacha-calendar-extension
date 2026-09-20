# 二游排期 · 浏览器扩展

11 款二次元手游的**当期卡池与活动起止**一览，点浏览器工具栏图标即可查看。

> 原神 / 崩坏：星穹铁道 / 绝区零 / 鸣潮 / 明日方舟 / 明日方舟：终末地 /
> 蔚蓝档案（国服 · 国际服 · 日服）/ 重返未来：1999 / 异环

抓取逻辑来自独立包 **[`gacha-calendar-core`](https://www.npmjs.com/package/gacha-calendar-core)**
与 [DSH 桌面端插件](https://github.com/EastMG/dsh-gacha-calendar) 共用同一份核心

> **当前内联的核心版本：`gacha-calendar-core@0.9.12`**（构建时会打印实际版本，设置页也能看到）。
> 升级核心只需改 `package.json` 的依赖版本并重新 `node build.mjs`。
> 注意：核心仓库的版本可能领先于 npm（未发布的修复拿不到），跟随 npm 上的最新版即可。

---

## 安装（加载已解压的扩展程序）

1. 构建：`node build.mjs`（或直接下载 Release 里的 `.zip` 解压）
2. 打开 `edge://extensions` 或 `chrome://extensions`
3. 打开右下角/右上角的 **开发人员模式**
4. 点 **加载解压缩的扩展**，选择本项目的 `dist/` 目录（或Release `.zip` 解压后的目录）
5. 点工具栏的「二游排期」图标 → 首次打开会自动抓一轮

## 使用

- **卡池 / 活动**：外显角色名与活动名；**鼠标悬停**可看完整池名、UP 角色与时间原文
- **起止**：显示"还剩 X 天 X 小时 X 分钟"的倒计时
- **右上角按钮**：刷新 / 打开设置页
- **设置页**：展示开关、条目排序、卡池与活动来源各自切换、刷新频率、**解析器自检**

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
build.mjs              构建（内联 core + 校验清单）
verify.mjs             静态校验（27 项）
verify-live.mjs        端到端校验（真网络抓 11 款 + 渲染模型 + 域名覆盖）
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
非常难定位。（开发过程中就踩过一次：返回了 `{status, contentType, body}` → 11 款只成功 1 款。）

### 2. 为什么必须经 background 代发

实测 25 个来源里，只有 6 个回 `access-control-allow-origin`（Bwiki、PRTS、
`api-web.bluearchive.jp`、绝区零/鸣潮官方 API、GachaTracker）；其余 12 个
（canmoe / fz.wiki / 万美 / game8 / ldshop / 1999 / 蔚蓝国服 / Nexon / GameKee / 小米 / wiki.gg）
**没有 ACAO**，浏览器会直接拦掉。而 service worker 凭 `host_permissions` 可以真正跨域，
并能自行设置 `Referer` / `Origin`。

### 3. 安全红线

- `src/background.js` 的 `ALLOW_HOSTS` **必须保留**：没有它就是"任意内网地址请求器"（SSRF）
- 消息来源做校验（只接受本扩展自己的页面），否则任何网页都能驱使扩展发请求
- `manifest.host_permissions` 不申请 `<all_urls>`：既是商店审核要求，也让权限提示可接受
- `verify-live.mjs` 有一项**域名覆盖校验**：把产物里出现的所有抓取域名与
  `host_permissions` / `ALLOW_HOSTS` 逐一对齐 —— 漏一个域名 = 那个源在浏览器里静默失败
  （这条检查已经抓出过两个漏配域名：`ak.hypergryph.com`、`zzz.mihoyo.com`）

### 4. `Referer` 的已知限制

`fetch` 的 `Referer` 在部分浏览器实现中是禁止由脚本设置的。本扩展在 service worker 里尝试设置
（比页面上下文权限更高），但**不能保证一定生效**。若某个源因校验来源而拒绝，core 会把它记为
`down` 并沿用上次成功数据、在面板上标出 —— 不会静默显示错误内容。

## 验证状态（诚实说明）

| 验证 | 结果 |
|---|---|
| 静态校验（manifest 合法性、零远程代码、权限最小化、图标尺寸、版本一致性） | **27/27 通过** |
| 端到端：真网络抓 11 款（与扩展同一份 transport 契约、同一份 core） | **通过** |
| 端到端：渲染模型（与 popup 同一份纯函数）逐项断言 | **通过** |
| 端到端：域名覆盖（manifest / 白名单 / 产物三方对齐） | **通过** |
| **真实 Chromium：扩展加载 + 面板渲染** | **✅ 已取证**（见 `assets/popup.png`） |
| **真实 Chromium：11 款实抓落库** | ⚠️ 未在本机取证，请在普通桌面环境跑 `node tools/verify-chromium.mjs` |

### 已取证的部分（真实 Edge，无头模式截图）

`assets/popup.png` 是在 **Microsoft Edge** 里加载 `dist/` 后渲染 `popup.html` 得到的，图里可以看到：

- 面板标题「二游排期」、刷新按钮、设置按钮
- 状态栏（截图瞬间显示"刷新中…"，说明脚本已在执行自动抓取）
- 游戏行：原神、崩坏：星穹铁道、绝区零、鸣潮……，每行为「卡池 / 起止 / 活动 / 起止」四段结构
- 页脚「悬停查看池名与时间明细」

同一轮验证里还确认了：`/json/list` 中扩展的 popup 页面标题就是「二游排期」，
且扩展的 service worker 在 `chrome.storage` 下创建了自己的存储目录（即 worker 确实执行了）。

### 尚未取证的部分及原因

**"11 款实抓的结果写进浏览器 storage"这一步没能在本机截到**，两个具体原因：

1. `--virtual-time-budget` 会**快进虚拟时间**，而 headless 截图在 load 事件即触发，
   **不等真实网络** → 截图里数据列仍是占位符 `—`
2. service worker 写 `chrome.storage` 后，Edge 的 LevelDB 在进程退出前未把内容刷到可读的
   `.log/.ldb` 里（运行中轮询文件数始终不变），所以从 profile 里读不到报告

**这两条是实现细节，不代表功能有问题**：数据侧的正确性已由 `verify-live.mjs` 覆盖
（真网络抓 11/11、render 模型与 popup 同一份纯函数、逐字段断言通过）。

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

- [ ] 工具栏出现「二游排期」图标，点击能弹出面板
- [ ] 面板显示 **11 行**游戏（原神、星铁、绝区零、鸣潮、明日方舟、终末地、蔚蓝三服、1999、异环）
- [ ] 顶部显示「数据：联网数据 · 成功 N/11」（首次打开会自动抓一轮，约 5～15 秒）
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
