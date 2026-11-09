import { describe, expect, it, vi } from 'vitest'
import { createInfrastructureApi } from '../../src/preload/infrastructure-api'

describe('infrastructure preload API', () => {
  it('exposes the exact invoke groups and a subscriber without a push invoke', () => {
    const api = createInfrastructureApi({
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    })

    expect(Object.keys(api.pool)).toEqual(['get', 'addHost', 'removeHost', 'transferMaster'])
    expect(Object.keys(api.tasks)).toEqual(['list', 'cancel'])
    expect(Object.keys(api.profiles)).toEqual(['list', 'save', 'delete', 'hasPassword', 'connect'])
    expect(Object.keys(api.vm)).toEqual(['console'])
    expect(Object.keys(api.console)).toEqual(['getUrl', 'close'])
    expect(Object.keys(api.dialog)).toEqual(['showOpenDialog', 'showSaveDialog'])
    expect(Object.keys(api.batch)).toEqual(['submit', 'cancel', 'getStatus', 'list', 'retry'])
    expect(Object.keys(api)).toEqual([
      'pool',
      'tasks',
      'profiles',
      'vm',
      'console',
      'dialog',
      'batch',
      'onBatchProgress',
    ])
  })

  it('routes pool and resource-pool task methods through their literal channels', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('OpaqueRef:join-task')
      .mockResolvedValueOnce('OpaqueRef:eject-task')
      .mockResolvedValueOnce('OpaqueRef:transfer-task')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ status: 'cancelled', message: '任务已取消' })
    const api = createInfrastructureApi({
      invoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    })
    const join = {
      targetHost: '192.0.2.20',
      username: 'root',
      password: 'pool-password',
      masterAddress: '192.0.2.10',
    }

    await expect(api.pool.get('pool-1')).resolves.toBeNull()
    await expect(api.pool.addHost('pool-1', join)).resolves.toBe('OpaqueRef:join-task')
    await expect(api.pool.removeHost('pool-1', 'OpaqueRef:host')).resolves.toBe('OpaqueRef:eject-task')
    await expect(api.pool.transferMaster('pool-1', 'OpaqueRef:host')).resolves.toBe('OpaqueRef:transfer-task')
    await expect(api.tasks.list('pool-1')).resolves.toEqual([])
    await expect(api.tasks.cancel('pool-1', 'OpaqueRef:task')).resolves.toEqual({ status: 'cancelled', message: '任务已取消' })

    expect(invoke.mock.calls).toEqual([
      ['pool:get', 'pool-1'],
      ['pool:addHost', 'pool-1', join],
      ['pool:removeHost', 'pool-1', 'OpaqueRef:host'],
      ['pool:transferMaster', 'pool-1', 'OpaqueRef:host'],
      ['task:list', 'pool-1'],
      ['task:cancel', 'pool-1', 'OpaqueRef:task'],
    ])
  })

  it('pairs profile, console, dialog, and batch methods with literal channels', async () => {
    const invoke = vi.fn()
    const api = createInfrastructureApi({
      invoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    })
    const profile = {
      id: 'profile-1',
      name: 'Lab',
      host: '192.0.2.10',
      port: 443,
      scheme: 'https:' as const,
      username: 'root',
      lastConnected: null,
    }
    const target = {
      connectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      vmName: 'VM 1',
      intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 },
    }
    const batchInput = {
      requestId: 'submit-1',
      type: 'stop' as const,
      targets: [target],
      options: undefined,
    }
    const batchTask = {
      id: 'batch-1',
      type: 'stop' as const,
      targets: [target],
      options: undefined,
      status: 'pending' as const,
      progress: { total: 1, completed: 0, failed: 0 },
      createdAt: 100,
    }
    const cases: Array<{
      method: (...args: never[]) => Promise<unknown>
      channel: string
      args: unknown[]
      result: unknown
    }> = [
      { method: api.profiles.list, channel: 'profile:list', args: [], result: [profile] },
      { method: api.profiles.save, channel: 'profile:save', args: [profile, 'secret'], result: undefined },
      { method: api.profiles.delete, channel: 'profile:delete', args: ['profile-1'], result: undefined },
      { method: api.profiles.hasPassword, channel: 'profile:hasPassword', args: ['profile-1'], result: true },
      { method: api.profiles.connect, channel: 'profile:connect', args: ['profile-1', 'secret'], result: { id: 'profile-1' } },
      { method: api.vm.console, channel: 'vm:console', args: ['pool-1', 'OpaqueRef:vm'], result: [] },
      { method: api.console.getUrl, channel: 'console:getUrl', args: ['pool-1', 'OpaqueRef:vm'], result: { wsUrl: 'ws://127.0.0.1/console', sessionId: 'session-1' } },
      { method: api.console.close, channel: 'console:close', args: ['session-1'], result: undefined },
      { method: api.dialog.showOpenDialog, channel: 'dialog:showOpenDialog', args: [], result: { canceled: true, filePaths: [] } },
      { method: api.dialog.showSaveDialog, channel: 'dialog:showSaveDialog', args: [{ title: 'Export' }], result: { canceled: true, filePath: '' } },
      { method: api.batch.submit, channel: 'batch:submit', args: [batchInput], result: { taskId: 'batch-1' } },
      { method: api.batch.cancel, channel: 'batch:cancel', args: ['batch-1'], result: undefined },
      { method: api.batch.getStatus, channel: 'batch:getStatus', args: ['batch-1'], result: { ...batchTask, items: [] } },
      { method: api.batch.list, channel: 'batch:list', args: [], result: [batchTask] },
      { method: api.batch.retry, channel: 'batch:retry', args: ['batch-1', { requestId: 'retry-1', items: [{ id: 'item-1', retryCount: 0 }] }], result: undefined },
    ]

    for (const testCase of cases) {
      invoke.mockResolvedValueOnce(testCase.result)
      await expect(testCase.method(...testCase.args as never[])).resolves.toEqual(testCase.result)
    }

    const expectedCalls = cases.map(({ channel, args }) => [channel, ...args])
    expectedCalls[8] = ['dialog:showOpenDialog', undefined]
    expect(invoke.mock.calls).toEqual(expectedCalls)
  })

  it('fails closed at invoke and push boundaries and returns an unsubscribe function', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ taskId: '' })
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const transport = {
      invoke,
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      removeListener: vi.fn(),
    }
    const api = createInfrastructureApi(transport)
    const target = {
      connectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      vmName: 'VM 1',
      intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 },
    }

    await expect(api.batch.submit({
      requestId: 'submit-1',
      type: 'migrate',
      targets: [target],
      options: undefined,
    })).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    await expect(api.batch.submit({
      requestId: 'submit-1',
      type: 'stop',
      targets: [target],
      options: undefined,
    })).rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })

    const callback = vi.fn()
    const unsubscribe = api.onBatchProgress(callback)
    expect(transport.on).toHaveBeenCalledWith('batch:progress', expect.any(Function))
    const event = {
      taskId: 'batch-1',
      status: 'running',
      progress: { total: 1, completed: 0, failed: 0, currentItem: undefined },
    }
    listeners.get('batch:progress')?.({}, event)
    listeners.get('batch:progress')?.({}, { ...event, status: 'pending' })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(event)

    unsubscribe()
    expect(transport.removeListener).toHaveBeenCalledWith(
      'batch:progress',
      listeners.get('batch:progress'),
    )
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalledWith('batch:progress', expect.anything())
  })
})
