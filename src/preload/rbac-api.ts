import {
  rbacExtAuthConfigContract,
  rbacJoinDomainContract,
  rbacLeaveDomainContract,
  rbacRoleGetContract,
  rbacRoleListContract,
  rbacRolePermissionsContract,
  rbacSessionPermissionsContract,
  rbacSubjectAddContract,
  rbacSubjectAddRoleContract,
  rbacSubjectGetContract,
  rbacSubjectListContract,
  rbacSubjectRemoveContract,
  rbacSubjectRemoveRoleContract,
  rbacSubjectWithRolesContract,
  rbacUserGetContract,
  rbacUserListContract,
} from '../shared/ipc-contracts/rbac-governance'
import {
  createIpcContractInvoker,
  type IpcInvokeTransport,
} from './ipc-contract-client'

export function createRbacApi(transport: IpcInvokeTransport) {
  return {
    rbac: {
      roleList: createIpcContractInvoker(rbacRoleListContract, transport),
      roleGet: createIpcContractInvoker(rbacRoleGetContract, transport),
      rolePermissions: createIpcContractInvoker(rbacRolePermissionsContract, transport),
      subjectList: createIpcContractInvoker(rbacSubjectListContract, transport),
      subjectGet: createIpcContractInvoker(rbacSubjectGetContract, transport),
      subjectWithRoles: createIpcContractInvoker(rbacSubjectWithRolesContract, transport),
      subjectAdd: createIpcContractInvoker(rbacSubjectAddContract, transport),
      subjectRemove: createIpcContractInvoker(rbacSubjectRemoveContract, transport),
      subjectAddRole: createIpcContractInvoker(rbacSubjectAddRoleContract, transport),
      subjectRemoveRole: createIpcContractInvoker(rbacSubjectRemoveRoleContract, transport),
      userList: createIpcContractInvoker(rbacUserListContract, transport),
      userGet: createIpcContractInvoker(rbacUserGetContract, transport),
      extAuthConfig: createIpcContractInvoker(rbacExtAuthConfigContract, transport),
      joinDomain: createIpcContractInvoker(rbacJoinDomainContract, transport),
      leaveDomain: createIpcContractInvoker(rbacLeaveDomainContract, transport),
      sessionPermissions: createIpcContractInvoker(
        rbacSessionPermissionsContract,
        transport,
      ),
    },
  }
}
