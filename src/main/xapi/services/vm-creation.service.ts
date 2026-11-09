import { connectionManager } from '../connection-manager'
import { srFreeBytes } from '../../../shared/storage-capacity'
import { readOperationResult } from '../../../shared/read-operation-result'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { creationCoresPerSocket, isHvmTemplate, sameVifPolicy, templateInstallModes, validInstallUrl, vifPolicy } from '../../../shared/vm-creation'
import type {
  VmCreationResourceOptions,
  VmWizardPayload,
  WizardDisk,
  WizardVif,
} from '../../../shared/types/xapi'

type XapiRecords = Record<string, any>

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) throw new Error(`No connection found for connectionId: ${connectionId}`)
  return client
}

function addHost(index: Map<string, Set<string>>, resourceRef: string, hostRef: string): void {
  if (!resourceRef || !hostRef) return
  const hosts = index.get(resourceRef) ?? new Set<string>()
  hosts.add(hostRef)
  index.set(resourceRef, hosts)
}

function isTrue(value: unknown): boolean {
  return String(value ?? '').toLowerCase() === 'true'
}

function isVisibleNetwork(network: any): boolean {
  return network?.managed !== false
    && !isTrue(network?.other_config?.HideFromXenCenter)
    && !isTrue(network?.other_config?.is_guest_installer_network)
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

interface CreationRecords {
  pools: XapiRecords
  hosts: XapiRecords
  hostMetrics: XapiRecords
  hostCpus: XapiRecords
  srs: XapiRecords
  pbds: XapiRecords
  vdis: XapiRecords
  vbds: XapiRecords
  networks: XapiRecords
  pifs: XapiRecords
}

async function loadCreationRecords(client: ReturnType<typeof getClient>): Promise<CreationRecords> {
  const [hosts, hostMetrics, hostCpus, srs, pbds, vdis, vbds, networks, pifs, pools]: XapiRecords[] = await Promise.all([
    client.callWithSession('host.get_all_records', []),
    client.callWithSession('host_metrics.get_all_records', []),
    client.callWithSession('host_cpu.get_all_records', []),
    client.callWithSession('SR.get_all_records', []),
    client.callWithSession('PBD.get_all_records', []),
    client.callWithSession('VDI.get_all_records', []),
    client.callWithSession('VBD.get_all_records', []),
    client.callWithSession('network.get_all_records', []),
    client.callWithSession('PIF.get_all_records', []),
    client.callWithSession('pool.get_all_records', []),
  ])
  return { hosts, hostMetrics, hostCpus, srs, pbds, vdis, vbds, networks, pifs, pools }
}

function normalizeCreationResources(records: CreationRecords): VmCreationResourceOptions {
  const {
    hosts: hostRecords,
    hostMetrics: hostMetricsRecords,
    hostCpus: hostCpuRecords,
    srs: srRecords,
    pbds: pbdRecords,
    vdis: vdiRecords,
    networks: networkRecords,
    pifs: pifRecords,
  } = records

  const usableHosts = Object.entries(hostRecords)
    .filter(([, host]) => host?.enabled === true && hostMetricsRecords[host.metrics]?.live === true)
  const usableHostRefs = new Set(usableHosts.map(([ref]) => ref))
  const cpuCountByHost = new Map<string, number>()
  for (const cpu of Object.values(hostCpuRecords)) {
    if (!usableHostRefs.has(cpu?.host)) continue
    cpuCountByHost.set(cpu.host, (cpuCountByHost.get(cpu.host) ?? 0) + 1)
  }

  const hosts = usableHosts.map(([ref, host]) => ({
    ref,
    name: host.name_label || ref,
    enabled: true,
    memoryFree: Number(hostMetricsRecords[host.metrics]?.memory_free ?? 0),
    cpuCount: cpuCountByHost.get(ref) ?? 0,
  }))

  const attachedHostsBySr = new Map<string, Set<string>>()
  for (const pbd of Object.values(pbdRecords)) {
    if (pbd?.currently_attached === true && usableHostRefs.has(pbd.host)) {
      addHost(attachedHostsBySr, pbd.SR, pbd.host)
    }
  }

  const hostRefsForSr = (srRef: string): string[] => {
    const attached = attachedHostsBySr.get(srRef) ?? new Set<string>()
    if (attached.size === 0) return []
    return sorted(attached)
  }

  const srs = Object.entries(srRecords)
    .filter(([, sr]) => sr?.type !== 'iso' && sr?.type !== 'udev' && sr?.content_type !== 'iso')
    .map(([ref, sr]) => ({
      ref,
      name: sr.name_label || ref,
      uuid: String(sr.uuid ?? ''),
      isDefault: Object.values(records.pools ?? {}).some((pool) => pool.default_SR === ref),
      freeBytes: srFreeBytes({ physical_size: Number(sr.physical_size), physical_utilisation: Number(sr.physical_utilisation) }) ?? -1,
      shared: sr.shared === true,
      hostRefs: hostRefsForSr(ref),
    }))
    .filter((sr) => sr.hostRefs.length > 0)

  const hostRefsByNetwork = new Map<string, Set<string>>()
  for (const pif of Object.values(pifRecords)) {
    if (pif?.currently_attached === true && usableHostRefs.has(pif.host)) {
      addHost(hostRefsByNetwork, pif.network, pif.host)
    }
  }

  const networks = Object.entries(networkRecords)
    .filter(([, network]) => isVisibleNetwork(network))
    .map(([ref, network]) => {
      const pifHostRefs = sorted(hostRefsByNetwork.get(ref) ?? [])
      const hasPifs = network.PIFs?.length > 0 || Object.values(pifRecords).some((pif) => pif?.network === ref)
      const hostRefs = hasPifs ? pifHostRefs : sorted(usableHostRefs)
      return {
        ref,
        name: network.name_label || ref,
        hostRefs,
        autoPlug: network.other_config?.automatic !== 'false',
      }
    })
    .filter((network) => network.hostRefs.length > 0)

  const isos = Object.entries(vdiRecords)
    .filter(([, vdi]) => {
      const sr = srRecords[vdi?.SR]
      return sr?.type === 'iso' || sr?.content_type === 'iso' || vdi?.type === 'iso' || vdi?.is_tools_iso === true
    })
    .map(([ref, vdi]) => ({
      ref,
      name: vdi.name_label || ref,
      srRef: vdi.SR,
      hostRefs: hostRefsForSr(vdi.SR),
    }))
    .filter((iso) => iso.hostRefs.length > 0)

  return { hosts, srs, networks, isos }
}

export async function getVmCreationResources(
  connectionId: string,
  templateRef?: string,
): Promise<VmCreationResourceOptions> {
  const client = getClient(connectionId)
  const records = await loadCreationRecords(client)
  const resources = normalizeCreationResources(records)
  if (!templateRef) return resources
  const template = await client.callWithSession('VM.get_record', [templateRef])
  return { ...resources, templateDisks: templateDiskPlan(templateRef, template, records, resources),
    templateCdCount: Object.values(records.vbds).filter((vbd) => vbd.VM === templateRef && vbd.type === 'CD').length }
}

function templateDiskPlan(templateRef: string, template: any, records: CreationRecords, resources: VmCreationResourceOptions): WizardDisk[] {
  const disks = new Map<string, WizardDisk>()
  for (const vbd of Object.values(records.vbds)) {
    if (vbd.VM !== templateRef || vbd.type !== 'Disk' || !vbd.VDI || vbd.VDI === 'OpaqueRef:NULL') continue
    const vdi = records.vdis[vbd.VDI]
    if (!vdi || !Number.isSafeInteger(Number(vdi.virtual_size)) || Number(vdi.virtual_size) < 1) throw new Error('无法读取模板磁盘或其容量')
    const device = String(vbd.userdevice ?? disks.size)
    if (disks.has(device)) throw new Error(`模板磁盘设备号 ${device} 重复`)
    disks.set(device, { templateVdiRef: vbd.VDI, device, srRef: vdi.SR, sizeBytes: Number(vdi.virtual_size),
      bootable: vbd.bootable === true, type: vdi.type ?? 'user', mode: vbd.mode === 'RO' ? 'RO' : 'RW' })
  }
  const xml = template.other_config?.disks
  if (xml) {
    if (XMLValidator.validate(xml) !== true) throw new Error('模板磁盘配置 XML 无效')
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(xml)
    if (!Object.prototype.hasOwnProperty.call(parsed, 'provision')) throw new Error('模板磁盘配置缺少 provision 节点')
    const nodes = parsed.provision?.disk ?? []
    const seen = new Set<string>()
    for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
      const device = String(node.device ?? '')
      const sizeBytes = Number(node.size)
      if (!device || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || seen.has(device)) throw new Error('模板磁盘设备号或容量无效')
      seen.add(device)
      if (disks.has(device)) continue
      const sr = String(node.sr ?? '')
      const option = sr ? resources.srs.find((option) => option.uuid === sr || option.ref === sr) : resources.srs.find((option) => option.isDefault)
      disks.set(device, { templateVdiRef: '', device, srRef: option?.ref ?? '', sizeBytes,
        bootable: node.bootable === 'true', type: node.type ?? 'system', mode: 'RW' })
    }
  }
  return [...disks.values()].sort((a, b) => Number(a.device) - Number(b.device))
}

