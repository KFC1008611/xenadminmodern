import { XMLParser } from 'fast-xml-parser'
import type { VmWizardPayload } from '../../src/shared/types/xapi'

export const GIB = 1073741824
export const R = { template: 'OpaqueRef:template', vm: 'OpaqueRef:newvm', host: 'OpaqueRef:host',
  sr: 'OpaqueRef:sr', sr2: 'OpaqueRef:sr2', isoSr: 'OpaqueRef:iso-sr', iso: 'OpaqueRef:iso', net: 'OpaqueRef:net' }
export const SR_UUID = '11111111-1111-1111-1111-111111111111'
type RecordMap = Record<string, any>

/** Models the XAPI object graph, including clone/copy/provision side effects. */
export class TemplateCreationFake {
  sequence = 0
  source: any = { is_a_template: true, is_default_template: true, VCPUs_at_startup: 2, VCPUs_max: 2,
    memory_static_min: String(GIB), platform: {}, HVM_boot_policy: 'BIOS order', HVM_boot_params: { order: 'cdn' },
    other_config: { 'install-methods': 'cdrom' }, VBDs: [], VIFs: [], power_state: 'Halted' }
  created: any
  vdis: RecordMap = { [R.iso]: { SR: R.isoSr, type: 'user', read_only: true, VBDs: [] } }
  vbds: RecordMap = {}
  vifs: RecordMap = {}
  records: RecordMap = {
    'host.get_all_records': { [R.host]: { enabled: true, metrics: 'hm', name_label: 'Host' } },
    'host_metrics.get_all_records': { hm: { live: true, memory_free: String(16 * GIB) } },
    'host_cpu.get_all_records': Object.fromEntries(Array.from({ length: 8 }, (_, n) => [String(n), { host: R.host }])),
    'SR.get_all_records': {
      [R.sr]: { uuid: SR_UUID, type: 'nfs', shared: true, physical_size: String(100 * GIB), physical_utilisation: '0' },
      [R.sr2]: { uuid: 'second-sr', type: 'nfs', physical_size: String(100 * GIB), physical_utilisation: '0' },
      [R.isoSr]: { type: 'iso', content_type: 'iso' },
    },
    'PBD.get_all_records': { disk: { SR: R.sr, host: R.host, currently_attached: true },
      second: { SR: R.sr2, host: R.host, currently_attached: true }, iso: { SR: R.isoSr, host: R.host, currently_attached: true } },
    'network.get_all_records': { [R.net]: { managed: true, MTU: '9000', PIFs: [], other_config: {} } },
    'PIF.get_all_records': {},
    'pool.get_all_records': { pool: { default_SR: R.sr2 } },
  }
  before?: (method: string, args: any[]) => void
  after?: (method: string, args: any[], result: any) => void

