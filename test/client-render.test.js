import assert from 'node:assert/strict'
import test from 'node:test'

function createHookHarness() {
  const hooks = []
  let cursor = 0

  const sameDeps = (left, right) => left !== undefined
    && right !== undefined
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor += 1
      return getSnapshot()
    },
    useId() {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = `«r${index}»`
      return hooks[index]
    },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
      }
      return [hooks[index], setState]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useCallback(callback, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) hooks[index] = { value: callback, deps }
      return hooks[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (previous !== undefined && sameDeps(previous.deps, deps)) return
      previous?.cleanup?.()
      hooks[index] = { deps, cleanup: effect() }
    },
  }

  return {
    React,
    render(Component) {
      cursor = 0
      return Component()
    },
    cleanup() {
      for (const hook of hooks) hook?.cleanup?.()
    },
  }
}

function textContent(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join(' ')
  return textContent(node.children)
}

function findElement(node, predicate) {
  if (node === null || node === undefined) return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node !== 'object') return undefined
  if (predicate(node)) return node
  return findElement(node.children, predicate)
}

function deferredFetchCalls() {
  const calls = []
  const fetch = (_url, options) => new Promise((resolve, reject) => {
    const call = { options, resolve, reject }
    calls.push(call)
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
  return { calls, fetch }
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const invalidJsonResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError('invalid JSON') },
})

const flush = () => new Promise((resolve) => setImmediate(resolve))

let renderFixtureSequence = 0

async function createRenderFixture() {
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const harness = createHookHarness()
  const pending = deferredFetchCalls()
  let definition
  let dictionaries
  let BillingSection
  let activeLocale = 'zh'

  globalThis.fetch = pending.fetch
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }

  await import(`../lib/client.js?client-render-test-${++renderFixtureSequence}`)
  const clientModule = definition.factory((id) => {
    if (id === 'react') return harness.React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { DisclosureRow: 'DisclosureRow', IconApiOutline14: 'IconApiOutline14', StateDot: 'StateDot' }
    }
    assert.fail(`unexpected client dependency: ${id}`)
  })

  const ctx = {
    effect(register) {
      return register()
    },
    on() {
      return () => {}
    },
    locale: {
      register(_namespace, value) {
        dictionaries = value
        return () => {}
      },
      bind() {
        return (key, params) => {
          const template = dictionaries[activeLocale][key] ?? key
          return template.replace(/\{(\w+)\}/g, (match, name) => name in (params ?? {}) ? String(params[name]) : match)
        }
      },
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return { active: activeLocale }
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ current: undefined }),
        subscribe: () => () => {},
      },
    },
    slots: {
      inject(_name, register) {
        return register()
      },
      register(config, component) {
        if (config.name === 'settings.section') BillingSection = component
        return () => {}
      },
    },
  }

  clientModule.apply(ctx)
  return {
    harness,
    pending,
    BillingSection,
    render: () => harness.render(BillingSection),
    setLocale(next) {
      activeLocale = next
    },
    cleanup() {
      harness.cleanup()
      globalThis.fetch = previousFetch
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    },
  }
}

function bodyNode(tree) {
  return findElement(tree, (node) => node.type === 'div' && node.props.className === 'ds-billing-body')
}

function liveRegion(tree) {
  return findElement(tree, (node) => node.props?.['aria-live'] === 'polite')
}

const validBalance = (total_balance = '12.34') => ({
  ok: true,
  balance: {
    currency: 'CNY',
    total_balance,
    granted_balance: '2.34',
    topped_up_balance: '10.00',
  },
})

