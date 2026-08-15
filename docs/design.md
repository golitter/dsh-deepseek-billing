# dsh-deepseek-billing 设计文档

> 版本：对应 package.json `0.1.0`。本文记录当前实现与设计取舍；运行契约以 `package.json`、`lib/index.js` 和 `lib/client.js` 为准。

## 1. 概述

`dsh-deepseek-billing` 是一个 **DSH 双端（dual-face）插件**，在 DeepSeek Harness 的 Web 设置页里展示 DeepSeek API 账户余额：

- **宿主半（host half）**：读取 DeepSeek `/user/balance` 接口，以服务 `deepseekBilling` 暴露给宿主，并通过本地 HTTP 路由把结果给浏览器。
- **客户端半（client half）**：在「设置 → 计费 / Billing」区块渲染余额，接入 DSH 的 `locale` 服务，界面随中英文实时切换。

两个半共用同一个 npm 包：宿主端通过 bundle patch 注入，客户端通过 `dsh.client` 声明被 `clientModules` 服务扫描进浏览器。

## 2. 设计目标与非目标

### 目标

- 用最少配置把余额展示进 DSH 设置页（无需 `--patch`、无需手动符号链接）。
- 只读展示，不提供充值/改密等写操作。
- 界面文案、时间格式完全跟随 DSH 的 `zh`/`en` 语言选择，实时切换、无需刷新。
- 余额查询失败时，服务端只回稳定错误码，错误文案由客户端按语言翻译，避免英文界面出现中文报错。
- 凭据只走 DSH 凭证库；插件不另行持久化，也不写入日志、响应或截图。

### 非目标

- 不做汇率换算或币种换算：`currency` 是账户事实，原样透传，不随语言变化。
- 不做余额历史曲线、消耗统计、告警等增值功能。
- 不在插件启动时主动查询余额（避免拖慢启动与无谓的 API 消耗）。

## 3. 整体架构

```mermaid
flowchart LR
    UI["lib/client.js<br/>设置页 UI（React）"]
    API["lib/index.js<br/>本地 JSON 路由<br/>GET /api/deepseek-billing/balance"]
    SVC["deepseekBilling<br/>余额服务"]
    KEY["credentials<br/>DEEPSEEK_API_KEY"]
    DS["DeepSeek<br/>/user/balance"]
    LOC["DSH locale 服务<br/>zh / en"]
    UI -->|"GET /api/deepseek-billing/balance"| API
    API --> SVC
    SVC --> KEY
    SVC --> DS
    DS --> SVC --> API --> UI
    LOC --> UI
```

数据流分两条：

1. **余额链路（请求/响应）**：客户端 `fetch` 本地路由 → 路由调用 `deepseekBilling.getBalance()` → 服务从 `credentials` 解析 `DEEPSEEK_API_KEY` → 携带 `Authorization: Bearer` 请求 DeepSeek `/user/balance` → 校验并白名单化首条余额 → 客户端渲染。
2. **语言链路（单向）**：DSH `locale` 服务只影响客户端 UI（文案 + 时间格式），不参与服务端与上游交互。

## 4. 打包与分发模型

包是「一个包、两个入口」的双端包，靠三处声明协同：

| 声明 | 位置 | 作用 |
|---|---|---|
| `exports["./client"]` | package.json | 指向 `./lib/client.js`，`clientModules` 据此定位客户端 bundle |
| `dsh.bundle.patch` | package.json | 指向 `./cordis.patch.yml`，安装后自动写入 profile 的 `dsh.profile.bundles` |
| `dsh.client` | package.json | 声明客户端平台与注入依赖，供 `clientModules` 扫描 |

### 4.1 宿主半如何被加载

`cordis.patch.yml` 按包名插入自身：

```yaml
- insert:
    - id: deepseek-billing
      name: 'dsh-deepseek-billing'
```

`dsh plugin --profile web add github:golitter/dsh-deepseek-billing` 会把 `add` 参数转发给 profile 目录里的 `pnpm`，随后 CLI 根据已安装包的 `dsh.bundle.patch` 声明，把包名追加进 `dsh.profile.bundles` 层栈；`dsh --profile web` 启动时逐层加载，宿主半 `lib/index.js` 被 cordis 加载。

