# 首次上架 Edge 加载项商店：分步清单

> **先说结论**：首次上架**无法全自动**，必须你本人在 Partner Center 网页上操作。这不是我偷懒 ——
> 官方 Update REST API 明确没有"创建新产品"和"修改商店元数据"的端点：
>
> > "There aren't REST API endpoints for: Creating a new product. Updating a product's metadata,
> > such as the description. To create a new product or update a product's metadata, you must use
> > Microsoft Partner Center."
> > —— [Use the REST API to update an extension](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/api/using-addons-api)
>
> **首次上架之后**，每次发版都可以用 `node tools/edge-publish.mjs` 一条命令完成（见最后一节）。
>
> 本文把"必须手动的部分"压到最少：所有文案、图片、隐私政策都已备好，照着复制粘贴即可。

---

## 当前进度（2026-10-17）

| 步骤 | 状态 |
|---|---|
| 注册开发者账号 | ✅ 已完成 |
| 第 2 步 创建扩展并上传包 | ✅ 已完成 |
| 第 3 步 可用性（Availability） | ✅ 已完成 |
| 第 4 步 属性（Properties） | ✅ 已完成 |
| 第 5 步 隐私（Privacy） | ✅ 已完成 |
| 第 6 步 Store 一览 | ✅ 已完成（**两种语言**） |
| 第 7 步 认证说明并提交 | ✅ 已完成 |
| **0.2.4 审核** | ✅ **已通过，已上架（Live）** |
| **0.2.5 更新送审** | ⏳ **审核中（In review）** |

**商店公开页（已上线）**：
<https://microsoftedge.microsoft.com/addons/detail/mkfokebcmknjnbjceabimdchdfhbdhhc>

审核期间线上仍是 **0.2.4**（用户可正常安装），**0.2.5 通过后会自动替换**。

### ✅ 0.2.4 → 已上架

送审的是 **0.2.4（core 0.11.1）**，已通过审核并 Live，商店页标题
`Gacha Calendar - Microsoft Edge Add-ons`，HTTP 200 实测可访问。

### ⏳ 0.2.5 → 审核中（2026-10-17 送审）

core 升到 **0.12.0** 后构建的 **0.2.5** 已通过 `Update` 流程提交送审。
**扩展代码零改动**（core 0.12.0 的公开接口与权限域名都与 0.11.1 一致），
主要带来来源健康度修复：

- 赛马娘·国际服：卡池默认源换成 GachaTracker（原官方源已不可用）
- 终末地：Game8 备选源标注「不可靠」
- 来源名规范化
- 顺带修掉文案里过时的来源名（Bestdori 已从主源降为备选源）

0.2.5 的包同时以 ZIP 形式发布在 GitHub Release `v0.2.5`。

### 📘 经验：审核期间**无法**发布新版本（这次踩到了）

0.2.4 还在审时，我把 0.2.5 传上去想直接发，被平台硬挡：

> Your extension is in-review. Update cannot be published right now, please try again later.

**规则**：一个扩展同时只能有一个在审的提交。`Update` 流程**允许先把新包上传成草稿**，
但**发布会被挡**，直到在审那一版出结果：

| 情况 | 能否发布更新草稿 |
|---|---|
| 0.2.4 In review | ❌ 被挡 |
| 0.2.4 通过（Live） | ✅ 可以，实测成功 |

**结论：不要为了赶版本去取消在审提交**。上传草稿本身是无害的，等审完再点发布即可
（这次就是这么做的：草稿放了一晚，0.2.4 过审后直接发布 0.2.5）。

### 0.2.5 的构建与校验（已完成）

- `release/gacha-calendar-extension-0.2.5.zip`（15 文件，zip 自校验通过）+ GitHub Release `v0.2.5`
- 全链校验通过：build / verify / check-listing / 三个自测
- **扩展代码零改动**：core 0.12.0 的公开接口（`listGames` / `getCached` / `refresh` /
  `selfCheck` / `__test`）与权限域名都与 0.11.1 一致，只有来源健康度与新增的
  `gameColors` / `newPanel`（DSH 插件面板专用）变化
- 顺带修掉文案里过时的来源名（Bestdori 已从主源降为 Bandori 的备选源，从示例列表里去掉）

