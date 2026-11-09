import { describe, expect, it } from 'vitest'
import { haGovernanceContracts } from '../../src/shared/ipc-contracts/ha-governance'
import { hostGovernanceInvokeContracts } from '../../src/shared/ipc-contracts/host-governance'
import { patchGovernanceContracts } from '../../src/shared/ipc-contracts/patch-governance'
import { rbacGovernanceContracts } from '../../src/shared/ipc-contracts/rbac-governance'

describe('governance IPC contract inventory', () => {
  it('contains 50 unique invoke channels on the main-frame boundary', () => {
    const contracts = [
      ...hostGovernanceInvokeContracts,
      ...haGovernanceContracts,
      ...patchGovernanceContracts,
      ...rbacGovernanceContracts,
    ]
    const channels = contracts.map(({ channel }) => channel)

    expect(contracts).toHaveLength(50)
    expect(new Set(channels)).toHaveLength(50)
    expect(contracts.every((contract) => (
      contract.direction === 'invoke'
      && contract.callerPolicy === 'app-window-main-frame'
      && contract.errorShape === 'ipc-error-response-v1'
    ))).toBe(true)
    expect(channels.filter((channel) => channel.startsWith('host:'))).toHaveLength(10)
    expect(channels.filter((channel) => channel.startsWith('ha:'))).toHaveLength(12)
    expect(channels.filter((channel) => channel.startsWith('patch:'))).toHaveLength(12)
    expect(channels.filter((channel) => channel.startsWith('rbac:'))).toHaveLength(16)
  })
})
