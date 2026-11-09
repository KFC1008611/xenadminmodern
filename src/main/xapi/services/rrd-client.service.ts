/**
 * RRD Client service — fetches performance metrics from XenServer's RRD HTTP endpoints.
 *
 * XenServer exposes RRD (Round Robin Database) data via HTTP endpoints:
 *   /host_rrd?session_id=<session_ref>                — host performance data
 *   /vm_rrd?session_id=<session_ref>&uuid=<vm_uuid>   — VM performance data
 *
 * These endpoints return XML with 5-second sampling granularity for the most
 * recent 10 minutes, and lower granularity for older data.
 *
 * Incremental updates use the /rrd_updates HTTP endpoint.
 */
import type { IncomingMessage } from 'http'
import type { AuthenticatedHttpContext } from '../client'
import { connectionManager } from '../connection-manager'
import { requestXapiHttp } from '../http-data-plane'

// ============================================================================
// Error types
// ============================================================================

export type RrdErrorCode = 'NETWORK' | 'AUTH' | 'TIMEOUT' | 'PARSE' | 'NOT_FOUND' | 'TOO_LARGE'

export class RrdFetchError extends Error {
  readonly code: RrdErrorCode
  readonly endpoint: string
  readonly cause?: Error
  /** Server HTTP clock, used when requesting a bounded metrics window. */
  serverTime?: number

  constructor(code: RrdErrorCode, endpoint: string, message: string, cause?: Error) {
    super(message)
    this.name = 'RrdFetchError'
    this.code = code
    this.endpoint = endpoint
    this.cause = cause
  }
}

// ============================================================================
// Configuration
// ============================================================================

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024 // 10 MB

// ============================================================================
// Internal helpers
// ============================================================================

function getAuthenticatedHttpContext(connectionId: string): AuthenticatedHttpContext {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new RrdFetchError('NETWORK', '', `No connection found for connectionId: ${connectionId}`)
  }

  const context = client.getAuthenticatedHttpContext()
  if (!context) {
    throw new RrdFetchError('AUTH', '', `No active session for connectionId: ${connectionId}`)
  }

  return context
}

function buildEndpoint(
  context: AuthenticatedHttpContext,
  path: string,
  query: URLSearchParams,
): string {
  const host = context.host.includes(':') && !context.host.startsWith('[')
    ? `[${context.host}]`
    : context.host
  const safeQuery = new URLSearchParams(query)
  if (safeQuery.has('session_id')) safeQuery.set('session_id', '[REDACTED]')
  return `${context.scheme}//${host}:${context.port}${path}?${safeQuery.toString()}`
}

function requestError(error: unknown, endpoint: string): RrdFetchError {
  if (error instanceof RrdFetchError) return error
  const cause = error instanceof Error ? error : undefined
  const code = typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'TIMEOUT'
    ? 'TIMEOUT'
    : 'NETWORK'
  return new RrdFetchError(
    code,
    endpoint,
    `RRD request failed: ${cause?.message ?? String(error)}`,
    cause,
  )
}

async function readResponse(response: IncomingMessage, endpoint: string): Promise<string> {
  const statusCode = response.statusCode ?? 0
  if (statusCode === 401 || statusCode === 403) {
    response.resume()
    throw new RrdFetchError('AUTH', endpoint, `Authentication failed (HTTP ${statusCode})`)
  }
  if (statusCode === 404) {
    response.resume()
    throw new RrdFetchError('NOT_FOUND', endpoint, 'Resource not found (HTTP 404)')
  }
  if (statusCode < 200 || statusCode >= 300) {
    response.resume()
    throw new RrdFetchError('NETWORK', endpoint, `Unexpected HTTP status: ${statusCode}`)
  }

  const chunks: Buffer[] = []
  let totalSize = 0
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalSize += buffer.length
      if (totalSize > MAX_RESPONSE_SIZE) {
        response.destroy()
        const error = new RrdFetchError(
          'TOO_LARGE',
          endpoint,
          `RRD response exceeds maximum size (${MAX_RESPONSE_SIZE} bytes)`,
        )
        const serverTime = Date.parse(response.headers.date ?? '')
        if (Number.isFinite(serverTime)) error.serverTime = serverTime
        throw error
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof RrdFetchError) throw error
    throw new RrdFetchError(
      'NETWORK',
      endpoint,
      `Response error: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined,
    )
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function fetchResponse(
  context: AuthenticatedHttpContext,
  path: string,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = buildEndpoint(context, path, query)
  try {
    const response = await requestXapiHttp({
      context,
      method: 'GET',
      path,
      query,
      headers: { Accept: 'application/xml' },
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal,
    })
    return await readResponse(response, endpoint)
  } catch (error) {
    throw requestError(error, endpoint)
  }
}

async function getHostContext(connectionId: string, hostUuid: string): Promise<AuthenticatedHttpContext> {
  const context = getAuthenticatedHttpContext(connectionId)
  const client = connectionManager.getClient(connectionId)!
  // Resolve from this authenticated pool, never from an unverified caller URL.
  const hostRef = await client.callWithSession('host.get_by_uuid', [hostUuid])
  const address = await client.callWithSession('host.get_address', [hostRef])
  if (typeof address !== 'string' || !address.trim() || /[\s/@?#]/.test(address)) throw new RrdFetchError('NETWORK', '/host_rrd', 'Host management address is unavailable')
  return { ...context, host: address.trim() }
}

// ============================================================================
// Exported functions
// ============================================================================

/**
 * Fetch host RRD XML from XenServer.
 * Uses the /host_rrd HTTP endpoint.
 * Reuses the authenticated management transport.
 */
export async function fetchHostRrd(
  connectionId: string,
  hostUuid: string,
  signal?: AbortSignal,
): Promise<string> {
  const context = await getHostContext(connectionId, hostUuid)
  const query = new URLSearchParams([['session_id', context.sessionId]])
  return fetchResponse(context, '/host_rrd', query, signal)
}

/**
 * Fetch VM RRD XML from XenServer.
 * Uses the /vm_rrd HTTP endpoint with the VM's UUID.
 */
export async function fetchVmRrd(
  connectionId: string,
  vmUuid: string,
  signal?: AbortSignal,
): Promise<string> {
  const context = getAuthenticatedHttpContext(connectionId)
  const query = new URLSearchParams([
    ['session_id', context.sessionId],
    ['uuid', vmUuid],
  ])
  return fetchResponse(context, '/vm_rrd', query, signal)
}

/**
 * Fetch incremental RRD updates via the /rrd_updates HTTP endpoint.
 * Returns XML string with data since the given start time.
 *
 * @param connectionId The connection identifier
 * @param start Unix timestamp (seconds) to fetch updates from
 * @param includeHost Include host metrics alongside resident VM metrics
 * @param hostUuid Query this authenticated pool member instead of the connection endpoint
 */
export async function fetchRrdUpdates(
  connectionId: string,
  start: number,
  includeHost: boolean = false,
  hostUuid?: string,
  signal?: AbortSignal,
): Promise<string> {
  const context = hostUuid ? await getHostContext(connectionId, hostUuid) : getAuthenticatedHttpContext(connectionId)
  const query = new URLSearchParams([
    ['session_id', context.sessionId],
    ['start', String(Math.floor(start))],
    ['cf', 'AVERAGE'],
    ['interval', '5'],
    ['host', includeHost ? 'true' : 'false'],
  ])
  return fetchResponse(context, '/rrd_updates', query, signal)
}