> 📌 **0.2.4 与 core 新版不构成「不兼容」**：扩展在构建时就把 core **内联进包**了，
> 0.2.4 里带的是它自己那份 core 0.11.1，与后来发布的 core 0.12.0 没有运行时联系。
> 升级 core 只需重新构建发布，不存在版本匹配问题。

**关键标识**：

| 字段 | 值 |
|---|---|
| Product ID | `d77ac990-6ec5-4760-a155-a4e41ee4f6f7` |
| Store ID | `0RDCKFJTD9J2` |
| CRX ID | `mkfokebcmknjnbjceabimdchdfhbdhhc` |

> Product ID / Store ID 不是密钥，公开也不致命（上架后会出现在商店页 URL 里）。
> 真正的密钥是 API Key，只在你手里。

### 已解决：语言只有 en-US 的问题

第一次填 Store listings 时发现 **`Add a language` 是禁用的**，只能填 Partner Center 自动识别的
`English (United States)` —— 因为 `manifest.json` 用的是**硬编码中文**、没有 `_locales`，
它识别不到任何语言，只能回落到默认 en-US。

**修法（已完成）**：给包加 i18n，让商店能识别中文：

1. 新增 `src/_locales/zh_CN/messages.json` 与 `src/_locales/en/messages.json`
2. `manifest.json` 的 `name` / `description` 改成 `__MSG_extensionName__` / `__MSG_extensionDescription__`
   并显式声明 `"default_locale": "zh_CN"`
3. `build.mjs` 把 `src/_locales/**` 复制进 `dist/_locales/**`（**不能漏**，否则扩展名会显示成字面量 `__MSG_...__`）
4. 重新上传包 → Partner Center 的「Languages in package」变成 **English, Chinese (China)**，
   Store listings 自动出现**两行语言**

> ⚠️ 语言列表**严格等于包里 `_locales` 声明的语言**，不能手工添加。
> 想加语言只能改包（加 `_locales/<locale>/messages.json` 并重传）。

> 📌 改语言后**已填的 Store 一览会被清空**（语言标识从 `en-US` 变成 `English`），
> 需要重填。所以**语言要一次性定好再填文案**。

---

## 第 0 步：准备（已完成，无需操作）

| 项目 | 状态 |
|---|---|
| 上架包 | `release/gacha-calendar-extension-0.2.3.zip`（`manifest.json` 在 zip 根目录） |
| 商店文案 | `store/listing-zh-CN.md`（逐字段可粘贴，字数已校验） |
| 徽标 300×300 | `store/assets/logo-300.png` |
| 商店截图 ×3（1280×800） | `store/screenshots/` |
| 促销磁贴（可选） | `store/assets/promo-small-440x280.png`、`promo-large-1400x560.png` |
| 隐私政策页 | `docs/privacy.html`（托管后 URL 见下） |

本地自检（应全部通过）：

```bash
node tools/check-listing.mjs     # 文案字数 + 素材尺寸是否踩到商店限制
node build.mjs --zip             # 产出上架包
node tools/verify-zip.mjs release/gacha-calendar-extension-<版本>.zip
```

隐私政策 URL（GitHub Pages，源为本仓库 `docs/`）：

```
https://eastmg.github.io/gacha-calendar-extension/privacy.html
```

落地页（填「网站」字段用）：

```
https://eastmg.github.io/gacha-calendar-extension/
```

> ✅ **Pages 已启用并实测可用**（`main` 分支 `/docs` 目录，2026-10-05 验证两个 URL 均返回 HTTP 200）。
> 之后改 `docs/` 下的文件，推送后自动更新，无需再动设置。
> 若哪天需要重新启用：仓库 **Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/docs` → Save**。

---

## 第 1 步：注册开发者账号（约 5 分钟）

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge/public/login?ref=dd>
2. 用你的 Microsoft 账号登录（个人账号即可，Edge 扩展程序**免费注册**，不像 Windows 应用商店需要付费）
3. 按提示注册 **Microsoft Edge 程序**，填写开发者名称（会公开显示在商店页）与国家/地区
4. 等待账号就绪（通常立即生效）

> ⚠️ **开发者名称会公开**，请填你愿意公开的名字（如 `EastMG`）。
> 若本步骤卡在身份验证，说明该账号类型被要求额外验证 —— 换个人 Microsoft 账号通常即可。

---

## 第 2 步：创建扩展并上传包

1. 进入 Partner Center → **Microsoft Edge** 程序 → **概述**
2. 点 **创建新扩展**
3. 把 `release/gacha-calendar-extension-0.2.3.zip` **整个 zip** 拖进去（不要解压）
4. 等校验通过 → 进 **扩展概述** 页，**复制 Product ID**（一串 GUID）

> 📌 **把这个 Product ID 记下来**，第 9 步的自动化要用。
> 它也在地址栏里：`.../microsoftedge/<这段就是>/packages`

---

## 第 3 步：可用性（Availability）

| 字段 | 填什么 |
|---|---|
| 可见性 | **Public**（公开） |
| 市场 | 全部市场（默认即可） |

---

## 第 4 步：属性（Properties）

| 字段 | 填什么 |
|---|---|
| 类别 | 选**游戏**相关分类（以实际下拉为准） |
| 网站 | `https://eastmg.github.io/gacha-calendar-extension/` |
| 支持联系人 | `https://github.com/EastMG/gacha-calendar-extension/issues` |
| 成人内容 | **不勾选** |

