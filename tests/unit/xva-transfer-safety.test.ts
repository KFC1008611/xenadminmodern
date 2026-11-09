import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { xva, xmlRpc, diskChunk } from '../helpers/xva'
import { vmImportProgressContract, vmExportProgressContract } from '../../src/shared/ipc-contracts/vm'

const mocks = vi.hoisted(() => ({ call: vi.fn(), http: vi.fn(), read: vi.fn(), write: vi.fn(), resources: vi.fn(), cleanup: vi.fn(), poolUuid: 'pool-A', epoch: 1 }))
vi.mock('../../src/main/xapi/connection-manager', () => {
  const client = { callWithSession: mocks.call, getAuthenticatedHttpContext: () => ({ scheme: 'http:', host: '127.0.0.1', port: 1, sessionId: 'fixture', tls: {} }) }
  return { connectionManager: { getClient: () => client, getConnectionInfo: () => ({ poolUuid: mocks.poolUuid, epoch: mocks.epoch }) } }
})
vi.mock('../../src/main/xapi/http-data-plane', () => ({ requestXapiHttp: mocks.http }))
vi.mock('../../src/main/persistence/json-store', () => ({ readJsonStore: mocks.read, writeJsonStore: mocks.write }))
vi.mock('../../src/main/xapi/services/vm.service', () => ({ deleteVmSnapshot: mocks.cleanup }))
vi.mock('../../src/main/xapi/services/vm-creation.service', () => ({ getVmCreationResources: mocks.resources }))

let directory: string
const vm = { uuid: 'vm-uuid', name_label: 'VM', power_state: 'Halted', is_a_template: false, affinity: 'OpaqueRef:NULL', allowed_operations: ['export'], current_operations: {} }
const resources = () => ({ hosts: [{ ref: 'OpaqueRef:host' }], srs: [{ ref: 'OpaqueRef:sr', freeBytes: 1e12, hostRefs: ['OpaqueRef:host'] }], networks: [], isos: [] })
const response = (data = xva()) => Object.assign(Readable.from([data]), { statusCode: 200, headers: {} })
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  mocks.poolUuid = 'pool-A'; mocks.epoch = 1
  directory = mkdtempSync(join(tmpdir(), 'xva-safety-'))
  mocks.read.mockReturnValue({ exports: [], imports: [] })
  mocks.cleanup.mockResolvedValue({ failedVdiRefs: [] })
  mocks.resources.mockResolvedValue(resources())
  mocks.call.mockImplementation(async (method: string) => {
    if (method === 'VM.get_VBDs' || method === 'VM.get_VIFs') return []
    if (method === 'VM.get_record') return vm
    if (method === 'task.create') return 'OpaqueRef:task'
    if (method === 'task.get_record') return { status: 'success', result: '<value>OpaqueRef:imported-vm</value>' }
    return null
  })
  mocks.http.mockImplementation(async () => response())
})
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

it('reserves a normalized destination for one active export', async () => {
  const service = await import('../../src/main/xapi/services/vm-import.service')
  let finish!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  mocks.http.mockImplementationOnce(async () => { await gate; return response() })
  const filePath = join(directory, 'same.xva')
  const first = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath, powerState: 'Halted', exportMode: 'force' })
  await expect(service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath, powerState: 'Halted', exportMode: 'force' })).rejects.toMatchObject({ code: 'EXPORT_PATH_BUSY' })
  finish()
  await vi.waitFor(() => expect(service.getExportProgress(first.exportId)).toMatchObject({ status: 'completed', cleanupPending: false }))
})

it('never overwrites a file created after export acceptance and preserves the validated partial', async () => {
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const filePath = join(directory, 'out.xva')
  mocks.http.mockImplementation(async () => { writeFileSync(filePath, 'other-file'); return response() })
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath, powerState: 'Halted', exportMode: 'force' })
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('failed'))
  expect(readFileSync(filePath, 'utf8')).toBe('other-file')
  expect(existsSync(`${filePath}.partial-${exportId}`)).toBe(true)
})

