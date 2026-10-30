# 协作约定（本仓库）

> 给**在这个仓库里干活的 AI / 协作者**看的硬规则。优先级高于任何"顺手做一下"的直觉。

## 1. 发版必须等指令

**不允许擅自发版。** 下面这些动作，每一次都必须由维护者**明确下令**后才做：

| 动作 | 说明 |
|---|---|
| 改版本号 | `package.json` / `manifest.json` 的 `version` |
| 打 zip | `node build.mjs --zip` 产出 `release/*.zip`（构建校验可以，产物不要对外发） |
| GitHub Release | `gh release create` / 打 tag / 发布 Release 说明 |
| 提交商店 | Edge Partner Center 的上传、提交送审、Publish |

可以随时做、不需要额外许可的：

- 改代码、写测试、跑 `node build.mjs`、跑全链校验（`verify.mjs` / `check-domains` / `test-*` / `check-listing` / `verify-zip`）
- 提交到 `main`（commit + push），改文档
- 在 `dist/` 里本地加载扩展做真机验证

**判断口径**：凡是对外可见的产物（版本号、Release、商店），一律"先问再发"。
不确定时就不要发，把改动留在仓库里并说明。

## 2. 商店节奏

- Edge 商店**同一时间只能有一个在审提交**；新提交必须等上一个出结果。
- 提交前跑一遍：`node build.mjs --zip && node verify.mjs && node tools/check-domains.mjs &&
  node tools/test-domain-guard.mjs && node tools/test-entry-meta.mjs && node tools/test-options.mjs &&
  node tools/test-ics.mjs && node tools/test-remind.mjs && node tools/check-listing.mjs &&
  node tools/verify-zip.mjs release/*.zip`
- 权限有变化时，必须先在 `store/privacy-fields/` 补齐对应理由文件（`check-listing.mjs` 会强制校验）。

## 3. 数据与权限

- 抓取域名一律来自 `gacha-calendar-core`；改 core 版本后先跑 `node tools/check-domains.mjs`。
- `manifest.json` 的 `host_permissions` 必须覆盖 core 实际抓取的全部域名（含动态 CDN 子域）。
- `src/background.js` 的 `ALLOW_HOSTS` 不能删（删了就是任意内网请求器）。

## 4. Partner Center 自动化：别把重定向当掉登录

微软账号的授权页（`login.microsoftonline.com`）在**已登录**状态下也会作为重定向的一站出现：
导航后立刻读页面会看到登录页，若据此判定"会话过期、需要用户登录"，就是误报（2026-10-31 连续踩了三次）。

正确做法：
- 导航后**轮询**（每 1.5s，最多 60s）直到 URL 回到 `partner.microsoft.com` 且正文含
  `Extension overview` / `Store listings` 之类的页面标题；
- 只有在**轮询超时后**才认为是真的掉登录，再请用户处理；
- 判断"保存成功"同理：`Save draft` 按钮变灰 = 已无未保存改动，这比找 toast 更可靠。
