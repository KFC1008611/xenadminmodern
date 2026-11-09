import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SoftwareUpdateSettings } from '../../src/renderer/src/components/layout/SoftwareUpdateSettings'
import type { UpdateState } from '../../src/shared/ipc-contracts/updates'

const initial: UpdateState = { currentVersion: '1.2.1', enabled: true, supported: true, status: 'idle', version: null, progress: 0, checkedAt: 1000, message: '' }
let api: Window['xapi']['updates']
beforeEach(() => {
  api = { getState: vi.fn().mockResolvedValue(initial), setEnabled: vi.fn().mockResolvedValue({ ...initial, enabled: false }), check: vi.fn().mockResolvedValue(initial), download: vi.fn().mockResolvedValue({ ...initial, status: 'downloading', progress: 12, message: '正在下载更新' }), install: vi.fn().mockResolvedValue({ ...initial, status: 'installing', message: '正在准备重启安装' }) }
  window.xapi = { ...window.xapi, updates: api }
})
describe('built-in update control', () => {
  it('shows the available version and downloads within the settings page', async () => {
    vi.mocked(api.getState).mockResolvedValue({ ...initial, status: 'available', version: '1.2.2' })
    render(<SoftwareUpdateSettings />)
    await screen.findByText('下载更新')
    fireEvent.click(screen.getByText('下载更新'))
    await waitFor(() => expect(api.download).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '12')
    expect(api.install).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument()
  })
  it('saves the automatic-check preference and retains manual checking', async () => {
    render(<SoftwareUpdateSettings />)
    await screen.findByRole('checkbox')
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled())
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(false))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.queryByText(/启动后及每/)).not.toBeInTheDocument()
    expect(screen.queryByText(/上次成功检查/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    await waitFor(() => expect(api.check).toHaveBeenCalledTimes(1))
  })
  it('requires an explicit restart-install action after download verification', async () => {
    vi.mocked(api.getState).mockResolvedValue({ ...initial, status: 'downloaded', progress: 100, message: '' })
    render(<SoftwareUpdateSettings />)
    await screen.findByText('重启并安装')
    await waitFor(() => expect(screen.getByText('重启并安装')).toBeEnabled())
    expect(api.install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('重启并安装'))
    await waitFor(() => expect(api.install).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status')).toHaveTextContent('正在准备重启安装')
    expect(screen.queryByRole('button', { name: '重启并安装' })).not.toBeInTheDocument()
  })
  it('shows a failed manual operation and keeps the settings usable', async () => {
    vi.mocked(api.check).mockRejectedValue(new Error('无法连接更新服务器'))
    render(<SoftwareUpdateSettings />)
    await screen.findByText('检查更新')
    await waitFor(() => expect(screen.getByText('检查更新')).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByText('检查更新')) })
    expect(screen.getByRole('alert')).toHaveTextContent('无法连接更新服务器')
    expect(screen.getByText('检查更新')).toBeEnabled()
  })
})
