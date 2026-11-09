import { createServer, type IncomingMessage, type Server } from 'node:http'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { xva } from '../helpers/xva'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectionManager } from '../../src/main/xapi/connection-manager'
import {
  cancelImport,
  cancelExport,
  exportVm,
  getExportProgress,
  getImportProgress,
  importVm,
} from '../../src/main/xapi/services/vm-import.service'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

interface ObservedRequest {
  method: string
  url: string
  contentLength?: string
  contentType?: string
  body: Buffer
}

const openServers = new Set<Server>()
const temporaryDirectories = new Set<string>()

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function listen(
  handler: (request: IncomingMessage, response: import('node:http').ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP address')
  return { server, port: address.port }
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  openServers.delete(server)
}

async function readRequest(request: IncomingMessage): Promise<ObservedRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return {
    method: request.method ?? '',
    url: request.url ?? '',
    contentLength: request.headers['content-length'],
    contentType: request.headers['content-type'],
    body: Buffer.concat(chunks),
  }
}

function makeMinimalXva(): Buffer {
  return xva('<appliance><vm><label>Imported VM</label><shortdesc>Loopback import</shortdesc></vm></appliance>')
}

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'xenadmin-xva-http-'))
  temporaryDirectories.add(directory)
  return directory
}

function installClient(
  port: number,
  callWithSession: ReturnType<typeof vi.fn>,
): void {
  const names = new Map<string, string>()
  const resources: Record<string, unknown> = {
    'pool.get_all_records': {},
    'host.get_all_records': { 'OpaqueRef:host': { enabled: true, metrics: 'OpaqueRef:metrics' } },
    'host_metrics.get_all_records': { 'OpaqueRef:metrics': { live: true } },
    'SR.get_all_records': { 'OpaqueRef:sr': { type: 'ext', physical_size: '1099511627776', physical_utilisation: '0' } },
    'PBD.get_all_records': { 'OpaqueRef:pbd': { host: 'OpaqueRef:host', SR: 'OpaqueRef:sr', currently_attached: true } },
    'host_cpu.get_all_records': {}, 'VDI.get_all_records': {}, 'VBD.get_all_records': {}, 'network.get_all_records': {}, 'PIF.get_all_records': {},
  }
  const fixtureCall = async (method: string, params: unknown[]) => {
    if (method in resources) return resources[method]
    if (method === 'task.get_record' && params[0] === 'OpaqueRef:preparation-task') return { status: 'success', result: '<value>OpaqueRef:checkpoint</value>' }
    if (method === 'VM.get_VBDs' || method === 'VM.get_VIFs') return []
    if (method === 'VM.set_name_label') { names.set(String(params[0]), String(params[1])); return null }
    const result = await callWithSession(method, params)
    return method === 'VM.get_record' && result?.is_a_snapshot ? { ...result, snapshot_of: 'OpaqueRef:vm', name_label: names.get(String(params[0])) ?? result.name_label } : result
  }
  vi.spyOn(connectionManager, 'getClient').mockReturnValue({
    callWithSession: fixtureCall,
    getAuthenticatedHttpContext: vi.fn(() => ({
      scheme: 'http:' as const,
      host: '127.0.0.1',
      port,
      tls: null,
      sessionId: 'OpaqueRef:xva-session',
    })),
  } as never)
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all([...openServers].map(closeServer))
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
    temporaryDirectories.delete(directory)
  }
})

