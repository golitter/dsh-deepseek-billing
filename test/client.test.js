import assert from 'node:assert/strict'
import test from 'node:test'

test('client injects required services and keeps locale keys identical', async () => {
  const previousWindow = globalThis.window
  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }

  try {
    await import('../lib/client.js?client-contract-test')
    assert.equal(definition.id, 'dsh-deepseek-billing')

    const clientModule = definition.factory((id) => {
      assert.equal(id, 'react')
      return {}
    })
    assert.deepEqual(clientModule.inject, ['slots', 'locale', 'sessions'])

    let namespace
    let dictionaries
    let slot
    let commandExecuted
    const notices = []
    const listListeners = new Set()
    let currentSession = 'session-1'
    let currentNotice = null
    const noticeStore = {
      getSnapshot() {
        return currentNotice
      },
      set(value) {
        currentNotice = value
      },
    }
    const input = {
      notices: noticeStore,
      notify(level, text) {
        const notice = { level, text, seq: notices.length + 1 }
        notices.push({ level, text })
        noticeStore.set(notice)
      },
    }
    const sessionCtx = {
      get(name) {
        if (name !== 'conversation') return undefined
        return {
          input: {
            for(actual) {
              assert.equal(actual, sessionCtx)
              return input
            },
          },
        }
      },
    }
    const ctx = {
      effect(register) {
        return register()
      },
      on(name, listener) {
        assert.equal(name, 'command/executed')
        commandExecuted = listener
        return () => {}
      },
      locale: {
        register(nextNamespace, nextDictionaries) {
          namespace = nextNamespace
          dictionaries = nextDictionaries
          return () => {}
        },
        bind() {
          return (key) => key
        },
        subscribe() {},
        getSnapshot() {
          return { active: 'zh' }
        },
      },
      sessions: {
        list: {
          getSnapshot() {
            return { current: currentSession }
          },
          subscribe(listener) {
            listListeners.add(listener)
            return () => listListeners.delete(listener)
          },
        },
        binding(sessionId) {
          if (sessionId === 'session-1') {
            return { session: { getSnapshot: () => ({ composerPhase: 'blank' }) } }
          }
          if (sessionId === 'session-2') {
            return { session: { getSnapshot: () => ({ composerPhase: 'active' }) } }
          }
          return undefined
        },
        scope(sessionId) {
          return sessionId === 'session-1' ? sessionCtx : undefined
        },
      },
      slots: {
        inject(name, register) {
          assert.equal(name, 'settings.section')
          return register()
        },
        register(config, component) {
          slot = { config, component }
          return () => {}
        },
      },
    }

    clientModule.apply(ctx)

    assert.equal(namespace, 'settings.billing')
    assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
    assert.equal(slot.config.label(), 'nav')
    assert.equal(typeof slot.component, 'function')

    commandExecuted('session-1', 'goal', { kind: 'success', text: 'ignored' })
    commandExecuted('session-1', 'deepseek-billing', { kind: 'success' })
    commandExecuted('missing-session', 'deepseek-billing', { kind: 'success', text: 'ignored' })
    commandExecuted('session-2', 'deepseek-billing', { kind: 'success', text: 'already visible in the command card' })
    commandExecuted('session-1', 'deepseek-billing', { kind: 'success', text: '可用余额 CNY 16.77' })
    commandExecuted('session-1', 'deepseek-billing', { kind: 'error', text: '未配置 DeepSeek API 密钥' })
    assert.deepEqual(notices, [
      { level: 'info', text: '可用余额 CNY 16.77' },
      { level: 'error', text: '未配置 DeepSeek API 密钥' },
    ])
    assert.equal(currentNotice?.text, '未配置 DeepSeek API 密钥')

    currentSession = 'session-2'
    for (const listener of listListeners) listener()
    assert.equal(currentNotice, null)

    // A result that arrives after navigation must not be retained on the
    // reusable blank session and reappear when New Session is opened again.
    commandExecuted('session-1', 'deepseek-billing', { kind: 'success', text: 'stale balance' })
    assert.equal(currentNotice, null)
    currentSession = 'session-1'
    for (const listener of listListeners) listener()
    assert.equal(currentNotice, null)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
