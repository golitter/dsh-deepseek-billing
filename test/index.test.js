import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

function createContext(credential = { value: 'fixture-credential' }, config = {}) {
  let service
  let handler

  const ctx = {
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
    effect(register) {
      return register()
    },
  }

  apply(ctx, config)
  return { service, handler }
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
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
  }
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
