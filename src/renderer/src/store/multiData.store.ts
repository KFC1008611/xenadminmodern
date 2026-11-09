/**
 * MultiData store — aggregates resource data from ALL connections.
 * v4: Replaces data.store.ts. Each record is tagged with connectionId and poolName.
 *
 * UX Architecture Redesign:
 * - Added `pools` to store (was only in data.store before)
 * - Added `refreshAll` as the unified refresh entry point (replaces data.store.refreshAll)
 * - Added helper to sync legacy connection.store after data refresh
 */
import { create } from 'zustand'
import type {
  ConnectedVmRecord,
  ConnectedHostRecord,
  ConnectedSrRecord,
  ConnectedNetworkRecord,
  ConnectedTaskRecord,
  ConnectedPoolRecord,
  VmChangeEvent,
  VmRecord,
} from '../types/xapi'
import { useConnectionManagerStore } from './connectionManager.store'
import { useConnectionStore } from './connection.store'

// ============================================================================
// Shared multi-connection data fetching utilities
// ============================================================================

const VM_EVENT_RECONCILE_DELAY_MS = 750
const pendingVmReconciles = new Map<string, ReturnType<typeof setTimeout>>()

type ConnectionInfo = { id: string; poolName: string | null; host: string; connectedAt: number | null; epoch?: number; poolUuid?: string }
export type ResourceDomain = 'vms' | 'hosts' | 'srs' | 'networks' | 'tasks' | 'pools'
export interface ResourceRefreshOptions { afterMutation?: boolean; connectionId?: string }
export interface ResourceReadState { loading: boolean; lastSuccessAt: number | null; error: string | null }
const domains: ResourceDomain[] = ['vms', 'hosts', 'srs', 'networks', 'tasks', 'pools']
const labels: Record<ResourceDomain, string> = { vms: '虚拟机', hosts: '主机', srs: '存储', networks: '网络', tasks: '任务', pools: '资源池' }
const requestVersions = new Map<string, number>()
const pendingReads = new Map<string, { identity: string; refreshRequested: boolean; promise: Promise<void> }>()
const knownPoolIdentities = new Map<string, string>()
const requestKey = (id: string, domain: ResourceDomain) => JSON.stringify([id, domain])
const fingerprint = (info: ConnectionInfo) => JSON.stringify([info.connectedAt, info.epoch, info.poolUuid])

function getConnectedInfos(): ConnectionInfo[] {
  return useConnectionManagerStore.getState().connections.filter((c) => c.state === 'connected')
}

function isVisibleVm(record: Partial<VmRecord>): boolean {
  return !record.is_a_template && !record.is_a_snapshot && !record.is_control_domain
}

function getPoolNameForConnection(connectionId: string): string {
  const conn = useConnectionManagerStore.getState().connections.find((c) => c.id === connectionId)
  return conn?.poolName ?? conn?.host ?? connectionId
}

function readDomain(domain: ResourceDomain, id: string): Promise<object[]> {
  switch (domain) {
    case 'vms': return window.xapi.vm.list(id)
    case 'hosts': return window.xapi.host.list(id)
    case 'srs': return window.xapi.storage.listSrs(id)
    case 'networks': return window.xapi.network.list(id)
    case 'tasks': return window.xapi.tasks.list(id)
    case 'pools': return window.xapi.pool.get(id).then((pool) => pool ? [pool] : [])
  }
}

function statusSummary(states: MultiDataStore['domainStates']) {
  const errors: Record<string, string> = {}
  const loadingConnections: string[] = []
  for (const [id, resourceStates] of Object.entries(states)) {
    const failures = domains.flatMap((domain) => resourceStates[domain]?.error ? [`${labels[domain]}：${resourceStates[domain]!.error}`] : [])
    if (failures.length) errors[id] = failures.join('；')
    if (domains.some((domain) => resourceStates[domain]?.loading)) loadingConnections.push(id)
  }
  return { errors, loadingConnections, loading: loadingConnections.length > 0 }
}

function markDomainLoading(connectionId: string, domain: ResourceDomain): void {
  useMultiDataStore.setState((state) => {
    const previous = state.domainStates[connectionId]?.[domain]
    const domainStates = { ...state.domainStates, [connectionId]: { ...state.domainStates[connectionId], [domain]: {
      loading: true, lastSuccessAt: previous?.lastSuccessAt ?? null, error: previous?.error ?? null,
    } } }
    return { domainStates, ...statusSummary(domainStates) }
  })
}

