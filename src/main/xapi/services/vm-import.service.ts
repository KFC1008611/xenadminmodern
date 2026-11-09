import { canRunVmExport } from '../../../shared/vm-actions'
/**
 * VM Import/Export service — handles XVA format import, export, preview, and cancel.
 * All functions (except getImportPreview) accept connectionId as the first parameter.
 *
 * v6: New service for VM backup/restore capabilities.
 * v9: Export rewritten to use HTTP GET streaming instead of XML-RPC.
 */
import { connectionManager } from '../connection-manager'
import { readJsonStore, writeJsonStore } from '../../persistence/json-store'
import { deleteVmSnapshot } from './vm.service'
import { convertVmToTemplate } from './template-metadata.service'
import { createLogger } from '../../logger'
import * as fs from 'fs'
import * as path from 'path'
import type { IncomingMessage } from 'http'
import { randomUUID } from 'crypto'
import { readTarHeader, verifyXvaArchive, type XvaDisk, type XvaValidationProgress } from './xva-archive'
import { getVmCreationResources } from './vm-creation.service'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { AuthenticatedHttpContext } from '../client'
import { requestXapiHttp } from '../http-data-plane'
import type {
  VmExportParams,
  VmImportOperation,
  VmImportParams,
  VmImportPreview,
  VmTransferProgress,
} from '../../../shared/types/xapi'

const log = createLogger('VmImportService')
const TASK_POLL_INTERVAL_MS = 1_000
const TASK_RESULT_TIMEOUT_MS = 10 * 60 * 1000

// ============================================================================
// Export progress tracking
// ============================================================================

const exportProgressMap = new Map<string, VmTransferProgress>()

interface ExportOperation {
  cancelRequested?: boolean
  connectionId: string
  taskRef: string
  abortController: AbortController
  originEndpoint?: string
  originPoolUuid?: string
  partialPath?: string
  finalPath?: string
  snapshotRef?: string
  transferCompleted?: boolean
  cleanupComplete?: boolean
  recovered?: boolean
  params?: VmExportParams
  preparationTaskRef?: string
  preparationComplete?: boolean
  preparationIssued?: boolean
  preparationName?: string
  sourceName?: string
  snapshotConfigurationStarted?: boolean
  sourceUuid?: string
  httpStarted?: boolean
  transferStartedAt?: number
  cleanupAttempted?: boolean
}

const exportOperations = new Map<string, ExportOperation>()

interface InternalImportOperation extends VmImportOperation {
  cancelRequested?: boolean
  uploadStarted?: boolean
  transferStartedAt?: number
  connectionId: string
  abortController: AbortController
  originEndpoint?: string
  originPoolUuid?: string
  params?: VmImportParams
  expectedPreview?: VmImportPreview
  vmUuid?: string
  configurationStarted?: boolean
  recovered?: boolean
}

const importOperations = new Map<string, InternalImportOperation>()

let journalLoaded = false
let lastJournalWrite = 0
const recoveryRuns = new Set<string>()
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const RESTORED_EXPORT_CLEANUP_WARNING = '本地记录已恢复，临时资源清理待核对，连接原资源池后继续清理'
function connectedTransferId(connectionId: string, originPoolUuid?: string): string | undefined {
  const original = connectionManager.getClient(connectionId)
  if (original && (!originPoolUuid || connectionManager.getConnectionInfo(connectionId)?.poolUuid === originPoolUuid)) return connectionId
  return originPoolUuid
    ? connectionManager.listConnections().find((connection) => connection.state === 'connected' && connection.poolUuid === originPoolUuid)?.id
    : undefined
}

function requestTransferRecovery(connectionId: string, originPoolUuid?: string): void {
  if (recoveryTimers.has(connectionId)) return
  const timer = setTimeout(() => {
    recoveryTimers.delete(connectionId)
    // A reconnect may create a new local ID while the old observer is still
    // running. Resolve the authenticated connection again on every retry.
    const currentId = connectedTransferId(connectionId, originPoolUuid)
    if (currentId) void recoverTransfersForConnection(currentId).catch((error) => log.warn(`传输恢复读取失败：${error.message}`))
  }, 10000)
  timer.unref?.()
  recoveryTimers.set(connectionId, timer)
}
const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled'])

function isUnconfirmedError(error: any): boolean {
  return ['IMPORT_TASK_OUTCOME_UNKNOWN', 'IMPORT_RESULT_INVALID', 'TRANSFER_POOL_IDENTITY_CHANGED', 'IMPORT_CONFIGURATION_UNCONFIRMED'].includes(error?.code)
    || ['transport', 'client'].includes(error?.details?.kind)
    || /^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH)/.test(error?.code ?? '')
}

function endpointIdentity(connectionId: string): string {
  const context = getClient(connectionId).getAuthenticatedHttpContext?.()
  return context ? `${context.scheme}//${context.host.toLowerCase()}:${context.port}` : ''
}

function currentTransferClient(
  operation: { connectionId: string; originPoolUuid?: string },
  original: { callWithSession: (method: string, params: any[]) => Promise<any> },
) {
  const current = connectionManager.getClient(operation.connectionId)
  if (!current) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '原连接不可用，等待重新连接后核对任务')
  if (operation.originPoolUuid ? operation.originPoolUuid !== connectionManager.getConnectionInfo(operation.connectionId)?.poolUuid : current !== original) {
    throw new IpcError('TRANSFER_POOL_IDENTITY_CHANGED', '当前连接未确认属于原资源池，已停止使用旧任务引用')
  }
  return current
}

function scopedTransferClient(operation: { connectionId: string; originPoolUuid?: string }, original: { callWithSession: (method: string, params: any[]) => Promise<any> }) {
  return { callWithSession: (method: string, params: any[]) => currentTransferClient(operation, original).callWithSession(method, params) }
}

function transferCancellationClient(operation: { connectionId: string; originPoolUuid?: string; recovered?: boolean }) {
  if (operation.recovered && !operation.originPoolUuid) {
    throw new IpcError('TRANSFER_POOL_IDENTITY_CHANGED', '本地记录缺少原资源池身份，无法安全取消；请在原资源池核对任务记录')
  }
  operation.connectionId = connectedTransferId(operation.connectionId, operation.originPoolUuid) ?? operation.connectionId
  return scopedTransferClient(operation, currentTransferClient(operation, getClient(operation.connectionId)))
}

function ensureTransferJournalLoaded(): void {
  if (journalLoaded) return
  const saved = readJsonStore<{ exports: Array<{ id: string; operation: Omit<ExportOperation, 'abortController'>; progress: VmTransferProgress }>; imports: Array<Omit<InternalImportOperation, 'abortController'>> }>('vm-transfers', { exports: [], imports: [] })
  if (!Array.isArray(saved.exports) || !Array.isArray(saved.imports)) throw new Error('本地传输记录格式无效，已保留记录供核对')
  for (const entry of saved.exports) {
    if (!entry?.id || !entry.operation?.connectionId || !entry.progress?.status) throw new Error('本地导出记录不完整')
    const terminal = TERMINAL_TRANSFER_STATES.has(entry.progress.status)
    exportOperations.set(entry.id, { ...entry.operation, cleanupAttempted: entry.operation.cleanupAttempted ?? terminal, abortController: new AbortController(), recovered: true })
    exportProgressMap.set(entry.id, terminal ? { ...entry.progress,
      ...(!entry.operation.cleanupComplete && (entry.operation.taskRef || entry.operation.snapshotRef || entry.operation.preparationTaskRef)
        ? { warnings: [...new Set([...(entry.progress.warnings ?? []), RESTORED_EXPORT_CLEANUP_WARNING])] } : {}),
    } : {
      ...entry.progress, status: 'unknown', message: '本地导出记录已恢复，等待连接原资源池核对任务；不会重复导出',
    })
  }
  for (const entry of saved.imports) {
    if (!entry?.operationId || !entry.connectionId || !entry.status) throw new Error('本地导入记录不完整')
    importOperations.set(entry.operationId, { ...entry, abortController: new AbortController(), recovered: true,
      ...(TERMINAL_TRANSFER_STATES.has(entry.status) ? {} : { status: 'unknown' as const, message: '本地导入记录已恢复，等待连接原资源池核对任务；不会重复上传' }),
    })
  }
  journalLoaded = true
}

function persistTransfers(force = false): void {
  if (!journalLoaded) return
  if (!force && Date.now() - lastJournalWrite < 1000) return
  const exports = [...exportOperations].flatMap(([id, operation]) => {
    const progress = exportProgressMap.get(id)
    if (!progress) return []
    const { abortController: _controller, recovered: _recovered, ...saved } = operation
    return [{ id, operation: saved, progress }]
  })
  const imports = [...importOperations.values()].map(({ abortController: _controller, recovered: _recovered, ...operation }) => operation)
  writeJsonStore('vm-transfers', { exports, imports })
  lastJournalWrite = Date.now()
}

async function destroyOwnedTask(client: { callWithSession: (method: string, params: any[]) => Promise<any> }, taskRef: string): Promise<boolean> {
  if (!taskRef) return true
  try { await client.callWithSession('task.destroy', [taskRef]); return true }
  catch (error: any) {
    if (error?.code === 'HANDLE_INVALID') return true
    log.warn(`资源池任务 ${taskRef} 的记录未能清理`)
    return false
  }
}

async function cleanupExportSnapshot(connectionId: string, exportId: string, snapshotRef?: string | null): Promise<boolean> {
  if (!snapshotRef) return true
  try {
    const result = await deleteVmSnapshot(connectionId, snapshotRef)
    if (result.failedVdiRefs.length) throw new Error(`保留磁盘：${result.failedVdiRefs.join('、')}`)
    return true
  } catch (error: any) {
    if (error?.code === 'HANDLE_INVALID') return true
    const progress = exportProgressMap.get(exportId)
    if (progress) updateProgress(exportId, progress.status, progress.progress, progress.bytesTransferred ?? 0,
      progress.bytesTotal ?? 0, `${progress.message}；导出快照 ${snapshotRef} 未能清理：${error?.message || '请检查快照列表'}`)
    return false
  }
}

