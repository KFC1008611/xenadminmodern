import { Clock, KeyRound, Loader2, Pencil, Server, Trash2, Wifi } from 'lucide-react'
import type { ConnectionProfile } from '../../types/xapi'

export interface ConnectingState {
  profileId: string
  passwordNeeded: boolean
}

interface SavedServerCardsProps {
  profiles: ConnectionProfile[]
  hasSavedPassword: Record<string, boolean>
  connecting: ConnectingState | null
  inlinePassword: string
  deletingId?: string | null
  disableConnect?: boolean
  emptyTitle?: string
  emptyDesc?: string
  onConnect: (profile: ConnectionProfile) => void
  onInlinePasswordChange: (value: string) => void
  onInlineSubmit: (profile: ConnectionProfile) => void
  onInlineCancel: () => void
  onEdit?: (profile: ConnectionProfile) => void
  onDelete?: (profile: ConnectionProfile) => void
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '从未连接'
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

export function SavedServerCards({
  profiles,
  hasSavedPassword,
  connecting,
  inlinePassword,
  deletingId,
  disableConnect,
  emptyTitle = '暂无可连接服务器',
  emptyDesc = '请手动添加服务器后再连接',
  onConnect,
  onInlinePasswordChange,
  onInlineSubmit,
  onInlineCancel,
  onEdit,
  onDelete,
}: SavedServerCardsProps) {
  if (profiles.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-xl bg-card">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-card border border-border mb-3">
          <Server className="w-6 h-6 text-subtle" />
        </div>
        <p className="text-muted-foreground text-sm">{emptyTitle}</p>
        <p className="text-subtle text-xs mt-1">{emptyDesc}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {profiles.map((profile) => {
        const isConnecting = connecting?.profileId === profile.id
        const needsPassword = isConnecting && connecting.passwordNeeded
        const hasPassword = hasSavedPassword[profile.id] === true
        const isDeleting = deletingId === profile.id

        return (
          <div
            key={profile.id}
            className="group relative bg-card border border-border rounded-xl transition-all duration-200 hover:border-input hover:bg-card"
          >
            <div className="flex items-center gap-4 px-4 py-3.5">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted border border-input flex items-center justify-center">
                <Server className="w-5 h-5 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{profile.name}</span>
                  {!hasPassword && (
                    <KeyRound className="w-3.5 h-3.5 text-warning flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-subtle truncate">
                    {profile.username}@{profile.host}:{profile.port}
                  </span>
                  <span className="text-subtle">·</span>
                  <span className="text-xs text-subtle flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(profile.lastConnected)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onConnect(profile)}
                  disabled={disableConnect || (isConnecting && !needsPassword)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary disabled:bg-primary-hover disabled:cursor-not-allowed text-primary-foreground text-xs font-medium rounded-lg transition-colors"
                >
                  {isConnecting && !needsPassword ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>连接中...</span>
                    </>
                  ) : (
                    <>
                      <Wifi className="w-3.5 h-3.5" />
                      <span>连接</span>
                    </>
                  )}
                </button>

                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(profile)}
                    disabled={!!connecting?.profileId}
                    className="p-1.5 text-muted-foreground hover:text-accent-foreground hover:bg-accent rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
                    aria-label="编辑"
                    title="编辑服务器"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}

                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(profile)}
                    disabled={isDeleting || !!connecting?.profileId}
                    className="p-1.5 text-muted-foreground hover:text-danger hover:bg-danger-soft rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
                    aria-label="删除"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {needsPassword && (
              <div className="px-4 pb-3.5 pt-0">
                <div className="flex gap-2">
                  <input
                    type="password"
                    aria-label={`${profile.name} 的密码`}
                    value={inlinePassword}
                    onChange={(e) => onInlinePasswordChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        onInlineSubmit(profile)
                      }
                      if (e.key === 'Escape') {
                        onInlineCancel()
                      }
                    }}
                    placeholder="输入密码"
                    autoFocus
                    className="flex-1 px-3 py-1.5 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => onInlineSubmit(profile)}
                    disabled={!inlinePassword}
                    className="px-3 py-1.5 bg-primary hover:bg-primary disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground text-xs font-medium rounded-lg transition-colors"
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    onClick={onInlineCancel}
                    className="px-2 py-1.5 text-subtle hover:text-secondary-foreground text-xs rounded-lg transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