test('billing section renders loading, cancellation, validated success and ARIA state', async () => {
  const fixture = await createRenderFixture()
  try {
    let tree = fixture.render()
    assert.match(textContent(tree), /正在获取余额/)
    assert.equal(fixture.pending.calls.length, 1)
    assert.equal(bodyNode(tree).props['aria-busy'], true)
    assert.equal(bodyNode(tree).props['aria-labelledby'], undefined)

    const loadingRefresh = findElement(tree, (node) => node.type === 'button')
    loadingRefresh.props.onClick()
    assert.equal(fixture.pending.calls[0].options.signal.aborted, true)
    assert.equal(fixture.pending.calls.length, 2)

    fixture.pending.calls[1].resolve(response(200, validBalance()))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /可用余额/)
    assert.match(textContent(tree), /12\.34/)
    assert.match(textContent(tree), /充值余额/)
    assert.match(textContent(tree), /赠送余额/)
    const titleNode = findElement(tree, (node) => node.props?.className === 'ds-billing-title')
    assert.equal(typeof titleNode.props.id, 'string')
    assert.equal(tree.props['aria-labelledby'], titleNode.props.id)
    assert.equal(bodyNode(tree).props['aria-busy'], false)
    assert.equal(liveRegion(tree).props['aria-live'], 'polite')
    assert.equal(findElement(tree, (node) => node.props?.role === 'alert'), undefined)
  } finally {
    fixture.cleanup()
  }
})

test('billing section distinguishes empty success from malformed or unknown error responses', async () => {
  const fixture = await createRenderFixture()
  try {
    let tree = fixture.render()
    fixture.pending.calls[0].resolve(response(200, { ok: true, balance: null }))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /暂无余额信息/)
    assert.equal(findElement(tree, (node) => node.props?.role === 'alert'), undefined)

    findElement(tree, (node) => node.type === 'button').props.onClick()
    fixture.pending.calls[1].resolve(response(200, {
      ok: true,
      balance: { currency: 'CNY', total_balance: '12.34' },
    }))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /暂无余额信息/)
    assert.match(textContent(tree), /刷新失败：余额接口返回异常数据/)
    assert.doesNotMatch(textContent(tree), /12\.34/)

    findElement(tree, (node) => node.type === 'button').props.onClick()
    fixture.pending.calls[2].resolve(response(200, {
      ok: true,
      balance: {
        currency: 'CNY',
        total_balance: 12.34,
        granted_balance: '2.34',
        topped_up_balance: '10.00',
      },
    }))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /刷新失败：余额接口返回异常数据/)

    findElement(tree, (node) => node.type === 'button').props.onClick()
    fixture.pending.calls[3].resolve(invalidJsonResponse())
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /刷新失败：余额接口返回异常数据/)

    findElement(tree, (node) => node.type === 'button').props.onClick()
    fixture.pending.calls[4].resolve(response(502, { ok: false, code: 'unknown_code' }))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /刷新失败：获取余额失败/)
    assert.doesNotMatch(textContent(tree), /unknown_code/)
  } finally {
    fixture.cleanup()
  }
})

test('refresh failure keeps the last successful balance and translates immediately', async () => {
  const fixture = await createRenderFixture()
  try {
    let tree = fixture.render()
    fixture.pending.calls[0].resolve(response(200, validBalance()))
    await flush()
    tree = fixture.render()
    const firstUpdatedText = textContent(tree).match(/最后更新[^↻]+/)?.[0]
    findElement(tree, (node) => node.type === 'button').props.onClick()
    assert.equal(bodyNode(fixture.render()).props['aria-busy'], true)
    assert.match(textContent(fixture.render()), /刷新中/)
    fixture.pending.calls[1].resolve(response(502, { ok: false, code: 'missing_credential' }))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /12\.34/)
    assert.match(textContent(tree), /刷新失败：未配置 DeepSeek API 密钥/)
    assert.equal(bodyNode(tree).props['aria-busy'], false)
    assert.equal(findElement(tree, (node) => node.props?.role === 'alert'), undefined)
    assert.equal(textContent(tree).includes(firstUpdatedText), true)

    fixture.setLocale('en')
    tree = fixture.render()
    assert.match(textContent(tree), /Available balance/)
    assert.match(textContent(tree), /Refresh failed: DeepSeek API key is not configured/)
    assert.match(textContent(tree), /Last updated/)

    findElement(tree, (node) => node.type === 'button').props.onClick()
    fixture.pending.calls[2].resolve(response(200, validBalance('11.11')))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /11\.11/)
    assert.doesNotMatch(textContent(tree), /Refresh failed/)
  } finally {
    fixture.cleanup()
  }
})