---

## 第 5 步：隐私（Privacy）—— 审核重点，别糊弄

逐项内容见 `store/listing-zh-CN.md` 的「四、隐私页」，直接复制：

1. **单一用途说明** → 粘贴该文件 4.1 的文本
2. **权限理由** → 粘贴 4.2 的 `storage` 与主机权限两段
3. **是否使用远程代码** → 选 **「否」**
   - 依据：MV3，抓取核心已在构建时内联，运行时无外部脚本、无 `eval`/`new Function`；
     仓库 `npm run verify` 有专门的静态检查守这条
4. **数据使用** → **全部不勾选**（本扩展无账号、无服务器、无统计、无广告），
   然后勾选「我证明以下披露是真实的」
5. **隐私政策 URL** → `https://eastmg.github.io/gacha-calendar-extension/privacy.html`

> ⚠️ 数据使用披露必须与隐私政策内容一致，否则会被判为不实披露。

---

## 第 6 步：Store 一览（**两种语言都要填**）

> ⚠️ **这一步有个坑**：Partner Center 自动识别的语言是 **English (United States)**，
> 而不是中文。原因：本扩展的 `manifest.json` 用的是**硬编码中文**、没有 `_locales` 目录，
> 所以它识别不到任何语言，只能回落到默认的 en-US。
>
> 后果：**不能把中文塞进 en-US 那一行** —— 那样国际用户会看到语言标记错乱。
> 正确做法是**再加一行中文**，两行分别填各自语言的文案。

### 操作顺序

1. **Add a language** 下拉 → 选 **Chinese (Simplified)**（中文(简体)）→ 多出一行
2. 分别点两行的 **Edit details**，按下表填：

| 字段 | **zh-CN** 那行 | **en-US** 那行 |
|---|---|---|
| Description | `store/listing-zh-CN.md` 的「二、说明」（**654 字符**） | `store/listing-en-US.md` 的 Description（**1738 字符**） |
| Extension logo | `store/assets/logo-300.png` | 同上 |
| Screenshots | `store/screenshots/01-panel.png`、`02-settings.png`、`03-remove-restore.png` | 同上 |
| Small / Large promo tile（可选） | `store/assets/promo-small-440x280.png`、`promo-large-1400x560.png` | 同上 |
| Search terms | 二游日历、卡池日历、活动排期、抽卡日历、手游活动 | gacha calendar、banner tracker、anime games、event schedule、gacha timer、game events |

3. **省力技巧**：先填完一行的徽标与截图，字段下方会出现 **Copy** 选项，可一键复制到另一语言，
   不必重复上传四张图。

   > 实测补充：「Duplicate this logo / these screenshots / this promotional tile for all languages」
   > 出现在**已经有该素材的那一行**。所以流程是：先把**中文行**的图传全 → 打开中文行点这 4 个复制链接
   > → 图片就同步到英文行了（每点一次会弹确认框，点确认即可）。**不必在英文行重复上传。**
   >
   > 另外「Screenshot/s」的 **Add Image 是个自定义元素**（不是普通 `<button>`），
   > 点它会弹系统文件选择框，一次只能加一张，加完可再点继续加（最多 6 张）。
4. **Extension name / Short description 是只读的**（来自 manifest），两行都会自动带出「二游日历」，不用管。
5. 两行 Status 都变成 **Complete** 后，右上角 **Publish** 才会亮。

