import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Settings } from 'lucide-react'

export function SettingsLink({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const state = await window.xapi.updates.getState()
        if (active) setAvailable(['available', 'downloaded'].includes(state.status))
      } catch { /* The settings page exposes update read errors and retry controls. */ }
      if (active) timer = setTimeout(() => { void poll() }, 5000)
    }
    if (window.xapi?.updates) void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [])

  return <NavLink to="/settings" aria-label={available ? '设置，有可用更新' : '设置'} title={compact ? '设置' : undefined} onClick={onNavigate}
    className={({ isActive }) => `app-no-drag flex h-9 items-center gap-2.5 rounded-md text-[13px] hover:bg-muted ${compact ? 'justify-center' : 'px-3'} ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
    <Settings className="h-4 w-4 shrink-0" />{!compact && <span>设置</span>}
    {available && <span className="text-xs text-accent-foreground">{compact ? '·' : '有更新'}</span>}
  </NavLink>
}