describe('XVA HTTP data-plane consumer contract', () => {
  it('keeps a redirected checkpoint export pending until the XAPI Task succeeds, then cleans up the checkpoint', async () => {
    const payload = makeMinimalXva()
    const sourceRequests: ObservedRequest[] = []
    const targetRequests: ObservedRequest[] = []
    const source = await listen((request, response) => {
      void readRequest(request).then((observed) => {
        if (observed.url.startsWith('/export?')) {
          sourceRequests.push(observed)
          response.writeHead(302, { Location: '/export-on-member' })
          response.end()
          return
        }
        targetRequests.push(observed)
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(payload.length),
        })
        response.end(payload)
      })
    })
    const taskObserved = deferred<void>()
    let taskObservations = 0
    const callWithSession = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'VM.get_VBDs') return []
      if (method === 'VM.get_record') {
        if (params[0] === 'OpaqueRef:checkpoint') {
          return {
            uuid: 'checkpoint-uuid',
            is_a_snapshot: true, allowed_operations: ['destroy'], VBDs: [],
            name_label: 'Loopback VM checkpoint',
            power_state: 'Halted',
            is_a_template: false,
          }
        }
        return {
          uuid: 'vm-uuid',
          name_label: 'Loopback VM',
          allowed_operations: ['checkpoint', 'clean_shutdown'], power_state: 'Running',
          is_a_template: false,
        }
      }
      if (method === 'Async.VM.checkpoint') return 'OpaqueRef:preparation-task'
      if (method === 'task.create') return 'OpaqueRef:export-task'
      if (method === 'task.get_record') {
        taskObservations += 1
        if (taskObservations === 1) throw new Error('temporary Task observation failure')
        taskObserved.resolve()
        return taskObservations === 2
          ? { status: 'pending', progress: 1 }
          : { status: 'success', progress: 1 }
      }
      if (method === 'VM.destroy') return undefined
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const exportPath = join(directory, 'export.xva')

    const { exportId } = await exportVm('connection-1', {
      vmRef: 'OpaqueRef:vm',
      filePath: exportPath,
      powerState: 'Running',
      exportMode: 'snapshot',
      useCompression: false,
    })
    await withTimeout(taskObserved.promise, 'export Task observation')
    await waitFor(
      () => targetRequests.length,
      (count) => count === 1,
      'redirected export request',
    )

    const query = 'session_id=OpaqueRef%3Axva-session&uuid=checkpoint-uuid&task_id=OpaqueRef%3Aexport-task&preserve_power_state=true'
    expect(sourceRequests).toEqual([{
      method: 'GET',
      url: `/export?${query}`,
      contentLength: undefined,
      contentType: undefined,
      body: Buffer.alloc(0),
    }])
    expect(targetRequests).toEqual([{
      method: 'GET',
      url: `/export-on-member?${query}`,
      contentLength: undefined,
      contentType: undefined,
      body: Buffer.alloc(0),
    }])
    await waitFor(
      () => getExportProgress(exportId),
      (progress) => progress?.message === '文件已接收并通过校验，等待资源池任务确认',
      'pending export after transient Task observation failure',
    )
    expect(existsSync(exportPath)).toBe(false)
    expect(readFileSync(`${exportPath}.partial-${exportId}`).equals(payload)).toBe(true)
    expect(getExportProgress(exportId)).toMatchObject({ status: 'running', phase: 'waiting_for_task', progress: -1 })
    expect(callWithSession).not.toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:checkpoint'])

    await waitFor(
      () => getExportProgress(exportId),
      (progress) => progress?.status === 'completed',
      'completed export after resource pool Task success',
      2_500,
    )
    expect(readFileSync(exportPath).equals(payload)).toBe(true)
    expect(existsSync(`${exportPath}.partial-${exportId}`)).toBe(false)
    expect(callWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:checkpoint'])
  })

  it.each([false, true])('reopens the XVA stream after an import redirect and completes only after Task and VM postconditions (early headers: %s)', async (earlyHeaders) => {
    // Exceed socket buffering so early headers arrive while the file is open.
    const payload = Buffer.concat([makeMinimalXva(), Buffer.alloc(4 * 1024 * 1024)])
    const sourceRequests: ObservedRequest[] = []
    const targetRequests: ObservedRequest[] = []
    const source = await listen((request, response) => {
      if (earlyHeaders && request.url?.startsWith('/import-on-member?')) {
        response.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' })
        response.flushHeaders()
      }
      void readRequest(request).then((observed) => {
        if (observed.url.startsWith('/import?')) {
          sourceRequests.push(observed)
          response.writeHead(302, { Location: '/import-on-member' })
          response.end()
          return
        }
        targetRequests.push(observed)
        if (!earlyHeaders) response.writeHead(200, { 'Content-Type': 'text/plain' })
        response.end('accepted')
      })
    })
    const taskRequested = deferred<void>()
    const taskResult = deferred<{
      status: string
      progress: number
      result: string
    }>()
    const postconditionRequested = deferred<void>()
    const postconditionResult = deferred<Record<string, unknown>>()
    const methods: string[] = []
    const callWithSession = vi.fn(async (method: string) => {
      methods.push(method)
      if (method === 'SR.get_record') {
        return { physical_size: String(payload.length * 10), physical_utilisation: '0' }
      }
      if (method === 'task.create') return 'OpaqueRef:import-task'
      if (method === 'task.get_record') {
        taskRequested.resolve()
        return taskResult.promise
      }
      if (method === 'VM.get_record') {
        postconditionRequested.resolve()
        return postconditionResult.promise
      }
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const importPath = join(directory, 'import.xva')
    writeFileSync(importPath, payload)

    const operationId = await importVm('connection-1', {
      filePath: importPath,
      srRef: 'OpaqueRef:sr',
      vifMappings: {},
    })
    await withTimeout(taskRequested.promise, 'import Task observation')
    await waitFor(
      () => targetRequests.length,
      (count) => count === 1,
      'redirected import request',
    )

    const query = 'session_id=OpaqueRef%3Axva-session&sr_id=OpaqueRef%3Asr&task_id=OpaqueRef%3Aimport-task&restore=false&force=false'
    for (const [request, path] of [
      [sourceRequests[0], '/import'],
      [targetRequests[0], '/import-on-member'],
    ] as const) {
      expect(request).toMatchObject({
        method: 'PUT',
        url: `${path}?${query}`,
        contentLength: String(payload.length),
        contentType: 'application/octet-stream',
      })
      expect(request.body.equals(payload)).toBe(true)
    }
    expect(getImportProgress(operationId)?.transfer?.bytesTransferred).toBe(payload.length)
    expect(getImportProgress(operationId)?.status).not.toBe('completed')

    taskResult.resolve({
      status: 'success',
      progress: 1,
      result: '<value>OpaqueRef:imported-vm</value>',
    })
    await withTimeout(postconditionRequested.promise, 'imported VM postcondition')
    expect(getImportProgress(operationId)).toMatchObject({
      status: 'configuring',
      vmRef: 'OpaqueRef:imported-vm',
    })

    postconditionResult.resolve({
      uuid: 'imported-vm-uuid',
      name_label: 'Imported VM',
      name_description: 'Imported through loopback',
    })
    await waitFor(
      () => getImportProgress(operationId),
      (operation) => operation?.status === 'completed',
      'completed import operation',
    )
    expect(methods).toEqual([
      'task.create',
      'task.get_record',
      'VM.get_record',
      'VM.get_record',
      'task.destroy',
    ])
  })

  it('does not replay an export request while the resource pool Task state is unavailable', async () => {
    let requestCount = 0
    const source = await listen((request) => {
      requestCount += 1
      request.socket.destroy()
    })
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_VBDs') return []
      if (method === 'VM.get_record') {
        return {
          uuid: 'vm-uuid',
          name_label: 'Loopback VM',
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
        }
      }
      if (method === 'task.create') return 'OpaqueRef:export-task'
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const exportPath = join(directory, 'disconnected.xva')

    const { exportId } = await exportVm('connection-1', {
      vmRef: 'OpaqueRef:vm',
      filePath: exportPath,
      powerState: 'Halted',
      exportMode: 'force',
    })
    await waitFor(
      () => getExportProgress(exportId),
      (progress) => progress?.status === 'running'
        && progress.message.includes('resource pool task state is unavailable'),
      'reconciling export operation',
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(requestCount).toBe(1)
    expect(getExportProgress(exportId)?.status).toBe('running')
    expect(existsSync(exportPath)).toBe(false)
    expect(callWithSession).toHaveBeenCalledWith(
      'task.get_record',
      ['OpaqueRef:export-task'],
    )
  })

  it('keeps an HTTP-failed checkpoint export cancellable until the resource pool Task confirms cancellation', async () => {
    const source = await listen((request) => {
      request.socket.destroy()
    })
    let cancellationRequested = false
    const callWithSession = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'VM.get_VBDs') return []
      if (method === 'VM.get_record') {
        if (params[0] === 'OpaqueRef:checkpoint') {
          return {
            uuid: 'checkpoint-uuid',
            is_a_snapshot: true, allowed_operations: ['destroy'], VBDs: [],
            name_label: 'Loopback VM checkpoint',
            power_state: 'Halted',
            is_a_template: false,
          }
        }
        return {
          uuid: 'vm-uuid',
          name_label: 'Loopback VM',
          allowed_operations: ['checkpoint', 'clean_shutdown'], power_state: 'Running',
          is_a_template: false,
        }
      }
      if (method === 'Async.VM.checkpoint') return 'OpaqueRef:preparation-task'
      if (method === 'task.create') return 'OpaqueRef:export-task'
      if (method === 'task.get_record') {
        return cancellationRequested
          ? { status: 'cancelled', progress: 0 }
          : { status: 'pending', progress: 0 }
      }
      if (method === 'task.cancel') {
        cancellationRequested = true
        return undefined
      }
      if (method === 'VM.destroy') return undefined
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const exportPath = join(directory, 'failed-checkpoint.xva')

    const { exportId } = await exportVm('connection-1', {
      vmRef: 'OpaqueRef:vm',
      filePath: exportPath,
      powerState: 'Running',
      exportMode: 'snapshot',
    })
    await waitFor(
      () => getExportProgress(exportId),
      (progress) => progress?.status === 'running' && progress.message.includes('Export request failed'),
      'reconciling checkpoint export after HTTP failure',
    )

    expect(callWithSession).toHaveBeenCalledWith('task.get_record', ['OpaqueRef:export-task'])
    expect(callWithSession).not.toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:checkpoint'])

    await cancelExport('connection-1', exportId)
    expect(callWithSession).toHaveBeenCalledWith('task.cancel', ['OpaqueRef:export-task'])
    expect(callWithSession.mock.calls.filter(([method]) => method === 'task.cancel')).toHaveLength(1)
    expect(getExportProgress(exportId)?.status).toBe('cancelling')

    await waitFor(
      () => getExportProgress(exportId),
      (progress) => progress?.status === 'cancelled',
      'cancelled export after resource pool Task confirmation',
    )
    expect(callWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:checkpoint'])
  })

  it.each(['disconnect', 'cancel'])('reconciles an interrupted HTTP error response during export (%s)', async (interruption) => {
    const headersObserved = deferred<void>()
    let errorResponse: import('node:http').ServerResponse | undefined
    const source = await listen((_request, response) => {
      errorResponse = response
      response.writeHead(500, { 'Content-Length': '1024' })
      response.write('partial error')
      headersObserved.resolve()
    })
    let cancelled = false
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', name_label: 'Loopback VM', allowed_operations: ['export'], power_state: 'Halted' }
      if (method === 'task.create') return 'OpaqueRef:export-error-task'
      if (method === 'task.cancel') { cancelled = true; return undefined }
      if (method === 'task.get_record') return cancelled ? { status: 'cancelled' } : { status: 'failure', error_info: ['EXPORT_REJECTED'] }
      if (method === 'task.destroy') return undefined
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const exportPath = join(makeTemporaryDirectory(), 'error-response.xva')
    const { exportId } = await exportVm('connection-1', { vmRef: 'OpaqueRef:vm', filePath: exportPath, powerState: 'Halted', exportMode: 'force' })
    await withTimeout(headersObserved.promise, 'error response headers')
    // Let the HTTP consumer attach before the peer disconnects or the user cancels.
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (interruption === 'cancel') await cancelExport('connection-1', exportId)
    else errorResponse!.socket!.destroy()
    await waitFor(() => getExportProgress(exportId)?.status,
      (status) => status === (interruption === 'cancel' ? 'cancelled' : 'failed'), 'terminal export after interrupted error response')
    expect(callWithSession).toHaveBeenCalledWith('task.get_record', ['OpaqueRef:export-error-task'])
    expect(existsSync(exportPath)).toBe(false)
  })

  it.each(['import', 'export'])('bounds an oversized %s control response and still reconciles the original Task', async (direction) => {
    let requests = 0
    const source = await listen((request, response) => {
      requests += 1
      void readRequest(request).then(() => {
        response.writeHead(direction === 'import' ? 200 : 500)
        response.write(Buffer.alloc(128 * 1024, 0x78))
        // Leave the response open: the consumer must stop at its size limit.
      })
    })
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', name_label: 'Loopback VM', allowed_operations: ['export'], power_state: 'Halted' }
      if (method === 'task.create') return 'OpaqueRef:oversized-task'
      if (method === 'task.get_record') return { status: 'failure', error_info: ['TRANSFER_REJECTED'] }
      if (method === 'task.destroy') return undefined
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const filePath = join(makeTemporaryDirectory(), 'oversized-response.xva')
    if (direction === 'import') {
      writeFileSync(filePath, makeMinimalXva())
      const id = await importVm('connection-1', { filePath, srRef: 'OpaqueRef:sr', vifMappings: {} })
      await waitFor(() => getImportProgress(id)?.status, (status) => status === 'failed', 'failed import after oversized response')
      expect(getImportProgress(id)?.errorCode).toBe('IMPORT_TASK_FAILED')
    } else {
      const { exportId } = await exportVm('connection-1', { vmRef: 'OpaqueRef:vm', filePath, powerState: 'Halted', exportMode: 'force' })
      await waitFor(() => getExportProgress(exportId)?.status, (status) => status === 'failed', 'failed export after oversized response')
      expect(existsSync(filePath)).toBe(false)
    }
    expect(requests).toBe(1)
    expect(callWithSession).toHaveBeenCalledWith('task.get_record', ['OpaqueRef:oversized-task'])
  })

  it('reconciles a stalled export from cancelling to cancelled after the resource pool Task confirms cancellation', async () => {
    const requestObserved = deferred<void>()
    const source = await listen((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(makeMinimalXva().length),
      })
      response.write(makeMinimalXva().subarray(0, 512))
      requestObserved.resolve()
    })
    const cancelRequested = deferred<void>()
    const cancelResult = deferred<void>()
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_VBDs') return []
      if (method === 'VM.get_record') {
        return {
          uuid: 'vm-uuid',
          name_label: 'Loopback VM',
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
        }
      }
      if (method === 'task.create') return 'OpaqueRef:export-task'
      if (method === 'task.cancel') {
        cancelRequested.resolve()
        return cancelResult.promise
      }
      if (method === 'task.get_record') return { status: 'cancelled', progress: 0 }
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const exportPath = join(directory, 'cancelled.xva')

    const { exportId } = await exportVm('connection-1', {
      vmRef: 'OpaqueRef:vm',
      filePath: exportPath,
      powerState: 'Halted',
      exportMode: 'force',
    })
    await withTimeout(requestObserved.promise, 'stalled export request')

    const cancellation = cancelExport('connection-1', exportId)
    await withTimeout(cancelRequested.promise, 'resource pool Task cancellation request')
    expect(getExportProgress(exportId)).toMatchObject({
      status: 'cancelling',
      message: 'Export cancellation requested',
    })

    cancelResult.resolve()
    await cancellation
    await waitFor(
      () => getExportProgress(exportId),
      (progress) => progress?.status === 'cancelled',
      'cancelled export after resource pool Task confirmation',
    )
  })

  it('reconciles a stalled import from cancelling to cancelled after the resource pool Task confirms cancellation', async () => {
    const payload = makeMinimalXva()
    const uploadObserved = deferred<void>()
    const source = await listen((request) => {
      request.once('data', () => uploadObserved.resolve())
    })
    let taskObservations = 0
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'SR.get_record') {
        return { physical_size: String(payload.length * 10), physical_utilisation: '0' }
      }
      if (method === 'task.create') return 'OpaqueRef:import-task'
      if (method === 'task.cancel') return undefined
      if (method === 'task.get_record') {
        taskObservations += 1
        if (taskObservations === 1) throw new Error('temporary Task observation failure')
        return { status: 'cancelled', progress: 0 }
      }
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const importPath = join(directory, 'cancelled-import.xva')
    writeFileSync(importPath, payload)

    const operationId = await importVm('connection-1', {
      filePath: importPath,
      srRef: 'OpaqueRef:sr',
      nameLabel: 'Cancelled import',
      nameDescription: '',
      vifMappings: {},
    })
    await withTimeout(uploadObserved.promise, 'stalled import upload')

    await cancelImport('connection-1', operationId)
    expect(getImportProgress(operationId)).toMatchObject({
      status: 'cancelling',
      message: '已请求取消导入，等待资源池任务确认',
    })

    await waitFor(
      () => getImportProgress(operationId),
      (operation) => operation?.status === 'cancelled',
      'cancelled import after resource pool Task confirmation',
    )
  })

  it.each([false, true])('bounds a stalled import and observes cancellation within the deadline (timeout=%s)', async (timedOut) => {
    const payload = makeMinimalXva()
    const source = await listen((request, response) => {
      void readRequest(request).then(() => {
        response.writeHead(200, { 'Content-Type': 'text/plain' })
        response.end('accepted')
      })
    })
    const firstTaskRequested = deferred<void>()
    const firstTaskResult = deferred<{ status: string; progress: number }>()
    let firstTaskObservation = true
    let cancellationRequested = false
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'SR.get_record') {
        return { physical_size: String(payload.length * 10), physical_utilisation: '0' }
      }
      if (method === 'task.create') return 'OpaqueRef:import-task'
      if (method === 'task.get_record') {
        if (firstTaskObservation) {
          firstTaskObservation = false
          firstTaskRequested.resolve()
          return firstTaskResult.promise
        }
        return cancellationRequested
          ? { status: 'cancelled', progress: 0 }
          : { status: 'pending', progress: 0 }
      }
      if (method === 'task.cancel') {
        cancellationRequested = true
        return undefined
      }
      throw new Error(`Unexpected XAPI method: ${method}`)
    })
    installClient(source.port, callWithSession)
    const directory = makeTemporaryDirectory()
    const importPath = join(directory, 'no-progress-import.xva')
    writeFileSync(importPath, payload)

    const operationId = await importVm('connection-1', {
      filePath: importPath,
      srRef: 'OpaqueRef:sr',
      nameLabel: 'No progress import',
      nameDescription: '',
      vifMappings: {},
    })
    await withTimeout(firstTaskRequested.promise, 'first import Task observation')

    vi.useFakeTimers()
    firstTaskResult.resolve({ status: 'pending', progress: 0 })
    await vi.advanceTimersByTimeAsync(timedOut ? 601_000 : 598_000)

    if (timedOut) {
      expect(getImportProgress(operationId)?.status).toBe('unknown')
      expect(getImportProgress(operationId)?.message).toContain('执行结果超时')
      expect(callWithSession.mock.calls.filter(([method]) => method === 'task.cancel' || method === 'task.destroy')).toHaveLength(0)
      return
    }
    expect(getImportProgress(operationId)?.status).toBe('waiting_for_task')

    await cancelImport('connection-1', operationId)
    expect(callWithSession.mock.calls.filter(([method]) => method === 'task.cancel')).toHaveLength(1)
    expect(getImportProgress(operationId)?.status).toBe('cancelling')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(getImportProgress(operationId)?.status).toBe('cancelled')
  })
})
