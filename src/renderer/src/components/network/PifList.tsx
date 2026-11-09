/**
 * PifList — table showing PIF (Physical Interface) details for a host or network.
 */
import type { NetworkRecord, PifRecord } from '../../types/xapi'
import { formatHostInterfaceLabel, formatHostInterfaceStatuses, formatVlanLabel } from '../../lib/networkTerminology'
import { formatNetworkName } from '../../lib/networkDisplay'

interface PifListProps {
  pifs: PifRecord[]
  networks?: NetworkRecord[]
}

function formatSpeed(speed: number): string {
  if (speed >= 1000) return `${speed / 1000} Gbps`
  if (speed > 0) return `${speed} Mbps`
  return '—'
}

function linkLabel(pif: PifRecord): { text: string; tone: string } {
  if (pif.linkState === 'connected') return { text: '已连接', tone: 'text-success bg-success-solid' }
  if (pif.linkState === 'disconnected') return { text: '断开', tone: 'text-danger bg-danger-solid' }
  return { text: '未知', tone: 'text-muted-foreground bg-muted' }
}

export function PifList({ pifs, networks = [] }: PifListProps) {
  if (pifs.length === 0) {
    return (
      <div className="text-center py-6 text-subtle text-sm">
        没有找到主机网络接口
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[850px] w-full text-sm">
        <thead>
          <tr className="border-b border-input">
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">主机接口</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">状态</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">关联网络</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">IP</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">MAC</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">速率</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">VLAN 标记</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">链路状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pifs.map((pif) => {
            const link = linkLabel(pif)
            const statuses = formatHostInterfaceStatuses(pif)
            const network = networks.find((item) => item.ref === pif.network)
            return (
              <tr key={pif.ref} className="hover:bg-muted transition-colors">
                <td className="px-3 py-2 text-foreground text-xs whitespace-nowrap">{formatHostInterfaceLabel(pif)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {statuses.map((status) => (
                      <span key={status} className={`text-[11px] px-1.5 py-0.5 rounded ${status === '绑定成员' ? 'bg-secondary text-secondary-foreground' : 'bg-warning-soft text-warning'}`}>
                        {status}
                      </span>
                    ))}
                    {statuses.length === 0 && <span className="text-subtle">—</span>}
                  </div>
                </td>
                <td className="max-w-44 px-3 py-2 text-xs text-secondary-foreground"><span className="block truncate" title={network?.name_label}>{network ? formatNetworkName(network) : '—'}</span></td>
                <td className="px-3 py-2 text-secondary-foreground font-mono text-xs">
                  {pif.IP || (pif.ip_configuration_mode === 'DHCP' ? 'DHCP' : '—')}
                </td>
                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{pif.MAC || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatSpeed(pif.speed || 0)}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {pif.isVlan && pif.vlan !== undefined && pif.vlan !== -1 ? formatVlanLabel(pif.vlan) : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1.5 ${link.tone.split(' ')[0]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${link.tone.split(' ')[1]}`} />
                    <span className="text-xs">{link.text}</span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