it('returns an operation before checkpoint acceptance, persists uncertainty and never repeats checkpoint creation', async () => {
  let rejectPreparation!: (error: unknown) => void
  const preparation = new Promise((_resolve, reject) => { rejectPreparation = reject })
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') return { ...vm, power_state: 'Running', allowed_operations: ['checkpoint'] }
    if (method === 'Async.VM.checkpoint') return preparation
    if (method === 'VM.get_snapshots') return []
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'out.xva'), exportMode: 'snapshot', powerState: 'Running' })
  expect(service.getExportProgress(exportId)?.status).toBe('pending')
  rejectPreparation(Object.assign(new Error('response lost'), { code: 'ECONNRESET', details: { kind: 'transport' } }))
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('unknown'))
  await service.recoverTransfersForConnection('A')
  expect(mocks.call.mock.calls.filter(([method]) => method === 'Async.VM.checkpoint')).toHaveLength(1)
  expect(mocks.http).not.toHaveBeenCalled()
})

it('rejects arbitrary bytes with a zero tail as an export archive', async () => {
  const invalid = Buffer.alloc(2048); invalid.write('not TAR')
  mocks.http.mockResolvedValue(response(invalid))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const filePath = join(directory, 'out.xva')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath, powerState: 'Halted', exportMode: 'force' })
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('failed'))
  expect(existsSync(filePath)).toBe(false)
})

it('publishes a valid export containing XAPI keepalives instead of deleting the download', async () => {
  const size = 3 * 1048576
  const archive = xva(`<appliance><vm><label>VM</label></vm><vdi id="Ref:1" size="${size}"/></appliance>`, [
    ...diskChunk('Ref:1', 0, Buffer.alloc(1048576, 1)),
    ...diskChunk('Ref:1', 1, Buffer.alloc(0)),
    ...diskChunk('Ref:1', 2, Buffer.alloc(1048576, 2)),
    ...diskChunk('Ref:1', 3, Buffer.alloc(1048576, 3)),
  ])
  mocks.http.mockResolvedValue(response(archive))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const filePath = join(directory, 'keepalive.xva')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath, powerState: 'Halted', exportMode: 'force' })
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('completed'))
  expect(readFileSync(filePath)).toEqual(archive)
  expect(existsSync(`${filePath}.partial-${exportId}`)).toBe(false)
})

it.each([false, true])('reports download bytes and validation separately, using only a real content length (known=%s)', async (known) => {
  const data = xva()
  const half = Math.floor(data.length / 2)
  const stream = Object.assign(new Readable({ read() {} }), { statusCode: 200, headers: known ? { 'content-length': String(data.length) } : {} })
  mocks.http.mockResolvedValue(stream)
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_VBDs') return ['OpaqueRef:vbd']
    if (method === 'VBD.get_record') return { VDI: 'OpaqueRef:vdi', type: 'Disk', empty: false }
    if (method === 'VDI.get_record') return { virtual_size: String(4 * 1024 ** 2) }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId, estimatedBytes } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'stream.xva'), powerState: 'Halted', exportMode: 'force' })
  expect(estimatedBytes).toBeGreaterThan(data.length)
  stream.push(data.subarray(0, half))
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.bytesTransferred).toBe(half))
  const progress = vmExportProgressContract.resultSchema.parse(service.getExportProgress(exportId))!
  expect(progress.phase).toBe('transferring')
  expect(progress.bytesTotal).toBe(known ? data.length : 0)
  expect(progress.progress).toBe(known ? half / data.length * 100 : -1)
  expect(progress.transfer).toMatchObject({ bytesTransferred: half, bytesTotal: known ? data.length : 0, elapsedMs: expect.any(Number) })
  stream.push(data.subarray(half)); stream.push(null)
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('completed'))
  expect(service.getExportProgress(exportId)?.validation).toMatchObject({ bytesChecked: data.length, bytesTotal: data.length })
  const scans = mocks.write.mock.calls.flatMap(([, saved]) => saved.exports ?? []).map((entry) => entry.progress).filter((entry) => entry.phase === 'validating')
  expect(scans).toEqual(expect.arrayContaining([expect.objectContaining({ progress: 0 }), expect.objectContaining({ progress: 100 })]))
})

