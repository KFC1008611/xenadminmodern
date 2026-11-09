/**
 * RbacPage — user and role management page with RBAC controls.
 * v9: New page for RBAC user/permission management.
 */
import { useEffect, useMemo, useState } from 'react'
import { Shield } from 'lucide-react'
import { RbacUserManager } from '../components/rbac/RbacUserManager'
import { AddSubjectDialog } from '../components/rbac/AddSubjectDialog'
import { EditSubjectRolesDialog } from '../components/rbac/EditSubjectRolesDialog'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import type { SubjectWithRoles } from '../store/rbac.store'

export default function RbacPage() {
  const connections = useConnectionManagerStore((s) => s.connections)
  const activeConnectionId = useConnectionManagerStore((s) => s.activeConnectionId)
  const connectedConnections = useMemo(
    () => connections.filter((connection) => connection.state === 'connected'),
    [connections],
  )
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editSubject, setEditSubject] = useState<SubjectWithRoles | null>(null)

  useEffect(() => {
    const selectedIsConnected = connectedConnections.some(
      (connection) => connection.id === selectedConnectionId,
    )
    if (selectedIsConnected) return

    const activeConnection = connectedConnections.find(
      (connection) => connection.id === activeConnectionId,
    )
    setSelectedConnectionId(activeConnection?.id || connectedConnections[0]?.id || '')
  }, [activeConnectionId, connectedConnections, selectedConnectionId])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent-foreground" />
            用户与权限
          </h1>
        </div>

        {connectedConnections.length > 0 && (
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="rbac-connection-select" className="text-sm text-muted-foreground">
              资源池
            </label>
            <select
              id="rbac-connection-select"
              aria-label="RBAC 资源池"
              value={selectedConnectionId}
              onChange={(event) => setSelectedConnectionId(event.target.value)}
              className="min-w-0 w-64 max-w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {connectedConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.poolName || connection.name || connection.host || connection.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <RbacUserManager
        connectionId={selectedConnectionId}
        onAddUser={() => setAddDialogOpen(true)}
        onEditRoles={(subject) => setEditSubject(subject)}
      />

      <AddSubjectDialog
        connectionId={selectedConnectionId}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />

      <EditSubjectRolesDialog
        open={!!editSubject}
        onOpenChange={(open) => { if (!open) setEditSubject(null) }}
        connectionId={selectedConnectionId}
        subject={editSubject}
      />
    </div>
  )
}
