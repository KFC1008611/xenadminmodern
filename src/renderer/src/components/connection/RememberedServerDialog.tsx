/**
 * RememberedServerDialog — dialog for connecting to saved server profiles.
 * Filters out servers that are already connected.
 *
 * UX Architecture Redesign:
 * - Uses multiDataStore.refreshAll (not data.store)
 * - Uses connectionStore.syncFromManager() instead of manual setConnected/setPoolInfo
 */
import { useEffect, useMemo, useState } from 'react'
import { DesktopDialog } from '../layout/DesktopDialog'
import { Plus, X } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useConnectionStore } from '../../store/connection.store'
import { useMultiDataStore } from '../../store/multiData.store'
import type { ConnectionProfile } from '../../types/xapi'
import { AddServerDialog } from './AddServerDialog'
import { SavedServerCards, type ConnectingState } from './SavedServerCards'

interface RememberedServerDialogProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

export function RememberedServerDialog({ open, onClose, onConnected }: RememberedServerDialogProps) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [hasSavedPassword, setHasSavedPassword] = useState<Record<string, boolean>>({})
  const [connecting, setConnecting] = useState<ConnectingState | null>(null)
  const [inlinePassword, setInlinePassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [manualDialogOpen, setManualDialogOpen] = useState(false)

  const connectProfile = useConnectionManagerStore((s) => s.connectProfile)
  const connections = useConnectionManagerStore((s) => s.connections)
  const refreshAll = useMultiDataStore((s) => s.refreshAll)

  const connectedHostSet = useMemo(() => {
    return new Set(
      connections
        .filter((c) => c.state === 'connected')
        .map((c) => normalizeHost(c.host))
    )
  }, [connections])

  const visibleProfiles = useMemo(() => {
    return profiles.filter((p) => !connectedHostSet.has(normalizeHost(p.host)))
  }, [profiles, connectedHostSet])

  const loadProfiles = async () => {
    if (!window.xapi?.profiles) return
    try {
      const list = await window.xapi.profiles.list()
      setProfiles(list)
      const pwMap: Record<string, boolean> = {}
      await Promise.all(
        list.map(async (p) => {
          try {
            pwMap[p.id] = await window.xapi.profiles.hasPassword(p.id)
          } catch {
            pwMap[p.id] = false
          }
        })
      )
      setHasSavedPassword(pwMap)
    } catch (failure: any) {
      setError(failure?.message || '无法读取已保存服务器，请关闭后重试')
    }
  }

  useEffect(() => {
    if (!open) return
    void loadProfiles()
  }, [open])

  if (!open) return null

  const connectWithProfile = async (profile: ConnectionProfile, password?: string) => {
    setConnecting({ profileId: profile.id, passwordNeeded: false })
    setError(null)
    try {
      await connectProfile(profile.id, password)
      await refreshAll()
      // syncFromManager is already called by refreshAll, but call explicitly for safety
      useConnectionStore.getState().syncFromManager()

      onConnected?.()
      handleClose()
    } catch (e: any) {
      setError(e?.faultString || e?.message || '连接失败')
      setConnecting(['SAVED_PASSWORD_UNAVAILABLE', 'SESSION_AUTHENTICATION_FAILED'].includes(e?.code)
        ? { profileId: profile.id, passwordNeeded: true } : null)
    }
  }

  const handleCardConnect = async (profile: ConnectionProfile) => {
    const hasPassword = hasSavedPassword[profile.id]
    if (hasPassword) {
      await connectWithProfile(profile)
      return
    }
    setConnecting({ profileId: profile.id, passwordNeeded: true })
    setInlinePassword('')
    setError(null)
  }

  const handleInlinePasswordSubmit = async (profile: ConnectionProfile) => {
    if (!inlinePassword) return
    await connectWithProfile(profile, inlinePassword)
  }

  const handleClose = () => {
    if (connecting?.profileId && !connecting.passwordNeeded) return
    setProfiles([])
    setHasSavedPassword({})
    setConnecting(null)
    setInlinePassword('')
    setError(null)
    onClose()
  }

  return (
    <>
      <DesktopDialog title="连接已保存服务器" onClose={handleClose} busy={!!(connecting?.profileId && !connecting.passwordNeeded)} className="max-w-2xl overflow-hidden">
        <div className="flex max-h-[calc(100dvh-4rem)] flex-col rounded-xl border border-input bg-card shadow-2xl">
          <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold text-foreground">连接已保存服务器</h2>
              <p className="text-xs text-subtle">已过滤当前已连接的服务器</p>
            </div>
            <button
              onClick={handleClose}
              disabled={!!(connecting?.profileId && !connecting.passwordNeeded)}
              className="p-1.5 text-subtle hover:text-secondary-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-40"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto p-6 space-y-4">
            <SavedServerCards
              profiles={visibleProfiles}
              hasSavedPassword={hasSavedPassword}
              connecting={connecting}
              inlinePassword={inlinePassword}
              disableConnect={!!(connecting?.profileId && !connecting.passwordNeeded)}
              emptyTitle={profiles.length ? '已保存服务器均已连接' : '尚未保存服务器'}
              emptyDesc={profiles.length ? '可手动添加其他管理连接' : '手动添加服务器后可在此连接'}
              onConnect={(profile) => { void handleCardConnect(profile) }}
              onInlinePasswordChange={setInlinePassword}
              onInlineSubmit={(profile) => { void handleInlinePasswordSubmit(profile) }}
              onInlineCancel={() => {
                setConnecting(null)
                setError(null)
              }}
            />

            {error && (
              <div className="p-3 bg-danger-soft border border-danger/60 rounded-lg text-danger text-xs">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => setManualDialogOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-input hover:border-primary/50 hover:bg-accent text-muted-foreground hover:text-accent-foreground text-sm font-medium rounded-xl transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              手动添加服务器
            </button>
          </div>
        </div>
      </DesktopDialog>

      <AddServerDialog
        open={manualDialogOpen}
        onClose={() => setManualDialogOpen(false)}
        onAdded={() => {
          void (async () => {
            await loadProfiles()
            setManualDialogOpen(false)
            onConnected?.()
            handleClose()
          })()
        }}
      />
    </>
  )
}
