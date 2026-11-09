import type { HostRecord } from '../../types/xapi'
import { formatMemoryBytes } from '../../lib/utils'

export function HostMemorySummary({ host }: { host: Pick<HostRecord, 'memory_total' | 'memory_free' | 'memoryReadError'> }) {
  const total = host.memory_total
  const free = host.memory_free
  return <div className="min-w-0 space-y-1">
    <p className="font-medium tabular-nums text-foreground">{total !== undefined && total > 0 ? formatMemoryBytes(total) : '容量暂不可用'}</p>
    {free !== undefined && <p className="text-xs tabular-nums text-muted-foreground">
      {total !== undefined && total >= free && `已用 ${formatMemoryBytes(total - free)} · `}可用 {formatMemoryBytes(free)}
    </p>}
    {host.memoryReadError && <p role="alert" className="break-words text-xs text-warning">内存读取失败：{host.memoryReadError}</p>}
  </div>
}
