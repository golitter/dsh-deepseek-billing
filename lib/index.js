/**
 * dsh-deepseek-billing — HOST half (dual-face package).
 *
 * One plugin provides both:
 *   - the `deepseekBilling` service: real balance fetch through
 *     `DEEPSEEK_API_KEY` (the credential seam) against DeepSeek
 *     `/user/balance`;
 *   - the JSON HTTP route `/api/deepseek-billing/balance` the browser
 *     Client half fetches to render the balance.
 */

export const name = 'deepseek-billing'
export const inject = ['credentials', 'webServer']

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance'
const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Stable, language-neutral error codes. The API returns these; the client
 * half translates them per the active DSH locale, so the English UI never
 * surfaces Chinese error copy (and vice versa).
 */
const ERROR_CODES = {
  MISSING_CREDENTIAL: 'missing_credential',
  BALANCE_TIMEOUT: 'balance_timeout',
  BALANCE_FETCH_FAILED: 'balance_fetch_failed',
  BILLING_SERVICE_UNAVAILABLE: 'billing_service_unavailable',
  INVALID_RESPONSE: 'invalid_response',
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeBalance(balance) {
  if (balance === null || typeof balance !== 'object' || Array.isArray(balance)) {
    throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned an invalid balance entry')
  }

  const fields = ['currency', 'total_balance', 'granted_balance', 'topped_up_balance']
  if (fields.some((field) => typeof balance[field] !== 'string' || balance[field].trim().length === 0)) {
    throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned invalid balance fields')
  }

  return Object.fromEntries(fields.map((field) => [field, balance[field]]))
}

export function apply(ctx, config = {}) {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('deepseek-billing: timeoutMs must be a positive number')
  }

  const service = {
    /**
     * Fetch the DeepSeek account balance.
     * @returns the first balance_infos entry ({ currency, total_balance,
     *   granted_balance, topped_up_balance }), or null when the API reports none.
     */
    async getBalance() {
      const credential = await ctx.credentials.resolve(CREDENTIAL_REF)
      const apiKey = typeof credential?.value === 'string' ? credential.value.trim() : ''
      if (apiKey.length === 0) {
        throw codedError(ERROR_CODES.MISSING_CREDENTIAL, `deepseek-billing: no credential for ${CREDENTIAL_REF}`)
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetch(endpoint, {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw codedError(ERROR_CODES.BALANCE_TIMEOUT, `deepseek-billing: balance request timed out after ${timeoutMs}ms`)
        }
        throw codedError(ERROR_CODES.BALANCE_FETCH_FAILED, `deepseek-billing: balance request failed: ${error?.message ?? error}`)
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) {
        throw codedError(ERROR_CODES.BILLING_SERVICE_UNAVAILABLE, `deepseek-billing: balance fetch HTTP ${response.status}`)
      }

      let payload
      try {
        payload = await response.json()
      } catch {
        throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned invalid JSON')
      }

      if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.balance_infos)) {
        throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned an invalid payload')
      }

      const balance = payload.balance_infos[0]
      if (balance === undefined) return null
      return normalizeBalance(balance)
    },
  }

  ctx.provide('deepseekBilling', service)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/deepseek-billing/balance',
    handler: async (req, res) => {
      const respond = (status, payload, headers = {}) => {
        res.writeHead(status, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          ...headers,
        })
        res.end(JSON.stringify(payload))
      }

      if (req.method !== 'GET') {
        respond(405, { ok: false, code: ERROR_CODES.BILLING_SERVICE_UNAVAILABLE }, { allow: 'GET' })
        return
      }

      try {
        const balance = await service.getBalance()
        respond(200, { ok: true, balance })
      } catch (error) {
        console.error('[deepseek-billing] balance request failed:', String(error?.message || error))
        const code = typeof error?.code === 'string' ? error.code : ERROR_CODES.BILLING_SERVICE_UNAVAILABLE
        respond(502, { ok: false, code })
      }
    },
  }), 'deepseek-billing: balance route')
}
