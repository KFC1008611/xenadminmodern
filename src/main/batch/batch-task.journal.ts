import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { getJsonStorePath } from '../persistence/json-store'

let writeFailed = false
const journalPath = () => getJsonStorePath('batch-tasks')?.replace(/\.json$/, '.jsonl')

export function readBatchJournal(): unknown[] {
  writeFailed = false
  const path = journalPath()
  if (!path) return []
  try {
    const content = readFileSync(path, 'utf8')
    // A partial last append cannot have returned and dispatched a mutation.
    // An interrupted result append leaves the preceding durable running item.
    return content.slice(0, content.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('无法读取批量任务日志，原文件已保留', { cause: error })
  }
}

export function appendBatchJournal(entry: unknown): void {
  if (writeFailed) throw new Error('批量任务日志写入失败，请恢复存储并重新启动应用后核对任务')
  const path = journalPath()
  if (!path) return
  try {
    // Flush the admission/running marker before any remote write is dispatched.
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600, flush: true })
  } catch (error) {
    writeFailed = true
    throw new Error('无法保存批量任务日志，未继续派发操作', { cause: error })
  }
}

export function clearBatchJournal(): void {
  const path = journalPath()
  if (path) writeFileSync(path, '', { mode: 0o600, flush: true })
  writeFailed = false
}