function isSystemTemplate(template: any): boolean {
  return template?.is_default_template === true || template?.other_config?.default_template === 'true'
}

function chooseDevice(requested: string | undefined, allowed: string[], kind: string): string {
  if (requested) {
    if (allowed.includes(requested)) return requested
    throw new Error(`${kind}_DEVICE_UNAVAILABLE: 设备号 ${requested} 已被占用或不可用`)
  }
  const device = [...allowed].sort((a, b) => Number(a) - Number(b))[0]
  if (!device) throw new Error(`${kind}_NO_AVAILABLE_DEVICE: 没有可用设备号`)
  return device
}

async function setVcpus(client: ReturnType<typeof getClient>, vmRef: string, current: number, target: number): Promise<void> {
  if (current > target) {
    await client.callWithSession('VM.set_VCPUs_at_startup', [vmRef, target])
    await client.callWithSession('VM.set_VCPUs_max', [vmRef, target])
  } else {
    await client.callWithSession('VM.set_VCPUs_max', [vmRef, target])
    await client.callWithSession('VM.set_VCPUs_at_startup', [vmRef, target])
  }
}

async function bestEffortDestroy(client: ReturnType<typeof getClient>, method: string, ref: string): Promise<boolean> {
  try {
    await client.callWithSession(method, [ref])
    return true
  } catch (error: any) {
    return error?.code === 'HANDLE_INVALID'
  }
}

