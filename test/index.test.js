import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

function createContext(credential = { value: 'fixture-credential' }, config = {}, localePreference = 'zh') {
  let service
  let handler
  let command

  const settings = localePreference === null
    ? undefined
    : {
        get(ns) {
          assert.equal(ns, 'locale')
          if (typeof localePreference === 'function') return localePreference()
          return { preference: localePreference }
        },
      }

  const ctx = {
    get(name) {
      return name === 'settings' ? settings : undefined
    },
    credentials: {
      resolve: async () => typeof credential === 'function' ? credential() : credential,
    },
    provide(name, value) {
      assert.equal(name, 'deepseekBilling')
      service = value
    },
    webServer: {
      register(route) {
        handler = route.handler
        return () => {}
      },
    },
    commands: {
      register(definition) {
        command = definition
        return () => {}
      },
    },
    effect(register) {
      return register()
    },
  }

  apply(ctx, config)
  return { service, handler, command }
}

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload,
  }
}

function createResponse() {
  const output = {}
  return {
    output,
    res: {
      writeHead(status, headers) {
        output.status = status
        output.headers = headers
      },
      end(value) {
        output.body = JSON.parse(value)
      },
    },
  }
}

test('returns only validated balance fields', async () => {
  const originalFetch = globalThis.fetch
  let authorization
  globalThis.fetch = async (_url, options) => {
    authorization = options.headers.authorization
    return jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '12.34',
        granted_balance: '2.34',
        topped_up_balance: '10.00',
        upstream_internal_field: 'must-not-leak',
      }],
    })
  }

  try {
    const { service } = createContext({ value: '  fixture-credential  ' })
    assert.deepEqual(await service.getBalance(), {
      currency: 'CNY',
      total_balance: '12.34',
      granted_balance: '2.34',
      topped_up_balance: '10.00',
    })
    assert.equal(authorization, 'Bearer fixture-credential')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects missing or malformed balance fields', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({
    balance_infos: [{
      currency: 'CNY',
      total_balance: '   ',
      granted_balance: '2.34',
      topped_up_balance: '10.00',
    }],
  })

  try {
    const { service } = createContext()
    await assert.rejects(service.getBalance(), { code: 'invalid_response' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('treats whitespace-only credentials as missing', async () => {
  const { service } = createContext({ value: '   ' })
  await assert.rejects(service.getBalance(), { code: 'missing_credential' })
})

test('405 responses use the stable error-code shape', async () => {
  const { handler } = createContext()
  const { output, res } = createResponse()

  await handler({ method: 'POST' }, res)

  assert.equal(output.status, 405)
  assert.equal(output.headers.allow, 'GET')
  assert.equal(output.headers['cache-control'], 'no-store')
  assert.deepEqual(output.body, { ok: false, code: 'billing_service_unavailable' })
})

test('maps request timeout to balance_timeout', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })

  try {
    const { service } = createContext(undefined, { timeoutMs: 1 })
    await assert.rejects(service.getBalance(), { code: 'balance_timeout' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('maps network and HTTP failures to stable error codes', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => { throw new Error('network unavailable') }
    const { service: networkService } = createContext()
    await assert.rejects(networkService.getBalance(), { code: 'balance_fetch_failed' })

    globalThis.fetch = async () => jsonResponse({}, { ok: false, status: 503 })
    const { service: httpService } = createContext()
    await assert.rejects(httpService.getBalance(), { code: 'billing_service_unavailable' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects invalid JSON, containers, and balance entries', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON') } })
    const { service: jsonService } = createContext()
    await assert.rejects(jsonService.getBalance(), { code: 'invalid_response' })

    for (const payload of [{}, { balance_infos: null }, { balance_infos: [null] }, { balance_infos: [[]] }]) {
      globalThis.fetch = async () => jsonResponse(payload)
      const { service } = createContext()
      await assert.rejects(service.getBalance(), { code: 'invalid_response' })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns null for an empty balance_infos array', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ balance_infos: [] })
  try {
    const { service } = createContext()
    assert.equal(await service.getBalance(), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GET route returns balances and stable service errors', async () => {
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error
  try {
    globalThis.fetch = async () => jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '12.34',
        granted_balance: '2.34',
        topped_up_balance: '10.00',
      }],
    })
    const { handler: successHandler } = createContext()
    const success = createResponse()
    await successHandler({ method: 'GET' }, success.res)
    assert.equal(success.output.status, 200)
    assert.equal(success.output.headers['cache-control'], 'no-store')
    assert.deepEqual(success.output.body, {
      ok: true,
      balance: {
        currency: 'CNY',
        total_balance: '12.34',
        granted_balance: '2.34',
        topped_up_balance: '10.00',
      },
    })

    console.error = () => {}
    const { handler: errorHandler } = createContext({ value: ' ' })
    const failure = createResponse()
    await errorHandler({ method: 'GET' }, failure.res)
    assert.equal(failure.output.status, 502)
    assert.deepEqual(failure.output.body, { ok: false, code: 'missing_credential' })

    const { handler: fallbackHandler } = createContext(() => { throw new Error('credential service failed') })
    const fallback = createResponse()
    await fallbackHandler({ method: 'GET' }, fallback.res)
    assert.equal(fallback.output.status, 502)
    assert.deepEqual(fallback.output.body, { ok: false, code: 'billing_service_unavailable' })

    const { handler: foreignCodeHandler } = createContext(() => {
      const error = new Error('credential service failed with a foreign code')
      error.code = 'SETTINGS_CONFLICT'
      throw error
    })
    const foreignCode = createResponse()
    await foreignCodeHandler({ method: 'GET' }, foreignCode.res)
    assert.equal(foreignCode.output.status, 502)
    assert.deepEqual(foreignCode.output.body, { ok: false, code: 'billing_service_unavailable' })
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
  }
})

test('registers a slash command returning localized balance text', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '12.34',
        granted_balance: '2.34',
        topped_up_balance: '10.00',
      }],
    })
  }
  try {
    const { command } = createContext()
    assert.equal(command.name, 'deepseek-billing')
    assert.equal(command.description, 'show the DeepSeek account balance')
    assert.deepEqual(await command.handler({ rawInput: '' }), { kind: 'success', text: '可用余额 CNY 12.34' })
    assert.deepEqual(await command.handler({ rawInput: ' unexpected' }), {
      kind: 'error',
      text: '此命令不接受参数，请直接输入 /deepseek-billing',
    })
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('slash command follows the en locale preference', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({
    balance_infos: [{
      currency: 'CNY',
      total_balance: '12.34',
      granted_balance: '2.34',
      topped_up_balance: '10.00',
    }],
  })
  try {
    const { command } = createContext(undefined, undefined, 'en')
    assert.deepEqual(await command.handler({ rawInput: '' }), { kind: 'success', text: 'Available balance CNY 12.34' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('slash command falls back to neutral text without a locale', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({
    balance_infos: [{
      currency: 'CNY',
      total_balance: '12.34',
      granted_balance: '2.34',
      topped_up_balance: '10.00',
    }],
  })
  try {
    const { command } = createContext(undefined, undefined, null)
    assert.deepEqual(await command.handler({ rawInput: '' }), { kind: 'success', text: 'CNY 12.34' })

    const { command: unknownLocale } = createContext(undefined, undefined, 'fr')
    assert.deepEqual(await unknownLocale.handler({ rawInput: '' }), { kind: 'success', text: 'CNY 12.34' })

    const { command: failingSettings } = createContext(undefined, undefined, () => {
      throw new Error('settings service failed')
    })
    assert.deepEqual(await failingSettings.handler({ rawInput: '' }), { kind: 'success', text: 'CNY 12.34' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('slash command renders a neutral dash for empty balance', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ balance_infos: [] })
  try {
    const { command } = createContext()
    assert.deepEqual(await command.handler({ rawInput: '' }), { kind: 'success', text: '暂无余额信息' })

    const { command: neutral } = createContext(undefined, undefined, null)
    assert.deepEqual(await neutral.handler({ rawInput: '' }), { kind: 'success', text: '—' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('slash command localizes stable errors and keeps a neutral fallback', async () => {
  const { command: missing } = createContext({ value: ' ' })
  assert.deepEqual(await missing.handler({ rawInput: '' }), { kind: 'error', text: '未配置 DeepSeek API 密钥' })

  const { command: unknown } = createContext(() => { throw new Error('credential service failed') })
  assert.deepEqual(await unknown.handler({ rawInput: '' }), { kind: 'error', text: '计费服务暂不可用' })

  const { command: foreignCode } = createContext(() => {
    const error = new Error('credential service failed with a foreign code')
    error.code = 'SETTINGS_CONFLICT'
    throw error
  })
  assert.deepEqual(await foreignCode.handler({ rawInput: '' }), { kind: 'error', text: '计费服务暂不可用' })

  const { command: neutral } = createContext({ value: ' ' }, undefined, null)
  assert.deepEqual(await neutral.handler({ rawInput: '' }), { kind: 'error', text: 'missing_credential' })
})

test('validates timeout configuration and forwards endpoint configuration', async () => {
  assert.throws(() => createContext(undefined, { timeoutMs: 0 }), TypeError)
  assert.throws(() => createContext(undefined, { timeoutMs: Number.NaN }), TypeError)

  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = url
    return jsonResponse({ balance_infos: [] })
  }
  try {
    const endpoint = 'https://billing-fixture.invalid/balance'
    const { service } = createContext(undefined, { endpoint, timeoutMs: 50 })
    await service.getBalance()
    assert.equal(requestedUrl, endpoint)
  } finally {
    globalThis.fetch = originalFetch
  }
})
