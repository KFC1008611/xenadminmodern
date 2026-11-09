import { creationCoresPerSocket, vifPolicyLabel } from '../../../../../shared/vm-creation'
import { Loader2 } from 'lucide-react'
import { formatRawNetworkName } from '../../../lib/networkDisplay'
import { formatVifLabel } from '../../../lib/networkTerminology'
import type {
  VmCreationResourceOptions,
  VmInstallMode,
  VmTemplateKind,
  WizardDisk,
  WizardVif,
  VmWizardStepId,
} from '../../../types/xapi'

const GIB = 1073741824

interface ReviewState {
  templateRef: string
  templateName: string
  templateKind: VmTemplateKind
  vmName: string
  vmDescription: string
  vcpus: number
  memoryGib: number
  installMode: VmInstallMode
  installUrl?: string
  templatePlatform?: Record<string, string>
  isoRef: string
  targetHostRef: string
  targetSrRef: string
  disks: WizardDisk[]
  vifs: WizardVif[]
  startAfter: boolean
  resources: VmCreationResourceOptions
}

interface Step6ReviewProps {
  wizardData: ReviewState
  isSubmitting: boolean
  submitError: string | null
  submitBlocked?: boolean
  poolName?: string
  invalidSteps?: { step: VmWizardStepId; reason: string }[]
  onEdit?: (step: VmWizardStepId) => void
  onChangeStartAfter: (startAfter: boolean) => void
  onConfirm: () => void
  showSubmit?: boolean
}

function ReviewRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="flex px-4 py-3"><span className="w-28 text-sm text-subtle flex-shrink-0">{label}</span><span className="min-w-0 break-words text-sm text-foreground" title={title}>{value}</span></div>
}

export default function Step6Review({
  wizardData,
  isSubmitting,
  submitError,
  submitBlocked = false,
  poolName,
  invalidSteps = [],
  onEdit,
  onChangeStartAfter,
  onConfirm,
  showSubmit = true,
}: Step6ReviewProps) {
  const hostName = wizardData.targetHostRef
    ? wizardData.resources.hosts.find((host) => host.ref === wizardData.targetHostRef)?.name ?? wizardData.targetHostRef
    : '自动选择'
  const isoName = wizardData.resources.isos.find((iso) => iso.ref === wizardData.isoRef)?.name
  const installLabel = wizardData.templateKind === 'custom'
    ? '完整复制'
    : wizardData.installMode === 'iso' ? `ISO · ${isoName ?? wizardData.isoRef}` : wizardData.installMode === 'pxe' ? 'PXE 网络启动' : wizardData.installMode === 'url' ? `安装源 · ${wizardData.installUrl ?? ''}` : '不使用安装介质'
  const diskLabel = wizardData.disks.length === 0 ? '无磁盘' : wizardData.disks.map((disk, index) => {
    const srRef = wizardData.templateKind === 'custom' ? wizardData.targetSrRef : disk.srRef
    const sr = wizardData.resources.srs.find((option) => option.ref === srRef)?.name ?? srRef
    return `磁盘 ${index + 1} (设备 ${disk.device ?? index}): ${Number((disk.sizeBytes / GIB).toFixed(6))} GiB · ${sr || '待选择存储'}${disk.mode === 'RO' ? ' · 只读' : ''}`
  }).join(', ')
  const networkLabel = wizardData.vifs.length === 0
    ? '无虚拟网卡'
    : wizardData.vifs.map((vif) => {
      const name = vif.networkName || wizardData.resources.networks.find((network) => network.ref === vif.networkRef)?.name || vif.networkRef
      return `${formatVifLabel(vif.device ?? '—')} · ${formatRawNetworkName(name || '—')}${vif.policy ? ` · ${vifPolicyLabel(vif.policy)} · 自动生成 MAC` : ''}`
    }).join(', ')

  return (
    <div className="space-y-4">
      {invalidSteps.length > 0 && <div role="alert" className="rounded-lg border border-warning/30 p-3 text-sm text-warning"><p>以下配置需要补充，点击后可直接修改：</p><ul className="mt-2 space-y-1">{invalidSteps.map(({ step, reason }) => <li key={step}><button type="button" disabled={isSubmitting} onClick={() => onEdit?.(step)} className="text-left underline">{reason}</button></li>)}</ul></div>}
      <div className="bg-muted rounded-lg divide-y divide-input">
        {poolName && <ReviewRow label="目标资源池" value={poolName} />}
        <ReviewRow label="模板" value={wizardData.templateName} />
        <ReviewRow label="虚拟机名称" value={wizardData.vmName} />
        {wizardData.vmDescription && <ReviewRow label="描述" value={wizardData.vmDescription} />}
        <ReviewRow label="安装方式" value={installLabel} />
        <ReviewRow label="目标主机" value={hostName} />
        <ReviewRow label="vCPU" value={`${wizardData.vcpus} · 每插槽 ${creationCoresPerSocket({ platform: wizardData.templatePlatform }, wizardData.vcpus)} 核`} />
        <ReviewRow label="内存" value={`${Number(wizardData.memoryGib.toFixed(6))} GiB`} />
        <ReviewRow label="磁盘" value={diskLabel} />
        <ReviewRow label="网络" value={networkLabel} title={wizardData.vifs.map((vif) => vif.networkName || wizardData.resources.networks.find((network) => network.ref === vif.networkRef)?.name || '').join(', ')} />
      </div>
      <label className="flex items-center gap-2 text-sm text-secondary-foreground">
        <input type="checkbox" disabled={isSubmitting || submitBlocked} checked={wizardData.startAfter} onChange={(event) => onChangeStartAfter(event.target.checked)} />
        创建完成后启动虚拟机
      </label>
      {submitError && <div className="p-3 bg-danger-soft border border-danger/30 rounded-lg text-danger text-sm">{submitError}</div>}
      {showSubmit && <button type="button" onClick={onConfirm} disabled={isSubmitting || submitBlocked} className="w-full py-2.5 px-4 bg-primary disabled:bg-primary-hover text-primary-foreground font-medium rounded-lg flex items-center justify-center gap-2">
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {isSubmitting ? '正在创建虚拟机...' : invalidSteps.length > 0 ? '请先补充上述配置' : submitBlocked ? '无法获取创建结果' : '创建虚拟机'}
      </button>}
    </div>
  )
}
