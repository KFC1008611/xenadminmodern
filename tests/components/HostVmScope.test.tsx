import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useHostVmScope } from '../../src/renderer/src/lib/useHostVmScope'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

beforeEach(() => {
  useConnectionManagerStore.setState({ connections: [{ id: 'pool', state: 'connected', connectedAt: 1, epoch: 1 }] as any })
  useMultiDataStore.setState({ domainStates: {}, hosts: [{ ref: 'a', connectionId: 'pool' }, { ref: 'b', connectionId: 'pool' }] as any, srs: [{ ref: 'local', shared: false, connectionId: 'pool' }] as any,
    vms: [
      { ref: 'running', power_state: 'Running', resident_on: 'a', affinity: 'b' },
      { ref: 'paused', power_state: 'Paused', resident_on: 'a' },
      { ref: 'local-disk', power_state: 'Halted', affinity: 'b', VBDs: ['vbd-local'] },
      { ref: 'preferred', power_state: 'Halted', affinity: 'a', VBDs: [] },
      { ref: 'unassigned', power_state: 'Halted', resident_on: 'a', VBDs: [] },
      { ref: 'other-running', power_state: 'Running', resident_on: 'b' },
      { ref: 'template', power_state: 'Halted', affinity: 'a', is_a_template: true },
    ].map((vm) => ({ ...vm, connectionId: 'pool' })) as any,
  })
  window.xapi.pbd = { ...window.xapi.pbd, list: vi.fn().mockResolvedValue([{ SR: 'local', host: 'a' }]) }
  window.xapi.storage = { ...window.xapi.storage, listVdis: vi.fn().mockResolvedValue([{ VBDs: ['vbd-local'] }]) }
})

it('uses current residency then local storage then affinity, keeping unassigned VMs at pool scope', async () => {
  const { result } = renderHook(() => useHostVmScope('pool', 'a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect([...result.current.refs]).toEqual(['running', 'paused', 'local-disk', 'preferred'])
})

it('ignores disk relationship results from a replaced connection and retries the current identity', async () => {
  let resolveOld!: (value: any[]) => void
  window.xapi.pbd.list = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve })).mockResolvedValue([{ SR: 'local', host: 'b' }])
  const { result } = renderHook(() => useHostVmScope('pool', 'a'))
  act(() => useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((connection) => ({ ...connection, epoch: 2 })) })))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => resolveOld([{ SR: 'local', host: 'a' }]))
  expect(result.current.refs.has('local-disk')).toBe(false)
})

it('preserves known resident VMs on storage read failure and retries stopped VM placement', async () => {
  vi.mocked(window.xapi.pbd.list).mockRejectedValueOnce(new Error('PBD denied'))
  const { result } = renderHook(() => useHostVmScope('pool', 'a'))
  await waitFor(() => expect(result.current.error).toBe('PBD denied'))
  expect([...result.current.refs]).toEqual(['running', 'paused'])
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.error).toBeNull())
  await waitFor(() => expect(result.current.refs.has('local-disk')).toBe(true))
})

it('reconciles running VM migration without using its preferred host', async () => {
  const { result } = renderHook(() => useHostVmScope('pool', 'a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => useMultiDataStore.setState((state) => ({ vms: state.vms.map((vm) => vm.ref === 'running' ? { ...vm, resident_on: 'b' } : vm) })))
  expect(result.current.refs.has('running')).toBe(false)
})

it('performs no disk relationship reads outside a host workspace', () => {
  renderHook(() => useHostVmScope('pool', undefined))
  expect(window.xapi.pbd.list).not.toHaveBeenCalled()
  expect(window.xapi.storage.listVdis).not.toHaveBeenCalled()
})

it('does not infer stopped VM placement from an unsuccessful SR inventory', async () => {
  useMultiDataStore.setState({ domainStates: { pool: { srs: { loading: false, lastSuccessAt: 1, error: 'SR denied' } } } })
  const { result } = renderHook(() => useHostVmScope('pool', 'a'))
  await waitFor(() => expect(result.current.error).toBe('SR denied'))
  expect([...result.current.refs]).toEqual(['running', 'paused'])
  expect(window.xapi.pbd.list).not.toHaveBeenCalled()
})
