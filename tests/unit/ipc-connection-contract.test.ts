import { describe, expect, it } from 'vitest'
import * as Ch from '../../src/shared/channels'
import {
  connectionConnectContract,
  connectionDisconnectContract,
  connectionGetInfoContract,
  connectionListContract,
  connectionReconnectContract,
  connectionSessionContracts,
  sessionConnectContract,
  sessionDisconnectContract,
  sessionStatusContract,
} from '../../src/shared/ipc-contracts/connection'

const connectionOptions = {
  host: 'xcp.example.test',
  port: 443,
  scheme: 'https:' as const,
  username: 'root',
  password: 'pool-password',
  allowSelfSigned: true,
  name: 'Production Pool',
}

const connectionInfo = {
  id: 'connection-1',
  name: 'Production Pool',
  host: 'xcp.example.test',
  poolName: 'Pool A',
  poolRef: 'OpaqueRef:pool',
  state: 'connected' as const,
  errorMessage: null,
  connectedAt: 1_785_600_000_000,
}

function expectRejected(schema: { parse(value: unknown): unknown }, values: readonly unknown[]): void {
  for (const value of values) expect(() => schema.parse(value)).toThrow()
}

describe('connection and session IPC contracts', () => {
  it('exports the exact eight ordered invoke descriptors and their boundary metadata', () => {
    const expected = [
      [connectionConnectContract, Ch.CONNECTION_CONNECT, ['credentials']],
      [connectionDisconnectContract, Ch.CONNECTION_DISCONNECT, ['none']],
      [connectionListContract, Ch.CONNECTION_LIST, ['none']],
      [connectionReconnectContract, Ch.CONNECTION_RECONNECT, ['credentials']],
      [connectionGetInfoContract, Ch.CONNECTION_GET_INFO, ['none']],
      [sessionConnectContract, Ch.SESSION_CONNECT, ['credentials']],
      [sessionDisconnectContract, Ch.SESSION_DISCONNECT, ['none']],
      [sessionStatusContract, Ch.SESSION_STATUS, ['none']],
    ] as const

    expect(connectionSessionContracts).toEqual(expected.map(([contract]) => contract))
    expect(new Set(connectionSessionContracts.map(({ channel }) => channel))).toHaveLength(8)
    for (const [contract, channel, redaction] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction,
      })
    }
  })

  it('parses the exact connection options tuple with an optional non-empty name', () => {
    expect(connectionConnectContract.argsSchema.parse([connectionOptions])).toEqual([connectionOptions])
    expect(sessionConnectContract.argsSchema.parse([connectionOptions])).toEqual([connectionOptions])

    const { name: _name, ...withoutName } = connectionOptions
    expect(connectionConnectContract.argsSchema.parse([withoutName])).toEqual([withoutName])
  })

  it('rejects malformed connection options, unknown fields, and extra tuple values', () => {
    const invalidOptions = [
      null,
      [],
      new Date(),
      { ...connectionOptions, unknown: true },
      { ...connectionOptions, host: '   ' },
      { ...connectionOptions, port: 0 },
      { ...connectionOptions, port: 65_536 },
      { ...connectionOptions, port: 443.5 },
      { ...connectionOptions, scheme: 'ftp:' },
      { ...connectionOptions, username: '' },
      { ...connectionOptions, password: '' },
      { ...connectionOptions, allowSelfSigned: 'yes' },
      { ...connectionOptions, name: '   ' },
      { ...connectionOptions, name: undefined },
      {
        host: connectionOptions.host,
        port: connectionOptions.port,
        scheme: connectionOptions.scheme,
        username: connectionOptions.username,
        password: connectionOptions.password,
      },
    ]

    for (const contract of [connectionConnectContract, sessionConnectContract]) {
      expectRejected(contract.argsSchema, [
        [],
        [connectionOptions, 'extra'],
        ...invalidOptions.map((value) => [value]),
      ])
    }
  })

  it('parses one non-blank connection identity without rewriting it', () => {
    for (const contract of [
      connectionDisconnectContract,
      connectionGetInfoContract,
    ]) {
      expect(contract.argsSchema.parse(['  connection-1  '])).toEqual(['  connection-1  '])
      expectRejected(contract.argsSchema, [[], [''], ['   '], [1], ['connection-1', 'extra']])
    }
    expect(connectionReconnectContract.argsSchema.parse(['connection-1'])).toEqual(['connection-1'])
    expect(connectionReconnectContract.argsSchema.parse(['connection-1', 'replacement'])).toEqual(['connection-1', 'replacement'])
    expectRejected(connectionReconnectContract.argsSchema, [[], [''], [1], ['connection-1', ''], ['connection-1', null], ['connection-1', 'replacement', 'extra']])
  })

  it('requires an exact empty tuple for requests without arguments', () => {
    for (const contract of [connectionListContract, sessionDisconnectContract, sessionStatusContract]) {
      expect(contract.argsSchema.parse([])).toEqual([])
      expectRejected(contract.argsSchema, [[undefined], ['extra']])
    }
  })

  it('validates the two connection success result shapes exactly', () => {
    expect(connectionConnectContract.resultSchema.parse({ id: 'connection-1' }))
      .toEqual({ id: 'connection-1' })
    expect(sessionConnectContract.resultSchema.parse({ id: 'default', connected: true }))
      .toEqual({ id: 'default', connected: true })

    expectRejected(connectionConnectContract.resultSchema, [
      null,
      { id: '' },
      { id: 'connection-1', extra: true },
    ])
    expectRejected(sessionConnectContract.resultSchema, [
      { id: 'default', connected: false },
      { id: 'default', connected: true, extra: true },
    ])
  })

  it('accepts only undefined for disconnect and reconnect results', () => {
    for (const contract of [
      connectionDisconnectContract,
      connectionReconnectContract,
      sessionDisconnectContract,
    ]) {
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
      expectRejected(contract.resultSchema, [null, {}, false])
    }
  })

  it('validates complete ConnectionInfo records and state values', () => {
    expect(connectionListContract.resultSchema.parse([connectionInfo])).toEqual([connectionInfo])
    expect(connectionGetInfoContract.resultSchema.parse(connectionInfo)).toEqual(connectionInfo)

    const invalidRecords = [
      { ...connectionInfo, state: 'offline' },
      { ...connectionInfo, connectedAt: 'now' },
      { ...connectionInfo, poolName: 1 },
      { ...connectionInfo, extra: true },
      {
        id: connectionInfo.id,
        name: connectionInfo.name,
        host: connectionInfo.host,
        poolName: connectionInfo.poolName,
        poolRef: connectionInfo.poolRef,
        state: connectionInfo.state,
        errorMessage: connectionInfo.errorMessage,
      },
    ]
    expectRejected(connectionGetInfoContract.resultSchema, invalidRecords)
    expectRejected(connectionListContract.resultSchema, [connectionInfo, invalidRecords])
  })

  it('validates the exact legacy session status result', () => {
    expect(sessionStatusContract.resultSchema.parse({ connected: false }))
      .toEqual({ connected: false })
    expectRejected(sessionStatusContract.resultSchema, [
      null,
      { connected: 'false' },
      { connected: false, extra: true },
    ])
  })
})
