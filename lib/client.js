window.__ModuleLoader__.load({
  id: "dsh-deepseek-billing",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    function apply(ctx) {
      const css = `
      .ds-billing { width: 100%; max-width: 668px; color: inherit; }
      .ds-billing * { box-sizing: border-box; }
      .ds-billing-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 10px 0 24px; border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
      .ds-billing .ds-billing-title { margin: 0 0 4px; color: inherit; font-size: 18px; line-height: 1.4; font-weight: 500; }
      .ds-billing-description { margin: 0; color: inherit; opacity: .58; font-size: 14px; line-height: 1.6; }
      .ds-billing-refresh { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 15px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 999px; background: color-mix(in srgb, currentColor 4%, transparent); color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
      .ds-billing-refresh:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
      .ds-billing-refresh:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
      .ds-billing-refresh:disabled { cursor: default; opacity: .55; }
      .ds-billing-refresh-icon { font-size: 18px; line-height: 1; }
      .ds-billing-body { padding-top: 28px; }
      .ds-billing-balance { padding-bottom: 26px; }
      .ds-billing-eyebrow { margin-bottom: 8px; color: inherit; opacity: .58; font-size: 14px; }
      .ds-billing-amount { display: flex; align-items: baseline; gap: 10px; font-variant-numeric: tabular-nums; }
      .ds-billing-currency { color: inherit; opacity: .68; font-size: 16px; font-weight: 500; }
      .ds-billing-value { font-size: 32px; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
      .ds-billing-breakdown { display: flex; flex-wrap: wrap; gap: 8px 28px; padding-top: 20px; border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
      .ds-billing-metric { display: flex; align-items: baseline; gap: 8px; }
      .ds-billing-metric-label { color: inherit; opacity: .58; font-size: 14px; }
      .ds-billing-metric-value { font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
      .ds-billing-updated { margin-top: 14px; color: inherit; opacity: .45; font-size: 12px; }
      .ds-billing-status { display: flex; min-height: 120px; align-items: center; justify-content: center; padding: 24px; color: inherit; opacity: .62; text-align: center; }
      .ds-billing-error { color: inherit; }
      .ds-billing-error-title { margin-bottom: 6px; font-size: 16px; font-weight: 600; }
      .ds-billing-error-message { max-width: 520px; color: inherit; opacity: .58; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
      @media (max-width: 620px) {
        .ds-billing-header { align-items: stretch; flex-direction: column; gap: 16px; }
        .ds-billing-refresh { align-self: flex-start; }
        .ds-billing-breakdown { align-items: flex-start; flex-direction: column; }
      }
    `

      function BillingSection() {
        const [state, setState] = React.useState({ loading: true, refreshing: false })
        const requestRef = React.useRef(null)

        const loadBalance = React.useCallback((refreshing) => {
          setState((previous) => ({
            loading: !refreshing && previous.result === undefined,
            refreshing: Boolean(refreshing),
            result: previous.result,
            updatedAt: previous.updatedAt,
          }))
          if (requestRef.current) requestRef.current.abort()
          const controller = new AbortController()
          requestRef.current = controller

          fetch('/api/deepseek-billing/balance', {
            headers: { accept: 'application/json' },
            signal: controller.signal,
          })
            .then(async (response) => {
              const result = await response.json().catch(() => null)
              if (!response.ok) {
                throw new Error(result?.error || `请求失败（HTTP ${response.status}）`)
              }
              return result
            })
            .then(
              (result) => {
                if (requestRef.current !== controller) return
                requestRef.current = null
                setState({ loading: false, refreshing: false, result, updatedAt: new Date() })
              },
              (error) => {
                if (requestRef.current !== controller || error?.name === 'AbortError') return
                requestRef.current = null
                setState({
                  loading: false,
                  refreshing: false,
                  result: { ok: false, error: String(error?.message || error) },
                  updatedAt: new Date(),
                })
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

        const result = state.result
        const balance = result && result.ok ? result.balance : null
        const currency = balance && balance.currency ? balance.currency : 'CNY'
        const amount = (value) => currency + ' ' + (value === null || value === undefined ? '—' : value)

        let content
        if (state.loading) {
          content = React.createElement('div', { className: 'ds-billing-status', role: 'status' }, '正在获取余额…')
        } else if (!result || !result.ok) {
          content = React.createElement('div', { className: 'ds-billing-status ds-billing-error', role: 'alert' },
            React.createElement('div', null,
              React.createElement('div', { className: 'ds-billing-error-title' }, '暂时无法获取余额'),
              React.createElement('div', { className: 'ds-billing-error-message' }, (result && result.error) || '请稍后重试'),
            ),
          )
        } else if (!balance) {
          content = React.createElement('div', { className: 'ds-billing-status' }, '暂无余额信息')
        } else {
          content = React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'ds-billing-balance' },
              React.createElement('div', null,
                React.createElement('div', { className: 'ds-billing-eyebrow' }, '可用余额'),
                React.createElement('div', { className: 'ds-billing-amount' },
                  React.createElement('span', { className: 'ds-billing-currency' }, currency),
                  React.createElement('span', { className: 'ds-billing-value' }, balance.total_balance),
                ),
              ),
              React.createElement('div', { className: 'ds-billing-breakdown' },
                React.createElement('div', { className: 'ds-billing-metric' },
                  React.createElement('div', { className: 'ds-billing-metric-label' }, '充值余额'),
                  React.createElement('div', { className: 'ds-billing-metric-value' }, amount(balance.topped_up_balance)),
                ),
                React.createElement('div', { className: 'ds-billing-metric' },
                  React.createElement('div', { className: 'ds-billing-metric-label' }, '赠送余额'),
                  React.createElement('div', { className: 'ds-billing-metric-value' }, amount(balance.granted_balance)),
                ),
              ),
              React.createElement('div', { className: 'ds-billing-updated' },
                '最后更新 ' + (state.updatedAt ? state.updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'),
              ),
            ),
          )
        }

        return React.createElement('section', { className: 'ds-billing' },
          React.createElement('style', null, css),
          React.createElement('header', { className: 'ds-billing-header' },
            React.createElement('div', null,
              React.createElement('h2', { className: 'ds-billing-title' }, '账户余额'),
              React.createElement('p', { className: 'ds-billing-description' }, '查看 DeepSeek API 账户当前的可用余额。'),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'ds-billing-refresh',
              disabled: state.loading || state.refreshing,
              onClick: () => loadBalance(true),
              'aria-label': state.refreshing ? '正在刷新余额' : '刷新余额',
            },
            React.createElement('span', { className: 'ds-billing-refresh-icon', 'aria-hidden': 'true' }, '↻'),
            state.refreshing ? '刷新中…' : '刷新'),
          ),
          React.createElement('div', { className: 'ds-billing-body' }, content),
        )
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'billing', order: 100, label: '计费' },
        BillingSection,
      ))
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
