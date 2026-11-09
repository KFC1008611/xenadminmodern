import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** Shared modal behavior for desktop workflows, including programmatic triggers. */
export function DesktopDialog({ open = true, title, onClose, busy = false, className, children }: {
  open?: boolean
  title: string
  onClose: () => void
  busy?: boolean
  className?: string
  children: ReactNode
}) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm app-no-drag" />
        <Dialog.Content
          aria-describedby={undefined}
          aria-busy={busy || undefined}
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement | null }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus() }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
          className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-4rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl outline-none app-no-drag', className)}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
