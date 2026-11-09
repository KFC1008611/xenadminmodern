/**
 * Step 3 — Scan and Verify.
 * Calls scanNfs or scanIscsi depending on the SR type, then displays
 * results as a selectable list.
 */
import { Loader2, Search, AlertCircle } from 'lucide-react'
import { useSrWizardStore } from '../../../store/srWizard.store'
import { cn } from '../../../lib/utils'

interface Step3ScanProps {
  connectionId: string
  hostRef: string
}

export default function Step3Scan({ connectionId, hostRef }: Step3ScanProps) {
  const {
    srType,
    nfsServer,
    iscsiTarget,
    iscsiPort,
    availableNfsTargets,
    availableIscsiTargets,
    availableIscsiLuns,
    nfsPath,
    iscsiIqn,
    iscsiLun,
    scanning,
    scanCompleted,
    scanError,
    scanNfs,
    scanIscsi,
    scanIscsiLuns,
    setField,
    selectIscsiTarget,
  } = useSrWizardStore()

  const handleScan = () => {
    if ((srType === 'nfs' || srType === 'iso')) {
      scanNfs(connectionId, hostRef)
    } else if (srType === 'iscsi') {
      scanIscsi(connectionId, hostRef)
    }
  }

  const targets = (srType === 'nfs' || srType === 'iso') ? availableNfsTargets : availableIscsiTargets
  const hasResults = targets.length > 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {(srType === 'nfs' || srType === 'iso') ? `扫描 NFS 服务器 ${nfsServer}，然后选择一个共享目录。` : `扫描 iSCSI 目标 ${iscsiTarget}，然后选择 IQN 和 LUN。`}
        已填写并核实的路径或 SCSI 标识也可以直接使用。
      </p>

      {/* Scan button */}
      <button
        type="button"
        onClick={handleScan}
        disabled={scanning}
        className="flex items-center gap-2 px-4 py-2 text-sm bg-secondary hover:bg-secondary text-foreground rounded-lg transition-colors disabled:opacity-50"
      >
        {scanning ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Search className="w-4 h-4" />
        )}
        {scanning ? '正在扫描...' : '扫描存储目标'}
      </button>

      {/* Error display */}
      {scanError && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-danger-soft border border-danger/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
          <span className="break-words text-sm text-danger">{scanError}。可返回上一步修改参数，或重新扫描。</span>
        </div>
      )}

      {/* NFS results */}
      {(srType === 'nfs' || srType === 'iso') && hasResults && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-secondary-foreground">可用 NFS 共享目录</h4>
          <div className="space-y-1.5">
            {availableNfsTargets.map((target, idx) => {
              const isSelected = nfsPath === target.path && nfsServer === target.server
              return (
                <button
                  key={`${target.server}-${target.path}-${idx}`}
                  type="button"
                  onClick={() => {
                    if (target.server && target.server !== nfsServer) setField('nfsServer', target.server)
                    setField('nfsPath', target.path)
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all',
                    isSelected
                      ? 'border-primary/30 bg-accent'
                      : 'border-input bg-muted hover:border-input'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                      isSelected ? 'border-primary/30' : 'border-input'
                    )}
                  >
                    {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <div className="text-sm text-foreground">{target.path}</div>
                    <div className="text-xs text-subtle">{target.server}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* iSCSI results */}
      {srType === 'iscsi' && hasResults && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-secondary-foreground">可用 iSCSI 目标</h4>
          <div className="space-y-1.5">
            {availableIscsiTargets.map((target, idx) => {
              const isSelected = iscsiIqn === target.iqn && iscsiTarget === target.address && iscsiPort === String(target.port)
              return (
                <button
                  key={`${target.iqn}-${idx}`}
                  type="button"
                  onClick={() => {
                    selectIscsiTarget(target)
                    void scanIscsiLuns(connectionId, hostRef)
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all',
                    isSelected
                      ? 'border-primary/30 bg-accent'
                      : 'border-input bg-muted hover:border-input'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                      isSelected ? 'border-primary/30' : 'border-input'
                    )}
                  >
                    {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="break-all text-sm text-foreground">{target.iqn}</div>
                    <div className="text-xs text-subtle">
                      {target.address}:{target.port}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {srType === 'iscsi' && iscsiIqn && (
        <div className="space-y-2">
          <button type="button" disabled={scanning} onClick={() => void scanIscsiLuns(connectionId, hostRef)}
            className="text-sm text-accent-foreground disabled:opacity-50">发现所选 IQN 的 LUN</button>
          {availableIscsiLuns.map((lun) => (
            <button key={lun.id} type="button" onClick={() => setField('iscsiLun', lun.id)}
              className={cn('block w-full rounded-lg border p-3 text-left text-sm',
                iscsiLun === lun.id ? 'border-primary/30 bg-accent' : 'border-input')}>
              <span className="block text-foreground">LUN {lun.lunId || '未上报'} · {lun.vendor || '未知厂商'} · {(lun.size / 1024 ** 3).toFixed(1)} GiB</span>
              <span className="block break-all text-muted-foreground">SCSI 标识：{lun.id}</span>
            </button>
          ))}
          {iscsiLun && <p className="break-all text-xs text-muted-foreground">已选 SCSI 标识：{iscsiLun}</p>}
        </div>
      )}

      {(srType === 'nfs' || srType === 'iso') && nfsPath && <p className="break-all text-xs text-secondary-foreground">当前共享目录：{nfsPath}</p>}
      {srType === 'iscsi' && iscsiIqn && scanCompleted && availableIscsiLuns.length === 0 && <p className="text-xs text-warning">未发现可用 LUN，请核对目标的访问权限后再次发现 LUN。</p>}

      {/* No results message */}
      {!scanning && !scanError && availableNfsTargets.length === 0 && availableIscsiTargets.length === 0 && (
        <div className="text-sm text-subtle py-4 text-center">
          {scanCompleted ? '扫描完成，未发现可用目标。请核对共享目录或 LUN 的导出权限，修改参数后重新扫描。' : '点击“扫描存储目标”发现可用目标。'}
        </div>
      )}
    </div>
  )
}
