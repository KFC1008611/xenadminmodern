import { describe, expect, it, vi } from 'vitest'
import { readOperationResult, ReadScopeChangedError } from '../../src/shared/read-operation-result'

describe('operation result reads', () => {
  it('returns a recovered result after a transient read failure', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValue('applied')
    await expect(readOperationResult(read, { delayMs: 0 })).resolves.toBe('applied')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('reports the last concrete fault after three failed reads', async () => {
    const read = vi.fn().mockRejectedValue(new Error('read denied'))
    await expect(readOperationResult(read, { delayMs: 0 })).rejects.toThrow('read denied')
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('discards a result from a replaced connection without reading again', async () => {
    let current = true
    const read = vi.fn(async () => { current = false; return 'obsolete' })
    await expect(readOperationResult(read, { isCurrent: () => current })).rejects.toBeInstanceOf(ReadScopeChangedError)
    expect(read).toHaveBeenCalledOnce()
  })
  it('does not read a resource whose identity has already changed', async () => {
    const read = vi.fn()
    await expect(readOperationResult(read, { isCurrent: () => false })).rejects.toBeInstanceOf(ReadScopeChangedError)
    expect(read).not.toHaveBeenCalled()
  })
})
