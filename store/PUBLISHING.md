# Edge 加载项商店 · 上架与发版手册

> 本文记录「二游日历」扩展在 Microsoft Edge 加载项商店（Partner Center）的上架过程与后续发版流程。
>
> 行文上分两部分：**第一至五节**尽量写成可复用的操作参考，其他打算上架 Edge 扩展的开发者
> 也可对照使用；**第六、七节**是本项目自身的状态、标识与数据记录。
> 所有结论均来自本项目的实际提交过程，而非官方文档的转述——两者冲突时以实测为准。

---

## 一、关键标识

| 字段 | 值 | 说明 |
|---|---|---|
| Product ID | `d77ac990-6ec5-4760-a155-a4e41ee4f6f7` | 发版脚本用；也在 Partner Center 地址栏里 |
| Store ID | `0RDCKFJTD9J2` | 商店内部 ID，Analytics 接口用 |
| CRX ID | `mkfokebcmknjnbjceabimdchdfhbdhhc` | 出现在商店页 URL 与公开接口路径里 |
| 商店页 | <https://microsoftedge.microsoft.com/addons/detail/mkfokebcmknjnbjceabimdchdfhbdhhc> | |
| 开发者名称 | `East Morning` | 会公开显示，注册时填写的 |
| 类别 / 可见性 | Entertainment / Public | |

> Product ID、Store ID、CRX ID 都**不是密钥**，公开不构成风险（CRX ID 本就在商店 URL 里）。
> 真正的凭据只有 Publish API 的 Client ID 与 API Key，仅存于环境变量，不进入仓库。

---

## 二、商店硬性限制（提交前自查）

这些限制在 Partner Center 表单里**只有提交时才会报错**，来回成本很高。
本项目已把它们编码为 `tools/check-listing.mjs` 并接入提交钩子，提交前自动拦截。

| 字段 | 限制 |
|---|---|
| 扩展名称 | ≤ 45 字符（取自 manifest，表单只读） |
| 简短说明 | ≤ 132 字符（取自 manifest `description`） |
| 详细说明 | 250 – 10 000 字符 |
| 搜索词 | 最多 7 个，每个 ≤ 30 字符，**合计 ≤ 21 个词** |
| 扩展徽标 | 300 × 300 建议，最小 128 × 128，必须 1:1 |
| 小型促销磁贴 | 440 × 280 |
| 大型促销磁贴 | 1400 × 560 |
| 屏幕截图 | 仅 640 × 480 或 1280 × 800，最多 6 张 |

> 搜索词的 21 是**词数**不是字符数：中文一个词条记 1 个词，
> 英文多词短语按空格拆词。按字符数校验会把合理的长短语误判为超限。

---

## 三、首次上架流程

首次提交**只能人工完成**——官方 Update REST API 不提供"创建产品或修改商店元数据"的端点。
流程共七步，全部在 Partner Center 网页完成。

### 第 0 步：准备

| 项目 | 位置 |
|---|---|
| 待上传的包 | `release/gacha-calendar-extension-<版本>.zip`（`manifest.json` 须在 zip 根目录） |
| 逐字段商店文案 | `store/listing-zh-CN.md`、`store/listing-en-US.md` |
| 商家素材 | `store/assets/`（徽标、两种促销磁贴）、`store/screenshots/` |
| 隐私政策 | `docs/privacy.html` → GitHub Pages（`main` 分支 `/docs` 目录） |
| 落地页 | `docs/index.html` 同上 |

### 第 1 步：注册开发者账号

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge/public/login>
2. 用 Microsoft 账号登录（个人账号即可；Edge 扩展注册**免费**）
3. 注册 **Microsoft Edge 程序**，填写开发者名称与国家/地区

> 开发者名称会**公开显示**在商店页，应填写愿意公开的名字。

### 第 2 步：上传包

1. Partner Center → Microsoft Edge → 概述 → **创建新扩展**
2. 将 zip **整体拖入**（不要解压），等待校验通过
3. 记录 **Product ID**（地址栏中亦可见）

### 第 3 步：可用性

