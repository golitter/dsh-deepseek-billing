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
    assert.deepEqual(clientModule.inject, ['slots', 'locale'])

    let namespace
    let dictionaries
    let slot
    const ctx = {
      effect(register) {
        return register()
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
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