test('request timeout surfaces the stable balance_timeout error state', async () => {
  const fixture = await createRenderFixture()
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const timers = []
  globalThis.setTimeout = (callback, delay) => {
    timers.push({ callback, delay })
    return {}
  }
  globalThis.clearTimeout = () => {}
  try {
    const tree = fixture.render()
    assert.equal(fixture.pending.calls.length, 1)
    assert.match(textContent(tree), /正在获取余额/)

    // Before the Host reports its timeout, the client bound is the Host
    // maximum (120s) plus margin — never shorter than the Host timeout.
    assert.equal(timers.length, 1)
    assert.equal(timers[0].delay, 125_000)

    // Fire the client-side request timer: the controller aborts, the fetch
    // rejects with AbortError, and the page settles on balance_timeout.
    timers[0].callback()
    await flush()

    assert.equal(fixture.pending.calls[0].options.signal.aborted, true)
    const settled = fixture.render()
    assert.doesNotMatch(textContent(settled), /正在获取余额/)
    assert.match(textContent(settled), /暂时无法获取余额/)
    assert.match(textContent(settled), /获取余额超时/)

    // A later manual refresh still works; its error envelope carries the
    // Host timeout, so the next request aligns to timeoutMs + margin.
    findElement(settled, (node) => node.type === 'button').props.onClick()
    assert.equal(fixture.pending.calls.length, 2)
    assert.equal(timers[1].delay, 125_000)
    fixture.pending.calls[1].resolve(response(502, {
      ok: false,
      code: 'billing_service_unavailable',
      timeoutMs: 10_000,
    }))
    await flush()
    assert.match(textContent(fixture.render()), /暂时无法获取余额/)

    findElement(fixture.render(), (node) => node.type === 'button').props.onClick()
    assert.equal(fixture.pending.calls.length, 3)
    assert.equal(timers[2].delay, 15_000)
    fixture.pending.calls[2].resolve(response(200, validBalance()))
    await flush()
    assert.match(textContent(fixture.render()), /12\.34/)

    // A bogus oversized timeoutMs in an envelope can never widen the request
    // bound past the client default — the timer stays effective.
    findElement(fixture.render(), (node) => node.type === 'button').props.onClick()
    assert.equal(fixture.pending.calls.length, 4)
    assert.equal(timers[3].delay, 15_000)
    fixture.pending.calls[3].resolve(response(502, {
      ok: false,
      code: 'billing_service_unavailable',
      timeoutMs: 1e12,
    }))
    await flush()
    findElement(fixture.render(), (node) => node.type === 'button').props.onClick()
    assert.equal(fixture.pending.calls.length, 5)
    assert.equal(timers[4].delay, 125_000)
    fixture.pending.calls[4].resolve(response(200, validBalance()))
    await flush()
  } finally {
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
    fixture.cleanup()
  }
})

test('initial failure stays a full error state and unmount cancels the retry', async () => {
  const fixture = await createRenderFixture()
  try {
    let tree = fixture.render()
    fixture.pending.calls[0].resolve(response(502, { ok: false, code: 'missing_credential' }))
    await flush()
    tree = fixture.render()
    assert.match(textContent(tree), /暂时无法获取余额/)
    assert.match(textContent(tree), /未配置 DeepSeek API 密钥/)
    assert.equal(findElement(tree, (node) => node.props?.role === 'alert').props.role, 'alert')

    findElement(tree, (node) => node.type === 'button').props.onClick()
    assert.equal(fixture.pending.calls.length, 2)
    fixture.cleanup()
    assert.equal(fixture.pending.calls[1].options.signal.aborted, true)
  } finally {
    // cleanup is idempotent for the lightweight harness.
    fixture.cleanup()
  }
})