async function cleanupExportOperation(id: string, operation: ExportOperation, originalClient: ReturnType<typeof getClient>): Promise<void> {
  let cleanupClient: ReturnType<typeof currentTransferClient>
  try { cleanupClient = currentTransferClient(operation, originalClient) }
  catch {
    operation.recovered = true
    operation.cleanupAttempted = true
    addExportWarning(id, '原资源池连接不可用，临时资源清理待恢复')
    persistTransfers(true)
    return
  }
  const snapshotCleaned = await cleanupExportSnapshot(operation.connectionId, id, operation.snapshotRef)
  const scopedClient = scopedTransferClient(operation, cleanupClient)
  const taskCleaned = await destroyOwnedTask(scopedClient, operation.taskRef)
  const preparationCleaned = await destroyOwnedTask(scopedClient, operation.preparationTaskRef ?? '')
  operation.cleanupAttempted = true
  operation.cleanupComplete = snapshotCleaned && taskCleaned && preparationCleaned
  if (!snapshotCleaned) addExportWarning(id, `导出快照未能清理：${operation.snapshotRef}`)
  if (!taskCleaned || !preparationCleaned) addExportWarning(id, '任务记录清理失败，请在原资源池核对')
  operation.recovered = !operation.cleanupComplete
  if (!taskCleaned) {
    const progress = exportProgressMap.get(id)
    if (progress && !progress.message.includes('任务记录清理失败')) {
      updateProgress(id, progress.status, progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0,
        `${progress.message}；任务记录清理失败：${operation.taskRef}`)
    }
  }
  const final = exportProgressMap.get(id)
  if (final && operation.cleanupComplete) final.warnings = final.warnings?.filter((warning) =>
    warning !== RESTORED_EXPORT_CLEANUP_WARNING && warning !== '应用重启后临时资源清理待核对，连接原资源池后继续清理')
  if (final?.status === 'completed') final.message = '导出完成'
  persistTransfers(true)
}

function addExportWarning(id: string, warning: string): void {
  const progress = exportProgressMap.get(id)
  if (progress) progress.warnings = [...new Set([...(progress.warnings ?? []), warning])]
}

/** Reconcile saved tasks after reconnect; never replay an upload or export mutation. */
export async function recoverTransfersForConnection(connectionId: string): Promise<void> {
  ensureTransferJournalLoaded()
  const endpoint = endpointIdentity(connectionId)
  const poolUuid = connectionManager.getConnectionInfo(connectionId)?.poolUuid
  const client = getClient(connectionId)
  const jobs: Promise<void>[] = []
  for (const [id, operation] of exportOperations) {
    const progress = exportProgressMap.get(id)
    if (!operation.recovered || recoveryRuns.has(id)) continue
    if (!poolUuid || !operation.originPoolUuid || operation.originPoolUuid !== poolUuid) {
      if (operation.originEndpoint === endpoint && progress && !TERMINAL_TRANSFER_STATES.has(progress.status)) {
        updateProgress(id, 'unknown', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, '未确认原资源池身份，请核对导出任务；不会向其他资源池重放或清理任务')
      }
      continue
    }
    if (!progress || operation.cleanupComplete) continue
    const alreadyTerminal = TERMINAL_TRANSFER_STATES.has(progress.status)
    if (!alreadyTerminal && !operation.taskRef && operation.params) {
      operation.connectionId = connectionId
      recoveryRuns.add(id)
      jobs.push(runExportOperation(connectionId, id, operation.params, true).finally(() => recoveryRuns.delete(id)))
      continue
    }
    if (!alreadyTerminal && (!operation.taskRef || !operation.partialPath || !operation.finalPath)) continue
    operation.connectionId = connectionId
    recoveryRuns.add(id)
    jobs.push((async () => {
      try {
        if (!alreadyTerminal && operation.transferCompleted && operation.partialPath) {
          try { await validateXvaIntegrity(operation.partialPath) } catch { operation.transferCompleted = false }
        }
        const terminal = alreadyTerminal ? 'terminal' : await reconcileExportTask(client, id, operation.taskRef, operation.partialPath!, operation.finalPath!, operation.transferCompleted === true)
        if (terminal === 'terminal') {
          await cleanupExportOperation(id, operation, client)
        }
      } finally { recoveryRuns.delete(id); persistTransfers(true) }
    })())
  }
  for (const [id, operation] of importOperations) {
    if (!operation.recovered || recoveryRuns.has(id)) continue
    if (!poolUuid || !operation.originPoolUuid || operation.originPoolUuid !== poolUuid) {
      if (operation.originEndpoint === endpoint && !TERMINAL_TRANSFER_STATES.has(operation.status)) {
        updateImportOperation(id, { status: 'unknown', message: '未确认原资源池身份，请核对导入任务；不会向其他资源池重放或清理任务' })
      }
      continue
    }
    if (!operation.taskRef && !operation.vmRef) continue
    operation.connectionId = connectionId
    recoveryRuns.add(id)
    jobs.push((async () => {
      let completed = false
      try {
        if (!TERMINAL_TRANSFER_STATES.has(operation.status)) {
          if (operation.uploadStarted === false && !operation.vmRef) throw new IpcError('IMPORT_NOT_UPLOADED', operation.cancelRequested ? '应用退出前已请求取消，XVA 尚未开始上传' : '应用在上传前退出，XVA 尚未上传，请新建导入；不会自动重传')
          const vmRef = operation.vmRef ?? await waitForImportTask(client, id, operation.taskRef!)
          updateImportOperation(id, { vmRef })
          if (!operation.params) throw new IpcError('IMPORT_CONFIGURATION_UNCONFIRMED', '缺少已保存的导入配置，请核对已创建对象')
          if (!operation.configurationStarted) {
            operation.configurationStarted = true
            updateImportOperation(id, { status: 'configuring', message: '导入任务已完成，正在应用已保存的配置' })
            await configureImportedVm(scopedTransferClient(operation, client), vmRef, operation.params, operation)
          }
          // Once writes have started, recovery only observes the original object.
          await verifyImportedVm(scopedTransferClient(operation, client), operation, vmRef)
          completed = true
          updateImportOperation(id, { status: 'configuring', message: '导入校验通过，正在清理任务记录' })
        }
        if (operation.taskRef && await destroyOwnedTask(scopedTransferClient(operation, client), operation.taskRef)) operation.taskRef = null
        else if (operation.taskRef) operation.warnings = [...new Set([...(operation.warnings ?? []), '任务记录清理失败，请在原资源池核对'])]
        operation.recovered = Boolean(operation.taskRef)
        if (completed) updateImportOperation(id, { status: 'completed', progress: 100, message: '导入完成（已核对原对象）', warnings: operation.warnings })
      } catch (error: any) {
        const unknown = isUnconfirmedError(error)
        updateImportOperation(id, { status: unknown ? 'unknown' : operation.status === 'cancelled' || error.code === 'IMPORT_NOT_UPLOADED' && operation.cancelRequested ? 'cancelled' : 'failed', message: error.message, errorCode: error.code })
        operation.recovered = unknown || Boolean(operation.taskRef)
        if (!unknown && operation.taskRef && await destroyOwnedTask(scopedTransferClient(operation, client), operation.taskRef)) operation.taskRef = null
      } finally { recoveryRuns.delete(id); persistTransfers(true) }
    })())
  }
  await Promise.allSettled(jobs)
}

function updateImportOperation(operationId: string, patch: Partial<VmImportOperation>): void {
  const operation = importOperations.get(operationId)
  if (!operation) return
  Object.assign(operation, patch, { lastUpdatedAt: Date.now() })
  persistTransfers(Boolean(patch.status))
}

export function getExportProgress(exportId: string): VmTransferProgress | null {
  ensureTransferJournalLoaded()
  const progress = exportProgressMap.get(exportId) ?? null
  const operation = exportOperations.get(exportId)
  if (operation?.recovered && (!TERMINAL_TRANSFER_STATES.has(progress?.status ?? '') || !operation.cleanupAttempted)) requestTransferRecovery(operation.connectionId, operation.originPoolUuid)
  return progress ? { ...progress,
    ...(progress.phase === 'transferring' && operation?.transferStartedAt && !operation.recovered && progress.status === 'running' && progress.transfer
      ? { transfer: { ...progress.transfer, elapsedMs: Math.max(progress.transfer.elapsedMs, Date.now() - operation.transferStartedAt) } } : {}),
    connectionId: operation?.connectionId, poolUuid: operation?.originPoolUuid,
    ...(operation && !operation.cleanupAttempted && TERMINAL_TRANSFER_STATES.has(progress.status) ? { status: 'running' as const, phase: 'cleanup' as const, message: '正在清理导出临时资源' } : {}), cleanupPending: Boolean(operation && !operation.cleanupAttempted) } : null
}

// ============================================================================
// Helpers
// ============================================================================

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

/**
 * Get connection details for HTTP export requests.
 * Similar to rrd-client.service.ts getConnectionDetails.
 */
function getConnectionDetails(
  connectionId: string,
  client: ReturnType<typeof getClient>,
): AuthenticatedHttpContext {
  const context = client.getAuthenticatedHttpContext?.()
  if (!context) {
    throw new IpcError('SESSION_INVALID', `No active session for: ${connectionId}`)
  }
  return context
}

/**
 * Custom error class for IPC-call-level errors with structured codes.
 */
export class IpcError extends Error {
  code: string
  details?: any
  constructor(code: string, message: string, details?: any) {
    super(message)
    this.code = code
    this.details = details
  }
}

/**
 * Validate that the export file path is safe (no path traversal) and writable.
 */
function validateExportFilePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new IpcError('FILE_PATH_INVALID', 'File path is required')
  }

  const resolved = path.resolve(filePath)

  // Prevent path traversal: reject paths containing '..'
  if (resolved.includes('..')) {
    throw new IpcError('FILE_PATH_INVALID', 'File path contains path traversal sequences')
  }

  // Ensure the file has a .xva extension
  if (!resolved.toLowerCase().endsWith('.xva')) {
    throw new IpcError('FILE_PATH_INVALID', 'Export file must have .xva extension')
  }

  // Check parent directory exists and is writable
  const dir = path.dirname(resolved)
  try {
    const stat = fs.statSync(dir)
    if (!stat.isDirectory()) {
      throw new IpcError('FILE_PATH_INVALID', `Parent path is not a directory: ${dir}`)
    }
    fs.accessSync(dir, fs.constants.W_OK)
  } catch (err: any) {
    if (err instanceof IpcError) throw err
    throw new IpcError('FILE_PATH_INVALID', `Cannot write to directory: ${dir}`)
  }
}

/**
 * Estimate required disk space for a VM export.
 * Returns the virtual_size of all VDIs attached to the VM.
 */
async function estimateExportSize(client: any, vmRef: string): Promise<number> {
  const vbdRefs: string[] = await client.callWithSession('VM.get_VBDs', [vmRef])
  let totalSize = 0
  for (const vbdRef of vbdRefs) {
    try {
      const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
      if (vbd.VDI && vbd.VDI !== 'OpaqueRef:NULL' && vbd.type === 'Disk') {
        const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
        totalSize += Number(vdi.virtual_size) || 0
      }
    } catch {
      // VDI may be gone or inaccessible
    }
  }
  return totalSize
}

/**
 * Check local disk space available at the given path.
 */
function checkDiskSpace(filePath: string, requiredBytes: number): void {
  try {
    const dir = path.dirname(path.resolve(filePath))
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const stats = fs.statfsSync(dir)
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)

    // Add 10% safety margin
    const requiredWithMargin = Math.ceil(requiredBytes * 1.1)

    if (requiredBytes > 0 && availableBytes < requiredWithMargin) {
      const availGB = (availableBytes / (1024 * 1024 * 1024)).toFixed(2)
      const reqGB = (requiredWithMargin / (1024 * 1024 * 1024)).toFixed(2)
      throw new IpcError(
        'DISK_SPACE_INSUFFICIENT',
        `Insufficient disk space: ${availGB} GB available, ~${reqGB} GB required`
      )
    }
  } catch (err: any) {
    if (err instanceof IpcError) throw err
    // If we can't check disk space, log warning and proceed
    log.warn(`Cannot check disk space: ${err.message}`)
  }
}

