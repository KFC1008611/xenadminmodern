import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar'
import { ResourceReadBanner } from '../../src/renderer/src/components/layout/ResourceReadBanner'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

const connection = { id: 'pool', host: '192.0.2.1', name: 'Pool', poolName: 'Pool', poolRef: 'pool', state: 'disconnected' as const, connectedAt: 1, errorMessage: null }
const reconnect = vi.fn(), list = vi.fn()
beforeEach(() => {
  reconnect.mockReset().mockResolvedValue(undefined)
  list.mockReset().mockResolvedValue([{ ...connection, state: 'connected', epoch: 2 }])
  Object.assign(window.xapi, { connection: { reconnect, list } })
  useConnectionManagerStore.setState({ connections: [connection], reconnectingIds: [], error: null })
  useMultiDataStore.setState({ hosts: [], vms: [], tasks: [], domainStates: {} })
})

it.each([
  { state: 'disconnected', collapsed: false }, { state: 'error', collapsed: false },
  { state: 'disconnected', collapsed: true }, { state: 'error', collapsed: true },
] as const)('reconnects a $state server from the sidebar with collapsed=$collapsed', async ({ state, collapsed }) => {
  useConnectionManagerStore.setState({ connections: [{ ...connection, state }] })
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Sidebar collapsed={collapsed} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '重新连接 Pool' }))
  await waitFor(() => expect(useConnectionManagerStore.getState().connections[0].state).toBe('connected'))
  expect(reconnect).toHaveBeenCalledOnce()
  expect(reconnect).toHaveBeenCalledWith('pool')
  expect(useConnectionManagerStore.getState().activeConnectionId).toBe('pool')
})

it('shares pending state across reconnect entries and sends one request for rapid clicks', async () => {
  let done!: () => void
  reconnect.mockReturnValue(new Promise<void>((resolve) => { done = resolve }))
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/pool/pool/hosts']}><Sidebar /><ResourceReadBanner /></MemoryRouter>)
  const buttons = screen.getAllByRole('button', { name: '重新连接 Pool' })
  fireEvent.click(buttons[0]); fireEvent.click(buttons[1])
  expect(reconnect).toHaveBeenCalledOnce()
  for (const button of buttons) expect(button).toBeDisabled()
  await act(async () => { done() })
  expect(useConnectionManagerStore.getState().reconnectingIds).toEqual([])
})

it('keeps the failure reason and retries the original server with a replacement password', async () => {
  reconnect.mockRejectedValueOnce(Object.assign(new Error('SESSION_AUTHENTICATION_FAILED'), { code: 'SESSION_AUTHENTICATION_FAILED' }))
  list.mockResolvedValueOnce([{ ...connection, state: 'error' }])
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Sidebar /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '重新连接 Pool' }))
  const dialog = await screen.findByRole('dialog', { name: '重新连接 Pool' })
  expect(within(dialog).getByRole('alert')).toHaveTextContent('SESSION_AUTHENTICATION_FAILED')
  const password = within(dialog).getByLabelText('密码（需要更换时填写）')
  expect(password).toHaveValue('')
  fireEvent.change(password, { target: { value: 'replacement' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '重新连接', exact: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(reconnect).toHaveBeenLastCalledWith('pool', 'replacement')
  expect(password).not.toBeInTheDocument()
  expect(useConnectionManagerStore.getState().connections[0].id).toBe('pool')
})