async function collectExclusiveOwnedDisks(
  client: ReturnType<typeof getClient>,
  vmRef: string,
  preExistingVdis: XapiRecords,
): Promise<string[]> {
  const vm = await client.callWithSession('VM.get_record', [vmRef])
  const diskRefs: string[] = []
  for (const vbdRef of vm.VBDs ?? []) {
    const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
    if (vbd.VM !== vmRef || vbd.type !== 'Disk'
      || !vbd.VDI || vbd.VDI === 'OpaqueRef:NULL'
      || Object.prototype.hasOwnProperty.call(preExistingVdis, vbd.VDI)) continue
    const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
    if (vdi.sharable !== true && vdi.is_a_snapshot !== true
      && ['user', 'system'].includes(vdi.type)
      && Array.isArray(vdi.VBDs) && vdi.VBDs.length === 1 && vdi.VBDs[0] === vbdRef) {
      diskRefs.push(vbd.VDI)
    }
  }
  return diskRefs
}

function validatePayload(
  payload: VmWizardPayload,
  template: any,
  resources: VmCreationResourceOptions,
  disks: WizardDisk[],
): 'system' | 'custom' {
  if (!payload.templateRef || !payload.vmName.trim()) throw new Error('虚拟机模板和名称不能为空')
  if (!Number.isInteger(payload.vcpus) || payload.vcpus < 1
    || !Number.isSafeInteger(payload.memoryBytes) || payload.memoryBytes < Math.max(1, Number(template.memory_static_min ?? 1))) {
    throw new Error('CPU 或内存配置无效')
  }
  const kind = isSystemTemplate(template) ? 'system' : 'custom'
  const selectedHost = payload.targetHostRef
    ? resources.hosts.find((host) => host.ref === payload.targetHostRef)
    : undefined
  if (payload.targetHostRef && !selectedHost) throw new Error('目标主机不可用')
  if (selectedHost && (payload.vcpus > selectedHost.cpuCount || payload.memoryBytes > selectedHost.memoryFree)) {
    throw new Error('目标主机资源不足')
  }

  const compatible = (hostRefs: string[]) => !payload.targetHostRef || hostRefs.includes(payload.targetHostRef)
  const requiredHostSets: string[][] = []
  if ((payload.installMode === 'pxe' || payload.installMode === 'url') && !payload.vifs.length) throw new Error('网络安装至少需要一张虚拟网卡')
  const vifDevices = payload.vifs.map((vif, index) => vif.device ?? String(index))
  if (new Set(vifDevices).size !== vifDevices.length) throw new Error('虚拟网卡设备号重复')
  for (const vif of payload.vifs) {
    const network = resources.networks.find((option) => option.ref === vif.networkRef)
    if (!network || !compatible(network.hostRefs)) throw new Error('目标网络与所选主机不兼容')
    requiredHostSets.push(network.hostRefs)
  }

  if (kind === 'custom') {
    if (payload.installMode !== 'none') throw new Error('自定义模板仅支持完整复制')
    const targetSr = resources.srs.find((sr) => sr.ref === payload.targetSrRef)
    if (!targetSr || !compatible(targetSr.hostRefs)) throw new Error('目标存储不可用或与所选主机不兼容')
    requiredHostSets.push(targetSr.hostRefs)
  } else {
    if (!templateInstallModes(template).includes(payload.installMode)) throw new Error('模板不支持所选安装方式')
    if (payload.installMode === 'url' && !validInstallUrl(payload.installUrl ?? '', template.other_config?.['install-methods'])) throw new Error('请输入模板支持的安装源 URL')
    if (payload.installMode === 'iso') {
      const iso = resources.isos.find((option) => option.ref === payload.isoRef)
      if (!iso || !compatible(iso.hostRefs)) throw new Error('ISO 镜像不可用或与所选主机不兼容')
      requiredHostSets.push(iso.hostRefs)
    }
    if (payload.installMode === 'iso' && !disks.length) throw new Error('请至少配置一块安装磁盘')
  }
  const devices = disks.map((disk) => disk.device)
  if (devices.some((device) => !device) || new Set(devices).size !== devices.length) throw new Error('磁盘设备号无效或重复')
  const requiredBySr = new Map<string, number>()
  for (const disk of disks) {
    const sr = resources.srs.find((option) => option.ref === disk.srRef)
    if (!sr || !compatible(sr.hostRefs) || !Number.isSafeInteger(disk.sizeBytes) || disk.sizeBytes < 1) throw new Error('磁盘存储配置无效')
    requiredHostSets.push(sr.hostRefs)
    requiredBySr.set(disk.srRef, (requiredBySr.get(disk.srRef) ?? 0) + disk.sizeBytes)
  }
  for (const [srRef, required] of requiredBySr) {
    if (!Number.isSafeInteger(required) || required > resources.srs.find((sr) => sr.ref === srRef)!.freeBytes) throw new Error('目标存储空间不足')
  }
  if (payload.installMode === 'iso' && ['0', '1', '2', '3'].every((device) => devices.includes(device))) {
    throw new Error('设备 0–3 已全部用于磁盘，没有可用于安装光驱的设备号')
  }
  if (!payload.targetHostRef) {
    const placementHost = resources.hosts.find((host) =>
      payload.vcpus <= host.cpuCount
        && payload.memoryBytes <= host.memoryFree
        && requiredHostSets.every((hostRefs) => hostRefs.includes(host.ref)),
    )
    if (!placementHost) throw new Error('没有主机满足自动放置所需的计算、存储和网络条件')
  }
  return kind
}

