import * as http from 'http'
import * as https from 'https'
import type { IncomingMessage, OutgoingHttpHeaders } from 'http'
import { isIP } from 'net'
import type { Readable } from 'stream'
import type { AuthenticatedHttpContext } from './client'

const MAX_REDIRECT_HOPS = 10

export type XapiHttpRequestOptions = {
  context: AuthenticatedHttpContext
  method: string
  path: string
  query?: URLSearchParams
  headers?: OutgoingHttpHeaders
  bodyFactory?: () => Readable
  contentLength?: number
  timeoutMs: number
  /** Socket inactivity deadline; does not limit a progressing file transfer. */
  idleTimeoutMs?: number
  signal?: AbortSignal
}

export class XapiHttpRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'XapiHttpRequestError'
  }
}

function createAbortError(): Error & { code: string } {
  const error = new Error('XAPI HTTP request was aborted') as Error & { code: string }
  error.name = 'AbortError'
  error.code = 'ABORTED'
  return error
}

function authorityUrl(context: AuthenticatedHttpContext): URL {
  const host = context.host.includes(':') && !context.host.startsWith('[')
    ? `[${context.host}]`
    : context.host
  return new URL(`${context.scheme}//${host}:${context.port}`)
}

function initialUrl(options: XapiHttpRequestOptions): URL {
  const authority = authorityUrl(options.context)
  const path = new URL(options.path, authority)
  authority.pathname = path.pathname
  authority.search = options.query ? options.query.toString() : path.search
  return authority
}

function requestHeaders(options: XapiHttpRequestOptions): OutgoingHttpHeaders {
  const headers = { ...options.headers }
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'host') delete headers[name]
  }
  if (options.contentLength !== undefined) {
    const hasContentLength = Object.keys(headers)
      .some((name) => name.toLowerCase() === 'content-length')
    if (!hasContentLength) headers['Content-Length'] = options.contentLength
  }
  return headers
}

function isKnownRequestError(error: unknown): boolean {
  return error instanceof XapiHttpRequestError
    || (error instanceof Error && error.name === 'AbortError')
}

function openResponse(
  target: URL,
  options: XapiHttpRequestOptions,
  headers: OutgoingHttpHeaders,
  deadlineAt: number | null,
): Promise<IncomingMessage> {
  if (options.signal?.aborted) return Promise.reject(createAbortError())
  const remainingMs = deadlineAt === null ? null : deadlineAt - Date.now()
  if (remainingMs !== null && remainingMs <= 0) {
    return Promise.reject(new XapiHttpRequestError(
      'TIMEOUT',
      `XAPI HTTP request timed out after ${options.timeoutMs}ms`,
    ))
  }

  let body: Readable | undefined
  try {
    body = options.bodyFactory?.()
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    let activeResponse: IncomingMessage | null = null
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let connectionTimer: ReturnType<typeof setTimeout> | undefined
    const requestOptions: https.RequestOptions = {
      method: options.method,
      headers,
    }
    if (target.protocol === 'https:') {
      requestOptions.rejectUnauthorized = options.context.tls?.rejectUnauthorized ?? true
      const tlsHostname = target.hostname.replace(/^\[|\]$/g, '')
      if (!isIP(tlsHostname)) requestOptions.servername = tlsHostname
    }

    const onResponse = (response: IncomingMessage): void => {
      activeResponse = response
      if (connectionTimer) clearTimeout(connectionTimer)
      // XAPI sends 200 headers before reading the import stream. Only a
      // redirect or rejection ends this upload; success headers do not.
      const accepted = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300
      if (!accepted && body && !body.readableEnded && !body.destroyed) {
        body.unpipe(request)
        body.destroy()
        if (!request.writableEnded && !request.destroyed) request.end()
      }
      const onResponseAbort = (): void => {
        const error = createAbortError()
        if (body && !body.destroyed) body.destroy(error)
        response.destroy(error)
      }
      options.signal?.removeEventListener('abort', onRequestAbort)
      options.signal?.addEventListener('abort', onResponseAbort, { once: true })
      response.once('close', () => {
        if (deadlineTimer) clearTimeout(deadlineTimer)
        options.signal?.removeEventListener('abort', onResponseAbort)
        if (body && !body.destroyed) body.destroy()
      })
      resolve(response)
    }
    const request = target.protocol === 'https:'
      ? https.request(target, requestOptions, onResponse)
      : http.request(target, requestOptions, onResponse)

    const onRequestAbort = (): void => {
      const error = createAbortError()
      if (body && !body.destroyed) body.destroy(error)
      request.destroy(error)
    }
    options.signal?.addEventListener('abort', onRequestAbort, { once: true })

    const onTimeout = (): void => {
      const error = new XapiHttpRequestError(
        'TIMEOUT',
        `XAPI HTTP request timed out after ${options.timeoutMs}ms`,
      )
      if (body && !body.destroyed) body.destroy(error)
      if (activeResponse) activeResponse.destroy(error)
      else request.destroy(error)
    }
    if (remainingMs !== null) deadlineTimer = setTimeout(onTimeout, remainingMs)
    if (options.idleTimeoutMs && options.idleTimeoutMs > 0) {
      connectionTimer = setTimeout(() => request.destroy(new XapiHttpRequestError('IDLE_TIMEOUT', `XAPI HTTP connection inactive for ${options.idleTimeoutMs}ms`)), options.idleTimeoutMs)
      request.once('socket', (socket) => {
        if (socket.connecting) socket.once('connect', () => { if (connectionTimer) clearTimeout(connectionTimer) })
        else if (connectionTimer) clearTimeout(connectionTimer)
      })
      request.setTimeout(options.idleTimeoutMs, () => {
        const error = new XapiHttpRequestError('IDLE_TIMEOUT', `XAPI HTTP transfer idle for ${options.idleTimeoutMs}ms`)
        if (body && !body.destroyed) body.destroy(error)
        if (activeResponse) activeResponse.destroy(error)
        request.destroy(error)
      })
    }
    request.once('error', (error) => {
      if (connectionTimer) clearTimeout(connectionTimer)
      if (deadlineTimer) clearTimeout(deadlineTimer)
      if (body && !body.destroyed) body.destroy()
      options.signal?.removeEventListener('abort', onRequestAbort)
      const failure = isKnownRequestError(error)
        ? error
        : new XapiHttpRequestError('NETWORK', `XAPI HTTP request failed: ${error.message}`, error)
      // The headers promise is already resolved for an early 200. Deliver
      // subsequent upload failures to the response consumer as well.
      if (activeResponse) activeResponse.destroy(failure)
      reject(failure)
    })

    if (body) {
      body.once('error', (error) => request.destroy(error))
      body.once('close', () => {
        if (!body.readableEnded && !request.writableEnded && !request.destroyed) {
          request.destroy(new XapiHttpRequestError('BODY_STREAM_CLOSED', 'XAPI HTTP upload source closed before completion'))
        }
      })
      const length = Number(request.getHeader('Content-Length'))
      if (Number.isSafeInteger(length) && length >= 0) {
        let sent = 0
        const mismatch = () => new XapiHttpRequestError('BODY_LENGTH_MISMATCH',
          `XAPI HTTP upload source supplied ${sent} bytes; expected ${length}`)
        body.on('data', (chunk: Buffer | string) => {
          sent += Buffer.byteLength(chunk)
          if (sent > length) request.destroy(mismatch())
        })
        body.once('end', () => { if (sent !== length) request.destroy(mismatch()) })
      }
      body.pipe(request)
    } else {
      request.end()
    }
  })
}

