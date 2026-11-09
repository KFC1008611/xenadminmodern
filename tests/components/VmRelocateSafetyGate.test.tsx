import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VmRelocateDialog } from '../../src/renderer/src/components/vm/VmRelocateDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

describe('VM relocation safety gate', () => {
  beforeEach(() => {
    useConnectionManagerStore.setState({
      connections: [
        {
          id: 'conn-1',
          name: 'Pool 1',
          host: 'pool.example',
          port: 443,
          username: 'root',
          state: 'connected',
          poolName: 'Pool 1',
        },
      ] as any,
      activeConnectionId: 'conn-1',
    })
    Object.assign(window.xapi, {
      vm: {
        getRelocationPlan: vi.fn().mockResolvedValue({
          sourceConnectionId: 'conn-1',
          targetConnectionId: 'conn-1',
          vmRef: 'OpaqueRef:vm',
          vmName: 'vm-1',
          powerState: 'Halted',
          allowedModes: ['pool-migrate', 'storage-move'],
          blockers: [],
          warnings: [],
          disks: [],
          vifs: [],
          sourceHosts: [],
          targetHosts: [{ ref: 'OpaqueRef:host', name_label: 'host-1' }],
          sourceSrs: [],
          targetSrs: [],
          sourceNetworks: [],
          targetNetworks: [],
        }),
        relocate: vi.fn(),
      },
    })
  })

  it('offers same-pool host migration while keeping storage relocation gated', async () => {
    render(
      <VmRelocateDialog
        open
        vm={{
          ref: 'OpaqueRef:vm',
          name_label: 'vm-1',
          power_state: 'Halted',
          connectionId: 'conn-1',
        }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: '停机存储移动' })).toBeDisabled()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/迁移方式/)
    expect(screen.getByRole('button', { name: '同池主机迁移' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '停机存储移动' })).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    expect(screen.getByText(/暂不可用/)).toBeInTheDocument()
  })

  it('retains migration protection and opens the durable workflow for cross-pool copy', async () => {
    useConnectionManagerStore.setState({
      connections: [
        ...useConnectionManagerStore.getState().connections,
        { id: 'conn-2', name: 'Pool 2', state: 'connected', poolName: 'Pool 2' } as any,
      ],
    })
    ;(window.xapi.vm.getRelocationPlan as any).mockImplementation((_source: string, _vm: string, target: string) => Promise.resolve({
      sourceConnectionId: 'conn-1', targetConnectionId: target, vmRef: 'OpaqueRef:vm', vmName: 'vm-1', powerState: 'Halted',
      allowedModes: target === 'conn-1' ? ['pool-migrate', 'storage-move'] : ['cross-pool-migrate', 'cross-pool-copy'],
      blockers: [], warnings: [], disks: [], vifs: [], sourceHosts: [],
      targetHosts: [{ ref: 'OpaqueRef:host', name_label: 'host-2' }], sourceSrs: [], targetSrs: [],
      sourceNetworks: [], targetNetworks: [],
    }))

    render(<VmRelocateDialog open vm={{ ref: 'OpaqueRef:vm', name_label: 'vm-1', connectionId: 'conn-1' }} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await screen.findByRole('button', { name: '同池主机迁移' })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'conn-2' } })

    const migrate = await screen.findByRole('button', { name: '跨池迁移' })
    const copy = screen.getByRole('button', { name: '跨池复制' })
    expect(migrate).toBeDisabled()
    expect(copy).toBeEnabled()
    expect(migrate).toHaveAttribute('title', expect.stringMatching(/跨池迁移暂不可用/))
    Object.assign(window.xapi.vm, { copyPlan: vi.fn().mockResolvedValue({ sourceConnectionId: 'conn-1', targetConnectionId: 'conn-2', vmRef: 'OpaqueRef:vm', sourceUuid: 'uuid', powerState: 'Halted', allowedModes: ['cross-pool-copy'], blockers: [], warnings: [], hosts: [], srs: [], networks: [], disks: [], vifs: [] }) })
    fireEvent.click(copy)
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('复制 VM')
  })
})
