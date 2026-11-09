import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as persistence from '../../src/main/persistence/json-store'
import * as metrics from '../../src/main/xapi/services/metrics-db.service'

vi.mock('../../src/main/persistence/json-store', async (importOriginal) => {
  const actual = await importOriginal<typeof persistence>()
  return { ...actual, writeJsonArrayStore: vi.fn(actual.writeJsonArrayStore) }
})

let directory: string
let writeArrays: typeof persistence.writeJsonArrayStore
const writer = vi.mocked(persistence.writeJsonArrayStore)
const sample = (timestamp: number, cpuPercent = 10) => ({ connectionId: 'c', hostRef: 'h', timestamp, cpuPercent, memoryPercent: 20 })

beforeEach(async () => {
  writeArrays = (await vi.importActual<typeof persistence>('../../src/main/persistence/json-store')).writeJsonArrayStore
  writer.mockReset().mockImplementation(writeArrays)
  directory = mkdtempSync(join(tmpdir(), 'xenadmin-metric-writer-'))
  persistence.configureJsonStoreDirectory(directory)
  await metrics.initDatabase()
})
afterEach(async () => {
  writer.mockImplementation(writeArrays)
  await metrics.closeDatabase()
  persistence.configureJsonStoreDirectory(null)
  rmSync(directory, { recursive: true, force: true })
})

describe('asynchronous metric snapshots', () => {
  it('writes multiple chunks as a private versioned JSON file with the existing array format', async () => {
    const arrays = { hosts: Array.from({ length: 600 }, (_, i) => sample(i)), vms: [{ vmRef: 'v', timestamp: 1 }] }
    await writeArrays('metric-samples', arrays)
    const path = join(directory, 'metric-samples.json')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, data: arrays })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it('preserves the previous snapshot on a mid-stream failure and allows a subsequent retry', async () => {
    persistence.writeJsonStore('metric-samples', { hosts: [sample(1)], vms: [] })
    const path = join(directory, 'metric-samples.json')
    const previous = readFileSync(path, 'utf8')
    const broken = [...Array.from({ length: 300 }, (_, i) => sample(i)), { toJSON() { throw new Error('encoding failed') } }]
    await expect(writeArrays('metric-samples', { hosts: broken, vms: [] })).rejects.toThrow('无法保存本地记录')
    expect(readFileSync(path, 'utf8')).toBe(previous)
    expect(existsSync(`${path}.tmp`)).toBe(false)
    await writeArrays('metric-samples', { hosts: [sample(2)], vms: [] })
    expect(persistence.readJsonStore('metric-samples', null)).toEqual({ hosts: [sample(2)], vms: [] })
  })

  it('serializes joined flushes and drains samples and duplicate updates arriving during shutdown', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    writer.mockImplementationOnce(async (name, arrays) => { await blocked; await writeArrays(name, arrays) })
    const timestamp = Date.now()
    metrics.persistMetricSample(sample(timestamp))
    const first = metrics.flushMetricStore()
    expect(metrics.flushMetricStore()).toBe(first)
    const closing = metrics.closeDatabase()
    metrics.persistMetricSample(sample(timestamp, 90))
    metrics.persistMetricSample(sample(timestamp + 1, 50))
    metrics.persistVmMetricSample({ ...sample(timestamp), vmRef: 'v' })
    expect(writer).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, closing])
    expect(writer).toHaveBeenCalledTimes(2)
    await metrics.initDatabase()
    expect(metrics.getAlertMetricWindow('host', 'c', 'h', timestamp, timestamp + 1).map((point) => point.cpuPercent)).toEqual([90, 50])
    expect(metrics.getAlertMetricWindow('vm', 'c', 'v', timestamp, timestamp)).toHaveLength(1)
    await metrics.flushMetricStore()
    expect(writer).toHaveBeenCalledTimes(2)
  })

  it('exposes write failures, retains in-memory data and retries the unsaved revision', async () => {
    const timestamp = Date.now()
    metrics.persistMetricSample(sample(timestamp))
    writer.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(metrics.flushMetricStore()).rejects.toThrow('disk unavailable')
    expect(metrics.getAlertMetricWindow('host', 'c', 'h', timestamp, timestamp)).toHaveLength(1)
    await metrics.flushMetricStore()
    expect(writer).toHaveBeenCalledTimes(2)
    const data = persistence.readJsonStore<{ hosts: unknown[] }>('metric-samples', { hosts: [] })
    expect(data.hosts).toHaveLength(1)
  })

  it('drains a sample queued by a joined flush completion before clearing the database', async () => {
    const timestamp = Date.now()
    metrics.persistMetricSample(sample(timestamp))
    const saving = metrics.flushMetricStore()
    const completion = saving.then(() => metrics.persistMetricSample(sample(timestamp + 1, 70)))
    await Promise.all([completion, metrics.closeDatabase()])
    await metrics.initDatabase()
    expect(metrics.getAlertMetricWindow('host', 'c', 'h', timestamp, timestamp + 1).map((point) => point.cpuPercent)).toEqual([10, 70])
  })
})