it('reports actual upload bytes and unweighted server progress without exposing timing internals', async () => {
  const data = xva('<appliance><vm><label>VM</label></vm><vdi id="Ref:1" size="1048576"/></appliance>', diskChunk('Ref:1', 0, Buffer.alloc(1048576)))
  const filePath = join(directory, 'upload.xva'); writeFileSync(filePath, data)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let firstBytes = 0
  mocks.http.mockImplementation(async (options) => {
    for await (const chunk of options.bodyFactory()) {
      if (!firstBytes) { firstBytes = chunk.length; await gate }
    }
    return response()
  })
  let finish = false
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => method === 'task.get_record'
    ? finish ? { status: 'failure', error_info: ['fixture finished'] } : { status: 'pending', progress: 0.37 }
    : base(method, args))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
  await vi.waitFor(() => expect(firstBytes).toBeGreaterThan(0))
  const upload = vmImportProgressContract.resultSchema.parse(service.getImportProgress(id))!
  expect(upload.status).toBe('uploading')
  expect(upload.transfer).toMatchObject({ bytesTotal: data.length, elapsedMs: expect.any(Number) })
  expect(upload.progress).toBe(upload.transfer!.bytesTransferred / data.length * 100)
  expect(upload).not.toHaveProperty('transferStartedAt')
  release()
  await vi.waitFor(() => expect(service.getImportProgress(id)).toMatchObject({ status: 'waiting_for_task', progress: 37 }))
  expect(service.getImportProgress(id)?.transfer?.bytesTransferred).toBe(data.length)
  finish = true
  await vi.waitFor(() => expect(service.getImportProgress(id)?.status).toBe('failed'), { timeout: 2500 })
})

it('checks the complete archive before uploading declared disks', async () => {
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, xva('<appliance><vm><label>VM</label></vm><vdi size="68719476736"/></appliance>'))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  expect((await service.getImportPreview(filePath)).diskCount).toBe(1)
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
  await vi.waitFor(() => expect(service.getImportProgress(id)?.status).toBe('failed'))
  expect(mocks.http).not.toHaveBeenCalled()
  expect(service.getImportProgress(id)?.validation?.bytesChecked).toBeLessThan(service.getImportProgress(id)!.validation!.bytesTotal)
})

it('finishes local validation before sending an import request and retains scan counters', async () => {
  const data = xva()
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, data)
  const service = await import('../../src/main/xapi/services/vm-import.service')
  let id: string
  mocks.http.mockImplementation(async () => {
    expect(vmImportProgressContract.resultSchema.parse(service.getImportProgress(id))).toMatchObject({ status: 'uploading', validation: { bytesChecked: data.length, bytesTotal: data.length, elapsedMs: expect.any(Number) } })
    return response()
  })
  id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
  expect(vmImportProgressContract.resultSchema.parse(service.getImportProgress(id))?.status).toBe('validating')
  await vi.waitFor(() => expect(service.getImportProgress(id)?.status).toBe('completed'))
  expect(mocks.http).toHaveBeenCalledOnce()
})

it.each(['disconnected', 'full', 'disabled', 'network'])('rejects incompatible placement before creating a Task (%s)', async (kind) => {
  const r = resources()
  if (kind === 'disconnected') r.srs[0].hostRefs = []
  if (kind === 'full') r.srs[0].freeBytes = 0
  if (kind === 'disabled') r.hosts = []
  mocks.resources.mockResolvedValue(r)
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, xva())
  const service = await import('../../src/main/xapi/services/vm-import.service')
  await expect(service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', homeServerRef: 'OpaqueRef:host', vifMappings: kind === 'network' ? { '0': 'OpaqueRef:missing' } : {} })).rejects.toThrow()
  expect(mocks.http).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalledWith('task.create', expect.anything())
})

it('keeps an imported object unknown until Home Server is actually read back, then recovers by identity without writes', async () => {
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, xva())
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', homeServerRef: 'OpaqueRef:host', vifMappings: {} })
  await vi.waitFor(() => expect(service.getImportProgress(id)?.status).toBe('unknown'))
  expect(service.getImportProgress(id)?.vmRef).toBe('OpaqueRef:imported-vm')
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => method === 'VM.get_record' ? { ...vm, affinity: 'OpaqueRef:host' } : base(method, args))
  mocks.call.mockClear()
  await service.recoverTransfersForConnection('A')
  await vi.waitFor(() => expect(service.getImportProgress(id)?.status).toBe('completed'))
  expect(mocks.call).not.toHaveBeenCalledWith('VM.set_affinity', expect.anything())
})

