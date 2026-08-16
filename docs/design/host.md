# 宿主端设计（lib/index.js）

> 对应原设计文档 §5。安全边界详见 [security.md](security.md)，配置项与本地代理示例见 [configuration-and-security.md](configuration-and-security.md)。

## 5. 宿主端设计（lib/index.js）

### 5.1 常量与错误码

```js
export const name = 'deepseek-billing'
export const inject = ['credentials', 'webServer', 'commands']

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance'
const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 30
const MAX_RESPONSE_BYTES = 64 * 1024
const CURRENCY_MAX_LENGTH = 16
const AMOUNT_MAX_LENGTH = 128
const DEFAULT_COMMAND_DESCRIPTION = 'show the DeepSeek account balance'
```

宿主配置键（均可选；默认配置行为不变，已有自定义 `endpoint` 需显式增加 `allowCustomEndpoint: true` 迁移）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `endpoint` | `https://api.deepseek.com/user/balance` | 余额接口地址。`allowCustomEndpoint: false` 时必须是官方默认值 |
| `timeoutMs` | `10000` | 覆盖完整请求（响应头 + 响应体读取 + 解析 + 校验）的超时 |
| `allowCustomEndpoint` | `false` | 必须是布尔值 `true`/`false`；`false` 时锁定官方默认 endpoint，`true` 时允许自定义 `https:`（或 loopback 明文 HTTP 代理） |
| `maxRequestsPerMinute` | `30` | 每客户端每分钟的低频限流上限 |

`endpoint` 始终拒绝：相对/非法 URL、内嵌用户名/密码、fragment、非 `http(s):` 协议；`http:` 仅当 `allowCustomEndpoint: true` 且目标为 loopback（`127.0.0.1`/`localhost`/`[::1]`）时放行。

错误码固定为五个稳定值，通过 `codedError(code, message, status?)` 附着在 `Error.code` 上（`status` 为可选的数值 HTTP 状态，仅用于服务端日志，不进入响应体）：

| 错误码 | 触发条件 | 中文文案 | English |
|---|---|---|---|
| `missing_credential` | 凭证值缺失、不是字符串或 `trim()` 后为空 | 未配置 DeepSeek API 密钥 | DeepSeek API key is not configured |
| `balance_timeout` | 上游请求超过 `timeoutMs`（`AbortError`） | 获取余额超时 | Balance request timed out |
| `balance_fetch_failed` | `fetch` 网络层失败（非超时） | 获取余额失败 | Failed to fetch balance |
| `billing_service_unavailable` | 上游返回非 2xx、请求方法不是 GET，或路由捕获缺失/未知 `.code` 的异常 | 计费服务暂不可用 | Billing service is temporarily unavailable |
| `invalid_response` | 上游返回非法 JSON / 非法 payload / 非法余额条目 | 余额接口返回异常数据 | Balance endpoint returned unexpected data |

### 5.2 服务 `deepseekBilling`

`getBalance()` 是唯一对外能力，流程：

1. `await ctx.credentials.resolve(CREDENTIAL_REF)` 取密钥并 `trim()`；缺失、非字符串或全空白 → `missing_credential`。
2. 新建 `AbortController`，`setTimeout` 到 `timeoutMs` 后 `abort()`；定时器在**最外层 `finally`** 清理，因此超时覆盖「响应头 + 响应体读取 + JSON 解析 + 校验」全过程，而不是只覆盖等待响应头的阶段。
3. `fetch(endpoint, { headers: { accept: 'application/json', authorization: Bearer ... }, signal, redirect: 'manual' })`：
   - 捕获 `AbortError` → `balance_timeout`（无论发生在 `fetch` 还是随后的响应体读取）；
   - 其他网络异常 → `balance_fetch_failed`；
   - 已带稳定 `.code` 的错误原样透传。
4. `!response.ok`（含 `redirect: 'manual'` 下直接返回的 3xx）→ `billing_service_unavailable`（附带数值 `status` 供日志，但不进响应）。
5. 受限读取响应体：先看 `Content-Length`，明显超过 `MAX_RESPONSE_BYTES`（64 KiB）立即拒绝；否则流式读取并在超限时中止，然后再 `JSON.parse()`。解析失败 → `invalid_response`。
6. `payload.balance_infos` 非数组 → `invalid_response`。
7. 取 `balance_infos[0]`：`undefined` 返回 `null`；非普通对象，或四个必要字段缺失、为空、不是字符串 → `invalid_response`；`currency` 超过 16 字符、任一金额超过 128 字符 → `invalid_response`。
8. 构造只包含 `currency`、`total_balance`、`granted_balance`、`topped_up_balance` 的新对象返回，避免把上游未来新增的字段自动暴露给浏览器。

