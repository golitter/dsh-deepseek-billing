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
 *
 * The upstream request is hardened against the trust-boundary risks that
 * matter for a key-bearing proxy: the timeout covers the whole response
 * (headers + body + parse + validation), the response body is read with a
 * hard size cap before parsing, `config.endpoint` is validated so the Bearer
 * key is only sent to the official HTTPS endpoint (or an explicitly-enabled
 * custom/loopback proxy), redirects are not followed, concurrent callers
 * share one in-flight upstream request, and the route is rate-limited per
 * client. The route also re-applies DSH's own `/api` browser-trust fence
 * (Host loopback + same-origin), which an `exact` route would otherwise
 * bypass.
 */

export const name = 'deepseek-billing'
export const inject = ['credentials', 'webServer', 'commands']

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance'
const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 30
const MAX_RESPONSE_BYTES = 64 * 1024
const CURRENCY_MAX_LENGTH = 16
const AMOUNT_MAX_LENGTH = 128
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

function codedError(code, message, status) {
  const error = new Error(message)
  error.code = code
  if (status !== undefined) error.status = status
  return error
}

function stableErrorCode(error) {
  return typeof error?.code === 'string' && ERROR_CODE_SET.has(error.code)
    ? error.code
    : ERROR_CODES.BILLING_SERVICE_UNAVAILABLE
}

/**
 * Whether a URL hostname names the local loopback authority: `localhost`,
 * IPv6 loopback, or any IPv4 address in 127/8. Mirrors DSH's own loopback
 * classification so an explicitly-enabled HTTP proxy endpoint stays local.
 */
function isLoopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Read one request header value, tolerating both a WHATWG `Headers` object and
 * the plain-object header map a node:http request exposes.
 */