| 字段 | 取值 |
|---|---|
| 可见性 | Public |
| 市场 | 全部（默认） |

### 第 4 步：属性

类别（游戏相关，以实际下拉为准）、网站与支持链接、成人内容不勾选。

### 第 5 步：隐私（审核重点）

逐项内容见 `store/listing-zh-CN.md` 的「四、隐私页」，可直接复制。要点：

1. **单一用途**：只做一件事——查看各游戏当期卡池与活动排期
2. **权限理由**：分别说明 `storage` 与每类主机权限的用途，并强调**未申请 `<all_urls>`**
3. **远程代码**：选「否」。依据是核心已在构建时内联，运行时无外部脚本、无 `eval`
4. **数据使用**：全部不勾选（无账号、无服务器、无统计、无广告），并确认披露属实
5. **隐私政策 URL**：指向 `docs/privacy.html` 的 Pages 地址

> 数据使用披露必须与隐私政策正文一致，否则可能被判为不实披露。

### 第 6 步：Store 一览

**语言列表由包内的 `_locales` 决定，不能手工添加。** 详见第四节避坑第 1 条。

每种语言各自填写 Description、徽标、截图、营销磁贴与搜索词；
两种语言的 Status 都变为 **Complete** 后，右上角 **Publish** 才可用。

图片无需重复上传：在**已具备该素材的那一行**点击字段下方的
*Duplicate … for all languages*，即可同步到其他语言（每次点击会弹一次确认）。

### 第 7 步：认证说明并提交

1. 回答「测试者是否需要凭据」——本扩展无需登录，选 **No**
2. 填写认证说明（≤ 2000 字符）。中英各一段合并后可完整放入
3. 点 **Publish** 提交送审

审核周期官方说明为**最多 7 个工作日**；期间线上仍是上一版本，用户不受影响。

### 被拒时的自查项

| 常见拒因 | 检查点 |
|---|---|
| 权限理由不充分 | 是否逐个域名/权限说明了用途；是否强调未申请 `<all_urls>` |
| 单一用途不明确 | 是否说清"只做一件事" |
| 披露与隐私政策不一致 | 表单勾选项与隐私政策正文是否矛盾 |

---

## 四、避坑要点（本项目实测）

以下每一条都在实际提交中真实发生过，官方文档未覆盖或与实际行为不符。

| # | 现象 | 原因 | 正确做法 |
|---|---|---|---|
| 1 | Store 一览只能填 `English (United States)`，`Add a language` 是灰的 | Partner Center 的语言列表**严格取决于包内 `_locales`**。manifest 用硬编码文案时它识别不到任何语言，只能回落 en-US | 为 manifest 增加 `_locales/<locale>/messages.json`，把 `name`/`description` 改成 `__MSG_*__` 并声明 `default_locale`，重新上传包。之后语言自动出现 |
| 2 | 换包后已填好的 Store 一览被清空 | 包内语言标识变化（如 `en-US` → `English`）会使原有行失效 | **先把语言定稿再写文案**，避免反复重填 |
| 3 | 想发布新版本被拒：`Update cannot be published right now` | 同一扩展**只能有一个在审提交**。`Update` 允许先把包上传成草稿，但发布要等在审版本出结果 | 把草稿放着，等上一版通过后再点发布；**不要为此取消在审提交** |
| 4 | 认证说明输入框灰掉（`readonly`），无法输入 | 该表单为 Angular 渲染，加载未完成或选项变化后会短暂置 `readonly` | **刷新页面**即可恢复可编辑 |
| 5 | 刚填好的认证说明被清空 | 切换"是否需要凭据"单选时，表单会重置说明字段 | **先确定单选，再填说明，然后直接提交**；中途不要改动单选 |
| 6 | 找不到图片的批量复制选项 | *Duplicate … for all languages* 只出现在**已经有该素材的那一行** | 先把某一种语言的图片传全，再在该行点击复制链接 |
| 7 | 截图只能一张一张加 | 「Add Image」是自定义元素而非普通按钮，点击打开系统文件选择框 | 每加一张需再点一次；上限 6 张 |
| 8 | 改了仓库里的商店文案，线上却没变 | 仓库的 `store/listing-*.md` 只是**文案源**，真正上线的是 Partner Center 表单里的内容 | 文案改动要**同步两处**：仓库文件（供校验与版本记录）+ Partner Center 表单（真正生效） |
| 9 | 用错误 API Key 调接口，返回 403 且响应体为空 | 与官方文档描述（401）不一致；空响应体易被误判为网络问题 | 见 403/空体即按"凭据无效"处理 |
| 10 | 上传包被拒（HTTP 400） | 版本号未递增 | 每次发版先升 `manifest.json` 与 `package.json` 的版本（两者必须一致） |
| 11 | 命令行访问 `partner.microsoft.com` 报 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | Node 的证书链校验问题，与站点无关 | Partner Center 的一切操作**用浏览器**完成；命令行只用于发版 API（该域名可达） |
| 12 | 新版本审核通过时间不定 | 官方说明上限 7 个工作日 | 发版节奏应预留审核窗口，不要把上架时间压到最后一天 |

