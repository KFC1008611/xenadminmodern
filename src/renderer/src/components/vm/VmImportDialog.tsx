import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, FileUp, Loader2, Upload, X } from 'lucide-react'
import { useImportWizardStore } from '../../store/importWizard.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { formatRawNetworkName } from '../../lib/networkDisplay'
import { formatVifLabel } from '../../lib/networkTerminology'
import { feedback } from '../../store/feedback.store'
import { DesktopDialog } from '../layout/DesktopDialog'
import { ImportOperationProgress } from './ImportOperationProgress'
import type { VmCreationResourceOptions } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { readOperationResult } from '../../../../shared/read-operation-result'
import { isTransferTerminal } from '../../lib/transferTracking'

interface VmImportDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  onImported?: (connectionId: string) => void | Promise<void>
  onViewObject?: (connectionId: string, vmRef: string) => void
}

const steps = ['选择文件', '目标服务器与存储', '网络映射', '确认与进度']
const activeStatuses = ['pending', 'validating', 'uploading', 'waiting_for_task']

export function VmImportDialog({ open, onClose, connectionId, onImported, onViewObject }: VmImportDialogProps) {
  const store = useImportWizardStore()
  const { refreshVms, refreshTasks } = useMultiDataStore()
  const connections = useConnectionManagerStore((state) => state.connections)
  const notifiedOperation = useRef<string | null>(null)
  const effectiveConnectionId = store.operationId ? store.operationConnectionId ?? connectionId : connectionId
  const connection = connections.find((item) => item.id === effectiveConnectionId)
  const [resources, setResources] = useState<VmCreationResourceOptions | null>(null)
  const [resourceError, setResourceError] = useState('')
  const availableHosts = resources?.hosts.map((h) => ({ ...h, name_label: h.name })) ?? []
  const availableSrs = (resources?.srs ?? []).filter((sr) => sr.freeBytes > 0 && (!store.homeServerRef || sr.hostRefs.includes(store.homeServerRef))).map((sr) => ({ ...sr, name_label: sr.name }))
  const availableNetworks = (resources?.networks ?? []).filter((n) => !store.homeServerRef || n.hostRefs.includes(store.homeServerRef)).map((n) => ({ ...n, name_label: n.name }))
  const selectedTargetsExist = availableSrs.some((sr) => sr.ref === store.targetSrRef)
    && (!store.homeServerRef || availableHosts.some((h) => h.ref === store.homeServerRef))
    && (store.preview?.vifs ?? []).every((vif) => availableNetworks.some((n) => n.ref === store.vifMappings[vif.device]))
  const hasCompatibleHost = availableHosts.some((host) => (!store.homeServerRef || host.ref === store.homeServerRef)
    && availableSrs.some((sr) => sr.ref === store.targetSrRef && sr.hostRefs.includes(host.ref))
    && (store.preview?.vifs ?? []).every((vif) => availableNetworks.some((n) => n.ref === store.vifMappings[vif.device] && n.hostRefs.includes(host.ref))))
  const validTargets = selectedTargetsExist && hasCompatibleHost

  useEffect(() => {
    const current = useImportWizardStore.getState()
    if (open && current.operationId && (isTransferTerminal(current.operationStatus) || current.operationRecordMissing)) current.newDraft()
    useImportWizardStore.setState({ dialogOpen: open })
    return () => { useImportWizardStore.setState({ dialogOpen: false }) }
  }, [open])
  useEffect(() => {
    if (!open) return
    store.bindScope(JSON.stringify({ connectionId, poolUuid: connection?.poolUuid, epoch: connection?.epoch }))
  }, [open, connectionId, connection?.poolUuid, connection?.epoch, store.operationId])
  useEffect(() => {
    if (!open || store.operationId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setResources(null)
    const load = async () => {
      try {
        const result = await window.xapi.vm.creationResources(effectiveConnectionId)
        if (!disposed) { setResources(result); setResourceError('') }
      } catch (error: any) {
        if (!disposed) { setResources(null); setResourceError(`无法核对导入资源：${error.message}`) }
      }
      if (!disposed) timer = setTimeout(load, 10000)
    }
    void load()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [open, effectiveConnectionId, connection?.epoch, connection?.poolUuid, store.operationId])
  const canViewObject = connection?.state === 'connected' && Boolean(store.operationPoolUuid && connection.poolUuid === store.operationPoolUuid)
  const selectedSr = availableSrs.find((sr) => sr.ref === store.targetSrRef)
  const canEditDraft = !store.operationId && !store.importing && store.operationStatus !== 'unknown'

  useEffect(() => {
    if (!open || !store.operationId || store.operationRecordMissing || isTransferTerminal(store.operationStatus)) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const operation = await readOperationResult(async () => {
          const result = await window.xapi.vm.importProgress(store.operationId!)
          return result
        }, { isCurrent: () => !disposed })
        if (disposed) return
        if (!operation) { store.markRecordMissing(store.operationId!); return }
        store.applyOperation(operation)
        if (operation.status === 'completed' && notifiedOperation.current !== operation.operationId) {
          notifiedOperation.current = operation.operationId
          try {
            const completedConnectionId = operation.connectionId ?? effectiveConnectionId
            await refreshVms({ afterMutation: true, connectionId: completedConnectionId })
            await refreshTasks({ afterMutation: true, connectionId: completedConnectionId })
            await onImported?.(completedConnectionId)
          } catch (error: any) {
            feedback.warning(`XVA 导入已完成，但刷新失败：${error?.message || String(error)}。请刷新资源列表，勿重复导入。`)
            return
          }
          feedback.success('XVA 导入成功')
        }
        if (!disposed && !['completed', 'failed', 'cancelled'].includes(operation.status)) timer = setTimeout(poll, operation.status === 'unknown' ? 10000 : 1000)
      } catch (error: any) {
        if (!disposed) {
          useImportWizardStore.setState({ importing: false, operationStatus: 'unknown', operationMessage: `获取导入结果失败：${error?.message || String(error)}` })
          timer = setTimeout(poll, 10000)
        }
      }
    }
    void poll()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [open, store.operationId, store.operationRecordMissing, connectionId, connection?.epoch, connection?.state])

  if (!open) return null

  const handleFileSelect = async () => {
    try {
    const result = await window.xapi.dialog.showOpenDialog({
      title: '选择 XVA 虚拟机归档',
      filters: [{ name: 'XVA 虚拟机归档', extensions: ['xva'] }],
      properties: ['openFile'],
    })
    if (!result.canceled && result.filePaths[0]) store.selectFile(result.filePaths[0])
    } catch (error: any) { useImportWizardStore.setState({ importError: `选择文件失败：${error?.message || String(error)}` }) }
  }

  const handleClose = () => {
    onClose()
  }

  const handleCancel = async () => {
    if (!store.operationId) return
    try {
      await store.cancel(effectiveConnectionId, store.operationId)
    } catch (error: any) {
      useImportWizardStore.setState({ importError: error?.message || '取消导入失败' })
    }
  }

  const canContinue = store.currentStep === 1
    ? !!store.preview
    : store.currentStep === 2
      ? availableSrs.some((sr) => sr.ref === store.targetSrRef)
      : store.currentStep === 3
        ? validTargets
        : true

  return (
    <DesktopDialog open={open} title="导入 XVA" onClose={handleClose} busy={store.importing && !store.operationId} className="max-w-3xl">
      <div className="bg-card border border-input rounded-xl w-full max-w-3xl p-6 space-y-5 max-h-[calc(100dvh-4rem)] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Upload className="w-5 h-5 text-accent-foreground" /><h2 className="text-lg font-semibold text-foreground">导入 XVA</h2></div>
          <button onClick={handleClose} disabled={store.importing && !store.operationId} aria-label="关闭"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {steps.map((label, index) => <div key={label} className={`text-xs text-center ${store.currentStep === index + 1 ? 'text-accent-foreground' : 'text-subtle'}`}>{index + 1}. {label}</div>)}
        </div>

        {store.currentStep === 1 && <div className="space-y-4">
          <button type="button" onClick={handleFileSelect} className="w-full border-2 border-dashed border-input rounded-xl p-8 text-center">
            <FileUp className="w-10 h-10 text-subtle mx-auto mb-3" />
            <span className="block text-sm text-secondary-foreground">点击选择 XVA 文件</span>
            <span className="block text-xs text-subtle mt-1">仅支持未压缩的 .xva 格式</span>
          </button>
          {store.filePath && <p className="text-sm text-foreground truncate">{store.filePath}</p>}
          <p className="text-xs text-muted-foreground">此处快速读取元数据；开始导入后会完整检查归档和磁盘块校验，再上传到资源池。</p>
          {store.preview && <div className="rounded-lg bg-muted p-3 text-sm text-secondary-foreground">{store.preview.isTemplate ? '模板' : '虚拟机'} · {store.preview.vmName} · {store.preview.diskCount} 块磁盘 · {store.preview.vifs.length} 个虚拟网卡</div>}
        </div>}

        {store.currentStep === 2 && <div className="space-y-4">
          <div className="rounded-lg bg-muted p-3 text-sm text-secondary-foreground">归档中的{store.preview?.isTemplate ? '模板' : '虚拟机'}名称：{store.preview?.vmName || '未知'}{store.preview?.description && <p className="mt-1 text-muted-foreground">描述：{store.preview.description}</p>}</div>
          <p className="text-xs text-muted-foreground">导入后保留归档中的名称、描述、模板类型和其他配置。</p>
          <label className="block text-sm text-secondary-foreground">Home Server<select aria-label="Home Server" value={store.homeServerRef} onChange={(event) => store.setHomeServer(event.target.value)} className="mt-1 w-full bg-muted border border-input rounded-lg p-2"><option value="">{connection?.poolName || connection?.name || '资源池'}（不指定 Home Server）</option>{availableHosts.map((host) => <option key={host.ref} value={host.ref}>{host.name_label}</option>)}</select></label>
          <label className="block text-sm text-secondary-foreground">目标存储<select aria-label="目标存储" value={store.targetSrRef} onChange={(event) => store.setTargetSr(event.target.value)} className="mt-1 w-full bg-muted border border-input rounded-lg p-2"><option value="">请选择</option>{availableSrs.map((sr) => <option key={sr.ref} value={sr.ref}>{sr.name_label} · 可用 {formatBytes(sr.freeBytes)}</option>)}</select></label>
        </div>}

        {store.currentStep === 3 && <div className="space-y-3">
          {(store.preview?.vifs ?? []).length === 0 && <p className="text-sm text-muted-foreground">归档中没有虚拟网卡。</p>}
          {store.preview?.vifs.map((vif) => <div key={vif.device} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center"><span className="min-w-0 truncate text-sm text-secondary-foreground" title={vif.sourceNetworkName}>{formatVifLabel(vif.device)} · 接入网络：{formatRawNetworkName(vif.sourceNetworkName)}</span><ChevronRight className="w-4 h-4" /><select aria-label={`${formatVifLabel(vif.device)} 目标网络`} value={store.vifMappings[vif.device] ?? ''} title={availableNetworks.find((network) => network.ref === store.vifMappings[vif.device])?.name_label} onChange={(event) => store.setVifMappings({ ...store.vifMappings, [vif.device]: event.target.value })} className="min-w-0 bg-muted border border-input rounded-lg p-2"><option value="">请选择目标网络</option>{availableNetworks.map((network) => <option key={network.ref} value={network.ref} title={network.name_label}>{formatRawNetworkName(network.name_label)}</option>)}</select></div>)}
        </div>}

        {store.currentStep === 4 && <div className="space-y-4">
          <div className="rounded-lg bg-muted p-4 text-sm text-secondary-foreground space-y-2 break-words">{store.preview?.isTemplate ? '模板' : '虚拟机'}：{store.preview?.vmName} → {availableSrs.find((sr) => sr.ref === store.targetSrRef)?.name_label} · {availableHosts.find((host) => host.ref === store.homeServerRef)?.name_label || connection?.poolName || connection?.name}
            <p className="text-xs text-muted-foreground break-all">文件：{store.filePath}</p>
            <p>{store.preview?.diskCount} 块磁盘 · 归档虚拟容量 {formatBytes(store.preview?.originalSize ?? 0)} · {store.preview?.vcpus} vCPU · 内存 {formatBytes(store.preview?.memory ?? 0)}</p>
            {store.preview?.powerState === 'Suspended' && <p className="text-warning">包含内存镜像（{formatBytes(store.preview.suspendDiskSize ?? 0)}），导入后保持挂起；恢复运行仍需目标主机兼容。</p>}
            {store.preview?.vifs.map((vif) => <p key={vif.device}>{formatVifLabel(vif.device)}：{formatRawNetworkName(vif.sourceNetworkName)} → {availableNetworks.find((n) => n.ref === store.vifMappings[vif.device])?.name_label || '目标网络待核对'}</p>)}
          </div>
          {!store.operationRecordMissing && store.operationStatus !== 'unknown' && (store.importing || store.operationStatus) && <ImportOperationProgress status={store.operationStatus ?? 'pending'} progress={store.progress} validation={store.validation} transfer={store.transfer} message={store.operationStatus === 'failed' ? '导入失败' : store.operationMessage || '准备导入 XVA'} />}
          {store.operationStatus === 'unknown' && <div role="alert" className="text-warning text-sm space-y-2"><p>{store.operationRecordMissing ? store.operationMessage : `无法获取导入结果：${store.operationMessage}`}</p>{store.vmRef && <p>已导入 VM：{store.vmRef}</p>}<button onClick={onClose} className="underline">关闭</button></div>}
          {store.warnings.map((warning) => <p key={warning} className="text-sm text-warning">{warning}</p>)}
          {store.operationStatus === 'completed' && <div className="text-success flex gap-2"><CheckCircle className="w-5 h-5" />导入成功</div>}
          {store.importError && <div className="text-danger space-y-1"><div className="flex gap-2"><AlertTriangle className="w-5 h-5" />{store.importError}</div>{store.vmRef && <p className="text-xs">已导入 VM：{store.vmRef}，可手动恢复配置。</p>}</div>}
          {canEditDraft && selectedSr && (store.preview?.originalSize ?? 0) > selectedSr.freeBytes && <p className="text-xs text-warning">归档虚拟容量大于剩余空间；稀疏磁盘实际分配由存储后端决定，请确认容量足够。</p>}
          {canEditDraft && <button disabled={store.importing || !validTargets} onClick={() => store.startImport(connectionId)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">开始导入</button>}
          {store.operationId && !store.operationRecordMissing && (activeStatuses.includes(store.operationStatus ?? '') || store.operationStatus === 'unknown' && !store.vmRef) && <button disabled={store.pendingCancels.includes(store.operationId)} onClick={handleCancel} className="px-4 py-2 bg-danger-solid text-on-solid rounded-lg disabled:opacity-50">{store.pendingCancels.includes(store.operationId) ? '正在请求取消…' : '取消导入'}</button>}
          {store.operationStatus === 'configuring' && <p className="text-xs text-subtle">正在应用配置，此阶段不能取消。</p>}
        </div>}

        {store.operationId && !store.operationRecordMissing && <p className="text-xs text-muted-foreground">关闭窗口后继续在后台处理，可从右上角“任务通知”查看。{store.operationStatus === 'unknown' && '系统继续核对原任务，请勿重复导入同一归档。'}</p>}
        {store.vmRef && store.operationConnectionId && onViewObject && <button disabled={!canViewObject} title={!canViewObject ? '请重新连接原资源池后查看对象' : undefined} className="text-accent-foreground underline" onClick={() => { onViewObject(store.operationConnectionId!, store.vmRef!); onClose() }}>查看已导入{store.preview?.isTemplate ? '模板' : '虚拟机'}</button>}
        {store.operationId && <button onClick={() => store.newDraft()} className="text-sm text-secondary-foreground underline">新建导入</button>}
        {canEditDraft && (resourceError || store.currentStep >= 3 && !validTargets) && <p role="alert" className="text-sm text-warning">{resourceError || (selectedTargetsExist && !hasCompatibleHost ? '没有可用主机同时访问所选存储和全部网络，请调整映射或 Home Server' : '目标资源已变化或正在核对，请重新选择可用存储、主机和网络')}</p>}
        {store.importError && store.currentStep !== 4 && <p className="text-sm text-danger">{store.importError}</p>}
        {canEditDraft && <div className="flex justify-between"><button onClick={() => store.setStep(store.currentStep - 1)} disabled={store.currentStep === 1} className="px-4 py-2 text-muted-foreground"><ChevronLeft className="inline w-4 h-4" />上一步</button>{store.currentStep < 4 && <button onClick={() => store.setStep(store.currentStep + 1)} disabled={!canContinue} className="px-4 py-2 bg-primary disabled:bg-secondary disabled:text-subtle text-primary-foreground rounded-lg">下一步<ChevronRight className="inline w-4 h-4" /></button>}</div>}
        {store.operationStatus === 'completed' && <button onClick={handleClose} className="px-4 py-2 bg-secondary text-foreground rounded-lg">完成</button>}
        {store.importing && <Loader2 className="w-4 h-4 animate-spin" />}
      </div>
    </DesktopDialog>
  )
}