### 4.2 客户端半如何被发现

DSH 的 `clientModules` 服务（Node 半）扫描宿主 Loader 里声明了 `dsh.client` 的包，流程为：

1. 校验 `dsh.client`（`platform: "web"`、`inject: string[]`）。
2. 解析 `exports["./client"]` 得到相对路径（本包为 `./lib/client.js`）。
3. 以包名为模块 id，把 bundle 通过 `/plugins/dsh-deepseek-billing/client.js?rev=<hash>` 提供给浏览器。
4. 把入口图注入 `index.html` 的 `<head>`，写成 `window.__DSH_BOOT__`，shell bundle 据此加载。

由于本包没有构建脚本，`client.js` 就是最终分发文件，`clientModules` 直接读 `lib/client.js`（无需 `pnpm run build`，也没有 `prepare` 脚本）。

### 4.3 两层「inject」的区别

容易混淆，务必区分：

- **package.json 的 `dsh.client.inject`**：客户端模块图边，值是**包名/模块 id**（`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings-general`），决定浏览器端 bundle 的加载顺序。
- **`lib/client.js` 的 `exports.inject`**：cordis **服务**依赖，值 `["slots", "locale"]`，决定浏览器端 cordis 上下文里可用哪些服务。

## 5. 宿主端设计（lib/index.js）

### 5.1 常量与错误码

```js
export const name = 'deepseek-billing'
export const inject = ['credentials', 'webServer']

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance'
const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000
```

错误码固定为五个稳定值，通过 `codedError(code, message)` 附着在 `Error.code` 上：

| 错误码 | 触发条件 | 中文文案 | English |
|---|---|---|---|
| `missing_credential` | 凭证值缺失、不是字符串或 `trim()` 后为空 | 未配置 DeepSeek API 密钥 | DeepSeek API key is not configured |
| `balance_timeout` | 上游请求超过 `timeoutMs`（`AbortError`） | 获取余额超时 | Balance request timed out |
| `balance_fetch_failed` | `fetch` 网络层失败（非超时） | 获取余额失败 | Failed to fetch balance |
| `billing_service_unavailable` | 上游返回非 2xx、请求方法不是 GET，或路由捕获没有字符串 `.code` 的异常 | 计费服务暂不可用 | Billing service is temporarily unavailable |
| `invalid_response` | 上游返回非法 JSON / 非法 payload / 非法余额条目 | 余额接口返回异常数据 | Balance endpoint returned unexpected data |

### 5.2 服务 `deepseekBilling`

`getBalance()` 是唯一对外能力，流程：

1. `await ctx.credentials.resolve(CREDENTIAL_REF)` 取密钥并 `trim()`；缺失、非字符串或全空白 → `missing_credential`。
2. 新建 `AbortController`，`setTimeout` 到 `timeoutMs` 后 `abort()`。
3. `fetch(endpoint, { authorization: Bearer ..., signal })`：
   - 捕获 `AbortError` → `balance_timeout`；
   - 其他网络异常 → `balance_fetch_failed`；
   - `finally` 清理定时器。
4. `!response.ok` → `billing_service_unavailable`。
5. `response.json()` 失败 → `invalid_response`。
6. `payload.balance_infos` 非数组 → `invalid_response`。
7. 取 `balance_infos[0]`：`undefined` 返回 `null`；非普通对象，或四个必要字段缺失、为空、不是字符串 → `invalid_response`。
8. 构造只包含 `currency`、`total_balance`、`granted_balance`、`topped_up_balance` 的新对象返回，避免把上游未来新增的字段自动暴露给浏览器。

启动时不调用 `getBalance()`，只在请求到达时执行。

### 5.3 余额数据模型

DeepSeek 返回（客户端实际用到的字段）：

```jsonc
{
  "currency": "CNY",            // 币种，原样透传
  "total_balance": "19.47",     // 可用余额（主展示）
  "granted_balance": "0.00",    // 赠送余额
  "topped_up_balance": "19.47"  // 充值余额
}
```

宿主半校验响应容器、`balance_infos` 数组、首条记录及四个必要字段，并只向客户端返回这些字段。金额仍以 DeepSeek 返回的非空字符串展示，不做计算或币种换算。