async function refreshDomain(domain: ResourceDomain, infos = getConnectedInfos(), options?: ResourceRefreshOptions): Promise<void> {
  if (options?.connectionId) infos = infos.filter((info) => info.id === options.connectionId)
  await Promise.all(infos.map((info) => {
    const key = requestKey(info.id, domain)
    const identity = fingerprint(info)
    const pending = pendingReads.get(key)
    if (pending?.identity === identity) {
      // A successful write needs a read started after that write. Coalesce
      // those requests into a serial follow-up, never publish the old result.
      if (options?.afterMutation) {
        pending.refreshRequested = true
        markDomainLoading(info.id, domain)
      }
      return pending.promise
    }
    const entry = { identity, refreshRequested: false, promise: Promise.resolve() }
    pendingReads.set(key, entry)
    markDomainLoading(info.id, domain)
    entry.promise = (async () => {
      let reconciliations = 0
      while (pendingReads.get(key) === entry) {
        entry.refreshRequested = false
        const version = (requestVersions.get(key) ?? 0) + 1
        requestVersions.set(key, version)
        let rows: object[] | undefined
        let error: string | null = null
        try { rows = await readDomain(domain, info.id) }
        catch (failure) { error = failure instanceof Error ? failure.message : '读取失败' }
        const current = getConnectedInfos().find((c) => c.id === info.id)
        if (!current || fingerprint(current) !== identity || pendingReads.get(key) !== entry) return
        if (entry.refreshRequested) continue
        if (requestVersions.get(key) !== version) {
          // SR identity readback already applied authoritative data and cleared
          // loading. Only VM events need another serial list reconciliation.
          if (domain !== 'vms') return
          if (reconciliations++ >= 1) {
            // A busy event stream must not hold every joined refresh open.
            // Keep authoritative events and yield before the next list read.
            useMultiDataStore.setState((state) => {
              const previous = state.domainStates[info.id]?.[domain]
              const domainStates = { ...state.domainStates, [info.id]: { ...state.domainStates[info.id], [domain]: {
                loading: false, lastSuccessAt: previous?.lastSuccessAt ?? null, error: previous?.error ?? null,
              } } }
              return { domainStates, ...statusSummary(domainStates) }
            })
            scheduleVmReconcile(info.id)
            return
          }
          const timer = pendingVmReconciles.get(info.id)
          if (timer) clearTimeout(timer)
          pendingVmReconciles.delete(info.id)
          continue
        }
        useMultiDataStore.setState((state) => {
          const previous = state.domainStates[info.id]?.[domain]
          const succeededAt = rows ? Date.now() : previous?.lastSuccessAt ?? null
          const domainStates = { ...state.domainStates, [info.id]: { ...state.domainStates[info.id], [domain]: {
            loading: false, lastSuccessAt: succeededAt, error,
          } } }
          const patch: Partial<MultiDataStore> = { domainStates, ...statusSummary(domainStates) }
          if (rows) {
            const scoped = rows.map((row) => ({ ...row, connectionId: info.id, poolName: info.poolName ?? info.host }))
            const order = useConnectionManagerStore.getState().connections.map((c) => c.id)
            const merged = [...state[domain].filter((r) => r.connectionId !== info.id), ...scoped]
              .sort((a, b) => order.indexOf(a.connectionId) - order.indexOf(b.connectionId)
                || String((a as { ref?: string }).ref ?? '').localeCompare(String((b as { ref?: string }).ref ?? '')))
            Object.assign(patch, { [domain]: merged })
            patch.lastRefresh = new Date(succeededAt!)
          }
          return patch
        })
        return
      }
    })().finally(() => { if (pendingReads.get(key) === entry) pendingReads.delete(key) })
    return entry.promise
  }))
}

function scheduleVmReconcile(connectionId: string): void {
  if (pendingVmReconciles.has(connectionId)) return
  const timer = setTimeout(() => {
    pendingVmReconciles.delete(connectionId)
    void refreshDomain('vms', getConnectedInfos().filter((c) => c.id === connectionId))
  }, VM_EVENT_RECONCILE_DELAY_MS)
  pendingVmReconciles.set(connectionId, timer)
}

export function getConnectionReadIdentity(connectionId: string): string | null {
  const connection = getConnectedInfos().find((item) => item.id === connectionId)
  return connection ? fingerprint(connection) : null
}

/** Apply an authoritative SR identity readback without letting an older list response undo it. */
export function applySrIdentityRecord(connectionId: string, srRef: string, identity: { nameLabel: string; nameDescription: string }, expectedConnectionIdentity: string | null): boolean {
  if (!expectedConnectionIdentity || getConnectionReadIdentity(connectionId) !== expectedConnectionIdentity) return false
  const key = requestKey(connectionId, 'srs')
  requestVersions.set(key, (requestVersions.get(key) ?? 0) + 1)
  useMultiDataStore.setState((state) => {
    const previous = state.domainStates[connectionId]?.srs
    const domainStates = previous ? { ...state.domainStates, [connectionId]: { ...state.domainStates[connectionId], srs: { ...previous, loading: false } } } : state.domainStates
    return { srs: state.srs.map((sr) => sr.connectionId === connectionId && sr.ref === srRef
      ? { ...sr, name_label: identity.nameLabel, name_description: identity.nameDescription } : sr),
      domainStates, ...statusSummary(domainStates) }
  })
  return true
}

