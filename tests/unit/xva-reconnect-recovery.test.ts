import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ clients: new Map<string, any>(), infos: new Map<string, any>(), read: vi.fn(), write: vi.fn() }))
vi.mock('../../src/main/persistence/json-store', () => ({ readJsonStore: mocks.read, writeJsonStore: mocks.write }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient: (id: string) => mocks.clients.get(id),
  getConnectionInfo: (id: string) => mocks.infos.get(id),
  listConnections: () => [...mocks.infos.values()],
} }))

function connect(id: string, poolUuid = 'original-pool', call = vi.fn()) {
  mocks.clients.set(id, { callWithSession: call, getAuthenticatedHttpContext: () => ({ scheme: 'https:', host: '192.0.2.1', port: 443 }) })
  mocks.infos.set(id, { id, state: 'connected', poolUuid })
  return call
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.clients.clear()
  mocks.infos.clear()
  mocks.read.mockReturnValue({ exports: [], imports: [{ operationId: 'interrupted-import', connectionId: 'old-connection',
    originPoolUuid: 'original-pool', originEndpoint: 'https://192.0.2.1:443', taskRef: 'OpaqueRef:original-task',
    status: 'uploading', uploadStarted: true, progress: 30, message: '正在上传 XVA', lastUpdatedAt: 1 }] })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('finds an already reconnected original pool when polling a record bound to an obsolete connection ID', async () => {
  const call = connect('new-connection', 'original-pool', vi.fn(async (method: string) => method === 'task.get_record'
    ? { status: 'failure', error_info: ['IMPORT_ERROR_PREMATURE_EOF'] } : undefined))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  expect(service.getImportProgress('interrupted-import')?.status).toBe('unknown')
  await vi.advanceTimersByTimeAsync(10000)
  expect(service.getImportProgress('interrupted-import')).toMatchObject({ connectionId: 'new-connection', status: 'failed', message: 'IMPORT_ERROR_PREMATURE_EOF' })
  expect(call.mock.calls.map(([method]) => method)).toEqual(['task.get_record', 'task.destroy'])
})

it('adopts the replacement connection after a ready notification arrived during an in-flight recovery', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  connect('old-connection', 'original-pool', vi.fn(async () => { await gate; throw new Error('connection lost') }))
  const service = await import('../../src/main/xapi/services/vm-import.service')
  const originalRecovery = service.recoverTransfersForConnection('old-connection')
  await vi.advanceTimersByTimeAsync(0)
  mocks.clients.delete('old-connection')
  mocks.infos.delete('old-connection')
  const call = connect('new-connection', 'original-pool', vi.fn(async (method: string) => method === 'task.get_record'
    ? { status: 'cancelled' } : undefined))
  await service.recoverTransfersForConnection('new-connection')
  release()
  await vi.advanceTimersByTimeAsync(5000)
  await originalRecovery
  service.getImportProgress('interrupted-import')
  await vi.advanceTimersByTimeAsync(10000)
  expect(service.getImportProgress('interrupted-import')).toMatchObject({ connectionId: 'new-connection', status: 'cancelled' })
  expect(call.mock.calls.map(([method]) => method)).toEqual(['task.get_record', 'task.destroy'])
})

it('does not query a different pool at the same endpoint or repeat any upload', async () => {
  const call = connect('new-connection', 'different-pool')
  const service = await import('../../src/main/xapi/services/vm-import.service')
  service.getImportProgress('interrupted-import')
  await vi.advanceTimersByTimeAsync(10000)
  expect(service.getImportProgress('interrupted-import')?.status).toBe('unknown')
  expect(call).not.toHaveBeenCalled()
})

function savedExport(status = 'running', cleanupAttempted = false) {
  return { id: 'interrupted-export', operation: { connectionId: 'old-connection', originPoolUuid: 'original-pool',
    originEndpoint: 'https://192.0.2.1:443', taskRef: 'OpaqueRef:original-task', cleanupAttempted, cleanupComplete: false },
  progress: { taskId: 'interrupted-export', status, progress: 30, message: '原导出任务', lastUpdatedAt: 1 } }
}

