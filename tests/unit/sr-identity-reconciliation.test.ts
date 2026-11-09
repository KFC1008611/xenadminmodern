import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySrIdentityRecord, getConnectionReadIdentity, useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

const sr = { connectionId: 'a', ref: 'OpaqueRef:sr', name_label: 'Old name', name_description: 'Old description', VDIs: ['OpaqueRef:disk'] }
const identity = { nameLabel: 'Verified name', nameDescription: 'Verified description' }
const connection = { id: 'a', host: 'test', poolName: 'Pool A', state: 'connected', connectedAt: 100, epoch: 1, poolUuid: 'pool-a' }
beforeEach(() => {
  useConnectionManagerStore.setState({ connections: [connection] as any })
  useMultiDataStore.setState({ srs: [sr, { ...sr, connectionId: 'b', name_label: 'Other pool' }] as any, domainStates: { a: { srs: { error: null, loading: false, lastSuccessAt: 50 } } }, loading: false, loadingConnections: [] })
})

describe('authoritative SR identity reconciliation', () => {
  it('invalidates an older in-flight SR list without leaving loading or rewriting list freshness', async () => {
    let finish!: (value: unknown[]) => void
    ;(globalThis as any).window = { xapi: { storage: { listSrs: vi.fn(() => new Promise((resolve) => { finish = resolve })) } } }
    const refresh = useMultiDataStore.getState().refreshSrs()
    expect(useMultiDataStore.getState().loadingConnections).toEqual(['a'])
    expect(applySrIdentityRecord('a', 'OpaqueRef:sr', identity, getConnectionReadIdentity('a'))).toBe(true)
    expect(useMultiDataStore.getState().domainStates.a.srs).toEqual({ error: null, loading: false, lastSuccessAt: 50 })
    expect(useMultiDataStore.getState().loadingConnections).toEqual([])
    expect(useMultiDataStore.getState().loading).toBe(false)
    finish([sr])
    await refresh
    expect(useMultiDataStore.getState().srs[0]).toMatchObject({ name_label: 'Verified name', name_description: 'Verified description', VDIs: ['OpaqueRef:disk'] })
    expect(useMultiDataStore.getState().srs[1].name_label).toBe('Other pool')
    expect(useMultiDataStore.getState().domainStates.a.srs?.lastSuccessAt).toBe(50)
  })

  it('does not clear an unrelated SR list error after a partial identity readback', () => {
    useMultiDataStore.setState({ domainStates: { a: { srs: { error: 'list unavailable', loading: true, lastSuccessAt: 50 } } } })
    applySrIdentityRecord('a', 'OpaqueRef:sr', identity, getConnectionReadIdentity('a'))
    expect(useMultiDataStore.getState().domainStates.a.srs).toEqual({ error: 'list unavailable', loading: false, lastSuccessAt: 50 })
  })

  it('waits for a fresh list after identity readback and preserves its loading state', async () => {
    let finish!: (rows: unknown[]) => void
    const updated = { ...sr, name_label: identity.nameLabel, name_description: identity.nameDescription }
    const listSrs = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce([updated])
    ;(globalThis as any).window = { xapi: { storage: { listSrs } } }
    const background = useMultiDataStore.getState().refreshSrs()
    applySrIdentityRecord('a', sr.ref, identity, getConnectionReadIdentity('a'))
    const afterMutation = useMultiDataStore.getState().refreshSrs({ afterMutation: true, connectionId: 'a' })
    expect(useMultiDataStore.getState().domainStates.a.srs?.loading).toBe(true)
    finish([sr])
    await Promise.all([background, afterMutation])
    expect(listSrs).toHaveBeenCalledTimes(2)
    expect(useMultiDataStore.getState().domainStates.a.srs?.loading).toBe(false)
    expect(useMultiDataStore.getState().srs.find((row) => row.connectionId === 'a')?.name_label).toBe(identity.nameLabel)
  })

  it('discards an edit result from an earlier connection lifetime even with the same pool and SR reference', () => {
    const previous = getConnectionReadIdentity('a')
    useConnectionManagerStore.setState({ connections: [{ ...connection, epoch: 2 }] as any })
    expect(applySrIdentityRecord('a', 'OpaqueRef:sr', identity, previous)).toBe(false)
    expect(useMultiDataStore.getState().srs[0].name_label).toBe('Old name')
  })
})
