import { useEffect, useRef, useState } from 'react'
import type { UpdateState } from '../../../../shared/ipc-contracts/updates'

export function SoftwareUpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const revision = useRef(0)
  const submitting = useRef(false)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const request = revision.current
      try {
        const next = await window.xapi.updates.getState()
        if (active && !submitting.current && request === revision.current) { setState(next); setReadError(null) }
      } catch (failure) {
        if (active && !submitting.current && request === revision.current) setReadError(failure instanceof Error ? failure.message : '无法读取更新状态，请重试')
      }
      if (active) timer = setTimeout(() => { void poll() }, 2000)
    }
    if (window.xapi?.updates) void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [])

  const run = async (operation: () => Promise<UpdateState>) => {
    if (submitting.current) return
    submitting.current = true
    revision.current++
    setBusy(true)
    setError(null)
    setReadError(null)
    try { setState(await operation()) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '更新操作失败，请重试') }
    finally { revision.current++; submitting.current = false; setBusy(false) }
  }
  const working = busy || !!state && ['checking', 'downloading', 'installing'].includes(state.status)
  const buttonClass = 'rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'

  return <section aria-labelledby="software-update-title" aria-busy={busy || undefined}
    className="text-foreground [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
      <div className="space-y-1">
        <h2 id="software-update-title" className="text-base font-medium">软件更新</h2>
        {state && <p className="text-sm tabular-nums text-muted-foreground">
          {state.currentVersion}{state.version && <> → {state.version}</>}
        </p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!state && <button type="button" className={buttonClass} disabled={busy} onClick={() => { void run(() => window.xapi.updates.getState()) }}>重新读取</button>}
        {state && !['available', 'downloading', 'downloaded', 'installing'].includes(state.status) && <button type="button" className={buttonClass} disabled={working || !state.supported} onClick={() => { void run(() => window.xapi.updates.check()) }}>检查更新</button>}
        {state?.status === 'available' && <button type="button" className={buttonClass} disabled={busy} onClick={() => { void run(() => window.xapi.updates.download()) }}>下载更新</button>}
        {state?.status === 'downloaded' && <button type="button" className={buttonClass} disabled={busy} onClick={() => { void run(() => window.xapi.updates.install()) }}>重启并安装</button>}
      </div>
    </div>
    {state && <label className="flex items-center justify-between gap-4 border-t border-border py-4 text-sm">
      自动检查更新
      <input type="checkbox" checked={state.enabled} disabled={busy || state.status === 'installing'} onChange={(event) => { const enabled = event.target.checked; void run(() => window.xapi.updates.setEnabled(enabled)) }} />
    </label>}
    {!state && !error && !readError && <p role="status" className="text-sm text-muted-foreground">正在读取…</p>}
    {state?.message && state.status !== 'available' && <p role="status" className="text-sm text-muted-foreground">{state.message}</p>}
    {state?.status === 'downloading' && <div className="mt-3 flex items-center gap-3">
      <progress aria-label="更新下载进度" max={100} value={state.progress} className="min-w-0 flex-1" />
      <span className="text-sm tabular-nums text-muted-foreground">{Math.floor(state.progress)}%</span>
    </div>}
    {state?.status === 'downloaded' && <p className="text-sm text-muted-foreground">请先保存编辑内容并完成任务，安装时将断开连接。</p>}
    {(error || readError) && <p role="alert" className="mt-3 text-sm text-danger">{error || readError}</p>}
  </section>
}
