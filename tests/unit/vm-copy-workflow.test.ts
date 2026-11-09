import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = vi.hoisted(() => ({ clients: {} as Record<string, any>, infos: {} as Record<string, any> }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient: (id: string) => env.clients[id], getConnectionInfo: (id: string) => env.infos[id],
  listConnections: () => Object.values(env.infos),
} }))
let directory: string
let source: any
let destination: any
let task: any
let sourceRecords: Record<string, Record<string, any>>
let targetRecords: Record<string, Record<string, any>>
let failure: string
let issuedError: any
const ref = (name: string) => `OpaqueRef:${name}`
const payload = { vmRef: ref('vm'), newName: 'Copy', mode: 'clone' as const }
function records(target = false) {
  const sr = ref(target ? 'target-sr' : 'sr')
  const network = ref(target ? 'target-net' : 'net')
  return {
    VM: { [ref('vm')]: { uuid: 'source-uuid', name_label: 'Source', name_description: '', power_state: 'Halted',
      allowed_operations: ['clone', 'copy', 'migrate_send'], blocked_operations: {}, current_operations: {}, snapshots: [],
      VBDs: [ref('vbd')], VIFs: [ref('vif')] },
    [ref('new')]: { uuid: 'copy-uuid', name_label: 'Copy', name_description: '', power_state: 'Halted', VBDs: [ref('new-vbd')], VIFs: [ref('new-vif')], snapshots: [] } },
    VBD: { [ref('vbd')]: { VDI: ref('vdi'), type: 'Disk', userdevice: '0' }, [ref('new-vbd')]: { VDI: ref('new-vdi'), type: 'Disk', userdevice: '0' } },
    VDI: { [ref('vdi')]: { SR: sr, virtual_size: '1024', name_label: 'Disk' }, [ref('new-vdi')]: { SR: sr, virtual_size: '1024', name_label: 'Disk' } },
    VIF: { [ref('vif')]: { network, device: '0' }, [ref('new-vif')]: { network, device: '0' } },
    host: { [ref('host')]: { name_label: 'Host', enabled: true, metrics: ref('metrics') } },
    host_metrics: { [ref('metrics')]: { live: true, memory_total: '8192', memory_free: '4096' } },
    SR: { [sr]: { name_label: 'Storage', type: 'nfs', allowed_operations: ['vdi_create'], physical_size: '2048', physical_utilisation: '100', PBDs: [ref('pbd')] } },
    PBD: { [ref('pbd')]: { SR: sr, host: ref('host'), currently_attached: true } },
    network: { [network]: { name_label: 'Network', PIFs: [ref('pif')] } },
    PIF: { [ref('pif')]: { network, host: ref('host'), currently_attached: true, IP: '192.0.2.2' } },
  }
}
function makeClient(data: typeof sourceRecords) {
  return { callWithSession: vi.fn(async (method: string, params: any[]) => {
    if (method === failure) throw new Error('injected read/configuration failure')
    if (method.startsWith('Async.')) { if (issuedError) throw issuedError; return ref('task') }
    if (method === 'task.get_record') return task
    if (method === 'task.cancel' || method === 'task.destroy') return null
    if (method === 'host.migrate_receive') return { token: 'ephemeral-destination' }
    if (method === 'VM.assert_can_migrate') return null
    if (method === 'VM.set_name_label') { data.VM[params[0]].name_label = params[1]; return null }
    if (method === 'VM.set_name_description') { data.VM[params[0]].name_description = params[1]; return null }
    const [kind, action] = method.split('.')
    if (action === 'get_all_records') return data[kind]
    if (action === 'get_record' && data[kind]?.[params[0]]) return data[kind][params[0]]
    throw new Error(`unexpected ${method}: ${params[0]}`)
  }) }
}
async function service() { return import('../../src/main/xapi/services/vm-copy.service') }
async function restart() {
  vi.resetModules()
  const { configureJsonStoreDirectory } = await import('../../src/main/persistence/json-store')
  configureJsonStoreDirectory(directory)
  return service()
}
function disconnectTarget() { delete env.clients.target; env.infos.target.state = 'error' }
async function submitted() {
  await vi.waitFor(() => expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1))
}
function crossPayload() { return { ...payload, mode: 'cross-pool-copy' as const, targetConnectionId: 'target', targetHostRef: ref('host'), transferNetworkRef: ref('target-net'), storageMap: { [ref('vdi')]: ref('target-sr') }, networkMap: { [ref('vif')]: ref('target-net') } } }
function addCd(vmRef = ref('vm'), vdiRef = 'OpaqueRef:NULL') {
  const vbdRef = `${vmRef}-cd`
  sourceRecords.VM[vmRef].VBDs.push(vbdRef)
  sourceRecords.VBD[vbdRef] = { type: 'CD', userdevice: '3', VDI: vdiRef, empty: vdiRef === 'OpaqueRef:NULL' }
  return sourceRecords.VBD[vbdRef]
}
beforeEach(async () => {
  vi.resetModules()
  directory = mkdtempSync(join(tmpdir(), 'vm-copy-'))
  const { configureJsonStoreDirectory } = await import('../../src/main/persistence/json-store')
  configureJsonStoreDirectory(directory)
  failure = ''; issuedError = undefined
  sourceRecords = records(); targetRecords = records(true)
  source = makeClient(sourceRecords); destination = makeClient(targetRecords)
  env.clients = { source, target: destination }
  env.infos = { source: { id: 'source', poolUuid: 'source-pool', poolName: 'Source Pool', state: 'connected' }, target: { id: 'target', poolUuid: 'target-pool', poolName: 'Target Pool', state: 'connected' } }
  task = { status: 'pending', progress: 0.4, allowed_operations: ['cancel'] }
})
afterEach(() => { vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }) })

