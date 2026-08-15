# 客户端设计（lib/client.js）

> 对应原设计文档 §6。国际化细节见 [i18n.md](i18n.md)，宿主侧契约见 [host.md](host.md)。

## 6. 客户端设计（lib/client.js）

### 6.1 模块外壳与注入

```js
window.__ModuleLoader__.load({
  id: "dsh-deepseek-billing",
  factory: (require) => { /* ... */ exports.apply = apply; exports.inject = ["slots", "locale", "sessions"]; return module.exports; }
});
```

`require('react')` 复用宿主已加载的 React（`peerDependencies` 声明 `react`）。注入 `slots`（注册设置区块）、`locale`（词典 + 实时翻译）与 `sessions`（按本地命令回执定位对应会话的输入提示出口）。

### 6.2 空白会话中的命令提示

DSH 把纯通用 `command` 节点视为控制面内容，因此仅有命令事件的新会话会留在 Hero，持久命令卡不会挂载。插件监听本地客户端执行确认事件 `command/executed`：

- 只处理 `name === 'deepseek-billing'`、回执到达时仍为当前选中会话、会话仍为 `composerPhase === 'blank'` 且带非空 `result.text` 的本地回执；active 会话继续只显示持久命令卡，避免重复反馈；
- 经 `sessions.scope(sessionId)` 找到准确的会话上下文；
- 成功文本调用 `notify('info', text)`，错误文本调用 `notify('error', text)`；
- notice 在会话从 blank 激活或 60 秒到期时自动清除；离开会话时也只清除插件自己发布且尚未被覆盖的精确 notice，导航后才返回的旧回执直接丢弃；
- 提示使用 DSH 原有输入框 notice UI，不激活会话、不复制余额请求，也不影响其他浏览器标签页。

### 6.3 组件状态机

`BillingSection` 用 `useState` 维护单一状态对象：

```text
{ loading, refreshing, result, updatedAt }
```

- **初始加载**：`result === undefined` 且非刷新 → `loading: true`，显示 `t('loading')`。
- **刷新**：已有结果时点「刷新」→ `refreshing: true`，保留旧结果继续展示。
- **成功**：`result = { ok: true, balance }`。
- **失败**：`result = { ok: false, code }`，渲染错误态。
- **空**：`result.ok` 但 `balance === null` → 显示 `t('empty')`。

### 6.4 请求生命周期与竞态防护

`requestRef` 持有当前 `AbortController`：

1. 每次新请求前 `requestRef.current.abort()` 取消旧请求。
2. 组件卸载时（`useEffect` cleanup）`abort()` 并置空。
3. 回调里比对 `requestRef.current !== controller`，过期响应直接丢弃。
4. `AbortError` 的拒绝静默忽略（是主动取消，不是错误）。

这保证「旧请求结果不会覆盖新请求状态」。

### 6.5 错误码 → 文案

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

### 6.6 样式

- CSS 类名统一 `ds-billing-` 前缀。
- 颜色全部用 `currentColor` + `color-mix(in srgb, currentColor X%, transparent)`，自动适配明暗主题。
- `@media (max-width: 620px)` 下 header 纵向堆叠、breakdown 改纵向。
- 保留 `:focus-visible` 焦点环、`:disabled` 状态、`role="status"/"alert"` 与 `aria-label`。
