import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readTarHeader, verifyXvaArchive, xxhash64, type XvaValidationProgress } from '../../src/main/xapi/services/xva-archive'
import { diskChunk, tarEntry, xva } from '../helpers/xva'
const directory = mkdtempSync(join(tmpdir(), 'xva-archive-'))
afterEach(() => { vi.restoreAllMocks(); rmSync(join(directory, 'input.xva'), { force: true }) })
const verify = (data: Buffer, disks: Array<{ id: string; size: number }> = []) => {
  const file = join(directory, 'input.xva'); writeFileSync(file, data)
  return verifyXvaArchive(file, () => ({ disks, diskCount: disks.length }))
}
it.each([['', 'ef46db3751d8e999'], ['a', 'd24ec4f1a98c6e5b'], ['abc', '44bc2cf5ad770999']])('matches official XXH64 seed-zero test vectors (%s)', (input, expected) => {
  expect(xxhash64(Buffer.from(input))).toBe(expected)
})
it('validates SHA-1 chunks and allows sparse intermediate zero blocks', async () => {
  const entries = [...diskChunk('Ref:1', 0, Buffer.alloc(1048576, 1)), ...diskChunk('Ref:1', 2, Buffer.alloc(512, 2))]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 2 * 1048576 + 512 }])).resolves.toBeUndefined()
})
it('validates XAPI XXH64 inline chunks', async () => {
  const data = Buffer.from('hello')
  await expect(verify(xva(undefined, [tarEntry('Ref:1/00000000', data), tarEntry('Ref:1/00000000.xxhash', xxhash64(data).toUpperCase())]), [{ id: 'Ref:1', size: 5 }])).resolves.toBeUndefined()
})
it('accepts a keepalive without advancing the disk offset', async () => {
  const entries = [
    ...diskChunk('Ref:1', 0, Buffer.alloc(1048576, 1)),
    ...diskChunk('Ref:1', 1, Buffer.alloc(0)),
    ...diskChunk('Ref:1', 2, Buffer.alloc(1048576, 2)),
    ...diskChunk('Ref:1', 3, Buffer.alloc(1048576, 3)),
  ]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 3 * 1048576 }])).resolves.toBeUndefined()
})
it.each(['checksum', 'xxhash'])('accepts repeated %s keepalives with sparse gaps and a partial final chunk', async (extension) => {
  // As in XAPI recv_all_vdi: missing suffixes advance by 1 MiB; empty entries advance by zero.
  const chunks: Array<[number, Buffer]> = [
    [0, Buffer.alloc(1048576, 1)],
    [2, Buffer.alloc(0)],
    [3, Buffer.alloc(0)],
    [5, Buffer.alloc(1048576, 2)],
    [6, Buffer.alloc(512, 3)],
  ]
  const entries = chunks.flatMap(([index, data]) => {
    if (extension === 'checksum') return diskChunk('Ref:1', index, data)
    const name = `Ref:1/${String(index).padStart(8, '0')}`
    return [tarEntry(name, data), tarEntry(`${name}.xxhash`, xxhash64(data).toUpperCase())]
  })
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 4 * 1048576 + 512 }])).resolves.toBeUndefined()
})
it('keeps disk offsets independent when only one disk contains keepalives', async () => {
  const entries = [
    ...diskChunk('Ref:1', 0, Buffer.alloc(1048576, 1)),
    ...diskChunk('Ref:1', 1, Buffer.alloc(0)),
    ...diskChunk('Ref:1', 2, Buffer.alloc(1048576, 2)),
    ...diskChunk('Ref:1', 3, Buffer.alloc(512, 3)),
    ...diskChunk('Ref:2', 0, Buffer.alloc(1048576, 4)),
    ...diskChunk('Ref:2', 1, Buffer.alloc(512, 5)),
  ]
  await expect(verify(xva(undefined, entries), [
    { id: 'Ref:1', size: 2 * 1048576 + 512 }, { id: 'Ref:2', size: 1048576 + 512 },
  ])).resolves.toBeUndefined()
})
it('requires the first chunk to contain actual disk data', async () => {
  const entries = [...diskChunk('Ref:1', 0, Buffer.alloc(0)), ...diskChunk('Ref:1', 1, Buffer.alloc(1048576))]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 1048576 }])).rejects.toThrow('起始')
})
it('still verifies the checksum of a zero-length keepalive', async () => {
  const entries = [
    ...diskChunk('Ref:1', 0, Buffer.alloc(1048576)),
    tarEntry('Ref:1/00000001', Buffer.alloc(0)), tarEntry('Ref:1/00000001.xxhash', '0'.repeat(16)),
  ]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 3 * 1048576 }])).rejects.toThrow('校验失败')
})
it('requires an inline checksum after a zero-length keepalive', async () => {
  const entries = [...diskChunk('Ref:1', 0, Buffer.alloc(1048576)), tarEntry('Ref:1/00000001', Buffer.alloc(0))]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 3 * 1048576 }])).rejects.toThrow('缺少磁盘校验')
})
it('does not treat a keepalive at the old final suffix as a complete disk', async () => {
  const entries = [...diskChunk('Ref:1', 0, Buffer.alloc(1048576)), ...diskChunk('Ref:1', 2, Buffer.alloc(0))]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 3 * 1048576 }])).rejects.toThrow('末尾')
})
it('rejects a sparse gap beyond the disk boundary after a keepalive', async () => {
  const entries = [
    ...diskChunk('Ref:1', 0, Buffer.alloc(1048576)), ...diskChunk('Ref:1', 1, Buffer.alloc(0)),
    ...diskChunk('Ref:1', 5, Buffer.alloc(512)),
  ]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 3 * 1048576 }])).rejects.toThrow('边界')
})
it('rejects a shortened non-final chunk after a keepalive', async () => {
  const entries = [
    ...diskChunk('Ref:1', 0, Buffer.alloc(1048576)), ...diskChunk('Ref:1', 1, Buffer.alloc(0)),
    ...diskChunk('Ref:1', 2, Buffer.alloc(512)),
  ]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 3 * 1048576 }])).rejects.toThrow('边界')
})
it('rejects a keepalive after the complete disk payload', async () => {
  const entries = [...diskChunk('Ref:1', 0, Buffer.alloc(512)), ...diskChunk('Ref:1', 1, Buffer.alloc(0))]
  await expect(verify(xva(undefined, entries), [{ id: 'Ref:1', size: 512 }])).rejects.toThrow('边界')
})
it('rejects a checksum mismatch', async () => {
  await expect(verify(xva(undefined, [tarEntry('Ref:1/00000000', 'abc'), tarEntry('Ref:1/00000000.checksum', '0'.repeat(40))]), [{ id: 'Ref:1', size: 3 }])).rejects.toThrow('校验失败')
})
it('rejects a missing final sparse chunk', async () => {
  await expect(verify(xva(undefined, diskChunk('Ref:1', 0, Buffer.alloc(1048576))), [{ id: 'Ref:1', size: 3 * 1048576 }])).rejects.toThrow('末尾')
})
it('rejects corrupt headers, missing terminators and trailing nonzero data', async () => {
  const corrupt = xva(); corrupt[10] ^= 1
  expect(() => readTarHeader(corrupt.subarray(0, 512))).toThrow('校验失败')
  await expect(verify(xva().subarray(0, -512))).rejects.toThrow('结束标记')
  await expect(verify(Buffer.concat([xva(), Buffer.from('extra')]))).rejects.toThrow('额外内容')
})
it('rejects duplicate disk chunks rather than counting them twice', async () => {
  const chunk = diskChunk('Ref:1', 0, Buffer.from('abc'))
  await expect(verify(xva(undefined, [...chunk, ...chunk]), [{ id: 'Ref:1', size: 3 }])).rejects.toThrow('顺序')
})
it('honors cancellation before scanning a large local archive', async () => {
  const file = join(directory, 'input.xva'); writeFileSync(file, xva())
  const controller = new AbortController(); controller.abort()
  await expect(verifyXvaArchive(file, () => ({ disks: [], diskCount: 0 }), controller.signal)).rejects.toThrow('取消')
})

