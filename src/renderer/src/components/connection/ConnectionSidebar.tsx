/**
 * ConnectionSidebar — sidebar section showing all XAPI connections.
 * v4: Multi-connection management UI.
 */
import { useState } from 'react'
import { Plus, Power, RefreshCw, Trash2, MoreVertical } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { ConnectionStatusBadge } from './ConnectionStatusBadge'
import { RememberedServerDialog } from './RememberedServerDialog'
import type { ConnectionInfo } from '../../types/xapi'

export function ConnectionSidebar() {
  const connections = useConnectionManagerStore((s) => s.connections)
  const activeConnectionId = useConnectionManagerStore((s) => s.activeConnectionId)
  const setActiveConnection = useConnectionManagerStore((s) => s.setActiveConnection)
  const disconnect = useConnectionManagerStore((s) => s.disconnect)
  const reconnect = useConnectionManagerStore((s) => s.reconnect)
  const removeConnection = useConnectionManagerStore((s) => s.removeConnection)

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const handleDisconnect = async (conn: ConnectionInfo) => {
    if (conn.state === 'connected') {
      await disconnect(conn.id)
    }
    setMenuOpen(null)
  }

  const handleReconnect = async (conn: ConnectionInfo) => {
    await reconnect(conn.id)
    setMenuOpen(null)
  }

  const handleRemove = (conn: ConnectionInfo) => {
    removeConnection(conn.id)
    setMenuOpen(null)
  }

  return (
    <>
      <div className="px-3 py-2 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.18em]">
            资源池
          </h3>
          <button
            onClick={() => setShowAddDialog(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="添加连接"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {connections.length === 0 ? (
          <div className="text-xs text-subtle py-3 px-2 border border-border rounded-lg bg-card">
            暂无连接，点击 + 添加
          </div>
        ) : (
          <div className="space-y-1 overflow-y-auto pr-1 min-h-0">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className={`group relative flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                  activeConnectionId === conn.id
                    ? 'bg-muted border border-input'
                    : 'hover:bg-muted border border-transparent'
                }`}
                onClick={() => setActiveConnection(conn.id)}
              >
                <div className="flex-shrink-0">
                  <ConnectionStatusBadge state={conn.state} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">
                    {conn.name || conn.host}
                  </div>
                  {conn.poolName && (
                    <div className="text-xs text-subtle truncate">
                      {conn.poolName}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(menuOpen === conn.id ? null : conn.id)
                    }}
                    className="p-1 text-subtle hover:text-secondary-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {menuOpen === conn.id && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setMenuOpen(null)}
                      />
                      <div className="absolute right-0 top-7 z-50 w-40 bg-card border border-input rounded-lg shadow-xl py-1">
                        {conn.state === 'connected' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDisconnect(conn)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-muted"
                          >
                            <Power className="w-3.5 h-3.5" />
                            断开连接
                          </button>
                        )}
                        {(conn.state === 'disconnected' || conn.state === 'error') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReconnect(conn)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-muted"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            重新连接
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemove(conn)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-muted"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RememberedServerDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConnected={() => setActiveConnection(useConnectionManagerStore.getState().activeConnectionId)}
      />
    </>
  )
}
