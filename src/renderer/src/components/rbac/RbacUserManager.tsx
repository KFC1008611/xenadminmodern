/**
 * RbacUserManager - Manage users/groups and their role assignments.
 * v9: Rewritten to use Tailwind CSS instead of shadcn/ui.
 */
import { useEffect, useState } from 'react'
import { Users, Plus, Edit3, Trash2, Loader2 } from 'lucide-react'
import { useRbacStore } from '../../store/rbac.store'
import type { SubjectWithRoles } from '../../store/rbac.store'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const subjectCreateBlocked = getAuditedFeatureBlockReason('rbac.subject-create')
const subjectMutationBlocked = getAuditedFeatureBlockReason('rbac.management')

interface RbacUserManagerProps {
  connectionId: string
  onAddUser?: () => void
  onEditRoles?: (subject: SubjectWithRoles) => void
}

export function RbacUserManager({ connectionId, onAddUser }: RbacUserManagerProps) {
  const {
    subjectsWithRoles,
    subjectsWithRolesLoading, subjectsWithRolesError, getExtAuthConfig,
    loadSubjectsWithRoles,
  } = useRbacStore()

  const [authConfig, setAuthConfig] = useState<Awaited<ReturnType<typeof getExtAuthConfig>>>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    setAuthConfig(null); setAuthError(null)
    getExtAuthConfig(connectionId).then((value) => { if (current) setAuthConfig(value) })
      .catch((error) => { if (current) setAuthError(error.message) })
    return () => { current = false }
  }, [connectionId, getExtAuthConfig])

  useEffect(() => {
    if (connectionId) {
      loadSubjectsWithRoles(connectionId)
    }
  }, [connectionId, loadSubjectsWithRoles])

  if (subjectsWithRolesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent-foreground animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">加载用户列表中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-input p-3 text-sm text-secondary-foreground">
        外部认证：{authError ? '读取失败' : !authConfig ? '状态未知' : !authConfig.consistent ? '主机配置不一致' : authConfig.configured ? `${authConfig.type} · ${authConfig.service_name}` : '未配置'}
        {authError && <p role="alert" className="text-danger">{authError}</p>}
        {authConfig?.hosts.map((host) => <p key={host.hostRef} className="mt-1 text-xs text-muted-foreground">{host.hostName}：{host.configured ? `${host.type} · ${host.service_name}` : '未配置'}</p>)}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-accent-foreground" />
            用户和组管理
          </h3>
        </div>
        <button
          onClick={onAddUser}
          disabled={Boolean(subjectCreateBlocked) || !connectionId}
          title={subjectCreateBlocked ?? undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加用户/组
        </button>
      </div>

      {subjectsWithRolesError ? <p role="alert" className="text-sm text-danger">{subjectsWithRolesError}</p> : subjectsWithRoles.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Users className="w-10 h-10 text-subtle mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">没有配置用户/组</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">用户/组</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">类型</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">角色</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">权限数</th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subjectsWithRoles.map(({ subject, roleNames, allPermissions }) => (
                <tr key={subject.ref} className="hover:bg-muted transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-foreground font-medium">{subject.subject_identifier}</p>
                      <p className="text-xs text-subtle">{subject.uuid?.substring(0, 8)}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 bg-muted text-muted-foreground border border-input rounded-md">
                      {subject.other_config['subject-is-group'] === 'true' ? '目录组' : subject.other_config['subject-is-group'] === 'false' ? '目录用户' : '目录主体'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {roleNames.length > 0 ? (
                        roleNames.map((name, idx) => (
                          <span key={idx} className="text-xs px-2 py-0.5 bg-accent text-accent-foreground border border-primary/30 rounded-md">
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-subtle">无角色</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-secondary-foreground">
                    {allPermissions.length}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled
                        className="p-1.5 text-muted-foreground opacity-50 cursor-not-allowed rounded-lg transition-colors"
                        title={subjectMutationBlocked}
                        aria-label={`编辑 ${subject.subject_identifier} 的角色`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled
                        className="p-1.5 text-danger opacity-50 cursor-not-allowed rounded-lg transition-colors"
                        title={subjectMutationBlocked}
                        aria-label={`移除 ${subject.subject_identifier}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