it('reports bounded monotonic progress using archive bytes rather than sparse virtual capacity', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now += 250)
  const data = xva(undefined, [...diskChunk('Ref:1', 0, Buffer.alloc(1048576)), ...diskChunk('Ref:1', 9, Buffer.alloc(512))])
  const file = join(directory, 'input.xva'); writeFileSync(file, data)
  const updates: XvaValidationProgress[] = []
  await verifyXvaArchive(file, () => ({ disks: [{ id: 'Ref:1', size: 9 * 1048576 + 512 }], diskCount: 1 }), undefined, (update) => updates.push(update))
  expect(updates[0].bytesChecked).toBe(0)
  expect(updates.at(-1)?.bytesChecked).toBe(data.length)
  expect(updates.length).toBeGreaterThan(2)
  expect(updates.every((update, i) => update.bytesTotal === data.length && update.bytesChecked >= (updates[i - 1]?.bytesChecked ?? 0))).toBe(true)
  expect(updates.slice(0, -1).every((update) => update.bytesChecked < data.length)).toBe(true)
  expect(updates.slice(1, -1).every((update, i) => update.elapsedMs - updates[i].elapsedMs >= 500)).toBe(true)
})

it('never reports a completed scan when the last disk boundary check fails', async () => {
  const data = xva(undefined, diskChunk('Ref:1', 0, Buffer.alloc(1048576)))
  const file = join(directory, 'input.xva'); writeFileSync(file, data)
  const updates: XvaValidationProgress[] = []
  await expect(verifyXvaArchive(file, () => ({ disks: [{ id: 'Ref:1', size: 3 * 1048576 }], diskCount: 1 }), undefined, (update) => updates.push(update))).rejects.toThrow('末尾')
  expect(updates.every((update) => update.bytesChecked < update.bytesTotal)).toBe(true)
})

it('stops a scan cancelled from a progress update before reporting completion', async () => {
  const file = join(directory, 'input.xva'); writeFileSync(file, xva())
  const controller = new AbortController()
  const updates: XvaValidationProgress[] = []
  await expect(verifyXvaArchive(file, () => ({ disks: [], diskCount: 0 }), controller.signal, (update) => {
    updates.push(update); controller.abort()
  })).rejects.toThrow('取消')
  expect(updates).toHaveLength(1)
  expect(updates[0].bytesChecked).toBe(0)
})
