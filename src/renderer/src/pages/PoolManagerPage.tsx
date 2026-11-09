/**
 * PoolManagerPage — pool management operations: add host, remove host, transfer master.
 * v9: New page integrating poolManager.store for pool operations.
 */
import { useEffect, useState } from 'react'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { useMultiDataStore } from '../store/multiData.store'
import { usePoolManagerStore } from '../store/poolManager.store'
import { feedback } from '../store/feedback.store'
import { getAuditedFeatureBlockReason } from '../../../shared/audited-features'
import {
  Server,
  Plus,
  LogOut,
  ArrowRightLeft,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'

const poolJoinBlocked = getAuditedFeatureBlockReason('pool.join')
const poolEjectBlocked = getAuditedFeatureBlockReason('pool.eject')
const poolTransferBlocked = getAuditedFeatureBlockReason('pool.governance')

export default function PoolManagerPage() {
  const connections = useConnectionManagerStore((s) => s.connections)
  const { hosts, pools, refreshHosts } = useMultiDataStore()
  const {
    joinDialogOpen, openJoinDialog, closeJoinDialog,
    joinParams, setJoinParam, joinValidating, joinValidationResult, joinError,
    validateJoinHost, executeJoin, resetJoinState,
    ejectDialogOpen, ejectHostName,
    openEjectDialog, closeEjectDialog,
    ejectEvacuating, ejectTaskRef, ejectError, executeEject, resetEjectState,
    transferDialogOpen, transferCandidates,
    closeTransferDialog,
    transferring, transferError, executeTransfer, resetTransferState,
  } = usePoolManagerStore()

  const activeConnectionId = useConnectionManagerStore((s) => s.activeConnectionId)
  const connectedPools = connections.filter((c) => c.state === 'connected')

  const [selectedPoolId, setSelectedPoolId] = useState(activeConnectionId || '')
  const poolId = connectedPools.find((connection) => connection.id === selectedPoolId)?.id
    || connectedPools.find((connection) => connection.id === activeConnectionId)?.id
    || connectedPools[0]?.id || ''
  useEffect(() => { setSelectedPoolId(poolId) }, [poolId])
  const poolHosts = hosts.filter((h) => h.connectionId === poolId)
  const pool = pools.find((p) => p.connectionId === poolId)

  // Join dialog handlers
  const handleJoin = async () => {
    const result = await executeJoin(poolId)
    if (result) {
      feedback.success('主机已加入资源池')
      closeJoinDialog()
      resetJoinState()
      refreshHosts({ afterMutation: true, connectionId: poolId })
    }
  }

  // Eject dialog handlers
  const handleEject = async () => {
    const taskRef = await executeEject(poolId)
    if (taskRef) {
      feedback.success('主机移出任务已启动')
    }
  }

  // Transfer dialog handlers
  const [transferTarget, setTransferTarget] = useState('')
  const handleTransfer = async () => {
    if (!transferTarget) return
    const result = await executeTransfer(poolId, transferTarget)
    if (result) {
      feedback.success('主节点转移已启动')
      closeTransferDialog()
      resetTransferState()
      setTransferTarget('')
      refreshHosts({ afterMutation: true, connectionId: poolId })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">资源池管理</h1>
        </div>
      </div>

      {/* Pool selector */}
      <div className="flex min-w-0 items-center gap-3">
        <label htmlFor="pool-manager-select" className="shrink-0 text-sm text-muted-foreground">选择资源池：</label>
        <select
          id="pool-manager-select"
          value={poolId}
          onChange={(e) => setSelectedPoolId(e.target.value)}
          className="min-w-0 max-w-full flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:max-w-sm"
        >
          {connectedPools.map((conn) => (
            <option key={conn.id} value={conn.id}>
              {conn.poolName || conn.name || conn.host}
            </option>
          ))}
        </select>
      </div>

      {/* Pool info and actions */}
      {poolId && pool && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 basis-64 break-words">
              <h2 className="text-base font-medium text-foreground">{pool.name_label || '资源池'}</h2>
              <p className="break-all text-xs text-subtle mt-0.5 font-mono">{pool.uuid}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={openJoinDialog}
                disabled={Boolean(poolJoinBlocked)}
                title={poolJoinBlocked ?? undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
              >
                <Plus className="w-4 h-4" />
                添加主机
              </button>
              <button
                disabled
                title={poolTransferBlocked}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary text-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowRightLeft className="w-4 h-4" />
                转移主节点
              </button>
            </div>
          </div>

          {/* Hosts table */}
          <div>
            <h3 className="text-sm font-medium text-secondary-foreground mb-2">池中主机 ({poolHosts.length})</h3>
            {poolHosts.length === 0 ? (
              <div className="text-center py-8 text-subtle text-sm">
                <Server className="w-8 h-8 text-subtle mx-auto mb-2" />
                没有主机
              </div>
            ) : (
              <div className="space-y-2">
                {poolHosts.map((host) => (
                  <div
                    key={host.ref}
                    className="bg-muted border border-input rounded-lg p-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Server className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="break-words text-sm text-foreground">{host.name_label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            host.enabled ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
                          }`}>
                            {host.enabled ? '启用' : '禁用'}
                          </span>
                          <span className="text-xs text-subtle">{host.address}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => openEjectDialog(host.ref, host.name_label)}
                      disabled={Boolean(poolEjectBlocked) || poolHosts.length <= 1}
                      title={poolEjectBlocked ?? undefined}
                      className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs bg-danger-soft hover:bg-danger-soft text-danger rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <LogOut className="w-3 h-3" />
                      移出
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No pool selected */}
      {!poolId && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Server className="w-10 h-10 text-subtle mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">请先连接到资源池</p>
        </div>
      )}

      {/* ===== Join Dialog ===== */}
      {joinDialogOpen && !poolJoinBlocked && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-input rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">添加主机到资源池</h2>
            <p className="text-sm text-muted-foreground">主机将被重新初始化。</p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">目标主机地址 *</label>
                <input
                  type="text"
                  value={joinParams.targetHost}
                  onChange={(e) => setJoinParam('targetHost', e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">用户名 *</label>
                <input
                  type="text"
                  value={joinParams.username}
                  onChange={(e) => setJoinParam('username', e.target.value)}
                  placeholder="root"
                  className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">密码 *</label>
                <input
                  type="password"
                  value={joinParams.password}
                  onChange={(e) => setJoinParam('password', e.target.value)}
                  placeholder="密码"
                  className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Master 地址</label>
                <input
                  type="text"
                  value={joinParams.masterAddress}
                  onChange={(e) => setJoinParam('masterAddress', e.target.value)}
                  placeholder="自动检测"
                  className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={joinParams.forceJoin}
                  onChange={(e) => setJoinParam('forceJoin', e.target.checked)}
                  className="w-4 h-4 rounded border-input bg-muted text-accent-foreground focus:ring-primary"
                />
                <label className="text-xs text-muted-foreground">强制加入（忽略兼容性检查）</label>
              </div>
            </div>

            {/* Validation result */}
            {joinValidationResult && (
              <div className={`p-2 rounded text-xs flex items-center gap-2 ${
                joinValidationResult.valid
                  ? 'bg-success-soft text-success'
                  : 'bg-danger-soft text-danger'
              }`}>
                {joinValidationResult.valid ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                {joinValidationResult.valid ? '验证通过' : joinValidationResult.error}
              </div>
            )}

            {joinError && (
              <div className="p-2 rounded text-xs bg-danger-soft text-danger flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {joinError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { closeJoinDialog(); resetJoinState() }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => validateJoinHost(poolId)}
                disabled={joinValidating || !joinParams.targetHost}
                className="px-4 py-2 text-sm bg-secondary hover:bg-secondary text-foreground rounded-lg transition-colors disabled:opacity-50"
              >
                {joinValidating ? '检查中...' : '检查表单'}
              </button>
              <button
                onClick={handleJoin}
                disabled={joinValidating || !joinParams.targetHost || !joinParams.username}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors disabled:opacity-50"
              >
                加入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Eject Dialog ===== */}
      {ejectDialogOpen && !poolEjectBlocked && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-input rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">移出主机</h2>
            <p className="text-sm text-muted-foreground">
              将主机 <span className="text-foreground font-medium">{ejectHostName}</span> 从资源池中移出。
              请先进入维护模式并确认所有 VM 已迁出。
            </p>

            <div className="p-3 bg-warning-soft border border-warning/20 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-xs text-warning">
                <p className="font-medium">警告</p>
                <p className="mt-1">此操作将重新初始化该主机。主机上的本地存储数据将丢失。</p>
              </div>
            </div>

            {ejectError && (
              <div className="p-2 rounded text-xs bg-danger-soft text-danger flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {ejectError}
              </div>
            )}

            {ejectTaskRef && (
              <div className="p-3 rounded text-xs space-y-1 bg-accent text-accent-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span className="font-medium">移出任务已提交</span>
                </div>
                <p className="break-all">资源池任务: {ejectTaskRef}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { closeEjectDialog(); resetEjectState() }}
                disabled={ejectEvacuating}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {ejectTaskRef ? '关闭' : '取消'}
              </button>
              {!ejectTaskRef && (
                <button
                  onClick={handleEject}
                  disabled={ejectEvacuating}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-danger-solid hover:bg-danger-solid text-on-solid rounded-lg transition-colors disabled:opacity-50"
                >
                  {ejectEvacuating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      移出中...
                    </>
                  ) : (
                    '确认移出'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Transfer Master Dialog ===== */}
      {transferDialogOpen && !poolTransferBlocked && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-input rounded-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">转移主节点</h2>

            <div className="p-3 bg-warning-soft border border-warning/20 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-xs text-warning">
                <p className="font-medium">注意</p>
                <p className="mt-1">转移期间池可能短暂不可用。请确保所有主机状态正常。</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground mb-1 block">选择新主节点 *</label>
              {transferCandidates.map((candidate) => (
                <label
                  key={candidate.ref}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    transferTarget === candidate.ref
                      ? 'border-primary/30 bg-accent'
                      : 'border-input bg-muted hover:border-input'
                  }`}
                >
                  <input
                    type="radio"
                    name="transferTarget"
                    value={candidate.ref}
                    checked={transferTarget === candidate.ref}
                    onChange={() => setTransferTarget(candidate.ref)}
                    className="w-4 h-4 text-accent-foreground focus:ring-primary"
                  />
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">{candidate.name}</span>
                  </div>
                </label>
              ))}
            </div>

            {transferError && (
              <div className="p-2 rounded text-xs bg-danger-soft text-danger flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {transferError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { closeTransferDialog(); resetTransferState(); setTransferTarget('') }}
                disabled={transferring}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleTransfer}
                disabled={transferring || !transferTarget}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors disabled:opacity-50"
              >
                {transferring ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    转移中...
                  </>
                ) : (
                  '确认转移'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
