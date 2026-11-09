import * as fs from 'fs'
import { createHash } from 'crypto'

export interface XvaDisk { id: string; size: number }
export interface XvaValidationProgress { bytesChecked: number; bytesTotal: number; elapsedMs: number }
const CHUNK_SIZE = 1024 * 1024
const MASK = (1n << 64n) - 1n
const P1 = 11400714785074694791n, P2 = 14029467366897019727n
const P3 = 1609587929392839161n, P4 = 9650029242287828579n, P5 = 2870177450012600261n
const rotate = (x: bigint, n: bigint) => ((x << n) | (x >> (64n - n))) & MASK
const round = (a: bigint, b: bigint) => (rotate((a + b * P2) & MASK, 31n) * P1) & MASK

/** XXH64, seed 0, the algorithm used by XAPI's inline .xxhash entries. */
export function xxhash64(data: Buffer): string {
  let offset = 0, hash: bigint
  if (data.length >= 32) {
    const lanes = [(P1 + P2) & MASK, P2, 0n, (-P1) & MASK]
    while (offset <= data.length - 32) {
      for (let lane = 0; lane < 4; lane++) lanes[lane] = round(lanes[lane], data.readBigUInt64LE(offset + lane * 8))
      offset += 32
    }
    hash = (rotate(lanes[0], 1n) + rotate(lanes[1], 7n) + rotate(lanes[2], 12n) + rotate(lanes[3], 18n)) & MASK
    for (const lane of lanes) hash = ((hash ^ round(0n, lane)) * P1 + P4) & MASK
  } else hash = P5
  hash = (hash + BigInt(data.length)) & MASK
  while (offset <= data.length - 8) {
    hash = (rotate(hash ^ round(0n, data.readBigUInt64LE(offset)), 27n) * P1 + P4) & MASK
    offset += 8
  }
  if (offset <= data.length - 4) {
    hash = (rotate(hash ^ (BigInt(data.readUInt32LE(offset)) * P1 & MASK), 23n) * P2 + P3) & MASK
    offset += 4
  }
  while (offset < data.length) {
    hash = rotate(hash ^ (BigInt(data[offset++]) * P5 & MASK), 11n) * P1 & MASK
  }
  hash ^= hash >> 33n; hash = hash * P2 & MASK
  hash ^= hash >> 29n; hash = hash * P3 & MASK
  hash ^= hash >> 32n
  return hash.toString(16).padStart(16, '0')
}

export function readTarHeader(header: Buffer): { name: string; size: number; type: string } | null {
  if (header.length !== 512) throw new Error('TAR 文件头不完整')
  if (header.every((byte) => byte === 0)) return null
  const octal = (start: number, end: number) => {
    const text = header.toString('ascii', start, end).replace(/\0/g, '').trim()
    if (!/^[0-7]+$/.test(text)) throw new Error('TAR 数值字段无效')
    const value = parseInt(text, 8)
    if (!Number.isSafeInteger(value)) throw new Error('TAR 条目过大')
    return value
  }
  const expected = octal(148, 156)
  const actual = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0)
  if (actual !== expected) throw new Error('TAR 文件头校验失败')
  const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '')
  const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/s, '')
  const fullName = prefix ? `${prefix}/${name}` : name
  if (!fullName || fullName.startsWith('/') || fullName.split('/').includes('..')) throw new Error('TAR 条目路径无效')
  return { name: fullName, size: octal(124, 136), type: header.toString('ascii', 156, 157) }
}