it('verifies template identity after import', async () => {
  const filePath = join(directory, 'in.xva')
  writeFileSync(filePath, xva(xmlRpc({ objects: [{ class: 'VM', id: 'Ref:1', snapshot: { name_label: 'Template', is_a_template: true } }] })))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
  await vi.waitFor(() => expect(service.getImportProgress(id)).toMatchObject({ status: 'unknown', vmRef: 'OpaqueRef:imported-vm' }))
  expect(service.getImportProgress(id)?.message).toContain('模板类型')
})

it('recovers configuration from a known VM even when its Task reference was previously cleared', async () => {
  mocks.read.mockReturnValue({ exports: [], imports: [{ operationId: 'saved', connectionId: 'A', originPoolUuid: 'pool-A',
    params: { srRef: 'OpaqueRef:sr', vifMappings: {} }, vmRef: 'OpaqueRef:imported-vm', vmUuid: vm.uuid,
    taskRef: null, status: 'unknown', configurationStarted: true, progress: 97, message: '', lastUpdatedAt: 1 }] })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  await service.recoverTransfersForConnection('A')
  expect(service.getImportProgress('saved')?.status).toBe('completed')
  expect(mocks.call.mock.calls.every(([method]) => String(method).includes('get_'))).toBe(true)
})

it('publishes cleanup warnings before a final export result and reports the actual size', async () => {
  let finishCleanup!: () => void
  const gate = new Promise<void>((resolve) => { finishCleanup = resolve })
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'task.destroy') { await gate; throw new Error('cleanup unavailable') }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'out.xva'), powerState: 'Halted', exportMode: 'force' })
  await vi.waitFor(() => expect(service.getExportProgress(exportId)).toMatchObject({ status: 'running', cleanupPending: true, message: '正在清理导出临时资源' }))
  finishCleanup()
  await vi.waitFor(() => expect(service.getExportProgress(exportId)).toMatchObject({ status: 'completed', cleanupPending: false, bytesTotal: xva().length, warnings: expect.arrayContaining([expect.stringContaining('清理失败')]) }))
})

it('normalizes only the owned checkpoint before exporting a VM, then verifies the readback', async () => {
  const snapshot: Record<string, unknown> = { ...vm, uuid: 'snapshot-uuid', is_a_template: true, is_a_snapshot: true, snapshot_of: 'OpaqueRef:vm', name_label: 'temporary' }
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') return args[0] === 'OpaqueRef:snapshot' ? snapshot : { ...vm, power_state: 'Running', allowed_operations: ['checkpoint'] }
    if (method === 'Async.VM.checkpoint') return 'OpaqueRef:prep'
    if (method === 'task.get_record' && args[0] === 'OpaqueRef:prep') return { status: 'success', result: '<value>OpaqueRef:snapshot</value>' }
    if (method === 'VM.set_is_a_template') { snapshot.is_a_template = args[1]; return null }
    if (method === 'VM.set_name_label') { snapshot.name_label = args[1]; return null }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'snapshot.xva'), powerState: 'Running', exportMode: 'snapshot' })
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('completed'))
  expect(mocks.call).toHaveBeenCalledWith('VM.set_is_a_template', ['OpaqueRef:snapshot', false])
  expect(mocks.call).not.toHaveBeenCalledWith('VM.set_is_a_template', ['OpaqueRef:vm', false])
  expect(mocks.http.mock.calls[0][0].query.get('uuid')).toBe('snapshot-uuid')
  expect(mocks.http.mock.calls[0][0].query.get('preserve_power_state')).toBe('true')
})

it('preserves suspended state in direct exports too', async () => {
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') return { ...vm, power_state: 'Suspended', suspend_VDI: 'OpaqueRef:ram' }
    if (method === 'VDI.get_record' && args[0] === 'OpaqueRef:ram') return { virtual_size: 4 }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId, estimatedBytes } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'suspended.xva'), powerState: 'Suspended', exportMode: 'force' })
  expect(estimatedBytes).toBe(4)
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('completed'))
  expect(mocks.http.mock.calls[0][0].query.get('preserve_power_state')).toBe('true')
})

