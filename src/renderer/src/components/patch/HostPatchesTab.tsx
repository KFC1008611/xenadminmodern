/**
 * HostPatchesTab - Display patch status for a specific host.
 * Shows applied patches and missing patches that need to be applied.
 * v9: New component for host patch management, using Tailwind CSS.
 */
import { useState, useEffect, useRef } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Shield, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react'
import { usePatchStore } from '../../store/patch.store'
import { feedback } from '../../store/feedback.store'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const patchMutationBlocked = getAuditedFeatureBlockReason('patch.mutate')

interface HostPatchesTabProps {
  connectionId: string
  hostRef: string
  hostName: string
}

export function HostPatchesTab({ connectionId, hostRef, hostName }: HostPatchesTabProps) {
  const {
    hostPatchStatus, hostPatchStatusLoading, hostPatchStatusError,
    loadHostPatchStatus,
    getMissingPatches,
    applyPatchToHost,
    loadPatches,
  } = usePatchStore()

  const [missingPatches, setMissingPatches] = useState<any[]>([])
  const requestVersion = useRef(0)
  const [missingError, setMissingError] = useState<string | null>(null)
  const [loadingMissing, setLoadingMissing] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [activeSubTab, setActiveSubTab] = useState('applied')

  useEffect(() => {
    loadHostPatchStatus(connectionId)
    loadMissing()
    return () => { requestVersion.current++ }
  }, [connectionId, hostRef])

  const loadMissing = async () => {
    const version = ++requestVersion.current
    setLoadingMissing(true)
    setMissingError(null)
    setMissingPatches([])
    try {
      const patches = await getMissingPatches(hostRef, connectionId)
      if (version === requestVersion.current) setMissingPatches(patches)
    } catch (err: any) {
      if (version === requestVersion.current) setMissingError(err.message || '获取补丁状态失败')
    } finally {
      if (version === requestVersion.current) setLoadingMissing(false)
    }
  }

  const handleApply = async (patchRef: string) => {
    setApplying(patchRef)
    try {
      await applyPatchToHost(hostRef, patchRef, connectionId)
      feedback.success('补丁应用成功')
      await loadMissing()
      await loadHostPatchStatus(connectionId)
      await loadPatches(connectionId)
    } catch (err: any) {
      feedback.error(err.message || '应用补丁失败')
    } finally {
      setApplying(null)
    }
  }

  // Filter patches for this host
  const appliedPatches = hostPatchStatus.filter((s) => s.hostRef === hostRef && s.applied)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent-foreground" />
          {hostName} — 补丁状态
        </h3>
      </div>

      <p className="text-xs text-muted-foreground">此列表来自旧版 pool_patch 清单，不包含软件仓库中的全部系统更新。</p>
      <Tabs.Root value={activeSubTab} onValueChange={setActiveSubTab}>
        <div className="mb-4 overflow-x-auto border-b border-border">
          <Tabs.List className="flex min-w-max gap-1">
            <Tabs.Trigger
              value="applied"
              className="relative shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t-lg after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
            >
              <ShieldCheck className="w-3.5 h-3.5 inline mr-1.5" />
              已应用 ({appliedPatches.length})
            </Tabs.Trigger>
            <Tabs.Trigger
              value="missing"
              className="relative shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t-lg after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
            >
              <ShieldAlert className="w-3.5 h-3.5 inline mr-1.5" />
              缺失 ({missingPatches.length})
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* Applied patches */}
        <Tabs.Content value="applied" className="outline-none space-y-2">
          {hostPatchStatusError ? <p role="alert" className="text-sm text-danger">{hostPatchStatusError}</p> : hostPatchStatusLoading ? <p className="text-sm text-muted-foreground">加载中...</p> : appliedPatches.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <ShieldCheck className="w-8 h-8 text-subtle mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{hostName} 没有已应用的补丁</p>
            </div>
          ) : (
            appliedPatches.map((status) => (
              <div
                key={status.patchRef}
                className="bg-card border border-border rounded-xl p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{status.patchName}</p>
                  <p className="text-xs text-subtle mt-0.5">
                    补丁引用: {status.patchRef}
                  </p>
                </div>
                <span className="text-xs px-2.5 py-1 bg-success-soft text-success border border-success/30 rounded-md font-medium">
                  已应用
                </span>
              </div>
            ))
          )}
        </Tabs.Content>

        {/* Missing patches */}
        <Tabs.Content value="missing" className="outline-none space-y-2">
          {missingError ? <p role="alert" className="text-sm text-danger">{missingError}</p> : loadingMissing ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <Loader2 className="w-6 h-6 text-accent-foreground animate-spin mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">加载缺失补丁列表...</p>
            </div>
          ) : missingPatches.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <ShieldCheck className="w-8 h-8 text-success mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{hostName} 没有未应用的已上传旧版补丁</p>
            </div>
          ) : (
            missingPatches.map((patch) => (
              <div
                key={patch.ref}
                className="bg-card border border-border rounded-xl p-4 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{patch.name_label}</p>
                    <span className="text-xs px-2 py-0.5 bg-warning-soft text-warning border border-warning/30 rounded-md">
                      未应用
                    </span>
                  </div>
                  <p className="text-xs text-subtle mt-1">
                    版本: {patch.version} | 大小: {(patch.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                  {patch.after_apply_guides?.length > 0 && (
                    <p className="text-xs text-warning mt-1">
                      ⚠ 应用后需要执行后续操作
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleApply(patch.ref)}
                  disabled={Boolean(patchMutationBlocked) || applying === patch.ref}
                  title={patchMutationBlocked ?? undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors shrink-0"
                >
                  {applying === patch.ref ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      应用中...
                    </>
                  ) : (
                    '应用到此主机'
                  )}
                </button>
              </div>
            ))
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
