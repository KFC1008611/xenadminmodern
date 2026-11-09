import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BondList } from '../../src/renderer/src/components/network/BondList'
import { VlanList } from '../../src/renderer/src/components/network/VlanList'
import { BondCreateDialog } from '../../src/renderer/src/components/network/BondCreateDialog'
import { PifList } from '../../src/renderer/src/components/network/PifList'
import { VlanCreateDialog } from '../../src/renderer/src/components/network/VlanCreateDialog'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'
import { VifManager } from '../../src/renderer/src/components/vm/VifManager'
import { useNetworkAdvancedStore } from '../../src/renderer/src/store/network-advanced.store'
import type { PifRecord } from '../../src/renderer/src/types/xapi'

const basePif: PifRecord = {
  ref: 'OpaqueRef:pif',
  uuid: 'pif',
  device: 'eth0',
  host: 'OpaqueRef:host',
  network: 'OpaqueRef:network',
  IP: '',
  MAC: '00:11:22:33:44:55',
  MTU: 1500,
  speed: 1000,
  vlan: -1,
  physical: true,
  currently_attached: true,
  ip_configuration_mode: 'None',
  management: false,
}

beforeEach(() => {
  useNetworkAdvancedStore.setState({
    bonds: [],
    bondsConnectionId: 'conn-1',
    bondsLoading: false,
    bondsError: null,
    vlans: [],
    vlansConnectionId: 'conn-1',
    vlansLoading: false,
    vlansError: null,
  })
})