async function createDisk(
  client: ReturnType<typeof getClient>,
  vmRef: string,
  vmName: string,
  disk: WizardDisk,
  index: number,
  createdVdis: string[],
  createdVbds: string[],
): Promise<void> {
  const allowed: string[] = await client.callWithSession('VM.get_allowed_VBD_devices', [vmRef])
  const device = chooseDevice(disk.device, allowed, 'VBD')
  const vdiRef: string = await client.callWithSession('VDI.create', [{
    name_label: `${vmName}-disk-${disk.device ?? index}`,
    name_description: '', SR: disk.srRef, virtual_size: String(disk.sizeBytes), type: disk.type ?? 'user',
    sharable: false, read_only: false, other_config: {}, xenstore_data: {}, sm_config: {}, tags: [],
  }])
  createdVdis.push(vdiRef)
  const vbdRef: string = await client.callWithSession('VBD.create', [{
    VM: vmRef, VDI: vdiRef, userdevice: device,
    bootable: disk.bootable ?? index === 0, mode: disk.mode ?? 'RW', type: 'Disk', unpluggable: true,
    empty: false, other_config: { owner: 'true' }, qos_algorithm_type: '', qos_algorithm_params: {},
  }])
  if (vbdRef) createdVbds.push(vbdRef)
}

async function vmDevices(client: ReturnType<typeof getClient>, vmRef: string): Promise<{ ref: string; record: any }[]> {
  const vm = await client.callWithSession('VM.get_record', [vmRef])
  return Promise.all((vm.VBDs ?? []).map(async (ref: string) => ({ ref, record: await client.callWithSession('VBD.get_record', [ref]) })))
}

