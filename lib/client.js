window.__ModuleLoader__.load({
  id: "dsh-deepseek-billing",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { DisclosureRow, IconApiOutline14, StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");

    // Dictionary namespace owned by this plugin, registered against DSH's
    // locale service. The `zh` dictionary is the key-set source of truth; `en`
    // must stay key-identical.
    const NS = "settings.billing";
    const zh = {
      "nav": "计费",
      "title": "账户余额",
      "description": "查看 DeepSeek API 账户当前的可用余额。",
      "refresh": "刷新",
      "refresh.aria": "刷新余额",
      "refreshing": "刷新中…",
      "refreshing.aria": "正在刷新余额",
      "loading": "正在获取余额…",
      "empty": "暂无余额信息",
      "available": "可用余额",
      "toppedUp": "充值余额",
      "granted": "赠送余额",
      "updated": "最后更新 {time}",
      "refreshError.message": "刷新失败：{reason}",
      "error.title": "暂时无法获取余额",
      "error.billing_service_unavailable": "计费服务暂不可用",
      "error.balance_fetch_failed": "获取余额失败",
      "error.missing_credential": "未配置 DeepSeek API 密钥",
      "error.balance_timeout": "获取余额超时",
      "error.invalid_response": "余额接口返回异常数据",
      "error.generic": "发生未知错误"
    };
    const en = {
      "nav": "Billing",
      "title": "Account balance",
      "description": "View the current available balance of your DeepSeek API account.",
      "refresh": "Refresh",
      "refresh.aria": "Refresh balance",
      "refreshing": "Refreshing…",
      "refreshing.aria": "Refreshing balance",
      "loading": "Fetching balance…",
      "empty": "No balance information available",
      "available": "Available balance",
      "toppedUp": "Topped-up balance",
      "granted": "Granted balance",
      "updated": "Last updated {time}",
      "refreshError.message": "Refresh failed: {reason}",
      "error.title": "Unable to load balance",
      "error.billing_service_unavailable": "Billing service is temporarily unavailable",
      "error.balance_fetch_failed": "Failed to fetch balance",
      "error.missing_credential": "DeepSeek API key is not configured",
      "error.balance_timeout": "Balance request timed out",
      "error.invalid_response": "Balance endpoint returned unexpected data",
      "error.generic": "An unknown error occurred"
    };
    // Server-side error codes (stable, language-neutral) -> dictionary keys.
    const ERROR_KEY = {
      "billing_service_unavailable": "error.billing_service_unavailable",
      "balance_fetch_failed": "error.balance_fetch_failed",
      "missing_credential": "error.missing_credential",
      "balance_timeout": "error.balance_timeout",
      "invalid_response": "error.invalid_response"
    };
    const ERROR_CODES = new Set(Object.keys(ERROR_KEY));
    const BALANCE_FIELDS = ["currency", "total_balance", "granted_balance", "topped_up_balance"];

    function clientError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    }

    function knownErrorCode(value) {
      return typeof value === "string" && ERROR_CODES.has(value) ? value : null;
    }

    // Validate and copy the small public response contract before React sees
    // any balance field. The Host already applies the same allowlist; this is
    // client-side defense-in-depth for a malformed local route response.
    function normalizeClientBalance(balance) {
      if (balance === null) return null;
      if (typeof balance !== "object" || Array.isArray(balance)) {
        throw clientError("invalid_response", "invalid balance response");
      }
      if (BALANCE_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(balance, field)
        || typeof balance[field] !== "string"
        || balance[field].trim().length === 0)) {
        throw clientError("invalid_response", "invalid balance response");
      }
      return Object.fromEntries(BALANCE_FIELDS.map((field) => [field, balance[field]]));
    }

    function validateClientResponse(payload) {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload) || payload.ok !== true) {
        throw clientError("invalid_response", "invalid balance response");
      }
      return { ok: true, balance: normalizeClientBalance(payload.balance) };
    }

    async function parseClientResponse(response) {
      let payload = null;
      try {
        if (typeof response?.json !== "function") throw new Error("response is not JSON");
        payload = await response.json();
      } catch {
        payload = null;
      }
      const learned = learnedTimeoutMs(payload);
      if (learned !== null) requestTimeoutMs = learned;
      if (!response?.ok) {
        const code = knownErrorCode(payload?.code) || "balance_fetch_failed";
        throw clientError(code, `HTTP ${response?.status ?? "unknown"}`);
      }
      return validateClientResponse(payload);
    }

    // Generic command rows deliberately stay out of a fresh session's Hero.
    // Surface this command's local settlement through that session's
    // transient composer notice instead: the balance appears beside the
    // input while the session remains blank, and the Host command remains
    // the only request/credential path.
    const COMMAND_NAME = "deepseek-billing";
    const COMMAND_NOTICE_TTL_MS = 60_000;
    // Client-side bound for the local balance route. The Host timeout only
    // covers the upstream segment; this keeps a hung local connection from
    // leaving the page in "loading" forever with the refresh button disabled.
    // The bound starts at the Host's maximum upstream timeout plus margin so a
    // slow-but-configured upstream is never cut short by the client, then
    // aligns to the actual `timeoutMs` the Host reports in every response
    // envelope (learned from success, rejection and failure alike). The learned
    // value is clamped to the default so a bogus envelope can never widen the
    // bound into "no timer at all".
    // Cross-file contract: HOST_MAX_TIMEOUT_MS mirrors MAX_TIMEOUT_MS in
    // lib/index.js. If the Host ever raises its cap, update this constant in
    // the same change or the client default will cut slow upstreams short.
    const HOST_MAX_TIMEOUT_MS = 120_000;
    const TIMEOUT_MARGIN_MS = 5_000;
    const DEFAULT_REQUEST_TIMEOUT_MS = HOST_MAX_TIMEOUT_MS + TIMEOUT_MARGIN_MS;
    let requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    const learnedTimeoutMs = (payload) => {
      if (typeof payload?.timeoutMs !== 'number' || !Number.isFinite(payload.timeoutMs) || payload.timeoutMs <= 0) {
        return null;
      }
      return Math.min(payload.timeoutMs + TIMEOUT_MARGIN_MS, DEFAULT_REQUEST_TIMEOUT_MS);
    };

    // DSH's public input face guarantees notify(); current Web runtimes also
    // expose the mutable notice store used for exact, ownership-safe cleanup.
    // Keep that optional seam behind one guard so older/newer runtimes still
    // show the command result instead of failing the whole client plugin.
    function mutableNoticeStore(input) {
      const store = input?.notices;
      return typeof store?.getSnapshot === 'function' && typeof store?.set === 'function'
        ? store
        : null;
    }

    function apply(ctx) {
      const css = `
      .ds-billing { width: 100%; max-width: 668px; color: inherit; }
      .ds-billing * { box-sizing: border-box; }
      .ds-billing .ds-billing-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 10px 0 24px; border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
      .ds-billing .ds-billing-title { margin: 0 0 4px; color: inherit; font-size: 18px; line-height: 1.4; font-weight: 500; }
      .ds-billing .ds-billing-description { margin: 0; color: inherit; opacity: .58; font-size: 14px; line-height: 1.6; }
      .ds-billing .ds-billing-refresh { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 15px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 999px; background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
      .ds-billing .ds-billing-refresh:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
      .ds-billing .ds-billing-refresh:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
      .ds-billing .ds-billing-refresh:disabled { cursor: default; opacity: .55; }
      .ds-billing .ds-billing-refresh-icon { font-size: 18px; line-height: 1; }
      .ds-billing .ds-billing-body { padding-top: 28px; }
      .ds-billing .ds-billing-balance { padding-bottom: 26px; }
      .ds-billing .ds-billing-eyebrow { margin-bottom: 8px; color: inherit; opacity: .58; font-size: 14px; }
      .ds-billing .ds-billing-amount { display: flex; align-items: baseline; gap: 10px; font-variant-numeric: tabular-nums; }
      .ds-billing .ds-billing-currency { color: inherit; opacity: .68; font-size: 16px; font-weight: 500; }
      .ds-billing .ds-billing-value { font-size: 32px; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
      .ds-billing .ds-billing-breakdown { display: flex; flex-wrap: wrap; gap: 8px 28px; padding-top: 20px; border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
      .ds-billing .ds-billing-metric { display: flex; align-items: baseline; gap: 8px; }
      .ds-billing .ds-billing-metric-label { color: inherit; opacity: .58; font-size: 14px; }
      .ds-billing .ds-billing-metric-value { font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
      .ds-billing .ds-billing-updated { margin-top: 14px; color: inherit; opacity: .45; font-size: 12px; }
      .ds-billing .ds-billing-refresh-error { margin-top: 18px; color: inherit; opacity: .72; font-size: 14px; line-height: 1.6; }
      .ds-billing .ds-billing-status { display: flex; min-height: 120px; align-items: center; justify-content: center; padding: 24px; color: inherit; opacity: .62; text-align: center; }
      .ds-billing .ds-billing-error { color: inherit; }
      .ds-billing .ds-billing-error-title { margin-bottom: 6px; font-size: 16px; font-weight: 600; }
      .ds-billing .ds-billing-error-message { max-width: 520px; color: inherit; opacity: .58; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
      @media (max-width: 620px) {
        .ds-billing .ds-billing-header { align-items: stretch; flex-direction: column; gap: 16px; }
        .ds-billing .ds-billing-refresh { align-self: flex-start; }
        .ds-billing .ds-billing-breakdown { align-items: flex-start; flex-direction: column; }
      }
    `

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'deepseek-billing: dictionaries')
      const ownedNotices = new Map()
      const clearOwnedNotice = (sessionId) => {
        const owned = ownedNotices.get(sessionId)
        if (owned === undefined) return
        ownedNotices.delete(sessionId)
        clearTimeout(owned.timer)
        owned.unsubscribe()
        // The native notice channel is session-scoped and intentionally
        // persistent. Clear only the exact notice this plugin published so
        // an unrelated, newer notification is never removed.
        if (owned.store.getSnapshot() === owned.notice) owned.store.set(null)
      }
      let currentSessionId = ctx.sessions.list.getSnapshot().current
      ctx.effect(() => {
        const unsubscribe = ctx.sessions.list.subscribe(() => {
          const nextSessionId = ctx.sessions.list.getSnapshot().current
          if (nextSessionId === currentSessionId) return
          if (currentSessionId !== undefined) clearOwnedNotice(currentSessionId)
          currentSessionId = nextSessionId
        })
        return () => {
          unsubscribe()
          for (const sessionId of ownedNotices.keys()) clearOwnedNotice(sessionId)
        }
      }, 'deepseek-billing: transient command notice')
      ctx.effect(() => ctx.on('command/executed', (sessionId, commandName, result) => {
        if (commandName !== COMMAND_NAME || typeof result?.text !== 'string' || result.text.trim().length === 0) return
        if (ctx.sessions.list.getSnapshot().current !== sessionId) return
        const session = ctx.sessions.binding(sessionId)?.session
        if (session?.getSnapshot().blank !== true) return
        const sessionCtx = ctx.sessions.scope(sessionId)
        const conversation = sessionCtx?.get('conversation')
        if (conversation === undefined) return
        const input = conversation.input.for(sessionCtx)
        clearOwnedNotice(sessionId)
        input.notify(result.kind === 'error' ? 'error' : 'info', result.text)
        const noticeStore = mutableNoticeStore(input)
        const notice = noticeStore?.getSnapshot()
        if (noticeStore !== null && notice !== null && notice !== undefined) {
          const owned = { store: noticeStore, notice, timer: undefined, unsubscribe: () => {} }
          ownedNotices.set(sessionId, owned)
          owned.unsubscribe = session.subscribe(() => {
            if (session.getSnapshot().blank !== true) clearOwnedNotice(sessionId)
          })
          owned.timer = setTimeout(() => clearOwnedNotice(sessionId), COMMAND_NOTICE_TTL_MS)
        }
      }), 'deepseek-billing: command notices')
      const t = ctx.locale.bind(NS)
      // Stable LocaleFace source pair for useSyncExternalStore: a locale
      // switch bumps the snapshot revision, React re-renders, and `t` reads
      // the new active language at call time.
      const subscribeLocale = (listener) => ctx.locale.subscribe(listener)
      const getLocaleSnapshot = () => ctx.locale.getSnapshot()

      function BillingSection() {
        const localeSnapshot = React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot)
        const [state, setState] = React.useState({ loading: true, refreshing: false, result: undefined, error: undefined, updatedAt: undefined })
        const requestRef = React.useRef(null)

        const loadBalance = React.useCallback((refreshing) => {
          setState((previous) => ({
            loading: !refreshing && previous.result === undefined,
            refreshing: Boolean(refreshing),
            result: previous.result,
            error: undefined,
            updatedAt: previous.updatedAt,
          }))
          if (requestRef.current) requestRef.current.abort()
          const controller = new AbortController()
          requestRef.current = controller
          let timedOut = false
          const timeout = setTimeout(() => {
            timedOut = true
            controller.abort()
          }, requestTimeoutMs)

          fetch('/api/deepseek-billing/balance', {
            headers: { accept: 'application/json' },
            signal: controller.signal,
          })
            .then(parseClientResponse)
            .then(
              (result) => {
                clearTimeout(timeout)
                if (requestRef.current !== controller) return
                requestRef.current = null
                setState({ loading: false, refreshing: false, result, error: undefined, updatedAt: new Date() })
              },
              (error) => {
                clearTimeout(timeout)
                if (requestRef.current !== controller) return
                // A superseded/unload abort is silent; our own timeout abort
                // surfaces as the stable balance_timeout error state.
                if (error?.name === 'AbortError' && !timedOut) return
                requestRef.current = null
                const code = timedOut && error?.name === 'AbortError'
                  ? 'balance_timeout'
                  : knownErrorCode(error?.code) || 'balance_fetch_failed'
                setState((previous) => ({
                  loading: false,
                  refreshing: false,
                  result: previous.result,
                  error: { code },
                  updatedAt: previous.updatedAt,
                }))
              },
            )
        }, [])

        React.useEffect(() => {
          loadBalance(false)
          return () => {
            if (requestRef.current) requestRef.current.abort()
            requestRef.current = null
          }
        }, [loadBalance])

        const titleId = React.useId()
        const result = state.result
        const balance = result && result.ok ? result.balance : null
        const currency = balance && balance.currency ? balance.currency : 'CNY'
        const amount = (value) => currency + ' ' + (value === null || value === undefined ? '—' : value)
        const errorKey = (state.error && ERROR_KEY[state.error.code]) || 'error.generic'
        // A failed load with no settled result shows the full error card; a
        // failed refresh over stale data (including an empty balance) keeps
        // that data and only shows the inline banner below.
        const hasSettledResult = result !== undefined
        const refreshError = state.error && hasSettledResult
          ? t('refreshError.message', { reason: t(errorKey) })
          : null

        // Time format follows the active language: zh -> 19:31, en -> en-US.
        const isEnglish = localeSnapshot.active === 'en'
        const updatedTime = state.updatedAt
          ? state.updatedAt.toLocaleTimeString(isEnglish ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', hour12: isEnglish })
          : '—'

        let content
        if (state.loading || (state.refreshing && result === undefined)) {
          content = React.createElement('div', { className: 'ds-billing-status', role: 'status' }, t('loading'))
        } else if (result === undefined) {
          content = React.createElement('div', { className: 'ds-billing-status ds-billing-error', role: 'alert' },
            React.createElement('div', null,
              React.createElement('div', { className: 'ds-billing-error-title' }, t('error.title')),
              React.createElement('div', { className: 'ds-billing-error-message' }, t(errorKey)),
            ),
          )
        } else if (!balance) {
          content = React.createElement('div', { 'aria-live': 'polite' },
            React.createElement('div', { className: 'ds-billing-status' }, t('empty')),
            refreshError && React.createElement('div', { className: 'ds-billing-refresh-error' }, refreshError),
          )
        } else {
          content = React.createElement('div', { 'aria-live': 'polite' },
            React.createElement('div', { className: 'ds-billing-balance' },
              React.createElement('div', null,
                React.createElement('div', { className: 'ds-billing-eyebrow' }, t('available')),
                React.createElement('div', { className: 'ds-billing-amount' },
                  React.createElement('span', { className: 'ds-billing-currency' }, currency),
                  React.createElement('span', { className: 'ds-billing-value' }, balance.total_balance),
                ),
              ),
              React.createElement('div', { className: 'ds-billing-breakdown' },
                React.createElement('div', { className: 'ds-billing-metric' },
                  React.createElement('div', { className: 'ds-billing-metric-label' }, t('toppedUp')),
                  React.createElement('div', { className: 'ds-billing-metric-value' }, amount(balance.topped_up_balance)),
                ),
                React.createElement('div', { className: 'ds-billing-metric' },
                  React.createElement('div', { className: 'ds-billing-metric-label' }, t('granted')),
                  React.createElement('div', { className: 'ds-billing-metric-value' }, amount(balance.granted_balance)),
                ),
              ),
              React.createElement('div', { className: 'ds-billing-updated' }, t('updated', { time: updatedTime })),
            ),
            refreshError && React.createElement('div', { className: 'ds-billing-refresh-error' }, refreshError),
          )
        }

        return React.createElement('section', {
          className: 'ds-billing',
          'aria-labelledby': titleId,
        },
          React.createElement('style', null, css),
          React.createElement('header', { className: 'ds-billing-header' },
            React.createElement('div', null,
              React.createElement('h2', { id: titleId, className: 'ds-billing-title' }, t('title')),
              React.createElement('p', { className: 'ds-billing-description' }, t('description')),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'ds-billing-refresh',
              disabled: state.loading || state.refreshing,
              onClick: () => loadBalance(true),
              'aria-label': state.refreshing ? t('refreshing.aria') : t('refresh.aria'),
            },
            React.createElement('span', { className: 'ds-billing-refresh-icon', 'aria-hidden': 'true' }, '↻'),
            state.refreshing ? t('refreshing') : t('refresh')),
          ),
          React.createElement('div', {
            className: 'ds-billing-body',
            'aria-busy': state.loading || state.refreshing,
          }, content),
        )
      }

      function BillingCommandRow({ node, useChat }) {
        const hiddenFromBlankSession = useChat((snapshot) => {
          const firstConversationNode = snapshot.legacy.nodes.find((candidate) => candidate.kind !== 'command')
          // During blank -> active admission the chat shell can mount one
          // frame before the first ordinary node is published. Treat that
          // command-only transition as blank-origin too, avoiding a flash.
          return firstConversationNode === undefined || node.seq < firstConversationNode.seq
        })
        if (hiddenFromBlankSession) return null

        const running = node.outcome === null
        const text = running ? '…' : node.outcome.text ?? '—'
        const error = node.outcome?.kind === 'error'
        return React.createElement(DisclosureRow, {
          icon: error
            ? React.createElement(StateDot, { state: 'error' })
            : React.createElement(IconApiOutline14, { size: 14 }),
          title: COMMAND_NAME,
          open: false,
          expandable: false,
          onToggle: () => {},
          collapsedContent: [
            React.createElement('span', {
              key: 'separator',
              'aria-hidden': 'true',
              style: { flex: 'none', width: '2px', height: '2px', margin: '0 8px', borderRadius: '1px', background: 'var(--dsw-alias-label-caption)' },
            }),
            React.createElement('span', {
              key: 'summary',
              style: { minWidth: 0, overflow: 'hidden', flex: '1 1 auto', color: error ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)', fontSize: '14px', lineHeight: '24px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, text),
          ],
        })
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'deepseek-billing', order: 100, label: () => t('nav') },
        BillingSection,
      ))
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
        { name: 'conversation.chat.commandview', key: COMMAND_NAME },
        BillingCommandRow,
      ))
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "sessions"];
    return module.exports;
  }
});
