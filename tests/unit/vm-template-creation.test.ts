import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GIB, R, SR_UUID, TemplateCreationFake } from '../helpers/template-creation-fake'
import { vifPolicy } from '../../src/shared/vm-creation'
import type { VmWizardPayload } from '../../src/shared/types/xapi'

const mock = vi.hoisted(() => ({ client: {} as any, call: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient: () => mock.client } }))
let fake: TemplateCreationFake
beforeEach(() => {
  fake = new TemplateCreationFake()
  mock.call.mockReset().mockImplementation((method, args) => fake.call(method, args))
  mock.client = { callWithSession: mock.call }
})
async function create(overrides: Partial<VmWizardPayload> = {}) {
  const { createFromWizard } = await import('../../src/main/xapi/services/vm-creation.service')
  return createFromWizard('conn', fake.payload(overrides))
}
async function plan() {
  const { getVmCreationResources } = await import('../../src/main/xapi/services/vm-creation.service')
  return (await getVmCreationResources('conn', R.template)).templateDisks!
}
async function custom(overrides: Partial<VmWizardPayload> = {}) {
  fake.source.is_default_template = false
  return create({ installMode: 'none', isoRef: undefined, targetSrRef: R.sr, disks: await plan(), ...overrides })
}
const called = (method: string) => mock.call.mock.calls.filter(([name]) => name === method)
const xml = (device: string, sr = SR_UUID, size = 5 * GIB) => `<disk device="${device}" size="${size}" sr="${sr}" bootable="false" type="user"/>`

 describe('template creation object graph and rollback', () => {
  it('reuses a cloned system disk instead of appending another disk', async () => {
    const source = fake.disk()
    await create({ disks: await plan() })
    expect(fake.disks()).toHaveLength(1)
    expect(fake.disks()[0].userdevice).toBe('0')
    expect(fake.disks()[0].VDI).not.toBe(source)
    expect(called('VDI.create')).toHaveLength(0)
    expect(fake.vdis[source].VBDs).toEqual(fake.source.VBDs)
  })
  it('creates exactly one requested disk from a stock diskless XML template', async () => {
    fake.source.other_config.disks = `<provision>${xml('0')}</provision>`
    await create()
    expect(fake.disks()).toHaveLength(1)
    expect(fake.vdis[fake.disks()[0].VDI].virtual_size).toBe(String(10 * GIB))
    expect(called('VM.set_other_config')[0][1][1]).not.toHaveProperty('disks')
  })
  it('copies custom real disks and explicitly creates XML-only devices on the selected SR', async () => {
    const source = fake.disk()
    fake.source.other_config.disks = `<provision>${xml('0')}${xml('1')}</provision>`
    await custom({ targetSrRef: R.sr2 })
    expect(fake.disks()).toHaveLength(2)
    expect(fake.disks().map((disk: any) => disk.userdevice)).toEqual(['0', '1'])
    expect(fake.disks().map((disk: any) => fake.vdis[disk.VDI].SR)).toEqual([R.sr2, R.sr2])
    expect(called('VDI.create')).toHaveLength(1)
    expect(fake.vdis[source].SR).toBe(R.sr)
    expect(called('VM.copy')).toHaveLength(1)
    expect(called('VM.provision')).toHaveLength(1)
  })
  it('keeps a custom copy without XML at exactly its original disk count', async () => {
    fake.disk()
    await custom()
    expect(fake.disks()).toHaveLength(1)
    expect(called('VDI.create')).toHaveLength(0)
  })
  it('counts only disk VBDs and merges XML by device with the real disk taking precedence', async () => {
    const source = fake.disk()
    fake.attach(fake.source, 'OpaqueRef:NULL', 'CD', '3', 'RO')
    fake.source.other_config.disks = `<provision>${xml('0')}${xml('1')}</provision>`
    const { getVmCreationResources } = await import('../../src/main/xapi/services/vm-creation.service')
    const result = await getVmCreationResources('conn', R.template)
    expect(result.templateDisks).toHaveLength(2)
    expect(result.templateDisks![0]).toMatchObject({ templateVdiRef: source, sizeBytes: 10 * GIB })
    expect(result.templateCdCount).toBe(1)
  })
  it('resolves XML SR UUID and pool default without guessing the first SR', async () => {
    fake.source.other_config.disks = `<provision>${xml('0')}${xml('1', '')}${xml('2', 'unknown')}</provision>`
    expect((await plan()).map((disk) => disk.srRef)).toEqual([R.sr, R.sr2, ''])
    delete fake.records['pool.get_all_records'].pool.default_SR
    expect((await plan())[1].srRef).toBe('')
  })
  it.each(['<provision>', '<other/>', `<provision>${xml('0')}${xml('0')}</provision>`, `<provision>${xml('0', SR_UUID, 0.5)}</provision>`])('rejects invalid XML plans before writes (%s)', async (value) => {
    fake.source.other_config.disks = value
    await expect(create()).rejects.toThrow('模板磁盘')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it('rejects a changed custom plan before copying rather than silently adding unseen disks', async () => {
    fake.source.is_default_template = false
    const disks = await plan()
    fake.disk()
    await expect(create({ installMode: 'none', isoRef: undefined, targetSrRef: R.sr, disks })).rejects.toThrow('计划已变化')
    expect(called('VM.copy')).toHaveLength(0)
  })
  it('accounts for XML-only capacity on the custom target SR', async () => {
    fake.disk()
    fake.source.other_config.disks = `<provision>${xml('1')}</provision>`
    fake.records['SR.get_all_records'][R.sr2].physical_size = String(12 * GIB)
    await expect(custom({ targetSrRef: R.sr2 })).rejects.toThrow('空间不足')
    expect(called('VM.copy')).toHaveLength(0)
  })
  it.each([true, false])('reuses inherited installation CD (empty=%s)', async (empty) => {
    fake.attach(fake.source, empty ? 'OpaqueRef:NULL' : R.iso, 'CD', '3', 'RO')
    await create()
    expect(fake.cds()).toHaveLength(1)
    expect(fake.cds()[0]).toMatchObject({ VDI: R.iso, userdevice: '3', empty: false, bootable: true })
    expect(called('VBD.create').filter(([, [record]]) => record.type === 'CD')).toHaveLength(0)
    expect(fake.created.HVM_boot_params.order).toBe('dcn')
    expect(fake.disks()[0].bootable).toBe(false)
  })
  it('ejects different inherited media and removes extra optical drives without deleting ISOs', async () => {
    fake.vdis['OpaqueRef:old-iso'] = { SR: R.isoSr, VBDs: [] }
    fake.attach(fake.source, 'OpaqueRef:old-iso', 'CD', '3', 'RO')
    fake.attach(fake.source, 'OpaqueRef:NULL', 'CD', '2', 'RO')
    await create()
    expect(fake.cds()).toHaveLength(1)
    expect(called('VBD.eject')).toHaveLength(1)
    expect(fake.vdis['OpaqueRef:old-iso']).toBeDefined()
  })
  it('relocates an inherited CD when its device is requested for a hard disk', async () => {
    fake.attach(fake.source, 'OpaqueRef:NULL', 'CD', '0', 'RO')
    await create()
    expect(fake.disks()[0].userdevice).toBe('0')
    expect(fake.cds()).toHaveLength(1)
    expect(fake.cds()[0].userdevice).toBe('3')
  })
  it('rejects a plan using every installation CD slot', async () => {
    await expect(create({ disks: ['0', '1', '2', '3'].map((device) => ({ device, templateVdiRef: '', srRef: R.sr, sizeBytes: GIB })) })).rejects.toThrow('光驱')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it('uses a network first HVM order for a diskless PXE template with only cdrom metadata', async () => {
    await create({ installMode: 'pxe', isoRef: undefined, disks: [] })
    expect(fake.disks()).toHaveLength(0)
    expect(fake.created.HVM_boot_params.order).toBe('ncd')
    expect(called('VDI.create')).toHaveLength(0)
  })
  it.each(['pxe', 'url'] as const)('requires a VIF for %s before creating', async (installMode) => {
    if (installMode === 'url') Object.assign(fake.source, { HVM_boot_policy: '', PV_bootloader: 'eliloader', other_config: { 'install-methods': 'http' } })
    await expect(create({ installMode, installUrl: installMode === 'url' ? 'http://server/path' : undefined, isoRef: undefined, disks: [], vifs: [] })).rejects.toThrow('至少需要一张')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it.each(['http://server/path', 'https://server/path', 'ftp://server/path', 'nfs://server/path'])('sets PV installation repository for %s', async (installUrl) => {
    Object.assign(fake.source, { HVM_boot_policy: '', PV_bootloader: 'eliloader', other_config: { 'install-methods': 'http,ftp,nfs', 'install-repository': 'old' } })
    await create({ installMode: 'url', installUrl, isoRef: undefined })
    expect(fake.created.other_config['install-repository']).toBe(installUrl)
    expect(called('VM.set_HVM_boot_params')).toHaveLength(0)
  })
  it('sets PV cdrom installation repository instead of an HVM boot order', async () => {
    Object.assign(fake.source, { HVM_boot_policy: '', PV_bootloader: 'eliloader' })
    await create()
    expect(fake.created.other_config['install-repository']).toBe('cdrom')
    expect(called('VM.set_HVM_boot_params')).toHaveLength(0)
  })
  it('normalizes the RHEL PV NFS repository for eliloader', async () => {
    Object.assign(fake.source, { HVM_boot_policy: '', PV_bootloader: 'eliloader', other_config: { 'install-methods': 'nfs', 'install-distro': 'rhlike' } })
    await create({ installMode: 'url', installUrl: 'nfs://server/export/install', isoRef: undefined })
    expect(fake.created.other_config['install-repository']).toBe('nfs:server:/export/install')
  })
  it('allows an HVM template without installation metadata to keep its existing boot configuration', async () => {
    fake.source.other_config = {}
    await create({ installMode: 'none', isoRef: undefined, disks: [], vifs: [] })
    expect(fake.disks()).toHaveLength(0)
    expect(fake.cds()).toHaveLength(0)
    expect(called('VM.set_HVM_boot_params')).toHaveLength(0)
  })

  it('allows a template with no installer to create without installation media', async () => {
    Object.assign(fake.source, { HVM_boot_policy: '', other_config: {} })
    await create({ installMode: 'none', isoRef: undefined, disks: [], vifs: [] })
    expect(fake.disks()).toHaveLength(0)
    expect(fake.cds()).toHaveLength(0)
  })
  it('rejects a stale unsupported install mode and unavailable storage before mutation', async () => {
    Object.assign(fake.source, { HVM_boot_policy: '', PV_bootloader: 'eliloader', other_config: { 'install-methods': 'http' } })
    await expect(create()).rejects.toThrow('安装方式')
    fake.source.is_default_template = false
    await expect(custom({ targetSrRef: 'OpaqueRef:missing' })).rejects.toThrow('目标存储')
    expect(called('VM.clone')).toHaveLength(0)
    expect(called('VM.copy')).toHaveLength(0)
  })
  it.each([0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid integer memory and disk size (%s)', async (size) => {
    await expect(create({ memoryBytes: size })).rejects.toThrow('CPU 或内存')
    await expect(create({ disks: [{ templateVdiRef: '', srRef: R.sr, device: '0', sizeBytes: size }] })).rejects.toThrow('磁盘存储')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it('normalizes XAPI numeric strings and maintains setter ordering when reducing vCPUs', async () => {
    fake.source.VCPUs_at_startup = '4'
    await create({ vcpus: '2' as any, memoryBytes: String(2 * GIB) as any })
    const methods = mock.call.mock.calls.map(([name]) => name)
    expect(methods.indexOf('VM.set_VCPUs_at_startup')).toBeLessThan(methods.indexOf('VM.set_VCPUs_max'))
    expect(fake.created.memory_limits).toBe(String(GIB))
    expect(called('VM.set_memory_limits')[0][1]).toEqual([R.vm, String(GIB), String(2 * GIB), String(2 * GIB), String(2 * GIB)])
  })
  it('normalizes incompatible CPU topology before applying the new CPU count', async () => {
    fake.source.VCPUs_at_startup = 4
    fake.source.platform = { 'cores-per-socket': '4', keep: 'yes' }
    await create({ vcpus: 3 })
    expect(fake.created.platform).toEqual({ 'cores-per-socket': '1', keep: 'yes' })
    const methods = mock.call.mock.calls.map(([name]) => name)
    expect(methods.indexOf('VM.set_platform')).toBeLessThan(methods.indexOf('VM.set_VCPUs_at_startup'))
  })
  it('moves and expands an inherited disk while preserving its data identity and source', async () => {
    const source = fake.disk()
    await create({ disks: (await plan()).map((disk) => ({ ...disk, srRef: R.sr2, sizeBytes: 12 * GIB })) })
    expect(fake.disks()).toHaveLength(1)
    expect(fake.vdis[fake.disks()[0].VDI]).toMatchObject({ SR: R.sr2, virtual_size: String(12 * GIB) })
    expect(called('VDI.copy')[0][1]).toEqual([expect.stringMatching(/^OpaqueRef:copied/), R.sr2, 'OpaqueRef:NULL', 'OpaqueRef:NULL'])
    expect(called('VDI.create')).toHaveLength(0)
    expect(fake.vdis[source].virtual_size).toBe(String(10 * GIB))
  })
  it('allows explicit removal of an inherited disk and destroys only the new copy', async () => {
    const source = fake.disk()
    await create({ installMode: 'pxe', isoRef: undefined, disks: [] })
    expect(fake.disks()).toHaveLength(0)
    expect(fake.vdis[source]).toBeDefined()
    expect(called('VDI.destroy')).toHaveLength(1)
  })
  it.each(['RW', 'RO'])('rejects shrinking or changing read-only inherited disks (%s)', async (mode) => {
    fake.disk(mode)
    const disks = await plan()
    await expect(create({ disks: disks.map((disk) => ({ ...disk, sizeBytes: mode === 'RO' ? 11 * GIB : GIB })) })).rejects.toThrow('不能缩小')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it('rejects duplicate devices without silently renumbering', async () => {
    const disk = fake.payload().disks[0]
    await expect(create({ disks: [disk, disk] })).rejects.toThrow('重复')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it('preserves inherited MTU QoS and address restrictions and creates a fresh MAC', async () => {
    const ref = fake.nic({ locking_mode: 'locked', ipv4_allowed: ['192.0.2.10'], ipv6_allowed: ['2001:db8::1'],
      qos_algorithm_type: 'ratelimit', qos_algorithm_params: { kbps: '1024' }, other_config: { keep: 'yes' } })
    const policy = vifPolicy(fake.vifs[ref])
    await create({ vifs: [{ device: '0', networkRef: R.net, policy }] })
    expect(fake.vifs[fake.created.VIFs[0]]).toMatchObject({ ...policy, other_config: { keep: 'yes' }, MAC: '' })
    expect(fake.vifs[ref].MAC).toBe('aa:bb:cc:dd:ee:ff')
  })
  it('detects changed VIF policies before replacing adapters', async () => {
    const ref = fake.nic({ locking_mode: 'locked' })
    const policy = vifPolicy(fake.vifs[ref])
    fake.vifs[ref].ipv4_allowed = ['192.0.2.1']
    await expect(create({ vifs: [{ device: '0', networkRef: R.net, policy }] })).rejects.toThrow('策略已变化')
    expect(called('VIF.create')).toHaveLength(0)
  })
  it('removes inherited adapters when no VIFs are selected for an ISO installation', async () => {
    fake.nic()
    await create({ vifs: [] })
    expect(fake.created.VIFs).toEqual([])
    expect(called('VIF.destroy')).toHaveLength(1)
  })
  it('uses the selected network MTU for a new adapter', async () => {
    await create()
    expect(fake.vifs[fake.created.VIFs[0]].MTU).toBe(9000)
  })
  it('cleans owned disks including read-only copies after a definite later failure', async () => {
    const source = fake.disk('RO')
    const failure = new Error('network failed')
    fake.before = (method) => { if (method === 'VIF.create') throw failure }
    await expect(custom()).rejects.toBe(failure)
    expect(Object.keys(fake.vdis).sort()).toEqual([R.iso, source].sort())
    expect(called('VM.destroy')).toHaveLength(1)
    expect(called('VDI.destroy')).toHaveLength(1)
  })
  it('reports copied disk residuals when cleanup cannot delete them', async () => {
    fake.disk()
    fake.before = (method) => { if (method === 'VIF.create' || method === 'VDI.destroy') throw new Error('SR unavailable') }
    await expect(custom()).rejects.toMatchObject({ code: 'VM_CREATE_CLEANUP_INCOMPLETE', details: { residuals: [expect.stringMatching(/^VDI /)] } })
  })
  it('never modifies or destroys a preexisting source VDI when clone returns a shared reference', async () => {
    const source = fake.disk()
    fake.after = (method) => {
      if (method === 'VM.clone') fake.vbds[fake.created.VBDs[0]].VDI = source
    }
    await expect(create({ disks: await plan() })).rejects.toThrow('仍引用源资源')
    expect(called('VDI.destroy').some(([, [ref]]) => ref === source)).toBe(false)
    expect(fake.vdis[source]).toBeDefined()
  })
  it('keeps VM and disks if destroying the failed VM is rejected', async () => {
    fake.before = (method) => { if (method === 'VIF.create' || method === 'VM.destroy') throw new Error('denied') }
    await expect(create()).rejects.toMatchObject({ code: 'VM_CREATE_CLEANUP_INCOMPLETE' })
    expect(called('VDI.destroy')).toHaveLength(0)
  })
  it('requires one automatic placement host to meet all resources and compute', async () => {
    fake.records['host_cpu.get_all_records'] = { cpu: { host: R.host } }
    await expect(create({ targetHostRef: undefined })).rejects.toThrow('自动放置')
    expect(called('VM.clone')).toHaveLength(0)
  })
  it('preserves resources and never replays writes after an uncertain provision response', async () => {
    fake.after = (method) => { if (method === 'VM.provision') throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }) }
    await expect(create()).rejects.toMatchObject({ code: 'VM_CREATE_OUTCOME_UNKNOWN', details: { vmRef: R.vm } })
    expect(called('VM.destroy')).toHaveLength(0)
    expect(called('VM.provision')).toHaveLength(1)
  })
  it.each([false, true])('preserves a complete VM when start fails or loses a reply (running=%s)', async (running) => {
    fake.before = (method) => { if (method === 'VM.start' && !running) throw new Error('memory unavailable') }
    let failRead = running
    fake.after = (method) => {
      if (method === 'VM.start') throw Object.assign(new Error('reply lost'), { code: 'ECONNRESET' })
      if (method === 'VM.get_record' && fake.created?.power_state === 'Running' && failRead) { failRead = false; throw new Error('temporary read error') }
    }
    if (running) await expect(create({ startAfter: true })).resolves.toBe(R.vm)
    else await expect(create({ startAfter: true })).rejects.toMatchObject({ code: 'VM_CREATED_START_INCOMPLETE', details: { creationComplete: true, powerState: 'Halted' } })
    expect(called('VM.start')).toHaveLength(1)
    expect(called('VM.destroy')).toHaveLength(0)
  })
  it('rejects a wrong final disk graph and cleans resources before returning success', async () => {
    fake.after = (method) => { if (method === 'VIF.create') fake.vdis[fake.disks()[0].VDI].SR = R.sr2 }
    await expect(create()).rejects.toThrow('存储或容量')
    expect(called('VM.destroy')).toHaveLength(1)
    expect(called('VM.start')).toHaveLength(0)
  })
})
