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
      if (typeof credential?.value !== 'string' || credential.value.length === 0) {
        throw new Error(`deepseek-billing: no credential for ${CREDENTIAL_REF}`)
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetch(endpoint, {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${credential.value}`,
          },
          signal: controller.signal,
        })
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(`deepseek-billing: balance request timed out after ${timeoutMs}ms`)
        }
        throw error
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) {
        throw new Error(`deepseek-billing: balance fetch HTTP ${response.status}`)
      }

      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error('deepseek-billing: balance endpoint returned invalid JSON')
      }

      if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.balance_infos)) {
        throw new Error('deepseek-billing: balance endpoint returned an invalid payload')
      }

      const balance = payload.balance_infos[0]
      if (balance === undefined) return null
      if (balance === null || typeof balance !== 'object') {
        throw new Error('deepseek-billing: balance endpoint returned an invalid balance entry')
      }
      return balance
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
        respond(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET' })
        return
      }

      try {
        const balance = await service.getBalance()
        respond(200, { ok: true, balance })
      } catch (error) {
        console.error('[deepseek-billing] balance request failed:', String(error?.message || error))
        respond(502, { ok: false, error: '无法获取 DeepSeek 账户余额' })
      }
    },
  }), 'deepseek-billing: balance route')
}