describe('asynchronous metric restoration', () => {
  it('streams validated versioned arrays in bounded chunks and yields between chunks', async () => {
    const now = Date.now()
    const rows = Array.from({ length: 600 }, (_, i) => sample(now + i))
    await writeArrays('metric-samples', { hosts: rows, vms: [] })
    const sizes: number[] = []
    const received: unknown[] = []
    let yielded = false
    await persistence.readJsonArrayStore('metric-samples', ['hosts', 'vms'], (field, batch) => {
      expect(field).toBe('hosts')
      if (sizes.length) expect(yielded).toBe(true)
      sizes.push(batch.length); received.push(...batch)
      setImmediate(() => { yielded = true })
    })
    expect(sizes).toEqual([256, 256, 88])
    expect(received).toEqual(rows)
  })

  it('joins restoration, keeps alerts usable and publishes metrics only after completion', async () => {
    await metrics.closeDatabase()
    const now = Date.now()
    persistence.writeJsonStore('metric-samples', { hosts: Array.from({ length: 600 }, (_, i) => sample(now - i)), vms: [] })
    const restoring = metrics.initDatabase()
    expect(metrics.initDatabase()).toBe(restoring)
    expect(() => metrics.getAlertRuleStore()).not.toThrow()
    expect(() => metrics.getMetricsRange('c', 'h', 0, now)).toThrow('指标历史正在恢复')
    await restoring
    expect(metrics.getAlertMetricWindow('host', 'c', 'h', 0, now)).toHaveLength(600)
  })

  it('preserves corrupt or unsupported snapshots, blocks writes and can retry after repair', async () => {
    const path = join(directory, 'metric-samples.json')
    for (const content of ['{broken-json', JSON.stringify({ version: 2, data: { hosts: [], vms: [] } }), JSON.stringify({ version: 1, data: { hosts: [] } })]) {
      await metrics.closeDatabase()
      writeFileSync(path, content)
      await expect(metrics.initDatabase()).rejects.toThrow('原文件已保留')
      await expect(metrics.flushMetricStore()).rejects.toThrow('原文件已保留')
      expect(readFileSync(path, 'utf8')).toBe(content)
      expect(() => metrics.persistMetricSample(sample(Date.now()))).toThrow('原文件已保留')
      persistence.writeJsonStore('metric-samples', { hosts: [sample(Date.now())], vms: [] })
      await metrics.initDatabase()
      expect(metrics.getAlertMetricWindow('host', 'c', 'h', 0, Date.now())).toHaveLength(1)
    }
  })

  it('waits for restoration during shutdown and preserves the complete original history', async () => {
    await metrics.closeDatabase()
    const now = Date.now()
    persistence.writeJsonStore('metric-samples', { hosts: Array.from({ length: 1000 }, (_, i) => sample(now - i)), vms: [] })
    const previous = readFileSync(join(directory, 'metric-samples.json'), 'utf8')
    const restoring = metrics.initDatabase()
    await metrics.closeDatabase()
    await restoring
    expect(readFileSync(join(directory, 'metric-samples.json'), 'utf8')).toBe(previous)
    await metrics.initDatabase()
    expect(metrics.getAlertMetricWindow('host', 'c', 'h', 0, now)).toHaveLength(1000)
  })
})
