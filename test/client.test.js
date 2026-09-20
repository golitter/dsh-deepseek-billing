import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

let fixtureSequence = 0

function createReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props, children }
    },
  }
}

async function createClientFixture({ fakeTimers = false } = {}) {
  const previousWindow = globalThis.window
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const timers = new Map()
  let nextTimerId = 1
  if (fakeTimers) {
    globalThis.setTimeout = (callback, delay) => {
      const id = nextTimerId++
      timers.set(id, { callback, delay })
      return id
    }
    globalThis.clearTimeout = (id) => {
      timers.delete(id)
    }
  }

  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }

  const effects = []
  const namespaceState = { namespace: undefined, dictionaries: undefined }
  const slots = { settings: undefined, command: undefined }
  const listListeners = new Set()
  const sessionListeners = new Set()
  let currentSession = 'session-1'
  let sessionPhase = 'blank'
  let activeLocale = 'zh'
  let commandExecuted
  let currentNotice = null
  const notices = []
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

  try {
    await import(`../lib/client.js?client-contract-test-${++fixtureSequence}`)
    const clientModule = definition.factory((id) => {
      if (id === 'react') return createReact()
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { DisclosureRow: 'DisclosureRow', IconApiOutline14: 'IconApiOutline14', StateDot: 'StateDot' }
      }
      assert.fail(`unexpected client dependency: ${id}`)
    })
    const ctx = {
      effect(register) {
        const cleanup = register()
        if (typeof cleanup === 'function') effects.push(cleanup)
        return cleanup
      },
      on(name, listener) {
        assert.equal(name, 'command/executed')
        commandExecuted = listener
        return () => {}
      },
      locale: {
        register(nextNamespace, dictionaries) {
          namespaceState.namespace = nextNamespace
          namespaceState.dictionaries = dictionaries
          return () => {}
        },
        bind() {
          return (key, params) => {
            const template = namespaceState.dictionaries[activeLocale][key] ?? key
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
                getSnapshot: () => ({ blank: sessionPhase === 'blank' }),
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
                getSnapshot: () => ({ blank: false }),
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
          if (config.name === 'settings.section') slots.settings = { config, component }
          if (config.name === 'conversation.chat.commandview') slots.command = { config, component }
          return () => {}
        },
      },
    }

    clientModule.apply(ctx)
    return {
      clientModule,
      definition,
      namespaceState,
      slots,
      notices,
      timers,
      input,
      get currentNotice() {
        return currentNotice
      },
      setSessionPhase(next) {
        sessionPhase = next
      },
      setLocale(next) {
        activeLocale = next
      },
      setCurrentSession(next) {
        currentSession = next
      },
      emitSession() {
        for (const listener of sessionListeners) listener()
      },
      emitList() {
        for (const listener of listListeners) listener()
      },
      emitCommand(...args) {
        commandExecuted(...args)
      },
      async dispose() {
        for (const cleanup of effects.splice(0).reverse()) await cleanup()
      },
      restore() {
        globalThis.setTimeout = previousSetTimeout
        globalThis.clearTimeout = previousClearTimeout
        if (previousWindow === undefined) delete globalThis.window
        else globalThis.window = previousWindow
      },
    }
  } catch (error) {
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    throw error
  }
}

