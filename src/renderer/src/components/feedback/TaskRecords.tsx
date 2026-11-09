import type { ReactNode } from 'react'

/** Collapse presentation history without unmounting task observers. */
export function TaskRecords<T>({ records, finished, children }: {
  records: T[]
  finished: (record: T) => boolean
  children: (record: T) => ReactNode
}) {
  const active = records.filter((record) => !finished(record))
  const history = records.filter(finished)
  return <>
    {active.map(children)}
    {history.length > 0 && <details className="space-y-2">
      <summary className="cursor-pointer rounded py-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">已结束（{history.length}）</summary>
      {history.map(children)}
    </details>}
  </>
}