> 另有一条不属于"坑"但值得注意：**新增主机权限会触发用户重新确认权限**。
> 核心升级常伴随新数据源域名，务必同步更新 `manifest.host_permissions` 与
> `src/background.js` 的 `ALLOW_HOSTS`，并运行 `npm run verify:domains` 复核。

---

## 五、发版流程（上架后）

### 一次性：生成 Publish API 凭据

1. Partner Center → Microsoft Edge 程序 → **Publish API**
2. 如提示 "enable the new experience"，先 **Enable**（切换到 v1.1 密钥模式）
3. **Create API credentials**，记录 Client ID 与 API Key

以环境变量方式提供，**不要写入仓库**：

```powershell
$env:EDGE_CLIENT_ID  = '<Client ID>'
$env:EDGE_API_KEY    = '<API Key>'
$env:EDGE_PRODUCT_ID = '<Product ID>'
```

> API Key 约 **72 天过期**，过期后发版会返回 403，重新生成即可。

### 每次发版

```powershell
npm test                                  # 三个自测
node verify.mjs                           # 静态校验（含来源域名覆盖）
node verify-live.mjs                      # 真网络端到端

node build.mjs --zip                     # 产出 release/*.zip
node tools/verify-zip.mjs release/gacha-calendar-extension-<版本>.zip

node tools/edge-publish.mjs --dry-run     # 只校验凭据/包/URL，不发请求
node tools/edge-publish.mjs --upload-only # 真上传，留在草稿
node tools/edge-publish.mjs --notes "v<版本>：<一句话改动>"   # 上传 + 发布 + 轮询
```

脚本对应的官方 v1.1 接口依次为：上传草稿包 → 轮询上传操作 → 发布提交 → 轮询发布操作。
退出码：`0` 成功 / `1` 用法或包问题 / `2` 上传失败 / `3` 发布失败。

> 版本号必须**大于**商店现有版本，否则上传即被拒（400）。

### 哪些环节无法自动化

| 环节 | 可自动化 | 原因 |
|---|---|---|
| 注册开发者账号 | ❌ | 需 Microsoft 身份与可能的二次验证 |
| 创建新产品 | ❌ | 官方 API 无此端点 |
| 修改商店元数据（说明/截图/隐私页） | ❌ | 同上 |
| 首次提交送审 | ❌ | 只能在 Partner Center 点 Publish |
| 生成版本包与自检 | ✅ | `build.mjs` + `verify-zip.mjs` |
| 文案与素材合规校验 | ✅ | `tools/check-listing.mjs`（已接入提交钩子） |
| 后续每次发版 | ✅ | `tools/edge-publish.mjs` |

---

## 六、状态查询与数据分析

### 查线上版本（无需登录）

商店提供公开的产品详情接口，可直接读到线上版本号：

```
https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/<CRX ID>
```

返回 JSON，含 `version` / `name` / `description` / `manifest` 等。
需要注意两点：`manifest` 字段是 **JSON 字符串**，需再 `JSON.parse` 一次；
附加请求头 `Accept-Language: zh-CN` 可获取中文名称与描述。

### 查下载量与用户数（需登录）

