import { createPortal } from 'react-dom'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export interface ResourceAction {
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  reason?: string
  danger?: boolean
}

/** A portal keeps row actions visible outside horizontally scrolling tables. */
export function ResourceActionMenu({ name, actions, disabled = false }: { name: string; actions: ResourceAction[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 360 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()
  const close = () => { setOpen(false); trigger.current?.focus() }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    const rect = trigger.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const down = below >= Math.min(menu.current.scrollHeight, 300) || below >= above
    const maxHeight = Math.max(0, down ? below : above)
    setPosition({
      top: down ? rect.bottom + 4 : Math.max(8, rect.top - Math.min(menu.current.scrollHeight, maxHeight) - 4),
      left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), maxHeight,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    items.current[0]?.focus()
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.current.findIndex((item) => item === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % actions.length
        : event.key === 'ArrowUp' ? (index + actions.length - 1) % actions.length : null
    if (next !== null) { event.preventDefault(); items.current[next]?.focus() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') close()
  }

  return <>
    <button ref={trigger} type="button" aria-label={`${name} 的更多操作`} title="更多操作" aria-haspopup="menu"
      aria-disabled={disabled || undefined} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!disabled) setOpen((value) => !value) }}
      onKeyDown={(event) => { if (!disabled && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) } }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
      <MoreHorizontal className="h-4 w-4" />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={`${name} 的更多操作`} onKeyDown={onKeyDown}
      style={position} className="app-no-drag fixed z-40 w-56 overflow-y-auto rounded-lg border border-border bg-raised p-1 shadow-lg">
      {actions.map((action, index) => <button key={action.label} ref={(node) => { items.current[index] = node }} type="button"
        role="menuitem" tabIndex={-1} aria-disabled={action.disabled || undefined} title={action.disabled ? action.reason : undefined}
        onClick={() => { if (action.disabled) return; close(); action.onSelect() }}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted ${action.danger ? 'text-danger' : 'text-secondary-foreground'} ${action.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
        <action.icon className="h-4 w-4 shrink-0" /><span>{action.label}</span>
      </button>)}
    </div>, document.body)}
  </>
}
