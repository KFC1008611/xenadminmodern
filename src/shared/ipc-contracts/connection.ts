import * as Ch from '../channels'
import {
  defineInvokeContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  ConnectionInfo,
  XapiConnectionOptions,
} from '../types/xapi'
import {
  invalid,
  noArgsSchema,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requirePlainObject,
  requirePositiveInteger,
  requireString,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

const CONNECTION_OPTION_KEYS = [
  'host',
  'port',
  'scheme',
  'username',
  'password',
  'allowSelfSigned',
] as const

const CONNECTION_INFO_KEYS = [
  'id',
  'name',
  'host',
  'poolName',
  'poolRef',
  'state',
  'errorMessage',
  'connectedAt',
] as const

const CONNECTION_STATES = new Set<ConnectionInfo['state']>([
  'connecting',
  'connected',
  'disconnected',
  'error',
])

function requireNullableString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label)
}

const connectionOptionsArgsSchema: IpcRuntimeSchema<[XapiConnectionOptions]> = {
  parse(value: unknown): [XapiConnectionOptions] {
    const [candidate] = requireTuple(value, 1, 'connection options arguments')
    const options = requirePlainObject(candidate, 'connection options')
    requireExactKeys(options, CONNECTION_OPTION_KEYS, ['name'], 'connection options')

    const host = requireNonBlankString(options.host, 'connection host')
    const port = requirePositiveInteger(options.port, 'connection port')
    if (port > 65_535) invalid('connection port')
    if (options.scheme !== 'http:' && options.scheme !== 'https:') {
      invalid('connection scheme')
    }
    const username = requireNonBlankString(options.username, 'connection username')
    const password = requireNonBlankString(options.password, 'connection password')
    const allowSelfSigned = requireBoolean(options.allowSelfSigned, 'connection TLS policy')

    const parsed: XapiConnectionOptions = {
      host,
      port: port as number,
      scheme: options.scheme,
      username,
      password,
      allowSelfSigned,
    }
    if (Object.prototype.hasOwnProperty.call(options, 'name')) {
      parsed.name = requireNonBlankString(options.name, 'connection name')
    }
    return [parsed]
  },
}

const connectionIdArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [candidate] = requireTuple(value, 1, 'connection identity arguments')
    return [requireNonBlankString(candidate, 'connection identity')]
  },
}

const connectionIdResultSchema: IpcRuntimeSchema<{ id: string }> = {
  parse(value: unknown): { id: string } {
    const result = requirePlainObject(value, 'connection result')
    requireExactKeys(result, ['id'], [], 'connection result')
    return { id: requireNonBlankString(result.id, 'connection result identity') }
  },
}

const reconnectArgsSchema: IpcRuntimeSchema<[string, string?]> = {
  parse(value: unknown): [string, string?] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) invalid('reconnect arguments')
    const id = requireNonBlankString(value[0], 'connection identity')
    return value.length === 1 ? [id] : [id, requireNonBlankString(value[1], 'connection password')]
  },
}

function parseConnectionInfo(value: unknown): ConnectionInfo {
  const info = requirePlainObject(value, 'connection information')
  requireExactKeys(info, CONNECTION_INFO_KEYS, ['epoch', 'poolUuid', 'lastRequestFailure'], 'connection information')

  const state = requireEnum(info.state, CONNECTION_STATES, 'connection state')
  const connectedAt = info.connectedAt
  const parsedConnectedAt = connectedAt === null
    ? null
    : requireFiniteNumber(connectedAt, 'connection timestamp')

  return {
    id: requireNonBlankString(info.id, 'connection information identity'),
    name: requireNonBlankString(info.name, 'connection information name'),
    host: requireNonBlankString(info.host, 'connection information host'),
    poolName: requireNullableString(info.poolName, 'connection pool name'),
    poolRef: requireNullableString(info.poolRef, 'connection pool reference'),
    state,
    errorMessage: requireNullableString(info.errorMessage, 'connection error message'),
    connectedAt: parsedConnectedAt,
    ...(info.epoch === undefined ? {} : { epoch: requireFiniteNumber(info.epoch, 'connection epoch') }),
    ...(info.poolUuid === undefined ? {} : { poolUuid: requireNonBlankString(info.poolUuid, 'pool UUID') }),
    ...(info.lastRequestFailure === undefined ? {} : { lastRequestFailure: parseRequestFailure(info.lastRequestFailure) }),
  }
}