Partner Center → **Analytics** 页有三个标签：`Weekly users` / `Installs` / `Impressions`。
对应的数据接口为：

```
/analytics/api/vnext/edgeaddons/dailyImpressions?applicationId=<Store ID>&…
/analytics/api/vnext/edgeaddons/dailyInstalls?…
/analytics/api/vnext/edgeaddons/weeklyActiveInstalls?…
```

> 两个使用注意：其一，从 Node 侧直接请求 `partner.microsoft.com` 会因证书链校验失败，
> 需在已登录的浏览器页面上下文中同源 `fetch()`；其二，`dailyUninstalls` 在无数据时返回
> **500**、`weeklyRatings` 返回 **404**，均属接口行为，不代表操作有误。

### 指标口径与滞后

| 指标 | 含义 |
|---|---|
| Installs | 从 Edge 加载项网站成功安装的次数（累计） |
| Impressions | 商店产品页的浏览量 |
| Weekly users | 近 7 天打开过该扩展的 Edge 实例数（含启用/禁用/未知状态） |

数据**每周二发布一次，覆盖"上周（截至周日）"**，因此天然滞后。
新上架的扩展通常需要等待一个完整自然周才会有 `Weekly users` 数据。

---

## 七、本项目当前状态

**已上架**。商店页：<https://microsoftedge.microsoft.com/addons/detail/mkfokebcmknjnbjceabimdchdfhbdhhc>

| 项 | 状态 |
|---|---|
| 线上版本 | **0.2.5**（core 0.11.1） |
| 语言 | Chinese (China) + English |
| 评分 / 评论 | 0 / 0（尚无用户评价） |
| 安装量 | 0；曝光（Impressions）4 次（首周） |
| **0.2.6（core 0.12.5）** | **已提交送审（In review，2026-10-21）**；线上仍 0.2.5，用户不受影响 |
| **0.2.7（新日程面板）** | **已构建并在 GitHub 发布**，待 0.2.6 审完后提交商店 |
| **0.2.8（面板改版）** | **已构建并在 GitHub 发布**：顶部区域二选一 + 卡池/活动上下排列 |
| **0.2.9（面板修复）** | 修复探头层级与收起态虚影（纯样式） |
| **0.2.10（探头修正）** | 迷你条动画只在启动播放、探头瞬时展开、探头对齐格子底边 |
| **0.2.11（探头回补）** | 恢复「可展开」虚影提示与滑动展开动画（保留层级/对齐修复） |
| **0.2.12（去掉行首指示）** | 去掉每行「卡池/活动」指示，行高 93→75px |
| **0.2.13（popup 化）** | 新面板改为工具栏 popup（520×600，内部滚动），不再开标签页 |
| **0.2.14（密度微调）** | 近期默认最多 2 条；留白卡内部改左右（❌ 方向错，被 0.2.15 取代） |
| **0.2.15（留白卡纠正）** | 留白卡改为**卡片整体左右分栏**：左大卡 / 右三条（高 267） |
| **0.2.16（大卡对齐+紧凑）** | 修大图标歪（盒子驱动尺寸）；左栏压紧，卡片 267→216 |
| **0.2.17（失败提示去重）** | ❌ 仍是两处（被 0.2.18 取代） |
| **0.2.18（失败并进底栏）** | 删除页内失败横条，明细合并进常驻底栏，按钮变「重试」 |
| **0.2.19（GameKee CDN 权限）** | gamekee 权限改为裸域 + 子域通配（49 条），修 `host-not-allowed:api-cdn.gamekee.com` |
| **0.2.20（刷新改图标）** | 底栏刷新按钮改圆形箭头图标；失败时不再变「重试」 |
| **0.2.21（GameKee 567）** | 加 DNR 规则给 CDN 注入 Referer；修 build.mjs manifest 白名单丢字段 |
| **0.2.22（popup 外框）** | popup 里卡片去圆角/阴影/边框，满铺窗口（消除方正的边沿阴影） |
| **0.2.23（删死代码）** | 删除无入口的独立页面 panel.html 及其 onClicked 分支；构建前清空 dist |
| **0.2.24（设置页联动）** | 实验特性两行调换；「顶部区域」在未启用新面板时禁用 |
| **0.2.25（设置页文案）** | 新面板说明改为「实验性新版UI，开发中」；留白卡→近期卡片；顶部区域说明精简 |
| **0.2.26（默认值）** | 新日程面板默认开启；顶部区域默认「近期卡片」 |
| **0.2.27（取色器）** | 设置页每个条目可自定义强调色（原生取色器 + ↺ 恢复默认） |
| **0.2.28（颜色口径统一）** | 设置页色块改为显示面板真实颜色（共用 game-color.js + sourceTable） |
| **0.2.29（悬停精简）** | 颜色色块悬停只显示色值（语义留在 aria-label） |
| **0.2.30（通读清理）** | 注释/命名统一、删死 CSS（failbar 系列）、gameColors 边界加固 |
| **商店提交（0.2.30）** | **材料已就绪**：3 张截图重拍、文案改版、权限理由补 DNR/通配披露、认证步骤更新；**被 0.2.6 审核阻塞，暂不能发布** |
| 商店文案补更新 | ✅ 上一次已过审生效（zh 643 / en 1728 字符）\n| **文案改版（待提交）** | 本地已改：zh **880** 字符、en **2182** 字符（新增新面板/颜色/失败提示说明） |

