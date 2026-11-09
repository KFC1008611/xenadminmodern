/**
 * EditSubjectRolesDialog - Dialog for editing a subject's role assignments.
 * v9: Rewritten to use Tailwind CSS + Radix Dialog.
 */
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Check } from 'lucide-react'
import { useRbacStore } from '../../store/rbac.store'
import type { SubjectWithRoles } from '../../store/rbac.store'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

interface EditSubjectRolesDialogProps {
  connectionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: SubjectWithRoles | null
  onSuccess?: () => void
}

export function EditSubjectRolesDialog({
  connectionId,
  open,
  onOpenChange,
  subject,
}: EditSubjectRolesDialogProps) {
  const { roles, loadRoles } = useRbacStore()
  const guardReason = getAuditedFeatureBlockReason('rbac.management')

  const [selectedRoles, setSelectedRoles] = useState<string[]>([])

  useEffect(() => {
    if (open && subject) {
      if (connectionId) {
        loadRoles(connectionId)
      }
      setSelectedRoles(subject.subject.roles || [])
    }
  }, [connectionId, loadRoles, open, subject])

  if (!subject) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl z-50 focus:outline-none max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              编辑角色: {subject.subject.subject_identifier}
            </Dialog.Title>
            <Dialog.Close className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-6">
            <Dialog.Description className="text-sm text-warning">
              {guardReason}
            </Dialog.Description>
            {/* Current permissions */}
            <div className="bg-muted border border-input rounded-lg p-3">
              <p className="text-sm font-medium text-foreground mb-2">当前权限: {subject.allPermissions.length} 个</p>
              <div className="flex flex-wrap gap-1">
                {subject.roleNames.map((name, idx) => (
                  <span key={idx} className="text-xs px-2 py-0.5 bg-muted text-secondary-foreground border border-input rounded-md">
                    {name}
                  </span>
                ))}
              </div>
            </div>

            {/* Role selection */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">分配角色</label>
              {roles.length === 0 ? (
                <p className="text-sm text-subtle">加载角色列表中...</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {roles.map((role) => (
                    <div
                      key={role.ref}
                      className={`cursor-pointer border rounded-lg p-3 flex items-start gap-3 transition-colors ${
                        selectedRoles.includes(role.ref)
                          ? 'border-primary/30 bg-accent'
                          : 'border-border hover:bg-muted'
                      }`}
                      aria-disabled="true"
                      title={guardReason}
                    >
                      <div className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0 ${
                        selectedRoles.includes(role.ref)
                          ? 'bg-primary border-primary/30'
                          : 'border-input'
                      }`}>
                        {selectedRoles.includes(role.ref) && (
                          <Check className="w-3 h-3 text-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{role.name_label}</p>
                        <p className="text-xs text-subtle mt-0.5">
                          {role.name_description || '无描述'}
                        </p>
                        {role.policies.length > 0 && (
                          <p className="text-xs text-subtle mt-0.5">
                            {role.policies.length} 个权限
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selected summary */}
            {selectedRoles.length > 0 && (
              <div className="bg-muted border border-input rounded-lg p-3">
                <p className="text-sm font-medium text-foreground mb-2">将分配 {selectedRoles.length} 个角色:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedRoles.map((roleRef) => {
                    const role = roles.find((r) => r.ref === roleRef)
                    return (
                      <span key={roleRef} className="text-xs px-2 py-1 bg-accent text-accent-foreground border border-primary/30 rounded-md">
                        {role?.name_label || roleRef}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              disabled
              title={guardReason}
              className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
            >
              保存更改
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
