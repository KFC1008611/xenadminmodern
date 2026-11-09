import { describe, expect, it, vi } from 'vitest'
import { createHaApi } from '../../src/preload/ha-api'

const config = {
  enabled: true,
  allowOvercommit: false,
  plannedRepeats: 1,
  heartbeatSRs: ['OpaqueRef:sr'],
  hosts: [],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('HA governance preload IPC contracts', () => {
  it('exposes and routes the exact twelve HA methods through descriptors', async () => {
    const invoke = vi.fn(async (channel: string) => ({
      'ha:getConfig': config,
      'ha:enable': undefined,
      'ha:disable': undefined,
      'ha:computeTolerance': {
        canHandleHostFailures: 1,
        vmsThatCouldBeRestarted: null,
        vmsThatWouldNotBeRestarted: null,
      },
      'ha:preventRestarts': undefined,
      'ha:getVmConfigs': [],
      'ha:setVmPriority': undefined,
      'ha:setVmAlwaysRun': undefined,
      'ha:getVmAlwaysRun': true,
      'ha:emergencyMaster': undefined,
      'ha:recoverSlaves': undefined,
      'ha:getFailoverPlan': { vmsByPriority: [], canTolerateFailures: 1 },
    })[channel])
    const api = createHaApi({ invoke })

    expect(Object.keys(api)).toEqual(['ha'])
    expect(Object.keys(api.ha)).toEqual([
      'getConfig', 'enable', 'disable', 'computeTolerance', 'preventRestarts',
      'getVmConfigs', 'setVmPriority', 'setVmAlwaysRun', 'getVmAlwaysRun',
      'emergencyMaster', 'recoverSlaves', 'getFailoverPlan',
    ])

    await api.ha.getConfig('pool-1')
    await api.ha.enable('pool-1', { heartbeatSRs: ['OpaqueRef:sr'] })
    await api.ha.disable('pool-1')
    await api.ha.computeTolerance('pool-1')
    await api.ha.preventRestarts('pool-1', 60)
    await api.ha.getVmConfigs('pool-1')
    await api.ha.setVmPriority('pool-1', 'OpaqueRef:vm', 'restart')
    await api.ha.setVmAlwaysRun('pool-1', 'OpaqueRef:vm', true)
    await api.ha.getVmAlwaysRun('pool-1', 'OpaqueRef:vm')
    await api.ha.emergencyMaster('pool-1')
    await api.ha.recoverSlaves('pool-1')
    await api.ha.getFailoverPlan('pool-1')

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'ha:getConfig', 'ha:enable', 'ha:disable', 'ha:computeTolerance',
      'ha:preventRestarts', 'ha:getVmConfigs', 'ha:setVmPriority',
      'ha:setVmAlwaysRun', 'ha:getVmAlwaysRun', 'ha:emergencyMaster',
      'ha:recoverSlaves', 'ha:getFailoverPlan',
    ])
  })

  it('rejects malformed arguments before transport and malformed results after it', async () => {
    const invoke = vi.fn()
    const api = createHaApi({ invoke })

    await expect(api.ha.enable('pool-1', {
      heartbeatSRs: ['OpaqueRef:sr'],
      unknown: true,
    } as never)).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.ha.setVmPriority('pool-1', 'OpaqueRef:vm', 4))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockResolvedValueOnce({ ...config, hosts: 'invalid' })
    await expect(api.ha.getConfig('pool-1'))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
  })
})
