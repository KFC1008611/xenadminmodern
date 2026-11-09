import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { PbdManagementPanel } from '../../src/renderer/src/components/sr/PbdManagementPanel'
import { IsoLibraryTab } from '../../src/renderer/src/components/sr/IsoLibraryTab'
import { useStorageAdvancedStore, isoResourceKey } from '../../src/renderer/src/store/storage-advanced.store'

describe('storage device data safety gates', () => {
  beforeEach(() => {
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'connected' }] as any })
    useStorageAdvancedStore.setState({
      pbdStates: { 'conn-1': { loading: false, error: null, items: [
        {
          connectionId: 'conn-1',
          ref: 'OpaqueRef:pbd-attached',
          uuid: 'attached-pbd',
          host: 'OpaqueRef:host',
          SR: 'OpaqueRef:sr',
          currently_attached: true,
        },
        {
          connectionId: 'conn-1',
          ref: 'OpaqueRef:pbd-detached',
          uuid: 'detached-pbd',
          host: 'OpaqueRef:host',
          SR: 'OpaqueRef:sr',
          currently_attached: false,
        },
      ] } },
      pbdsLoading: false,
      loadPbds: vi.fn(),
      plugPbd: vi.fn(),
      unplugPbd: vi.fn(),
      destroyPbd: vi.fn(),
      isoStates: { [isoResourceKey('conn-1', 'OpaqueRef:sr')]: { loading: false, error: null, items: [
        {
          ref: 'OpaqueRef:iso',
          name_label: 'installer.iso',
          virtual_size: 1024,
        },
      ] } },
      isosLoading: false,
      loadIsos: vi.fn(),
      deleteIso: vi.fn(),
    } as any)
  })

  it('keeps PBD observation and plug available while blocking access interruption', () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PbdManagementPanel connectionId="conn-1" srRef="OpaqueRef:sr" /></MemoryRouter>)

    expect(screen.getByText('2 个连接')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '连接' })).toBeEnabled()

    const unplug = screen.getByRole('button', { name: '断开' })
    expect(unplug).toBeDisabled()
    expect(unplug).toHaveAttribute('title', expect.stringContaining('暂不可用'))

    for (const destroy of screen.getAllByRole('button', { name: '删除' })) {
      expect(destroy).toBeDisabled()
      expect(destroy).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    }
  })

  it('keeps ISO metadata visible while blocking deletion', () => {
    render(<IsoLibraryTab srRef="OpaqueRef:sr" connectionId="conn-1" />)

    expect(screen.getByText('installer.iso')).toBeInTheDocument()
    const remove = screen.getByRole('button', { name: '删除 installer.iso' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('title', expect.stringContaining('暂不可用'))
  })
})
