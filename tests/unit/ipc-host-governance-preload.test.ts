import { describe, expect, it, vi } from 'vitest'
import { createHostApi } from '../../src/preload/host-api'

const hostRecord = {
  ref: 'OpaqueRef:host',
  uuid: 'host-uuid',
  name_label: 'xcp-1',
  hostname: 'xcp-1.example.test',
  address: '192.0.2.10',
  enabled: true,
  resident_VMs: [],
  memory_total: 64,
  memory_free: 32,
  cpu_info: {},
  software_version: {},
  metrics: 'OpaqueRef:host-metrics',
  suspend_image_sr: 'OpaqueRef:NULL',
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('host governance preload API', () => {
  it('exposes the exact host method surface', () => {
    const api = createHostApi({ invoke: vi.fn() })

    expect(Object.keys(api)).toEqual(['host'])
    expect(Object.keys(api.host)).toEqual([
      'list',
      'metrics',
      'enable',
      'disable',
      'reboot',
      'shutdown',
      'getMaintenanceStatus',
      'enterMaintenance',
      'exitMaintenance',
      'evacuate',
    ])
  })

  it('pairs all ten methods with their literal invoke channels', async () => {
    const invoke = vi.fn()
    const { host } = createHostApi({ invoke })
    const metrics = {
      ref: 'OpaqueRef:host-metrics',
      memory_total: 64,
      memory_free: 32,
      live: true,
    }
    const maintenance = {
      hostRef: 'OpaqueRef:host',
      state: 'maintenance' as const,
      runningVms: 1,
      residentVms: ['OpaqueRef:vm'],
    }
    const evacuation = {
      success: true,
      migratedVms: ['OpaqueRef:vm'],
      failedVms: [],
    }
    const cases: Array<{
      method: (...args: never[]) => Promise<unknown>
      channel: string
      args: unknown[]
      result: unknown
    }> = [
      { method: host.list, channel: 'host:list', args: ['pool-1'], result: [hostRecord] },
      {
        method: host.metrics,
        channel: 'host:metrics',
        args: ['pool-1', 'OpaqueRef:host-metrics'],
        result: metrics,
      },
      { method: host.enable, channel: 'host:enable', args: ['pool-1', 'OpaqueRef:host'], result: undefined },
      { method: host.disable, channel: 'host:disable', args: ['pool-1', 'OpaqueRef:host'], result: undefined },
      { method: host.reboot, channel: 'host:reboot', args: ['pool-1', 'OpaqueRef:host'], result: undefined },
      { method: host.shutdown, channel: 'host:shutdown', args: ['pool-1', 'OpaqueRef:host'], result: undefined },
      {
        method: host.getMaintenanceStatus,
        channel: 'host:getMaintenanceStatus',
        args: ['pool-1', 'OpaqueRef:host'],
        result: maintenance,
      },
      {
        method: host.enterMaintenance,
        channel: 'host:enterMaintenance',
        args: ['pool-1', 'OpaqueRef:host'],
        result: evacuation,
      },
      {
        method: host.exitMaintenance,
        channel: 'host:exitMaintenance',
        args: ['pool-1', 'OpaqueRef:host'],
        result: undefined,
      },
      {
        method: host.evacuate,
        channel: 'host:evacuate',
        args: ['pool-1', 'OpaqueRef:host'],
        result: evacuation,
      },
    ]

    for (const testCase of cases) {
      invoke.mockResolvedValueOnce(testCase.result)
      await expect(testCase.method(...testCase.args as never[])).resolves.toEqual(testCase.result)
    }

    expect(invoke.mock.calls).toEqual(
      cases.map(({ channel, args }) => [channel, ...args]),
    )
  })

  it('fails closed for malformed arguments and results', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      ref: 'OpaqueRef:host-metrics',
      memory_total: -1,
      memory_free: 0,
      live: true,
    })
    const { host } = createHostApi({ invoke })

    await expect(host.disable('pool-1', 'OpaqueRef:NULL'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    await expect(host.metrics('pool-1', 'OpaqueRef:host-metrics'))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
    expect(invoke).toHaveBeenCalledOnce()
  })
})