### 5.4 HTTP 路由

`GET /api/deepseek-billing/balance`（`kind: 'exact'`）：

| 场景 | 状态码 | 响应体 |
|---|---|---|
| 成功 | `200` | `{ "ok": true, "balance": {...} }` |
| 非 GET | `405` | `{ "ok": false, "code": "billing_service_unavailable" }` + `Allow: GET` |
| 任何 `getBalance()` 失败 | `502` | `{ "ok": false, "code": "<稳定错误码>" }` |

统一响应头 `Cache-Control: no-store`（余额是敏感、易变数据）。余额查询失败及协议层 `405` 都返回 `{ ok: false, code }` 结构。没有字符串 `.code` 的异常兜底为 `billing_service_unavailable`；例如 `ctx.credentials.resolve()` 直接抛出的普通 `Error` 会被规范化为该码。当前路由会透传异常自带的字符串 `.code`，其边界见“已知限制与后续”。堆栈、内部路径、上游正文只进服务端 `console.error`，绝不进响应体。

## 6. 客户端设计（lib/client.js）

### 6.1 模块外壳与注入

```js
window.__ModuleLoader__.load({
  id: "dsh-deepseek-billing",
  factory: (require) => { /* ... */ exports.apply = apply; exports.inject = ["slots", "locale"]; return module.exports; }
});
```

`require('react')` 复用宿主已加载的 React（`peerDependencies` 声明 `react`）。注入 `slots`（注册设置区块）与 `locale`（词典 + 实时翻译）。

### 6.2 组件状态机

`BillingSection` 用 `useState` 维护单一状态对象：

```text
{ loading, refreshing, result, updatedAt }
```

- **初始加载**：`result === undefined` 且非刷新 → `loading: true`，显示 `t('loading')`。
- **刷新**：已有结果时点「刷新」→ `refreshing: true`，保留旧结果继续展示。
- **成功**：`result = { ok: true, balance }`。
- **失败**：`result = { ok: false, code }`，渲染错误态。
- **空**：`result.ok` 但 `balance === null` → 显示 `t('empty')`。

### 6.3 请求生命周期与竞态防护

`requestRef` 持有当前 `AbortController`：

1. 每次新请求前 `requestRef.current.abort()` 取消旧请求。
2. 组件卸载时（`useEffect` cleanup）`abort()` 并置空。
3. 回调里比对 `requestRef.current !== controller`，过期响应直接丢弃。
4. `AbortError` 的拒绝静默忽略（是主动取消，不是错误）。

这保证「旧请求结果不会覆盖新请求状态」。

### 6.4 错误码 → 文案

客户端把服务端 `code` 通过 `ERROR_KEY` 映射到词典键，未知码回退 `error.generic`：

```text
billing_service_unavailable -> error.billing_service_unavailable
balance_fetch_failed         -> error.balance_fetch_failed
missing_credential           -> error.missing_credential
balance_timeout              -> error.balance_timeout
invalid_response             -> error.invalid_response
（未知）                      -> error.generic
```

错误态渲染：标题 `t('error.title')` + 正文 `t(errorKey)`。

### 6.5 样式

- CSS 类名统一 `ds-billing-` 前缀。
- 颜色全部用 `currentColor` + `color-mix(in srgb, currentColor X%, transparent)`，自动适配明暗主题。
- `@media (max-width: 620px)` 下 header 纵向堆叠、breakdown 改纵向。
- 保留 `:focus-visible` 焦点环、`:disabled` 状态、`role="status"/"alert"` 与 `aria-label`。

## 7. 国际化设计

### 7.1 locale 服务接入