> 0.2.6 涉及**新增 3 个主机权限**（`gametora.com`、`gh-proxy.com`、
> `raw.githubusercontent.com`）并移除 4 个已废弃的图标域名，净变化 49 → 48 条。
>
> 2026-10-21（0.2.19）：`www.gamekee.com` → `gamekee.com` + `*.gamekee.com`，净变化 48 → 49 条。
> 原因：GameKee 的 content CDN 地址来自接口响应的 `content_cdn` 字段（指向 `api-cdn.gamekee.com`），
> 静态声明 `www.gamekee.com` 覆盖不到，抓取被自有域名守卫拦成 `host-not-allowed`。
> 用户从旧版本升级时会出现一次权限确认，属正常现象。

> 0.2.7 新增实验性「新日程面板」（一比一移植自 DSH 插件），**权限面未变**；
> 因内联 React 运行时，包体从约 260KB 增至约 415KB（zip）。

### 2026-10-21 商店材料收拾（0.2.30，待 0.2.6 出结果后提交）

| 项目 | 状态 |
|---|---|
| 包 | `release/gacha-calendar-extension-0.2.30.zip`（19 文件，421 KB） |
| 截图 | 3 张全部重拍为 **1280×800**：新面板展示页 / 设置页（含颜色列）/ 已删除条目+自检 |
| 说明文案 | zh 880 字符（下限 250 / 上限 10000）、en 2182 字符 —— `check-listing` 通过 |
| 权限理由 | 补 **declarativeNetRequestWithHostAccess** 说明；披露 `*.gamekee.com` 子域通配的由来 |
| 认证说明 | 改为当前 UI 步骤（弹窗是 520×600 面板；设置页入口改为"右键图标→扩展选项"；如何切回旧面板） |
| 阻塞项 | Partner Center 显示 **0.2.6 In review**；同一扩展只能有一个在审提交 ⇒ 发布要等它出结果 |

> ⚠️ 相对 0.2.6，这次**权限面有变化**（新增 `declarativeNetRequestWithHostAccess` 与
> `*.gamekee.com` 通配），提交新版本会再触发一次权限审核 —— 认证说明里已把这两项为什么需要写清楚。

### 提交节奏的一条经验

`0.2.5` 与「文案补更新」是**两个先后提交**：前者审核期间无法再发新版本，后者过审后才腾出窗口。
所以实际节奏是：**先等前一次提交出结果，再打包下一次**，中间不要并行堆提交。
`0.2.6` 正是在文案更新过审后立即提交的。

### 与上架流程相关的一次性事实

- GitHub Pages 已启用（`main` / `docs`），隐私政策与落地页均实测可访问
- 若需重新启用：Settings → Pages → Deploy from a branch → `main` + `/docs`
- 开发者账号免费，无年费