function parseTarOctal(buffer: Buffer): number {
  return parseInt(buffer.toString('ascii').replace(/\0/g, '').trim(), 8) || 0
}

function validateXvaFile(filePath: string): {
  resolvedPath: string
  preview: VmImportPreview
  fileSize: number
} {
  if (!filePath || path.extname(filePath).toLowerCase() !== '.xva') {
    throw new IpcError('IMPORT_FORMAT_UNSUPPORTED', '仅支持未压缩的 .xva 文件')
  }
  const resolvedPath = path.resolve(filePath)
  if (!fs.existsSync(resolvedPath)) throw new IpcError('FILE_NOT_FOUND', `XVA file not found: ${filePath}`)
  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK)
  } catch {
    throw new IpcError('FILE_NOT_FOUND', `Cannot read XVA file: ${filePath}`)
  }

  const fileSize = Number(fs.statSync(resolvedPath).size)
  if (fileSize < 1024) throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA archive is too small')
  const handle = fs.openSync(resolvedPath, 'r')
  try {
    let offset = 0
    while (offset + 512 <= fileSize) {
      const header = Buffer.alloc(512)
      if (fs.readSync(handle, header, 0, 512, offset) !== 512) break
      if (header.every((byte) => byte === 0)) break
      try { readTarHeader(header) } catch (error: any) { throw new IpcError('IMPORT_FORMAT_INVALID', error.message) }
      const name = header.toString('utf8', 0, 100).replace(/\0/g, '').trim()
      const entrySize = parseTarOctal(header.subarray(124, 136))
      const dataOffset = offset + 512
      if (dataOffset + entrySize > fileSize) throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA contains an incomplete entry')
      if (name === 'ova.xml' || name.endsWith('/ova.xml')) {
        if (entrySize < 1) throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA manifest is empty')
        if (entrySize > 16 * 1024 * 1024) throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA manifest is too large')
        const xml = Buffer.alloc(entrySize)
        if (fs.readSync(handle, xml, 0, entrySize, dataOffset) !== entrySize) {
          throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA manifest cannot be read completely')
        }
        const xmlText = xml.toString('utf8')
        if (XMLValidator.validate(xmlText) !== true) throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA 元数据 XML 无效')
        if (
          !xmlText.includes('<')
          || !xmlText.includes('>')
          || !/<(?:appliance|struct|member)\b/i.test(xmlText)
        ) {
          throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA manifest is invalid')
        }
        const archive = Buffer.alloc(512 + Math.ceil(entrySize / 512) * 512 + 1024)
        header.copy(archive)
        xml.copy(archive, 512)
        const preview = parseXvaHeader(archive)
        return { resolvedPath, preview: { ...preview, originalSize: preview.originalSize || fileSize }, fileSize }
      }
      offset = dataOffset + Math.ceil(entrySize / 512) * 512
    }
    throw new IpcError('IMPORT_FORMAT_INVALID', 'XVA archive does not contain ova.xml')
  } finally {
    fs.closeSync(handle)
  }
}

function xmlArray(value: any): any[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function decodeXmlRpcValue(node: any): any {
  const value = node?.value ?? node
  if (value?.struct) {
    return Object.fromEntries(xmlArray(value.struct.member).map((member) => [
      String(member.name), decodeXmlRpcValue(member.value),
    ]))
  }
  if (value?.array) return xmlArray(value.array.data?.value).map(decodeXmlRpcValue)
  if (value?.string !== undefined) return String(value.string)
  if (value?.boolean !== undefined) return value.boolean === '1' || value.boolean === 'true'
  if (value?.int !== undefined || value?.i4 !== undefined) return Number(value.int ?? value.i4)
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return value?.['#text'] === undefined ? '' : String(value['#text'])
}

function parseXapiObjects(xml: string): any[] {
  const parsed = new XMLParser({ parseTagValue: false, trimValues: true }).parse(xml)
  const root = decodeXmlRpcValue(parsed.value)
  return Array.isArray(root?.objects) ? root.objects : []
}

// ============================================================================
// HTTP Export functions
// ============================================================================

/**
 * Update progress in the tracking map.
 */
function updateProgress(
  exportId: string,
  status: VmTransferProgress['status'],
  progress: number,
  bytesTransferred: number,
  bytesTotal: number,
  message: string,
  details: Pick<VmTransferProgress, 'phase' | 'transfer' | 'validation'> = {},
): void {
  exportProgressMap.set(exportId, {
    ...exportProgressMap.get(exportId),
    taskId: exportId,
    progress,
    status,
    message,
    bytesTransferred,
    bytesTotal,
    lastUpdatedAt: Date.now(),
    ...details,
  })
  persistTransfers(Boolean(details.phase || details.validation && details.validation.bytesChecked === details.validation.bytesTotal)
    || TERMINAL_TRANSFER_STATES.has(status) || status === 'unknown')
}

function scheduleExportOperationExpiry(exportId: string): void {
  const timer = setTimeout(() => {
    exportProgressMap.delete(exportId)
    exportOperations.delete(exportId)
    persistTransfers(true)
  }, 24 * 60 * 60 * 1000)
  timer.unref?.()
}

function waitForTaskPoll(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, TASK_POLL_INTERVAL_MS)
    timer.unref?.()
  })
}

/**
 * Clean up partial export file on failure.
 */
function cleanupPartialFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // Best-effort cleanup
  }
}

function archiveDisks(xml: string): { disks: XvaDisk[]; diskCount: number } {
  if (XMLValidator.validate(xml) !== true) throw new Error('XVA 元数据 XML 无效')
  const objects = parseXapiObjects(xml)
  if (objects.length) {
    if (objects.filter((o) => o.class === 'VM').length !== 1) throw new Error('XVA 必须包含一个虚拟机或模板')
    const diskIds = new Set(objects.filter((o) => o.class === 'VBD' && o.snapshot?.type === 'Disk' && !o.snapshot.empty).map((o) => o.snapshot.VDI))
    const vm = objects.find((o) => o.class === 'VM')!.snapshot
    if (vm.power_state === 'Suspended') diskIds.add(vm.suspend_VDI)
    const disks = [...diskIds].map((id) => {
      const records = objects.filter((o) => o.class === 'VDI' && o.id === id)
      const size = Number(records[0]?.snapshot?.virtual_size)
      if (!id || records.length !== 1 || !Number.isSafeInteger(size) || size <= 0) throw new Error('XVA 缺少磁盘或内存镜像的有效元数据')
      return { id: String(id), size }
    })
    return { disks, diskCount: disks.length }
  }
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false }).parse(xml)
  if (!parsed.appliance?.vm) throw new Error('XVA 缺少虚拟机元数据')
  const entries = xmlArray(parsed.appliance?.vdi)
  return { disks: entries.filter((d) => d.id && Number(d.size) > 0).map((d) => ({ id: String(d.id), size: Number(d.size) })), diskCount: entries.length }
}

async function validateXvaIntegrity(filePath: string, signal?: AbortSignal, onProgress?: (progress: XvaValidationProgress) => void): Promise<void> {
  try { await verifyXvaArchive(filePath, archiveDisks, signal, onProgress) }
  catch (error: any) { throw new IpcError('XVA_INTEGRITY_FAILED', `XVA 完整性检查失败：${error.message}`) }
}

/** Import acknowledgements and HTTP errors are small control messages, not XVA data. */
function readTransferResponse(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      chunks.length = 0
      reject(error)
    }
    res.on('error', fail)
    res.on('aborted', () => fail(res.errored ?? new Error('HTTP response was interrupted')))
    res.on('close', () => { if (!settled) fail(new Error('HTTP response closed before completion')) })
    res.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
      chunks.length = 0
    })
    res.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > 64 * 1024) {
        fail(new Error('HTTP control response exceeds 64 KiB'))
        res.destroy()
        return
      }
      chunks.push(buffer)
    })
    if (res.destroyed) fail(res.errored ?? new Error('HTTP response was already closed'))
  })
}

/**
 * Handle HTTP response for export download using pipeline for safe stream handling.
 */
