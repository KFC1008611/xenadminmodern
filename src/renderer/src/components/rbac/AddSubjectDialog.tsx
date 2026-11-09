/**
 * AddSubjectDialog - Dialog for adding a user/group with role assignment.
 * v9: Rewritten to use Tailwind CSS + Radix Dialog.
 */
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Check } from 'lucide-react'
import { useRbacStore } from '../../store/rbac.store'
import { feedback } from '../../store/feedback.store'

interface AddSubjectDialogProps {
  connectionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function AddSubjectDialog({ connectionId, open, onOpenChange, onSuccess }: AddSubjectDialogProps) {
  const { roles, loadRoles, addSubject } = useRbacStore()

  const [subjectIdentifier, setSubjectIdentifier] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      if (connectionId) {
        loadRoles(connectionId)
      }
      setSubjectIdentifier('')
      setSelectedRoles([])
    }
  }, [connectionId, loadRoles, open])

  const handleSubmit = async () => {
    if (!subjectIdentifier.trim()) {
      feedback.error('请输入用户或组标识符')
      return
    }

    if (selectedRoles.length === 0) {
      feedback.error('请至少选择一个角色')
      return
    }

    setSubmitting(true)
    try {
      await addSubject({
        subjectIdentifier,
        roles: selectedRoles,
      }, connectionId)
      feedback.success('用户/组添加成功')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      feedback.error(err.message || '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleRole = (roleRef: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleRef)
        ? prev.filter((r) => r !== roleRef)
        : [...prev, roleRef]
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl z-50 focus:outline-none max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-foreground">添加用户/组</Dialog.Title>
            <Dialog.Close className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* Subject identifier */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">用户或组标识符</label>
              <input
                value={subjectIdentifier}
                onChange={(e) => setSubjectIdentifier(e.target.value)}
                placeholder="例如: DOMAIN\username 或 user@example.com"
                className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-xs text-subtle mt-1">
                Active Directory 用户/组的 SID 或 UPN
              </p>
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
                      onClick={() => toggleRole(role.ref)}
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
                <p className="text-sm font-medium text-foreground mb-2">已选择 {selectedRoles.length} 个角色:</p>
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
              onClick={handleSubmit}
              disabled={submitting || !connectionId || !subjectIdentifier || selectedRoles.length === 0}
              className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
            >
              {submitting ? '添加中...' : '添加'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
