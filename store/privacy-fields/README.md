# Privacy 页怎么填（照这个顺序点）

> 这个目录里每个 `.txt` 对应**一个字段**。用法：打开文件 → 全选（Ctrl+A）→ 复制（Ctrl+C）→ 粘到对应输入框。

---

## 页面从上到下的顺序

### ① Single purpose（单一用途说明）
粘贴 → **`1-单一用途.txt`**

### ② Permission justification（权限理由）
这一栏**有几个输入框，取决于 manifest 声明了什么**，逐个粘：

| 页面上的权限 | 粘贴哪个文件 |
|---|---|
| `storage` | `2-权限理由-storage.txt` |
| Host permissions / 主机权限（或按域名分组的那一栏） | `3-权限理由-主机权限.txt` 的**【主机权限】**那一段 |
| `declarativeNetRequestWithHostAccess` | `3-权限理由-主机权限.txt` 的**【声明式网络请求权限】**那一段 |

> ⚠️ `3-权限理由-主机权限.txt` / `3-permission-host-EN.txt` 现在是**两段合一**：
> 前半段解释 host_permissions（49 条，含 1 条 `*.gamekee.com` 子域通配的原因），
> 后半段解释新增的 `declarativeNetRequestWithHostAccess`（给 GameKee CDN 补 Referer）。
> 若表单把两者合并成一个框，就整份粘；若分成两个框，按小节各粘一段。

> 若权限理由栏是**按每个域名单独一个框**（49 个域名会很多），那就只在
> **第一个框或"Host permissions"总框**里粘【主机权限】那一段 ——
> 那一段本身已解释了"为什么需要这一批域名"。不必 49 个框逐个填同样的话。

### ③ Are you using remote code?（是否使用远程代码）
**选「No」**，不要粘任何文字。

依据（审核若追问再用）：本扩展是 Manifest V3，抓取核心已在构建时内联进扩展包，
运行时不加载、不执行任何外部脚本，也没有 `eval` / `new Function`。

### ④ Data usage（数据使用）
- 「你计划现在或将来从用户收集哪些用户数据？」→ **全部不勾选**
- 「我证明以下披露是真实的」→ **全部勾选**（这是证明你披露属实，必须勾）

### ⑤ Privacy policy URL（隐私政策 URL）
粘贴 → **`4-隐私政策URL.txt`**

### ⑥ 保存
右上角 **Save & Continue**。

---

## 一句话原则

**本扩展不收集任何用户数据** —— 没有账号、没有开发者服务器、没有统计分析、没有广告、
不含 content script。所以第 ④ 步全不勾选是**如实**的，不是偷懒。

⚠️ 但披露必须和隐私政策内容一致。政策原文在 `docs/privacy.html`，
其中「1. 我们收集哪些数据」「3. 保存在你本地的数据」「4. 权限用途说明」三节与你在这里的勾选一一对应。

---

## 英文版（建议也贴上）

审核方多半读英文。同一个目录里每个字段都备了英文版，**中英各贴一份**能显著降低
"看不懂而误判"的风险：

| 中文 | 英文 |
|---|---|
| `1-单一用途.txt` | `1-single-purpose-EN.txt` |
| `2-权限理由-storage.txt` | `2-permission-storage-EN.txt` |
| `3-权限理由-主机权限.txt` | `3-permission-host-EN.txt` |
| （URL 无需翻译） | `4-隐私政策URL.txt` |

## 认证说明（Reviews 页用，**不在 Privacy 页**）

| 语言 | 文件 |
|---|---|
| 中文 | `5-认证说明.txt` |
| 英文 | `5-certification-notes-EN.txt` |

> 这一页的那段说明能让审核方明白"Bwiki 返回 HTTP 567 是来源站限流、不是扩展缺陷"，
> 值得认真填。
