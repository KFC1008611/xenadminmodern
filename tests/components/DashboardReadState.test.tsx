import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '../../src/renderer/src/pages/DashboardPage'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

vi.mock('../../src/renderer/src/components/dashboard/DashboardMetricsPanel', () => ({ DashboardMetricsPanel: () => null }))
vi.mock('../../src/renderer/src/store/syncManager.store', () => ({ syncManager: { refreshNow: vi.fn() } }))
vi.mock('../../src/renderer/src/store/metrics.store', () => {
  const state = { startCollection: vi.fn(), stopCollection: vi.fn(), collectionIntervalIds: new Map() }
  return { useMetricsStore: Object.assign(() => state, { getState: () => state }) }
})

const success = { loading: false, lastSuccessAt: 1, error: null }
const disk = { connectionId: 'a', ref: 'OpaqueRef:disk', uuid: 'disk', name_label: 'Local', type: 'ext', physical_size: 1000, physical_utilisation: 200, virtual_allocation: 300, shared: false, VDIs: [], poolName: 'Pool A' }

beforeEach(() => {
  useConnectionManagerStore.setState({ connections: [{ id: 'a', name: 'Pool A', poolName: 'Pool A', host: '192.0.2.1', poolRef: 'OpaqueRef:pool', state: 'connected', connectedAt: 1, errorMessage: null }] })
  useMultiDataStore.setState({ hosts: [{ connectionId: 'a', enabled: true, ref: 'OpaqueRef:host', name_label: 'Host' } as never], vms: [], srs: [], tasks: [], loading: false,
    domainStates: { a: { hosts: success, vms: success, tasks: success, srs: { loading: false, lastSuccessAt: null, error: 'SR read failed' } } } })
})

describe('dashboard resource availability', () => {
  it('does not present failed storage reads as zero capacity or a healthy pool', () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DashboardPage /></MemoryRouter>)
    const card = screen.getByText('存储已用').closest('.rounded-xl')!
    expect(within(card as HTMLElement).getByText('--')).toBeInTheDocument()
    expect(screen.getByText('存储容量暂不可用')).toBeInTheDocument()
    expect(screen.getByText('资源读取异常')).toBeInTheDocument()
    expect(screen.queryByText('健康')).not.toBeInTheDocument()
    expect(screen.queryByText('0 B')).not.toBeInTheDocument()
  })
  it('keeps unknown ISO capacity out of disk totals and marks retained values after a failed reread', () => {
    useMultiDataStore.setState({ srs: [disk, { ...disk, ref: 'OpaqueRef:iso', type: 'iso', physical_size: -1, physical_utilisation: -1 }], domainStates: { a: { hosts: success, vms: success, srs: success } } })
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DashboardPage /></MemoryRouter>)
    expect(screen.getByText('200 B')).toBeInTheDocument()
    expect(screen.getByText('共 1000 B')).toBeInTheDocument()
    act(() => useMultiDataStore.setState({ domainStates: { a: { hosts: success, vms: success, srs: { ...success, error: 'temporary failure' } } } }))
    expect(screen.getByText('上次读取 · 共 1000 B')).toBeInTheDocument()
    expect(screen.getByText('资源读取异常')).toBeInTheDocument()
  })
})
