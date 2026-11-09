/**
 * VM event watcher — uses XAPI event.from to receive VM DB changes.
 *
 * event.from is token-based and supersedes the legacy event.next/register API.
 * Each connection owns one watcher, and stopped generations are ignored so
 * late XML-RPC responses cannot leak events into a replacement connection.
 */
import type { BrowserWindow } from 'electron'
import type { XapiClient } from '../client'
import type { VmChangeEvent } from '../../../shared/types/xapi'
import { vmChangedContract } from '../../../shared/ipc-contracts/vm'
import { createLogger } from '../../logger'
import { sendIpcContractPush } from '../../ipc/ipc-contract-sender'
import { normalizeUnknownError } from '../errors'

const log = createLogger('VmEventService')

const VM_EVENT_CLASSES = ['VM']
const EVENT_TIMEOUT_SECONDS = 30.0
const TOKEN_RESET_DELAY_MS = 1_000
const RETRY_DELAY_MS = 5_000

interface XapiEventRecord {
  class?: string
  operation?: string
  ref?: string
  snapshot?: Record<string, unknown>
}

interface XapiEventBatch {
  token?: string
  events?: XapiEventRecord[] | Record<string, XapiEventRecord>
}

interface Watcher {
  connectionId: string
  client: XapiClient
  generation: number
  stopped: boolean
}

type VmEventEmitter = (event: VmChangeEvent) => void

const watchers = new Map<string, Watcher>()
let generationCounter = 0
let mainWindow: BrowserWindow | null = null

export function setVmEventWindow(window?: BrowserWindow): void {
  mainWindow = window ?? null
}

export function startVmEventWatcher(
  connectionId: string,
  client: XapiClient,
  emit: VmEventEmitter = broadcastVmChange
): void {
  stopVmEventWatcher(connectionId)

  const watcher: Watcher = {
    connectionId,
    client,
    generation: ++generationCounter,
    stopped: false,
  }
  watchers.set(connectionId, watcher)
  void runWatcher(watcher, emit)
}

export function stopVmEventWatcher(connectionId: string): void {
  const watcher = watchers.get(connectionId)
  if (!watcher) return

  watcher.stopped = true
  watchers.delete(connectionId)
}

export function stopAllVmEventWatchers(): void {
  for (const connectionId of Array.from(watchers.keys())) {
    stopVmEventWatcher(connectionId)
  }
}

function isActive(watcher: Watcher): boolean {
  const current = watchers.get(watcher.connectionId)
  return !!current && current.generation === watcher.generation && !watcher.stopped
}

async function runWatcher(watcher: Watcher, emit: VmEventEmitter): Promise<void> {
  let token = ''
  let initialized = false

  while (isActive(watcher)) {
    try {
      const batch = await fetchEventBatch(watcher.client, token)
      if (!isActive(watcher)) return

      token = readToken(batch)
      const events = readEvents(batch)

      if (!initialized) {
        initialized = true
        log.info(`initialized connectionId=${watcher.connectionId}`)
        continue
      }

      for (const eventRecord of events) {
        const vmEvent = toVmChangeEvent(watcher.connectionId, eventRecord)
        if (vmEvent && isActive(watcher)) {
          emit(vmEvent)
        }
      }
    } catch (err: any) {
      if (!isActive(watcher)) return

      const normalized = normalizeUnknownError(err)
      if (normalized.code === 'EVENT_FROM_TOKEN_PARSE_FAILURE') {
        log.warn(`token reset required connectionId=${watcher.connectionId}: ${normalized.message}`)
        token = ''
        initialized = false
        await delay(TOKEN_RESET_DELAY_MS)
        continue
      }

      log.warn(`event stream retry connectionId=${watcher.connectionId}: ${normalized.message}`)
      await delay(RETRY_DELAY_MS)
    }
  }
}

async function fetchEventBatch(client: XapiClient, token: string): Promise<XapiEventBatch> {
  const batch = await client.callWithSession('event.from', [
    VM_EVENT_CLASSES,
    token,
    EVENT_TIMEOUT_SECONDS,
  ])

  if (!batch || typeof batch !== 'object' || typeof (batch as XapiEventBatch).token !== 'string') {
    throw new Error('Invalid event.from response')
  }

  return batch as XapiEventBatch
}

function readToken(batch: XapiEventBatch): string {
  return batch.token ?? ''
}

function readEvents(batch: XapiEventBatch): XapiEventRecord[] {
  const events = batch.events
  if (!events) return []
  return Array.isArray(events) ? events : Object.values(events)
}

export function toVmChangeEvent(
  connectionId: string,
  eventRecord: XapiEventRecord
): VmChangeEvent | null {
  const className = String(eventRecord.class ?? '').toLowerCase()
  if (className !== 'vm') return null

  const event = {
    connectionId,
    operation: String(eventRecord.operation ?? '').toLowerCase(),
    ref: eventRecord.ref,
    snapshot: eventRecord.snapshot,
    receivedAt: Date.now(),
  }

  try {
    return vmChangedContract.argsSchema.parse([event])[0]
  } catch {
    return null
  }
}

function broadcastVmChange(event: VmChangeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  sendIpcContractPush(mainWindow.webContents, vmChangedContract, event)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