命名空间固定为 `settings.billing`，在 `apply` 里注册词典：

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'deepseek-billing: dictionaries')
const t = ctx.locale.bind(NS)
```

`t(key, params?)` 按「当前命名空间 → 公共 `common` → `zh` → 原 key」链查找，支持 `{name}` 模板插值。

### 7.2 词典键集（zh 为来源，en 逐键对应）

| key | zh | en |
|---|---|---|
| `nav` | 计费 | Billing |
| `title` | 账户余额 | Account balance |
| `description` | 查看 DeepSeek API 账户当前的可用余额。 | View the current available balance of your DeepSeek API account. |
| `refresh` | 刷新 | Refresh |
| `refresh.aria` | 刷新余额 | Refresh balance |
| `refreshing` | 刷新中… | Refreshing… |
| `refreshing.aria` | 正在刷新余额 | Refreshing balance |
| `loading` | 正在获取余额… | Fetching balance… |
| `empty` | 暂无余额信息 | No balance information available |
| `available` | 可用余额 | Available balance |
| `toppedUp` | 充值余额 | Topped-up balance |
| `granted` | 赠送余额 | Granted balance |
| `updated` | 最后更新 {time} | Last updated {time} |
| `error.title` | 暂时无法获取余额 | Unable to load balance |
| `error.billing_service_unavailable` | 计费服务暂不可用 | Billing service is temporarily unavailable |
| `error.balance_fetch_failed` | 获取余额失败 | Failed to fetch balance |
| `error.missing_credential` | 未配置 DeepSeek API 密钥 | DeepSeek API key is not configured |
| `error.balance_timeout` | 获取余额超时 | Balance request timed out |
| `error.invalid_response` | 余额接口返回异常数据 | Balance endpoint returned unexpected data |
| `error.generic` | 发生未知错误 | An unknown error occurred |

约束：`zh`、`en` 键必须完全一致（20 键）；新增错误码时同步更新 `ERROR_KEY`、两份词典和 README。

### 7.3 实时切换

侧边栏 label 用 thunk，余额页用 `useSyncExternalStore`：

```js
// 侧边栏（设置面板外壳在 locale revision 变化时重渲染 nav 投影）
label: () => t('nav')

// 余额页：订阅 locale 快照，切换语言立即重渲染
const subscribeLocale = (listener) => ctx.locale.subscribe(listener)
const getLocaleSnapshot = () => ctx.locale.getSnapshot()
const localeSnapshot = React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot)
```

`ctx.locale.getSnapshot()` 返回稳定引用（仅变化时替换），满足 `useSyncExternalStore` 的缓存要求；语言切换 bump `revision` → React 重渲染 → `t(...)` 读取新 `active` 返回新文案，无需刷新。

### 7.4 时间格式跟随语言

```js
const isEnglish = localeSnapshot.active === 'en'
const updatedTime = state.updatedAt
  ? state.updatedAt.toLocaleTimeString(isEnglish ? 'en-US' : 'zh-CN',
      { hour: '2-digit', minute: '2-digit', hour12: isEnglish })
  : '—'