async function handleResponse(
  res: IncomingMessage,
  filePath: string,
  exportId: string,
  contentLength: number | undefined
): Promise<void> {
  if (res.statusCode !== 200) {
    let body: string
    try { body = await readTransferResponse(res) }
    catch (error) {
      cleanupPartialFile(filePath)
      throw new IpcError('EXPORT_NETWORK_ERROR', `Export response failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    cleanupPartialFile(filePath)
    const message = res.statusCode === 401 || res.statusCode === 403
      ? 'Authentication failed or insufficient permissions'
      : `HTTP ${res.statusCode}: ${body.substring(0, 200)}`
    updateProgress(exportId, 'running', 0, 0, 0, message)
    throw new IpcError('EXPORT_HTTP_ERROR', message)
  }

  // Virtual disk capacity cannot supply the length of a sparse XVA stream.
  const totalBytes = Number.isSafeInteger(contentLength) && contentLength! > 0 ? contentLength! : 0
  let bytesReceived = 0
  const startedAt = Date.now()
  const operation = exportOperations.get(exportId)
  if (operation) operation.transferStartedAt = startedAt
  const transfer = () => ({ bytesTransferred: bytesReceived, bytesTotal: totalBytes, elapsedMs: Math.max(0, Date.now() - startedAt) })
  updateProgress(exportId, 'running', totalBytes ? 0 : -1, bytesReceived, totalBytes, '正在下载 XVA', { phase: 'transferring', transfer: transfer() })

  const writeStream = fs.createWriteStream(filePath)

  // Create a Transform stream to track progress without interfering with pipeline
  const progressTracker = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.length
      const progress = totalBytes > 0 ? Math.min(100, (bytesReceived / totalBytes) * 100) : -1
      updateProgress(exportId, 'running', progress, bytesReceived, totalBytes, '正在下载 XVA', { transfer: transfer() })
      callback(null, chunk) // pass data through unchanged
    }
  })

  try {
    // Use pipeline for safe stream handling - ensures all data is transferred
    await pipeline(res, progressTracker, writeStream)

    // Validate the exported XVA file integrity
    try {
      updateProgress(exportId, 'running', 0, bytesReceived, totalBytes, '正在校验下载的 XVA', { phase: 'validating', transfer: transfer() })
      await validateXvaIntegrity(filePath, exportOperations.get(exportId)?.abortController.signal, (validation) => {
        updateProgress(exportId, 'running', validation.bytesTotal > 0 ? validation.bytesChecked / validation.bytesTotal * 100 : 0,
          bytesReceived, totalBytes, '正在校验下载的 XVA', { validation })
      })
    } catch (error) {
      cleanupPartialFile(filePath)
      updateProgress(exportId, 'running', 0, bytesReceived, totalBytes, 'XVA archive validation failed - file may be truncated')
      throw error
    }

    // Verify file size against Content-Length if provided
    if (contentLength && contentLength > 0) {
      const fileStat = fs.statSync(filePath)
      const sizeRatio = fileStat.size / contentLength
      if (sizeRatio !== 1) {
        cleanupPartialFile(filePath)
        updateProgress(exportId, 'running', 0, bytesReceived, totalBytes, `File size mismatch: received ${fileStat.size} bytes, expected ${contentLength} bytes`)
        throw new IpcError('EXPORT_TRUNCATED', `Export file appears truncated: received ${fileStat.size} bytes, expected ${contentLength} bytes`)
      }
    }

    updateProgress(
      exportId,
      'running',
      -1,
      bytesReceived,
      totalBytes,
      '文件已接收并通过校验，等待资源池任务确认',
      { phase: 'waiting_for_task' },
    )
  } catch (err) {
    // Check if this was a user cancellation
    const currentProgress = exportProgressMap.get(exportId)
    if (currentProgress?.status === 'cancelling') {
      // User cancelled - clean up silently
      cleanupPartialFile(filePath)
      throw new IpcError('EXPORT_CANCEL_REQUESTED', 'Export cancellation requested')
    }
    cleanupPartialFile(filePath)
    if (err instanceof IpcError) {
      throw err
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    updateProgress(exportId, 'running', 0, bytesReceived, totalBytes, `Export failed: ${errorMessage}`)
    throw new IpcError('EXPORT_PIPELINE_ERROR', `Export pipeline failed: ${errorMessage}`)
  }
}

/**
 * Perform HTTP GET request to export VM via /export endpoint.
 */
async function exportVmHttp(
  context: AuthenticatedHttpContext,
  vmUuid: string,
  xapiTaskRef: string,
  filePath: string,
  exportId: string,
  signal: AbortSignal,
  useCompression: boolean = false,
): Promise<void> {
  const query = new URLSearchParams({
    session_id: context.sessionId,
    uuid: vmUuid,
    task_id: xapiTaskRef,
    // XAPI otherwise drops the suspend VDI, including for a checkpoint.
    preserve_power_state: 'true',
    ...(useCompression ? { use_compression: 'true' } : {}),
  })

  let response: IncomingMessage
  try {
    response = await requestXapiHttp({
      context,
      method: 'GET',
      path: '/export',
      query,
      timeoutMs: 0,
      idleTimeoutMs: TASK_RESULT_TIMEOUT_MS,
      signal,
    })
  } catch (error) {
    cleanupPartialFile(filePath)
    if (exportProgressMap.get(exportId)?.status === 'cancelling') {
      throw new IpcError('EXPORT_CANCEL_REQUESTED', 'Export cancellation requested')
    }
    const message = error instanceof Error ? error.message : String(error)
    updateProgress(exportId, 'running', 0, 0, 0, `Network error: ${message}`)
    throw new IpcError('EXPORT_NETWORK_ERROR', `Export request failed: ${message}`)
  }

  const contentLength = response.headers['content-length']
    ? parseInt(response.headers['content-length'], 10)
    : undefined
  await handleResponse(response, filePath, exportId, contentLength)
}

async function reconcileExportTask(
  client: { callWithSession: (method: string, params: any[]) => Promise<any> },
  exportId: string,
  taskRef: string,
  partialPath: string,
  finalPath: string,
  transferCompleted: boolean,
): Promise<'terminal' | 'unknown'> {
  let unavailable = 0
  const deadline = Date.now() + TASK_RESULT_TIMEOUT_MS
  while (true) {
    if (Date.now() >= deadline) {
      const progress = exportProgressMap.get(exportId)
      if (progress) updateProgress(exportId, 'unknown', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, `等待导出任务 ${taskRef} 的执行结果超时`)
      const operation = exportOperations.get(exportId)
      if (operation) operation.recovered = true
      return 'unknown'
    }
    let task: any
    try {
      const operation = exportOperations.get(exportId)
      const observer = operation ? currentTransferClient(operation, client) : client
      task = await observer.callWithSession('task.get_record', [taskRef])
    } catch (error) {
      if (++unavailable >= 5) {
        const progress = exportProgressMap.get(exportId)
        if (progress) updateProgress(exportId, 'unknown', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, `获取导出任务 ${taskRef} 结果失败：${error instanceof Error ? error.message : String(error)}`)
        const operation = exportOperations.get(exportId)
        if (operation) operation.recovered = true
        return 'unknown'
      }
      const progress = exportProgressMap.get(exportId)
      if (progress?.status === 'running') {
        updateProgress(
          exportId,
          'running',
          progress.progress,
          progress.bytesTransferred ?? 0,
          progress.bytesTotal ?? 0,
          `Export file received; resource pool task state is unavailable (${taskRef}): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      await waitForTaskPoll()
      continue
    }

    if (!task || !['pending', 'cancelling', 'success', 'failure', 'cancelled'].includes(task.status)) {
      if (++unavailable >= 5) {
        const progress = exportProgressMap.get(exportId)
        if (progress) updateProgress(exportId, 'unknown', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, `导出任务 ${taskRef} 连续返回无效状态`)
        const operation = exportOperations.get(exportId)
        if (operation) operation.recovered = true
        return 'unknown'
      }
      const progress = exportProgressMap.get(exportId)
      if (progress) {
        const warning = `无法读取导出任务 ${taskRef} 的有效状态，继续等待资源池确认`
        updateProgress(exportId, progress.status, progress.progress, progress.bytesTransferred ?? 0,
          progress.bytesTotal ?? 0, progress.message.includes(warning) ? progress.message : `${progress.message}；${warning}`)
      }
      await waitForTaskPoll()
      continue
    }

    unavailable = 0
    const progress = exportProgressMap.get(exportId)
    if (!progress) return 'unknown'
    if (task.status === 'success') {
      if (transferCompleted) {
        try {
          fs.linkSync(partialPath, finalPath)
          cleanupPartialFile(partialPath)
        } catch (error) {
          updateProgress(exportId, 'failed', progress.progress, progress.bytesTransferred ?? 0,
            progress.bytesTotal ?? 0, `无法保存到目标路径：${error instanceof Error ? error.message : String(error)}。已验证的 XVA 保留在 ${partialPath}，可手动移动文件。`)
          return 'terminal'
        }
        updateProgress(
          exportId,
          'completed',
          100,
          progress.bytesTransferred ?? 0,
          progress.bytesTransferred ?? 0,
          '导出完成，正在清理临时资源',
        )
      } else {
        cleanupPartialFile(partialPath)
        updateProgress(
          exportId,
          'failed',
          progress.progress,
          progress.bytesTransferred ?? 0,
          progress.bytesTotal ?? 0,
          'Resource pool task succeeded, but the local XVA file was not completed',
        )
      }
      return 'terminal'
    }
    if (task.status === 'failure') {
      cleanupPartialFile(partialPath)
      const message = Array.isArray(task.error_info)
        ? task.error_info.filter(Boolean).join(': ')
        : 'Resource pool export task failed'
      updateProgress(
        exportId,
        'failed',
        progress.progress,
        progress.bytesTransferred ?? 0,
        progress.bytesTotal ?? 0,
        message,
      )
      return 'terminal'
    }
    if (task.status === 'cancelled') {
      cleanupPartialFile(partialPath)
      updateProgress(
        exportId,
        'cancelled',
        progress.progress,
        progress.bytesTransferred ?? 0,
        progress.bytesTotal ?? 0,
        'Resource pool task confirmed export cancellation',
      )
      return 'terminal'
    }
    if (progress.status !== 'cancelling' && (transferCompleted || progress.status === 'unknown')) {
      updateProgress(
        exportId,
        'running',
        progress.progress,
        progress.bytesTransferred ?? 0,
        progress.bytesTotal ?? 0,
        transferCompleted
          ? '文件已接收并通过校验，等待资源池任务确认'
          : '正在等待原导出任务结束；本地传输未确认完成，可取消原任务后核对',
      )
    }
    await waitForTaskPoll()
  }
}

/**
 * Perform HTTP PUT request to import VM via /import endpoint.
 * Uses streaming upload from file to handle large XVA files.
 */
async function importVmHttp(
  operationId: string,
  context: AuthenticatedHttpContext,
  filePath: string,
  srRef: string,
  taskRef: string,
): Promise<void> {
  const fileSize = Number(fs.statSync(filePath).size)
  const query = new URLSearchParams({
    session_id: context.sessionId,
    sr_id: srRef,
    task_id: taskRef,
    restore: 'false',
    force: 'false',
  })
  const operation = importOperations.get(operationId)
  if (!operation) throw new IpcError('IMPORT_OPERATION_NOT_FOUND', 'Import operation not found')
  const startedAt = Date.now()
  operation.transferStartedAt = startedAt
  const transfer = (bytesTransferred: number) => ({ bytesTransferred, bytesTotal: fileSize, elapsedMs: Math.max(0, Date.now() - startedAt) })
  updateImportOperation(operationId, { transfer: transfer(0) })
  let fileReadError: unknown

  let response: IncomingMessage
  try {
    response = await requestXapiHttp({
      context,
      method: 'PUT',
      path: '/import',
      query,
      headers: { 'Content-Type': 'application/octet-stream' },
      contentLength: fileSize,
      bodyFactory: () => {
        let uploaded = 0
        const fileStream = fs.createReadStream(filePath)
        fileStream.on('error', (error) => {
          fileReadError = error
        })
        fileStream.on('data', (chunk) => {
          uploaded += Buffer.byteLength(chunk)
          const currentOperation = importOperations.get(operationId)
          if (!currentOperation || currentOperation.status === 'cancelling') return
          updateImportOperation(operationId, {
            status: 'uploading',
            progress: fileSize > 0 ? Math.min(100, uploaded / fileSize * 100) : 0,
            transfer: transfer(uploaded),
            message: '正在上传 XVA',
          })
        })
        return fileStream
      },
      timeoutMs: 0,
      idleTimeoutMs: TASK_RESULT_TIMEOUT_MS,
      signal: operation.abortController.signal,
    })
  } catch (error) {
    if (importOperations.get(operationId)?.status === 'cancelling') {
      throw new IpcError('IMPORT_CANCEL_REQUESTED', 'Import cancellation requested')
    }
    if (fileReadError instanceof Error) {
      throw new IpcError('IMPORT_FILE_ERROR', `Failed to read file: ${fileReadError.message}`)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new IpcError('IMPORT_NETWORK_ERROR', `Import request failed: ${message}`)
  }

  await handleImportResponse(response, filePath, taskRef)
}
function extractImportedVmRef(result: unknown): string {
  const refs = [...new Set(String(result ?? '').match(/OpaqueRef:[A-Za-z0-9._:-]+/g) ?? [])]
    .filter((ref) => ref !== 'OpaqueRef:NULL')
  if (refs.length !== 1) {
    throw new IpcError('IMPORT_RESULT_INVALID', 'Import task did not return exactly one VM reference')
  }
  return refs[0]
}

export async function applyImportNetworkMap(
  client: { callWithSession: (method: string, params: any[]) => Promise<any> },
  vmRef: string,
  vifMappings: Record<string, string>,
): Promise<void> {
  const mappings = Object.fromEntries(Object.entries(vifMappings).filter(([, networkRef]) => !!networkRef))
  if (Object.keys(mappings).length === 0) return
  const vifRefs: string[] = await client.callWithSession('VM.get_VIFs', [vmRef])
  const matchedDevices = new Set<string>()
  for (const vifRef of vifRefs) {
    const vifRecord = await client.callWithSession('VIF.get_record', [vifRef])
    const device = String(vifRecord.device ?? '')
    const networkRef = mappings[device]
    if (networkRef) matchedDevices.add(device)
    if (networkRef && networkRef !== vifRecord.network) {
      await client.callWithSession('VIF.move', [vifRef, networkRef])
      const movedVif = await client.callWithSession('VIF.get_record', [vifRef])
      if (movedVif?.network !== networkRef) {
        throw new IpcError('IMPORT_NETWORK_MISMATCH', `Virtual interface ${device} was not connected to the selected network`)
      }
    }
  }
  for (const device of Object.keys(mappings)) {
    if (!matchedDevices.has(device)) {
      throw new IpcError('IMPORT_VIF_MISSING', `Imported VM does not contain virtual interface ${device}`)
    }
  }
}

async function configureImportedVm(
  client: { callWithSession: (method: string, params: any[]) => Promise<any> },
  vmRef: string,
  params: VmImportParams,
  operation?: InternalImportOperation,
): Promise<void> {
  const imported = await client.callWithSession('VM.get_record', [vmRef])
  if (!imported || typeof imported !== 'object') {
    throw new IpcError('IMPORT_RESULT_INVALID', 'Imported VM record is unavailable')
  }
  if (operation) {
    if (!imported.uuid || operation.vmUuid && imported.uuid !== operation.vmUuid) throw new IpcError('IMPORT_RESULT_INVALID', '导入对象 UUID 未确认')
    operation.vmUuid = imported.uuid
    persistTransfers(true)
  }
  if (params.nameLabel !== undefined && params.nameLabel !== imported.name_label) {
    await client.callWithSession('VM.set_name_label', [vmRef, params.nameLabel])
  }
  if (params.nameDescription !== undefined && params.nameDescription !== imported.name_description) {
    await client.callWithSession('VM.set_name_description', [vmRef, params.nameDescription])
  }
  if (params.homeServerRef !== undefined) {
    const affinity = params.homeServerRef ?? 'OpaqueRef:NULL'
    if (imported.affinity !== affinity) {
      await client.callWithSession('VM.set_affinity', [vmRef, affinity])
    }
  }
  await applyImportNetworkMap(client, vmRef, params.vifMappings)
}

async function verifyImportedVm(client: { callWithSession: (method: string, params: any[]) => Promise<any> }, operation: InternalImportOperation, vmRef: string): Promise<void> {
  const params = operation.params!
  const record = await client.callWithSession('VM.get_record', [vmRef])
  if (!record?.uuid || operation.vmUuid && record.uuid !== operation.vmUuid) throw new IpcError('IMPORT_RESULT_INVALID', '导入对象身份未确认，请核对原对象')
  operation.vmUuid = record.uuid
  persistTransfers(true)
  const mismatches: string[] = []
  if (operation.expectedPreview && Boolean(record.is_a_template) !== operation.expectedPreview.isTemplate) mismatches.push('模板类型')
  if (params.homeServerRef !== undefined && record.affinity !== (params.homeServerRef ?? 'OpaqueRef:NULL')) mismatches.push('Home Server')
  if (params.nameLabel !== undefined && record.name_label !== params.nameLabel) mismatches.push('名称')
  if (params.nameDescription !== undefined && record.name_description !== params.nameDescription) mismatches.push('描述')
  const vifs: string[] = await client.callWithSession('VM.get_VIFs', [vmRef])
  const remaining = new Set(Object.keys(params.vifMappings))
  for (const ref of vifs) {
    const vif = await client.callWithSession('VIF.get_record', [ref])
    const target = params.vifMappings[String(vif.device)]
    if (target && (vif.network !== target || vif.VM !== vmRef)) mismatches.push(`网卡 ${vif.device}`)
    remaining.delete(String(vif.device))
  }
  if (remaining.size) mismatches.push('缺失网卡')
  const vbds: string[] = await client.callWithSession('VM.get_VBDs', [vmRef])
  const disks = new Set<string>()
  for (const ref of vbds) {
    const vbd = await client.callWithSession('VBD.get_record', [ref])
    if (vbd.type !== 'Disk' || vbd.empty) continue
    const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
    if (vbd.VM !== vmRef || vdi.SR !== params.srRef) mismatches.push('磁盘归属')
    disks.add(vbd.VDI)
  }
  if (operation.expectedPreview && disks.size !== operation.expectedPreview.diskCount) mismatches.push('磁盘数量')
  if (operation.expectedPreview?.powerState && record.power_state !== operation.expectedPreview.powerState) mismatches.push('电源状态')
  if (operation.expectedPreview?.powerState === 'Suspended') {
    if (!record.suspend_VDI || record.suspend_VDI === 'OpaqueRef:NULL') mismatches.push('内存镜像')
    else {
      const suspendVdi = await client.callWithSession('VDI.get_record', [record.suspend_VDI])
      if (suspendVdi.SR !== params.srRef || Number(suspendVdi.virtual_size) !== operation.expectedPreview.suspendDiskSize) mismatches.push('内存镜像归属或容量')
    }
  }
  if (mismatches.length) throw new IpcError('IMPORT_CONFIGURATION_UNCONFIRMED', `对象已导入，以下配置尚未核对通过：${[...new Set(mismatches)].join('、')}。可查看原对象恢复配置，系统继续只读核对`)
}

export async function applyPostImportConfiguration(
  client: { callWithSession: (method: string, params: any[]) => Promise<any> },
  taskRef: string,
  params: VmImportParams,
): Promise<string> {
  const taskRecord = await client.callWithSession('task.get_record', [taskRef])
  const vmRef = extractImportedVmRef(taskRecord.result)
  await configureImportedVm(client, vmRef, params)
  return vmRef
}
/**
 * Handle HTTP response for import upload.
 */
async function handleImportResponse(
  res: IncomingMessage,
  _filePath: string,
  _taskRef: string
): Promise<void> {
  let body: string
  try { body = await readTransferResponse(res) }
  catch (error) { throw new IpcError('IMPORT_NETWORK_ERROR', `Response error: ${error instanceof Error ? error.message : String(error)}`) }
  if (res.statusCode !== 200) {
    const message = res.statusCode === 401 || res.statusCode === 403
      ? 'Authentication failed or insufficient permissions'
      : res.statusCode === 507
      ? 'Insufficient storage on target SR'
      : `HTTP ${res.statusCode}: ${body.substring(0, 200)}`
    throw new IpcError('IMPORT_HTTP_ERROR', message)
  }
}

/**
 * Parse XVA file header to extract metadata.
 * XVA format: tar archive containing ova.xml manifest and chunked data.
 *
 * Supports two ova.xml formats:
 * 1. Simple appliance format: <appliance><vm><label>, <config mem_set vcpus>, etc.
 * 2. XAPI metadata format: XML-RPC style with <member><name><value> elements
 */
function parseXvaHeader(fileContent: Buffer): VmImportPreview {
  // XVA files are tar archives. Validate minimum size.
  if (fileContent.length < 1024) {
    throw new IpcError('FILE_FORMAT_INVALID', 'File is too small to be a valid XVA archive')
  }

  // Check for tar magic at offset 257 (ustar)
  const tarMagic = fileContent.toString('utf-8', 257, 262)
  const isValidTar = tarMagic.startsWith('ustar')

  // Initialize result with defaults
  let vmName = 'Unknown VM'
  let description = ''
  let diskCount = 0
  let originalSize = 0
  let exportTime = new Date().toISOString()
  const networks: string[] = []
  let parsedVifs: VmImportPreview['vifs'] = []
  let isTemplate = false
  let vcpus = 1
  let memory = 0
  let isHvm = false
  let powerState: VmImportPreview['powerState']
  let suspendDiskSize: number | undefined

  // Helper to parse octal number from tar header
  const parseOctal = (str: string): number => {
    const trimmed = str.replace(/\0/g, '').trim()
    return parseInt(trimmed, 8) || 0
  }

  // Scan tar entries to find ova.xml
  let offset = 0
  let ovaXmlContent: string | null = null

  while (offset < fileContent.length - 512) {
    // Read tar header (512 bytes)
    const header = fileContent.subarray(offset, offset + 512)

    // Check for end of archive (two zero blocks)
    let allZeros = true
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZeros = false
        break
      }
    }
    if (allZeros) break

    // Extract filename (offset 0, length 100 for old format, or check prefix)
    let fileName = header.toString('utf-8', 0, 100).replace(/\0/g, '').trim()

    // Check for prefix (ustar format, offset 345, length 155)
    if (isValidTar) {
      const prefix = header.toString('utf-8', 345, 500).replace(/\0/g, '').trim()
      if (prefix) {
        fileName = prefix + '/' + fileName
      }
    }

    // Extract file size (offset 124, length 12, octal)
    const sizeStr = header.toString('utf-8', 124, 136)
    const fileSize = parseOctal(sizeStr)

    // Check if this is ova.xml
    if (fileName === 'ova.xml' || fileName.endsWith('/ova.xml')) {
      // Read file content (may extend beyond current buffer)
      const contentEnd = offset + 512 + fileSize
      const availableEnd = Math.min(contentEnd, fileContent.length)

      if (availableEnd > offset + 512) {
        ovaXmlContent = fileContent.toString('utf-8', offset + 512, availableEnd)
      }
      break
    }

    // Move to next entry (512-byte aligned)
    const blocks = Math.ceil(fileSize / 512)
    offset += 512 + blocks * 512
  }

  if (!ovaXmlContent) {
    // Fallback: try to find XML content anywhere in the buffer
    const text = fileContent.toString('utf-8')
    const xmlStart = text.indexOf('<?xml')
    if (xmlStart >= 0) {
      ovaXmlContent = text.substring(xmlStart)
    }
  }

  if (ovaXmlContent) {
    // ===== Parse XAPI metadata format (XML-RPC style) =====
    // This format uses <struct><member><name>...</name><value>...</value></member></struct>
    const hasXmlRpcFormat = ovaXmlContent.includes('<member>') && ovaXmlContent.includes('<name>')

    if (hasXmlRpcFormat) {
      const objects = parseXapiObjects(ovaXmlContent)
      const vm = objects.find((object) => object.class === 'VM')?.snapshot ?? {}
      const networkNames = new Map(objects
        .filter((object) => object.class === 'network')
        .map((object) => [String(object.id), String(object.snapshot?.name_label || object.id)]))
      vmName = String(vm.name_label || vmName)
      description = String(vm.name_description || '')
      vcpus = Number(vm.VCPUs_max) || 1
      memory = Number(vm.memory_static_max) || 0
      isTemplate = vm.is_a_template === true || vm.is_a_template === 'true' || vm.is_a_template === '1'
      isHvm = Boolean(vm.HVM_boot_policy)
      if (vm.power_state === 'Suspended' || vm.power_state === 'Halted') powerState = vm.power_state
      parsedVifs = objects.filter((object) => object.class === 'VIF').map((object) => ({
        device: String(object.snapshot?.device ?? ''),
        sourceNetworkName: networkNames.get(String(object.snapshot?.network)) || String(object.snapshot?.network || ''),
      })).filter((vif) => vif.device !== '')
      const diskIds = new Set(objects.filter((o) => o.class === 'VBD' && o.snapshot?.type === 'Disk' && !o.snapshot.empty).map((o) => o.snapshot.VDI))
      const diskObjects = objects.filter((object) => object.class === 'VDI' && diskIds.has(object.id))
      diskCount = diskObjects.length
      const inventory = archiveDisks(ovaXmlContent)
      originalSize = inventory.disks.reduce((sum, disk) => sum + disk.size, 0)
      if (powerState === 'Suspended') suspendDiskSize = inventory.disks.find((disk) => disk.id === vm.suspend_VDI)?.size
    } else {
      // ===== Parse simple appliance format =====
      // <appliance version="0.1"><vm name="...">

      // Extract VM name from <label> element
      const labelMatch = ovaXmlContent.match(/<label>([^<]*)<\/label>/i)
      if (labelMatch) {
        vmName = labelMatch[1].trim()
      } else {
        // Fallback to vm name attribute
        const vmNameMatch = ovaXmlContent.match(/<vm[^>]+name="([^"]+)"/i)
        if (vmNameMatch) vmName = vmNameMatch[1]
      }

      // Extract description from <shortdesc>
      const shortDescMatch = ovaXmlContent.match(/<shortdesc>([^<]*)<\/shortdesc>/i)
      if (shortDescMatch) {
        description = shortDescMatch[1].trim()
      }

      // Extract vcpus from <config vcpus="...">
      const vcpusMatch = ovaXmlContent.match(/<config[^>]+vcpus="(\d+)"/i)
      if (vcpusMatch) {
        vcpus = parseInt(vcpusMatch[1], 10)
      }

      // Extract memory from <config mem_set="...">
      const memMatch = ovaXmlContent.match(/<config[^>]+mem_set="(\d+)"/i)
      if (memMatch) {
        memory = parseInt(memMatch[1], 10)
      }

      // Check for HVM mode from <hacks is_hvm="...">
      const hvmMatch = ovaXmlContent.match(/<hacks[^>]+is_hvm="([^"]+)"/i)
      if (hvmMatch) {
        isHvm = hvmMatch[1].toLowerCase() === 'true'
      }

      // Count <vbd> elements with type=Disk or count <vdi> elements
      const vbdMatches = ovaXmlContent.match(/<vbd[^>]*>/g)
      const vdiMatches = ovaXmlContent.match(/<vdi[^>]*>/g)

      if (vdiMatches) {
        diskCount = vdiMatches.length
      } else if (vbdMatches) {
        // Count VBDs that are disks (not CD-ROMs)
        diskCount = vbdMatches.filter((vbd) => {
          const typeMatch = vbd.match(/type="([^"]+)"/)
          return !typeMatch || typeMatch[1].toLowerCase() !== 'cd'
        }).length
      }

      // Sum <vdi size="..."> values
      const sizePattern = /<vdi[^>]+size="(\d+)"[^>]*>/g
      let sizeMatch
      while ((sizeMatch = sizePattern.exec(ovaXmlContent)) !== null) {
        originalSize += parseInt(sizeMatch[1], 10)
      }

      // Extract networks from <vif network="..."> elements
      const vifPattern = /<vif[^>]+network="([^"]+)"[^>]*>/g
      let vifMatch
      while ((vifMatch = vifPattern.exec(ovaXmlContent)) !== null) {
        const net = vifMatch[1].trim()
        if (net && !networks.includes(net)) {
          networks.push(net)
        }
      }
    }

    // Common parsing for both formats - network extraction
    if (networks.length === 0 && !hasXmlRpcFormat) {
      // Try general network pattern
      const netPattern = /network="([^"]+)"/g
      let netMatch
      while ((netMatch = netPattern.exec(ovaXmlContent!)) !== null) {
        const net = netMatch[1].trim()
        if (net && !networks.includes(net)) {
          networks.push(net)
        }
      }
    }

    // Check for is_a_template in XML-RPC format (might be outside member structure)
    if (!isTemplate) {
      const templateMatch = ovaXmlContent.match(/is_a_template[\s\S]*?<boolean>(\d)<\/boolean>/)
      isTemplate = templateMatch ? templateMatch[1] === '1' : false
    }
  }

  // Fallback: estimate size from file size if parsing didn't work
  if (originalSize === 0) {
    // Use the entire file content size as a rough estimate
    originalSize = fileContent.length
  }

  return {
    vmName,
    originalSize,
    diskCount,
    exportTime,
    vifs: parsedVifs.length ? parsedVifs : networks.map((sourceNetworkName, index) => ({ device: String(index), sourceNetworkName })),
    isTemplate,
    vcpus,
    memory,
    isHvm,
    description,
    ...(powerState ? { powerState } : {}),
    ...(suspendDiskSize !== undefined ? { suspendDiskSize } : {}),
  }
}