> 想改扩展名称或简短说明 → 只能改 `manifest.json`、重新 `node build.mjs --zip`、重传包。

> 📷 截图里的界面是中文的 —— 这是**如实反映**产品当前只提供中文界面，不需要为此改图或做英文截图。


---

## 第 7 步：认证说明并提交

1. 点右上角 **发布** → 进入 **Submit your extension** 页
2. **先回答单选**：「Does a tester need credentials…?」→ 选
   **「No, testers can access and test all functionality without any additional info」**
   （本扩展无需登录，这是如实回答）
3. **再填认证说明**（上限 2000 字符）：
   - 中文：`store/privacy-fields/5-认证说明.txt`
   - 英文：`store/privacy-fields/5-certification-notes-EN.txt`
   - 两段合并约 **1873 字符**，正好放得下（合并顺序：中文在前、英文在后，中间用 `---` 分隔）
4. 点 **Publish** 提交 → 回到扩展概览页，状态变为 **In review**
5. 官方说明**最多 7 个工作日**；通过后自动上架

### ⚠️ 这一页有两个反直觉的坑（实测踩到）

| 现象 | 原因 / 正确做法 |
|---|---|
| 认证说明框是**灰的（readonly）填不进去** | 这是 Angular 重渲染的临时状态。**刷新页面**即可编辑 |
| 改单选后，**刚填的说明被清空** | 表单在选项变化时会重置说明 → **必须"先定单选、再填说明"**；顺序反了就白填 |

> 顺序口诀：**先选 No → 再填说明 → 直接 Publish**。中途别再去动那个单选。

### 被拒时优先检查这三项

| 常见拒因 | 对应检查 |
|---|---|
| 权限理由不充分 | 是否有逐个说明 `storage` 与主机权限的用途；是否强调**未申请 `<all_urls>`** |
| 单一用途不明确 | 是否说清"只做一件事"（看卡池与活动排期） |
| 数据披露与隐私政策不一致 | 第 5 步勾选项与 `docs/privacy.html` 内容是否矛盾 |

> 说明：本扩展无内容脚本、无 `<all_urls>`、无远程代码、无数据收集，属于审核面上比较干净的一类。

> 💡 **发给审核员的字段建议中英各贴一份**（第 5 步与第 7 步都适用）。审核方多半读英文，
> 中英并排能显著降低"看不懂而误判"的风险。`store/privacy-fields/` 下两种语言都备好了。

---

## 上架通过后：请看这里

通过后有三件事，前两件一次性、第三件长期有效。

### ① 立刻能做的：确认商店页正常

- 打开商店页，检查：名称「二游日历」、徽标、3 张截图、说明（中英两版）、隐私政策链接可点开
- 用一台干净的浏览器实际装一次，确认「加载项商店」装出来的版本能正常抓数据
  （与本地 `dist/` 手动加载不是同一条路径，值得单独验一次）

### ② 一次性：生成 API 凭据（见第 8 步）→ 然后**真跑一次上传**

拿到凭据后**先不要直接发布**，用 `--upload-only` 验证整条链路：

```powershell
node tools/edge-publish.mjs --dry-run       # 只校验凭据/包/URL，不发请求
node tools/edge-publish.mjs --upload-only   # 真上传，但留在草稿里
```

去 Partner Center 确认草稿里出现了新版本包 → 再决定是否点发布。

> 为什么强调这一步：**上传成功后的轮询逻辑从没被真实端到端验证过**
> （之前没有凭据，只测到"鉴权失败"分支）。这是目前唯一剩下的未验证路径。

### ③ 长期：每次发版的流程

见下一节「第 9 步」。


---

## 第 8 步（上架后一次性）：生成 API 凭据

首次上架通过后，后续更新就全自动了。去生成三样东西：

1. Partner Center → **Microsoft Edge** 程序 → **Publish API**
2. 若显示 "enable the new experience" 就点 **Enable**（切到 v1.1 的 API 密钥模式）
3. 点 **Create API credentials**（可能要等几分钟）
4. 记下 **Client ID** 与 **API Key**

> ⚠️ **API 密钥约 72 天过期**，过期后自动发布会返回 403，届时重新生成即可。

把三样东西设为环境变量（**不要写进仓库**）：

```powershell
# 当前会话
$env:EDGE_CLIENT_ID  = '<Client ID>'
$env:EDGE_API_KEY    = '<API Key>'
$env:EDGE_PRODUCT_ID = '<第 2 步复制的 Product ID>'
```

