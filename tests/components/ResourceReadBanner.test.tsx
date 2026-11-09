import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ResourceReadBanner } from '../../src/renderer/src/components/layout/ResourceReadBanner'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

beforeEach(() => {
  useConnectionManagerStore.setState({ connections: ['a', 'b'].map((id) => ({ id, name: id, host: id, poolName: id, poolRef: null, state: 'connected', errorMessage: null, connectedAt: 1 })) })
  useMultiDataStore.setState({ domainStates: {} })
})

describe('resource refresh status layout', () => {
  it('shows initial reads and failures while keeping healthy and background refresh states out of the content', () => {
    const states = () => Object.fromEntries(['a', 'b'].map((id) => [id, Object.fromEntries(['vms', 'hosts', 'srs', 'networks', 'tasks', 'pools'].map((domain) => [domain, { loading: true, error: null, lastSuccessAt: null }]))]))
    useMultiDataStore.setState({ domainStates: states() })
    render(<MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ResourceReadBanner /></MemoryRouter>)
    const row = screen.getByLabelText('资源读取状态')
    expect(row).toHaveClass('h-10')
    expect(row.querySelectorAll('[role="status"]')).toHaveLength(12)
    expect(row.querySelector('details > div')).toHaveClass('absolute', 'max-h-64', 'overflow-y-auto')
    const background = states()
    Object.values(background).forEach((domains) => Object.values(domains).forEach((state) => { state.lastSuccessAt = 1 }))
    act(() => useMultiDataStore.setState({ domainStates: background }))
    expect(screen.queryByLabelText('资源读取状态')).not.toBeInTheDocument()
    act(() => useMultiDataStore.setState({ domainStates: {} }))
    expect(screen.queryByLabelText('资源读取状态')).not.toBeInTheDocument()
    act(() => useMultiDataStore.setState({ domainStates: { a: { vms: { loading: false, error: '读取失败', lastSuccessAt: 1 } } } as any }))
    expect(screen.getByLabelText('资源读取状态')).toHaveTextContent('1 项资源读取异常')
    expect(screen.getByRole('alert')).toHaveTextContent('当前显示上次成功读取的数据')
    expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled()
  })
})
