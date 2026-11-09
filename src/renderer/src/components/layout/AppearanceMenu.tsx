import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Moon, Sun } from 'lucide-react'
import { useThemeStore, type Theme } from '../../store/theme.store'

const choices = [
  { value: 'light' as const, label: '浅色', icon: Sun },
  { value: 'dark' as const, label: '深色', icon: Moon },
]

/** Shared top-bar menu, including the disconnected workspace. */
export function AppearanceMenu() {
  const { theme, setTheme } = useThemeStore()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const Icon = theme === 'dark' ? Moon : Sun

  useEffect(() => {
    if (!open) return
    items.current[choices.findIndex((choice) => choice.value === theme)]?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, theme])

  const close = () => { setOpen(false); trigger.current?.focus() }
  const choose = (value: Theme) => { setTheme(value); close() }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex((item) => item === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % choices.length
        : event.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length : null
    if (next !== null) { event.preventDefault(); items.current[next]?.focus() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') close()
  }

  return (
    <div ref={root} className="app-no-drag relative shrink-0">
      <button ref={trigger} type="button" aria-label="外观" aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined} onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <Icon className="h-4 w-4" /><span>外观</span><ChevronDown className="h-3 w-3" />
      </button>
      {open && <div id={menuId} role="menu" aria-label="外观" onKeyDown={onMenuKeyDown}
        className="absolute right-0 top-full z-50 mt-2 w-40 rounded-lg border border-border bg-raised p-1 shadow-lg">
        {choices.map((choice, index) => <button key={choice.value} ref={(node) => { items.current[index] = node }}
          type="button" tabIndex={-1} role="menuitemradio" aria-checked={theme === choice.value} onClick={() => choose(choice.value)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:bg-accent focus-visible:text-accent-foreground">
          <choice.icon className="h-4 w-4" /><span className="flex-1 text-left">{choice.label}</span>
          {theme === choice.value && <Check className="h-3.5 w-3.5 text-accent-foreground" />}
        </button>)}
      </div>}
    </div>
  )
}
