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

`require('react')` 复用宿主已加载的 React（`peerDependencies` 声明 `react`）；命令结果行复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `DisclosureRow`、`IconApiOutline14` 与 `StateDot`，保持 DSH 默认命令卡的图标、字号、颜色和间距。注入 `slots`（注册设置区块）、`locale`（词典 + 实时翻译）与 `sessions`（按本地命令回执定位对应会话的输入提示出口）。

设置区块使用插件专属 ID `deepseek-billing`，避免与其他计费插件常用的通用 `billing` ID 冲突。

### 6.2 空白会话中的命令提示

DSH 把纯通用 `command` 节点视为控制面内容，因此仅有命令事件的新会话会留在 Hero，持久命令卡不会挂载。插件监听本地客户端执行确认事件 `command/executed`：

- 只处理 `name === 'deepseek-billing'`、回执到达时仍为当前选中会话、会话仍为 `composerPhase === 'blank'` 且带非空 `result.text` 的本地回执；active 会话继续只显示持久命令卡，避免重复反馈；
- 经 `sessions.scope(sessionId)` 找到准确的会话上下文；
- 成功文本调用 `notify('info', text)`，错误文本调用 `notify('error', text)`；
- notice 在会话从 blank 激活或 60 秒到期时自动清除；离开会话时也只清除插件自己发布且尚未被覆盖的精确 notice，导航后才返回的旧回执直接丢弃；
- 提示使用 DSH 原有输入框 notice UI，不激活会话、不复制余额请求，也不影响其他浏览器标签页。

宿主命令的 `command/run` / `command/done` 仍由 DSH 持久化。为防止空白阶段执行过的余额命令在会话激活后突然显示，插件为 `conversation.chat.commandview` 注册 `deepseek-billing` 专用渲染：命令独占快照的 blank → active 过渡帧直接返回 `null`；首个非 `command` 节点出现后，再比较 `seq`，更早的命令继续隐藏，之后执行的命令正常显示结果。该处理避免激活瞬间闪现，只改变本插件命令的客户端呈现，不修改或删除会话日志。

### 6.3 组件状态机

`BillingSection` 用 `useState` 维护单一状态对象：

```text
{ loading, refreshing, result, error, updatedAt }
```

- **初始加载**：`result === undefined` 且非刷新 → `loading: true`，显示 `t('loading')`。
- **刷新**：已有结果时点「刷新」→ `refreshing: true`，保留旧结果和 `updatedAt` 继续展示，并暂时清除上一次刷新错误。
- **成功**：`result = { ok: true, balance }`，清除 `error` 并以新的 `updatedAt` 记录成功时间。
- **首次失败**：`result === undefined`，`error = { code }`，渲染带 `role="alert"` 的完整错误态。
- **刷新失败**：已有 `result` 时只更新 `error = { code }`，保留余额和最后成功时间，在同一个礼貌级 live region 中追加非阻塞提示。
- **空**：`result.ok` 但 `balance === null` → 显示 `t('empty')`；它仍是成功结果，刷新失败时同样保留空态。

客户端在进入 React 状态前还会校验本地路由响应：成功响应必须是 `{ ok: true, balance: null }`，或包含四个非空字符串字段的余额对象；非 2xx 响应只接受五个固定错误码，未知或畸形错误码回退为 `balance_fetch_failed`。畸形 2xx 响应统一为 `invalid_response`，只复制白名单字段，不把原始 JSON 交给 UI。

### 6.4 无障碍状态与请求生命周期

section 使用 `aria-labelledby` 指向标题（标题 id 由 `React.useId()` 生成，避免多实例冲突），内容区根据首次加载或刷新设置 `aria-busy`。加载态使用礼貌级 `role="status"`，首次失败使用 `role="alert"`；成功、空态和刷新失败共享一个 `aria-live="polite"` 区域，避免同一消息被多个 live region 重复播报。刷新按钮保留 `aria-label`、键盘焦点环和禁用语义。

`requestRef` 持有当前 `AbortController`：

1. 每次新请求前 `requestRef.current.abort()` 取消旧请求。
2. 组件卸载时（`useEffect` cleanup）`abort()` 并置空。
3. 回调里比对 `requestRef.current !== controller`，过期响应直接丢弃。
4. 每个请求带客户端超时，防止本地连接挂起导致页面永远停留在加载态。初始值为宿主 `timeoutMs` 上限 `120s` + 5s 余量（保证首轮请求永不早于宿主超时；该常量与 `lib/index.js` 的 `MAX_TIMEOUT_MS` 构成跨文件契约，需同步修改），并从宿主通过 fence 后的响应 envelope 附带的 `timeoutMs` 学习实际配置，后续请求对齐为 `timeoutMs + 5s`（成功、405/429/502 都可学习，并钳制在默认上限内，防止畸形超大值让定时器失效；畸形值忽略）。超时触发 `controller.abort()`，并在回调里区分为稳定的 `balance_timeout` 错误态，而不是静默取消。
5. 其余 `AbortError` 的拒绝静默忽略（是主动取消，不是错误）。

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

首次错误态渲染：标题 `t('error.title')` + 正文 `t(errorKey)`；已有成功结果时渲染 `t('refreshError.message', { reason: t(errorKey) })`，不清除上一次成功余额。

### 6.6 样式

- CSS 类名统一 `ds-billing-` 前缀，子选择器同时限定在 `.ds-billing` 根节点内，避免样式命中其他插件。
- 颜色全部用 `currentColor` + `color-mix(in srgb, currentColor X%, transparent)`，自动适配明暗主题。
- `@media (max-width: 620px)` 下 header 纵向堆叠、breakdown 改纵向。
- 保留 `:focus-visible` 焦点环、`:disabled` 状态、`role="status"/"alert"` 与 `aria-label`。