async function assertOwnedDisk(client: ReturnType<typeof getClient>, vmRef: string, vbdRef: string, vbd: any, existingVdis: XapiRecords): Promise<any> {
  if (vbd.VM !== vmRef || !vbd.VDI || Object.prototype.hasOwnProperty.call(existingVdis, vbd.VDI)) throw new Error('新虚拟机的磁盘仍引用源资源，无法安全修改')
  const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
  if (vdi.sharable === true || vdi.is_a_snapshot === true || vdi.VBDs?.length !== 1 || vdi.VBDs[0] !== vbdRef) throw new Error('无法确认新磁盘的独占归属')
  return vdi
}

async function reconcileDisks(client: ReturnType<typeof getClient>, vmRef: string, vmName: string, disks: WizardDisk[], existingVdis: XapiRecords,
  createdVdis: string[], createdVbds: string[]): Promise<void> {
  const devices = await vmDevices(client, vmRef)
  // Optical media never belongs to the new VM's disk plan. Free a colliding
  // device before creating a hard disk; an installation CD is recreated below.
  for (const { ref, record } of devices) {
    if ((record.type === 'CD' && disks.some((disk) => disk.device === record.userdevice))
      || (record.type === 'Disk' && (!record.VDI || record.VDI === 'OpaqueRef:NULL'))) {
      await client.callWithSession('VBD.destroy', [ref])
    }
  }
  const inherited = devices.filter(({ record }) => record.type === 'Disk' && record.VDI && record.VDI !== 'OpaqueRef:NULL')
  for (const { ref, record } of inherited) {
    await assertOwnedDisk(client, vmRef, ref, record, existingVdis)
    createdVdis.push(record.VDI)
  }
  for (const { ref, record } of inherited.filter(({ record }) => !disks.some((disk) => disk.device === record.userdevice))) {
    await client.callWithSession('VBD.destroy', [ref])
    await client.callWithSession('VDI.destroy', [record.VDI])
  }
  for (const [index, disk] of disks.entries()) {
    const existing = inherited.find(({ record }) => record.userdevice === disk.device)
    if (!existing) {
      await createDisk(client, vmRef, vmName, disk, index, createdVdis, createdVbds)
      continue
    }
    let vdiRef = existing.record.VDI
    const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
    if (vdi.SR !== disk.srRef) {
      vdiRef = await client.callWithSession('VDI.copy', [vdiRef, disk.srRef, 'OpaqueRef:NULL', 'OpaqueRef:NULL'])
      createdVdis.push(vdiRef)
      await client.callWithSession('VBD.destroy', [existing.ref])
      const vbdRef = await client.callWithSession('VBD.create', [{
        VM: vmRef, VDI: vdiRef, userdevice: disk.device, bootable: disk.bootable ?? index === 0,
        mode: existing.record.mode, type: 'Disk', unpluggable: existing.record.unpluggable,
        empty: false, other_config: { ...(existing.record.other_config ?? {}), owner: 'true' },
        qos_algorithm_type: existing.record.qos_algorithm_type ?? '', qos_algorithm_params: existing.record.qos_algorithm_params ?? {},
      }])
      createdVbds.push(vbdRef)
      await client.callWithSession('VDI.destroy', [existing.record.VDI])
    } else if (existing.record.bootable !== disk.bootable) {
      await client.callWithSession('VBD.set_bootable', [existing.ref, disk.bootable ?? index === 0])
    }
    if (disk.sizeBytes < Number(vdi.virtual_size)) throw new Error('不能缩小模板已有磁盘')
    if (disk.sizeBytes > Number(vdi.virtual_size)) await client.callWithSession('VDI.resize', [vdiRef, String(disk.sizeBytes)])
  }
}