function pruneRemovedConnections(): void {
  const ids = new Set(useConnectionManagerStore.getState().connections.map((c) => c.id))
  useMultiDataStore.setState((state) => {
    const patch: Partial<MultiDataStore> = {}
    if (Object.keys(state.domainStates).some((id) => !ids.has(id))) {
      const domainStates = Object.fromEntries(Object.entries(state.domainStates).filter(([id]) => ids.has(id)))
      Object.assign(patch, { domainStates, ...statusSummary(domainStates) })
    }
    for (const domain of domains) {
      if (state[domain].some((row) => !ids.has(row.connectionId))) {
        Object.assign(patch, { [domain]: state[domain].filter((row) => ids.has(row.connectionId)) })
      }
    }
    return Object.keys(patch).length ? patch : state
  })
}

// ============================================================================
// Store definition
// ============================================================================

interface MultiDataStore {
  vms: ConnectedVmRecord[]
  hosts: ConnectedHostRecord[]
  srs: ConnectedSrRecord[]
  networks: ConnectedNetworkRecord[]
  tasks: ConnectedTaskRecord[]
  pools: ConnectedPoolRecord[]

  loading: boolean
  loadingConnections: string[] // connection IDs currently loading
  errors: Record<string, string> // per-connection errors
  lastRefresh: Date | null
  templateRevision: number
  domainStates: Record<string, Partial<Record<ResourceDomain, ResourceReadState>>>

  // Actions
  refreshAll: (options?: ResourceRefreshOptions) => Promise<void>
  refreshConnection: (connectionId: string, options?: ResourceRefreshOptions) => Promise<void>
  refreshVms: (options?: ResourceRefreshOptions) => Promise<void>
  refreshHosts: (options?: ResourceRefreshOptions) => Promise<void>
  refreshSrs: (options?: ResourceRefreshOptions) => Promise<void>
  refreshNetworks: (options?: ResourceRefreshOptions) => Promise<void>
  refreshTasks: (options?: ResourceRefreshOptions) => Promise<void>
  handleVmChangeEvent: (event: VmChangeEvent) => void
}