/** Bounded-memory scan of XAPI's sparse disk stream, including zero-length keepalives. */
export async function verifyXvaArchive(
  filePath: string,
  manifestDisks: (xml: string) => { disks: XvaDisk[]; diskCount: number },
  signal?: AbortSignal,
  onProgress?: (progress: XvaValidationProgress) => void,
): Promise<void> {
  const fd = fs.openSync(filePath, 'r')
  try {
    const fileSize = fs.fstatSync(fd).size
    const startedAt = performance.now()
    let lastReportAt = startedAt
    const report = (bytesChecked: number, force = false) => {
      if (!onProgress) return
      const now = performance.now()
      if (!force && now - lastReportAt < 500) return
      lastReportAt = now
      onProgress({ bytesChecked, bytesTotal: fileSize, elapsedMs: Math.max(0, now - startedAt) })
    }
    report(0, true)
    let offset = 0, manifest = false, ended = false
    let expected: ReturnType<typeof manifestDisks> = { disks: [], diskCount: 0 }
    const chunks = new Map<string, { last: number; end: number }>()
    let previous: { name: string; data: Buffer } | undefined
    const read = (length: number, position: number) => {
      const data = Buffer.alloc(length)
      if (fs.readSync(fd, data, 0, length, position) !== length) throw new Error('XVA 条目内容不完整')
      return data
    }
    while (offset + 512 <= fileSize) {
      if (signal?.aborted) throw new Error('归档检查已取消')
      const header = readTarHeader(read(512, offset))
      if (!header) {
        if (offset + 1024 > fileSize || !read(512, offset + 512).every((b) => b === 0)) throw new Error('缺少 TAR 结束标记')
        for (let p = offset + 1024; p < fileSize; p += 65536) {
          if (signal?.aborted) throw new Error('归档检查已取消')
          if (!read(Math.min(65536, fileSize - p), p).every((b) => b === 0)) throw new Error('TAR 结束标记后包含额外内容')
          report(Math.min(fileSize - 1, p + 65536))
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        ended = true; break
      }
      const { name, size, type } = header
      const padded = Math.ceil(size / 512) * 512
      if (offset + 512 + padded > fileSize) throw new Error(`XVA 条目不完整：${name}`)
      if (!['\0', '0', '5'].includes(type)) throw new Error(`不支持的 TAR 条目类型：${name}`)
      if (name === 'ova.xml') {
        if (manifest || size < 1 || size > 16 * 1024 * 1024) throw new Error('XVA 元数据无效')
        expected = manifestDisks(read(size, offset + 512).toString('utf8')); manifest = true
      } else if (/\/\d{8}$/.test(name)) {
        if (!manifest || size > CHUNK_SIZE) throw new Error(`XVA 磁盘块大小无效：${name}`)
        if (previous) throw new Error(`磁盘块缺少内联校验：${previous.name}`)
        const split = name.lastIndexOf('/'), id = name.slice(0, split), index = Number(name.slice(split + 1))
        const disk = expected.disks.find((d) => d.id === id)
        if (expected.disks.length && !disk) throw new Error(`未声明的磁盘：${id}`)
        const state = chunks.get(id)
        if (state && index <= state.last) throw new Error(`磁盘块顺序无效：${name}`)
        if (!state && (index !== 0 || size === 0)) throw new Error(`磁盘缺少起始数据块：${id}`)
        // XAPI recv_all_vdi advances by skipped suffixes plus the actual payload length.
        // A keepalive consumes a suffix but has no payload and does not advance the disk.
        const start = (state?.end ?? 0) + (index - (state?.last ?? -1) - 1) * CHUNK_SIZE
        if (disk && (start >= disk.size || size > 0 && size !== Math.min(CHUNK_SIZE, disk.size - start))) throw new Error(`磁盘块边界无效：${name}`)
        chunks.set(id, { last: index, end: start + size })
        previous = { name, data: read(size, offset + 512) }
      } else if (/\.(checksum|xxhash)$/.test(name)) {
        if (!previous || name !== `${previous.name}${name.endsWith('.xxhash') ? '.xxhash' : '.checksum'}` || size > 64) throw new Error(`磁盘块校验条目无效：${name}`)
        const expectedHash = read(size, offset + 512).toString('ascii').trim().toLowerCase()
        const actualHash = name.endsWith('.xxhash') ? xxhash64(previous.data) : createHash('sha1').update(previous.data).digest('hex')
        if (expectedHash !== actualHash) throw new Error(`磁盘块校验失败：${previous.name}`)
        previous = undefined
      } else if (type !== '5') {
        throw new Error(`不支持的 XVA 条目：${name}（需要内联校验格式）`)
      }
      offset += 512 + padded
      if (!previous) report(Math.min(fileSize - 1, offset))
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (!ended || !manifest || previous) throw new Error('XVA 归档不完整或缺少磁盘校验')
    if (chunks.size !== expected.diskCount) throw new Error('XVA 中的磁盘数据与元数据数量不符')
    for (const disk of expected.disks) {
      if (chunks.get(disk.id)?.end !== disk.size) throw new Error(`磁盘缺少起始或末尾数据块：${disk.id}`)
    }
    if (signal?.aborted) throw new Error('归档检查已取消')
    report(fileSize, true)
  } finally { fs.closeSync(fd) }
}
