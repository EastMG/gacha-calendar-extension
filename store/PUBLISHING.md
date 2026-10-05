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

> 若 Pages 尚未启用：仓库 **Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/docs` → Save**。
> 等 1~2 分钟后上面的 URL 即可访问（启用后本仓库的推送会自动更新它）。

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

## 第 6 步：Store 一览（每种语言）

1. 语言至少要有 **`zh-CN`**（1 种即可提交）
2. **说明**：粘贴 `store/listing-zh-CN.md` 的「二、说明」代码块（654 字符，下限 250）
3. **扩展徽标**：上传 `store/assets/logo-300.png`
4. **屏幕截图**：上传 `store/screenshots/` 里的 3 张（顺序建议 01 → 02 → 03）
5. **小型/大型促销磁贴**（可选）：上传 `store/assets/promo-small-440x280.png` 与 `promo-large-1400x560.png`
6. **搜索词**：粘贴「三、搜索词」的 5 个词
7. **扩展名称 / 简短说明**：**只读**，来自 manifest，无需也无法在此修改

> 想改名称或简短说明 → 改 `manifest.json` 后重新 `node build.mjs --zip` 并重传包。

---

## 第 7 步：认证说明并提交

1. 点右上角 **发布**，在 **认证说明** 里粘贴 `store/listing-zh-CN.md` 的「4.6 认证测试说明」
2. 再点 **发布** 提交
3. 进入认证：官方说明**最多 7 个工作日**
4. 通过后自动上架，状态变为「在 Microsoft Store 中」

### 被拒时优先检查这三项

| 常见拒因 | 对应检查 |
|---|---|
| 权限理由不充分 | 是否有逐个说明 `storage` 与主机权限的用途；是否强调**未申请 `<all_urls>`** |
| 单一用途不明确 | 是否说清"只做一件事"（看卡池与活动排期） |
| 数据披露与隐私政策不一致 | 第 5 步勾选项与 `docs/privacy.html` 内容是否矛盾 |

> 说明：本扩展无内容脚本、无 `<all_urls>`、无远程代码、无数据收集，属于审核面上比较干净的一类。

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
