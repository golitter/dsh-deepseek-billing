/**
 * dsh-deepseek-billing — HOST half (dual-face package).
 *
 * One plugin provides both:
 *   - the `deepseekBilling` service: real balance fetch through
 *     `DEEPSEEK_API_KEY` (the credential seam) against DeepSeek
 *     `/user/balance`;
 *   - the JSON HTTP route `/api/deepseek-billing/balance` the browser
 *     Client half fetches to render the balance;
 *   - the `/deepseek-billing` slash command that returns the balance with
 *     locale-aware visible text (zh/en), falling back to language-neutral
 *     text or stable codes when the locale preference is unavailable.
 */

export const name = 'deepseek-billing'
export const inject = ['credentials', 'webServer', 'commands']

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance'
const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_COMMAND_DESCRIPTION = 'show the DeepSeek account balance'

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
const ERROR_CODE_SET = new Set(Object.values(ERROR_CODES))

const LOCALE_NAMESPACE = 'locale'
const COMMAND_MESSAGES = {
  zh: {
    description: '查看 DeepSeek 账户余额',
    available: '可用余额',
    empty: '暂无余额信息',
    unexpectedInput: '此命令不接受参数，请直接输入 /deepseek-billing',
    errors: {
      missing_credential: '未配置 DeepSeek API 密钥',
      balance_timeout: '获取余额超时',
      balance_fetch_failed: '获取余额失败',
      billing_service_unavailable: '计费服务暂不可用',
      invalid_response: '余额接口返回异常数据',
    },
  },
  en: {
    description: DEFAULT_COMMAND_DESCRIPTION,
    available: 'Available balance',
    empty: 'No balance information available',
    unexpectedInput: 'This command takes no arguments. Run /deepseek-billing directly.',
    errors: {
      missing_credential: 'DeepSeek API key is not configured',
      balance_timeout: 'Balance request timed out',
      balance_fetch_failed: 'Failed to fetch balance',
      billing_service_unavailable: 'Billing service is temporarily unavailable',
      invalid_response: 'Balance endpoint returned unexpected data',
    },
  },
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function stableErrorCode(error) {
  return typeof error?.code === 'string' && ERROR_CODE_SET.has(error.code)
    ? error.code
    : ERROR_CODES.BILLING_SERVICE_UNAVAILABLE
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

/**
 * Read the Host-backed locale preference (`settings.yaml` → `locale.preference`).
 * The command surface has no client translation layer, so it resolves its one
 * visible command text here; an absent/failing settings service or unknown
 * preference falls back to `null`, which the caller renders neutrally.
 */
function readCommandMessages(ctx) {
  try {
    const settings = ctx.get('settings')
    if (settings == null) return null
    const locale = settings.get(LOCALE_NAMESPACE)
    return COMMAND_MESSAGES[locale?.preference] ?? null
  } catch {
    return null
  }
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
        respond(502, { ok: false, code: stableErrorCode(error) })
      }
    },
  }), 'deepseek-billing: balance route')

  const commandHandler = async (invocation) => {
    const messages = readCommandMessages(ctx)
    if (invocation.rawInput.trim().length > 0) {
      return {
        kind: 'error',
        text: messages?.unexpectedInput ?? 'usage: /deepseek-billing',
      }
    }
    try {
      const balance = await service.getBalance()
      if (balance === null) return { kind: 'success', text: messages?.empty ?? '—' }
      const prefix = messages ? `${messages.available} ` : ''
      return { kind: 'success', text: `${prefix}${balance.currency} ${balance.total_balance}` }
    } catch (error) {
      const code = stableErrorCode(error)
      return { kind: 'error', text: messages?.errors[code] ?? code }
    }
  }

  ctx.effect(() => {
    const description = () => readCommandMessages(ctx)?.description ?? DEFAULT_COMMAND_DESCRIPTION
    const register = () => ctx.commands.register({
      name: 'deepseek-billing',
      description: description(),
      handler: commandHandler,
    })

    let activeDescription = description()
    let disposeCommand = register()
    const disposeSettings = ctx.on('settings/updated', (namespace) => {
      if (namespace !== LOCALE_NAMESPACE) return
      const nextDescription = description()
      if (nextDescription === activeDescription) return
      disposeCommand()
      activeDescription = nextDescription
      disposeCommand = register()
    })

    return () => {
      disposeSettings()
      disposeCommand()
    }
  }, 'deepseek-billing: balance command')
}
