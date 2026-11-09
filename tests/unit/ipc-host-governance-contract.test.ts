import { describe, expect, it } from 'vitest'
import {
  hostDisableContract,
  hostEnableContract,
  hostEnterMaintenanceContract,
  hostEvacuateContract,
  hostExitMaintenanceContract,
  hostGetMaintenanceStatusContract,
  hostGovernanceInvokeContracts,
  hostListContract,
  hostMetricsContract,
  hostRebootContract,
  hostShutdownContract,
} from '../../src/shared/ipc-contracts/host-governance'

describe('host governance IPC contracts', () => {
  it('declares the literal ten host invokes with the trusted app-window boundary', () => {
    expect(hostGovernanceInvokeContracts.map(({ channel }) => channel)).toEqual([
      'host:list',
      'host:metrics',
      'host:enable',
      'host:disable',
      'host:reboot',
      'host:shutdown',
      'host:getMaintenanceStatus',
      'host:enterMaintenance',
      'host:exitMaintenance',
      'host:evacuate',
    ])
    expect(new Set(hostGovernanceInvokeContracts.map(({ channel }) => channel))).toHaveLength(10)

    for (const contract of hostGovernanceInvokeContracts) {
      expect(contract).toMatchObject({
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        errorShape: 'ipc-error-response-v1',
        redaction: ['none'],
      })
    }

    expect(hostGovernanceInvokeContracts).toEqual([
      hostListContract,
      hostMetricsContract,
      hostEnableContract,
      hostDisableContract,
      hostRebootContract,
      hostShutdownContract,
      hostGetMaintenanceStatusContract,
      hostEnterMaintenanceContract,
      hostExitMaintenanceContract,
      hostEvacuateContract,
    ])
  })

  it('validates host tuples and preserves extra live XAPI result fields', () => {
    const hostRecord = {
      ref: 'OpaqueRef:host',
      uuid: 'host-uuid',
      name_label: 'xcp-1',
      hostname: 'xcp-1.example.test',
      address: '192.0.2.10',
      enabled: true,
      resident_VMs: ['OpaqueRef:vm'],
      cpu_info: { cpu_count: '8' },
      software_version: { product_version: '8.3' },
      metrics: 'OpaqueRef:host-metrics',
      suspend_image_sr: 'OpaqueRef:NULL',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      xapi_extension: { generation: 4 },
    }
    const metrics = {
      ref: 'OpaqueRef:host-metrics',
      memory_total: 64 * 1024 ** 3,
      memory_free: 32 * 1024 ** 3,
      live: true,
      xapi_extension: 'preserved',
    }

    expect(hostListContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    expect(hostMetricsContract.argsSchema.parse([
      'pool-1',
      'OpaqueRef:host-metrics',
    ])).toEqual(['pool-1', 'OpaqueRef:host-metrics'])
    expect(hostListContract.resultSchema.parse([hostRecord])).toEqual([hostRecord])
    expect(hostMetricsContract.resultSchema.parse(metrics)).toEqual(metrics)
    expect(hostGetMaintenanceStatusContract.resultSchema.parse({
      hostRef: 'OpaqueRef:host',
      state: 'maintenance',
      runningVms: 1,
      residentVms: ['OpaqueRef:vm'],
    })).toEqual({
      hostRef: 'OpaqueRef:host',
      state: 'maintenance',
      runningVms: 1,
      residentVms: ['OpaqueRef:vm'],
    })
    expect(hostEvacuateContract.resultSchema.parse({
      success: false,
      migratedVms: ['OpaqueRef:vm-1'],
      failedVms: [{ vmRef: 'OpaqueRef:vm-2', error: 'HOST_NOT_LIVE' }],
    })).toEqual({
      success: false,
      migratedVms: ['OpaqueRef:vm-1'],
      failedVms: [{ vmRef: 'OpaqueRef:vm-2', error: 'HOST_NOT_LIVE' }],
    })

    for (const args of [
      [],
      [' '],
      ['pool-1', 'OpaqueRef:NULL'],
      ['pool-1', 'OpaqueRef:host', 'extra'],
    ]) expect(() => hostMetricsContract.argsSchema.parse(args)).toThrow()
  })

  it('rejects malformed host results including null object references', () => {
    const hostRecord = {
      ref: 'OpaqueRef:host',
      uuid: 'host-uuid',
      name_label: 'xcp-1',
      hostname: 'xcp-1.example.test',
      address: '192.0.2.10',
      enabled: true,
      resident_VMs: ['OpaqueRef:NULL'],
      memory_total: 64,
      memory_free: 32,
      cpu_info: {},
      software_version: {},
      metrics: 'OpaqueRef:host-metrics',
      suspend_image_sr: 'OpaqueRef:NULL',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }

    expect(() => hostListContract.resultSchema.parse([hostRecord])).toThrow()
    expect(() => hostMetricsContract.resultSchema.parse({
      ref: 'OpaqueRef:host-metrics',
      memory_total: -1,
      memory_free: 0,
      live: true,
    })).toThrow()
    expect(() => hostGetMaintenanceStatusContract.resultSchema.parse({
      hostRef: 'OpaqueRef:host',
      state: 'maintenance',
      runningVms: 0.5,
      residentVms: [],
    })).toThrow()
    expect(() => hostEvacuateContract.resultSchema.parse({
      success: true,
      migratedVms: ['OpaqueRef:NULL'],
      failedVms: [],
    })).toThrow()
  })
})
