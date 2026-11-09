/**
 * Unit tests for task.service — verifies XAPI task.* calls.
 * v4: Updated to mock connectionManager instead of singleton xapiClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { taskListContract } from '../../src/shared/ipc-contracts/infrastructure'

const mockCallWithSession = vi.fn()
const mockGetClient = vi.fn(() => ({
  callWithSession: mockCallWithSession,
}))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('task.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAllTasks returns list of task records with connection metadata', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:task1': {
        uuid: 'uuid-task1',
        name_label: 'VM.start',
        name_description: 'Starting VM my-vm',
        status: 'success',
        progress: 1.0,
        created: '20240101T120000Z',
        finished: '20240101T120010Z',
        error_info: [],
      },
      'OpaqueRef:task2': {
        uuid: 'uuid-task2',
        name_label: 'VM.shutdown',
        name_description: 'Shutting down VM other-vm',
        status: 'pending',
        progress: 0.5,
        created: '20240101T121000Z',
        finished: '',
        error_info: [],
      },
    })

    const { getAllTasks } = await import('../../src/main/xapi/services/task.service')
    const tasks = await getAllTasks('conn-123')

    expect(tasks).toHaveLength(2)
    expect(tasks[0].ref).toBe('OpaqueRef:task1')
    expect(tasks[0].name_label).toBe('VM.start')
    expect(tasks[0].status).toBe('success')
    expect(tasks[0].connectionId).toBe('conn-123')
    expect(tasks[0].poolName).toBe('Test Pool')
    expect(tasks[1].ref).toBe('OpaqueRef:task2')
    expect(tasks[1].status).toBe('pending')
    expect(mockCallWithSession).toHaveBeenCalledWith('task.get_all_records', [])
  })

  it('getAllTasks returns empty array when no tasks exist', async () => {
    mockCallWithSession.mockResolvedValueOnce({})

    const { getAllTasks } = await import('../../src/main/xapi/services/task.service')
    const tasks = await getAllTasks('conn-123')

    expect(tasks).toHaveLength(0)
    expect(mockCallWithSession).toHaveBeenCalledTimes(1)
  })

  it('normalizes XML-RPC dateTime objects before the task IPC result boundary', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:task1': {
        uuid: 'uuid-task1',
        name_label: 'VM.start',
        name_description: '',
        status: 'success',
        progress: 1,
        created: new Date('2026-09-29T00:00:00.000Z'),
        finished: new Date('2026-09-29T00:00:05.000Z'),
        error_info: [],
      },
    })

    const { getAllTasks } = await import('../../src/main/xapi/services/task.service')
    const tasks = await getAllTasks('conn-123')

    expect(tasks[0].created).toBe('2026-09-29T00:00:00.000Z')
    expect(tasks[0].finished).toBe('2026-09-29T00:00:05.000Z')
    expect(taskListContract.resultSchema.parse(tasks)).toEqual(tasks)
  })

  it('getAllTasks propagates XAPI error', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))

    const { getAllTasks } = await import('../../src/main/xapi/services/task.service')
    await expect(getAllTasks('conn-123')).rejects.toThrow('PERMISSION_DENIED')
  })

  it('getAllTasks throws when connectionId is invalid', async () => {
    mockGetClient.mockReturnValueOnce(undefined)

    const { getAllTasks } = await import('../../src/main/xapi/services/task.service')
    await expect(getAllTasks('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
  })

  it('cancelTask returns the confirmed cancellation result', async () => {
    mockCallWithSession.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 'cancelled' })

    const { cancelTask } = await import('../../src/main/xapi/services/task.service')
    await expect(cancelTask('conn-123', 'OpaqueRef:task1')).resolves.toEqual({ status: 'cancelled', message: '任务已取消（服务器已确认）' })

    expect(mockCallWithSession).toHaveBeenCalledWith('task.cancel', ['OpaqueRef:task1'])
    expect(mockCallWithSession).toHaveBeenCalledWith('task.get_record', ['OpaqueRef:task1'])
  })

  it.each(['success', 'failure'])('returns the server terminal result when cancellation ends in %s', async (status) => {
    mockCallWithSession.mockResolvedValueOnce(null).mockResolvedValueOnce({ status, error_info: ['SR_BACKEND_FAILURE'] })
    const { cancelTask } = await import('../../src/main/xapi/services/task.service')
    const result = await cancelTask('conn-123', 'OpaqueRef:task1')
    expect(result.status).toBe(status)
    expect(result.message).toContain(status === 'success' ? '取消未阻止任务完成' : 'SR_BACKEND_FAILURE')
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'task.cancel')).toHaveLength(1)
  })

  it('observes the original task after a lost cancellation acknowledgement without resubmitting', async () => {
    mockCallWithSession.mockRejectedValueOnce(Object.assign(new Error('reply lost'), { details: { kind: 'transport' } }))
      .mockResolvedValueOnce({ status: 'cancelled' })
    const { cancelTask } = await import('../../src/main/xapi/services/task.service')
    await expect(cancelTask('conn-123', 'OpaqueRef:task1')).resolves.toMatchObject({ status: 'cancelled' })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'task.cancel')).toHaveLength(1)
  })

  it('cancelTask propagates error when task is already completed', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('TASK_COMPLETED'))

    const { cancelTask } = await import('../../src/main/xapi/services/task.service')
    await expect(cancelTask('conn-123', 'OpaqueRef:task1')).rejects.toThrow('TASK_COMPLETED')
  })
})