test('client module exposes required services and the settings contract', async () => {
  const fixture = await createClientFixture()
  try {
    assert.equal(fixture.definition.id, 'dsh-deepseek-billing')
    assert.deepEqual(fixture.clientModule.inject, ['slots', 'locale', 'sessions'])
    assert.equal(fixture.namespaceState.namespace, 'settings.billing')
    assert.deepEqual(Object.keys(fixture.namespaceState.dictionaries.zh).sort(), Object.keys(fixture.namespaceState.dictionaries.en).sort())
    assert.equal(fixture.slots.settings.config.id, 'deepseek-billing')
    assert.equal(fixture.slots.settings.config.label(), '计费')
    fixture.setLocale('en')
    assert.equal(fixture.slots.settings.config.label(), 'Billing')
    assert.equal(typeof fixture.slots.settings.component, 'function')

    const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    assert.match(source, /\.ds-billing \.ds-billing-header/)
    assert.doesNotMatch(source, /(?:^|\n)\s*\.ds-billing-[a-z-]+(?=[:\s.{])/)
  } finally {
    await fixture.dispose()
    fixture.restore()
  }
})

test('client hides blank command history and renders active command rows', async () => {
  const fixture = await createClientFixture()
  try {
    const commandSlot = fixture.slots.command
    assert.equal(commandSlot.config.key, 'deepseek-billing')
    assert.equal(typeof commandSlot.component, 'function')

    const blankCommand = { kind: 'command', seq: 1, name: 'deepseek-billing', outcome: { kind: 'success', text: 'CNY 16.70' } }
    const userMessage = { kind: 'user-message', seq: 3 }
    const afterActivation = { kind: 'command', seq: 4, name: 'deepseek-billing', outcome: { kind: 'success', text: 'CNY 16.66' } }
    const useChat = (selector) => selector({ legacy: { nodes: [blankCommand, userMessage, afterActivation] } })
    const commandOnlyTransition = (selector) => selector({ legacy: { nodes: [blankCommand] } })
    assert.equal(commandSlot.component({ node: blankCommand, useChat: commandOnlyTransition }), null)
    assert.equal(commandSlot.component({ node: blankCommand, useChat }), null)
    const visibleCommand = commandSlot.component({ node: afterActivation, useChat })
    assert.equal(visibleCommand.type, 'DisclosureRow')
    assert.equal(visibleCommand.props.icon.type, 'IconApiOutline14')
    assert.equal(visibleCommand.props.collapsedContent.at(-1).children[0], 'CNY 16.66')
  } finally {
    await fixture.dispose()
    fixture.restore()
  }
})

test('client scopes blank-session command notices and cleans them up', async () => {
  const fixture = await createClientFixture({ fakeTimers: true })
  try {
    fixture.emitCommand('session-1', 'goal', { kind: 'success', text: 'ignored' })
    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'success' })
    fixture.emitCommand('missing-session', 'deepseek-billing', { kind: 'success', text: 'ignored' })
    fixture.emitCommand('session-2', 'deepseek-billing', { kind: 'success', text: 'already visible in the command card' })
    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'success', text: '可用余额 CNY 16.77' })
    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'error', text: '未配置 DeepSeek API 密钥' })
    assert.deepEqual(fixture.notices, [
      { level: 'info', text: '可用余额 CNY 16.77' },
      { level: 'error', text: '未配置 DeepSeek API 密钥' },
    ])
    assert.equal(fixture.currentNotice?.text, '未配置 DeepSeek API 密钥')
    assert.equal(fixture.timers.size, 1)

    const [expiryId, expiry] = fixture.timers.entries().next().value
    assert.equal(expiry.delay, 60_000)
    fixture.timers.delete(expiryId)
    expiry.callback()
    assert.equal(fixture.currentNotice, null)

    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'success', text: 'balance before activation' })
    assert.equal(fixture.currentNotice?.text, 'balance before activation')
    fixture.setSessionPhase('active')
    fixture.emitSession()
    assert.equal(fixture.currentNotice, null)
    assert.equal(fixture.timers.size, 0)

    fixture.setSessionPhase('blank')
    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'success', text: 'balance before navigation' })
    assert.equal(fixture.currentNotice?.text, 'balance before navigation')
    fixture.setCurrentSession('session-2')
    fixture.emitList()
    assert.equal(fixture.currentNotice, null)
    assert.equal(fixture.timers.size, 0)

    // A result that arrives after navigation must not be retained on the
    // reusable blank session and reappear when New Session is opened again.
    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'success', text: 'stale balance' })
    assert.equal(fixture.currentNotice, null)
    fixture.setCurrentSession('session-1')
    fixture.emitList()
    assert.equal(fixture.currentNotice, null)

    // `notify()` remains the public compatibility face when the mutable store
    // is unavailable; this fallback must not create plugin-owned timers.
    delete fixture.input.notices
    fixture.emitCommand('session-1', 'deepseek-billing', { kind: 'success', text: 'public-notify fallback' })
    assert.equal(fixture.notices.at(-1)?.text, 'public-notify fallback')
    assert.equal(fixture.timers.size, 0)
  } finally {
    await fixture.dispose()
    fixture.restore()
  }
})