it('includes the suspend image in capacity and verifies its imported state, SR and size', async () => {
  const filePath = join(directory, 'suspended.xva')
  writeFileSync(filePath, xva(xmlRpc({ objects: [
    { class: 'VM', id: 'Ref:1', snapshot: { name_label: 'Suspended VM', power_state: 'Suspended', suspend_VDI: 'Ref:2' } },
    { class: 'VDI', id: 'Ref:2', snapshot: { virtual_size: 4 } },
  ] }), diskChunk('Ref:2', 0, Buffer.from('RAM!'))))
  const base = mocks.call.getMockImplementation()!
  let correct = false
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') return { ...vm, power_state: 'Suspended', suspend_VDI: 'OpaqueRef:ram' }
    if (method === 'VDI.get_record') return { SR: correct ? 'OpaqueRef:sr' : 'OpaqueRef:other-sr', virtual_size: '4' }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  expect(await service.getImportPreview(filePath)).toMatchObject({ originalSize: 4, diskCount: 0, powerState: 'Suspended', suspendDiskSize: 4 })
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
  await vi.waitFor(() => expect(service.getImportProgress(id)?.message).toContain('内存镜像归属或容量'))
  expect(service.getImportProgress(id)?.status).toBe('unknown')
  correct = true
  await service.recoverTransfersForConnection('A')
  expect(service.getImportProgress(id)?.status).toBe('completed')
})

it.each(['Disk', 'Suspended'])('rejects unresolved disk metadata during preview (%s)', async (kind) => {
  const filePath = join(directory, 'missing.xva')
  writeFileSync(filePath, xva(xmlRpc({ objects: [
    { class: 'VM', id: 'Ref:1', snapshot: kind === 'Suspended' ? { power_state: 'Suspended', suspend_VDI: 'Ref:missing' } : {} },
    ...(kind === 'Disk' ? [{ class: 'VBD', id: 'Ref:3', snapshot: { type: 'Disk', VDI: 'Ref:missing' } }] : []),
  ] })))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  await expect(service.getImportPreview(filePath)).rejects.toThrow('元数据')
  expect(mocks.http).not.toHaveBeenCalled()
})

it('cancels the preparation task if cancellation arrived before its acceptance reply', async () => {
  let accept!: (ref: string) => void
  const pending = new Promise<string>((resolve) => { accept = resolve })
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') return { ...vm, power_state: 'Running', allowed_operations: ['clean_shutdown'] }
    if (method === 'Async.VM.clean_shutdown') return pending
    if (method === 'task.get_record' && args[0] === 'OpaqueRef:preparation') return { status: 'cancelled' }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'cancel.xva'), powerState: 'Running', exportMode: 'shutdown' })
  await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledWith('Async.VM.clean_shutdown', expect.anything()))
  await service.cancelExport('A', exportId)
  accept('OpaqueRef:preparation')
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('cancelled'))
  expect(mocks.call).toHaveBeenCalledWith('task.cancel', ['OpaqueRef:preparation'])
  expect(mocks.http).not.toHaveBeenCalled()
})

it('rechecks placement after the archive scan and never uploads a newly disconnected SR', async () => {
  mocks.resources.mockResolvedValueOnce(resources()).mockResolvedValueOnce({ ...resources(), srs: [] })
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, xva())
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
  await vi.waitFor(() => expect(service.getImportProgress(id)).toMatchObject({ status: 'failed', errorCode: 'SR_NOT_WRITABLE' }))
  expect(mocks.http).not.toHaveBeenCalled()
})

it('rejects stale pool and epoch drafts before creating a Task', async () => {
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, xva())
  const service = await import('../../src/main/xapi/services/vm-import.service')
  await expect(service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {}, originPoolUuid: 'pool-B', originEpoch: 1 })).rejects.toMatchObject({ code: 'IMPORT_SCOPE_CHANGED' })
  await expect(service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {}, originPoolUuid: 'pool-A', originEpoch: 0 })).rejects.toMatchObject({ code: 'IMPORT_SCOPE_CHANGED' })
  expect(mocks.call).not.toHaveBeenCalledWith('task.create', expect.anything())
})