// ============================================================================
// Exported service functions
// ============================================================================

export function getImportProgress(operationId: string): VmImportOperation | null {
  ensureTransferJournalLoaded()
  const operation = importOperations.get(operationId)
  if (!operation) return null
  if (operation.recovered && !TERMINAL_TRANSFER_STATES.has(operation.status)) requestTransferRecovery(operation.connectionId, operation.originPoolUuid)
  const { expectedPreview: _preview, vmUuid: _uuid, connectionId: _connectionId, abortController: _abortController, originEndpoint: _endpoint, originPoolUuid: _poolUuid, params: _params, configurationStarted: _configured, recovered: _recovered, cancelRequested: _cancelled, uploadStarted: _uploaded, transferStartedAt: _transferStartedAt, ...publicOperation } = operation
  return { ...publicOperation,
    ...(operation.status === 'uploading' && !operation.recovered && operation.transferStartedAt && operation.transfer
      ? { transfer: { ...operation.transfer, elapsedMs: Math.max(operation.transfer.elapsedMs, Date.now() - operation.transferStartedAt) } } : {}),
    connectionId: operation.connectionId, poolUuid: operation.originPoolUuid }
}

export async function cancelImport(connectionId: string, operationId: string): Promise<void> {
  ensureTransferJournalLoaded()
  const operation = importOperations.get(operationId)
  if (!operation || operation.connectionId !== connectionId) {
    throw new IpcError('IMPORT_OPERATION_NOT_FOUND', 'Import operation not found')
  }
  if (operation.status === 'configuring' || operation.status === 'unknown' && operation.configurationStarted) {
    throw new IpcError('IMPORT_CONFIGURATION_IN_PROGRESS', 'Import configuration is already in progress')
  }
  if (['cancelling', 'completed', 'failed', 'cancelled'].includes(operation.status)) return
  const scopedClient = transferCancellationClient(operation)
  operation.cancelRequested = true
  updateImportOperation(operationId, { status: 'cancelling', message: '已请求取消导入，等待资源池任务确认' })
  operation.abortController.abort()
  if (operation.taskRef) {
    try {
      await scopedClient.callWithSession('task.cancel', [operation.taskRef])
    } catch (error: any) {
      operation.recovered = true
      updateImportOperation(operationId, { status: 'unknown', message: `取消请求未确认：${error.message}；继续核对原导入任务` })
      throw error
    }
  }
}

