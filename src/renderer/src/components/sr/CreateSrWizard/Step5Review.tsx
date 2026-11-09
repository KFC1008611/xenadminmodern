/**
 * Step 5 — Review and Create.
 * Displays a read-only summary of all wizard choices and the Create button.
 */
import { Loader2 } from 'lucide-react'
import { useSrWizardStore } from '../../../store/srWizard.store'

interface Step5ReviewProps {
  connectionId: string
  hostRef: string
  isSubmitting: boolean
  submitError: string | null
  onConfirm: () => void
}

const SR_TYPE_LABELS: Record<string, string> = {
  ext: 'Local EXT',
  nfs: 'NFS',
  iscsi: 'iSCSI',
  hba: 'HBA',
  iso: 'NFS ISO 库',
}

export default function Step5Review({
  isSubmitting,
  submitError,
  onConfirm,
}: Step5ReviewProps) {
  const {
    submitBlocked,
    existingSrUuids, existingSrUuid, setField,
    srType,
    nfsServer,
    nfsPath,
    iscsiTarget,
    iscsiPort,
    iscsiIqn,
    iscsiLun,
    nameLabel,
    nameDescription,
  } = useSrWizardStore()

  return (
    <div className="space-y-4">

      <div className="bg-muted rounded-lg divide-y divide-input">
        <ReviewRow label="存储类型" value={SR_TYPE_LABELS[srType] || srType} />
        <ReviewRow label="名称" value={nameLabel} />
        {nameDescription && (
          <ReviewRow label="描述" value={nameDescription} />
        )}

        {(srType === 'nfs' || srType === 'iso') && (
          <>
            <ReviewRow label="NFS 服务器" value={nfsServer} />
            <ReviewRow label="共享目录" value={nfsPath || '未选择'} />
          </>
        )}

        {srType === 'iscsi' && (
          <>
            <ReviewRow label="目标地址" value={iscsiTarget} />
            <ReviewRow label="端口" value={iscsiPort} />
            {iscsiIqn && <ReviewRow label="IQN" value={iscsiIqn} />}
            {iscsiLun && <ReviewRow label="SCSI 标识" value={iscsiLun} />}
          </>
        )}
      </div>

      {existingSrUuids.length > 0 && <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
        <p>所选 LUN 已有存储仓库。选择下列 UUID 后接入，保留原有磁盘数据，不创建或格式化存储。</p>
        <label className="block">已有存储仓库<select aria-label="已有存储仓库" value={existingSrUuid} onChange={(event) => setField('existingSrUuid', event.target.value)} className="mt-2 w-full rounded border border-input bg-card px-3 py-2">
          <option value="">请选择已核对的 UUID</option>{existingSrUuids.map((uuid) => <option key={uuid} value={uuid}>{uuid}</option>)}
        </select></label>
      </div>}
      {submitError && (
        <div role="alert" className="break-words p-3 bg-danger-soft border border-danger/30 rounded-lg text-danger text-sm">
          {submitError}
        </div>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={isSubmitting || submitBlocked || existingSrUuids.length > 0 && !existingSrUuid}
        className="w-full py-2.5 px-4 bg-primary hover:bg-primary-hover disabled:bg-primary-hover disabled:cursor-not-allowed text-primary-foreground font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {isSubmitting ? '正在处理...' : existingSrUuid ? '接入已有存储（保留数据）' : '创建存储仓库'}
      </button>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex px-4 py-3">
      <span className="w-28 text-sm text-subtle flex-shrink-0">{label}</span>
      <span className="min-w-0 break-all text-sm text-foreground">{value}</span>
    </div>
  )
}
