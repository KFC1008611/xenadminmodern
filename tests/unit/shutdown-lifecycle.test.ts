import { describe, expect, it, vi } from 'vitest'
import { runShutdownSteps } from '../../src/main/lifecycle/shutdown'

describe('ordered shutdown cleanup', () => {
  it('flushes remaining stores after both synchronous and asynchronous cleanup failures', async () => {
    const calls: string[] = []
    const report = vi.fn()
    await runShutdownSteps([
      { name: 'stop tasks', run: () => { calls.push('stop'); throw new Error('disk unavailable') } },
      { name: 'close task store', run: () => { calls.push('close tasks') } },
      { name: 'close consoles', run: async () => { calls.push('consoles'); throw new Error('close failed') } },
      { name: 'flush metrics', run: () => { calls.push('flush') } },
    ], report)
    expect(calls).toEqual(['stop', 'close tasks', 'consoles', 'flush'])
    expect(report.mock.calls.map(([name]) => name)).toEqual(['stop tasks', 'close consoles'])
  })

  it('awaits each prerequisite before closing dependent state', async () => {
    let finish!: () => void
    const close = vi.fn()
    const promise = runShutdownSteps([
      { name: 'stop', run: () => new Promise<void>((resolve) => { finish = resolve }) },
      { name: 'close', run: close },
    ], vi.fn())
    expect(close).not.toHaveBeenCalled()
    finish()
    await promise
    expect(close).toHaveBeenCalledTimes(1)
  })
})