function scheduleImportOperationExpiry(operationId: string): void {
  const timer = setTimeout(() => { importOperations.delete(operationId); persistTransfers(true) }, 24 * 60 * 60 * 1000)
  timer.unref?.()
}

async function waitForImportTask(
  client: { callWithSession: (method: string, params: any[]) => Promise<any> },
  operationId: string,
  taskRef: string,
): Promise<string> {
  let unavailable = 0
  const deadline = Date.now() + TASK_RESULT_TIMEOUT_MS
  while (true) {
    if (Date.now() >= deadline) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', `等待导入任务 ${taskRef} 的执行结果超时`)
    let task: any
    try {
      const operation = importOperations.get(operationId)
      const observer = operation ? currentTransferClient(operation, client) : client
      task = await observer.callWithSession('task.get_record', [taskRef])
    } catch (error) {
      if (++unavailable >= 5) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', `获取导入任务 ${taskRef} 结果失败：${error instanceof Error ? error.message : String(error)}`)
      const operation = importOperations.get(operationId)
      if (operation?.status !== 'cancelling') {
        updateImportOperation(operationId, {
          status: 'waiting_for_task',
          progress: -1,
          message: `资源池任务状态暂不可用，继续等待：${error instanceof Error ? error.message : String(error)}`,
        })
      }
      await waitForTaskPoll()
      continue
    }
    if (!task || !['pending', 'cancelling', 'success', 'failure', 'cancelled'].includes(task.status)) {
      if (++unavailable >= 5) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', `导入任务 ${taskRef} 连续返回无效状态`)
      await waitForTaskPoll()
      continue
    }
    unavailable = 0
    const taskProgress = typeof task.progress === 'number' && Number.isFinite(task.progress) ? Math.max(0, Math.min(1, task.progress)) : -1
    if (importOperations.get(operationId)?.status !== 'cancelling') {
      updateImportOperation(operationId, {
        status: 'waiting_for_task',
        progress: taskProgress < 0 ? -1 : taskProgress * 100,
        message: '等待服务器完成导入',
      })
    }
    if (task.status === 'success') return extractImportedVmRef(task.result)
    if (task.status === 'failure') {
      throw new IpcError('IMPORT_TASK_FAILED', Array.isArray(task.error_info) ? task.error_info.filter(Boolean).join(': ') : 'Import task failed')
    }
    if (task.status === 'cancelled') {
      updateImportOperation(operationId, { status: 'cancelled', message: '资源池任务已确认取消导入' })
      throw new IpcError('IMPORT_CANCELLED', 'Import task was cancelled')
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function runImportOperation(
  client: { callWithSession: (method: string, params: any[]) => Promise<any> },
  operationId: string,
  resolvedPath: string,
  params: VmImportParams,
): Promise<void> {
  const operation = importOperations.get(operationId)
  if (!operation?.taskRef) return
  let transferError: unknown
  let completed = false
  try {
    updateImportOperation(operationId, { status: 'validating', message: '正在校验 XVA，完成后开始上传' })
    await validateXvaIntegrity(resolvedPath, operation.abortController.signal, (validation) => {
      updateImportOperation(operationId, { validation })
    })
    currentTransferClient(operation, client)
    const capacityWarnings = await validateImportPlacement(operation.connectionId, params, operation.expectedPreview!)
    operation.warnings = [...new Set([...(operation.warnings ?? []), ...capacityWarnings])]
    const uploadClient = currentTransferClient(operation, client)
    if (operation.abortController.signal.aborted) { updateImportOperation(operationId, { status: 'cancelled', message: '上传前已取消导入' }); return }
    operation.uploadStarted = true
    persistTransfers(true)
    updateImportOperation(operationId, { status: 'uploading', progress: 0, message: '正在上传 XVA' })
    try {
      await importVmHttp(
        operationId,
        getConnectionDetails(operation.connectionId, uploadClient),
        resolvedPath,
        params.srRef,
        operation.taskRef,
      )
    } catch (error) {
      transferError = error
      const currentOperation = importOperations.get(operationId)
      if (currentOperation?.status !== 'cancelling') {
        updateImportOperation(operationId, {
          status: 'waiting_for_task',
          progress: -1,
          message: 'XVA 传输未确认完成，等待资源池任务终态',
          errorCode: error instanceof IpcError ? error.code : 'IMPORT_TRANSFER_UNCONFIRMED',
        })
      }
    }
    const vmRef = await waitForImportTask(client, operationId, operation.taskRef)
    updateImportOperation(operationId, { vmRef })
    const configurationClient = connectionManager.getClient(operation.connectionId)
    if (!configurationClient) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', 'VM 已导入，但连接已变化，请重新连接后核对配置', { vmRef })
    const scopedClient = scopedTransferClient(operation, client)
    operation.configurationStarted = true
    updateImportOperation(operationId, { status: 'configuring', progress: -1, message: '正在应用并核对导入配置', vmRef })
    await configureImportedVm(scopedClient, vmRef, params, operation)
    await verifyImportedVm(scopedClient, operation, vmRef)
    completed = true
    if (transferError) operation.warnings = [...(operation.warnings ?? []), 'HTTP 传输结果不可用；已由资源池任务和最终 VM 校验确认完成']
    updateImportOperation(operationId, { status: 'configuring', message: '导入校验通过，正在清理任务记录' })
  } catch (error: any) {
    const status = importOperations.get(operationId)?.status
    if (status !== 'cancelled') {
      updateImportOperation(operationId, {
        status: status === 'cancelling' && !operation.uploadStarted ? 'cancelled' : isUnconfirmedError(error) ? 'unknown' : 'failed',
        message: error?.message || '导入失败',
        errorCode: error?.code || 'IMPORT_FAILED',
      })
    }
  } finally {
    const status = importOperations.get(operationId)?.status
    if (status === 'unknown') operation.recovered = true
    if (completed || status && ['completed', 'failed', 'cancelled'].includes(status)) {
      if (await destroyOwnedTask(scopedTransferClient(operation, client), operation.taskRef!)) operation.taskRef = null
      else {
        operation.recovered = true
        updateImportOperation(operationId, { warnings: [...(operation.warnings ?? []), `任务记录清理失败：${operation.taskRef}`] })
      }
      if (completed) updateImportOperation(operationId, { status: 'completed', progress: 100, message: '导入完成', warnings: operation.warnings })
      persistTransfers(true)
      scheduleImportOperationExpiry(operationId)
    }
  }
}

/**
 * Export a VM to an XVA file.
 * Uses HTTP GET to /export endpoint for streaming download.
 * Supports three export modes: shutdown, snapshot, and force.
 * Returns an export ID and estimated size for progress tracking via getExportProgress().
 */
export async function exportVm(
  connectionId: string,
  params: VmExportParams
): Promise<{ exportId: string; estimatedBytes: number }> {
  const client = getClient(connectionId)
  const origin = connectionManager.getConnectionInfo(connectionId)
  getConnectionDetails(connectionId, client)

  // Validate file path
  ensureTransferJournalLoaded()
  validateExportFilePath(params.filePath)

  // Estimate export size first (before generating exportId)
  let estimatedSize = await estimateExportSize(client, params.vmRef)

  // Get VM record to validate
  const vmRecord = await client.callWithSession('VM.get_record', [params.vmRef])
  const isTemplate = Boolean(vmRecord.is_a_template)
  if (!isTemplate && (params.exportMode === 'snapshot' || vmRecord.power_state === 'Suspended')) {
    let memoryImageSize = Number(vmRecord.memory_static_max) || 0
    if (vmRecord.power_state === 'Suspended' && vmRecord.suspend_VDI && vmRecord.suspend_VDI !== 'OpaqueRef:NULL') {
      const memoryVdi = await client.callWithSession('VDI.get_record', [vmRecord.suspend_VDI])
      memoryImageSize = Number(memoryVdi.virtual_size) || memoryImageSize
    }
    estimatedSize += memoryImageSize
  }
  checkDiskSpace(params.filePath, estimatedSize)

  // Templates are always Halted — skip mode validation for templates
  if (!isTemplate) {
    if (vmRecord.power_state === 'Paused' || !['Running', 'Halted', 'Suspended'].includes(vmRecord.power_state)) {
      throw new IpcError('VM_POWER_STATE_INVALID', 'VM must be shut down or suspended before XVA export')
    }
    if (vmRecord.power_state === 'Running' && params.exportMode === 'force') {
      throw new IpcError('VM_POWER_STATE_INVALID', 'A running VM cannot be exported directly; shut it down or export a snapshot')
    }
    if (params.exportMode === 'shutdown' && vmRecord.power_state !== 'Running') {
      throw new IpcError(
        'VM_POWER_STATE_INVALID',
        `Shutdown export mode requires VM to be running, but VM is ${vmRecord.power_state}`
      )
    }

    if (params.exportMode === 'snapshot' && vmRecord.power_state !== 'Running') {
      throw new IpcError(
        'VM_POWER_STATE_INVALID',
        `Snapshot export mode requires VM to be running, but VM is ${vmRecord.power_state}`
      )
    }
  }

  const exportGuard = canRunVmExport(vmRecord, isTemplate ? 'force' : params.exportMode)
  if (!exportGuard.canRun) throw new IpcError('VM_EXPORT_NOT_ALLOWED', exportGuard.reason || '当前不能导出该 VM')

  if (origin?.poolUuid !== connectionManager.getConnectionInfo(connectionId)?.poolUuid || origin?.epoch !== connectionManager.getConnectionInfo(connectionId)?.epoch) throw new IpcError('TRANSFER_POOL_IDENTITY_CHANGED', '导出目标连接已变化，请重新选择 VM 或模板')
  if (params.useCompression) throw new IpcError('EXPORT_COMPRESSION_UNSUPPORTED', '当前完整性验证支持未压缩 XVA，请关闭压缩')
  const finalPath = path.join(fs.realpathSync(path.dirname(path.resolve(params.filePath))), path.basename(params.filePath))
  const pathKey = (p: string) => process.platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase()
  if ([...exportOperations].some(([id, operation]) => operation.finalPath && pathKey(operation.finalPath) === pathKey(finalPath)
    && !TERMINAL_TRANSFER_STATES.has(exportProgressMap.get(id)?.status ?? ''))) throw new IpcError('EXPORT_PATH_BUSY', '已有导出任务使用此保存位置，请选择其他文件名')
  if (fs.existsSync(finalPath)) throw new IpcError('EXPORT_FILE_EXISTS', '目标文件已存在，请选择新的文件名')
  const exportId = randomUUID()
  const savedParams = { ...params, filePath: finalPath, exportMode: isTemplate ? 'force' as const : params.exportMode }
  exportOperations.set(exportId, { connectionId, taskRef: '', abortController: new AbortController(),
    originEndpoint: endpointIdentity(connectionId), originPoolUuid: connectionManager.getConnectionInfo(connectionId)?.poolUuid,
    partialPath: `${finalPath}.partial-${exportId}`, finalPath, transferCompleted: false, params: savedParams,
    sourceName: vmRecord.name_label, sourceUuid: vmRecord.uuid, preparationName: `xenadmin-export-${exportId}` })
  updateProgress(exportId, 'pending', -1, 0, 0, '正在准备导出，可关闭窗口并在导出任务中查看', { phase: 'preparing' })
  persistTransfers(true)
  void runExportOperation(connectionId, exportId, savedParams)
  return { exportId, estimatedBytes: estimatedSize }
}

async function observeExportPreparation(client: ReturnType<typeof getClient>, id: string, operation: ExportOperation, recovery: boolean): Promise<string> {
  const params = operation.params!
  if (params.exportMode === 'force' && !recovery && !operation.preparationIssued) {
    if (operation.abortController.signal.aborted) throw new IpcError('EXPORT_CANCELLED', '下载前已取消导出')
    return operation.sourceUuid!
  }
  if (operation.preparationTaskRef) {
    const deadline = Date.now() + TASK_RESULT_TIMEOUT_MS
    while (true) {
      const task = await currentTransferClient(operation, client).callWithSession('task.get_record', [operation.preparationTaskRef])
      if (!task || !['success', 'pending', 'cancelling', 'failure', 'cancelled'].includes(task.status)) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '无法读取原导出准备任务状态')
      if (task.status === 'success') {
        if (params.exportMode === 'snapshot') operation.snapshotRef = extractImportedVmRef(task.result)
        operation.preparationComplete = true
        break
      }
      if (task.status === 'failure' || task.status === 'cancelled') throw new IpcError(task.status === 'cancelled' ? 'EXPORT_CANCELLED' : 'EXPORT_PREPARATION_FAILED', task.error_info?.join(': ') || '导出准备已取消')
      if (Date.now() >= deadline) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '导出准备仍在运行，继续核对原任务')
      await waitForTaskPoll()
    }
  }
  const observer = currentTransferClient(operation, client)
  const source = await observer.callWithSession('VM.get_record', [params.vmRef])
  if (source.uuid !== operation.sourceUuid) throw new IpcError('TRANSFER_POOL_IDENTITY_CHANGED', '原 VM 身份已变化，无法继续导出')
  if (params.exportMode === 'shutdown' && source.power_state !== 'Halted') throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '尚未确认原 VM 已关机，继续核对，不会再次发送关机')
  if (params.exportMode === 'snapshot' && !operation.snapshotRef) {
    const snapshots: string[] = await observer.callWithSession('VM.get_snapshots', [params.vmRef])
    const matches: string[] = []
    for (const ref of snapshots) {
      const snapshot = await observer.callWithSession('VM.get_record', [ref])
      if (snapshot.name_label === operation.preparationName && snapshot.snapshot_of === params.vmRef) matches.push(ref)
    }
    if (matches.length !== 1) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '检查点受理结果未知，等待找到原操作的唯一检查点；不会重新创建')
    operation.snapshotRef = matches[0]
  }
  persistTransfers(true)
  if (operation.cancelRequested || operation.abortController.signal.aborted || exportProgressMap.get(id)?.status === 'cancelling') throw new IpcError('EXPORT_CANCELLED', '导出准备结束，已停止后续下载；已执行的关机不会自动撤销')
  let target = operation.snapshotRef ? await observer.callWithSession('VM.get_record', [operation.snapshotRef]) : source
  if (operation.snapshotRef) {
    if (!target.is_a_snapshot || target.snapshot_of !== params.vmRef) throw new IpcError('EXPORT_SNAPSHOT_INVALID', '检查点不属于原 VM，已停止导出')
    if (!recovery || !operation.snapshotConfigurationStarted) {
      operation.snapshotConfigurationStarted = true
      persistTransfers(true)
      // XAPI snapshots/checkpoints default to templates. Export a VM as a VM.
      if (target.is_a_template) await observer.callWithSession('VM.set_is_a_template', [operation.snapshotRef, false])
      if (operation.sourceName && target.name_label !== operation.sourceName) await observer.callWithSession('VM.set_name_label', [operation.snapshotRef, operation.sourceName])
      target = await observer.callWithSession('VM.get_record', [operation.snapshotRef])
    }
    if (target.is_a_template || operation.sourceName && target.name_label !== operation.sourceName) throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '导出检查点的名称或 VM 类型未确认，继续核对原检查点')
  }
  if (!target.uuid) throw new IpcError('VM_UUID_MISSING', '导出对象 UUID 不可用')
  return target.uuid
}

