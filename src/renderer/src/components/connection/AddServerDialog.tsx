/**
 * AddServerDialog — overlay dialog for adding a new XCP-ng/XenServer connection.
 * On successful connect, the profile is auto-saved (no separate "save?" prompt).
 * The main process encrypts saved passwords with Electron safeStorage.
 *
 * UX Architecture Redesign:
 * - Uses multiDataStore.refreshAll (not data.store)
 * - Uses connectionStore.syncFromManager() instead of manual setConnected/setPoolInfo
 */
import { useEffect, useId, useState } from 'react'
import { DesktopDialog } from '../layout/DesktopDialog'
import { X, Loader2, Save, Wifi, Eye, EyeOff, Plus } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useConnectionStore } from '../../store/connection.store'
import { useMultiDataStore } from '../../store/multiData.store'
import type {
  ConnectionProfile,
  XapiConnectionOptions,
  XapiTransportScheme,
} from '../../types/xapi'

interface AddServerDialogProps {
  open: boolean
  onClose: () => void
  mode?: 'add' | 'edit'
  profile?: ConnectionProfile | null
  onAdded?: (profile: ConnectionProfile, password: string) => void
  onSaved?: (profile: ConnectionProfile, password: string | null) => void
}

export function AddServerDialog({
  open,
  onClose,
  mode = 'add',
  profile,
  onAdded,
  onSaved,
}: AddServerDialogProps) {
  const fieldId = useId()
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('443')
  const [scheme, setScheme] = useState<XapiTransportScheme>('https:')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [allowSelfSigned, setAllowSelfSigned] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useConnectionManagerStore((s) => s.connect)
  const refreshAll = useMultiDataStore((s) => s.refreshAll)

  const isEdit = mode === 'edit' && !!profile

  useEffect(() => {
    if (!open) return
    if (isEdit && profile) {
      setName(profile.name)
      setHost(profile.host)
      setPort(String(profile.port))
      setScheme(profile.scheme)
      setUsername(profile.username)
      setPassword('')
      setAllowSelfSigned(profile.allowSelfSigned ?? true)
      setShowPassword(false)
      setError(null)
      return
    }

    setName('')
    setHost('')
    setPort('443')
    setScheme('https:')
    setUsername('root')
    setPassword('')
    setAllowSelfSigned(true)
    setShowPassword(false)
    setError(null)
  }, [open, isEdit, profile])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const parsedPort = parseInt(port, 10)
    const opts: XapiConnectionOptions & { name?: string } = {
      host: host.trim(),
      port: parsedPort,
      scheme,
      username: username.trim(),
      password,
      allowSelfSigned,
      ...(name.trim() ? { name: name.trim() } : { name: host.trim() }),
    }

    try {
      if (isEdit && profile && window.xapi?.profiles) {
        const updated: ConnectionProfile = {
          ...profile,
          name: opts.name || opts.host,
          host: opts.host,
          port: parsedPort,
          scheme,
          username: opts.username,
          allowSelfSigned,
        }
        await window.xapi.profiles.save(updated, password || null)
        onSaved?.(updated, password || null)
        handleClose()
        return
      }

      await connect(opts)
      await refreshAll()

      // Sync legacy connection.store — refreshAll already calls syncFromManager,
      // but we call it again explicitly for safety.
      useConnectionStore.getState().syncFromManager()

      // Auto-save profile — no confirm dialog.
      if (window.xapi?.profiles) {
        const now = new Date().toISOString()
        const profile: ConnectionProfile = {
          id: crypto.randomUUID(),
          name: opts.name || opts.host,
          host: opts.host,
          port: opts.port,
          scheme,
          username: opts.username,
          lastConnected: now,
          allowSelfSigned,
        }
        await window.xapi.profiles.save(profile, password)
        onAdded?.(profile, password)
      }

      handleClose()
    } catch (err: any) {
      setError(err?.faultString || err?.message || '连接失败，请检查主机地址和凭据')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setName('')
    setHost('')
    setPort('443')
    setScheme('https:')
    setUsername('root')
    setPassword('')
    setAllowSelfSigned(true)
    setShowPassword(false)
    setError(null)
    onClose()
  }

  return (
    <DesktopDialog title={isEdit ? '编辑服务器' : '添加服务器'} onClose={handleClose} busy={loading} className="max-w-md">
      <div className="w-full max-w-md rounded-xl border border-input bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent border border-primary/30 flex items-center justify-center">
              <Plus className="w-4 h-4 text-accent-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{isEdit ? '编辑服务器' : '添加服务器'}</h2>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-1.5 text-subtle hover:text-secondary-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor={`${fieldId}-name`} className="block text-xs font-medium text-muted-foreground mb-1.5">
              显示名称 <span className="text-subtle font-normal">(可选)</span>
            </label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="生产环境"
              disabled={loading}
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem]">
            <div className="flex-1">
              <label htmlFor={`${fieldId}-host`} className="block text-xs font-medium text-muted-foreground mb-1.5">
                主机地址 <span className="text-danger">*</span>
              </label>
              <input
                id={`${fieldId}-host`}
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                required
                disabled={loading}
                autoFocus
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-scheme`} className="block text-xs font-medium text-muted-foreground mb-1.5">
                协议
              </label>
              <select
                id={`${fieldId}-scheme`}
                aria-label="协议"
                value={scheme}
                onChange={(e) => setScheme(e.target.value as XapiTransportScheme)}
                disabled={loading}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                <option value="https:">HTTPS</option>
                <option value="http:">HTTP</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-port`} className="block text-xs font-medium text-muted-foreground mb-1.5">
                端口
              </label>
              <input
                id={`${fieldId}-port`}
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
                min={1}
                max={65535}
                disabled={loading}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-username`} className="block text-xs font-medium text-muted-foreground mb-1.5">
              用户名 <span className="text-danger">*</span>
            </label>
            <input
              id={`${fieldId}-username`}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-password`} className="block text-xs font-medium text-muted-foreground mb-1.5">
              密码 {!isEdit && <span className="text-danger">*</span>}
            </label>
            <div className="relative">
              <input
                id={`${fieldId}-password`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!isEdit}
                placeholder={isEdit ? '留空则保留原密码' : undefined}
                disabled={loading}
                className="w-full px-3 py-2 pr-10 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-secondary-foreground transition-colors disabled:opacity-40"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {scheme === 'https:' && <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={allowSelfSigned} onChange={(event) => setAllowSelfSigned(event.target.checked)} disabled={loading} className="h-4 w-4 rounded accent-primary" />
            <span className="text-sm text-muted-foreground">允许自签名证书</span>
          </label>}

          {error && (
            <div role="alert" className="flex items-start gap-2.5 p-3 bg-danger-soft border border-danger/60 rounded-lg">
              <span className="text-danger text-xs font-bold mt-0.5">!</span>
              <p className="min-w-0 break-words text-sm text-danger">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading || !host.trim() || !username.trim() || (!isEdit && !password)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-primary hover:bg-primary disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isEdit ? '保存中...' : '连接中...'}</span>
                </>
              ) : (
                <>
                  {isEdit ? <Save className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
                  <span>{isEdit ? '保存' : '连接'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2.5 bg-muted hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed text-secondary-foreground text-sm font-medium rounded-lg transition-colors border border-input"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </DesktopDialog>
  )
}