function readHeader(headers, name) {
  if (headers == null) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical form of a configured trusted authority: `hostname` when no port
 * was written, else `hostname:port` (judged through WHATWG normalization so
 * case and a redundant default port never decide trust).
 */
function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** Whether a request Host matches one configured trusted authority. */
function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * The browser-trust fence DSH applies to its own `/api` routes: the Host
 * header must name loopback (or a configured trusted authority), cross-site
 * fetch metadata is refused, and any Origin must be same-origin. This is the
 * DNS-rebinding / cross-site defense for a loopback-bound local GUI — not an
 * authentication layer. Mirrors DSH's `isTrustedApiRequest`.
 */
function isTrustedApiRequest(req, trustedHosts) {
  const host = readHeader(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHost(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (readHeader(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = readHeader(req.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Validate the key-bearing endpoint before it is ever fetched. The endpoint
 * is trusted Host configuration (never browser input), but we still refuse
 * shapes that would silently weaken the credential boundary.
 *
 * `allowCustomEndpoint` gates whether `endpoint` may deviate from the official
 * default at all:
 *   - `false` (default): `endpoint` must be the official DeepSeek HTTPS URL.
 *   - `true`: any absolute `https:` URL, or a loopback-only `http:` proxy.
 * Either way userinfo, fragments, and non-HTTP(S) schemes are rejected, and
 * plaintext HTTP is restricted to loopback so the key never crosses the wire
 * in cleartext to a non-local host.
 */
function validateEndpoint(endpoint, allowCustomEndpoint) {
  if (!allowCustomEndpoint && endpoint !== DEFAULT_ENDPOINT) {
    throw new TypeError('deepseek-billing: endpoint may only be customized when allowCustomEndpoint is true')
  }

  let parsed
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new TypeError('deepseek-billing: endpoint must be an absolute URL')
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('deepseek-billing: endpoint must not embed a username or password')
  }
  if (parsed.hash !== '') {
    throw new TypeError('deepseek-billing: endpoint must not contain a fragment')
  }

  const isHttps = parsed.protocol === 'https:'
  const isHttp = parsed.protocol === 'http:'
  if (!isHttps && !isHttp) {
    throw new TypeError('deepseek-billing: endpoint must use an https: URL')
  }

  if (isHttp && !isLoopbackHost(parsed.hostname)) {
    throw new TypeError('deepseek-billing: HTTP endpoint must target loopback (127.0.0.1 or localhost)')
  }

  return endpoint
}

/**
 * Read a response body to text under a hard byte cap. A declared
 * `Content-Length` above the cap is refused before any body is read; the body
 * is otherwise streamed and aborted as soon as the cap is exceeded, so a
 * hostile or misconfigured upstream cannot force unbounded buffering. The
 * caller keeps the `AbortController` alive through this read, so the same
 * timeout that bounds the request also bounds a slow response body.
 */
async function readResponseBodyLimited(response, maxBytes) {
  const headers = response.headers
  const contentLength = typeof headers?.get === 'function'
    ? headers.get('content-length')
    : headers?.['content-length']
  if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance response exceeds the size limit')
    }
  }

  const body = response.body
  if (body === null || body === undefined || typeof body.getReader !== 'function') {
    const text = typeof response.text === 'function' ? await response.text() : ''
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance response exceeds the size limit')
    }
    return text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        try { await reader.cancel() } catch {}
        throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance response exceeds the size limit')
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }

  let text = ''
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true })
  text += decoder.decode()
  return text
}

function normalizeBalance(balance) {
  if (balance === null || typeof balance !== 'object' || Array.isArray(balance)) {
    throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned an invalid balance entry')
  }

  const fields = ['currency', 'total_balance', 'granted_balance', 'topped_up_balance']
  if (fields.some((field) => typeof balance[field] !== 'string' || balance[field].trim().length === 0)) {
    throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned invalid balance fields')
  }
  if (balance.currency.length > CURRENCY_MAX_LENGTH) {
    throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance currency exceeds the length limit')
  }
  for (const field of ['total_balance', 'granted_balance', 'topped_up_balance']) {
    if (balance[field].length > AMOUNT_MAX_LENGTH) {
      throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance amount exceeds the length limit')
    }
  }

  return Object.fromEntries(fields.map((field) => [field, balance[field]]))
}

/**
 * A fixed-window per-key rate limiter (one window of one minute). Keys are
 * client addresses, so loopback clients (the only supported Web deployment)
 * share one budget. Stale windows are pruned on every check to keep the map
 * bounded.
 */
function createRateLimiter(maxPerMinute) {
  const buckets = new Map()
  const windowMs = 60_000
  return function allow(key) {
    const now = Date.now()
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.start >= windowMs) buckets.delete(bucketKey)
    }
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, { start: now, count: 1 })
      return true
    }
    if (bucket.count >= maxPerMinute) return false
    bucket.count += 1
    return true
  }
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
  const allowCustomEndpoint = config.allowCustomEndpoint === undefined
    ? false
    : config.allowCustomEndpoint
  const maxRequestsPerMinute = config.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('deepseek-billing: timeoutMs must be a positive number')
  }
  if (typeof allowCustomEndpoint !== 'boolean') {
    throw new TypeError('deepseek-billing: allowCustomEndpoint must be a boolean')
  }
  if (!Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute <= 0) {
    throw new TypeError('deepseek-billing: maxRequestsPerMinute must be a positive integer')
  }
  validateEndpoint(endpoint, allowCustomEndpoint)

  const rateLimiter = createRateLimiter(maxRequestsPerMinute)

  async function fetchBalance() {
    const credential = await ctx.credentials.resolve(CREDENTIAL_REF)
    const apiKey = typeof credential?.value === 'string' ? credential.value.trim() : ''
    if (apiKey.length === 0) {
      throw codedError(ERROR_CODES.MISSING_CREDENTIAL, `deepseek-billing: no credential for ${CREDENTIAL_REF}`)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(endpoint, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        redirect: 'manual',
      })

      if (!response.ok) {
        throw codedError(ERROR_CODES.BILLING_SERVICE_UNAVAILABLE, `deepseek-billing: balance fetch HTTP ${response.status}`, response.status)
      }

      const text = await readResponseBodyLimited(response, MAX_RESPONSE_BYTES)

      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned invalid JSON')
      }

      if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.balance_infos)) {
        throw codedError(ERROR_CODES.INVALID_RESPONSE, 'deepseek-billing: balance endpoint returned an invalid payload')
      }

      const balance = payload.balance_infos[0]
      if (balance === undefined) return null
      return normalizeBalance(balance)
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw codedError(ERROR_CODES.BALANCE_TIMEOUT, `deepseek-billing: balance request timed out after ${timeoutMs}ms`)
      }
      if (typeof error?.code === 'string' && ERROR_CODE_SET.has(error.code)) {
        throw error
      }
      throw codedError(ERROR_CODES.BALANCE_FETCH_FAILED, `deepseek-billing: balance request failed: ${error?.message ?? error}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  // Coalesce concurrent callers onto one in-flight upstream request; the
  // shared promise is cleared as soon as it settles.
  let inflight = null
  const service = {
    /**
     * Fetch the DeepSeek account balance.
     * @returns the first balance_infos entry ({ currency, total_balance,
     *   granted_balance, topped_up_balance }), or null when the API reports none.
     */
    getBalance() {
      if (inflight) return inflight
      const pending = fetchBalance()
      inflight = pending
      pending.then(
        () => { if (inflight === pending) inflight = null },
        () => { if (inflight === pending) inflight = null },
      )
      return pending
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

      // Re-apply DSH's /api browser-trust fence (an `exact` route would
      // otherwise bypass the /api prefix route that carries it). This route is
      // privileged — it reads the API key, issues an upstream call, and returns
      // account data — so it is pinned to loopback with an empty trust list,
      // the same way DSH gates its credentials/settings plane. `--trusted-host`
      // is a DNS-rebinding fence, not authentication, and must not widen this.
      if (!isTrustedApiRequest(req, [])) {
        respond(403, { ok: false, code: ERROR_CODES.BILLING_SERVICE_UNAVAILABLE })
        return
      }

      if (req.method !== 'GET') {
        respond(405, { ok: false, code: ERROR_CODES.BILLING_SERVICE_UNAVAILABLE }, { allow: 'GET' })
        return
      }

      const clientKey = req.socket?.remoteAddress ?? 'unknown'
      if (!rateLimiter(clientKey)) {
        respond(429, { ok: false, code: ERROR_CODES.BILLING_SERVICE_UNAVAILABLE })
        return
      }

      try {
        const balance = await service.getBalance()
        respond(200, { ok: true, balance })
      } catch (error) {
        // Log only the stable code (plus a numeric HTTP status when one was
        // observed); never the credential, Authorization header, upstream
        // body, or the configured endpoint / query string.
        const code = stableErrorCode(error)
        const status = typeof error?.status === 'number' ? error.status : undefined
        console.error('[deepseek-billing] balance request failed:', status === undefined ? code : { code, status })
        respond(502, { ok: false, code })
      }
    },
  }), 'deepseek-billing: balance route')

  const commandHandler = async (invocation) => {
    const messages = readCommandMessages(ctx)
    const rawInput = typeof invocation?.rawInput === 'string' ? invocation.rawInput : ''
    if (rawInput.trim().length > 0) {
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
