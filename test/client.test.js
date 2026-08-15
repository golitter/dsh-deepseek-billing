import assert from 'node:assert/strict'
import test from 'node:test'

test('client injects required services and keeps locale keys identical', async () => {
  const previousWindow = globalThis.window
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const timers = new Map()
  let nextTimerId = 1
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimerId++
    timers.set(id, { callback, delay })
    return id
  }
  globalThis.clearTimeout = (id) => {
    timers.delete(id)
  }
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
      if (id === 'react') return {
        createElement(type, props, ...children) {
          return { type, props, children }
        },
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {
        DisclosureRow: 'DisclosureRow',
        IconApiOutline14: 'IconApiOutline14',
        StateDot: 'StateDot',
      }
      assert.fail(`unexpected client dependency: ${id}`)
    })
    assert.deepEqual(clientModule.inject, ['slots', 'locale', 'sessions'])

    let namespace
    let dictionaries
    let settingsSlot
    let commandSlot
    let commandExecuted
    const notices = []
    const listListeners = new Set()
    const sessionListeners = new Set()
    let currentSession = 'session-1'
    let sessionPhase = 'blank'
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
            return {
              session: {
                getSnapshot: () => ({ composerPhase: sessionPhase }),
                subscribe(listener) {
                  sessionListeners.add(listener)
                  return () => sessionListeners.delete(listener)
                },
              },
            }
          }
          if (sessionId === 'session-2') {
            return {
              session: {
                getSnapshot: () => ({ composerPhase: 'active' }),
                subscribe() {
                  return () => {}
                },
              },
            }
          }
          return undefined
        },
        scope(sessionId) {
          return sessionId === 'session-1' ? sessionCtx : undefined
        },
      },
      slots: {
        inject(name, register) {
          assert.ok(name === 'settings.section' || name === 'conversation.chat.commandview')
          return register()
        },
        register(config, component) {
          if (config.name === 'settings.section') settingsSlot = { config, component }
          if (config.name === 'conversation.chat.commandview') commandSlot = { config, component }
          return () => {}
        },
      },
    }

    clientModule.apply(ctx)

    assert.equal(namespace, 'settings.billing')
    assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
    assert.equal(settingsSlot.config.label(), 'nav')
    assert.equal(typeof settingsSlot.component, 'function')
    assert.equal(commandSlot.config.key, 'deepseek-billing')
    assert.equal(typeof commandSlot.component, 'function')

    const blankCommand = { kind: 'command', seq: 1, name: 'deepseek-billing', outcome: { kind: 'success', text: 'CNY 16.70' } }
    const userMessage = { kind: 'user-message', seq: 3 }
    const afterActivation = { kind: 'command', seq: 4, name: 'deepseek-billing', outcome: { kind: 'success', text: 'CNY 16.66' } }
    const useSession = (selector) => selector({ nodes: [blankCommand, userMessage, afterActivation] })
    const commandOnlyTransition = (selector) => selector({ nodes: [blankCommand] })
    assert.equal(commandSlot.component({ node: blankCommand, useSession: commandOnlyTransition }), null)
    assert.equal(commandSlot.component({ node: blankCommand, useSession }), null)
    const visibleCommand = commandSlot.component({ node: afterActivation, useSession })
    assert.equal(visibleCommand.type, 'DisclosureRow')
    assert.equal(visibleCommand.props.icon.type, 'IconApiOutline14')
    assert.equal(visibleCommand.props.collapsedContent.at(-1).children[0], 'CNY 16.66')

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
    assert.equal(timers.size, 1)

    const [expiryId, expiry] = timers.entries().next().value
    assert.equal(expiry.delay, 60_000)
    timers.delete(expiryId)
    expiry.callback()
    assert.equal(currentNotice, null)

    commandExecuted('session-1', 'deepseek-billing', { kind: 'success', text: 'balance before activation' })
    assert.equal(currentNotice?.text, 'balance before activation')
    sessionPhase = 'active'
    for (const listener of sessionListeners) listener()
    assert.equal(currentNotice, null)
    assert.equal(timers.size, 0)

    sessionPhase = 'blank'
    commandExecuted('session-1', 'deepseek-billing', { kind: 'success', text: 'balance before navigation' })
    assert.equal(currentNotice?.text, 'balance before navigation')

    currentSession = 'session-2'
    for (const listener of listListeners) listener()
    assert.equal(currentNotice, null)
    assert.equal(timers.size, 0)

    // A result that arrives after navigation must not be retained on the
    // reusable blank session and reappear when New Session is opened again.
    commandExecuted('session-1', 'deepseek-billing', { kind: 'success', text: 'stale balance' })
    assert.equal(currentNotice, null)
    currentSession = 'session-1'
    for (const listener of listListeners) listener()
    assert.equal(currentNotice, null)
  } finally {
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