describe('durable VM and template copies', () => {
  it('returns an accepted operation before cloning and verifies distinct disks, identity and retained source', async () => {
    const api = await service()
    const op = await api.startVmCopy('source', payload)
    expect(op.status).toBe('preparing')
    await submitted()
    expect(source.callWithSession).toHaveBeenCalledWith('Async.VM.clone', [ref('vm'), 'Copy'])
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'pending', taskRef: ref('task'), progress: 40, cancellable: true })
    task = { status: 'success', result: `<value><string>${ref('new')}</string></value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'completed', vmRef: ref('new'), vmUuid: 'copy-uuid', progress: 100 })
    expect(source.callWithSession).toHaveBeenCalledWith('task.destroy', [ref('task')])
  })
  it('uses full Async.VM.copy and reports description errors as a warning on the created copy', async () => {
    const api = await service()
    await api.startVmCopy('source', { ...payload, mode: 'copy', targetSrRef: ref('sr'), nameDescription: 'new description' })
    await submitted(); failure = 'VM.set_name_description'; task = { status: 'success', result: `<value>${ref('new')}</value>` }
    const [op] = await api.getCopyOperations()
    expect(op).toMatchObject({ status: 'completed', vmRef: ref('new') })
    expect(op.warnings.join('')).toContain('描述设置未确认')
    expect(source.callWithSession).toHaveBeenCalledWith('Async.VM.copy', [ref('vm'), 'Copy', ref('sr')])
  })
  it('copies user templates with the template flag preserved', async () => {
    sourceRecords.VM[ref('vm')].is_a_template = true; sourceRecords.VM[ref('new')].is_a_template = true
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'completed', isTemplate: true })
  })
  it('rejects a running source before any copy is issued', async () => {
    sourceRecords.VM[ref('vm')].power_state = 'Running'
    await expect((await service()).startVmCopy('source', payload)).rejects.toMatchObject({ code: 'COPY_BLOCKED' })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m.startsWith('Async.'))).toBe(false)
  })
  it('deduplicates concurrent starts for the same source', async () => {
    const api = await service()
    const [a, b] = await Promise.all([api.startVmCopy('source', payload), api.startVmCopy('source', payload)])
    expect(a.id).toBe(b.id); await submitted()
  })
  it('does not expire a pending transfer after ten minutes', async () => {
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect((await api.getCopyOperations())[0].status).toBe('pending')
  })
  it('keeps unknown read outcomes and recovers the same task without replaying a copy', async () => {
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    failure = 'task.get_record'; expect((await api.getCopyOperations())[0].status).toBe('unknown')
    failure = ''; task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0].status).toBe('completed')
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it('keeps a lost start acknowledgement unknown and blocks another mutation', async () => {
    issuedError = Object.assign(new Error('connection reset'), { details: { kind: 'transport' } })
    const api = await service(); const first = await api.startVmCopy('source', payload); await submitted()
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', id: first.id })
    const restored = await restart()
    expect((await restored.getCopyOperations())[0]).toMatchObject({ status: 'unknown', id: first.id })
    expect((await restored.startVmCopy('source', payload)).id).toBe(first.id)
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it('records a definitive XAPI rejection as failed', async () => {
    issuedError = Object.assign(new Error('denied'), { details: { kind: 'xapi' } })
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    expect((await api.getCopyOperations())[0].status).toBe('failed')
  })
  it('restores the original task after a main process restart', async () => {
    const api = await service(); const op = await api.startVmCopy('source', payload); await submitted()
    vi.resetModules()
    const { configureJsonStoreDirectory } = await import('../../src/main/persistence/json-store'); configureJsonStoreDirectory(directory)
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await (await service()).getCopyOperations())[0]).toMatchObject({ id: op.id, status: 'completed' })
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it.each(['preparing', 'unknown'])('finishes an unissued %s record after restart and allows an explicit new copy', async (status) => {
    vi.useFakeTimers()
    const api = await service(); const first = await api.startVmCopy('source', payload)
    const path = join(directory, 'vm-copies.json')
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved.data[0].issued).toBe(false)
    saved.data[0].operation.status = status
    writeFileSync(path, JSON.stringify(saved))
    vi.clearAllTimers(); vi.useRealTimers()
    const restored = await restart()
    expect((await restored.getCopyOperations())[0]).toMatchObject({ id: first.id, status: 'failed', cancellable: false, message: expect.stringContaining('尚未提交') })
    expect(JSON.parse(readFileSync(path, 'utf8')).data[0].operation.status).toBe('failed')
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m.startsWith('Async.'))).toBe(false)
    const second = await restored.startVmCopy('source', payload)
    expect(second.id).not.toBe(first.id)
    await submitted()
  })
  it.each(['Task', 'VM'])('reconciles an existing %s identity conservatively even if its saved issuance flag is false', async (identity) => {
    const api = await service(); const first = await api.startVmCopy('source', payload); await submitted()
    const path = join(directory, 'vm-copies.json')
    const saved = JSON.parse(readFileSync(path, 'utf8')); saved.data[0].issued = false
    if (identity === 'VM') { delete saved.data[0].operation.taskRef; saved.data[0].operation.vmRef = ref('new') }
    writeFileSync(path, JSON.stringify(saved))
    const restored = await restart()
    expect((await restored.getCopyOperations())[0]).toMatchObject(identity === 'Task'
      ? { id: first.id, status: 'pending', taskRef: ref('task') }
      : { id: first.id, status: 'completed', vmRef: ref('new') })
    if (identity === 'Task') expect((await restored.startVmCopy('source', payload)).id).toBe(first.id)
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it('rebinds only to a reconnected pool with the same UUID', async () => {
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    env.infos.source.poolUuid = 'other-pool'; delete env.clients.source
    expect((await api.getCopyOperations())[0].status).toBe('unknown')
    env.infos.reconnected = { ...env.infos.source, id: 'reconnected', poolUuid: 'source-pool' }; env.clients.reconnected = source
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'pending', sourceConnectionId: 'reconnected', targetConnectionId: 'reconnected' })
  })
  it('retains the created reference when source disk relationships fail confirmation', async () => {
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    sourceRecords.VBD[ref('vbd')].VDI = ref('new-vdi'); task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new') })
  })
  it('rejects a copied VM that still references the original VDI', async () => {
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    sourceRecords.VBD[ref('new-vbd')].VDI = ref('vdi'); task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0].status).toBe('unknown')
  })
  it('requests cancellation once and waits for the original task terminal state', async () => {
    const api = await service(); const op = await api.startVmCopy('source', payload); await submitted(); await api.getCopyOperations()
    await Promise.all([api.cancelCopy(op.id), api.cancelCopy(op.id)])
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m === 'task.cancel')).toHaveLength(1)
    expect((await api.getCopyOperations())[0].status).toBe('cancelling')
    task = { status: 'cancelled' }; expect((await api.getCopyOperations())[0].status).toBe('cancelled')
  })
  it('does not label a task cancelled if it completes while cancellation is requested', async () => {
    const api = await service(); const op = await api.startVmCopy('source', payload); await submitted()
    await api.cancelCopy(op.id); task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0].status).toBe('completed')
  })
  it('queues a cancellation behind an in-flight progress read instead of dropping the click', async () => {
    const api = await service(); const op = await api.startVmCopy('source', payload); await submitted()
    const original = source.callWithSession.getMockImplementation()!
    let finish!: (value: any) => void
    let firstRead = true
    source.callWithSession.mockImplementation((method: string, params: any[]) => {
      if (method === 'task.get_record' && firstRead) { firstRead = false; return new Promise((resolve) => { finish = resolve }) }
      return original(method, params)
    })
    const observation = api.getCopyOperations()
    const cancellation = api.cancelCopy(op.id)
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m === 'task.cancel')).toBe(false)
    finish(task)
    await observation
    expect(await cancellation).toMatchObject({ status: 'cancelling' })
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m === 'task.cancel')).toHaveLength(1)
  })
  it('blocks copying when pool identity cannot be confirmed', async () => {
    delete env.infos.source.poolUuid
    await expect((await service()).startVmCopy('source', payload)).rejects.toMatchObject({ code: 'COPY_POOL_IDENTITY_UNCONFIRMED' })
  })
  it('supports cross-pool copies through host-to-host transfer with explicit maps', async () => {
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    expect(destination.callWithSession).toHaveBeenCalledWith('host.migrate_receive', [ref('host'), ref('target-net'), {}])
    expect(source.callWithSession).toHaveBeenCalledWith('Async.VM.migrate_send', [ref('vm'), { token: 'ephemeral-destination' }, true, crossPayload().storageMap, crossPayload().networkMap, { copy: 'true' }, {}])
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'completed', targetConnectionId: 'target', vmRef: ref('new') })
  })
  it.each([false, true])('blocks cross-pool copy with mounted media before any mutation (template=%s)', async (isTemplate) => {
    sourceRecords.VM[ref('vm')].is_a_template = isTemplate
    const cd = addCd(ref('vm'), ref('iso'))
    const api = await service()
    const plan = await api.getVmCopyPlan('source', ref('vm'), 'target')
    expect(plan.allowedModes).toEqual([])
    expect(plan.blockers).toContain('源光驱 3 已挂载 ISO；跨池复制会弹出源介质，请先手动弹出并重新读取预检')
    await expect(api.startVmCopy('source', crossPayload())).rejects.toMatchObject({ code: 'COPY_BLOCKED' })
    expect(source.callWithSession.mock.calls.some(([method]: string[]) => method.startsWith('Async.') || method === 'VBD.eject')).toBe(false)
    expect(destination.callWithSession).not.toHaveBeenCalledWith('host.migrate_receive', expect.anything())
    expect(cd).toMatchObject({ VDI: ref('iso'), empty: false })
  })
  it.each(['clone', 'copy'] as const)('keeps same-pool %s available with mounted media', async (mode) => {
    const cd = addCd(ref('vm'), ref('iso'))
    const api = await service()
    await api.startVmCopy('source', { ...payload, mode, ...(mode === 'copy' ? { targetSrRef: ref('sr') } : {}) })
    await submitted()
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0].status).toBe('completed')
    expect(cd).toMatchObject({ VDI: ref('iso'), empty: false })
    expect(source.callWithSession).not.toHaveBeenCalledWith('VBD.eject', expect.anything())
  })
  it('restores and confirms a cross-pool copy with an empty source CD drive', async () => {
    addCd()
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    const restored = await restart()
    expect((await restored.getCopyOperations())[0].status).toBe('completed')
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it('rechecks mounted media after accepting an operation but before submitting it', async () => {
    const cd = addCd()
    vi.useFakeTimers()
    const api = await service(); await api.startVmCopy('source', crossPayload())
    Object.assign(cd, { VDI: ref('iso'), empty: false })
    await vi.runAllTimersAsync()
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('已挂载 ISO') })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m.startsWith('Async.'))).toBe(false)
    expect(destination.callWithSession).not.toHaveBeenCalledWith('host.migrate_receive', expect.anything())
  })
  it('retains the result as unknown when the source CD medium changes during copying', async () => {
    const cd = addCd()
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    Object.assign(cd, { VDI: ref('iso'), empty: false })
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new'), message: expect.stringContaining('光驱关系发生变化') })
    expect(source.callWithSession).not.toHaveBeenCalledWith('task.destroy', expect.anything())
  })
  it('permits historical mounted media but checks that its source relationship survives copying', async () => {
    sourceRecords.VM[ref('vm')].snapshots = [ref('snapshot')]
    sourceRecords.VM[ref('snapshot')] = { uuid: 'snapshot-uuid', VBDs: [], VIFs: [] }
    const cd = addCd(ref('snapshot'), ref('iso'))
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    Object.assign(cd, { VDI: 'OpaqueRef:NULL', empty: true })
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new'), message: expect.stringContaining('光驱关系发生变化') })
    expect(source.callWithSession).not.toHaveBeenCalledWith('task.destroy', expect.anything())
  })
  it('does not invent a source CD baseline for an older saved operation or replay its copy', async () => {
    addCd()
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    const path = join(directory, 'vm-copies.json'), saved = JSON.parse(readFileSync(path, 'utf8'))
    const fingerprint = JSON.parse(saved.data[0].sourceFingerprint)
    for (const member of fingerprint) delete member.cds
    saved.data[0].sourceFingerprint = JSON.stringify(fingerprint)
    writeFileSync(path, JSON.stringify(saved))
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    const restored = await restart()
    expect((await restored.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new') })
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it('rejects incomplete historical VIF, disk and suspend-image maps before mutation', async () => {
    const vm = sourceRecords.VM[ref('vm')]; vm.snapshots = [ref('snapshot')]
    sourceRecords.VM[ref('snapshot')] = { ...vm, uuid: 'snapshot-uuid', name_label: 'History', power_state: 'Suspended', VBDs: [ref('history-vbd')], VIFs: [ref('history-vif')], suspend_VDI: ref('suspend') }
    sourceRecords.VBD[ref('history-vbd')] = { type: 'Disk', VDI: ref('history-disk'), userdevice: '1' }
    sourceRecords.VDI[ref('history-disk')] = { SR: ref('sr'), virtual_size: 500 }
    sourceRecords.VDI[ref('suspend')] = { SR: ref('sr'), virtual_size: 200 }
    sourceRecords.VIF[ref('history-vif')] = { network: ref('net'), device: '1' }
    const api = await service(); const plan = await api.getVmCopyPlan('source', ref('vm'), 'target')
    expect(plan.disks.map((d) => d.vdiRef)).toEqual([ref('vdi'), ref('history-disk'), ref('suspend')])
    expect(plan.vifs.map((v) => v.vifRef)).toContain(ref('history-vif'))
    await expect(api.startVmCopy('source', crossPayload())).rejects.toMatchObject({ code: 'COPY_STORAGE_MAP_INCOMPLETE' })
    const p = crossPayload(); Object.assign(p.storageMap, { [ref('history-disk')]: ref('target-sr'), [ref('suspend')]: ref('target-sr') })
    await expect(api.startVmCopy('source', p)).rejects.toMatchObject({ code: 'COPY_NETWORK_MAP_INCOMPLETE' })
  })
  it('filters disconnected, read-only, full SRs and unreachable networks', async () => {
    const data = targetRecords
    data.SR[ref('readonly')] = { ...data.SR[ref('target-sr')], allowed_operations: [] }
    data.PBD[ref('readonly-pbd')] = { ...data.PBD[ref('pbd')], SR: ref('readonly') }
    data.SR[ref('full')] = { ...data.SR[ref('target-sr')], physical_utilisation: '2048' }
    data.PBD[ref('full-pbd')] = { ...data.PBD[ref('pbd')], SR: ref('full') }
    data.SR[ref('detached')] = { ...data.SR[ref('target-sr')] }
    data.network[ref('internal')] = { name_label: 'Internal', PIFs: [] }
    data.PIF[ref('pif')].IP = ''
    const plan = await (await service()).getVmCopyPlan('source', ref('vm'), 'target')
    expect(plan.srs.map((s) => s.ref)).toEqual([ref('target-sr')])
    expect(plan.networks.find((n) => n.ref === ref('target-net'))?.transferHostRefs).toEqual([])
    expect(plan.networks.find((n) => n.ref === ref('internal'))?.hostRefs).toContain(ref('host'))
    await expect((await service()).startVmCopy('source', crossPayload())).rejects.toMatchObject({ code: 'COPY_TRANSFER_UNAVAILABLE' })
  })
  it.each(['new', 'restored'])('confirms a %s cross-pool copy without destination snapshot metadata while retaining the source history and transfer maps', async (state) => {
    sourceRecords.VM[ref('vm')].snapshots = [ref('snapshot')]
    sourceRecords.VM[ref('snapshot')] = { uuid: 'snapshot-uuid', name_label: 'History', snapshot_time: '20261022T12:00:00Z', power_state: 'Suspended', VBDs: [ref('history-vbd')], VIFs: [ref('history-vif')], suspend_VDI: ref('suspend') }
    sourceRecords.VBD[ref('history-vbd')] = { type: 'Disk', VDI: ref('history-disk'), userdevice: '1' }
    sourceRecords.VDI[ref('history-disk')] = { SR: ref('sr'), virtual_size: 500 }
    sourceRecords.VDI[ref('suspend')] = { SR: ref('sr'), virtual_size: 200 }
    sourceRecords.VIF[ref('history-vif')] = { network: ref('net'), device: '1' }
    const p = crossPayload()
    Object.assign(p.storageMap, { [ref('history-disk')]: ref('target-sr'), [ref('suspend')]: ref('target-sr') })
    Object.assign(p.networkMap, { [ref('history-vif')]: ref('target-net') })
    const api = await service(); await api.startVmCopy('source', p); await submitted()
    expect(source.callWithSession).toHaveBeenCalledWith('Async.VM.migrate_send', expect.arrayContaining([p.storageMap, p.networkMap, { copy: 'true' }]))
    expect(targetRecords.VM[ref('new')].snapshots).toEqual([])
    let observer = api
    if (state === 'restored') {
      const path = join(directory, 'vm-copies.json')
      const saved = JSON.parse(readFileSync(path, 'utf8'))
      Object.assign(saved.data[0].operation, { status: 'unknown', vmRef: ref('new'), message: '副本的快照历史数量与源对象不一致' })
      writeFileSync(path, JSON.stringify(saved))
      observer = await restart()
    }
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await observer.getCopyOperations())[0]).toMatchObject({ status: 'completed', vmUuid: 'copy-uuid' })
    expect(sourceRecords.VM[ref('vm')].snapshots).toEqual([ref('snapshot')])
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
    expect(source.callWithSession).toHaveBeenCalledWith('task.destroy', [ref('task')])
  })
  it.each(['disk size', 'disk SR', 'network'])('keeps a cross-pool result unconfirmed when its current %s differs', async (device) => {
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    if (device === 'disk size') targetRecords.VDI[ref('new-vdi')].virtual_size = '2048'
    if (device === 'disk SR') targetRecords.VDI[ref('new-vdi')].SR = ref('wrong-sr')
    if (device === 'network') targetRecords.VIF[ref('new-vif')].network = ref('wrong-net')
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new'), message: expect.stringContaining('映射未通过核对') })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m === 'task.destroy')).toBe(false)
  })
  it('still checks that source snapshot relationships survive a cross-pool copy', async () => {
    sourceRecords.VM[ref('vm')].snapshots = [ref('snapshot')]
    sourceRecords.VM[ref('snapshot')] = { uuid: 'snapshot-uuid', VBDs: [], VIFs: [] }
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    sourceRecords.VM[ref('vm')].snapshots = []
    task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new'), message: expect.stringContaining('源对象或磁盘、网卡、光驱关系发生变化') })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m === 'task.destroy')).toBe(false)
  })
  it('observes and cancels a source Task while the destination management connection is unavailable', async () => {
    const api = await service(); const op = await api.startVmCopy('source', crossPayload()); await submitted()
    disconnectTarget()
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'pending', progress: 40, cancellable: true })
    expect(await api.cancelCopy(op.id)).toMatchObject({ status: 'cancelling' })
    expect(source.callWithSession).toHaveBeenCalledWith('task.cancel', [ref('task')])
    task = { status: 'cancelled' }
    expect((await api.getCopyOperations())[0].status).toBe('cancelled')
    expect(source.callWithSession).toHaveBeenCalledWith('task.destroy', [ref('task')])
  })
  it.each(['failure', 'cancelled'])('restores and cleans a %s source Task without the destination connection', async (status) => {
    const api = await service(); const op = await api.startVmCopy('source', crossPayload()); await submitted()
    disconnectTarget(); task = { status, error_info: ['COPY_FAILED'] }
    const restored = await restart()
    expect((await restored.getCopyOperations())[0]).toMatchObject({ id: op.id, status: status === 'failure' ? 'failed' : 'cancelled' })
    expect(source.callWithSession).toHaveBeenCalledWith('task.destroy', [ref('task')])
  })
  it('retains a successful result offline and verifies only after the original destination pool reconnects', async () => {
    const api = await service(); const op = await api.startVmCopy('source', crossPayload()); await submitted()
    disconnectTarget(); task = { status: 'success', result: `<value>${ref('new')}</value>` }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new'), cancellable: false })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m === 'task.destroy')).toBe(false)
    env.infos.target = { ...env.infos.target, poolUuid: 'replacement-pool', state: 'connected' }; env.clients.target = destination
    const restored = await restart()
    expect((await restored.getCopyOperations())[0]).toMatchObject({ status: 'unknown', vmRef: ref('new') })
    env.infos.reconnected = { ...env.infos.target, id: 'reconnected', poolUuid: 'target-pool' }; env.clients.reconnected = destination
    expect((await restored.getCopyOperations())[0]).toMatchObject({ id: op.id, status: 'completed', targetConnectionId: 'reconnected', vmUuid: 'copy-uuid' })
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
    expect(source.callWithSession).toHaveBeenCalledWith('task.destroy', [ref('task')])
  })
  it('rejects a source Task response if its pool identity changed during the read', async () => {
    const api = await service(); await api.startVmCopy('source', crossPayload()); await submitted()
    const original = source.callWithSession.getMockImplementation()!
    source.callWithSession.mockImplementation(async (method: string, params: any[]) => {
      const result = await original(method, params)
      if (method === 'task.get_record') env.infos.source.poolUuid = 'replacement-pool'
      return result
    })
    task = { status: 'failure' }
    expect((await api.getCopyOperations())[0]).toMatchObject({ status: 'unknown', message: expect.stringContaining('观察期间发生变化') })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m === 'task.destroy')).toBe(false)
  })
  it('keeps confirmed completion when task cleanup fails and retries only cleanup', async () => {
    const api = await service(); await api.startVmCopy('source', payload); await submitted()
    failure = 'task.destroy'; task = { status: 'success', result: `<value>${ref('new')}</value>` }
    const [completed] = await api.getCopyOperations()
    expect(completed.status).toBe('completed')
    expect(completed.warnings.join('')).toContain('服务器任务记录尚未清理')
    failure = ''; await api.getCopyOperations(); await api.getCopyOperations()
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m === 'task.destroy')).toHaveLength(2)
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m.startsWith('Async.'))).toHaveLength(1)
  })
  it('does not submit after the destination pool identity changes during migration preflight', async () => {
    const original = source.callWithSession.getMockImplementation()!
    source.callWithSession.mockImplementation(async (method: string, params: any[]) => {
      const result = await original(method, params)
      if (method === 'VM.assert_can_migrate') env.infos.target.poolUuid = 'replacement-pool'
      return result
    })
    const api = await service(); await api.startVmCopy('source', crossPayload())
    await vi.waitFor(async () => expect((await api.getCopyOperations())[0].status).toBe('failed'))
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m.startsWith('Async.'))).toBe(false)
  })
  it('does not cancel through a source connection whose identity changed while reading the task', async () => {
    const api = await service(); const op = await api.startVmCopy('source', payload); await submitted()
    const original = source.callWithSession.getMockImplementation()!
    source.callWithSession.mockImplementation(async (method: string, params: any[]) => {
      const result = await original(method, params)
      if (method === 'task.get_record') env.infos.source.poolUuid = 'replacement-pool'
      return result
    })
    await expect(api.cancelCopy(op.id)).rejects.toMatchObject({ code: 'COPY_SCOPE_CHANGED' })
    expect(source.callWithSession.mock.calls.some(([m]: string[]) => m === 'task.cancel')).toBe(false)
  })
  it('does not hard reject thin provisioning based on virtual disk size', async () => {
    sourceRecords.VDI[ref('vdi')].virtual_size = '999999'
    const api = await service(); await expect(api.startVmCopy('source', { ...payload, mode: 'copy', targetSrRef: ref('sr') })).resolves.toHaveProperty('id')
    await submitted()
  })
  it('uses one bulk request per inventory class instead of per-SR queries', async () => {
    const api = await service(); await api.getVmCopyPlan('source', ref('vm'), 'source')
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m === 'SR.get_all_records')).toHaveLength(1)
    expect(source.callWithSession.mock.calls.filter(([m]: string[]) => m === 'SR.get_record')).toHaveLength(0)
  })
})
