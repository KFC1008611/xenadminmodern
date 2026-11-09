import { describe, expect, it, vi } from 'vitest'
import { getIpcContractBinding } from '../../src/preload/ipc-contract-client'
import { PIF_LIST } from '../../src/shared/channels'
import { ipcContractInventory } from '../../src/shared/ipc-contracts/inventory'

const bridge = vi.hoisted(() => ({ api: undefined as unknown }))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: unknown) => {
      bridge.api = api
    }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

function collectFunctions(
  value: unknown,
  path: string[] = [],
): Array<{ path: string; fn: Function }> {
  if (typeof value === 'function') return [{ path: path.join('.'), fn: value }]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, child]) => (
    collectFunctions(child, [...path, key])
  ))
}

describe('preload IPC contract pairing', () => {
  it('exposes every invoke and push descriptor exactly once in the real bridge API', async () => {
    await import('../../src/preload/index')

    const exposures = collectFunctions(bridge.api)
    const bound = exposures.map(({ path, fn }) => ({
      path,
      contract: getIpcContractBinding(fn),
    }))
    const unbound = bound.filter(({ contract }) => !contract).map(({ path }) => path)
    const paired = bound.flatMap(({ path, contract }) => contract ? [{ path, contract }] : [])
    const pathsByIdentity = new Map<string, string[]>()

    for (const { path, contract } of paired) {
      const identity = `${contract.direction}:${contract.channel}`
      pathsByIdentity.set(identity, [...(pathsByIdentity.get(identity) ?? []), path])
    }

    expect(unbound).toEqual([])
    expect(paired).toHaveLength(245)
    expect(new Set(pathsByIdentity.keys())).toEqual(new Set(
      ipcContractInventory.contracts.map(({ channel, direction }) => `${direction}:${channel}`),
    ))
    expect([...pathsByIdentity.values()].filter((paths) => paths.length !== 1)).toEqual([])
    expect(pathsByIdentity.get(`invoke:${PIF_LIST}`)).toEqual(['network.listPifs'])
  })
})
