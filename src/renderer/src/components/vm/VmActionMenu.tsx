import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, MoreHorizontal } from 'lucide-react'

/** Native disclosure keeps keyboard access and disabled explanations available. */
export function VmActionMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [maxHeight, setMaxHeight] = useState<number>()
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      if (menu.current) setMaxHeight(Math.max(0, window.innerHeight - menu.current.getBoundingClientRect().bottom - 16))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  return (
    <details ref={menu} open={open} className="relative" onKeyDown={(event) => {
      if (event.key !== 'Escape' || !menu.current?.open) return
      event.preventDefault()
      setOpen(false)
      menu.current.querySelector('summary')?.focus()
    }}>
      <summary aria-label="更多操作" onClick={(event) => { event.preventDefault(); setOpen((value) => !value) }} className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-sm text-secondary-foreground hover:bg-muted focus-visible:outline focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <MoreHorizontal className="h-4 w-4" />更多操作<ChevronDown className="h-3.5 w-3.5" />
      </summary>
      <div hidden={!open} style={{ maxHeight }} className="absolute right-0 top-full z-30 mt-2 w-64 overflow-y-auto rounded-xl border border-input bg-card p-2 shadow-xl" onClickCapture={(event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null
        if (!target || target.disabled || !menu.current) return
        setOpen(false)
        // Dialogs restore focus to the visible disclosure after they close.
        menu.current.querySelector('summary')?.focus()
      }}>
        {children}
      </div>
    </details>
  )
}
