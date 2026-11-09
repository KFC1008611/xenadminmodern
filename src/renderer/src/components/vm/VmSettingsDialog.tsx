import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'

export const vmSettingsInput = 'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/20 disabled:opacity-50'

export function VmSettingsDialog({ title, description, saving, disabled, error, onClose, onSave, children }: {
  title: string
  description: string
  saving: boolean
  disabled: boolean
  error: string | null
  onClose: () => void
  onSave: () => void
  children: ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
        <Dialog.Content onEscapeKeyDown={(event) => { if (saving) event.preventDefault() }} onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-input bg-card shadow-2xl">
          <form onSubmit={(event) => { event.preventDefault(); if (!disabled && !saving) onSave() }}>
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-foreground">{title}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</Dialog.Description>
              </div>
              <Dialog.Close asChild><button type="button" disabled={saving} aria-label="关闭" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><X className="h-5 w-5" /></button></Dialog.Close>
            </div>
            <fieldset disabled={saving} className="space-y-5 px-6 py-5">{children}</fieldset>
            {error && <p role="alert" className="mx-6 mb-5 rounded-lg border border-danger/25 bg-danger-soft p-3 text-sm leading-relaxed text-danger">{error}</p>}
            <div className="flex justify-end gap-3 border-t border-border bg-background px-6 py-4">
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm text-secondary-foreground hover:bg-muted disabled:opacity-40">取消</button>
              <button type="submit" disabled={disabled || saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? '保存中…' : '保存更改'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