function parseRequestFailure(value: unknown): NonNullable<ConnectionInfo['lastRequestFailure']> {
  const record = requirePlainObject(value, 'request failure')
  requireExactKeys(record, ['method', 'code', 'durationMs', 'occurredAt', 'sessionAvailable'], [], 'request failure')
  return {
    method: requireString(record.method, 'failed method'), code: requireString(record.code, 'request error code'),
    durationMs: requireFiniteNumber(record.durationMs, 'request duration'), occurredAt: requireFiniteNumber(record.occurredAt, 'request error timestamp'),
    sessionAvailable: record.sessionAvailable === null ? null : requireBoolean(record.sessionAvailable, 'session probe result'),
  }
}

const connectionInfoResultSchema: IpcRuntimeSchema<ConnectionInfo> = {
  parse: parseConnectionInfo,
}

const connectionListResultSchema: IpcRuntimeSchema<ConnectionInfo[]> = {
  parse(value: unknown): ConnectionInfo[] {
    if (!Array.isArray(value)) invalid('connection list result')
    return value.map(parseConnectionInfo)
  },
}

const sessionConnectResultSchema: IpcRuntimeSchema<{ id: string; connected: true }> = {
  parse(value: unknown): { id: string; connected: true } {
    const result = requirePlainObject(value, 'session connect result')
    requireExactKeys(result, ['id', 'connected'], [], 'session connect result')
    if (result.connected !== true) invalid('session connected state')
    return {
      id: requireNonBlankString(result.id, 'session result identity'),
      connected: true,
    }
  },
}

const sessionStatusResultSchema: IpcRuntimeSchema<{ connected: boolean }> = {
  parse(value: unknown): { connected: boolean } {
    const result = requirePlainObject(value, 'session status result')
    requireExactKeys(result, ['connected'], [], 'session status result')
    if (typeof result.connected !== 'boolean') invalid('session status')
    return { connected: result.connected }
  },
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
}

export const connectionConnectContract = defineInvokeContract({
  channel: Ch.CONNECTION_CONNECT,
  argsSchema: connectionOptionsArgsSchema,
  resultSchema: connectionIdResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const connectionDisconnectContract = defineInvokeContract({
  channel: Ch.CONNECTION_DISCONNECT,
  argsSchema: connectionIdArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const connectionListContract = defineInvokeContract({
  channel: Ch.CONNECTION_LIST,
  argsSchema: noArgsSchema,
  resultSchema: connectionListResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const connectionReconnectContract = defineInvokeContract({
  channel: Ch.CONNECTION_RECONNECT,
  argsSchema: reconnectArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const connectionGetInfoContract = defineInvokeContract({
  channel: Ch.CONNECTION_GET_INFO,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectionInfoResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const sessionConnectContract = defineInvokeContract({
  channel: Ch.SESSION_CONNECT,
  argsSchema: connectionOptionsArgsSchema,
  resultSchema: sessionConnectResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const sessionDisconnectContract = defineInvokeContract({
  channel: Ch.SESSION_DISCONNECT,
  argsSchema: noArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const sessionStatusContract = defineInvokeContract({
  channel: Ch.SESSION_STATUS,
  argsSchema: noArgsSchema,
  resultSchema: sessionStatusResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const connectionSessionContracts = Object.freeze([
  connectionConnectContract,
  connectionDisconnectContract,
  connectionListContract,
  connectionReconnectContract,
  connectionGetInfoContract,
  sessionConnectContract,
  sessionDisconnectContract,
  sessionStatusContract,
] as const)