想永久保存（用户级，重启后仍在）：

```powershell
[Environment]::SetEnvironmentVariable('EDGE_CLIENT_ID',  '<Client ID>',  'User')
[Environment]::SetEnvironmentVariable('EDGE_API_KEY',    '<API Key>',    'User')
[Environment]::SetEnvironmentVariable('EDGE_PRODUCT_ID', '<Product ID>', 'User')
```

---

## 第 9 步（此后每次发版）：一条命令

```powershell
# 1) 先干跑：只校验凭据、包、URL，不发任何请求
node tools/edge-publish.mjs --dry-run

# 2) 正式发布（上传 zip + 提交发布 + 轮询状态）
node tools/edge-publish.mjs --notes "本次改动：…"

# 只想上传、留在草稿里人工确认：
node tools/edge-publish.mjs --upload-only
```

脚本做的事（对应官方 v1.1 API）：

1. `POST /v1/products/{productId}/submissions/draft/package` —— 上传 zip
2. `GET  …/package/operations/{id}` —— 轮询上传状态
3. `POST /v1/products/{productId}/submissions` —— 发布草稿
4. `GET  …/submissions/operations/{id}` —— 轮询发布状态

退出码：`0` 成功 / `1` 用法或包问题 / `2` 上传失败 / `3` 发布失败。

> ⚠️ **版本号必须递增**：上传的包里 `manifest.json` 的 `version` 必须大于商店里的现有版本，
> 否则会被拒（HTTP 400）。所以发版流程是：改版本 → `node build.mjs --zip` → `edge-publish`。

---

## 附：完整发版流程（上架后）

```powershell
# 1. 升版本号（package.json 与 manifest.json 会被同步）
# 2. 跑全部校验
npm test
node verify.mjs
node verify-live.mjs

# 3. 打包并自检
node build.mjs --zip
node tools/verify-zip.mjs release/gacha-calendar-extension-<版本>.zip

# 4. 发布到 Edge 商店
node tools/edge-publish.mjs --notes "v<版本>：<一句话改动>"

# 5. 顺手发个 GitHub Release（可选）
gh release create v<版本> release/gacha-calendar-extension-<版本>.zip --notes-file release/RELEASE_NOTES.md
```

---

## 附：本机网络注意事项（实测踩到的）

国内到微软 / GitHub 的链路会间歇性抖动，实测遇到过这些，**都不是代码问题**：

| 现象 | 原因 | 影响 | 应对 |
|---|---|---|---|
| `github.com` DNS 解析失败、推送卡住 | 链路抖动 | 提交推不上去 | **提交在本地是安全的**，等几分钟重试即可（实测会恢复） |
| `eastmg.github.io` 时通时不通 | `*.github.io` 在国内被间歇性 DNS 污染 | 你自己可能打不开隐私政策页 | **不影响上架** —— 微软审核方在境外，能正常访问。要国内也稳定可换托管 |
| Node 报 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` 打不开 `partner.microsoft.com` | Node 的证书库问题（本机 git 也踩过同样的 CA 坑） | **只有命令行脚本受影响** | **浏览器不受影响**，注册与填表照常用浏览器做 |

> 所以：**Partner Center 的所有操作都用浏览器**（本清单也是按浏览器写的）。
> 命令行只用于 `edge-publish.mjs` 发版，而且它打的是 `api.addons.microsoftedge.microsoft.com`
> —— 那个域名实测**可达**（返回 404/403 都说明链路通）。

### 上架流程里"必须人工"的部分

| 环节 | 能否自动化 | 原因 |
|---|---|---|
| 注册开发者账号 | ❌ | 需要你的 Microsoft 身份与（可能的）二次验证 |
| 创建新产品 | ❌ | 官方 API **没有**该端点（见文首引文） |
| 修改商店元数据（说明/截图/隐私页） | ❌ | 同上，API 没有 |
| 首次提交送审 | ❌ | 只能在 Partner Center 点 Publish |
| **后续每次发版** | ✅ | `node tools/edge-publish.mjs` 一条命令 |
| 版本包构建与自检 | ✅ | `build.mjs --zip` + `verify-zip.mjs` |
| 商店文案/素材校验 | ✅ | `node tools/check-listing.mjs`（已接入提交钩子） |

