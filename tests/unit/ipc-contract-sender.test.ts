import { describe, expect, it, vi } from 'vitest'
import { sendIpcContractPush } from '../../src/main/ipc/ipc-contract-sender'
import { definePushContract } from '../../src/shared/ipc-contract'

const noticeContract = definePushContract({
  channel: 'contract:notice',
  argsSchema: {
    parse(value: unknown): readonly [{ status: string }] {
      if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid notice')
      const notice = value[0]
      if (
        !notice
        || typeof notice !== 'object'
        || Array.isArray(notice)
        || Object.keys(notice).length !== 1
        || typeof (notice as { status?: unknown }).status !== 'string'
      ) {
        throw new Error('invalid notice')
      }
      return [{ status: (notice as { status: string }).status }]
    },
  },
  callerPolicy: 'main-process',
  redaction: ['none'],
})

describe('main IPC contract sender', () => {
  it('validates a push payload before sending it', () => {
    const send = vi.fn()

    sendIpcContractPush({ send }, noticeContract, { status: 'ready' })

    expect(send).toHaveBeenCalledWith('contract:notice', { status: 'ready' })
    expect(() => sendIpcContractPush(
      { send },
      noticeContract,
      { status: 'ready', extra: true } as never,
    )).toThrow('invalid notice')
    expect(send).toHaveBeenCalledOnce()
  })
})
