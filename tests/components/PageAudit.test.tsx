import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationConfigPanel } from '../../src/renderer/src/components/alerts/NotificationConfigPanel'
import { ResourceNavigation } from '../../src/renderer/src/components/layout/ResourceNavigation'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar'
import AlertsPage from '../../src/renderer/src/pages/AlertsPage'
import PoolManagerPage from '../../src/renderer/src/pages/PoolManagerPage'
import TasksPage from '../../src/renderer/src/pages/TasksPage'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useAlertStore } from '../../src/renderer/src/store/alert.store'
import { usePoolManagerStore } from '../../src/renderer/src/store/poolManager.store'

const config = () => ({ enabled: true, email: { enabled: false, host: '', port: 587, secure: false, auth: { user: '', pass: '' }, from: '', to: '' }, webhook: { enabled: false, url: '', method: 'POST' }, filterSeverities: ['error', 'warning'] })
const getConfig = vi.fn()
const saveConfig = vi.fn()
const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const

beforeEach(() => {
  vi.clearAllMocks()
  getConfig.mockResolvedValue(config())
  saveConfig.mockResolvedValue(undefined)
  Object.assign(window.xapi, { alertNotify: { getConfig, saveConfig }, alerts: { getAll: vi.fn().mockResolvedValue([]) } })
  useConnectionManagerStore.setState({ activeConnectionId: 'A', connections: ['A', 'B'].map((id) => ({ id, name: `Pool ${id}`, poolName: `Pool ${id}`, host: `${id}.invalid`, state: 'connected', errorMessage: null, connectedAt: 1 })) })
  useMultiDataStore.setState({ hosts: [], vms: [], tasks: [], srs: [], networks: [], domainStates: {}, refreshHosts: vi.fn(), refreshTasks: vi.fn().mockResolvedValue(undefined), pools: ['A', 'B'].map((id) => ({ connectionId: id, ref: `pool-${id}`, uuid: `uuid-${id}`, name_label: `Pool ${id}` })) as any })
  usePoolManagerStore.setState({ joinDialogOpen: false, ejectDialogOpen: false, transferDialogOpen: false })
  useAlertStore.setState({ alerts: [], error: null, filters: {}, startPolling: vi.fn(), stopPolling: vi.fn(), startAlertListener: vi.fn(), stopAlertListener: vi.fn() })
})

describe('page audit regressions', () => {
  it('saves the disabled notification setting instead of disabling the save action', async () => {
    render(<NotificationConfigPanel />)
    const toggle = await screen.findByRole('switch', { name: '启用通知', checked: true })
    fireEvent.click(toggle)
    expect(screen.getByRole('switch', { name: '启用通知', checked: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })))
  })

  it('retains the specific notification read failure and retries in place', async () => {
    getConfig.mockRejectedValueOnce(new Error('配置文件暂时无法读取'))
    render(<NotificationConfigPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('配置文件暂时无法读取')
    fireEvent.click(screen.getByRole('button', { name: '重新读取通知配置' }))
    expect(await screen.findByRole('switch', { name: '启用通知' })).toBeInTheDocument()
    expect(getConfig).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('associates notification channels and fields with their accessible names', async () => {
    render(<NotificationConfigPanel />)
    fireEvent.click(await screen.findByRole('switch', { name: '启用邮件通知' }))
    expect(screen.getByRole('switch', { name: '启用邮件通知', checked: true })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'SMTP 主机' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '端口' })).toHaveValue(587)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Webhook' }), { button: 0 })
    expect(screen.getByRole('switch', { name: '启用 Webhook 通知', checked: false })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Webhook URL' })).toBeInTheDocument()
  })

  it.each([false, true])('keeps all unified resource routes reachable with the sidebar collapsed=%s', (collapsed) => {
    render(<MemoryRouter future={future} initialEntries={['/vms']}><Sidebar collapsed={collapsed} /><ResourceNavigation /></MemoryRouter>)
    for (const [name, route] of [['主机', 'hosts'], ['虚拟机', 'vms'], ['存储', 'storage'], ['网络', 'networks']]) {
      expect(screen.getByRole('link', { name, exact: true })).toHaveAttribute('href', `/${route}`)
    }
  })

  it('falls back to a connected pool after the selected pool disconnects', () => {
    render(<PoolManagerPage />)
    expect(screen.getByRole('combobox', { name: '选择资源池：' })).toHaveValue('A')
    act(() => useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((connection) => connection.id === 'A' ? { ...connection, state: 'error' as const } : connection) })))
    expect(screen.getByRole('combobox', { name: '选择资源池：' })).toHaveValue('B')
    expect(screen.getByRole('heading', { name: 'Pool B' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pool A' })).not.toBeInTheDocument()
    act(() => useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((connection) => ({ ...connection, state: 'connected' as const })) })))
    expect(screen.getByRole('combobox', { name: '选择资源池：' })).toHaveValue('B')
    act(() => useConnectionManagerStore.setState({ connections: [] }))
    expect(screen.getByText('请先连接到资源池')).toBeInTheDocument()
  })

  it('shows the alert list for an unknown tab instead of an empty body', () => {
    render(<MemoryRouter future={future} initialEntries={['/alerts?tab=missing']}><AlertsPage /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: '告警消息', selected: true })).toBeInTheDocument()
    expect(screen.getByText('暂无告警')).toBeInTheDocument()
  })

  it('shows server failure details directly on the task page', () => {
    useMultiDataStore.setState({ tasks: [{ ref: 'task', connectionId: 'A', name_label: '创建磁盘', poolName: 'Pool A', status: 'failure', progress: 0, error_info: ['SR_BACKEND_FAILURE', 'Not enough space'] }] as any })
    render(<TasksPage />)
    expect(screen.getByText('失败原因：SR_BACKEND_FAILURE；Not enough space')).toBeInTheDocument()
  })
})
