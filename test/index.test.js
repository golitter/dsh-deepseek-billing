import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

function createContext(credential = { value: 'fixture-credential' }, config = {}, localePreference = 'zh') {
  let service
  let handler
  let command
  let settingsListener
  let currentLocalePreference = localePreference
  const effects = []

  const settings = currentLocalePreference === null
    ? undefined
    : {
        get(ns) {
          assert.equal(ns, 'locale')
          if (typeof currentLocalePreference === 'function') return currentLocalePreference()
          return { preference: currentLocalePreference }
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
        return () => {
          if (command === definition) command = undefined
        }
      },
    },
    on(name, listener) {
      assert.equal(name, 'settings/updated')
      settingsListener = listener
      return () => {
        if (settingsListener === listener) settingsListener = undefined
      }
    },
    effect(register) {
      const dispose = register()
      if (typeof dispose === 'function') effects.push(dispose)
      return dispose
    },
  }

  apply(ctx, config)
  return {
    service,
    handler,
    command,
    getCommand: () => command,
    async dispose() {
      for (const effect of effects.splice(0).reverse()) await effect()
    },
    updateLocalePreference(next) {
      currentLocalePreference = next
      settingsListener?.('locale', { preference: next }, {}, 'update')
    },
  }
}

function textResponse(text, options = {}) {
  const bytes = new TextEncoder().encode(text)
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name) {
        return name === 'content-length' ? String(bytes.length) : null
      },
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  }
}

function jsonResponse(payload, options = {}) {
  return textResponse(JSON.stringify(payload), options)
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
        output.raw = value
        try {
          output.body = JSON.parse(value)
        } catch {
          output.body = value
        }
      },
    },
  }
}

function getRequest(overrides = {}) {
  return { method: 'GET', headers: { host: '127.0.0.1' }, ...overrides }
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

  await handler({ method: 'POST', headers: { host: '127.0.0.1' } }, res)

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
    globalThis.fetch = async () => textResponse('this is not JSON')
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
    await successHandler(getRequest(), success.res)
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
    await errorHandler(getRequest(), failure.res)
    assert.equal(failure.output.status, 502)
    assert.deepEqual(failure.output.body, { ok: false, code: 'missing_credential' })

    const { handler: fallbackHandler } = createContext(() => { throw new Error('credential service failed') })
    const fallback = createResponse()
    await fallbackHandler(getRequest(), fallback.res)
    assert.equal(fallback.output.status, 502)
    assert.deepEqual(fallback.output.body, { ok: false, code: 'billing_service_unavailable' })

    const { handler: foreignCodeHandler } = createContext(() => {
      const error = new Error('credential service failed with a foreign code')
      error.code = 'SETTINGS_CONFLICT'
      throw error
    })
    const foreignCode = createResponse()
    await foreignCodeHandler(getRequest(), foreignCode.res)
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
    const context = createContext()
    const { command } = context
    assert.equal(command.name, 'deepseek-billing')
    assert.equal(command.description, '查看 DeepSeek 账户余额')
    assert.deepEqual(await command.handler({ rawInput: '' }), { kind: 'success', text: '可用余额 CNY 12.34' })
    assert.deepEqual(await command.handler({ rawInput: ' unexpected' }), {
      kind: 'error',
      text: '此命令不接受参数，请直接输入 /deepseek-billing',
    })
    assert.equal(fetchCalls, 1)

    context.updateLocalePreference('en')
    assert.equal(context.getCommand().description, 'show the DeepSeek account balance')
    context.updateLocalePreference('zh')
    assert.equal(context.getCommand().description, '查看 DeepSeek 账户余额')
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
    assert.equal(command.description, 'show the DeepSeek account balance')
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
    const { service } = createContext(undefined, { endpoint, timeoutMs: 50, allowCustomEndpoint: true })
    await service.getBalance()
    assert.equal(requestedUrl, endpoint)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects unsafe endpoint configurations', () => {
  // Without the opt-in, `endpoint` must be the official default.
  assert.throws(() => createContext(undefined, { endpoint: 'https://other.example.com/balance' }), TypeError)
  assert.throws(() => createContext(undefined, { endpoint: 'https://api.deepseek.com/user/balance?token=x' }), TypeError)

  // With the opt-in, still reject userinfo, fragments, non-HTTP(S) schemes,
  // non-loopback plaintext HTTP, and unparsable URLs.
  for (const endpoint of [
    'https://user:pass@api.deepseek.com/user/balance',
    'https://api.deepseek.com/user/balance#fragment',
    'ftp://api.deepseek.com/user/balance',
    'http://api.deepseek.com/user/balance',
    'http://evil.example.com/balance',
    'not-a-url',
  ]) {
    assert.throws(() => createContext(undefined, { endpoint, allowCustomEndpoint: true }), TypeError)
  }

  // The official default needs no opt-in.
  assert.doesNotThrow(() => createContext(undefined, { endpoint: 'https://api.deepseek.com/user/balance' }))

  // With the opt-in, https (any host) and loopback-only http are accepted.
  assert.doesNotThrow(() => createContext(undefined, { endpoint: 'https://billing-fixture.invalid/balance', allowCustomEndpoint: true }))
  assert.doesNotThrow(() => createContext(undefined, { endpoint: 'http://127.0.0.1:8080/balance', allowCustomEndpoint: true }))
  assert.doesNotThrow(() => createContext(undefined, { endpoint: 'http://localhost:8080/balance', allowCustomEndpoint: true }))
})

