import { describe, expect, it } from 'vitest'
import * as Ch from '../../src/shared/channels'
import {
  haComputeToleranceContract,
  haDisableContract,
  haEmergencyMasterContract,
  haEnableContract,
  haGetConfigContract,
  haGetFailoverPlanContract,
  haGetVmAlwaysRunContract,
  haGetVmConfigsContract,
  haGovernanceContracts,
  haPreventRestartsContract,
  haRecoverSlavesContract,
  haSetVmAlwaysRunContract,
  haSetVmPriorityContract,
} from '../../src/shared/ipc-contracts/ha-governance'

const config = {
  enabled: true,
  allowOvercommit: false,
  plannedRepeats: 1,
  heartbeatSRs: ['OpaqueRef:sr'],
  hosts: [{
    hostRef: 'OpaqueRef:host',
    hostName: 'xcp-1',
    live: true,
    failed: false,
    failureMode: 'unknown' as const,
  }],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const vmConfig = {
  vmRef: 'OpaqueRef:vm',
  vmName: 'Database',
  restartPriority: 'restart',
  alwaysRun: true,
}

function expectRejected(schema: { parse(value: unknown): unknown }, values: unknown[]): void {
  for (const value of values) expect(() => schema.parse(value)).toThrow()
}

describe('HA governance IPC contracts', () => {
  it('exports the exact twelve ordered invoke descriptors', () => {
    const expected = [
      [haGetConfigContract, Ch.HA_GET_CONFIG],
      [haEnableContract, Ch.HA_ENABLE],
      [haDisableContract, Ch.HA_DISABLE],
      [haComputeToleranceContract, Ch.HA_COMPUTE_TOLERANCE],
      [haPreventRestartsContract, Ch.HA_PREVENT_RESTARTS],
      [haGetVmConfigsContract, Ch.HA_GET_VM_CONFIGS],
      [haSetVmPriorityContract, Ch.HA_SET_VM_PRIORITY],
      [haSetVmAlwaysRunContract, Ch.HA_SET_VM_ALWAYS_RUN],
      [haGetVmAlwaysRunContract, Ch.HA_GET_VM_ALWAYS_RUN],
      [haEmergencyMasterContract, Ch.HA_EMERGENCY_MASTER],
      [haRecoverSlavesContract, Ch.HA_RECOVER_SLAVES],
      [haGetFailoverPlanContract, Ch.HA_GET_FAILOVER_PLAN],
    ] as const

    expect(haGovernanceContracts).toEqual(expected.map(([contract]) => contract))
    expect(new Set(haGovernanceContracts.map(({ channel }) => channel))).toHaveLength(12)
    for (const [contract, channel] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        errorShape: 'ipc-error-response-v1',
        redaction: ['none'],
      })
    }
  })

  it('strictly parses connection, HA parameters, references, priorities, and booleans', () => {
    expect(haEnableContract.argsSchema.parse([
      'pool-1',
      { heartbeatSRs: ['OpaqueRef:sr'], allowOvercommit: true },
    ])).toEqual(['pool-1', { heartbeatSRs: ['OpaqueRef:sr'], allowOvercommit: true }])
    expect(haPreventRestartsContract.argsSchema.parse(['pool-1', 0])).toEqual(['pool-1', 0])
    expect(haSetVmPriorityContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', 'restart']))
      .toEqual(['pool-1', 'OpaqueRef:vm', 'restart'])
    expect(haSetVmAlwaysRunContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', true]))
      .toEqual(['pool-1', 'OpaqueRef:vm', true])

    expectRejected(haEnableContract.argsSchema, [
      ['pool-1', { heartbeatSRs: ['OpaqueRef:sr'], unknown: true }],
      ['pool-1', { heartbeatSRs: ['OpaqueRef:NULL'] }],
      ['pool-1', { heartbeatSRs: 'OpaqueRef:sr' }],
      ['', { heartbeatSRs: [] }],
    ])
    expectRejected(haPreventRestartsContract.argsSchema, [
      ['pool-1', -1], ['pool-1', 1.5], ['pool-1', '60'], ['pool-1', 60, true],
    ])
    expectRejected(haSetVmPriorityContract.argsSchema, [
      ['pool-1', 'OpaqueRef:vm', -1],
      ['pool-1', 'OpaqueRef:vm', 4],
      ['pool-1', 'OpaqueRef:vm', 1.5],
      ['pool-1', 'OpaqueRef:NULL', 1],
    ])
    expectRejected(haSetVmAlwaysRunContract.argsSchema, [
      ['pool-1', 'OpaqueRef:vm', 'true'],
      ['pool-1', 'OpaqueRef:NULL', true],
    ])
  })

  it('validates HA observations and failover plans without changing success shapes', () => {
    expect(haGetConfigContract.resultSchema.parse(config)).toEqual(config)
    expect(haGetConfigContract.resultSchema.parse(null)).toBeNull()
    expect(haGetVmConfigsContract.resultSchema.parse([vmConfig])).toEqual([vmConfig])
    expect(haComputeToleranceContract.resultSchema.parse({
      canHandleHostFailures: 1,
      vmsThatCouldBeRestarted: null,
      vmsThatWouldNotBeRestarted: null,
    })).toMatchObject({ canHandleHostFailures: 1 })
    expect(haGetFailoverPlanContract.resultSchema.parse({
      vmsByPriority: [{ priority: 'restart', vms: [vmConfig] }],
      canTolerateFailures: 1,
    })).toMatchObject({ canTolerateFailures: 1 })
    expect(haGetVmAlwaysRunContract.resultSchema.parse(true)).toBe(true)

    expectRejected(haGetConfigContract.resultSchema, [
      { ...config, unknown: true },
      { ...config, hosts: [{ ...config.hosts[0], failureMode: 'invented' }] },
      { ...config, plannedRepeats: -1 },
    ])
    expectRejected(haGetVmConfigsContract.resultSchema, [
      [{ ...vmConfig, restartPriority: 4 }],
      [{ ...vmConfig, unknown: true }],
    ])
    expectRejected(haGetFailoverPlanContract.resultSchema, [
      { vmsByPriority: [{ priority: 0, vms: [vmConfig] }], canTolerateFailures: 1 },
      { vmsByPriority: [], canTolerateFailures: -1 },
    ])
  })

  it('accepts only undefined for the seven mutation success results', () => {
    for (const contract of [
      haEnableContract,
      haDisableContract,
      haPreventRestartsContract,
      haSetVmPriorityContract,
      haSetVmAlwaysRunContract,
      haEmergencyMasterContract,
      haRecoverSlavesContract,
    ]) {
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
      expectRejected(contract.resultSchema, [null, false, {}])
    }
  })
})