async function runExportOperation(connectionId: string, id: string, params: VmExportParams, recovery = false): Promise<void> {
  const operation = exportOperations.get(id)!
  const client = getClient(connectionId)
  try {
    operation.recovered = false
    if (!recovery && params.exportMode !== 'force') {
      const preparationClient = currentTransferClient(operation, client)
      const before = await preparationClient.callWithSession('VM.get_record', [params.vmRef])
      if (before.uuid !== operation.sourceUuid) throw new IpcError('TRANSFER_POOL_IDENTITY_CHANGED', '原 VM UUID 已变化，已停止准备导出')
      const guard = canRunVmExport(before, params.exportMode)
      if (!guard.canRun) throw new IpcError('VM_EXPORT_NOT_ALLOWED', guard.reason || '所选导出模式已不可用')
      if (operation.abortController.signal.aborted) throw new IpcError('EXPORT_CANCELLED', '准备前已取消导出')
      operation.preparationIssued = true
      updateProgress(id, 'pending', 0, 0, exportProgressMap.get(id)?.bytesTotal ?? 0, params.exportMode === 'shutdown' ? '正在正常关机，关机后保持关闭' : '正在创建包含内存的检查点')
      persistTransfers(true)
      operation.preparationTaskRef = await preparationClient.callWithSession(params.exportMode === 'shutdown' ? 'Async.VM.clean_shutdown' : 'Async.VM.checkpoint', params.exportMode === 'shutdown' ? [params.vmRef] : [params.vmRef, operation.preparationName])
      if (!operation.preparationTaskRef?.startsWith('OpaqueRef:') || operation.preparationTaskRef === 'OpaqueRef:NULL') throw new IpcError('IMPORT_TASK_OUTCOME_UNKNOWN', '准备任务引用未确认，等待核对原对象')
      persistTransfers(true)
      if (operation.abortController.signal.aborted) await currentTransferClient(operation, client).callWithSession('task.cancel', [operation.preparationTaskRef])
    }
    if (operation.abortController.signal.aborted && !operation.preparationIssued) throw new IpcError('EXPORT_CANCELLED', '下载前已取消导出')
    const uuid = await observeExportPreparation(client, id, operation, recovery)
    if (operation.abortController.signal.aborted) throw new IpcError('EXPORT_CANCELLED', '下载前已取消导出')
    operation.taskRef = await currentTransferClient(operation, client).callWithSession('task.create', ['export', operation.preparationName])
    if (!operation.taskRef || operation.taskRef === 'OpaqueRef:NULL') throw new IpcError('EXPORT_TASK_INVALID', '未能创建有效的导出任务')
    if (operation.abortController.signal.aborted) await currentTransferClient(operation, client).callWithSession('task.cancel', [operation.taskRef])
    operation.httpStarted = true
    persistTransfers(true)
    let transferCompleted = false
    try {
      if (operation.abortController.signal.aborted) throw new IpcError('EXPORT_CANCEL_REQUESTED', '导出取消请求已发送，等待原任务结果')
      await exportVmHttp(getConnectionDetails(connectionId, currentTransferClient(operation, client)), uuid, operation.taskRef, operation.partialPath!, id, operation.abortController.signal, false)
      transferCompleted = operation.transferCompleted = true
      persistTransfers(true)
    } catch (error: any) {
      const progress = exportProgressMap.get(id)!
      if (progress.status !== 'cancelling') updateProgress(id, 'running', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, `${error.message}；正在核对原资源池任务`)
    }
    const result = await reconcileExportTask(client, id, operation.taskRef, operation.partialPath!, operation.finalPath!, transferCompleted)
    if (result !== 'terminal') return
  } catch (error: any) {
    const progress = exportProgressMap.get(id)!
    const unknown = isUnconfirmedError(error)
    operation.recovered = unknown
    updateProgress(id, unknown ? 'unknown' : error.code === 'EXPORT_CANCELLED' ? 'cancelled' : 'failed', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, error.message)
    if (unknown) return
  }
  await cleanupExportOperation(id, operation, client)
  scheduleExportOperationExpiry(id)
}