describe('network interface terminology', () => {
  it('shows scoped topology failures with retained records and a retry action', () => {
    useNetworkAdvancedStore.setState({
      bonds: [{ ref: 'bond', uuid: 'bond', master: 'master', slaves: ['pif0', 'pif1'], mode: 'lacp', properties: {}, links_up: 2 }],
      bondsError: 'BOND_PERMISSION_DENIED', vlansError: 'VLAN_PERMISSION_DENIED',
      loadBonds: vi.fn(), loadVlans: vi.fn(),
    })
    render(<><BondList connectionId="conn-1" pifs={[
      { ...basePif, ref: 'pif0', device: 'eth0' }, { ...basePif, ref: 'pif1', device: 'eth1' },
    ]} networks={[]} /><VlanList connectionId="conn-1" pifs={[]} networks={[]} /></>)
    expect(screen.getByText('网卡绑定读取失败：BOND_PERMISSION_DENIED')).toBeInTheDocument()
    expect(screen.getByText('VLAN读取失败：VLAN_PERMISSION_DENIED')).toBeInTheDocument()
    expect(screen.getByText('当前显示上次成功读取的数据。')).toBeInTheDocument()
    expect(screen.getByText('Bond (eth0 + eth1)')).toBeInTheDocument()
    expect(screen.getByText('无法确认 VLAN 清单')).toBeInTheDocument()
    expect(screen.queryByText('没有 VLAN')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '重新读取' })).toHaveLength(2)
  })

  it('does not render another resource pool topology while the new pool is loading', () => {
    useNetworkAdvancedStore.setState({
      bondsConnectionId: 'conn-old', vlansConnectionId: 'conn-old',
      bonds: [{ ref: 'same-ref', uuid: 'bond', master: 'master', slaves: [], mode: 'lacp', properties: {}, links_up: 2, devices: ['old-eth0', 'old-eth1'] }],
      vlans: [{ ref: 'same-ref', uuid: 'vlan', tag: 233, tagged_PIF: 'tagged', untagged_PIF: 'untagged', network: 'network' }],
      loadBonds: vi.fn(), loadVlans: vi.fn(),
    })
    render(<><BondList connectionId="conn-new" pifs={[]} networks={[]} /><VlanList connectionId="conn-new" pifs={[]} networks={[]} /></>)
    expect(screen.queryByText('Bond (old-eth0 + old-eth1)')).not.toBeInTheDocument()
    expect(screen.queryByText('VLAN 233')).not.toBeInTheDocument()
  })
  it('distinguishes physical and logical host interfaces with normalized bond flags', () => {
    render(<PifList pifs={[
      { ...basePif, ref: 'physical', isPhysicalNic: true },
      { ...basePif, ref: 'vlan', isPhysicalNic: false, isVlan: true },
      { ...basePif, ref: 'bond', isPhysicalNic: true, isBondMaster: true },
      { ...basePif, ref: 'bond-member', isPhysicalNic: true, isBondMember: true },
      { ...basePif, ref: 'tunnel', isPhysicalNic: false, isTunnelAccess: true },
    ]} />)

    expect(screen.getAllByText('NIC 0 (eth0)')).toHaveLength(2)
    expect(screen.getByText('VLAN Interface eth0')).toBeInTheDocument()
    expect(screen.getByText('Bond Interface eth0')).toBeInTheDocument()
    expect(screen.getByText('绑定成员')).toBeInTheDocument()
    expect(screen.getByText('Tunnel Interface eth0')).toBeInTheDocument()
    expect(screen.queryByText('物理 NIC')).not.toBeInTheDocument()
  })

  it('uses the generic host-interface term for an empty list', () => {
    render(<PifList pifs={[]} />)
    expect(screen.getByText('没有找到主机网络接口')).toBeInTheDocument()
  })

  it('shows a host interface and its network as separate objects', () => {
    render(<PifList pifs={[{ ...basePif, isPhysicalNic: true, isPrimaryManagement: true }]} networks={[{
      ref: basePif.network, uuid: 'network', name_label: 'Pool-wide network associated with eth0',
      name_description: '', bridge: 'xenbr0', PIFs: [basePif.ref], VIFs: [], MTU: 1500, kind: 'external', device: 'eth0',
    }]} />)
    expect(screen.getByText('NIC 0 (eth0)')).toBeInTheDocument()
    expect(screen.getByText('Network 0')).toBeInTheDocument()
    expect(screen.getByText('主管理')).toBeInTheDocument()
  })

  it('shows actual bond and VLAN relationships while warning on a name-only VLAN', () => {
    const external = {
      ref: 'OpaqueRef:bond-network', uuid: 'bond-network', name_label: 'Production', name_description: '',
      bridge: 'xenbr1', PIFs: [], VIFs: [], MTU: 1500, kind: 'bond' as const,
    }
    const vlanNetwork = { ...external, ref: 'OpaqueRef:vlan-network', name_label: 'Guest VLAN', kind: 'vlan' as const, vlan: 100, isVlan: true }
    const nameOnly = { ...external, ref: 'OpaqueRef:name-only', name_label: 'vlan201', kind: 'internal' as const, pifRefs: [] }
    useNetworkAdvancedStore.setState({
      bonds: [{ ref: 'OpaqueRef:bond', uuid: 'bond', master: 'OpaqueRef:master', slaves: ['OpaqueRef:eth0', 'OpaqueRef:eth1'], mode: 'lacp', properties: {}, links_up: 2, network: external.ref, devices: ['eth0', 'eth1'] }],
      vlans: [{ ref: 'OpaqueRef:vlan', uuid: 'vlan', tag: 100, tagged_PIF: 'OpaqueRef:eth0', untagged_PIF: 'OpaqueRef:untagged', network: vlanNetwork.ref, taggedDevice: 'eth0' }],
      loadBonds: vi.fn(), loadVlans: vi.fn(),
    })
    render(<><BondList connectionId="conn-1" pifs={[]} networks={[external]} /><VlanList connectionId="conn-1" pifs={[]} networks={[vlanNetwork, nameOnly]} /></>)
    expect(screen.getByText('Bond (eth0 + eth1)')).toBeInTheDocument()
    expect(screen.getByText('成员：NIC 0 (eth0)、NIC 1 (eth1)')).toBeInTheDocument()
    expect(screen.getByText('关联网络：Production')).toBeInTheDocument()
    expect(screen.getByText('VLAN 100')).toBeInTheDocument()
    expect(screen.getByText('承载接口 eth0')).toBeInTheDocument()
    expect(screen.getByText('关联网络：Guest VLAN')).toBeInTheDocument()
    expect(screen.getByText('名称像 VLAN，未配置 VLAN 接口')).toBeInTheDocument()
  })

  it('uses virtual-NIC terminology for VM devices and actions', () => {
    render(
      <ToastProvider>
        <VifManager
          connectionId="conn-1"
          vmRef="OpaqueRef:vm"
          vifs={[]}
          networks={[]}
          guestNetworks={{}}
          onChanged={() => {}}
        />
      </ToastProvider>,
    )

    expect(screen.getByText('虚拟网卡 (0)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加虚拟网卡' })).toBeInTheDocument()
    expect(screen.getByText('此虚拟机没有配置虚拟网卡')).toBeInTheDocument()
    expect(screen.queryByText('添加 VIF')).not.toBeInTheDocument()
  })

  it('calls bond candidates physical NICs', () => {
    render(<BondCreateDialog
      open
      onOpenChange={() => {}}
      connectionId="conn-1"
      pifs={[{ ...basePif, isBondCandidate: true, isPhysicalNic: true }]}
    />)

    expect(screen.getByText('创建网卡绑定（Bond）')).toBeInTheDocument()
    expect(screen.getByText('可用物理网卡')).toBeInTheDocument()
    expect(screen.getByText('选择物理网卡...')).toBeInTheDocument()
    expect(screen.queryByText(/PIF/)).not.toBeInTheDocument()
  })

  it('calls VLAN sources carrier interfaces', () => {
    render(<VlanCreateDialog
      open
      onOpenChange={() => {}}
      connectionId="conn-1"
      pifs={[{ ...basePif, isVlanCandidate: true }]}
      networks={[]}
    />)

    expect(screen.getByText('Carrier Interface')).toBeInTheDocument()
    expect(screen.getByText('选择Carrier Interface...')).toBeInTheDocument()
    expect(screen.queryByText(/PIF/)).not.toBeInTheDocument()
  })
})
