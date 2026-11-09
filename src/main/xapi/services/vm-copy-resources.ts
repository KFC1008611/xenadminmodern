import { connectionManager } from '../connection-manager'
import { srFreeBytes } from '../../../shared/storage-capacity'
import type { VmCopyDisk, VmCopyPayload, VmCopyPlan, VmCopyVif } from '../../../shared/types/xapi'

export type CopyClient = { callWithSession: (method: string, params: any[]) => Promise<any> }
export const nonNullRef = (ref: unknown): ref is string => typeof ref === 'string' && ref.startsWith('OpaqueRef:') && ref !== 'OpaqueRef:NULL'
export function copyError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }) }
export function copyClient(id: string): CopyClient {
  const client = connectionManager.getClient(id)
  if (!client) throw copyError('COPY_CONNECTION_UNAVAILABLE', '资源池未连接，请重新连接后核对原任务')
  return client
}
export async function mapCopyReads<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(items.length, 6) }, async () => {
    while (cursor < items.length) { const i = cursor++; results[i] = await read(items[i]) }
  }))
  return results
}
export async function readCopySource(client: CopyClient, ref: string, history: boolean) {
  const vm = await client.callWithSession('VM.get_record', [ref])
  const members = [{ ref, record: vm }, ...await mapCopyReads<string, { ref: string; record: any }>(
    history ? [...new Set<string>(vm.snapshots ?? [])].filter(nonNullRef) : [],
    async (ref) => ({ ref, record: await client.callWithSession('VM.get_record', [ref]) }),
  )]
  const disks: VmCopyDisk[] = []
  const vifs: VmCopyVif[] = []
  const cds: Array<{ vmRef: string; history: boolean; vbdRef: string; device: string; vdiRef: string; empty: boolean }> = []
  // Preserve per-VM device relationships, including historical-only devices and suspend images.
  for (const member of members) {
    const base = { vmRef: member.ref, vmName: String(member.record.name_label ?? member.ref), history: member.ref !== ref }
    const [vbds, vifRecords] = await Promise.all([
      mapCopyReads<string, { ref: string; record: any }>(member.record.VBDs ?? [], async (ref) => ({ ref, record: await client.callWithSession('VBD.get_record', [ref]) })),
      mapCopyReads<string, { ref: string; record: any }>(member.record.VIFs ?? [], async (ref) => ({ ref, record: await client.callWithSession('VIF.get_record', [ref]) })),
    ])
    for (const { ref: vbdRef, record } of vbds) {
      if (record.type === 'CD') cds.push({ vmRef: member.ref, history: base.history, vbdRef,
        device: String(record.userdevice ?? ''), vdiRef: nonNullRef(record.VDI) ? record.VDI : 'OpaqueRef:NULL', empty: record.empty === true })
    }
    const diskVbds = vbds.filter(({ record }) => record.type === 'Disk' && nonNullRef(record.VDI))
    disks.push(...await mapCopyReads(diskVbds, async ({ ref: vbdRef, record: vbd }) => {
      const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
      return { ...base, vdiRef: vbd.VDI, vbdRef, suspend: false, device: String(vbd.userdevice ?? ''),
        name: String(vdi.name_label || vbd.VDI), size: Number(vdi.virtual_size), srRef: vdi.SR }
    }))
    if (history && member.record.power_state === 'Suspended' && nonNullRef(member.record.suspend_VDI)) {
      const vdiRef = member.record.suspend_VDI
      const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
      disks.push({ ...base, vdiRef, vbdRef: '', suspend: true, device: '', name: '挂起镜像', size: Number(vdi.virtual_size), srRef: vdi.SR })
    }
    for (const { ref: vifRef, record } of vifRecords) {
      if (!nonNullRef(record.network)) throw copyError('COPY_SOURCE_NETWORK_INVALID', '源网卡的网络引用无效，请先修复网络配置')
      vifs.push({ ...base, vifRef, device: String(record.device ?? ''), networkRef: record.network, networkName: record.network })
    }
  }
  if (disks.some((d) => !Number.isFinite(d.size) || d.size < 0 || !nonNullRef(d.srRef))) throw copyError('COPY_SOURCE_DISK_INVALID', '无法确认源磁盘容量或存储身份')
  const fingerprint = JSON.stringify(members.map(({ ref, record }) => ({ ref, uuid: record.uuid,
    disks: disks.filter((d) => d.vmRef === ref).map((d) => [d.vbdRef, d.vdiRef, d.srRef, d.device, d.size, d.suspend]).sort(),
    vifs: vifs.filter((v) => v.vmRef === ref).map((v) => [v.vifRef, v.networkRef, v.device]).sort(),
    // Preserve compatibility with saved fingerprints for VMs without a CD drive.
    ...(cds.some((cd) => cd.vmRef === ref) ? { cds: cds.filter((cd) => cd.vmRef === ref).map((cd) => [cd.vbdRef, cd.device, cd.vdiRef, cd.empty]).sort() } : {}),
  })).sort((a, b) => a.ref.localeCompare(b.ref)))
  return { vm, members, disks, vifs, cds, fingerprint }
}