export const useMultiDataStore = create<MultiDataStore>((set, get) => ({
  vms: [],
  hosts: [],
  srs: [],
  networks: [],
  tasks: [],
  pools: [],

  loading: false,
  loadingConnections: [],
  errors: {},
  lastRefresh: null,
  templateRevision: 0,
  domainStates: {},

  refreshAll: async (options) => {
    pruneRemovedConnections()
    const infos = getConnectedInfos()
    await Promise.all(domains.map((domain) => refreshDomain(domain, infos, options)))
    useConnectionStore.getState().syncFromManager()
    set((state) => ({ templateRevision: state.templateRevision + 1 }))
  },

  refreshConnection: async (connectionId: string, options) => {
    const infos = getConnectedInfos().filter((c) => c.id === connectionId)
    await Promise.all(domains.map((domain) => refreshDomain(domain, infos, options)))
    useConnectionStore.getState().syncFromManager()
  },

  refreshVms: (options) => refreshDomain('vms', getConnectedInfos(), options),
  refreshHosts: (options) => refreshDomain('hosts', getConnectedInfos(), options),
  refreshSrs: (options) => refreshDomain('srs', getConnectedInfos(), options),
  refreshNetworks: (options) => refreshDomain('networks', getConnectedInfos(), options),
  refreshTasks: (options) => refreshDomain('tasks', getConnectedInfos(), options),

  handleVmChangeEvent: (event) => {
    const connection = useConnectionManagerStore.getState().connections.find((entry) => entry.id === event.connectionId)
    if (connection?.state !== 'connected'
      || (connection.connectedAt !== null && event.receivedAt < connection.connectedAt)) return
    const key = requestKey(event.connectionId, 'vms')
    requestVersions.set(key, (requestVersions.get(key) ?? 0) + 1)
    const poolName = getPoolNameForConnection(event.connectionId)
    const previous = get().vms.find((vm) => vm.connectionId === event.connectionId && vm.ref === event.ref)
    const snapshot = event.snapshot
    const completeSnapshot = !!snapshot && typeof snapshot.name_label === 'string'
      && typeof snapshot.power_state === 'string'
      && typeof snapshot.is_a_template === 'boolean'
      && typeof snapshot.is_a_snapshot === 'boolean'
      && typeof snapshot.is_control_domain === 'boolean'
    const runningGuest = snapshot && isVisibleVm(snapshot)
      && (snapshot.power_state === 'Running' || snapshot.power_state === 'Paused')
      && snapshot.guest_metrics && snapshot.guest_metrics !== 'OpaqueRef:NULL'
    const needsReadback = event.operation !== 'del' && (!completeSnapshot || (runningGuest
      && (previous?.guest_metrics !== snapshot.guest_metrics || !previous?.networks)))

    set((state) => {
      // A provisioned clone stops being a template before its first VM event.
      const templateRevision = event.operation === 'del' || snapshot?.is_a_template
        || (snapshot && completeSnapshot && isVisibleVm(snapshot) && !previous)
        ? state.templateRevision + 1 : state.templateRevision
      if (event.operation === 'del') {
        return {
          templateRevision,
          vms: state.vms.filter(
            (vm) => !(vm.connectionId === event.connectionId && vm.ref === event.ref)
          ),
        }
      }

      if (!snapshot || !completeSnapshot) return { templateRevision }

      if (!isVisibleVm(snapshot)) {
        return {
          templateRevision,
          vms: state.vms.filter(
            (vm) => !(vm.connectionId === event.connectionId && vm.ref === event.ref)
          ),
        }
      }

      const previousVm = state.vms.find((vm) => vm.connectionId === event.connectionId && vm.ref === event.ref)
      const keepGuestMetrics = previousVm?.guest_metrics === snapshot.guest_metrics
        && (snapshot.power_state === 'Running' || snapshot.power_state === 'Paused')
      const nextVm = {
        // VM events omit guest networks. Keep the same guest's last read until
        // reconciliation completes; power-off or a new guest reference clears it.
        ...(keepGuestMetrics ? { networks: previousVm?.networks, guestMetricsError: previousVm?.guestMetricsError } : {}),
        ...snapshot,
        ref: event.ref,
        connectionId: event.connectionId,
        poolName,
      } as ConnectedVmRecord

      return {
        templateRevision,
        vms: previousVm
          ? state.vms.map((vm) =>
              vm.connectionId === event.connectionId && vm.ref === event.ref ? nextVm : vm
            )
          : [...state.vms, nextVm],
      }
    })

    // Complete event snapshots already carry the VM record. Read back only
    // omitted guest data (or an incomplete event); explicit refresh and write
    // reconciliation keep their existing ordering boundary.
    if (needsReadback) scheduleVmReconcile(event.connectionId)
  },
}))

useConnectionManagerStore.subscribe((state, previous) => {
  if (state.connections === previous.connections) return
  for (const old of previous.connections) {
    const current = state.connections.find((c) => c.id === old.id)
    if (!current || current.state !== old.state || fingerprint(current) !== fingerprint(old)) {
      for (const domain of domains) {
        const key = requestKey(old.id, domain)
        requestVersions.set(key, (requestVersions.get(key) ?? 0) + 1)
        pendingReads.delete(key)
      }
      const timer = pendingVmReconciles.get(old.id)
      if (timer) clearTimeout(timer)
      pendingVmReconciles.delete(old.id)
      useMultiDataStore.setState((data) => {
        const previousPool = old.poolUuid ?? knownPoolIdentities.get(old.id)
        const changedPool = !!current?.poolUuid && !!previousPool && current.poolUuid !== previousPool
        if (changedPool) {
          const domainStates = { ...data.domainStates }
          delete domainStates[old.id]
          const patch: Partial<MultiDataStore> = { domainStates, ...statusSummary(domainStates) }
          for (const domain of domains) Object.assign(patch, { [domain]: data[domain].filter((row) => row.connectionId !== old.id) })
          return patch
        }
        const previousStates = data.domainStates[old.id]
        if (!previousStates) return {}
        const domainStates = { ...data.domainStates, [old.id]: Object.fromEntries(
          Object.entries(previousStates).map(([domain, status]) => [domain, {
            ...status, loading: false,
            error: current?.state === 'connected' ? '连接已更新，等待重新读取资源状态' : current?.errorMessage || '连接已断开，显示最近成功读取的数据',
          }])
        ) }
        return { domainStates, ...statusSummary(domainStates) }
      })
    }
  }
  for (const connection of state.connections) {
    if (connection.poolUuid) knownPoolIdentities.set(connection.id, connection.poolUuid)
  }
  for (const id of knownPoolIdentities.keys()) {
    if (!state.connections.some((connection) => connection.id === id)) knownPoolIdentities.delete(id)
  }
  pruneRemovedConnections()
})