async function insertInstallIso(client: ReturnType<typeof getClient>, vmRef: string, isoRef: string, disks: WizardDisk[], createdVbds: string[]): Promise<void> {
  const cds = (await vmDevices(client, vmRef)).filter(({ record }) => record.type === 'CD')
  // Use one installation drive, retaining a valid inherited device when possible.
  const existing = cds.find(({ record }) => ['0', '1', '2', '3'].includes(record.userdevice) && !disks.some((disk) => disk.device === record.userdevice))
  for (const cd of cds.filter((cd) => cd !== existing)) await client.callWithSession('VBD.destroy', [cd.ref])
  let cdRef = existing?.ref
  if (!cdRef) {
    const allowed: string[] = await client.callWithSession('VM.get_allowed_VBD_devices', [vmRef])
    const candidates = ['3', '2', '1', '0'].filter((device) => allowed.includes(device) && !disks.some((disk) => disk.device === device))
    if (!candidates.length) throw new Error('没有可用于安装光驱的设备号')
    cdRef = await client.callWithSession('VBD.create', [{
      VM: vmRef, VDI: 'OpaqueRef:NULL', userdevice: candidates[0], bootable: true, mode: 'RO', type: 'CD', unpluggable: true,
      empty: true, other_config: {}, qos_algorithm_type: '', qos_algorithm_params: {},
    }])
    createdVbds.push(cdRef!)
  }
  if (existing) await client.callWithSession('VBD.set_bootable', [existing.ref, true])
  if (existing && existing.record.empty !== true && existing.record.VDI && existing.record.VDI !== 'OpaqueRef:NULL' && existing.record.VDI !== isoRef) {
    await client.callWithSession('VBD.eject', [cdRef])
  }
  if (!existing || existing.record.empty === true || existing.record.VDI !== isoRef) await client.callWithSession('VBD.insert', [cdRef, isoRef])
}

async function verifyDiskPlan(client: ReturnType<typeof getClient>, vmRef: string, disks: WizardDisk[], isoRef?: string): Promise<void> {
  const devices = await vmDevices(client, vmRef)
  if (isoRef) {
    const cds = devices.filter(({ record }) => record.type === 'CD')
    if (cds.length !== 1 || cds[0].record.VDI !== isoRef || cds[0].record.empty === true || cds[0].record.bootable !== true) throw new Error('创建后安装光驱与确认配置不一致')
  }
  const actual = devices.filter(({ record }) => record.type === 'Disk')
  if (actual.length !== disks.length) throw new Error('创建后硬盘数量与确认配置不一致')
  for (const disk of disks) {
    const matches = actual.filter(({ record }) => record.userdevice === disk.device)
    if (matches.length !== 1) throw new Error(`创建后磁盘设备 ${disk.device} 与确认配置不一致`)
    const vdi = await client.callWithSession('VDI.get_record', [matches[0].record.VDI])
    if (matches[0].record.mode !== (disk.mode ?? 'RW') || matches[0].record.bootable !== (disk.bootable ?? disks.indexOf(disk) === 0)
      || vdi.SR !== disk.srRef || !Number.isSafeInteger(Number(vdi.virtual_size)) || Number(vdi.virtual_size) < disk.sizeBytes) throw new Error(`创建后磁盘设备 ${disk.device} 的存储或容量与确认配置不一致`)
  }
}

async function replaceVifs(
  client: ReturnType<typeof getClient>,
  vmRef: string,
  vifs: WizardVif[],
  createdVifs: string[],
  networks: XapiRecords,
): Promise<void> {
  const inherited: string[] = await client.callWithSession('VM.get_VIFs', [vmRef])
  const inheritedRecords = await Promise.all(inherited.map((ref) => client.callWithSession('VIF.get_record', [ref])))
  const policyByDevice = new Map(inheritedRecords.map((record) => [record.device, record]))
  for (const vif of vifs) {
    const original = policyByDevice.get(vif.device)
    if (vif.policy && (!original || !sameVifPolicy(vif.policy, vifPolicy(original)))) throw new Error('模板网卡策略已变化，请重新读取模板后创建')
  }
  for (const vifRef of inherited) await client.callWithSession('VIF.destroy', [vifRef])
  for (const [index, vif] of vifs.entries()) {
    const device = vif.device ?? String(index)
    const original = policyByDevice.get(device)
    const policy = vifPolicy(original ?? { MTU: networks[vif.networkRef]?.MTU })
    const allowed: string[] = await client.callWithSession('VM.get_allowed_VIF_devices', [vmRef])
    const vifRef: string = await client.callWithSession('VIF.create', [{
      VM: vmRef, network: vif.networkRef, device: chooseDevice(device, allowed, 'VIF'),
      MAC: '', other_config: { ...(original?.other_config ?? {}) }, ...policy,
    }])
    if (vifRef) createdVifs.push(vifRef)
  }
}

