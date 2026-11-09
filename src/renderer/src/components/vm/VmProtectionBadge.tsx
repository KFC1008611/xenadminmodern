/**
 * VmProtectionBadge — Badge indicator showing VM protection status.
 * v9: New badge component for VM protection.
 */
import { Shield, ShieldOff } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useVmAdvancedStore, vmAdvancedKey } from '../../store/vm-advanced.store'
import { useEffect } from 'react'

interface VmProtectionBadgeProps {
  connectionId?: string
  vmRef: string
  showLabel?: boolean
}

export function VmProtectionBadge({ connectionId, vmRef, showLabel = true }: VmProtectionBadgeProps) {
  const activeConnectionId = useConnectionManagerStore((s) => s.activeConnectionId)
  const { vmConfigs, loadVmConfig } = useVmAdvancedStore()
  const effectiveConnectionId = connectionId || activeConnectionId || ''
  const config = effectiveConnectionId ? vmConfigs[vmAdvancedKey(effectiveConnectionId, vmRef)] : undefined

  useEffect(() => {
    if (effectiveConnectionId && !config) {
      loadVmConfig(effectiveConnectionId, vmRef)
    }
  }, [effectiveConnectionId, vmRef, config, loadVmConfig])

  if (!config) {
    return null
  }

  if (config.isProtected) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-danger-soft text-danger">
        <Shield className="h-3.5 w-3.5" />
        {showLabel && <span className="text-xs font-medium">已保护</span>}
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-muted-foreground">
      <ShieldOff className="h-3.5 w-3.5" />
      {showLabel && <span className="text-xs">未保护</span>}
    </div>
  )
}