it('stops configuration and cleanup if the client changes pools during a configuration write', async () => {
  const filePath = join(directory, 'in.xva'); writeFileSync(filePath, xva())
  mocks.resources.mockResolvedValue({ ...resources(), networks: [{ ref: 'OpaqueRef:network', hostRefs: ['OpaqueRef:host'] }] })
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.set_affinity') { mocks.poolUuid = 'pool-B'; return null }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const id = await service.importVm('A', { filePath, srRef: 'OpaqueRef:sr', homeServerRef: 'OpaqueRef:host', vifMappings: { '0': 'OpaqueRef:network' } })
  await vi.waitFor(() => expect(service.getImportProgress(id)?.status).toBe('unknown'))
  expect(service.getImportProgress(id)?.message).toContain('原资源池')
  expect(mocks.call).not.toHaveBeenCalledWith('task.destroy', expect.anything())
  expect(mocks.call).not.toHaveBeenCalledWith('VM.get_VIFs', expect.anything())
})

it.each([true, false])('restores a terminal export without leaving its legacy cleanup flag permanently pending (cleaned=%s)', async (cleanupComplete) => {
  mocks.read.mockReturnValue({ imports: [], exports: [{ id: 'saved-export', operation: { connectionId: 'A', originPoolUuid: 'pool-A', taskRef: 'OpaqueRef:old-task', cleanupComplete },
    progress: { taskId: 'saved-export', status: 'completed', progress: 100, message: '导出完成', lastUpdatedAt: 1 } }] })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  expect(service.getExportProgress('saved-export')).toMatchObject({ status: 'completed', cleanupPending: false })
  if (!cleanupComplete) expect(service.getExportProgress('saved-export')?.warnings).toContain('本地记录已恢复，临时资源清理待核对，连接原资源池后继续清理')
})

it('preserves a cancellation intent across restart and stops a completed preparation before download', async () => {
  mocks.read.mockReturnValue({ imports: [], exports: [{ id: 'saved-export', operation: {
    connectionId: 'A', originPoolUuid: 'pool-A', sourceUuid: vm.uuid, taskRef: '', cancelRequested: true,
    preparationTaskRef: 'OpaqueRef:prep', preparationIssued: true,
    params: { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'cancelled.xva'), powerState: 'Running', exportMode: 'shutdown' },
  }, progress: { taskId: 'saved-export', status: 'cancelling', progress: 0, message: '', lastUpdatedAt: 1 } }] })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  await service.recoverTransfersForConnection('A')
  expect(service.getExportProgress('saved-export')?.status).toBe('cancelled')
  expect(mocks.http).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalledWith('Async.VM.clean_shutdown', expect.anything())
})

it.each([false, true])('ends a recovered import known to have exited before upload without waiting on an unexecuted Task (cancelled=%s)', async (cancelRequested) => {
  mocks.read.mockReturnValue({ exports: [], imports: [{ operationId: 'pre-upload', connectionId: 'A', originPoolUuid: 'pool-A',
    params: { srRef: 'OpaqueRef:sr', vifMappings: {} }, taskRef: 'OpaqueRef:not-started', status: 'pending', uploadStarted: false, cancelRequested, progress: 0, message: '', lastUpdatedAt: 1 }] })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  await service.recoverTransfersForConnection('A')
  expect(service.getImportProgress('pre-upload')).toMatchObject({ status: cancelRequested ? 'cancelled' : 'failed', errorCode: 'IMPORT_NOT_UPLOADED', taskRef: null })
  expect(service.getImportProgress('pre-upload')).not.toHaveProperty('uploadStarted')
  expect(mocks.http).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalledWith('task.get_record', expect.anything())
  expect(mocks.call).toHaveBeenCalledWith('task.destroy', ['OpaqueRef:not-started'])
})

it('recovers an uncertain shutdown from the original VM power state without repeating shutdown', async () => {
  let halted = false
  const base = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') return { ...vm, power_state: halted ? 'Halted' : 'Running', allowed_operations: ['clean_shutdown'] }
    if (method === 'Async.VM.clean_shutdown') { halted = true; throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' }) }
    return base(method, args)
  })
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const { exportId } = await service.exportVm('A', { vmRef: 'OpaqueRef:vm', filePath: join(directory, 'shutdown.xva'), powerState: 'Running', exportMode: 'shutdown' })
  await vi.waitFor(() => expect(service.getExportProgress(exportId)?.status).toBe('unknown'))
  await service.recoverTransfersForConnection('A')
  expect(service.getExportProgress(exportId)?.status).toBe('completed')
  expect(mocks.call.mock.calls.filter(([method]) => method === 'Async.VM.clean_shutdown')).toHaveLength(1)
})
