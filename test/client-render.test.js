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

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('billing section renders refresh, cancellation, localized success and errors', async () => {
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

  try {
    await import('../lib/client.js?client-render-test')
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

    let tree = harness.render(BillingSection)
    assert.match(textContent(tree), /正在获取余额/)
    assert.equal(pending.calls.length, 1)

    const loadingRefresh = findElement(tree, (node) => node.type === 'button')
    loadingRefresh.props.onClick()
    assert.equal(pending.calls[0].options.signal.aborted, true)
    assert.equal(pending.calls.length, 2)

    pending.calls[1].resolve(response(200, {
      ok: true,
      balance: {
        currency: 'CNY',
        total_balance: '12.34',
        granted_balance: '2.34',
        topped_up_balance: '10.00',
      },
    }))
    await flush()
    tree = harness.render(BillingSection)
    assert.match(textContent(tree), /可用余额/)
    assert.match(textContent(tree), /12\.34/)
    assert.match(textContent(tree), /充值余额/)
    assert.match(textContent(tree), /赠送余额/)

    activeLocale = 'en'
    tree = harness.render(BillingSection)
    assert.match(textContent(tree), /Available balance/)
    assert.match(textContent(tree), /Topped-up balance/)

    const refresh = findElement(tree, (node) => node.type === 'button')
    refresh.props.onClick()
    assert.equal(pending.calls.length, 3)
    tree = harness.render(BillingSection)
    assert.match(textContent(tree), /Refreshing/)
    assert.match(textContent(tree), /12\.34/)

    pending.calls[2].resolve(response(502, { ok: false, code: 'missing_credential' }))
    await flush()
    tree = harness.render(BillingSection)
    assert.match(textContent(tree), /Unable to load balance/)
    assert.match(textContent(tree), /API key is not configured/)

    findElement(tree, (node) => node.type === 'button').props.onClick()
    assert.equal(pending.calls.length, 4)
    harness.cleanup()
    assert.equal(pending.calls[3].options.signal.aborted, true)
  } finally {
    globalThis.fetch = previousFetch
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
