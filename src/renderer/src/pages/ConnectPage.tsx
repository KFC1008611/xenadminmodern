/**
 * ConnectPage — server list screen shown on launch.
 * Lists all saved connection profiles with one-click connect.
 * Inline password input for profiles without a saved keychain entry.
 * Add Server opens an overlay dialog; no separate "save?" prompt.
 *
 * UX Architecture Redesign:
 * - Uses multiDataStore.refreshAll (not data.store)
 * - Uses connectionStore.syncFromManager() instead of manual setConnected/setPoolInfo
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Plus, Monitor } from 'lucide-react'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { useMultiDataStore } from '../store/multiData.store'
import type { ConnectionProfile } from '../types/xapi'
import { AddServerDialog } from '../components/connection/AddServerDialog'
import { SavedServerCards, type ConnectingState } from '../components/connection/SavedServerCards'
import { SettingsLink } from '../components/layout/SettingsLink'
import { AppearanceMenu } from '../components/layout/AppearanceMenu'
import { TaskCenter } from '../components/layout/TaskCenter'
import { FeedbackOverlay } from '../components/feedback/FeedbackOverlay'
import { ReconnectConnection } from '../components/connection/ReconnectConnection'

export default function ConnectPage() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [hasSavedPassword, setHasSavedPassword] = useState<Record<string, boolean>>({})
  const [connecting, setConnecting] = useState<ConnectingState | null>(null)
  const [inlinePassword, setInlinePassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const connectionError = useConnectionManagerStore((s) => s.error)
  const connections = useConnectionManagerStore((s) => s.connections)
  const unsavedConnections = connections.filter((connection) => connection.state !== 'connected' && !profiles.some((profile) => profile.id === connection.id))
  const isConnecting = useConnectionManagerStore((s) => s.isLoading)
  const visibleError = error || connectionError
  const connectProfile = useConnectionManagerStore((s) => s.connectProfile)
  const refreshAll = useMultiDataStore((s) => s.refreshAll)

  const goToConnectedWorkspace = useCallback(() => {
    navigate('/vms', { replace: true })
  }, [navigate])

  // Check local encrypted entries without unlocking the system credential store.
  useEffect(() => {
    if (!window.xapi?.profiles) return
    ;(async () => {
      try {
        const list = await window.xapi.profiles.list()
        setProfiles(list)
        // Check which profiles have saved passwords
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
        setError(failure?.message || '无法读取已保存服务器')
      }
    })()
  }, [])

  const refreshProfiles = useCallback(async () => {
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
      setError(failure?.message || '无法读取或更新已保存服务器')
    }
  }, [])

  const handleConnect = async (profile: ConnectionProfile, password?: string) => {
    setConnecting({ profileId: profile.id, passwordNeeded: false })
    setError(null)
    try {
      await connectProfile(profile.id, password)
      await refreshAll()
      // syncFromManager will derive poolName/host from connectionManagerStore
      goToConnectedWorkspace()
    } catch (e: any) {
      setError(e?.faultString || e?.message || '连接失败')
      setConnecting(['SAVED_PASSWORD_UNAVAILABLE', 'SESSION_AUTHENTICATION_FAILED'].includes(e?.code)
        ? { profileId: profile.id, passwordNeeded: true } : null)
    }
  }

  const handleCardConnect = async (profile: ConnectionProfile) => {
    const hasPassword = hasSavedPassword[profile.id]
    if (hasPassword) {
      // Password in keychain — connect immediately
      await handleConnect(profile)
    } else {
      // Need password — show inline input
      setConnecting({ profileId: profile.id, passwordNeeded: true })
      setInlinePassword('')
      setError(null)
    }
  }

  const handleInlinePasswordSubmit = async (profile: ConnectionProfile) => {
    if (!inlinePassword) return
    await handleConnect(profile, inlinePassword)
  }

  const handleDelete = async (profile: ConnectionProfile) => {
    setDeletingId(profile.id)
    try {
      if (window.xapi?.profiles) {
        await window.xapi.profiles.delete(profile.id)
      }
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id))
      setHasSavedPassword((prev) => {
        const next = { ...prev }
        delete next[profile.id]
        return next
      })
    } catch (failure: any) {
      setError(failure?.message || '无法读取或更新已保存服务器')
    } finally {
      setDeletingId(null)
    }
  }

  const handleAddSuccess = async () => {
    // Profile was already saved by AddServerDialog; refresh our list
    await refreshProfiles()
    goToConnectedWorkspace()
  }

  const handleEditSuccess = async (profile: ConnectionProfile, password: string | null) => {
    await refreshProfiles()
    if (password !== null) {
      setHasSavedPassword((prev) => ({ ...prev, [profile.id]: !!password }))
    }
    setEditingProfile(null)
  }

  return (
    <div className="relative min-h-screen bg-background flex flex-col items-center justify-center p-6 pt-[var(--window-top-offset)]">
      <div className="app-drag-region absolute top-0 left-0 right-0 h-[var(--window-top-offset)]" />
      <header className="app-drag-region absolute inset-x-0 top-[var(--window-top-offset)] z-[45] flex h-14 items-center justify-end gap-2 border-b border-border bg-card px-6">
        <TaskCenter />
        <SettingsLink />
        <AppearanceMenu />
      </header>
      <FeedbackOverlay />
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent mb-4">
            <Monitor className="w-6 h-6 text-accent-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">XCP-ng Center</h1>
        </div>

        {isConnecting && <p role="status" className="mb-3 text-sm text-muted-foreground">正在连接服务器；读取保存密码时，系统可能请求钥匙串授权…</p>}
        {/* Server List */}
        {unsavedConnections.length > 0 && <section aria-label="未连接的服务器" className="mb-4 space-y-2">
          {unsavedConnections.map((connection) => <div key={connection.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={connection.host}>{connection.name || connection.host}</p>
              <p className="break-words text-xs text-muted-foreground">{connection.errorMessage || (connection.state === 'connecting' ? '正在连接' : '已断开')}</p></div>
            <ReconnectConnection connection={connection} />
          </div>)}
        </section>}
        {profiles.length > 0 ? (
          <SavedServerCards
            profiles={profiles}
            hasSavedPassword={hasSavedPassword}
            connecting={connecting}
            inlinePassword={inlinePassword}
            deletingId={deletingId}
            emptyTitle="无已保存的服务器"
            emptyDesc=""
            onConnect={(profile) => { void handleCardConnect(profile) }}
            onInlinePasswordChange={setInlinePassword}
            onInlineSubmit={(profile) => { void handleInlinePasswordSubmit(profile) }}
            onInlineCancel={() => {
              setConnecting(null)
              setError(null)
            }}
            onEdit={(profile) => setEditingProfile(profile)}
            onDelete={(profile) => { void handleDelete(profile) }}
          />
        ) : (
          /* Empty state */
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-card border border-border mb-4">
              <Server className="w-8 h-8 text-subtle" />
            </div>
            <p className="text-muted-foreground text-sm">无已保存的服务器</p>
          </div>
        )}

        {/* Error display */}
        {visibleError && (
          <div role="alert" className="mt-3 p-3 bg-danger-soft border border-danger/60 rounded-lg text-danger text-xs">
            {visibleError}
          </div>
        )}

        {/* Add Server button */}
        <button
          onClick={() => setAddDialogOpen(true)}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-input hover:border-primary/50 hover:bg-accent text-muted-foreground hover:text-accent-foreground text-sm font-medium rounded-xl transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          <span>添加服务器</span>
        </button>
      </div>

      {/* Add Server Dialog Overlay */}
      <AddServerDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdded={handleAddSuccess}
      />
      <AddServerDialog
        open={!!editingProfile}
        mode="edit"
        profile={editingProfile}
        onClose={() => setEditingProfile(null)}
        onSaved={(profile, password) => { void handleEditSuccess(profile, password) }}
      />
    </div>
  )
}
