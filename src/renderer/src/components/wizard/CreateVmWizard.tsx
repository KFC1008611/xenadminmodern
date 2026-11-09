import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { GIB, gibToBytes } from '../../../../shared/vm-creation'
import type { VmVifPolicy } from '../../../../shared/types/xapi'
import { DesktopDialog } from '../layout/DesktopDialog'
import { useToast } from '../toast/useToast'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import type {
  VmCreationResourceOptions,
  VmRecord,
  VmWizardPayload,
  VmWizardStepId,
  WizardDisk,
  WizardVif,
} from '../../types/xapi'
import {
  deriveWizardSteps,
  getSupportedInstallModes,
  resetForTemplate,
  validateWizardStep,
  type WizardState as ModelState,
} from './vmWizardModel'
import Step1Template from './steps/Step1Template'
import Step2Name from './steps/Step2Name'
import StepInstallMedia from './steps/StepInstallMedia'
import StepPlacement from './steps/StepPlacement'
import Step3Cpu from './steps/Step3Cpu'
import Step4Disk from './steps/Step4Disk'
import Step5Network from './steps/Step5Network'
import Step6Review from './steps/Step6Review'

const EMPTY_RESOURCES: VmCreationResourceOptions = { hosts: [], srs: [], networks: [], isos: [] }
const STEP_LABELS: Record<VmWizardStepId, string> = {
  template: '模板', name: '名称', install: '安装方式', placement: '目标主机',
  compute: 'CPU 与内存', storage: '存储', network: '网络', review: '确认',
}

interface WizardState extends ModelState {
  template: VmRecord | null
  templateName: string
  vmName: string
  vmDescription: string
  nameEdited: boolean
  vcpus: number
  memoryBytes: number
  disks: WizardDisk[]
  diskEdited: boolean
  vifs: WizardVif[]
  networkEdited: boolean
  isoRef: string
  targetHostRef: string
  targetSrRef: string
  startAfter: boolean
}

const INITIAL_STATE: WizardState = {
  template: null, templateRef: '', templateName: '', templateKind: 'system',
  vmName: '', vmDescription: '', nameEdited: false, vcpus: 1, memoryBytes: GIB,
  installMode: 'iso', installUrl: '', isoRef: '', targetHostRef: '', targetSrRef: '',
  disks: [], diskEdited: false, vifs: [], networkEdited: false, startAfter: false,
  resourceStatus: { hosts: 'idle', storage: 'idle', network: 'idle', isos: 'idle' },
}

interface CreateVmWizardProps {
  open: boolean
  onClose: () => void
  onCreated: (vmRef: string) => void
  connectionId: string
  initialTemplate?: VmRecord | null
}

function templateDefaults(previous: WizardState, template: VmRecord): WizardState {
  return {
    ...previous,
    ...resetForTemplate(previous, template),
    template,
    templateName: template.name_label,
    diskEdited: false,
    networkEdited: false,
    vcpus: Number(template.VCPUs_at_startup) || 1,
    memoryBytes: Number(template.memory_dynamic_max || template.memory_static_max) || GIB,
  }
}

function defaultVifs(template: VmRecord, networks: VmCreationResourceOptions['networks']): WizardVif[] {
  const network = networks.find((item) => item.autoPlug)
  if (!network) return []
  const count = template.VIFs?.length || (template.is_default_template || template.other_config?.default_template === 'true' ? 1 : 0)
  return Array.from({ length: count }, (_, index) => ({
    device: String(index), networkRef: network.ref, networkName: network.name,
  }))
}

function uniqueName(base: string, names: Set<string>): string {
  if (!names.has(base)) return base
  let suffix = 1
  while (names.has(`${base} (${suffix})`)) suffix++
  return `${base} (${suffix})`
}

