import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { open, rename, unlink } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'

let directory: string | null = null

export function isJsonStoreConfigured(): boolean { return directory !== null }

/** Configured once before application services start. Pure service tests can use an isolated directory. */
export function configureJsonStoreDirectory(path: string | null): void {
  directory = path
  if (path) mkdirSync(path, { recursive: true, mode: 0o700 })
}

function storePath(name: string): string | null {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid persistent store name')
  return directory ? join(directory, `${name}.json`) : null
}

/** Main-process persistence modules share the configured state directory. */
export function getJsonStorePath(name: string): string | null { return storePath(name) }

export function readJsonStore<T>(name: string, fallback: T): T {
  const path = storePath(name)
  if (!path) return structuredClone(fallback)
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'))
    if (record?.version !== 1 || !Object.hasOwn(record, 'data')) {
      throw new Error('Unsupported persistent store format')
    }
    return record.data as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(fallback)
    throw new Error(`无法读取本地记录 ${name}，原文件已保留`, { cause: error })
  }
}

// Keep this worker self-contained so development and packaged builds use the
// same code, without a second build entry or a runtime TypeScript loader.
const arrayReaderWorker = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { readFile } = require('node:fs/promises')
;(async () => {
  let record
  try { record = JSON.parse(await readFile(workerData.path, 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    record = { version: 1, data: Object.fromEntries(workerData.fields.map(field => [field, []])) }
  }
  if (record?.version !== 1 || !record.data || workerData.fields.some(field => !Array.isArray(record.data[field]))) {
    throw new Error('Unsupported persistent store format')
  }
  for (const field of workerData.fields) {
    const rows = record.data[field]
    for (let offset = 0; offset < rows.length; offset += 256) {
      const acknowledged = new Promise(resolve => parentPort.once('message', resolve))
      parentPort.postMessage({ field, rows: rows.slice(offset, offset + 256) })
      await acknowledged
    }
  }
  parentPort.postMessage({ done: true })
  parentPort.close()
})().catch(error => { throw error })
`

/** Parse large snapshots off the main thread; backpressure bounds each transfer
 * and gives the event loop a turn between index-building chunks. */
export function readJsonArrayStore<T>(name: string, fields: string[], consume: (field: string, rows: T[]) => void): Promise<void> {
  const path = storePath(name)
  if (!path) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const worker = new Worker(arrayReaderWorker, { eval: true, workerData: { path, fields } })
    let done = false
    let failed = false
    const fail = (cause: unknown) => {
      if (failed) return
      failed = true
      void worker.terminate()
      reject(new Error(`无法读取本地记录 ${name}，原文件已保留`, { cause }))
    }
    worker.on('message', (message: { done?: boolean; field: string; rows: T[] }) => {
      if (failed) return
      if (message.done) { done = true; return }
      try { consume(message.field, message.rows) } catch (error) { fail(error); return }
      setImmediate(() => { if (!failed) worker.postMessage('next') })
    })
    worker.on('error', fail)
    worker.on('messageerror', fail)
    worker.on('exit', (code) => {
      if (!failed) {
        if (done && code === 0) resolve()
        else fail(new Error(`Snapshot reader exited with code ${code}`))
      }
    })
  })
}

export function writeJsonStore(name: string, value: unknown, options: { flush?: boolean } = {}): void {
  const path = storePath(name)
  if (!path) return
  const temporary = `${path}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, data: value }), { mode: 0o600, flush: options.flush ?? false })
    renameSync(temporary, path)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* The original record remains intact. */ }
    throw new Error(`无法保存本地记录 ${name}`, { cause: error })
  }
}

/** Serialize bounded chunks between asynchronous writes, without cloning a large
 * snapshot to a worker or building its entire JSON string on the main thread.
 * The caller owns serialization of writes to the same store. */
export async function writeJsonArrayStore(name: string, arrays: Record<string, readonly unknown[]>): Promise<void> {
  const path = storePath(name)
  if (!path) return
  const temporary = `${path}.tmp`
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(temporary, 'w', 0o600)
    await file.writeFile('{"version":1,"data":{')
    let first = true
    for (const [key, rows] of Object.entries(arrays)) {
      await file.writeFile(`${first ? '' : ','}${JSON.stringify(key)}:[`)
      first = false
      for (let offset = 0; offset < rows.length; offset += 256) {
        const chunk = JSON.stringify(rows.slice(offset, offset + 256))
        await file.writeFile(`${offset ? ',' : ''}${chunk.slice(1, -1)}`)
      }
      await file.writeFile(']')
    }
    await file.writeFile('}}')
    await file.close()
    file = undefined
    await rename(temporary, path)
  } catch (error) {
    await file?.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw new Error(`无法保存本地记录 ${name}`, { cause: error })
  }
}