export async function createFromWizard(connectionId: string, rawPayload: VmWizardPayload): Promise<string> {
  const payload: VmWizardPayload = {
    ...rawPayload,
    vcpus: Number(rawPayload.vcpus),
    memoryBytes: Number(rawPayload.memoryBytes),
  }
  const client = getClient(connectionId)
  const [template, records] = await Promise.all([
    client.callWithSession('VM.get_record', [payload.templateRef]),
    loadCreationRecords(client),
  ])
  if (!template?.is_a_template || template.is_a_snapshot) throw new Error('请选择可用模板')
  const resources = normalizeCreationResources(records)
  const templateDisks = templateDiskPlan(payload.templateRef, template, records, resources)
  const disks = isSystemTemplate(template)
    ? payload.disks.map((disk, index) => {
      const device = disk.device ?? String(index)
      const inherited = templateDisks.find((item) => item.device === device && item.templateVdiRef)
      if (disk.templateVdiRef !== (inherited?.templateVdiRef ?? '')) throw new Error('模板磁盘已变化，请重新读取模板')
      if (inherited && (disk.sizeBytes < inherited.sizeBytes || (inherited.mode === 'RO' && disk.sizeBytes !== inherited.sizeBytes))) throw new Error('不能缩小模板已有磁盘或调整只读磁盘容量')
      return { ...disk, device, templateVdiRef: inherited?.templateVdiRef ?? '', mode: inherited?.mode ?? 'RW', type: inherited?.type ?? disk.type,
        bootable: payload.installMode === 'iso' ? false : disk.bootable ?? index === 0 }
    })
    : templateDisks.map((disk) => ({ ...disk, srRef: payload.targetSrRef ?? '' }))
  if (!isSystemTemplate(template)) {
    const supplied = payload.disks.map((disk, index) => ({ ...disk, device: disk.device ?? String(index) }))
    if (supplied.length !== templateDisks.length || templateDisks.some((disk) => !supplied.some((item) =>
      item.device === disk.device && item.templateVdiRef === disk.templateVdiRef && item.sizeBytes === disk.sizeBytes
      && (item.mode ?? 'RW') === (disk.mode ?? 'RW')))) throw new Error('模板磁盘计划已变化，请重新读取模板后创建')
  }
  const kind = validatePayload(payload, template, resources, disks)
  const createdVdis: string[] = []
  const createdVbds: string[] = []
  const createdVifs: string[] = []
  let vmRef = ''
  let creationComplete = false

  try {
    vmRef = kind === 'custom'
      ? await client.callWithSession('VM.copy', [payload.templateRef, `__gui__${payload.vmName}`, payload.targetSrRef])
      : await client.callWithSession('VM.clone', [payload.templateRef, `__gui__${payload.vmName}`])

    const cloned = await client.callWithSession('VM.get_record', [vmRef])
    if (Object.prototype.hasOwnProperty.call(cloned.other_config ?? {}, 'disks')) {
      const otherConfig = { ...cloned.other_config }
      delete otherConfig.disks
      await client.callWithSession('VM.set_other_config', [vmRef, otherConfig])
    }
    // A copy of a template is still a template. Provisioning turns it into a VM.
    await client.callWithSession('VM.provision', [vmRef])

    const vm = await client.callWithSession('VM.get_record', [vmRef])
    if (vm?.is_a_template === true) throw new Error('创建后对象仍是模板')
    await client.callWithSession('VM.set_name_label', [vmRef, payload.vmName.trim()])
    await client.callWithSession('VM.set_name_description', [vmRef, payload.vmDescription])
    const cores = creationCoresPerSocket(template, payload.vcpus)
    if (String(vm.platform?.['cores-per-socket'] ?? '') !== String(cores)) {
      await client.callWithSession('VM.set_platform', [vmRef, { ...(vm.platform ?? template.platform ?? {}), 'cores-per-socket': String(cores) }])
    }
    await setVcpus(client, vmRef, Number(vm.VCPUs_at_startup ?? template.VCPUs_at_startup ?? 1), payload.vcpus)
    const memory = String(payload.memoryBytes)
    await client.callWithSession('VM.set_memory_limits', [
      vmRef, String(template.memory_static_min ?? 0), memory, memory, memory,
    ])
    if (payload.targetHostRef) await client.callWithSession('VM.set_affinity', [vmRef, payload.targetHostRef])

    if (kind === 'system' && payload.installMode !== 'none') {
      if (isHvmTemplate(template)) {
        const params = { ...(vm.HVM_boot_params ?? {}) }
        const first = payload.installMode === 'iso' ? 'd' : 'n'
        params.order = first + String(params.order ?? 'cdn').replace(new RegExp(first, 'g'), '')
        await client.callWithSession('VM.set_HVM_boot_params', [vmRef, params])
      } else if (template.PV_bootloader === 'eliloader') {
        let repository = payload.installMode === 'iso' ? 'cdrom' : payload.installUrl!
        if (repository.startsWith('nfs://') && ['rhel41', 'rhel44', 'rhlike'].includes(template.other_config?.['install-distro'])) {
          const url = new URL(repository)
          repository = `nfs:${url.host}:${url.pathname}`
        }
        await client.callWithSession('VM.set_other_config', [vmRef, { ...(vm.other_config ?? {}), 'install-repository': repository }])
      }
    }
    await reconcileDisks(client, vmRef, payload.vmName.trim(), disks, records.vdis, createdVdis, createdVbds)
    if (kind === 'system' && payload.installMode === 'iso') await insertInstallIso(client, vmRef, payload.isoRef!, disks, createdVbds)
    await replaceVifs(client, vmRef, payload.vifs, createdVifs, records.networks)
    await readOperationResult(() => verifyDiskPlan(client, vmRef, disks, kind === 'system' && payload.installMode === 'iso' ? payload.isoRef : undefined), { isCurrent: () => connectionManager.getClient(connectionId) === client })
    await client.callWithSession('VM.remove_from_other_config', [vmRef, 'HideFromXenCenter'])
    creationComplete = true
    if (payload.startAfter) await client.callWithSession('VM.start', [vmRef, false, false])
    return vmRef
  } catch (error) {
    const failure = error as { code?: string; details?: { kind?: string } }
    const uncertain = failure?.details?.kind === 'transport' || failure?.details?.kind === 'client'
      || /^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH|TASK_OUTCOME_UNKNOWN)/.test(failure?.code ?? '')
    if (creationComplete || uncertain) {
      let observed: any
      if (vmRef) {
        try {
          observed = await readOperationResult(() => client.callWithSession('VM.get_record', [vmRef]),
            { isCurrent: () => connectionManager.getClient(connectionId) === client })
        } catch { /* Preserve resources when the server result cannot be obtained. */ }
      }
      if (creationComplete && observed?.power_state === 'Running') return vmRef
      const message = error instanceof Error ? error.message : String(error)
      const partial = new Error(creationComplete
        ? `虚拟机已创建，${observed ? `启动未完成，当前状态为 ${observed.power_state}` : '无法取得启动结果'}：${message}。已保留 VM ${vmRef}。`
        : `无法完成虚拟机创建：${message}。${vmRef ? `已保留 VM ${vmRef}` : '服务器未返回 VM 引用，无法取得创建结果'}。`) as Error & { code: string; details: unknown }
      partial.code = creationComplete ? 'VM_CREATED_START_INCOMPLETE' : 'VM_CREATE_OUTCOME_UNKNOWN'
      partial.details = { vmRef: vmRef || undefined, creationComplete, powerState: observed?.power_state, outcome: creationComplete && observed ? 'partial' : 'unknown' }
      throw partial
    }
    const residuals: string[] = []
    let ownedDisks: string[] = []
    if (vmRef) {
      try {
        ownedDisks = await collectExclusiveOwnedDisks(client, vmRef, records.vdis)
      } catch {
        residuals.push(`VM ${vmRef} 的磁盘归属无法核对`)
      }
    }
    for (const ref of [...createdVifs].reverse()) {
      if (!await bestEffortDestroy(client, 'VIF.destroy', ref)) residuals.push(`VIF ${ref}`)
    }
    for (const ref of [...createdVbds].reverse()) {
      if (!await bestEffortDestroy(client, 'VBD.destroy', ref)) residuals.push(`VBD ${ref}`)
    }
    const vmDestroyed = !vmRef || await bestEffortDestroy(client, 'VM.destroy', vmRef)
    if (!vmDestroyed) residuals.push(`VM ${vmRef}`)
    const vdiRefs = new Set([...createdVdis, ...ownedDisks])
    if (vmDestroyed) {
      for (const ref of vdiRefs) {
        if (!await bestEffortDestroy(client, 'VDI.destroy', ref)) residuals.push(`VDI ${ref}`)
      }
    } else {
      for (const ref of vdiRefs) residuals.push(`VDI ${ref} 未清理（VM 仍存在）`)
    }
    if (residuals.length > 0) {
      const primaryMessage = error instanceof Error ? error.message : String(error)
      const cleanupError = new Error(
        `创建虚拟机失败：${primaryMessage}。清理未完成或未能核对：${residuals.join('、')}。请检查资源列表后再重试。`,
      ) as Error & { code: string; details: unknown }
      cleanupError.code = 'VM_CREATE_CLEANUP_INCOMPLETE'
      cleanupError.details = { vmRef, residuals }
      throw cleanupError
    }
    throw error
  }
}

export { quickCreateFromTemplate } from './vm-quick-create.service'