async function readDestinations(connectionId: string) {
  const client = copyClient(connectionId)
  const [hosts, metrics, srs, pbds, networks, pifs] = await Promise.all(
    ['host', 'host_metrics', 'SR', 'PBD', 'network', 'PIF'].map((kind) => client.callWithSession(`${kind}.get_all_records`, [])),
  ) as Record<string, any>[]
  const liveHosts = Object.entries(hosts).filter(([, h]) => h.enabled === true && metrics[h.metrics]?.live === true)
  const hostRefs = liveHosts.map(([ref]) => ref)
  const srOptions = Object.entries(srs).flatMap(([ref, sr]) => {
    if (sr.type === 'iso' || sr.type === 'udev' || sr.content_type === 'iso' || !sr.allowed_operations?.includes('vdi_create')) return []
    const attached = [...new Set<string>(Object.values(pbds).filter((p) => p.SR === ref && p.currently_attached === true && hostRefs.includes(p.host)).map((p) => p.host))]
    const freeBytes = srFreeBytes({ physical_size: Number(sr.physical_size), physical_utilisation: Number(sr.physical_utilisation) })
    if (!attached.length || freeBytes === 0) return []
    return [{ ref, name: String(sr.name_label || ref), freeBytes, hostRefs: attached }]
  })
  const networkOptions = Object.entries(networks).flatMap(([ref, network]) => {
    if (network.managed === false || String(network.other_config?.HideFromXenCenter).toLowerCase() === 'true'
      || String(network.other_config?.is_guest_installer_network).toLowerCase() === 'true') return []
    const physical = Object.values(pifs).filter((p) => p.network === ref)
    const attached = physical.filter((p) => p.currently_attached === true && hostRefs.includes(p.host))
    // An internal network can carry guest traffic, but cannot carry host-to-host migration data.
    const reachable = physical.length || network.PIFs?.length ? [...new Set<string>(attached.map((p) => p.host))] : hostRefs
    const transferHostRefs = [...new Set<string>(attached.filter((p) => p.IP && p.IP !== '0.0.0.0' || (p.IPv6 ?? []).length > 0).map((p) => p.host))]
    return reachable.length ? [{ ref, name: String(network.name_label || ref), hostRefs: reachable, transferHostRefs }] : []
  })
  return { hosts: liveHosts.map(([ref, h]) => ({ ref, name: String(h.name_label || ref) })), srs: srOptions, networks: networkOptions }
}

export function sameCopyPool(sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return true
  const uuid = connectionManager.getConnectionInfo(sourceId)?.poolUuid
  return Boolean(uuid && uuid === connectionManager.getConnectionInfo(targetId)?.poolUuid)
}

