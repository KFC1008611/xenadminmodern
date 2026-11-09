import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { ConnectionInfo } from '../../types/xapi'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { DesktopDialog } from '../layout/DesktopDialog'

export function ReconnectConnection({ connection, compact = false }: { connection: ConnectionInfo; compact?: boolean }) {
  const reconnect = useConnectionManagerStore((state) => state.reconnect)
  const pending = useConnectionManagerStore((state) => state.reconnectingIds.includes(connection.id))
  const busy = pending || connection.state === 'connecting'
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const name = connection.poolName || connection.name || connection.host
  const run = async () => {
    try {
      await reconnect(connection.id, password || undefined)
      setPassword('')
      setError('')
    } catch (failure: any) {
      setPassword('')
      setError(failure?.message || '重新连接失败')
    }
  }
  const close = () => { if (!busy) { setPassword(''); setError('') } }
  return <>
    <button type="button" disabled={busy} aria-label={`${busy ? '正在连接' : '重新连接'} ${name}`}
      title={connection.errorMessage || `${busy ? '正在连接' : '重新连接'} ${name}`}
      onClick={() => { void run() }}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg p-2 text-xs text-accent-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-50 ${compact ? 'h-9 w-9' : ''}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {!compact && (busy ? '正在连接…' : '重新连接')}
    </button>
    <DesktopDialog open={!!error} title={`重新连接 ${name}`} onClose={close} busy={busy}>
      <form className="space-y-4 rounded-xl border border-input bg-card p-5" onSubmit={(event) => { event.preventDefault(); if (!busy) void run() }}>
        <h2 className="break-words text-base font-semibold">重新连接 {name}</h2>
        <p className="break-all text-sm text-muted-foreground">{connection.host}</p>
        <p role="alert" className="break-words text-sm text-danger">{error}</p>
        <label className="block space-y-1 text-sm">密码（需要更换时填写）
          <input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)}
            className="block w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-primary disabled:opacity-50" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">取消</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? '正在连接…' : '重新连接'}</button>
        </div>
      </form>
    </DesktopDialog>
  </>
}
