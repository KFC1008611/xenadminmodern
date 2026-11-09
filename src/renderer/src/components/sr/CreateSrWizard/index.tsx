/**
 * CreateSrWizard — 5-step modal wizard for creating a new Storage Repository.
 * Follows the CreateVmWizard pattern: full-screen overlay, step indicator,
 * sub-components for each step, and footer navigation.
 *
 * Step flow:
 *   NFS/iSCSI: 1(type) -> 2(params) -> 3(scan) -> 4(name) -> 5(review)
 *   EXT/HBA:   1(type) -> 2(params) -> 4(name) -> 5(review)  [skip scan]
 */
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMultiDataStore } from '../../../store/multiData.store'
import { useConnectionManagerStore } from '../../../store/connectionManager.store'
import { DesktopDialog } from '../../layout/DesktopDialog'
import { useSrWizardStore } from '../../../store/srWizard.store'
import { useToast } from '../../toast/useToast'
import Step1Type from './Step1Type'
import Step2Params from './Step2Params'
import Step3Scan from './Step3Scan'
import Step4Name from './Step4Name'
import Step5Review from './Step5Review'

const STEP_LABELS = ['类型选择', '连接参数', '扫描验证', '命名', '确认']

interface CreateSrWizardProps {
  open: boolean
  onClose: () => void
  onCreated: (srRef: string) => void
  connectionId: string
  hostRef: string
}

function isStepValid(step: number): boolean {
  const state = useSrWizardStore.getState()
  switch (step) {
    case 1:
      return state.srType !== ''
    case 2: {
      if ((state.srType === 'nfs' || state.srType === 'iso')) return state.nfsServer.trim() !== ''
      if (state.srType === 'iscsi') return state.iscsiTarget.trim() !== '' && Number.isInteger(Number(state.iscsiPort))
        && Number(state.iscsiPort) > 0 && Number(state.iscsiPort) <= 65535
      return true
    }
    case 3:
      if ((state.srType === 'nfs' || state.srType === 'iso')) return Boolean(state.nfsServer.trim() && state.nfsPath.trim())
      if (state.srType === 'iscsi') return Boolean(state.iscsiTarget.trim() && state.iscsiIqn.trim() && state.iscsiLun.trim())
      return true
    case 4:
      return state.nameLabel.trim() !== ''
    default:
      return true
  }
}

export default function CreateSrWizard({
  open,
  onClose,
  onCreated,
  connectionId,
  hostRef,
}: CreateSrWizardProps) {
  const {
    currentStep,
    setStep,
    reset,
    isSubmitting,
    srType,
    nameLabel,
    submitError,
    createSr,
  } = useSrWizardStore()
  const toast = useToast()
  const hosts = useMultiDataStore((state) => state.hosts).filter((host) => host.connectionId === connectionId)
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const [selectedHostRef, setSelectedHostRef] = useState(hostRef)
  useEffect(() => { if (open) setSelectedHostRef(hostRef) }, [open, hostRef, connectionId])

  if (!open) return null

  const skipScan = srType === 'ext' || srType === 'hba'

  // Map absolute step numbers to visible indicator indices
  // For skipScan: steps [1,2,4,5] -> indicator shows 4 steps numbered 1-4
  const visibleSteps = skipScan
    ? [1, 2, 4, 5]
    : [1, 2, 3, 4, 5]
  const indicatorLabels = skipScan
    ? STEP_LABELS.filter((_, i) => i !== 2) // remove '扫描验证'
    : STEP_LABELS

  const currentIndicatorIdx = visibleSteps.indexOf(currentStep)
  const isLastStep = currentIndicatorIdx === visibleSteps.length - 1

  const handleClose = () => {
    if (isSubmitting) return
    reset()
    onClose()
  }

  const handleNext = () => {
    if (!isStepValid(currentStep)) return
    if (currentStep === 2 && skipScan) {
      setStep(4)
    } else {
      setStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep === 4 && skipScan) {
      setStep(2)
    } else {
      setStep(currentStep - 1)
    }
  }

  const handleCreate = async () => {
    const reattaching = Boolean(useSrWizardStore.getState().existingSrUuid)
    try {
      const srRef = await createSr(connectionId, selectedHostRef)
      toast.success(`存储仓库 "${nameLabel}" ${reattaching ? '已接入' : '创建成功'}`)
      reset()
      onCreated(srRef)
    } catch (error: any) {
      if (error?.code === 'SR_CREATED_INCOMPLETE' && error?.details?.srRef) {
        toast.info(error.message)
        reset()
        onCreated(error.details.srRef)
      }
    }
  }

  const canGoNext = isStepValid(currentStep) && Boolean(selectedHostRef) && connection?.state === 'connected'

  return (
    <DesktopDialog open={open} title="创建存储仓库" onClose={handleClose} busy={isSubmitting} className="max-w-2xl">
      <div className="bg-card border border-input rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-4rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">创建存储仓库</h2>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close wizard"
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 border-b border-border px-6 py-3 text-sm">
          <p className="break-all text-secondary-foreground">目标资源池：{connection?.poolName || connection?.name || connectionId}</p>
          <label className="flex items-center gap-3 text-muted-foreground">
            <span className="shrink-0">接入主机</span>
            <select aria-label="接入主机" value={selectedHostRef} disabled={isSubmitting || currentStep === 5}
              onChange={(event) => { setSelectedHostRef(event.target.value); useSrWizardStore.getState().invalidateDiscovery() }}
              className="min-w-0 flex-1 rounded border border-input bg-muted px-2 py-1 text-foreground">
              {hosts.map((host) => <option key={host.ref} value={host.ref}>{host.name_label || host.ref}</option>)}
              {!hosts.length && <option value="">主机信息尚未就绪</option>}
            </select>
          </label>
          {connection?.state !== 'connected' && <p role="alert" className="text-warning">管理连接未连接，请重新连接后继续。</p>}
        </div>

        {/* Step indicator */}
        <div className="flex px-6 py-3 border-b border-border gap-1">
          {indicatorLabels.map((label, idx) => {
            const isActive = idx === currentIndicatorIdx
            const isDone = idx < currentIndicatorIdx
            return (
              <div key={label} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isDone
                        ? 'bg-success-solid text-on-solid'
                        : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <span
                    className={`text-xs mt-1 ${
                      isActive ? 'text-accent-foreground' : isDone ? 'text-success' : 'text-subtle'
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {idx < indicatorLabels.length - 1 && (
                  <div
                    className={`h-px flex-1 mx-1 mb-4 ${
                      isDone ? 'bg-success-solid' : 'bg-secondary'
                    }`}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Step content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {currentStep === 1 && <Step1Type />}
          {currentStep === 2 && <Step2Params />}
          {currentStep === 3 && !skipScan && (
            <Step3Scan connectionId={connectionId} hostRef={selectedHostRef} />
          )}
          {currentStep === 4 && <Step4Name />}
          {currentStep === 5 && (
            <Step5Review
              connectionId={connectionId}
              hostRef={selectedHostRef}
              isSubmitting={isSubmitting || connection?.state !== 'connected' || !selectedHostRef}
              submitError={submitError}
              onConfirm={handleCreate}
            />
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <div className="flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm bg-secondary hover:bg-secondary text-foreground rounded-lg transition-colors disabled:opacity-50"
              >
                上一步
              </button>
            )}
            {!isLastStep && (
              <button
                onClick={handleNext}
                disabled={!canGoNext || isSubmitting}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
              >
                下一步
              </button>
            )}
          </div>
        </div>
      </div>
    </DesktopDialog>
  )
}