function drainResponse(response: IncomingMessage): Promise<void> {
  if (response.readableEnded) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      response.removeListener('end', onEnd)
      response.removeListener('error', onError)
      response.removeListener('aborted', onAborted)
    }
    const onEnd = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onAborted = (): void => {
      cleanup()
      reject(new XapiHttpRequestError('NETWORK', 'Redirect response was aborted'))
    }
    response.once('end', onEnd)
    response.once('error', onError)
    response.once('aborted', onAborted)
    response.resume()
  })
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function inheritCanonicalQuery(target: URL, canonical: URLSearchParams): void {
  for (const protectedName of ['session_id', 'task_id']) {
    const expected = canonical.getAll(protectedName)
    const redirected = target.searchParams.getAll(protectedName)
    if (redirected.length > 0 && !sameValues(redirected, expected)) {
      throw new XapiHttpRequestError(
        'REDIRECT_CONFLICT',
        `Redirect supplied a conflicting ${protectedName} query parameter`,
      )
    }
  }

  for (const name of new Set(canonical.keys())) {
    const expected = canonical.getAll(name)
    const redirected = target.searchParams.getAll(name)
    if (redirected.length > 0 && !sameValues(redirected, expected)) {
      throw new XapiHttpRequestError(
        'REDIRECT_CONFLICT',
        `Redirect supplied a conflicting ${name} query parameter`,
      )
    }
    if (redirected.length === 0) {
      for (const value of expected) target.searchParams.append(name, value)
    }
  }
}

function redirectUrl(
  current: URL,
  location: string,
  canonicalQuery: URLSearchParams,
): URL {
  const target = new URL(location, current)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new XapiHttpRequestError(
      'UNSUPPORTED_SCHEME',
      `Unsupported XAPI HTTP redirect scheme: ${target.protocol}`,
    )
  }
  if (current.protocol === 'https:' && target.protocol === 'http:') {
    throw new XapiHttpRequestError(
      'TLS_DOWNGRADE',
      'XAPI HTTP redirect attempted to downgrade HTTPS to HTTP',
    )
  }
  if (target.origin !== current.origin) {
    throw new XapiHttpRequestError(
      'REDIRECT_AUTHORITY',
      'XAPI HTTP redirect targeted an unverified authority',
    )
  }
  inheritCanonicalQuery(target, canonicalQuery)
  return target
}

export async function requestXapiHttp(
  options: XapiHttpRequestOptions,
): Promise<IncomingMessage> {
  let target = initialUrl(options)
  const canonicalQuery = new URLSearchParams(target.searchParams)
  const headers = requestHeaders(options)
  const deadlineAt = options.timeoutMs > 0 ? Date.now() + options.timeoutMs : null

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await openResponse(target, options, headers, deadlineAt)
    if (response.statusCode !== 302 || !response.headers.location) return response

    await drainResponse(response)
    if (redirectCount >= MAX_REDIRECT_HOPS) {
      throw new XapiHttpRequestError(
        'REDIRECT_LIMIT',
        `XAPI HTTP request exceeded ${MAX_REDIRECT_HOPS} redirects`,
      )
    }
    target = redirectUrl(target, response.headers.location, canonicalQuery)
  }
}