  attach(vm: any, vdi: string, type = 'Disk', device = '0', mode = 'RW', patch: any = {}) {
    const ref = `OpaqueRef:vbd-${++this.sequence}`
    this.vbds[ref] = { VM: vm === this.source ? R.template : R.vm, VDI: vdi, type, userdevice: device,
      mode, empty: vdi === 'OpaqueRef:NULL', bootable: type === 'Disk', unpluggable: true, ...patch }
    vm.VBDs.push(ref)
    if (this.vdis[vdi]) this.vdis[vdi].VBDs.push(ref)
    return ref
  }
  disk(mode = 'RW', device = '0', size = 10 * GIB) {
    const ref = `OpaqueRef:source-disk-${device}`
    this.vdis[ref] = { SR: R.sr, type: 'user', virtual_size: String(size), VBDs: [], read_only: mode === 'RO', sharable: false, is_a_snapshot: false }
    this.attach(this.source, ref, 'Disk', device, mode)
    return ref
  }
  nic(policy: any = {}) {
    const ref = `OpaqueRef:source-vif-${++this.sequence}`
    this.source.VIFs.push(ref)
    this.vifs[ref] = { VM: R.template, device: '0', network: R.net, MAC: 'aa:bb:cc:dd:ee:ff', MTU: '9000',
      qos_algorithm_type: '', qos_algorithm_params: {}, locking_mode: 'network_default', ipv4_allowed: [], ipv6_allowed: [], other_config: {}, ...policy }
    return ref
  }
  payload(overrides: Partial<VmWizardPayload> = {}): VmWizardPayload {
    return { templateRef: R.template, vmName: 'VM', vmDescription: '', vcpus: 2, memoryBytes: 2 * GIB,
      installMode: 'iso', isoRef: R.iso, targetHostRef: R.host,
      disks: [{ templateVdiRef: '', srRef: R.sr, sizeBytes: 10 * GIB, device: '0', bootable: true }],
      vifs: [{ device: '0', networkRef: R.net }], startAfter: false, ...overrides }
  }
  disks() { return this.created.VBDs.map((ref: string) => this.vbds[ref]).filter((vbd: any) => vbd.type === 'Disk') }
  cds() { return this.created.VBDs.map((ref: string) => this.vbds[ref]).filter((vbd: any) => vbd.type === 'CD') }
  read(map: RecordMap, ref: string) {
    if (!map[ref]) throw Object.assign(new Error('invalid handle'), { code: 'HANDLE_INVALID' })
    return structuredClone(map[ref])
  }
  call = async (method: string, args: any[]) => {
    this.before?.(method, args)
    const result = this.dispatch(method, args)
    this.after?.(method, args, result)
    return result
  }
  dispatch(method: string, args: any[]): any {
    if (method === 'VDI.get_all_records') return structuredClone(this.vdis)
    if (method === 'VBD.get_all_records') return structuredClone(this.vbds)
    if (this.records[method]) return structuredClone(this.records[method])
    if (method === 'VM.get_record') return structuredClone(args[0] === R.template ? this.source : this.created)
    if (method === 'VM.clone' || method === 'VM.copy') {
      this.created = { ...structuredClone(this.source), VBDs: [], VIFs: [], is_default_template: false }
      for (const ref of this.source.VBDs) {
        const src = this.vbds[ref]
        let vdi = src.VDI
        if (src.type === 'Disk' && this.vdis[vdi]) {
          const copied = `OpaqueRef:copied-${++this.sequence}`
          this.vdis[copied] = { ...structuredClone(this.vdis[vdi]), VBDs: [], ...(method === 'VM.copy' ? { SR: args[2] } : {}) }
          vdi = copied
        }
        this.attach(this.created, vdi, src.type, src.userdevice, src.mode, { bootable: src.bootable })
      }
      for (const ref of this.source.VIFs) {
        const copied = `OpaqueRef:copied-vif-${++this.sequence}`
        this.vifs[copied] = { ...structuredClone(this.vifs[ref]), VM: R.vm }
        this.created.VIFs.push(copied)
      }
      return R.vm
    }
    if (method === 'VM.provision') {
      this.created.is_a_template = false
      if (this.created.other_config.disks) {
        const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(this.created.other_config.disks)
        const disks = parsed.provision?.disk ?? []
        for (const disk of Array.isArray(disks) ? disks : [disks]) {
          const ref = `OpaqueRef:provisioned-${++this.sequence}`
          this.vdis[ref] = { SR: R.sr, type: 'user', virtual_size: String(disk.size), VBDs: [], sharable: false, is_a_snapshot: false }
          this.attach(this.created, ref, 'Disk', String(disk.device))
        }
      }
      return
    }
    if (method === 'VM.get_allowed_VBD_devices') return Array.from({ length: 16 }, (_, n) => String(n)).filter(n => !this.created.VBDs.some((r: string) => this.vbds[r].userdevice === n))
    if (method === 'VDI.create' || method === 'VDI.copy') {
      const ref = `OpaqueRef:new-disk-${++this.sequence}`
      this.vdis[ref] = method === 'VDI.create' ? { ...structuredClone(args[0]), VBDs: [] } : { ...this.read(this.vdis, args[0]), SR: args[1], VBDs: [] }
      return ref
    }
    if (method === 'VBD.create') return this.attach(this.created, args[0].VDI, args[0].type, args[0].userdevice, args[0].mode, args[0])
    if (method === 'VBD.get_record') return this.read(this.vbds, args[0])
    if (method === 'VDI.get_record') return this.read(this.vdis, args[0])
    if (method === 'VIF.get_record') return this.read(this.vifs, args[0])
    if (method === 'VDI.resize') { this.vdis[args[0]].virtual_size = args[1]; return }
    if (method === 'VBD.set_bootable') { this.vbds[args[0]].bootable = args[1]; return }
    if (method === 'VBD.eject') { this.vbds[args[0]].VDI = 'OpaqueRef:NULL'; this.vbds[args[0]].empty = true; return }
    if (method === 'VBD.insert') { this.vbds[args[0]].VDI = args[1]; this.vbds[args[0]].empty = false; return }
    if (method === 'VM.get_VIFs') return [...this.created.VIFs]
    if (method === 'VM.get_allowed_VIF_devices') return Array.from({ length: 16 }, (_, n) => String(n)).filter(n => !this.created.VIFs.some((r: string) => this.vifs[r].device === n))
    if (method === 'VIF.create') {
      const ref = `OpaqueRef:new-vif-${++this.sequence}`
      this.vifs[ref] = structuredClone(args[0]); this.created.VIFs.push(ref); return ref
    }
    if (method === 'VIF.destroy') {
      this.read(this.vifs, args[0]); delete this.vifs[args[0]]
      this.created.VIFs = this.created.VIFs.filter((r: string) => r !== args[0]); return
    }
    if (method === 'VBD.destroy') {
      const vbd = this.read(this.vbds, args[0])
      if (this.vdis[vbd.VDI]) this.vdis[vbd.VDI].VBDs = this.vdis[vbd.VDI].VBDs.filter((r: string) => r !== args[0])
      delete this.vbds[args[0]]; this.created.VBDs = this.created.VBDs.filter((r: string) => r !== args[0]); return
    }
    if (method === 'VDI.destroy') { this.read(this.vdis, args[0]); delete this.vdis[args[0]]; return }
    if (method === 'VM.destroy') { for (const ref of [...this.created.VBDs]) this.dispatch('VBD.destroy', [ref]); this.created.VBDs = []; return }
    if (method === 'VM.remove_from_other_config') { delete this.created.other_config[args[1]]; return }
    if (method === 'VM.start') { this.created.power_state = 'Running'; return }
    if (method.startsWith('VM.set_')) {
      this.created[method.slice(7)] = structuredClone(args[1]); return
    }
    throw new Error(`Fake does not implement ${method}`)
  }
}
