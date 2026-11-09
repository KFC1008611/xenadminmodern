import type {
  VmInstallMode,
  VmRecord,
  VmTemplateKind,
  VmWizardStepId,
  WizardDisk,
  WizardResourceStatus,
  WizardVif,
  VmCreationResourceOptions,
} from '../../../../shared/types/xapi'
import { templateInstallModes, validInstallUrl } from '../../../../shared/vm-creation'

export interface WizardState {
  templateRef?: string
  templateKind?: VmTemplateKind
  installMode?: VmInstallMode
  installUrl?: string
  installMethods?: string
  isoRef?: string
  targetHostRef?: string
  targetSrRef?: string
  vmName?: string
  nameEdited?: boolean
  vcpus?: number
  memoryBytes?: number
  disks?: WizardDisk[]
  vifs?: WizardVif[]
  startAfter?: boolean
  resourceStatus?: Partial<Record<'hosts' | 'storage' | 'network' | 'isos', WizardResourceStatus>>
}

export interface WizardStepValidation {
  valid: boolean
  reason?: string
}

const SYSTEM_STEPS: VmWizardStepId[] = [
  'template',
  'name',
  'install',
  'placement',
  'compute',
  'storage',
  'network',
  'review',
]

const CUSTOM_STEPS: VmWizardStepId[] = [
  'template',
  'name',
  'placement',
  'compute',
  'storage',
  'network',
  'review',
]

export function classifyTemplate(template: Pick<VmRecord, 'is_default_template' | 'other_config'>): VmTemplateKind {
  return template.is_default_template || template.other_config?.default_template === 'true'
    ? 'system'
    : 'custom'
}

export function getSupportedInstallModes(
  template: Pick<VmRecord, 'other_config' | 'HVM_boot_policy' | 'PV_bootloader'>,
): VmInstallMode[] {
  return templateInstallModes(template)
}

export function deriveWizardSteps(state: Pick<WizardState, 'templateKind'>): VmWizardStepId[] {
  return state.templateKind === 'custom' ? [...CUSTOM_STEPS] : [...SYSTEM_STEPS]
}

export function resetForTemplate(state: WizardState, template: VmRecord): WizardState {
  const templateKind = classifyTemplate(template)
  const installModes = templateKind === 'system' ? getSupportedInstallModes(template) : []
  return {
    ...state,
    templateRef: template.ref,
    templateKind,
    installMode: templateKind === 'custom' ? 'none' : installModes[0],
    installUrl: '',
    installMethods: template.other_config?.['install-methods'],
    vmName: state.nameEdited ? state.vmName : template.name_label,
    isoRef: '',
    targetHostRef: '',
    targetSrRef: '',
    disks: [],
    vifs: [],
    startAfter: false,
  }
}

function invalid(reason: string): WizardStepValidation {
  return { valid: false, reason }
}

function resourceUnavailable(
  status: WizardResourceStatus | undefined,
  label: string,
): WizardStepValidation | null {
  if (status === 'loading' || status === 'idle') return invalid(`${label}正在加载`)
  if (status === 'error') return invalid(`${label}加载失败`)
  return null
}