export async function getVmCopyPlan(sourceId: string, vmRef: string, targetId: string): Promise<VmCopyPlan> {
  const samePool = sameCopyPool(sourceId, targetId)
  const client = copyClient(sourceId)
  const [source, destinations] = await Promise.all([readCopySource(client, vmRef, !samePool), readDestinations(targetId)])
  const vm = source.vm
  if (!vm.uuid) throw copyError('COPY_SOURCE_IDENTITY_UNCONFIRMED', '无法确认源对象 UUID，请重新读取')
  const blockers: string[] = []
  if (!vm.uuid || vm.is_control_domain || vm.is_a_snapshot) blockers.push('只能复制身份已确认的虚拟机或模板，请从快照管理中操作快照')
  if (vm.locked || vm.Locked || Object.keys(vm.current_operations ?? {}).length) blockers.push('源对象已锁定或正在执行其他操作')
  if (vm.power_state !== 'Halted') blockers.push('请先正常关闭源虚拟机；当前复制流程支持已停止的虚拟机和模板')
  if (!samePool && (vm.VGPUs ?? []).length) blockers.push('跨池复制尚不支持 vGPU 映射')
  // migrate_send ejects unmapped CDs even with copy=true. XenAdmin's CD
  // preservation mappings only apply within a pool; never silently eject here.
  if (!samePool) for (const cd of source.cds.filter((cd) => !cd.history && nonNullRef(cd.vdiRef))) {
    blockers.push(`源光驱 ${cd.device || cd.vbdRef} 已挂载 ISO；跨池复制会弹出源介质，请先手动弹出并重新读取预检`)
  }
  const operations = Array.isArray(vm.allowed_operations) ? vm.allowed_operations : []
  const allowedModes: VmCopyPlan['allowedModes'] = blockers.length ? [] : samePool
    ? (['clone', 'copy'] as const).filter((mode) => operations.includes(mode) && !vm.blocked_operations?.[mode])
    : operations.includes('migrate_send') && !vm.blocked_operations?.migrate_send ? ['cross-pool-copy'] : []
  if (!allowedModes.length && !blockers.length) blockers.push('XAPI 当前不允许所选复制方式，请刷新源对象状态')
  const sourceNetworks: Record<string, any> = samePool ? Object.fromEntries(destinations.networks.map((n) => [n.ref, { name_label: n.name }]))
    : await client.callWithSession('network.get_all_records', [])
  for (const vif of source.vifs) vif.networkName = sourceNetworks[vif.networkRef]?.name_label || vif.networkRef
  return { sourceConnectionId: sourceId, targetConnectionId: targetId, vmRef, sourceUuid: vm.uuid || '',
    isTemplate: vm.is_a_template === true, powerState: vm.power_state || '', allowedModes, blockers,
    warnings: [samePool ? '快速克隆保留原存储位置；完整复制会复制磁盘数据。快照历史不会随同池副本复制。' : '跨池副本不保留快照历史；XAPI 传输仍处理历史磁盘、挂起镜像和网卡，请确认全部映射。',
      '源对象会保留。容量与耗时取决于存储后端、已分配数据和快照链，提交时会重新预检。'],
    disks: source.disks, vifs: source.vifs, ...destinations }
}

export function validateCopyPlacement(plan: VmCopyPlan, payload: VmCopyPayload) {
  const mode = payload.mode ?? (payload.targetSrRef ? 'copy' : 'clone')
  if (!payload.newName.trim()) throw copyError('COPY_NAME_REQUIRED', '请输入副本名称')
  if (!plan.allowedModes.includes(mode)) throw copyError('COPY_BLOCKED', plan.blockers[0] || 'XAPI 当前不允许所选复制方式')
  if (mode === 'copy' && !plan.srs.some((s) => s.ref === payload.targetSrRef)) throw copyError('COPY_SR_UNAVAILABLE', '目标 SR 不支持创建磁盘、未连接或没有可用空间')
  if (mode === 'clone' && plan.disks.some((d) => !plan.srs.some((s) => s.ref === d.srRef))) throw copyError('COPY_SOURCE_SR_UNAVAILABLE', '源磁盘所在 SR 不可写、未连接或没有可用空间')
  if (mode === 'clone' && payload.targetSrRef) throw copyError('COPY_INVALID_MODE', '快速克隆不能指定目标 SR')
  if (mode !== 'cross-pool-copy') return
  if (!plan.hosts.some((h) => h.ref === payload.targetHostRef)) throw copyError('COPY_HOST_UNAVAILABLE', '目标主机不可用')
  if (!plan.networks.some((n) => n.ref === payload.transferNetworkRef && n.transferHostRefs.includes(payload.targetHostRef!))) throw copyError('COPY_TRANSFER_UNAVAILABLE', '传输网络必须在目标主机上连接并配置 IP')
  const diskRefs = [...new Set(plan.disks.map((d) => d.vdiRef))]
  const vifRefs = plan.vifs.map((v) => v.vifRef)
  if (Object.keys(payload.storageMap ?? {}).some((r) => !diskRefs.includes(r)) || Object.keys(payload.networkMap ?? {}).some((r) => !vifRefs.includes(r))) throw copyError('COPY_MAP_STALE', '源设备已变化，请重新读取复制计划')
  for (const disk of plan.disks) {
    if (!plan.srs.some((s) => s.ref === payload.storageMap?.[disk.vdiRef] && s.hostRefs.includes(payload.targetHostRef!))) throw copyError('COPY_STORAGE_MAP_INCOMPLETE', '请为所有当前磁盘、历史磁盘和挂起镜像选择目标主机可达的 SR')
  }
  for (const vif of plan.vifs) {
    if (!plan.networks.some((n) => n.ref === payload.networkMap?.[vif.vifRef] && n.hostRefs.includes(payload.targetHostRef!))) throw copyError('COPY_NETWORK_MAP_INCOMPLETE', '请为所有当前和历史网卡选择目标主机可达的网络')
  }
}
