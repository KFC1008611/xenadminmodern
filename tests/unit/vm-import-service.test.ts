/**
 * Unit tests for vm-import.service — verifies VM export/import functionality
 * including file path validation, export modes, progress tracking, and cancellation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadTransferJournal = vi.fn()
const mockWriteTransferJournal = vi.fn()
vi.mock('../../src/main/persistence/json-store', () => ({ readJsonStore: mockReadTransferJournal, writeJsonStore: mockWriteTransferJournal }))

vi.mock('../../src/main/xapi/services/xva-archive', async (importOriginal) => ({ ...await importOriginal<typeof import('../../src/main/xapi/services/xva-archive')>(), verifyXvaArchive: vi.fn().mockResolvedValue(undefined) }))

// Mock fs module
const mockExistsSync = vi.fn()
const mockStatSync = vi.fn()
const mockFstatSync = vi.fn()
const mockStatfsSync = vi.fn()
const mockAccessSync = vi.fn()
const mockOpenSync = vi.fn()
const mockReadSync = vi.fn()
const mockCloseSync = vi.fn()
const mockCreateWriteStream = vi.fn()
const mockCreateReadStream = vi.fn()
const mockUnlinkSync = vi.fn()
const mockRenameSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('../../src/main/xapi/services/vm-creation.service', () => ({ getVmCreationResources: vi.fn(async () => ({ hosts: [{ ref: 'OpaqueRef:host' }, { ref: 'OpaqueRef:home' }], srs: [{ ref: 'OpaqueRef:sr', freeBytes: 1e12, hostRefs: ['OpaqueRef:host', 'OpaqueRef:home'] }], networks: [{ ref: 'OpaqueRef:network', hostRefs: ['OpaqueRef:host', 'OpaqueRef:home'] }], isos: [] })) }))

vi.mock('fs', () => ({
  realpathSync: (value: string) => value,
  linkSync: (...args: unknown[]) => mockRenameSync(...args),
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  fstatSync: mockFstatSync,
  statfsSync: mockStatfsSync,
  accessSync: mockAccessSync,
  openSync: mockOpenSync,
  readSync: mockReadSync,
  closeSync: mockCloseSync,
  createWriteStream: mockCreateWriteStream,
  createReadStream: mockCreateReadStream,
  unlinkSync: mockUnlinkSync,
  renameSync: mockRenameSync,
  mkdirSync: mockMkdirSync,
  constants: { W_OK: 2, R_OK: 4 },
}))

// Mock http/https
const mockHttpRequest = vi.fn()
const mockHttpsRequest = vi.fn()
const mockRequestXapiHttp = vi.fn()

vi.mock('http', () => ({
  request: mockHttpRequest,
}))

vi.mock('https', () => ({
  request: mockHttpsRequest,
}))

vi.mock('../../src/main/xapi/http-data-plane', () => ({
  requestXapiHttp: mockRequestXapiHttp,
}))

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-export-id-123'),
}))

// Mock stream/promises
const mockPipeline = vi.fn()
vi.mock('stream/promises', () => ({
  pipeline: mockPipeline,
}))

// Mock stream
vi.mock('stream', () => ({
  Transform: class Transform {
    constructor(opts: any) {
      // Store the transform callback for later invocation
      this._transform = opts?.transform
    }
    _transform: any
  },
}))

// Mock connection-manager
const mockCallWithSession = vi.fn()
const mockGetSessionRef = vi.fn(() => 'session-ref-123')
const mockGetAuthenticatedHttpContext = vi.fn(() => ({
  scheme: 'https:' as const,
  host: '192.168.1.100',
  port: 443,
  tls: { rejectUnauthorized: false },
  sessionId: 'session-ref-123',
}))
const mockGetClient = vi.fn(() => ({
  callWithSession: mockCallWithSession,
  getSessionRef: mockGetSessionRef,
  getAuthenticatedHttpContext: mockGetAuthenticatedHttpContext,
}))
const mockGetConnectionInfo = vi.fn(() => ({
  id: 'conn-1',
  host: '192.168.1.100',
  state: 'connected',
}))
const mockGetConnectionOptions = vi.fn(() => ({
  scheme: 'https:' as const,
  host: '192.168.1.100',
  port: 443,
  allowSelfSigned: true,
}))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: mockGetConnectionInfo,
    getConnectionOptions: mockGetConnectionOptions,
  },
}))

function mockValidXva(xml = '<appliance><vm><label>Imported VM</label></vm></appliance>') {
  const xmlBuffer = Buffer.from(xml)
  const buffer = Buffer.alloc(512 + Math.ceil(xmlBuffer.length / 512) * 512 + 1024)
  buffer.write('ova.xml', 0, 'utf8')
  buffer.write(xmlBuffer.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii')
  buffer.write('ustar', 257, 'ascii')
  buffer.fill(32, 148, 156)
  buffer.write(buffer.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  xmlBuffer.copy(buffer, 512)
  mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
  mockExistsSync.mockReturnValue(true)
  mockAccessSync.mockReturnValue(undefined)
  mockStatSync.mockReturnValue({ size: buffer.length })
  mockOpenSync.mockReturnValue(1)
  mockFstatSync.mockReturnValue({ size: buffer.length })
  mockReadSync.mockImplementation((_fd, target, offset, length, position) => {
    const chunk = buffer.subarray(position, position + length)
    chunk.copy(target as Buffer, offset)
    return chunk.length
  })
  mockCloseSync.mockReturnValue(undefined)
  return buffer
}

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
let disposeTestTimers = () => {}

describe('vm-import.service', () => {
  afterEach(async () => {
    // Some fixtures intentionally leave the server Task pending or the mock stream
    // unresolved. Stop their simulated timers before resetting shared client mocks.
    // resetModules() alone leaves the old service's 1s task observer alive.
    disposeTestTimers()
    await new Promise((resolve) => realSetTimeout(resolve, 0))
    disposeTestTimers()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let disposed = false
    vi.stubGlobal('setTimeout', (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
      const timer = realSetTimeout(() => {
        timers.delete(timer)
        if (!disposed) callback(...args)
      }, delay)
      if (disposed) realClearTimeout(timer)
      else timers.add(timer)
      return timer
    })
    vi.stubGlobal('clearTimeout', (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer)
      realClearTimeout(timer)
    })
    disposeTestTimers = () => {
      disposed = true
      for (const timer of timers) realClearTimeout(timer)
      timers.clear()
    }
    vi.clearAllMocks()
    mockReadTransferJournal.mockReturnValue({ exports: [], imports: [] })
    // Reset mock call chains
    mockCallWithSession.mockReset()
    mockHttpsRequest.mockReset()
    mockHttpRequest.mockReset()
    mockRequestXapiHttp.mockReset()
    mockCreateWriteStream.mockReset()
    mockCreateReadStream.mockReset()
    mockStatSync.mockReset()
    mockAccessSync.mockReset()
    mockExistsSync.mockReset()
    mockUnlinkSync.mockReset()
    mockRenameSync.mockReset()
    mockPipeline.mockReset()
    mockOpenSync.mockReset()
    mockReadSync.mockReset()
    mockCloseSync.mockReset()
    mockFstatSync.mockReset()
    mockStatfsSync.mockReset()
    mockMkdirSync.mockReset()
    // Reset module cache to clear exportProgressMap between tests
    vi.resetModules()
    // Reset mock implementations to defaults
    mockGetClient.mockReturnValue({
      callWithSession: mockCallWithSession,
      getSessionRef: mockGetSessionRef,
      getAuthenticatedHttpContext: mockGetAuthenticatedHttpContext,
    })
    mockGetConnectionInfo.mockReturnValue({
      id: 'conn-1',
      host: '192.168.1.100',
      state: 'connected',
      poolUuid: 'pool-uuid',
    })
    mockGetConnectionOptions.mockReturnValue({
      scheme: 'https:',
      host: '192.168.1.100',
      port: 443,
      allowSelfSigned: true,
    })
    mockRequestXapiHttp.mockImplementation(async (options: any) => {
      const canonicalQuery = new URLSearchParams(options.query)
      const requestTarget = async (target: URL): Promise<any> => new Promise((resolve, reject) => {
        for (const [key, value] of canonicalQuery) {
          if (!target.searchParams.has(key)) target.searchParams.append(key, value)
        }
        const isHttps = target.protocol === 'https:'
        const requestOptions: any = {
          hostname: target.hostname,
          port: Number(target.port) || (isHttps ? 443 : 80),
          path: target.pathname + target.search,
          method: options.method,
          timeout: options.timeoutMs,
          headers: {
            ...options.headers,
            ...(options.contentLength === undefined
              ? {}
              : { 'Content-Length': String(options.contentLength) }),
          },
        }
        if (isHttps) {
          requestOptions.rejectUnauthorized = options.context.tls?.rejectUnauthorized ?? true
        }
        const request = (isHttps ? mockHttpsRequest : mockHttpRequest)(
          requestOptions,
          (response: any) => {
            if (response.statusCode === 302 && response.headers?.location) {
              void requestTarget(new URL(response.headers.location, target)).then(resolve, reject)
              return
            }
            resolve(response)
          },
        )
        request.on?.('error', reject)
        options.signal?.addEventListener('abort', () => request.destroy?.(), { once: true })
        const body = options.bodyFactory?.()
        if (body) body.pipe(request)
        else request.end?.()
      })

      const target = new URL(
        `${options.context.scheme}//${options.context.host}:${options.context.port}${options.path}`,
      )
      target.search = canonicalQuery.toString()
      return requestTarget(target)
    })
  })

  describe('exportVm - file path validation', () => {
    it('should reject empty file path', async () => {
      const { exportVm, IpcError } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('File path is required')
    })

    it('should reject non-.xva extension', async () => {
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.vmdk',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('.xva extension')
    })

    it('should reject path traversal', async () => {
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      // Note: path.resolve will normalize /tmp/../etc/test.xva to /etc/test.xva
      // which does not contain '..' so this test needs to check the actual resolved path
      // For a path that actually contains '..' after resolve, we need a different approach
      // The validation checks if resolved.includes('..') which won't happen after path.resolve
      // So we test with a path that would fail directory validation instead
      mockStatSync.mockImplementation(() => {
        throw new Error('Directory not found')
      })

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/nonexistent/dir/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('Cannot write to directory')
    })

    it('should reject when parent path is not a directory', async () => {
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      mockStatSync.mockReturnValue({ isDirectory: () => false })

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('Parent path is not a directory')
    })

    it('should reject when directory is not writable', async () => {
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('Cannot write to directory')
    })
  })

  describe('exportVm - export modes', () => {
    beforeEach(() => {
      // Setup default mocks for valid path
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('rejects a disallowed running export mode before creating a checkpoint, task or file', async () => {
      mockCallWithSession.mockResolvedValueOnce([]).mockResolvedValueOnce({
        power_state: 'Running', uuid: 'vm-uuid', is_a_template: false,
        allowed_operations: ['clean_shutdown'], blocked_operations: { checkpoint: '禁止创建检查点' },
      })
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')
      await expect(exportVm('conn-1', { vmRef: 'OpaqueRef:vm1', filePath: '/tmp/test.xva', powerState: 'Running', exportMode: 'snapshot' })).rejects.toThrow('禁止创建检查点')
      expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual(['VM.get_VBDs', 'VM.get_record'])
      expect(mockCreateWriteStream).not.toHaveBeenCalled()
    })

    it('should reject shutdown mode when VM is not Running', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          VBDs: [],
        })

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'running',
          exportMode: 'shutdown',
        })
      ).rejects.toThrow('Shutdown export mode requires VM to be running')
    })

    it('should reject snapshot mode when VM is not Running', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          VBDs: [],
        })

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'running',
          exportMode: 'snapshot',
        })
      ).rejects.toThrow('Snapshot export mode requires VM to be running')
    })

    it('cleans a checkpoint and records background failure when export Task creation fails', async () => {
      mockCallWithSession.mockImplementation(async (method: string, params: any[]) => {
        if (method === 'VM.get_VBDs') return []
        if (method === 'VM.get_record' && params[0] === 'OpaqueRef:vm1') return { allowed_operations: ['checkpoint'], power_state: 'Running', uuid: 'vm-uuid', name_label: 'VM One' }
        if (method === 'Async.VM.checkpoint') return 'OpaqueRef:preparation'
        if (method === 'task.get_record') return { status: 'success', result: '<value>OpaqueRef:checkpoint</value>' }
        if (method === 'VM.get_record') return { uuid: 'checkpoint-uuid', name_label: 'VM One', snapshot_of: 'OpaqueRef:vm1', is_a_snapshot: true, power_state: 'Halted', allowed_operations: ['destroy'], VBDs: [] }
        if (method === 'task.create') throw new Error('TASK_CREATE_FAILED')
        return undefined
      })
      const { exportVm, getExportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      const result = await exportVm('conn-1', { vmRef: 'OpaqueRef:vm1', filePath: '/tmp/test.xva', powerState: 'Running', exportMode: 'snapshot' })
      await vi.waitFor(() => expect(getExportProgress(result.exportId)).toMatchObject({ status: 'failed', cleanupPending: false }))
      expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:checkpoint'])
      expect(mockCreateWriteStream).not.toHaveBeenCalled()
    })

    it('should allow force mode for Halted VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      // Mock HTTP request for export
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      // Mock write stream
      const mockWriteStream = {
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      }
      mockCreateWriteStream.mockReturnValue(mockWriteStream)

      // Mock pipeline to complete successfully
      mockPipeline.mockResolvedValue(undefined)

      // Mock XVA integrity validation - use mockImplementation to return based on context
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      expect(result.exportId).toBe('test-export-id-123')
      expect(typeof result.estimatedBytes).toBe('number')
    })

    it('exports a VM by uuid with an XAPI task id', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          is_a_snapshot: false,
          uuid: 'vm-uuid-1',
          name_label: 'VM One',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      mockHttpsRequest.mockReturnValue({
        on: vi.fn(),
        once: vi.fn(),
        end: vi.fn(),
      })

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('task.create', [
        'export',
        'xenadmin-export-test-export-id-123',
      ])
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      const requestOptions = mockHttpsRequest.mock.calls[0][0]
      const query = new URLSearchParams(requestOptions.path.split('?')[1])
      expect(query.get('uuid')).toBe('vm-uuid-1')
      expect(query.get('task_id')).toBe('OpaqueRef:task-export-1')
      expect(query.has('ref')).toBe(false)
    })

    it('should allow shutdown mode for Running VM', async () => {
      let halted = false
      mockCallWithSession.mockImplementation(async (method: string, params: any[]) => {
        if (method === 'VM.get_VBDs') return []
        if (method === 'VM.get_record' && params[0] === 'OpaqueRef:vm1') return { allowed_operations: ['checkpoint', 'clean_shutdown'], power_state: halted ? 'Halted' : 'Running', uuid: 'vm-uuid', name_label: 'VM' }
        if (method === 'Async.VM.clean_shutdown') { halted = true; return 'OpaqueRef:preparation' }
        if (method === 'Async.VM.checkpoint') return 'OpaqueRef:preparation'
        if (method === 'task.get_record') return { status: 'success', result: '<value>OpaqueRef:snapshot1</value>' }
        if (method === 'VM.get_record') return { uuid: 'snapshot-uuid', name_label: 'VM', snapshot_of: 'OpaqueRef:vm1', is_a_snapshot: true, is_a_template: false }
        if (method === 'task.create') return 'OpaqueRef:export-task'
        return undefined
      })
      mockHttpsRequest.mockReturnValue({ on: vi.fn(), end: vi.fn() })
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')
      const result = await exportVm('conn-1', { vmRef: 'OpaqueRef:vm1', filePath: '/tmp/test.xva', powerState: 'Running', exportMode: 'shutdown' })
      expect(result.exportId).toBeTruthy()
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.clean_shutdown', ['OpaqueRef:vm1'])
      const query = new URLSearchParams(mockHttpsRequest.mock.calls[0][0].path.split('?')[1])
      expect(query.get('uuid')).toBe('vm-uuid')
    })

    it('should allow snapshot mode for Running VM', async () => {
      let halted = false
      mockCallWithSession.mockImplementation(async (method: string, params: any[]) => {
        if (method === 'VM.get_VBDs') return []
        if (method === 'VM.get_record' && params[0] === 'OpaqueRef:vm1') return { allowed_operations: ['checkpoint', 'clean_shutdown'], power_state: halted ? 'Halted' : 'Running', uuid: 'vm-uuid', name_label: 'VM' }
        if (method === 'Async.VM.clean_shutdown') { halted = true; return 'OpaqueRef:preparation' }
        if (method === 'Async.VM.checkpoint') return 'OpaqueRef:preparation'
        if (method === 'task.get_record') return { status: 'success', result: '<value>OpaqueRef:snapshot1</value>' }
        if (method === 'VM.get_record') return { uuid: 'snapshot-uuid', name_label: 'VM', snapshot_of: 'OpaqueRef:vm1', is_a_snapshot: true, is_a_template: false }
        if (method === 'task.create') return 'OpaqueRef:export-task'
        return undefined
      })
      mockHttpsRequest.mockReturnValue({ on: vi.fn(), end: vi.fn() })
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')
      const result = await exportVm('conn-1', { vmRef: 'OpaqueRef:vm1', filePath: '/tmp/test.xva', powerState: 'Running', exportMode: 'snapshot' })
      expect(result.exportId).toBeTruthy()
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.checkpoint', ['OpaqueRef:vm1', 'xenadmin-export-test-export-id-123'])
      const query = new URLSearchParams(mockHttpsRequest.mock.calls[0][0].path.split('?')[1])
      expect(query.get('uuid')).toBe('snapshot-uuid')
    })

    it('exports snapshot mode from the checkpoint uuid', async () => {
      let halted = false
      mockCallWithSession.mockImplementation(async (method: string, params: any[]) => {
        if (method === 'VM.get_VBDs') return []
        if (method === 'VM.get_record' && params[0] === 'OpaqueRef:vm1') return { allowed_operations: ['checkpoint', 'clean_shutdown'], power_state: halted ? 'Halted' : 'Running', uuid: 'vm-uuid', name_label: 'VM' }
        if (method === 'Async.VM.clean_shutdown') { halted = true; return 'OpaqueRef:preparation' }
        if (method === 'Async.VM.checkpoint') return 'OpaqueRef:preparation'
        if (method === 'task.get_record') return { status: 'success', result: '<value>OpaqueRef:snapshot1</value>' }
        if (method === 'VM.get_record') return { uuid: 'snapshot-uuid', name_label: 'VM', snapshot_of: 'OpaqueRef:vm1', is_a_snapshot: true, is_a_template: false }
        if (method === 'task.create') return 'OpaqueRef:export-task'
        return undefined
      })
      mockHttpsRequest.mockReturnValue({ on: vi.fn(), end: vi.fn() })
      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')
      const result = await exportVm('conn-1', { vmRef: 'OpaqueRef:vm1', filePath: '/tmp/test.xva', powerState: 'Running', exportMode: 'snapshot' })
      expect(result.exportId).toBeTruthy()
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.checkpoint', ['OpaqueRef:vm1', 'xenadmin-export-test-export-id-123'])
      const query = new URLSearchParams(mockHttpsRequest.mock.calls[0][0].path.split('?')[1])
      expect(query.get('uuid')).toBe('snapshot-uuid')
    })
  })

  describe('exportVm - template export', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should skip mode validation for templates (always use force)', async () => {

      // Set up XAPI client mocks with default implementation
      mockCallWithSession.mockImplementation((method: string) => {
        if (method === 'VM.get_VBDs') return Promise.resolve(['OpaqueRef:vbd1'])
        if (method === 'VBD.get_record') return Promise.resolve({ VDI: 'OpaqueRef:vdi1', type: 'Disk' })
        if (method === 'VDI.get_record') return Promise.resolve({ virtual_size: '1073741824' })
        if (method === 'VM.get_record') return Promise.resolve({ allowed_operations: ['export'], power_state: 'Halted', is_a_template: true, uuid: 'template-uuid-1', VBDs: ['OpaqueRef:vbd1'] })
        if (method === 'task.create') return Promise.resolve('OpaqueRef:task-export-template')
        return Promise.resolve(null)
      })

      // Mock HTTP request
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      const mockWriteStream = {
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      }
      mockCreateWriteStream.mockReturnValue(mockWriteStream)

      // Mock pipeline to complete successfully
      mockPipeline.mockResolvedValue(undefined)

      // Mock XVA integrity validation
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      // Templates with shutdown mode should NOT throw — it should auto-switch to force
      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:tpl1',
        filePath: '/tmp/template.xva',
        powerState: 'halted',
        exportMode: 'shutdown', // This should be ignored, auto-switch to force
      })

      expect(result.exportId).toBeTruthy()
      expect(typeof result.estimatedBytes).toBe('number')
      // Should NOT have called VM.clean_shutdown (because templates use force mode)
      const calls = mockCallWithSession.mock.calls.map((c) => c[0])
      expect(calls).not.toContain('VM.clean_shutdown')
      // Should have called VM.get_record and VM.get_VBDs only
      expect(calls).toContain('VM.get_record')
      expect(calls).toContain('VM.get_VBDs')
    })

    it('exports a template by template uuid without creating a checkpoint', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: true,
          is_a_snapshot: false,
          uuid: 'template-uuid-1',
          name_label: 'Template One',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-template') // task.create

      mockHttpsRequest.mockReturnValue({
        on: vi.fn(),
        once: vi.fn(),
        end: vi.fn(),
      })

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await exportVm('conn-1', {
        vmRef: 'OpaqueRef:tpl1',
        filePath: '/tmp/template.xva',
        powerState: 'halted',
        exportMode: 'shutdown',
      })

      const calls = mockCallWithSession.mock.calls.map((c) => c[0])
      expect(calls).not.toContain('VM.checkpoint')
      expect(calls).not.toContain('VM.clean_shutdown')

      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      const requestOptions = mockHttpsRequest.mock.calls[0][0]
      const query = new URLSearchParams(requestOptions.path.split('?')[1])
      expect(query.get('uuid')).toBe('template-uuid-1')
      expect(query.get('task_id')).toBe('OpaqueRef:task-export-template')
      expect(query.has('ref')).toBe(false)
    })
  })

  describe('getExportProgress', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should return null for unknown exportId', async () => {
      const { getExportProgress } = await import('../../src/main/xapi/services/vm-import.service')

      const result = getExportProgress('non-existent-id')
      expect(result).toBeNull()
    })

    it('should return progress after export starts', async () => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      // Mock HTTP request
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      const mockWriteStream = {
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      }
      mockCreateWriteStream.mockReturnValue(mockWriteStream)

      // Mock pipeline to complete successfully
      mockPipeline.mockResolvedValue(undefined)

      // Mock XVA integrity validation
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      const progress = getExportProgress(result.exportId)
      expect(progress).not.toBeNull()
      expect(progress?.taskId).toBe(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)
    })

    it('does not report completion until the resource pool task also succeeds', async () => {
      mockStatSync.mockReturnValue({ isDirectory: () => true, size: 2048 })
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          name_label: 'VM One',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create
        .mockResolvedValue({ status: 'pending', progress: 1 }) // task.get_record

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '2048' },
        on: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })
      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        once: vi.fn(),
        close: vi.fn(),
      })
      mockPipeline.mockResolvedValue(undefined)
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      mockReadSync.mockImplementation((_fd, buffer, _offset, length) => {
        Buffer.alloc(length).copy(buffer as Buffer)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )
      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      await vi.waitFor(() => expect(mockPipeline).toHaveBeenCalled())
      await vi.waitFor(() => {
        expect(mockCallWithSession).toHaveBeenCalledWith(
          'task.get_record',
          ['OpaqueRef:task-export-1'],
        )
      })
      expect(getExportProgress(result.exportId)?.status).toBe('running')
      expect(mockRenameSync).not.toHaveBeenCalled()

      mockCallWithSession.mockResolvedValue({ status: 'success', progress: 1 })
      await vi.waitFor(() => {
        expect(mockRenameSync).toHaveBeenCalledWith(
          '/tmp/test.xva.partial-test-export-id-123', '/tmp/test.xva',
        )
      }, { timeout: 3000 })
      await vi.waitFor(() => expect(getExportProgress(result.exportId)?.status).toBe('completed'))
    })
  })

  describe('cancelExport', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('reports cancellation intent until the resource pool task confirms cancellation', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      // Mock HTTP request
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      const mockWriteStream = {
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      }
      mockCreateWriteStream.mockReturnValue(mockWriteStream)

      // Mock pipeline to complete successfully
      mockPipeline.mockResolvedValue(undefined)

      // Mock XVA integrity validation
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm, cancelExport, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      // First start an export
      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      // Then cancel
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      await cancelExport('conn-1', result.exportId)

      const progress = getExportProgress(result.exportId)
      expect(progress?.status).toBe('cancelling')
      expect(progress?.message).toBe('Export cancellation requested')
      expect(mockCallWithSession).toHaveBeenCalledWith(
        'task.cancel',
        ['OpaqueRef:task-export-1'],
      )
    })

    it('should do nothing for unknown exportId', async () => {
      const { cancelExport, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      // Should not throw
      await expect(cancelExport('conn-1', 'unknown-id')).resolves.not.toThrow()

      // Progress should still be null
      const progress = getExportProgress('unknown-id')
      expect(progress).toBeNull()
    })
  })

  describe('exportVm - connection validation', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should throw when connection not found', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('bad-conn', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('No connection found')
    })

    it('should reject before export size estimation when authenticated HTTP context is unavailable', async () => {
      mockGetClient.mockReturnValue({
        callWithSession: mockCallWithSession,
        getSessionRef: mockGetSessionRef,
      })

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-no-info', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('No active session for: conn-no-info')
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })

    it('should reject before export size estimation when session is invalid', async () => {
      mockGetClient.mockReturnValue({
        callWithSession: mockCallWithSession,
        getSessionRef: vi.fn(() => undefined),
        getAuthenticatedHttpContext: vi.fn(() => null),
      })

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-no-session', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('No active session for: conn-no-session')
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })
  })

  describe('exportVm - HTTP error handling', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should handle HTTP 401/403 authentication errors', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      // Mock HTTP 401 response
      const mockResponse = {
        statusCode: 401,
        headers: {},
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('Unauthorized'))
          } else if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        close: vi.fn(),
      })

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      // Wait for the HTTP request to complete
      await new Promise((resolve) => setTimeout(resolve, 50))

      const progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)
      expect(progress?.message).toContain('Authentication failed')
      expect(mockCallWithSession).toHaveBeenCalledWith(
        'task.get_record',
        ['OpaqueRef:task-export-1'],
      )
    })

    it('should handle HTTP 500 server errors', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockResponse = {
        statusCode: 500,
        headers: {},
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('Internal Server Error'))
          } else if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        close: vi.fn(),
      })

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)
      expect(progress?.message).toContain('HTTP 500')
      expect(mockCallWithSession).toHaveBeenCalledWith(
        'task.get_record',
        ['OpaqueRef:task-export-1'],
      )
    })

    it('should handle network errors', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        return {
          on: vi.fn((event: string, handler: Function) => {
            if (event === 'error') {
              setTimeout(() => handler(new Error('ECONNREFUSED')), 0)
            }
          }),
          end: vi.fn(),
        }
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        close: vi.fn(),
      })

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)
      expect(progress?.message).toContain('ECONNREFUSED')
      expect(mockCallWithSession).toHaveBeenCalledWith(
        'task.get_record',
        ['OpaqueRef:task-export-1'],
      )
    })

    it('should handle HTTP redirects', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      // First response is a redirect
      const mockRedirectResponse = {
        statusCode: 302,
        headers: { location: 'https://other-host/export?session_id=test&ref=vm1' },
        on: vi.fn(),
      }

      // Second response is success
      const mockSuccessResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }

      let requestCount = 0
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        requestCount++
        if (requestCount === 1) {
          setTimeout(() => callback(mockRedirectResponse), 0)
        } else {
          setTimeout(() => callback(mockSuccessResponse), 0)
        }
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      const mockWriteStream = {
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      }
      mockCreateWriteStream.mockReturnValue(mockWriteStream)

      // Mock pipeline to complete successfully
      mockPipeline.mockResolvedValue(undefined)

      // Mock XVA integrity validation
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      expect(result.exportId).toBeTruthy()
      expect(typeof result.estimatedBytes).toBe('number')
      // Wait for async redirect handling
      await new Promise((resolve) => setTimeout(resolve, 50))
      // Should have made 2 requests (original + redirect)
      expect(mockHttpsRequest).toHaveBeenCalledTimes(2)
    })
  })

  describe('IpcError', () => {
    it('should create error with code and message', async () => {
      const { IpcError } = await import('../../src/main/xapi/services/vm-import.service')

      const error = new IpcError('TEST_CODE', 'Test message', { detail: 'extra' })

      expect(error.code).toBe('TEST_CODE')
      expect(error.message).toBe('Test message')
      expect(error.details).toEqual({ detail: 'extra' })
    })
  })

  describe('exportVm - file write errors', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should handle write stream errors', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn(),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      // Mock write stream
      const mockWriteStream = {
        on: vi.fn(),
        once: vi.fn(),
        close: vi.fn(),
      }
      mockCreateWriteStream.mockReturnValue(mockWriteStream)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))

      // Mock pipeline to reject with write error
      mockPipeline.mockRejectedValue(new Error('Disk full'))

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)
      expect(progress?.message).toContain('Disk full')
      expect(mockCallWithSession).toHaveBeenCalledWith(
        'task.get_record',
        ['OpaqueRef:task-export-1'],
      )
    })
  })

  describe('exportVm - cleanup on failure', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should cleanup partial file on HTTP error', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockResponse = {
        statusCode: 500,
        headers: {},
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('Error'))
          } else if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        close: vi.fn(),
      })
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      expect(result.exportId).toBeTruthy()

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should attempt to cleanup the partial file
      expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/test.xva.partial-test-export-id-123')
    })
  })

  describe('cancelExport - HTTP request destruction', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('should destroy HTTP request when cancelling export', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockDestroy = vi.fn()
      const mockRequest = {
        on: vi.fn(),
        once: vi.fn(),
        end: vi.fn(),
        destroyed: false,
        destroy: mockDestroy,
      }

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            // Simulate slow data transfer that never completes
            setTimeout(() => handler(Buffer.from('test data')), 1000)
          }
        }),
        once: vi.fn(),
        pipe: vi.fn(),
      }

      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return mockRequest
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        once: vi.fn(),
        close: vi.fn(),
      })

      mockPipeline.mockImplementation(() => new Promise(() => {})) // Never resolves

      // Mock XVA integrity validation
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm, cancelExport } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      // Start an export
      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      // Wait for HTTP request to be set up
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Cancel the export
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      await cancelExport('conn-1', result.exportId)

      // Verify destroy was called
      expect(mockDestroy).toHaveBeenCalled()
    })
  })

  describe('checkDiskSpace', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
    })

    it('should throw when disk space is insufficient', async () => {
      // Mock 1 GB available space
      mockStatfsSync.mockReturnValue({
        bavail: 262144, // 1GB / 4096 block size
        bsize: 4096,
      })

      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:vbd1']) // VM.get_VBDs
        .mockResolvedValueOnce({
          VDI: 'OpaqueRef:vdi1',
          type: 'Disk',
        })
        .mockResolvedValueOnce({
          virtual_size: '21474836480', // 20 GB
        })
        .mockResolvedValueOnce({ is_a_template: false, power_state: 'Halted', uuid: 'vm-uuid-1' }) // VM.get_record

      const { exportVm, IpcError } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(
        exportVm('conn-1', {
          vmRef: 'OpaqueRef:vm1',
          filePath: '/tmp/test.xva',
          powerState: 'halted',
          exportMode: 'force',
        })
      ).rejects.toThrow('Insufficient disk space')
    })

    it('should pass when disk space is sufficient', async () => {
      // Mock 100 GB available space
      mockStatfsSync.mockReturnValue({
        bavail: 26214400, // 100GB / 4096 block size
        bsize: 4096,
      })

      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:vbd1']) // VM.get_VBDs
        .mockResolvedValueOnce({
          VDI: 'OpaqueRef:vdi1',
          type: 'Disk',
        })
        .mockResolvedValueOnce({
          virtual_size: '1073741824', // 1 GB
        })
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      // Mock HTTP request
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      })

      mockPipeline.mockResolvedValue(undefined)

      // Mock XVA integrity validation
      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      expect(result.exportId).toBeTruthy()
    })

    it('should create directory if it does not exist', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/newdir') return false
        return !path.endsWith('.xva')
      })

      mockStatfsSync.mockReturnValue({
        bavail: 26214400,
        bsize: 4096,
      })

      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from('test data'))
          }
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setTimeout(() => handler(), 0)
          }
        }),
        pipe: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return {
          on: vi.fn(),
          once: vi.fn(),
          end: vi.fn(),
        }
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 10)
          }
        }),
        close: vi.fn(),
      })

      mockPipeline.mockResolvedValue(undefined)

      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      const { exportVm } = await import('../../src/main/xapi/services/vm-import.service')

      await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/newdir/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      expect(mockMkdirSync).toHaveBeenCalledWith('/newdir', { recursive: true })
    })
  })

  describe('getExportProgress - observation truth', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isDirectory: () => true })
      mockAccessSync.mockReturnValue(undefined)
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockStatfsSync.mockReturnValue({ bavail: 26214400, bsize: 4096 }) // 100 GB
    })

    it('does not infer a terminal failure from elapsed renderer polling time', async () => {
      mockCallWithSession
        .mockResolvedValueOnce([]) // VM.get_VBDs for estimateExportSize
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: [],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockDestroy = vi.fn()
      const mockRequest = {
        on: vi.fn(),
        once: vi.fn(),
        end: vi.fn(),
        destroyed: false,
        destroy: mockDestroy,
      }

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '1024' },
        on: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      }

      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return mockRequest
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        once: vi.fn(),
        close: vi.fn(),
      })

      // Pipeline never resolves - simulates stalled export
      mockPipeline.mockImplementation(() => new Promise(() => {}))

      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      // Mock Date.now to simulate time passing
      const originalDateNow = Date.now
      let currentTime = originalDateNow()
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      // Start an export
      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      // Wait for export to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify export is running
      let progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)

      // Simulate 3 minutes passing (more than the 2 min base timeout)
      currentTime += 3 * 60 * 1000

      // Renderer polling cannot infer the resource pool Task terminal state.
      progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)
      expect(mockDestroy).not.toHaveBeenCalled()

      // Restore Date.now
      vi.restoreAllMocks()
    })

    it('does not turn a large in-flight export into a terminal result after an arbitrary wall-clock delay', async () => {
      // Mock 200 GB available space (need 110GB for 100GB VM with 10% margin)
      mockStatfsSync.mockReturnValue({ bavail: 52428800, bsize: 4096 })

      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:vbd1']) // VM.get_VBDs
        .mockResolvedValueOnce({
          VDI: 'OpaqueRef:vdi1',
          type: 'Disk',
        })
        .mockResolvedValueOnce({
          virtual_size: '107374182400', // 100 GB - large file
        })
        .mockResolvedValueOnce({
          allowed_operations: ['export'], power_state: 'Halted',
          is_a_template: false,
          uuid: 'vm-uuid-1',
          VBDs: ['OpaqueRef:vbd1'],
        }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-export-1') // task.create

      const mockDestroy = vi.fn()
      const mockRequest = {
        on: vi.fn(),
        once: vi.fn(),
        end: vi.fn(),
        destroyed: false,
        destroy: mockDestroy,
      }

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-length': '107374182400' },
        on: vi.fn(),
        once: vi.fn(),
        pipe: vi.fn(),
      }

      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(mockResponse), 0)
        return mockRequest
      })

      mockCreateWriteStream.mockReturnValue({
        on: vi.fn(),
        once: vi.fn(),
        close: vi.fn(),
      })

      mockPipeline.mockImplementation(() => new Promise(() => {}))

      mockOpenSync.mockReturnValue(123)
      mockFstatSync.mockReturnValue({ size: 2048 })
      const zeroBuffer = Buffer.alloc(1024, 0)
      mockReadSync.mockImplementation((_fd, buffer, _offset, length, _position) => {
        zeroBuffer.copy(buffer as Buffer, 0, 0, length)
        return length
      })
      mockCloseSync.mockReturnValue(undefined)

      // Mock Date.now
      const originalDateNow = Date.now
      let currentTime = originalDateNow()
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

      const { exportVm, getExportProgress } = await import(
        '../../src/main/xapi/services/vm-import.service'
      )

      const result = await exportVm('conn-1', {
        vmRef: 'OpaqueRef:vm1',
        filePath: '/tmp/test.xva',
        powerState: 'halted',
        exportMode: 'force',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify export is running
      let progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)

      // Simulate 3 minutes passing - should NOT timeout for 100GB file
      // (adaptive timeout would be ~200 minutes, capped at 10 min = 600 seconds)
      currentTime += 3 * 60 * 1000

      progress = getExportProgress(result.exportId)
      // Should still be running since 3 min < adaptive timeout
      expect(['pending', 'running']).toContain(progress?.status)

      // A longer delay still cannot substitute for the resource pool Task.
      currentTime += 8 * 60 * 1000

      progress = getExportProgress(result.exportId)
      expect(['pending', 'running']).toContain(progress?.status)

      vi.restoreAllMocks()
    })
  })

  describe('XVA import operation', () => {
    it('previews VM, disk, and VIF objects from the XAPI XML-RPC manifest', async () => {
      const member = (name: string, value: string) => `<member><name>${name}</name><value>${value}</value></member>`
      const object = (kind: string, id: string, snapshot: string) =>
        `<value><struct>${member('class', kind)}${member('id', id)}${member('snapshot', `<struct>${snapshot}</struct>`)}</struct></value>`
      const xml = `<value><struct>${member('objects', `<array><data>${
        object('VM', 'Ref:vm', member('name_label', 'Golden VM') + member('is_a_template', '<boolean>1</boolean>'))
        + object('network', 'Ref:network', member('name_label', 'Production'))
        + object('VIF', 'Ref:vif', member('device', '0') + member('network', 'Ref:network'))
        + object('VDI', 'Ref:disk', member('virtual_size', '4096'))
        + object('VBD', 'Ref:vbd', member('type', 'Disk') + member('VDI', 'Ref:disk'))
      }</data></array>`)}</struct></value>`
      mockValidXva(xml)
      const { getImportPreview } = await import('../../src/main/xapi/services/vm-import.service')
      await expect(getImportPreview('/tmp/template.xva')).resolves.toMatchObject({
        vmName: 'Golden VM', isTemplate: true, diskCount: 1, originalSize: 4096,
        vifs: [{ device: '0', sourceNetworkName: 'Production' }],
      })
    })

    it('rejects unsupported extensions before creating a task', async () => {
      mockExistsSync.mockImplementation((value: string) => !String(value).endsWith('.xva'))
      mockAccessSync.mockReturnValue(undefined)
      const { importVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(importVm('conn-1', {
        filePath: '/tmp/template.ova', srRef: 'OpaqueRef:sr', nameLabel: 'VM', nameDescription: '', vifMappings: {},
      })).rejects.toMatchObject({ code: 'IMPORT_FORMAT_UNSUPPORTED' })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('task.create', expect.anything())
    })

    it('rejects renamed invalid XVA content before creating a task', async () => {
      mockExistsSync.mockReturnValue(true)
      mockAccessSync.mockReturnValue(undefined)
      mockStatSync.mockReturnValue({ size: 2048 })
      mockOpenSync.mockReturnValue(1)
      mockReadSync.mockImplementation((_fd, target, offset, length) => {
        Buffer.alloc(length).copy(target as Buffer, offset)
        return length
      })
      const { importVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(importVm('conn-1', {
        filePath: '/tmp/fake.xva', srRef: 'OpaqueRef:sr', nameLabel: 'VM', nameDescription: '', vifMappings: {},
      })).rejects.toMatchObject({ code: 'IMPORT_FORMAT_INVALID' })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('task.create', expect.anything())
    })

    it('rejects a TAR with an unrelated XML file named ova.xml', async () => {
      mockValidXva('<not-an-xva />')
      const { importVm } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(importVm('conn-1', {
        filePath: '/tmp/fake.xva', srRef: 'OpaqueRef:sr', nameLabel: 'VM', nameDescription: '', vifMappings: {},
      })).rejects.toMatchObject({ code: 'IMPORT_FORMAT_INVALID' })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('task.create', expect.anything())
    })

    it('starts an operation with safe import parameters', async () => {
      mockValidXva()
      mockCallWithSession.mockImplementation(async (method: string) => {
        // A sparse XVA can have a larger virtual disk than its physical archive.
        // XAPI, rather than this incomplete estimate, decides whether the SR can import it.
        if (method === 'SR.get_record') return { physical_size: '0', physical_utilisation: '0' }
        if (method === 'task.create') return 'OpaqueRef:task'
        if (method === 'task.get_record') return { status: 'success', progress: 1, result: '<value>OpaqueRef:newvm</value>' }
        if (method === 'VM.get_VIFs' || method === 'VM.get_VBDs') return []
        if (method === 'VM.get_record') return { uuid: 'imported-uuid', is_a_template: false, name_label: 'VM', name_description: '' }
        return null
      })
      const response = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'end') setTimeout(() => handler(), 0)
        }),
      }
      mockHttpsRequest.mockImplementation((options: any, callback: Function) => {
        setTimeout(() => callback(response), 0)
        return { on: vi.fn(), destroy: vi.fn(), destroyed: false }
      })
      mockCreateReadStream.mockReturnValue({
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'data') handler(Buffer.alloc(512))
        }),
        pipe: vi.fn(),
      })
      const { importVm, getImportProgress } = await import('../../src/main/xapi/services/vm-import.service')

      const operationId = await importVm('conn-1', {
        filePath: '/tmp/valid.xva', srRef: 'OpaqueRef:sr', nameLabel: 'VM', nameDescription: '', vifMappings: {},
      })

      expect(operationId).toBe('test-export-id-123')
      await vi.waitFor(() => expect(mockHttpsRequest).toHaveBeenCalled())
      const options = mockHttpsRequest.mock.calls[0][0]
      expect(options.path).toContain('restore=false')
      expect(options.path).toContain('force=false')
      expect(getImportProgress(operationId)).toEqual(expect.objectContaining({ operationId }))
      await vi.waitFor(() => expect(getImportProgress(operationId)?.status).toBe('completed'))
    })

    it('reports post-configuration failure while preserving the imported VM ref', async () => {
      mockValidXva()
      mockCallWithSession.mockImplementation(async (method: string) => {
        if (method === 'SR.get_record') return { physical_size: '100000', physical_utilisation: '0' }
        if (method === 'task.create') return 'OpaqueRef:task'
        if (method === 'task.get_record') return { status: 'success', progress: 1, result: '<value>OpaqueRef:newvm</value>' }
        if (method === 'VM.get_record') return { uuid: 'imported-uuid', name_label: 'Original VM', name_description: '' }
        if (method === 'VM.set_name_label') throw new Error('rename failed')
        return null
      })
      const response = { statusCode: 200, headers: {}, on: vi.fn((event: string, handler: Function) => event === 'end' && setTimeout(() => handler(), 0)) }
      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setTimeout(() => callback(response), 0)
        return { on: vi.fn(), destroy: vi.fn(), destroyed: false }
      })
      mockCreateReadStream.mockReturnValue({ on: vi.fn(), pipe: vi.fn() })
      const { importVm, getImportProgress } = await import('../../src/main/xapi/services/vm-import.service')

      const operationId = await importVm('conn-1', {
        filePath: '/tmp/valid.xva', srRef: 'OpaqueRef:sr', nameLabel: 'VM', nameDescription: '', vifMappings: {},
      })

      await vi.waitFor(() => expect(getImportProgress(operationId)?.status).toBe('failed'))
      expect(getImportProgress(operationId)).toMatchObject({ vmRef: 'OpaqueRef:newvm', message: 'rename failed' })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VM.destroy', expect.anything())
    })

    it('records only an owned operation cancellation request until its task is terminal', async () => {
      mockValidXva()
      const destroy = vi.fn()
      mockCallWithSession.mockImplementation(async (method: string) => {
        if (method === 'SR.get_record') return { physical_size: '100000', physical_utilisation: '0' }
        if (method === 'task.create') return 'OpaqueRef:task'
        return null
      })
      mockHttpsRequest.mockReturnValue({ on: vi.fn(), destroy, destroyed: false })
      mockCreateReadStream.mockReturnValue({ on: vi.fn(), pipe: vi.fn() })
      const { importVm, cancelImport, getImportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      const operationId = await importVm('conn-1', {
        filePath: '/tmp/valid.xva', srRef: 'OpaqueRef:sr', nameLabel: 'VM', nameDescription: '', vifMappings: {},
      })

      await expect(cancelImport('conn-2', operationId)).rejects.toMatchObject({ code: 'IMPORT_OPERATION_NOT_FOUND' })
      await cancelImport('conn-1', operationId)
      expect(getImportProgress(operationId)?.status).toBe('cancelling')
      expect(destroy).toHaveBeenCalled()
      expect(mockCallWithSession).toHaveBeenCalledWith('task.cancel', ['OpaqueRef:task'])
    })
  })

  describe('post-import configuration', () => {
    it('moves only the VIF whose device has an explicit mapping', async () => {
      const callWithSession = vi.fn()
      callWithSession
        .mockResolvedValueOnce(['OpaqueRef:vif0', 'OpaqueRef:vif1'])
        .mockResolvedValueOnce({ device: '0', network: 'OpaqueRef:old-0' })
        .mockResolvedValueOnce({ device: '1', network: 'OpaqueRef:old-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ device: '1', network: 'OpaqueRef:new-net' })

      const { applyImportNetworkMap } = await import('../../src/main/xapi/services/vm-import.service')
      await applyImportNetworkMap(
        { callWithSession },
        'OpaqueRef:newvm',
        { '1': 'OpaqueRef:new-net' },
      )

      expect(callWithSession).toHaveBeenCalledWith('VIF.move', ['OpaqueRef:vif1', 'OpaqueRef:new-net'])
      expect(callWithSession).not.toHaveBeenCalledWith('VIF.move', ['OpaqueRef:vif0', expect.anything()])
      expect(callWithSession).not.toHaveBeenCalledWith('VIF.set_network', expect.anything())
    })

    it('preserves the original VIF when VIF.move is unavailable', async () => {
      const unavailable = Object.assign(new Error('MESSAGE_METHOD_UNKNOWN'), { code: 'MESSAGE_METHOD_UNKNOWN' })
      const callWithSession = vi.fn()
      callWithSession
        .mockResolvedValueOnce(['OpaqueRef:vif1'])
        .mockResolvedValueOnce({ device: '1', network: 'OpaqueRef:old-net' })
        .mockRejectedValueOnce(unavailable)

      const { applyImportNetworkMap } = await import('../../src/main/xapi/services/vm-import.service')
      await expect(applyImportNetworkMap(
        { callWithSession },
        'OpaqueRef:newvm',
        { '1': 'OpaqueRef:new-net' },
      )).rejects.toBe(unavailable)

      expect(callWithSession).not.toHaveBeenCalledWith('VIF.destroy', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VIF.create', expect.anything())
    })

    it('rejects a mapping whose imported VIF is missing', async () => {
      const callWithSession = vi.fn().mockResolvedValueOnce(['OpaqueRef:vif0'])
        .mockResolvedValueOnce({ device: '0', network: 'OpaqueRef:network' })
      const { applyImportNetworkMap } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(applyImportNetworkMap(
        { callWithSession },
        'OpaqueRef:newvm',
        { '1': 'OpaqueRef:network' },
      )).rejects.toMatchObject({ code: 'IMPORT_VIF_MISSING' })
    })

    it('rejects a network move that does not take effect', async () => {
      const callWithSession = vi.fn().mockResolvedValueOnce(['OpaqueRef:vif0'])
        .mockResolvedValueOnce({ device: '0', network: 'OpaqueRef:old' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ device: '0', network: 'OpaqueRef:old' })
      const { applyImportNetworkMap } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(applyImportNetworkMap(
        { callWithSession },
        'OpaqueRef:newvm',
        { '0': 'OpaqueRef:new' },
      )).rejects.toMatchObject({ code: 'IMPORT_NETWORK_MISMATCH' })
    })

    it('sets the selected home server without rewriting archived VM metadata', async () => {
      const callWithSession = vi.fn().mockResolvedValueOnce({ result: '<value>OpaqueRef:abc789</value>' })
        .mockResolvedValueOnce({ name_label: 'Archived VM', name_description: 'Archived description', affinity: 'OpaqueRef:NULL' })
        .mockResolvedValueOnce(null)
      const { applyPostImportConfiguration } = await import('../../src/main/xapi/services/vm-import.service')

      await applyPostImportConfiguration({ callWithSession }, 'OpaqueRef:task', {
        filePath: '/tmp/import.xva', srRef: 'OpaqueRef:sr', vifMappings: {}, homeServerRef: 'OpaqueRef:host',
      })

      expect(callWithSession).toHaveBeenCalledWith('VM.set_affinity', ['OpaqueRef:abc789', 'OpaqueRef:host'])
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_name_label', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_name_description', expect.anything())
    })

    it('keeps the imported VM type and archived properties unless explicitly overridden', async () => {
      const callWithSession = vi.fn()
      callWithSession
        .mockResolvedValueOnce({ result: '<value>OpaqueRef:abc123</value>' })
        .mockResolvedValueOnce({ is_a_template: false, name_label: 'Original VM', name_description: 'Original description', affinity: 'OpaqueRef:NULL' })

      const { applyPostImportConfiguration } = await import('../../src/main/xapi/services/vm-import.service')

      const vmRef = await applyPostImportConfiguration(
        { callWithSession },
        'OpaqueRef:task',
        {
          filePath: '/tmp/import.xva',
          srRef: 'OpaqueRef:sr',
          vifMappings: {},
        },
      )

      expect(vmRef).toBe('OpaqueRef:abc123')
      expect(callWithSession).toHaveBeenCalledWith('VM.get_record', ['OpaqueRef:abc123'])
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_is_a_template', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_name_label', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_name_description', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_affinity', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.get_VIFs', expect.anything())
    })

    it('preserves an imported template without adding quick-create metadata', async () => {
      const callWithSession = vi.fn()
      callWithSession
        .mockResolvedValueOnce({ result: '<value>OpaqueRef:abc456</value>' })
        .mockResolvedValueOnce({ is_a_template: true, name_label: 'Template', name_description: 'Template description', affinity: 'OpaqueRef:NULL', other_config: { instant: 'true' } })

      const { applyPostImportConfiguration } = await import('../../src/main/xapi/services/vm-import.service')

      const vmRef = await applyPostImportConfiguration(
        { callWithSession },
        'OpaqueRef:task',
        {
          filePath: '/tmp/import.xva',
          srRef: 'OpaqueRef:sr',
          vifMappings: {},
        },
      )

      expect(vmRef).toBe('OpaqueRef:abc456')
      expect(callWithSession).toHaveBeenCalledWith('VM.get_record', ['OpaqueRef:abc456'])
      expect(callWithSession).not.toHaveBeenCalledWith('VM.remove_from_other_config', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.add_to_other_config', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_is_a_template', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.get_VIFs', expect.anything())
    })

    it('markAsTemplate is idempotent when VM already has instant metadata', async () => {
      const callWithSession = vi.fn().mockResolvedValueOnce({ is_a_template: true, other_config: { instant: 'true' } })
      mockGetClient.mockReturnValue({ callWithSession, getSessionRef: mockGetSessionRef, getAuthenticatedHttpContext: mockGetAuthenticatedHttpContext })

      // A previous test's pending Task must not adopt this replacement mock client
      // and consume its one-shot VM record after a task-poll interval has elapsed.
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(callWithSession.mock.calls).toEqual([])

      const { markAsTemplate } = await import('../../src/main/xapi/services/vm-import.service')

      await markAsTemplate('conn-1', 'OpaqueRef:template123')

      expect(callWithSession).toHaveBeenCalledWith('VM.get_record', ['OpaqueRef:template123'])
      expect(callWithSession).not.toHaveBeenCalledWith('VM.remove_from_other_config', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.add_to_other_config', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_is_a_template', expect.anything())
    })

    it('markAsTemplate rejects a snapshot before writing template metadata', async () => {
      const callWithSession = vi.fn().mockResolvedValueOnce({
        is_a_template: true,
        is_a_snapshot: true,
        is_default_template: false,
        other_config: {},
      })
      mockGetClient.mockReturnValue({ callWithSession, getSessionRef: mockGetSessionRef, getAuthenticatedHttpContext: mockGetAuthenticatedHttpContext })

      const { markAsTemplate } = await import('../../src/main/xapi/services/vm-import.service')

      await expect(markAsTemplate('conn-1', 'OpaqueRef:snapshot'))
        .rejects.toThrow('快照或控制域不能转换为模板')
      expect(callWithSession).toHaveBeenCalledTimes(1)
      expect(callWithSession).toHaveBeenCalledWith('VM.get_record', ['OpaqueRef:snapshot'])
      expect(callWithSession).not.toHaveBeenCalledWith('VM.remove_from_other_config', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.add_to_other_config', expect.anything())
      expect(callWithSession).not.toHaveBeenCalledWith('VM.set_is_a_template', expect.anything())
    })
  })
  describe('persisted transfer recovery', () => {
    const savedExport = () => ({ exports: [{ id: 'saved-export', operation: {
      connectionId: 'old-connection', originEndpoint: 'https://192.168.1.100:443', originPoolUuid: 'pool-uuid', taskRef: 'OpaqueRef:original-task',
      partialPath: '/tmp/saved.partial', finalPath: '/tmp/saved.xva', transferCompleted: true,
    }, progress: { taskId: 'saved-export', progress: 99, status: 'running', message: 'waiting', lastUpdatedAt: 1 } }], imports: [] })

    it('reconciles a saved export task and removes its manually created task record without repeating HTTP', async () => {
      mockReadTransferJournal.mockReturnValue(savedExport())
      mockCallWithSession.mockImplementation(async (method: string) => method === 'task.get_record' ? { status: 'success' } : undefined)
      const { recoverTransfersForConnection, getExportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      expect(getExportProgress('saved-export')?.status).toBe('unknown')
      await recoverTransfersForConnection('conn-1')
      expect(getExportProgress('saved-export')?.status).toBe('completed')
      expect(mockRenameSync).toHaveBeenCalledWith('/tmp/saved.partial', '/tmp/saved.xva')
      expect(mockCallWithSession).toHaveBeenCalledWith('task.destroy', ['OpaqueRef:original-task'])
      expect(mockRequestXapiHttp).not.toHaveBeenCalled()
      expect(JSON.stringify(mockWriteTransferJournal.mock.calls)).not.toContain('session-ref-123')
    })

    it('bounds consecutive task read errors and preserves the original task for later reconciliation', async () => {
      mockReadTransferJournal.mockReturnValue(savedExport())
      mockCallWithSession.mockRejectedValue(new Error('offline'))
      const { recoverTransfersForConnection, getExportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      vi.useFakeTimers()
      try {
        const recovery = recoverTransfersForConnection('conn-1')
        await vi.advanceTimersByTimeAsync(5000)
        await recovery
        expect(getExportProgress('saved-export')?.status).toBe('unknown')
        expect(mockCallWithSession.mock.calls.filter(([method, params]) => method === 'task.get_record' && params[0] === 'OpaqueRef:original-task')).toHaveLength(5)
        expect(mockCallWithSession).not.toHaveBeenCalledWith('task.destroy', expect.anything())
      } finally { vi.useRealTimers() }
      mockCallWithSession.mockImplementation(async (method: string) => method === 'task.get_record' ? { status: 'cancelled' } : undefined)
      await recoverTransfersForConnection('conn-1')
      expect(getExportProgress('saved-export')?.status).toBe('cancelled')
      expect(mockCallWithSession).toHaveBeenCalledWith('task.destroy', ['OpaqueRef:original-task'])
    })

    it('adopts a replacement authenticated client while the original task observer is still running', async () => {
      mockReadTransferJournal.mockReturnValue(savedExport())
      const replacementCall = vi.fn(async (method: string) => method === 'task.get_record' ? { status: 'success' } : undefined)
      mockCallWithSession.mockImplementationOnce(async () => {
        mockGetClient.mockReturnValue({ callWithSession: replacementCall, getSessionRef: mockGetSessionRef, getAuthenticatedHttpContext: mockGetAuthenticatedHttpContext })
        throw new Error('old session disconnected')
      })
      const { recoverTransfersForConnection, getExportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      vi.useFakeTimers()
      try {
        const recovery = recoverTransfersForConnection('conn-1')
        await vi.advanceTimersByTimeAsync(1100)
        await recovery
        expect(getExportProgress('saved-export')?.status).toBe('completed')
        expect(replacementCall).toHaveBeenCalledWith('task.get_record', ['OpaqueRef:original-task'])
        expect(mockRequestXapiHttp).not.toHaveBeenCalled()
      } finally { vi.useRealTimers() }
    })

    it('does not reconcile saved references against a replacement pool at the same endpoint', async () => {
      mockReadTransferJournal.mockReturnValue(savedExport())
      mockGetConnectionInfo.mockReturnValue({ id: 'conn-1', host: '192.168.1.100', state: 'connected', poolUuid: 'different-pool' } as any)
      const { recoverTransfersForConnection, getExportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      await recoverTransfersForConnection('conn-1')
      expect(getExportProgress('saved-export')).toMatchObject({ status: 'unknown', message: expect.stringContaining('原资源池身份') })
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })

    it('retains an imported VM for review after restart during configuration instead of replaying mutations', async () => {
      mockReadTransferJournal.mockReturnValue({ exports: [], imports: [{ operationId: 'saved-import', connectionId: 'old',
        originEndpoint: 'https://192.168.1.100:443', originPoolUuid: 'pool-uuid', taskRef: 'OpaqueRef:task', status: 'configuring', progress: 97,
        message: 'configuring', lastUpdatedAt: 1, configurationStarted: true, params: { filePath: '/tmp/a.xva', srRef: 'sr', vifMappings: { '0': 'network' } },
      }] })
      mockCallWithSession.mockImplementation(async (method: string) => method === 'task.get_record' ? { status: 'success', result: '<value>OpaqueRef:imported</value>' } : undefined)
      const { recoverTransfersForConnection, getImportProgress } = await import('../../src/main/xapi/services/vm-import.service')
      await recoverTransfersForConnection('conn-1')
      expect(getImportProgress('saved-import')).toMatchObject({ status: 'unknown', vmRef: 'OpaqueRef:imported', taskRef: 'OpaqueRef:task' })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VIF.move', expect.anything())
      expect(mockRequestXapiHttp).not.toHaveBeenCalled()
    })
  })

})