```

- 中文：`zh-CN` + `hour12: false` → `19:31`
- 英文：`en-US` + `hour12: true` → `08:15 PM`

最终用模板插值渲染 `t('updated', { time: updatedTime })`。

### 7.5 币种不做翻译

`currency` 来自 `balance.currency`，缺省 `'CNY'`，原样透传。切语言只改文字，绝不改金额或币种。

## 8. 关键决策与权衡

1. **双端包而非两个包**：一个包同时声明 `dsh.bundle` 与 `dsh.client`，安装一次即完成宿主注入与客户端发现，避免用户分别安装。
2. **服务端只回错误码**：错误文案是「呈现层」职责。若服务端回本地化文案，英文界面会混入中文。稳定码 + 客户端翻译从根上消除该问题，代价是两端需维护一致的码表（`ERROR_CODES` ↔ `ERROR_KEY` ↔ 词典）。
3. **币种透传不做换算**：金额/币种是账户事实，任何「按语言换算」都会造成数据错误。代价是 `¥`/`$` 不按语言美化，改用 ISO 代码显示以保真。
4. **手动 `bind` + `useSyncExternalStore` 而非 slot 的 `locale:` 座位**：需要 `snapshot.active` 来按语言格式化时间，`useSyncExternalStore` 直接拿到 `active` 并驱动重渲染；slot 的 `locale:` 座位只注入 `t` 拿不到 `active`。
5. **`502` 作为统一失败态**：本地路由是上游代理，失败即「网关错误」，客户端不看具体 HTTP 状态码、只看 `code`。

## 9. 安全与隐私

- 密钥只经 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 读取；DSH 凭证库负责持久化，插件自身不另行保存，也不写进代码、日志、响应、文档、截图或测试数据。
- 凭据会被发送到 `config.endpoint`；默认值是 DeepSeek 官方 HTTPS 地址。该配置属于受信任的宿主配置，不接受浏览器请求参数覆盖，修改时必须同时评估代理需求与凭据泄露风险。
- `Cache-Control: no-store` 阻止浏览器缓存余额。
- 错误响应不含堆栈、内部路径、上游正文。
- 路由仅提供 `GET` 只读操作，不接受用户输入作为上游地址或请求头。

## 10. 验证

### 静态检查

```bash
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
```

### 自动测试

```bash
npm test
# 或直接运行底层命令
node --test
```

测试使用 Node.js 内置 `node:test`，不依赖真实 DSH、真实 DeepSeek 服务或真实 API Key：

- `test/index.test.js`：10 个宿主端用例，覆盖凭据处理、五个固定错误码、无 `.code` 异常兜底、超时与网络/HTTP 错误、非法响应、字段白名单、空余额、GET/405 路由和配置边界。
- `test/client.test.js`：1 个客户端契约用例，通过真实模块工厂验证模块 ID、`require('react')`、服务注入、词典命名空间、zh/en 键集及动态侧栏标签。

客户端契约测试不渲染 `BillingSection`，因此 fetch 生命周期、卸载取消、刷新交互、状态渲染和时间本地化仍由下方手动清单验证。只有当 UI 频繁变化、出现真实回归或项目接入浏览器 CI 时，再考虑引入渲染级测试。

### 手动检查清单

- 正常余额：显示可用 / 充值 / 赠送余额与「最后更新」时间。
- 缺失凭据：显示「未配置 DeepSeek API 密钥」（zh）/ 对应英文（en），而非原始异常。
- 刷新：点击刷新，旧结果保留、按钮进入「刷新中…」；连续刷新或离开页面后，旧请求不得覆盖新状态。
- 中英文切换：导航、标题、按钮、加载/错误态、时间格式即时切换，无需刷新。
- 明暗主题：颜色跟随 `currentColor` 自动适配。
- 窄屏（≤620px）：header 与 breakdown 纵向布局正常。

### 验证约定

Web profile 挂载了客户端 HMR，会轮询当前已加载包的 `lib/client.js`；只有当该文件就是正在编辑的文件（例如本地链接安装）时，修改才能实时生效。GitHub 安装产生的是 profile 内副本，本仓库改动不会自动同步，需要重新安装/更新并重启 DSH Web；浏览器仍显示旧版本时再使用 `Ctrl+F5`。zh/en 键集一致性由客户端契约测试自动检查。

## 11. 已知限制与后续

- 只展示 `balance_infos[0]`，多币种账户只显示第一条。
- 币种和金额仅校验为非空字符串，不验证 ISO 币种代码或十进制定点格式。
- 路由当前会透传异常自带的任意字符串 `.code`；插件自身只产生五个固定码，客户端对未知码显示通用错误。后续可在服务端按固定码集合做白名单兜底。
- 余额只在打开区块 / 手动刷新时拉取，不自动轮询。
- 币种以 ISO 代码（如 `CNY`）展示，未做符号美化。
- 侧边栏 label 依赖设置面板外壳对 `locale` revision 的订阅（框架已保证），插件自身不在注册时固化文案。

## 12. 目录结构

```text
.
├── package.json        # 包名、exports、dsh.bundle / dsh.client 声明、peerDependencies
├── cordis.patch.yml    # bundle patch：按包名插入宿主插件（id: deepseek-billing）
├── lib/
│   ├── index.js        # 宿主半：服务 + 路由 + 错误码
│   └── client.js       # 客户端半：设置页 UI + 词典（window.__ModuleLoader__.load）
├── docs/
│   ├── design.md       # 本文档
│   ├── image_zh.png    # 中文界面截图
│   └── image_en.png    # 英文界面截图
├── test/
│   ├── index.test.js   # 宿主端服务、错误码、路由与配置测试
│   └── client.test.js  # 客户端模块、注入与国际化契约测试
├── AGENTS.md           # 代码代理约束
└── README.md           # 安装、配置、使用说明
```
