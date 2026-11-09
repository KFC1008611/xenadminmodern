import { CopyVmDialog } from '../vm/CopyVmDialog'

export function CloneTemplateDialog({ open, onClose, template, onSuccess }: {
  open: boolean
  onClose: () => void
  template: { ref: string; name_label: string; connectionId: string; poolName?: string } | null
  onSuccess: () => void | Promise<void>
}) {
  return <CopyVmDialog open={open} onClose={onClose} vm={template} isTemplate onSuccess={onSuccess} />
}