it.each(['completed', 'failed', 'cancelled'])('finishes interrupted cleanup for a confirmed %s export through the reconnected original pool', async (status) => {
  mocks.read.mockReturnValue({ imports: [], exports: [savedExport(status)] })
  const call = connect('new-connection')
  const service = await import('../../src/main/xapi/services/vm-import.service')
  expect(service.getExportProgress('interrupted-export')).toMatchObject({ status: 'running', cleanupPending: true })
  await vi.advanceTimersByTimeAsync(10000)
  expect(service.getExportProgress('interrupted-export')).toMatchObject({ connectionId: 'new-connection', status, cleanupPending: false })
  expect(service.getExportProgress('interrupted-export')?.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining('清理待核对')]))
  expect(call.mock.calls.map(([method]) => method)).toEqual(['task.destroy'])
})

it.each(['import', 'export'] as const)('loads a saved %s before handling cancellation as the first call after restart', async (direction) => {
  if (direction === 'export') mocks.read.mockReturnValue({ imports: [], exports: [savedExport()] })
  const call = connect('old-connection')
  const service = await import('../../src/main/xapi/services/vm-import.service')
  if (direction === 'import') {
    await service.cancelImport('old-connection', 'interrupted-import')
    expect(service.getImportProgress('interrupted-import')?.status).toBe('cancelling')
  } else {
    await service.cancelExport('old-connection', 'interrupted-export')
    expect(service.getExportProgress('interrupted-export')?.status).toBe('cancelling')
  }
  expect(call).toHaveBeenCalledOnce()
  expect(call).toHaveBeenCalledWith('task.cancel', ['OpaqueRef:original-task'])
})

it.each(['import', 'export'] as const)('cancels the original %s through a replacement connection before the next recovery poll', async (direction) => {
  if (direction === 'export') mocks.read.mockReturnValue({ imports: [], exports: [savedExport()] })
  const call = connect('new-connection')
  const service = await import('../../src/main/xapi/services/vm-import.service')
  if (direction === 'import') {
    service.getImportProgress('interrupted-import')
    await service.cancelImport('old-connection', 'interrupted-import')
    expect(service.getImportProgress('interrupted-import')).toMatchObject({ status: 'cancelling', connectionId: 'new-connection' })
  } else {
    service.getExportProgress('interrupted-export')
    await service.cancelExport('old-connection', 'interrupted-export')
    expect(service.getExportProgress('interrupted-export')).toMatchObject({ status: 'cancelling', connectionId: 'new-connection' })
  }
  expect(call).toHaveBeenCalledOnce()
  expect(call).toHaveBeenCalledWith('task.cancel', ['OpaqueRef:original-task'])
})

it.each(['import', 'export'] as const)('never sends a recovered %s cancellation to a different pool using the old ID', async (direction) => {
  if (direction === 'export') mocks.read.mockReturnValue({ imports: [], exports: [savedExport()] })
  const call = connect('old-connection', 'different-pool')
  const service = await import('../../src/main/xapi/services/vm-import.service')
  if (direction === 'import') {
    service.getImportProgress('interrupted-import')
    await expect(service.cancelImport('old-connection', 'interrupted-import')).rejects.toBeInstanceOf(Error)
  } else {
    service.getExportProgress('interrupted-export')
    await expect(service.cancelExport('old-connection', 'interrupted-export')).rejects.toBeInstanceOf(Error)
  }
  expect(call).not.toHaveBeenCalled()
})

it.each(['import', 'export'] as const)('does not cancel a recovered %s without a saved pool UUID even when the local ID exists', async (direction) => {
  const saved = direction === 'import' ? mocks.read.getMockImplementation()!() : { imports: [], exports: [savedExport()] }
  if (direction === 'import') delete saved.imports[0].originPoolUuid
  else delete saved.exports[0].operation.originPoolUuid
  mocks.read.mockReturnValue(saved)
  const call = connect('old-connection', 'different-pool')
  const service = await import('../../src/main/xapi/services/vm-import.service')
  if (direction === 'import') {
    service.getImportProgress('interrupted-import')
    await expect(service.cancelImport('old-connection', 'interrupted-import')).rejects.toMatchObject({ code: 'TRANSFER_POOL_IDENTITY_CHANGED' })
  } else {
    service.getExportProgress('interrupted-export')
    await expect(service.cancelExport('old-connection', 'interrupted-export')).rejects.toMatchObject({ code: 'TRANSFER_POOL_IDENTITY_CHANGED' })
  }
  expect(call).not.toHaveBeenCalled()
})
