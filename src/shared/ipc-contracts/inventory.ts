import { createIpcContractInventory } from '../ipc-contract'
import { connectionSessionContracts } from './connection'
import { haGovernanceContracts } from './ha-governance'
import { hostGovernanceInvokeContracts } from './host-governance'
import { infrastructureContracts } from './infrastructure'
import { networkContracts } from './network'
import { observabilityContracts } from './observability'
import { patchGovernanceContracts } from './patch-governance'
import { rbacGovernanceContracts } from './rbac-governance'
import { storageContracts } from './storage'
import { vmAdvancedContracts } from './vm-advanced'
import { vmContracts } from './vm'

export const ipcContractInventory = createIpcContractInventory({
  contracts: [
    ...connectionSessionContracts,
    ...hostGovernanceInvokeContracts,
    ...vmContracts,
    ...storageContracts,
    ...networkContracts,
    ...infrastructureContracts,
    ...observabilityContracts,
    ...haGovernanceContracts,
    ...patchGovernanceContracts,
    ...rbacGovernanceContracts,
    ...vmAdvancedContracts,
  ],
})