test('validates maxRequestsPerMinute configuration', () => {
  assert.throws(() => createContext(undefined, { maxRequestsPerMinute: 0 }), TypeError)
  assert.throws(() => createContext(undefined, { maxRequestsPerMinute: 1.5 }), TypeError)
  assert.doesNotThrow(() => createContext(undefined, { maxRequestsPerMinute: 30 }))
})

test('requires allowCustomEndpoint to be a boolean', () => {
  assert.throws(() => createContext(undefined, { allowCustomEndpoint: 'false' }), TypeError)
  assert.throws(() => createContext(undefined, { allowCustomEndpoint: 1 }), TypeError)
  assert.throws(() => createContext(undefined, { allowCustomEndpoint: null }), TypeError)
  assert.doesNotThrow(() => createContext(undefined, { allowCustomEndpoint: true }))
  assert.doesNotThrow(() => createContext(undefined, { allowCustomEndpoint: false }))
  assert.doesNotThrow(() => createContext(undefined, {}))
})

test('coalesces concurrent getBalance calls into one upstream request', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 15))
    return jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '1.00',
        granted_balance: '0.00',
        topped_up_balance: '1.00',
      }],
    })
  }
  try {
    const { service } = createContext()
    const results = await Promise.all([service.getBalance(), service.getBalance(), service.getBalance()])
    assert.equal(fetchCalls, 1)
    assert.equal(results.length, 3)
    for (const result of results) assert.equal(result.currency, 'CNY')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('aborts an in-flight upstream request when the plugin unloads', async () => {
  const originalFetch = globalThis.fetch
  let capturedSignal
  globalThis.fetch = async (_url, options) => {
    capturedSignal = options.signal
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })
  }
  try {
    const context = createContext(undefined, { timeoutMs: 60_000 })
    const pending = context.service.getBalance()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(capturedSignal.aborted, false)
    await context.dispose()
    assert.equal(capturedSignal.aborted, true)
    await assert.rejects(pending, { code: 'balance_timeout' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rate limiting blocks requests before reading credentials or fetching upstream', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  let credentialResolves = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '1.00',
        granted_balance: '0.00',
        topped_up_balance: '1.00',
      }],
    })
  }
  try {
    const context = createContext(async () => {
      credentialResolves += 1
      return { value: 'fixture-credential' }
    }, { maxRequestsPerMinute: 1 })
    const { handler } = context

    const first = createResponse()
    await handler(getRequest({ socket: { remoteAddress: '127.0.0.1' } }), first.res)
    assert.equal(first.output.status, 200)
    assert.equal(fetchCalls, 1)
    assert.equal(credentialResolves, 1)

    const second = createResponse()
    await handler(getRequest({ socket: { remoteAddress: '127.0.0.1' } }), second.res)
    assert.equal(second.output.status, 429)
    assert.deepEqual(second.output.body, { ok: false, code: 'billing_service_unavailable' })
    assert.equal(fetchCalls, 1)
    assert.equal(credentialResolves, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not follow redirects and never forwards the key to a redirect target', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return textResponse('', { ok: false, status: 302 })
  }
  try {
    const endpoint = 'https://api.deepseek.com/user/balance'
    const { service } = createContext(undefined, { endpoint })
    await assert.rejects(service.getBalance(), { code: 'billing_service_unavailable' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, endpoint)
    assert.equal(calls[0].options.redirect, 'manual')
    assert.equal(calls[0].options.headers.authorization, 'Bearer fixture-credential')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('times out when headers arrive but the body never finishes', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          read: () => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            }, { once: true })
          }),
          releaseLock() {},
          cancel() {},
        }
      },
    },
  })
  try {
    const { service } = createContext(undefined, { timeoutMs: 1 })
    await assert.rejects(service.getBalance(), { code: 'balance_timeout' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects oversized responses as invalid_response', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-length' ? String(70 * 1024) : null) },
      body: new ReadableStream(),
    })
    const { service: declared } = createContext()
    await assert.rejects(declared.getBalance(), { code: 'invalid_response' })

    const big = new Uint8Array(70 * 1024)
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(big)
          controller.close()
        },
      }),
    })
    const { service: streaming } = createContext()
    await assert.rejects(streaming.getBalance(), { code: 'invalid_response' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects balance fields that exceed the length limits', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => jsonResponse({
      balance_infos: [{
        currency: 'X'.repeat(17),
        total_balance: '1.00',
        granted_balance: '0.00',
        topped_up_balance: '1.00',
      }],
    })
    const { service: currency } = createContext()
    await assert.rejects(currency.getBalance(), { code: 'invalid_response' })

    globalThis.fetch = async () => jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '9'.repeat(129),
        granted_balance: '0.00',
        topped_up_balance: '1.00',
      }],
    })
    const { service: amount } = createContext()
    await assert.rejects(amount.getBalance(), { code: 'invalid_response' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('logs only the stable code, never credentials or the endpoint query', async () => {
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error
  const logs = []
  console.error = (...args) => {
    logs.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
  }
  try {
    globalThis.fetch = async () => { throw new Error('upstream exploded with sk-super-secret') }
    const { handler } = createContext({ value: 'sk-super-secret' }, { endpoint: 'https://api.deepseek.com/user/balance?token=querysecret', allowCustomEndpoint: true })
    const { output, res } = createResponse()
    await handler(getRequest({ socket: { remoteAddress: '127.0.0.1' } }), res)

    assert.equal(output.status, 502)
    const joined = logs.join('\n')
    assert.equal(joined.includes('sk-super-secret'), false)
    assert.equal(joined.includes('querysecret'), false)
    assert.equal(joined.includes('api.deepseek.com'), false)
    assert.equal(joined.includes('balance_fetch_failed'), true)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
  }
})

test('slash command tolerates a missing or non-string rawInput', async () => {
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
    const { command } = createContext()
    assert.deepEqual(await command.handler({}), { kind: 'success', text: '可用余额 CNY 12.34' })
    assert.deepEqual(await command.handler({ rawInput: null }), { kind: 'success', text: '可用余额 CNY 12.34' })
    assert.deepEqual(await command.handler({ rawInput: 123 }), { kind: 'success', text: '可用余额 CNY 12.34' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('applies the browser-trust fence before any upstream work', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  let credentialResolves = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return jsonResponse({
      balance_infos: [{
        currency: 'CNY',
        total_balance: '1.00',
        granted_balance: '0.00',
        topped_up_balance: '1.00',
      }],
    })
  }
  try {
    const { handler } = createContext(async () => {
      credentialResolves += 1
      return { value: 'fixture-credential' }
    })

    const untrustedHost = createResponse()
    await handler(getRequest({ headers: { host: 'evil.example.com' } }), untrustedHost.res)
    assert.equal(untrustedHost.output.status, 403)
    assert.deepEqual(untrustedHost.output.body, { ok: false, code: 'billing_service_unavailable' })

    const missingHost = createResponse()
    await handler({ method: 'GET' }, missingHost.res)
    assert.equal(missingHost.output.status, 403)

    const crossSite = createResponse()
    await handler(getRequest({ headers: { host: '127.0.0.1', 'sec-fetch-site': 'cross-site' } }), crossSite.res)
    assert.equal(crossSite.output.status, 403)

    const crossOrigin = createResponse()
    await handler(getRequest({ headers: { host: '127.0.0.1', origin: 'https://evil.example.com' } }), crossOrigin.res)
    assert.equal(crossOrigin.output.status, 403)

    assert.equal(fetchCalls, 0)
    assert.equal(credentialResolves, 0)

    const allowed = createResponse()
    await handler(getRequest(), allowed.res)
    assert.equal(allowed.output.status, 200)
    assert.equal(fetchCalls, 1)

    const sameOrigin = createResponse()
    await handler(getRequest({ headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } }), sameOrigin.res)
    assert.equal(sameOrigin.output.status, 200)
    assert.equal(fetchCalls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps the balance route loopback-only, not widened by trusted authorities', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return jsonResponse({ balance_infos: [] })
  }
  try {
    const { handler } = createContext()

    const loopback = createResponse()
    await handler(getRequest({ headers: { host: 'localhost' } }), loopback.res)
    assert.equal(loopback.output.status, 200)
    assert.equal(fetchCalls, 1)

    // A non-loopback Host is refused even if it would be a `--trusted-host`
    // authority elsewhere in DSH: this route touches the API key.
    const lan = createResponse()
    await handler(getRequest({ headers: { host: 'lan-host.local:8080' } }), lan.res)
    assert.equal(lan.output.status, 403)
    assert.deepEqual(lan.output.body, { ok: false, code: 'billing_service_unavailable' })
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