并发调用会被合并：同一时刻多个 `getBalance()` 只共享一次上游请求，共享的 promise 在 settle 后清空。每个活跃请求的 `AbortController` 都由插件 fiber 跟踪，卸载或 HMR 重载时立即取消，避免旧实例在新实例启动后继续携带凭据请求上游。启动时不调用 `getBalance()`，只在请求到达时执行。

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
| 未通过 browser-trust fence | `403` | `{ "ok": false, "code": "billing_service_unavailable" }` |
| 非 GET | `405` | `{ "ok": false, "code": "billing_service_unavailable" }` + `Allow: GET` |
| 超过 `maxRequestsPerMinute` | `429` | `{ "ok": false, "code": "billing_service_unavailable" }` |
| 任何 `getBalance()` 失败 | `502` | `{ "ok": false, "code": "<稳定错误码>" }` |

统一响应头 `Cache-Control: no-store`（余额是敏感、易变数据），所有失败态（含 `403`）都返回 `{ ok: false, code }`。路由在方法检查、限流、读取凭据之前先复刻 DSH 自己的 `/api` browser-trust fence，并以**空信任列表**把该路由锁定为 loopback-only（拒绝 `Sec-Fetch-Site: cross-site`、拒绝跨域 `Origin`）；这是因为 `exact` 路由会在 webserver 的匹配中优先于 `/api` 前缀路由，从而绕过连接层自带的那道 fence，而余额路由读取 API Key、发起上游调用、返回账户数据，属于与 DSH `credentials`/`settings` 平面同级的高权限路由，因此 `--trusted-host`（DNS-rebinding 白名单，非鉴权）不放开它。路由只允许五个固定错误码；缺失或未知 `.code` 统一兜底为 `billing_service_unavailable`。限流按客户端地址（loopback 单用户部署下即全局）固定窗口计数，`429` 在读取凭据、发起上游请求之前返回。

服务端日志只记录稳定错误码（以及观测到的数值 HTTP 状态），**不记录**：API Key、`Authorization` 头、上游响应正文、完整自定义 endpoint（尤其是 query string）、凭据服务抛出的原始消息。堆栈、内部路径、上游正文绝不进响应体。

### 5.5 斜杠命令 `/deepseek-billing`

宿主半通过 `ctx.commands.register(...)` 注册命令 `deepseek-billing`（`commands` 是 DSH 自带的宿主服务，参考内置 `/goal`）。命令名去斜杠、全小写；`parseCommand` 使用 `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u`，因此 `deepseek-billing` 合法，且命令名后必须是输入结束或空白。

handler 复用 `deepseekBilling.getBalance()`；主标签、空态和固定错误码跟随宿主侧 locale 偏好，无法确定语言时回退为语言中性文本或稳定错误码：

| 场景 | 呈现或返回 |
|---|---|
| 发现菜单说明（zh） | `查看 DeepSeek 账户余额` |
| 发现菜单说明（en / 无偏好） | `show the DeepSeek account balance` |
| 成功且有余额（zh） | `{ kind: 'success', text: '可用余额 CNY 12.34' }` |
| 成功且有余额（en） | `{ kind: 'success', text: 'Available balance CNY 12.34' }` |
| 成功且有余额（无偏好） | `{ kind: 'success', text: 'CNY 12.34' }` |
| 成功但无余额（zh） | `{ kind: 'success', text: '暂无余额信息' }` |
| 成功但无余额（无偏好） | `{ kind: 'success', text: '—' }` |
| 失败（zh/en） | `{ kind: 'error', text: '<本地化错误文案>' }` |
| 失败（无偏好） | `{ kind: 'error', text: '<稳定错误码>' }`（缺失或未知 `.code` 兜底 `billing_service_unavailable`） |
| 带额外参数（zh） | `{ kind: 'error', text: '此命令不接受参数，请直接输入 /deepseek-billing' }` |

命令不接受参数，handler 先把 `invocation.rawInput` 防御性归一为非字符串（缺失/`null`/数字按空串处理）再 `trim()`，非空时直接返回本地化用法错误，不发起余额请求。

语言偏好是 Host-backed：`dsh-client-locale` 的宿主半把 `locale.preference` 注册进宿主 `settings` 服务并持久化到 `settings.yaml`。命令 handler 经 `ctx.get('settings')` 读 `settings.get('locale').preference`（`zh`/`en`）选择文案；`settings` 服务缺失、读取失败或 `preference` 未知时回退为无标签的 `CNY 12.34`、空态 `—`、稳定错误码或固定英文用法提示，语言读取本身不会阻断余额查询。

命令的 `description` 就是截图中斜杠发现菜单的灰色摘要：zh 为“查看 DeepSeek 账户余额”，en 与无 Host 偏好时为 `show the DeepSeek account balance`。插件监听 `settings/updated` 的 `locale` 变化；摘要变化时注销并重新注册命令，`commands` 服务发出 `commands/change`，客户端目录随即重新拉取，因此持久化语言切换后无需重启。
