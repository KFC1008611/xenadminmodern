import { vifPolicyLabel } from '../../../../../shared/vm-creation'
import { useEffect } from 'react'
import type { VmCreationNetworkOption, VmRecord, WizardVif } from '../../../types/xapi'
import { formatRawNetworkName } from '../../../lib/networkDisplay'
import { formatVifLabel } from '../../../lib/networkTerminology'

interface Step5NetworkProps {
  options: VmCreationNetworkOption[]
  targetHostRef: string
  template: VmRecord | null
  vifs: WizardVif[]
  networkEdited?: boolean
  networkRequired?: boolean
  onChangeVifs: (vifs: WizardVif[]) => void
}

export default function Step5Network({
  options,
  targetHostRef,
  template,
  vifs,
  networkEdited = false,
  networkRequired = false,
  onChangeVifs,
}: Step5NetworkProps) {
  const compatible = options.filter((network) =>
    !targetHostRef || network.hostRefs.includes(targetHostRef),
  )

  useEffect(() => {
    if (networkEdited || vifs.length > 0) return
    const defaultNetwork = compatible.find((network) => network.autoPlug)
    if (!defaultNetwork) return
    const vifCount = template?.VIFs?.length
      || (template?.is_default_template || template?.other_config?.default_template === 'true' ? 1 : 0)
    if (vifCount === 0) return
    onChangeVifs(Array.from({ length: vifCount }, (_, index) => ({
      device: String(index), networkRef: defaultNetwork.ref, networkName: defaultNetwork.name,
    })))
  }, [template?.ref, targetHostRef, options, vifs.length, networkEdited])

  const updateVif = (index: number, networkRef: string) => {
    const network = compatible.find((option) => option.ref === networkRef)
    const updated = [...vifs]
    updated[index] = { ...updated[index], networkRef, networkName: network?.name }
    onChangeVifs(updated)
  }

  const nextDevice = () => {
    const used = new Set(vifs.map((vif) => vif.device))
    let device = 0
    while (used.has(String(device))) device++
    return String(device)
  }

  return (
    <div className="space-y-4">
      {compatible.length === 0 && (
        <div className="text-muted-foreground text-sm p-4 bg-muted rounded-lg">
          {networkRequired ? '没有可用网络，网络安装至少需要一张虚拟网卡。' : '没有可用网络。您可以不配置虚拟网卡并继续下一步。'}
        </div>
      )}
      {vifs.map((vif, index) => (
        <div key={vif.device ?? index} className="p-4 bg-muted rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-foreground">{formatVifLabel(vif.device ?? String(index))}</h4>
            <button type="button" onClick={() => onChangeVifs(vifs.filter((_, item) => item !== index))} className="text-xs text-danger">删除</button>
          </div>
          <label htmlFor={`wizard-network-${index}`} className="block text-xs text-muted-foreground mb-1">网络</label>
          <select
            id={`wizard-network-${index}`}
            aria-label={`${formatVifLabel(vif.device ?? String(index))} 网络`}
            value={vif.networkRef}
            title={compatible.find((network) => network.ref === vif.networkRef)?.name}
            onChange={(event) => updateVif(index, event.target.value)}
            className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm"
          >
            <option value="">请选择网络</option>
            {compatible.map((network) => <option key={network.ref} value={network.ref} title={network.name}>{formatRawNetworkName(network.name)}</option>)}
          </select>
          {vif.policy && <p className="mt-2 text-xs text-muted-foreground break-words">保留模板策略：{vifPolicyLabel(vif.policy)} · 自动生成 MAC</p>}
        </div>
      ))}
      {compatible.length > 0 && (
        <button
          type="button"
          onClick={() => onChangeVifs([...vifs, { device: nextDevice(), networkRef: '', networkName: '' }])}
          className="px-3 py-2 text-sm bg-secondary hover:bg-secondary text-foreground rounded-lg"
        >
          新增虚拟网卡
        </button>
      )}
    </div>
  )
}