async function validateImportPlacement(connectionId: string, params: VmImportParams, preview: VmImportPreview): Promise<string[]> {
  const resources = await getVmCreationResources(connectionId)
  const sr = resources.srs.find((option) => option.ref === params.srRef)
  if (!sr || sr.freeBytes <= 0) throw new IpcError('SR_NOT_WRITABLE', '目标存储未连接、容量未知或没有可用空间')
  const mappings = params.vifMappings
  if (preview.vifs.some((vif) => !mappings[vif.device])) throw new IpcError('NETWORK_MAPPING_REQUIRED', '请为每块虚拟网卡选择目标网络')
  const targets = Object.values(mappings).map((ref) => resources.networks.find((n) => n.ref === ref))
  if (targets.some((n) => !n)) throw new IpcError('NETWORK_NOT_FOUND', '目标网络已不可用，请重新选择')
  const compatibleHosts = resources.hosts.filter((host) => sr.hostRefs.includes(host.ref)
    && targets.every((n) => n!.hostRefs.includes(host.ref)))
  if (params.homeServerRef ? !compatibleHosts.some((h) => h.ref === params.homeServerRef) : !compatibleHosts.length) {
    throw new IpcError('IMPORT_PLACEMENT_INVALID', '没有可用主机同时访问所选存储和网络，请检查 Home Server、PBD 与 PIF')
  }
  // Virtual size is a conservative estimate: sparse XVA size is not allocated capacity.
  return preview.originalSize > sr.freeBytes ? ['磁盘虚拟容量大于存储剩余空间；稀疏磁盘实际分配由存储后端决定，导入期间请留意容量'] : []
}

/**
 * Import a VM from an XVA file.
 * Uses HTTP PUT to /import endpoint for streaming upload.
 * Supports network mapping and custom naming.
 * Returns a task ref for progress tracking.
 */
export async function importVm(
  connectionId: string,
  params: VmImportParams,
): Promise<string> {
  ensureTransferJournalLoaded()
  const client = getClient(connectionId)
  getConnectionDetails(connectionId, client)
  const origin = connectionManager.getConnectionInfo(connectionId)
  const { resolvedPath, preview } = validateXvaFile(params.filePath)

  if (params.originPoolUuid && params.originPoolUuid !== connectionManager.getConnectionInfo(connectionId)?.poolUuid
    || params.originEpoch !== undefined && params.originEpoch !== connectionManager.getConnectionInfo(connectionId)?.epoch) {
    throw new IpcError('IMPORT_SCOPE_CHANGED', '资源池连接已变化，请重新选择导入目标')
  }
  const mappings = params.vifMappings
  const capacityWarnings = await validateImportPlacement(connectionId, params, preview)

  if (origin?.poolUuid !== connectionManager.getConnectionInfo(connectionId)?.poolUuid || origin?.epoch !== connectionManager.getConnectionInfo(connectionId)?.epoch) throw new IpcError('IMPORT_SCOPE_CHANGED', '资源池已变化，请重新选择导入目标')
  const taskRef: string = await client.callWithSession('task.create', [
    `Import: ${preview.vmName}`,
    'VM import via HTTP PUT',
  ])
  if (typeof taskRef !== 'string' || !taskRef.startsWith('OpaqueRef:') || taskRef === 'OpaqueRef:NULL') {
    throw new IpcError('IMPORT_TASK_INVALID', '未能创建有效的导入任务，尚未上传 XVA')
  }
  const operationId = randomUUID()
  importOperations.set(operationId, {
    operationId,
    connectionId,
    originEndpoint: endpointIdentity(connectionId),
    originPoolUuid: origin?.poolUuid,
    params: { ...params, vifMappings: mappings },
    expectedPreview: preview,
    warnings: capacityWarnings,
    taskRef,
    status: 'pending',
    progress: 0,
    message: '准备导入 XVA',
    lastUpdatedAt: Date.now(),
    abortController: new AbortController(),
    uploadStarted: false,
  })
  try { persistTransfers(true) } catch (error) {
    importOperations.delete(operationId)
    await destroyOwnedTask(client, taskRef)
    throw error
  }
  void runImportOperation(client, operationId, resolvedPath, {
    ...params,
    vifMappings: mappings,
  })
  return operationId
}

/**
 * Get a preview of the XVA file contents.
 * This is a local operation that does not require a connection.
 */
export async function getImportPreview(filePath: string): Promise<VmImportPreview> {
  return validateXvaFile(filePath).preview
}
export async function cancelExport(
  connectionId: string,
  exportId: string
): Promise<void> {
  ensureTransferJournalLoaded()
  const operation = exportOperations.get(exportId)
  const progress = exportProgressMap.get(exportId)
  if (!operation || !progress) return
  if (operation.connectionId !== connectionId) {
    throw new IpcError('EXPORT_OPERATION_NOT_FOUND', 'Export operation not found')
  }
  if (['cancelling', 'completed', 'failed', 'cancelled'].includes(progress.status)) return

  const client = transferCancellationClient(operation)
  operation.cancelRequested = true
  updateProgress(
    exportId,
    'cancelling',
    progress.progress,
    progress.bytesTransferred ?? 0,
    progress.bytesTotal ?? 0,
    'Export cancellation requested',
  )
  operation.abortController.abort()
  try {
    for (const ref of [operation.preparationComplete ? undefined : operation.preparationTaskRef, operation.taskRef]) {
      if (ref) await client.callWithSession('task.cancel', [ref])
    }
  } catch (error: any) {
    operation.recovered = true
    updateProgress(exportId, 'unknown', progress.progress, progress.bytesTransferred ?? 0, progress.bytesTotal ?? 0, `取消请求未确认：${error.message}；继续核对原导出任务`)
    throw error
  }
}

/**
 * Marks an imported VM as a template.
 * Called as a post-import step when the user chooses "import as template".
 */
export async function markAsTemplate(
  connectionId: string,
  vmRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await convertVmToTemplate(client, vmRef)
}