export function validateWizardStep(step: VmWizardStepId, state: WizardState, resources?: VmCreationResourceOptions, minMemoryBytes = 1): WizardStepValidation {
  const compatible = (resource: { hostRefs: string[] } | undefined) => !!resource && (!state.targetHostRef || resource.hostRefs.includes(state.targetHostRef))
  if (step === 'template' && !state.templateRef) return invalid('请选择模板')
  if (step === 'name' && !state.vmName?.trim()) return invalid('请输入虚拟机名称')
  if (step === 'install') {
    if (!state.installMode) return invalid('请选择安装方式')
    if (state.installMode === 'url' && !validInstallUrl(state.installUrl ?? '', state.installMethods)) return invalid('请输入模板支持的安装源 URL')
    if (state.installMode === 'iso') {
      const unavailable = resourceUnavailable(state.resourceStatus?.isos, 'ISO 列表')
      if (unavailable) return unavailable
      if (!state.isoRef) return invalid('请选择 ISO 镜像')
      if (resources && !compatible(resources.isos.find((iso) => iso.ref === state.isoRef))) return invalid('请选择目标主机可访问的 ISO 镜像')
    }
  }
  if (step === 'placement') {
    const unavailable = resourceUnavailable(state.resourceStatus?.hosts, '主机列表')
    if (unavailable) return unavailable
    if (resources && !resources.hosts.some((host) => host.enabled && (!state.targetHostRef || host.ref === state.targetHostRef))) return invalid('没有可用目标主机，请重新选择或刷新创建资源')
  }
  if (step === 'compute') {
    if (!Number.isInteger(state.vcpus) || !state.vcpus || state.vcpus < 1) return invalid('vCPU 数量必须是大于零的整数')
    if (!Number.isSafeInteger(state.memoryBytes) || !state.memoryBytes || state.memoryBytes < minMemoryBytes) return invalid(`内存必须为整数字节且不能低于 ${minMemoryBytes / 1073741824} GiB`)
    if (resources) {
      const hosts = resources.hosts.filter((host) => host.enabled && (!state.targetHostRef || host.ref === state.targetHostRef))
      if (!hosts.some((host) => host.cpuCount >= state.vcpus! && host.memoryFree >= state.memoryBytes!)) return invalid('没有目标主机能同时满足当前 vCPU 和可用内存，请调整配置或目标主机')
    }
  }
  if (step === 'storage') {
    const unavailable = resourceUnavailable(state.resourceStatus?.storage, '存储列表')
    if (unavailable) return unavailable
    if (state.templateKind === 'custom' && !state.targetSrRef) return invalid('请选择目标存储')
    if (resources && state.templateKind === 'custom' && !compatible(resources.srs.find((sr) => sr.ref === state.targetSrRef))) return invalid('请选择目标主机可访问的存储仓库')
    if (state.templateKind === 'system' && state.installMode === 'iso' && !state.disks?.length) {
      return invalid('请至少配置一块磁盘')
    }
    if (state.disks?.some((disk) => !Number.isSafeInteger(disk.sizeBytes) || disk.sizeBytes < 1 || (state.templateKind !== 'custom' && !disk.srRef))) return invalid('请为每块磁盘填写有效大小并选择存储仓库')
    const devices = state.disks?.map((disk, index) => disk.device ?? String(index)) ?? []
    if (new Set(devices).size !== devices.length) return invalid('磁盘设备号重复')
    if (state.installMode === 'iso' && ['0', '1', '2', '3'].every((device) => devices.includes(device))) return invalid('设备 0–3 已全部用于磁盘，请为安装光驱保留一个设备号')
    if (resources) {
      const required = new Map<string, number>()
      for (const disk of state.disks ?? []) {
        const srRef = state.templateKind === 'custom' ? state.targetSrRef ?? '' : disk.srRef
        const sr = resources.srs.find((sr) => sr.ref === srRef)
        if (!compatible(sr)) return invalid('请为每块磁盘选择目标主机可访问的存储仓库')
        required.set(srRef, (required.get(srRef) ?? 0) + disk.sizeBytes)
      }
      for (const [ref, bytes] of required) {
        const free = resources.srs.find((sr) => sr.ref === ref)!.freeBytes
        if (free < 0) return invalid('无法确认目标存储的可用空间，请重新读取')
        if (!Number.isSafeInteger(bytes) || bytes > free) return invalid('目标存储空间不足')
      }
    }
  }
  if (step === 'network') {
    const unavailable = resourceUnavailable(state.resourceStatus?.network, '网络列表')
    if (unavailable) return unavailable
    if ((state.installMode === 'pxe' || state.installMode === 'url') && !state.vifs?.length) return invalid('网络安装至少需要一张虚拟网卡')
    if (state.vifs?.some((vif) => !vif.networkRef)) return invalid('网络配置不完整')
    if (resources && state.vifs?.some((vif) => !compatible(resources.networks.find((network) => network.ref === vif.networkRef)))) return invalid('请选择目标主机可访问的网络')
  }
  return { valid: true }
}
