import { useEffect, useMemo, useState } from 'react'
import { getConnectionReadIdentity, useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'

export function useHostVmScope(connectionId: string | undefined, hostRef: string | undefined) {
  const srs = useMultiDataStore((state) => state.srs)
  const vms = useMultiDataStore((state) => state.vms)
  const hosts = useMultiDataStore((state) => state.hosts)
  const storageRead = useMultiDataStore((state) => state.domainStates[connectionId || '']?.srs)
  const connections = useConnectionManagerStore((state) => state.connections)
  const connection = connections.find((item) => item.id === connectionId)
  const identity = JSON.stringify([connectionId, connection?.state, connection?.epoch, connection?.connectedAt, connection?.poolUuid])
  const localSrRefs = srs.filter((sr) => sr.connectionId === connectionId && !sr.shared).map((sr) => sr.ref).sort().join('\0')
  const diskRelations = vms.filter((vm) => vm.connectionId === connectionId && vm.power_state !== 'Running' && vm.power_state !== 'Paused')
    .map((vm) => [vm.ref, vm.VBDs]).map((entry) => JSON.stringify(entry)).sort().join('\0')
  const initialStorageLoading = storageRead?.loading && !storageRead.lastSuccessAt
  const scope = JSON.stringify([identity, localSrRefs, diskRelations, storageRead?.lastSuccessAt, storageRead?.error, initialStorageLoading])
  const [storageHosts, setStorageHosts] = useState<{ scope: string; byVbd: Map<string, string> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!hostRef || !connectionId || connection?.state !== 'connected' || initialStorageLoading) return
    setError(null)
    const readIdentity = getConnectionReadIdentity(connectionId)
    const current = () => !cancelled && getConnectionReadIdentity(connectionId) === readIdentity
    const read = async () => {
      if (storageRead?.error) throw new Error(storageRead.error)
      const byVbd = new Map<string, string>()
      if (localSrRefs && diskRelations) {
        const pbds = await window.xapi.pbd.list(connectionId)
        for (const srRef of localSrRefs.split('\0')) {
          const hostRefs = [...new Set(pbds.filter((pbd) => pbd.SR === srRef).map((pbd) => pbd.host))]
          if (hostRefs.length !== 1 || !current()) continue
          const vdis = await window.xapi.storage.listVdis(connectionId, srRef)
          if (!current()) return
          for (const vdi of vdis) for (const vbdRef of vdi.VBDs || []) byVbd.set(vbdRef, hostRefs[0])
        }
      }
      if (current()) setStorageHosts({ scope, byVbd })
    }
    void read().catch((failure) => { if (current()) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { cancelled = true }
  }, [connectionId, connection?.state, hostRef, scope, localSrRefs, diskRelations, storageRead?.error, initialStorageLoading, revision])

  const refs = useMemo(() => new Set(vms.filter((vm) => {
    if (vm.connectionId !== connectionId || vm.is_a_template || vm.is_a_snapshot || vm.is_control_domain) return false
    if (vm.power_state === 'Running' || vm.power_state === 'Paused') return vm.resident_on === hostRef
    if (storageRead?.error || storageHosts?.scope !== scope) return false
    // XenAdmin places stopped VMs under local storage first, then their preferred host.
    const storageHost = vm.VBDs?.map((ref) => storageHosts.byVbd.get(ref)).find(Boolean)
    const home = storageHost || vm.affinity
    return home === hostRef && hosts.some((host) => host.connectionId === connectionId && host.ref === home)
  }).map((vm) => vm.ref)), [vms, hosts, connectionId, hostRef, scope, storageHosts, storageRead?.error])

  const retry = () => {
    if (storageRead?.error && connectionId) void useMultiDataStore.getState().refreshSrs({ connectionId })
    setRevision((value) => value + 1)
  }
  return { refs, error, loading: !!hostRef && connection?.state === 'connected' && storageHosts?.scope !== scope && !error, retry }
}