export function CreateVmWizard({ open, onClose, onCreated, connectionId, initialTemplate = null }: CreateVmWizardProps) {
  const [currentStepId, setCurrentStepId] = useState<VmWizardStepId>('template')
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [resources, setResources] = useState(EMPTY_RESOURCES)
  const [resourcesConnectionId, setResourcesConnectionId] = useState('')
  const [resourcesTemplateRef, setResourcesTemplateRef] = useState('')
  const [templatePolicies, setTemplatePolicies] = useState<Record<string, VmVifPolicy>>({})
  const [resourceError, setResourceError] = useState('')
  const [resourceReload, setResourceReload] = useState(0)
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitBlocked, setSubmitBlocked] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [placementNotice, setPlacementNotice] = useState('')
  const [furthestStep, setFurthestStep] = useState(0)
  const [templateNetworkRead, setTemplateNetworkRead] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; error?: string } | null>(null)
  const [templateNetworkReload, setTemplateNetworkReload] = useState(0)
  const requestGeneration = useRef(0)
  const toast = useToast()
  const connection = useConnectionManagerStore((store) => store.connections.find((item) => item.id === connectionId))
  const poolName = connection?.poolName || connection?.name || connectionId

  const steps = useMemo(() => deriveWizardSteps(state), [state.templateKind])
  const currentIndex = Math.max(0, steps.indexOf(currentStepId))
  const resourcesReady = resourcesConnectionId === connectionId && resourcesTemplateRef === (state.templateRef ?? '') && Object.values(state.resourceStatus ?? {}).every((status) => status === 'ready')
  const templateNetworkKey = `${connectionId}:${state.templateRef}`
  const templateNetworkReady = !state.template?.VIFs?.length || (templateNetworkRead?.key === templateNetworkKey && templateNetworkRead.status === 'ready')

  useEffect(() => {
    if (!open) return
    setSubmitError(null)
    setSubmitBlocked(false)
    setPlacementNotice('')
    setFurthestStep(initialTemplate ? 1 : 0)
    setTemplateNetworkRead(null)
    setTemplatePolicies({})
    setState(initialTemplate ? templateDefaults(INITIAL_STATE, initialTemplate) : { ...INITIAL_STATE })
    setCurrentStepId(initialTemplate ? 'name' : 'template')
  }, [open, initialTemplate, connectionId])

  useEffect(() => {
    if (!open || !connectionId) return
    const generation = ++requestGeneration.current
    setResources(EMPTY_RESOURCES)
    setResourcesConnectionId('')
    setResourcesTemplateRef('')
    setResourceError('')
    setState((previous) => ({
      ...previous,
      resourceStatus: { hosts: 'loading', storage: 'loading', network: 'loading', isos: 'loading' },
    }))
    const templateRef = state.templateRef ?? ''
    const resourceRead = templateRef ? window.xapi.vm.creationResources(connectionId, templateRef) : window.xapi.vm.creationResources(connectionId)
    Promise.all([resourceRead, window.xapi.vm.list(connectionId)])
      .then(([nextResources, vms]) => {
        if (generation !== requestGeneration.current) return
        if (templateRef && !Array.isArray(nextResources.templateDisks)) throw new Error('无法读取模板磁盘计划，请重新读取创建资源')
        const names = new Set(vms.map((vm) => vm.name_label))
        setResources(nextResources)
        setResourcesConnectionId(connectionId)
        setResourcesTemplateRef(templateRef)
        setExistingNames(names)
        setState((previous) => ({
          ...previous,
          disks: previous.diskEdited ? previous.disks : nextResources.templateDisks ?? [],
          vifs: !previous.networkEdited && previous.template && previous.vifs.length === 0
            ? defaultVifs(previous.template, nextResources.networks)
            : previous.vifs,
          vmName: previous.nameEdited || !previous.templateName
            ? previous.vmName
            : uniqueName(previous.templateName, names),
          resourceStatus: { hosts: 'ready', storage: 'ready', network: 'ready', isos: 'ready' },
        }))
      })
      .catch((error: any) => {
        if (generation !== requestGeneration.current) return
        setResourceError(error?.message || '加载创建资源失败')
        setState((previous) => ({
          ...previous,
          resourceStatus: { hosts: 'error', storage: 'error', network: 'error', isos: 'error' },
        }))
      })
    return () => { requestGeneration.current++ }
  }, [open, connectionId, state.templateRef, resourceReload])

  // Preserve a custom template's actual VIF-to-network mapping instead of
  // assigning every inherited adapter to the pool's first network.
  useEffect(() => {
    if (!open || !connectionId || !resourcesReady || !state.templateRef || !state.template?.VIFs?.length) return
    let active = true
    const templateRef = state.templateRef
    setTemplateNetworkRead({ key: templateNetworkKey, status: 'loading' })
    void window.xapi.vm.getVIFs(connectionId, templateRef).then((templateVifs) => {
      if (!active) return
      const inherited = templateVifs.map((vif) => ({
        device: vif.device,
        networkRef: vif.network,
        policy: vif.policy,
        networkName: resources.networks.find((network) => network.ref === vif.network)?.name ?? vif.networkName,
      }))
      setTemplatePolicies(Object.fromEntries(templateVifs.filter((vif) => vif.policy).map((vif) => [vif.device, vif.policy!])))
      setState((previous) => previous.templateRef === templateRef && !previous.networkEdited
        ? { ...previous, vifs: inherited }
        : previous)
      setTemplateNetworkRead({ key: templateNetworkKey, status: 'ready' })
    }).catch((error: any) => {
      if (!active) return
      setTemplateNetworkRead({ key: templateNetworkKey, status: 'error', error: error?.message || String(error) })
    })
    return () => { active = false }
  }, [open, connectionId, resourcesReady, state.templateRef, state.template?.VIFs?.length, resources.networks, templateNetworkReload])

  if (!open) return null

  const handleSelectTemplate = (template: VmRecord) => {
    setFurthestStep(0)
    setPlacementNotice('')
    setTemplateNetworkRead(null)
    setTemplatePolicies({})
    setTemplateNetworkReload((value) => value + 1)
    setState((previous) => {
      const next = templateDefaults(previous, template)
      return { ...next, vifs: defaultVifs(template, resources.networks), vmName: previous.nameEdited ? previous.vmName : uniqueName(template.name_label, existingNames) }
    })
  }

  const buildPayload = (): VmWizardPayload => ({
    templateRef: state.templateRef ?? '', vmName: state.vmName.trim(), vmDescription: state.vmDescription,
    vcpus: state.vcpus, memoryBytes: state.memoryBytes, installMode: state.installMode ?? 'none',
    installUrl: state.installMode === 'url' ? state.installUrl?.trim() : undefined,
    isoRef: state.isoRef || undefined, targetHostRef: state.targetHostRef || undefined,
    targetSrRef: state.targetSrRef || undefined, disks: state.disks, vifs: state.vifs, startAfter: state.startAfter,
  })

  const minMemoryBytes = Number(state.template?.memory_static_min) || GIB / 4
  const validateStep = (step: VmWizardStepId) => step === 'network' && !templateNetworkReady
    ? { valid: false, reason: templateNetworkRead?.status === 'error' ? '模板网卡配置读取失败，请重新读取' : '正在读取模板网卡配置，请稍候' }
    : validateWizardStep(step, state, resources, minMemoryBytes)
  const invalidSteps = steps
    .filter((step) => step !== 'review')
    .flatMap((step) => { const result = validateStep(step); return result.valid ? [] : [{ step, reason: result.reason! }] })
  const wholeFormValid = invalidSteps.length === 0
  const goToStep = (step: VmWizardStepId) => {
    setCurrentStepId(step)
    setFurthestStep((previous) => Math.max(previous, steps.indexOf(step)))
    setSubmitError(null)
  }

  const changePlacement = (targetHostRef: string) => {
    const unavailable = (items: { ref: string; hostRefs: string[] }[], ref: string) => !!ref && !!targetHostRef && !items.find((item) => item.ref === ref)?.hostRefs.includes(targetHostRef)
    const affected = [
      unavailable(resources.isos, state.isoRef) && 'ISO 镜像',
      (unavailable(resources.srs, state.targetSrRef) || (state.templateKind !== 'custom' && state.disks.some((disk) => unavailable(resources.srs, disk.srRef)))) && '磁盘存储',
      state.vifs.some((vif) => unavailable(resources.networks, vif.networkRef)) && '虚拟网卡网络',
    ].filter(Boolean)
    setPlacementNotice(affected.length ? `目标主机无法访问原先的${affected.join('、')}，已清除对应选择。磁盘大小和网卡设备保留，请回到相应步骤重新选择。` : '')
    setState((previous) => ({
      ...previous, targetHostRef,
      isoRef: unavailable(resources.isos, previous.isoRef) ? '' : previous.isoRef,
      targetSrRef: unavailable(resources.srs, previous.targetSrRef) ? '' : previous.targetSrRef,
      diskEdited: true,
      disks: previous.disks.map((disk) => previous.templateKind !== 'custom' && unavailable(resources.srs, disk.srRef) ? { ...disk, srRef: '' } : disk),
      vifs: previous.vifs.map((vif) => unavailable(resources.networks, vif.networkRef) ? { ...vif, networkRef: '', networkName: '' } : vif),
    }))
  }

  const handleCreate = async () => {
    if (submitBlocked || isSubmitting) return
    if (!connectionId || !resourcesReady || !wholeFormValid) {
      setSubmitError(invalidSteps.map(({ step, reason }) => `${STEP_LABELS[step]}：${reason}`).join('；') || '请先读取创建资源')
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const vmRef = await window.xapi.vm.createFromTemplate(connectionId, buildPayload())
      toast.success(`虚拟机 "${state.vmName}" 创建成功`)
      onCreated(vmRef)
    } catch (error: any) {
      if (error?.code === 'VM_CREATED_START_INCOMPLETE' && error?.details?.vmRef) {
        toast.info(error.message)
        onCreated(error.details.vmRef)
        return
      }
      if (error?.code === 'VM_CREATE_OUTCOME_UNKNOWN') setSubmitBlocked(true)
      setSubmitError(error?.message || '创建虚拟机失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedHost = resources.hosts.find((host) => host.ref === state.targetHostRef)
  const maxVcpus = selectedHost?.cpuCount ?? Math.max(1, ...resources.hosts.filter((host) => host.enabled).map((host) => host.cpuCount))
  const maxMemoryBytes = selectedHost?.memoryFree ?? Math.max(0, ...resources.hosts.filter((host) => host.enabled).map((host) => host.memoryFree))
  const stepValidation = validateStep(currentStepId)
  const canGoNext = resourcesReady && stepValidation.valid

  const content = {
    template: <Step1Template connectionId={connectionId} selectedTemplateRef={state.templateRef ?? ''} onSelect={handleSelectTemplate} />,
    name: <Step2Name vmName={state.vmName} vmDescription={state.vmDescription} defaultName={state.templateName} onChange={(field, value) => setState((previous) => ({ ...previous, [field]: value, nameEdited: field === 'vmName' ? true : previous.nameEdited }))} />,
    install: <StepInstallMedia mode={state.installMode ?? 'iso'} isoRef={state.isoRef} supportedModes={state.template ? getSupportedInstallModes(state.template) : []} options={resources.isos} targetHostRef={state.targetHostRef} installUrl={state.installUrl} onChangeInstallUrl={(installUrl) => setState((previous) => ({ ...previous, installUrl }))} onChange={(mode, isoRef) => setState((previous) => ({ ...previous, installMode: mode, isoRef }))} />,
    placement: <StepPlacement targetHostRef={state.targetHostRef} hosts={resources.hosts} onChange={changePlacement} />,
    compute: <Step3Cpu template={state.template} vcpus={state.vcpus} memoryGib={state.memoryBytes / GIB} maxVcpus={maxVcpus} minMemoryGib={minMemoryBytes / GIB} maxMemoryGib={maxMemoryBytes / GIB} onChangeVcpus={(vcpus) => setState((previous) => ({ ...previous, vcpus }))} onChangeMemoryGib={(memoryGib) => setState((previous) => ({ ...previous, memoryBytes: gibToBytes(memoryGib) }))} />,
    storage: <Step4Disk templateKind={state.templateKind ?? 'system'} installMode={state.installMode ?? 'none'} template={state.template} options={resources.srs} targetHostRef={state.targetHostRef} disks={state.disks} diskEdited={state.diskEdited} targetSrRef={state.targetSrRef} onChangeDisks={(disks, userEdited = true) => setState((previous) => ({ ...previous, disks, diskEdited: userEdited || previous.diskEdited }))} onChangeTargetSrRef={(targetSrRef) => setState((previous) => ({ ...previous, targetSrRef }))} />,
    network: templateNetworkReady ? <Step5Network options={resources.networks} targetHostRef={state.targetHostRef} template={state.template} vifs={state.vifs} networkEdited={state.networkEdited} networkRequired={state.installMode === 'pxe' || state.installMode === 'url'} onChangeVifs={(vifs) => setState((previous) => ({ ...previous, vifs: vifs.map((vif) => ({ ...vif, policy: templatePolicies[vif.device ?? ''] })), networkEdited: true }))} /> : null,
    review: <Step6Review showSubmit={false} wizardData={{ ...state, templateRef: state.templateRef ?? '', templateKind: state.templateKind ?? 'system', installMode: state.installMode ?? 'none', memoryGib: state.memoryBytes / GIB, resources, templatePlatform: state.template?.platform }} poolName={poolName} invalidSteps={invalidSteps} onEdit={goToStep} isSubmitting={isSubmitting} submitError={submitError} submitBlocked={submitBlocked || !resourcesReady || !wholeFormValid} onChangeStartAfter={(startAfter) => setState((previous) => ({ ...previous, startAfter }))} onConfirm={handleCreate} />,
  }[currentStepId]

  return (
    <DesktopDialog open={open} title="新建虚拟机" onClose={onClose} busy={isSubmitting} className="max-w-4xl">
      <div className="bg-card border border-input rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[calc(100dvh-4rem)]">
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0"><h2 className="text-lg font-semibold text-foreground">新建虚拟机</h2><p className="text-xs text-muted-foreground break-words">目标资源池：{poolName}</p></div>
          <button onClick={onClose} aria-label="Close wizard" disabled={isSubmitting}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex shrink-0 px-6 py-3 border-b border-border gap-1 overflow-x-auto">
          {steps.map((step, index) => <button type="button" key={step} onClick={() => goToStep(step)} disabled={isSubmitting || submitBlocked || index > furthestStep} aria-current={index === currentIndex ? 'step' : undefined} aria-label={`编辑${STEP_LABELS[step]}`} className="flex-1 min-w-20 text-center rounded hover:bg-muted disabled:cursor-default"><div className={index === currentIndex ? 'text-accent-foreground' : 'text-subtle'}>{index + 1}</div><span className="text-xs text-muted-foreground">{STEP_LABELS[step]}</span></button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!resourcesReady && !resourceError && <p className="text-sm text-muted-foreground mb-4">正在加载可用主机、存储、网络和 ISO...</p>}
          {resourceError && <div role="alert" className="text-sm text-danger mb-4 break-words">{resourceError}<button type="button" onClick={() => setResourceReload((value) => value + 1)} className="ml-2 underline">重新读取创建资源</button></div>}
          {placementNotice && <p role="status" className="mb-4 text-sm text-warning break-words">{placementNotice}</p>}
          {templateNetworkRead?.key === templateNetworkKey && templateNetworkRead.status === 'error' && <p role="alert" className="mb-4 text-sm text-warning break-words">读取模板网卡配置失败：{templateNetworkRead.error}。<button type="button" onClick={() => setTemplateNetworkReload((value) => value + 1)} className="underline">重新读取模板网卡</button></p>}
          {content}
          {currentStepId !== 'review' && resourcesReady && !stepValidation.valid && <p role="status" className="mt-4 text-sm text-warning">{stepValidation.reason}</p>}
        </div>
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-t border-border">
          <button onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm text-muted-foreground">取消</button>
          <div className="flex gap-3">
            {currentIndex > 0 && <button onClick={() => goToStep(steps[currentIndex - 1])} disabled={isSubmitting || submitBlocked} className="px-4 py-2 text-sm bg-secondary text-foreground rounded-lg disabled:opacity-40">上一步</button>}
            {currentIndex < steps.length - 1 && <button onClick={() => goToStep(steps[currentIndex + 1])} disabled={!canGoNext || isSubmitting || submitBlocked} className="px-4 py-2 text-sm bg-primary disabled:bg-secondary disabled:text-subtle text-primary-foreground rounded-lg">下一步</button>}
            {currentStepId === 'review' && <button type="button" onClick={() => void handleCreate()} disabled={isSubmitting || submitBlocked || !resourcesReady || !wholeFormValid} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40">{isSubmitting ? '正在创建虚拟机...' : invalidSteps.length > 0 ? '请先补充上述配置' : submitBlocked ? '无法获取创建结果' : '创建虚拟机'}</button>}
          </div>
        </div>
      </div>
    </DesktopDialog>
  )
}
