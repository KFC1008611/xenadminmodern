import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateNetworkDialog } from '../../src/renderer/src/components/network/CreateNetworkDialog'
import { BondCreateDialog } from '../../src/renderer/src/components/network/BondCreateDialog'
import { VlanCreateDialog } from '../../src/renderer/src/components/network/VlanCreateDialog'
import { AddVifDialog } from '../../src/renderer/src/components/vm/AddVifDialog'
import { VifManager } from '../../src/renderer/src/components/vm/VifManager'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const network = {
  ref: 'OpaqueRef:network',
  uuid: 'network',
  name_label: 'Guest',
  name_description: '',
  bridge: 'xenbr0',
  PIFs: [],
  VIFs: [],
  MTU: 1500,
  connectionId: 'conn-1',
  poolName: 'Pool',
}

const pif = {
  ref: 'OpaqueRef:pif',
  uuid: 'pif',
  device: 'eth0',
  host: 'OpaqueRef:host',
  network: 'OpaqueRef:network',
  IP: '',
  MAC: '00:11:22:33:44:55',
  MTU: 1500,
  vlan: -1,
  physical: true,
  currently_attached: true,
  ip_configuration_mode: 'None',
  management: false,
  isBondCandidate: true,
  isVlanCandidate: true,
}

describe('network topology safety gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows an unconfirmed network creation and blocks duplicate submissions until the dialog closes', async () => {
    window.xapi.network = { ...window.xapi.network, create: vi.fn().mockRejectedValue(Object.assign(
      new Error('创建结果未确认，请刷新清单核对，勿重复创建。'), { code: 'NETWORK_CREATE_OUTCOME_UNKNOWN' },
    )) } as any
    const onCreated = vi.fn()
    render(<CreateNetworkDialog open onClose={vi.fn()} connectionId="conn-1" onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'Unknown network' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByRole('alert')
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    expect(window.xapi.network.create).toHaveBeenCalledTimes(1)
    expect(screen.getByText('内部网络；物理出口和 VLAN 需单独配置。')).toBeInTheDocument()
  })

  it('creates a basic Network and VIF from their dialogs', async () => {
    window.xapi.network = { ...window.xapi.network, create: vi.fn().mockResolvedValue('OpaqueRef:new-network') } as any
    window.xapi.vif = { ...window.xapi.vif, create: vi.fn().mockResolvedValue({ vifRef: 'OpaqueRef:vif', plugged: false }) } as any
    const onCreated = vi.fn()
    const { unmount } = render(
      <CreateNetworkDialog open onClose={vi.fn()} connectionId="conn-1" onCreated={onCreated} />,
    )
    fireEvent.change(screen.getByPlaceholderText('网络名称'), { target: { value: 'New network' } })
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(window.xapi.network.create).toHaveBeenCalled())
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    unmount()

    const onVifCreated = vi.fn()
    render(
      <AddVifDialog
        open
        onClose={vi.fn()}
        connectionId="conn-1"
        vmRef="OpaqueRef:vm"
        networks={[network]}
        onCreated={onVifCreated}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: network.ref } })
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(window.xapi.vif.create).toHaveBeenCalled())
    await waitFor(() => expect(onVifCreated).toHaveBeenCalled())
  })

  it('offers VIF actions according to actual attachment state', () => {
    render(
      <VifManager
        connectionId="conn-1"
        vmRef="OpaqueRef:vm"
        vifs={[{ ref: 'OpaqueRef:vif', device: '0', MAC: 'AA:BB:CC:DD:EE:FF', network: network.ref, MTU: 1500, currently_attached: false } as any]}
        networks={[network]}
        guestNetworks={{}}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Guest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加虚拟网卡' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '连接虚拟网卡' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '断开虚拟网卡' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除虚拟网卡' })).toBeEnabled()
  })

  it('shows each VIF only its guest reported addresses and a clear empty state', () => {
    render(
      <VifManager
        connectionId="conn-1"
        vmRef="OpaqueRef:vm"
        vifs={[
          { ref: 'OpaqueRef:vif0', device: '0', MAC: 'AA:BB:CC:DD:EE:00', network: network.ref, MTU: 1500 },
          { ref: 'OpaqueRef:vif1', device: '1', MAC: 'AA:BB:CC:DD:EE:01', network: network.ref, MTU: 1500 },
          { ref: 'OpaqueRef:vif2', device: '2', MAC: 'AA:BB:CC:DD:EE:02', network: network.ref, MTU: 1500 },
        ] as any}
        networks={[network]}
        guestNetworks={{
          '0/ip': '10.0.0.2',
          '0/ipv4/0': '10.0.0.2',
          '0/ipv6/0': '2001:db8::2',
          '1/ipv4/0': '172.16.0.4',
        }}
        onChanged={vi.fn()}
      />,
    )

    const row0 = within(screen.getByText('Virtual Interface 0').closest('tr')!)
    const row1 = within(screen.getByText('Virtual Interface 1').closest('tr')!)
    const row2 = within(screen.getByText('Virtual Interface 2').closest('tr')!)
    expect(row0.getByText('10.0.0.2')).toBeInTheDocument()
    expect(row0.getByText('2001:db8::2')).toBeInTheDocument()
    expect(row0.queryAllByText('10.0.0.2')).toHaveLength(1)
    expect(row0.queryByText('172.16.0.4')).not.toBeInTheDocument()
    expect(row1.getByText('172.16.0.4')).toBeInTheDocument()
    expect(row2.getByText('未上报')).toBeInTheDocument()
  })

  it('blocks stale Bond and VLAN submissions with the operation restriction', () => {
    const { unmount } = render(
      <BondCreateDialog open onOpenChange={vi.fn()} connectionId="conn-1" pifs={[pif as any]} />,
    )
    expect(screen.getByText(/暂不可用/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建绑定' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '创建绑定' })).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    unmount()

    render(
      <VlanCreateDialog
        open
        onOpenChange={vi.fn()}
        connectionId="conn-1"
        pifs={[pif as any]}
        networks={[network]}
      />,
    )
    expect(screen.getByText(/暂不可用/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 VLAN' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '创建 VLAN' })).toHaveAttribute('title', expect.stringContaining('暂不可用'))
  })
})

describe('VIF desktop changes', () => {
  it('confirms the target network before moving the existing interface', async () => {
    const move = vi.fn().mockResolvedValue(undefined)
    window.xapi.vif = { ...window.xapi.vif, move } as any
    const changed = vi.fn()
    render(<VifManager connectionId="conn-1" vmRef="OpaqueRef:vm" vifs={[{ ref: 'OpaqueRef:vif', network: network.ref, device: '0', MAC: '02:00:00:00:00:01', currently_attached: true } as any]}
      networks={[network, { ...network, ref: 'OpaqueRef:new-network', name_label: 'New network' }]} guestNetworks={{}} onChanged={changed} />)
    fireEvent.click(screen.getByRole('button', { name: '更换网卡网络' }))
    expect(screen.getByRole('button', { name: '确认更换' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: '目标网络' }), { target: { value: 'OpaqueRef:new-network' } })
    expect(move).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认更换' }))
    await waitFor(() => expect(move).toHaveBeenCalledWith('conn-1', 'OpaqueRef:vif', 'OpaqueRef:new-network'))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  })

  it('freezes a VIF request after a read error and reuses its identity for reconciliation', async () => {
    const create = vi.fn().mockRejectedValueOnce(Object.assign(new Error('连接状态读取失败'), { code: 'RESOURCE_RESULT_READ_FAILED' }))
      .mockResolvedValueOnce({ vifRef: 'OpaqueRef:created', plugged: false })
    window.xapi.vif = { ...window.xapi.vif, create } as any
    render(<AddVifDialog open onClose={vi.fn()} connectionId="conn-1" vmRef="OpaqueRef:vm" networks={[network]} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: network.ref } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败')
    expect(screen.getByRole('combobox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取创建结果' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1])
    expect(create.mock.calls[0][1].requestId).toBeTruthy()
  })
})
