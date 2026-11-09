/**
 * RBAC (Role-Based Access Control) IPC handlers.
 * v9: New handlers for RBAC user permission management.
 */
import { handleContract } from './utils'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
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
} from '../../../shared/ipc-contracts/rbac-governance'
import {
  getAllRoles,
  getRoleRecord,
  getRolePermissions,
  getAllSubjects,
  getSubjectRecord,
  getSubjectsWithRoles,
  addSubject,
  removeSubject,
  addSubjectRole,
  removeSubjectRole,
  getAllUsers,
  getUserInfo,
  getExternalAuthConfig,
  joinDomain,
  leaveDomain,
  getCurrentSessionPermissions,
} from '../../xapi/services/rbac.service'

export function registerRbacHandlers(): void {
  // Role management
  handleContract(rbacRoleListContract, getAllRoles)
  handleContract(rbacRoleGetContract, getRoleRecord)
  handleContract(rbacRolePermissionsContract, getRolePermissions)

  // Subject management
  handleContract(rbacSubjectListContract, getAllSubjects)
  handleContract(rbacSubjectGetContract, getSubjectRecord)
  handleContract(rbacSubjectWithRolesContract, getSubjectsWithRoles)

  handleContract(rbacSubjectAddContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('rbac.subject-create')
    return addSubject(connectionId, params)
  })

  handleContract(rbacSubjectRemoveContract, (connectionId, subjectRef) => {
    assertAuditedFeatureAvailable('rbac.management')
    return removeSubject(connectionId, subjectRef)
  })

  handleContract(rbacSubjectAddRoleContract, (connectionId, subjectRef, roleRef) => {
    assertAuditedFeatureAvailable('rbac.management')
    return addSubjectRole(connectionId, subjectRef, roleRef)
  })

  handleContract(rbacSubjectRemoveRoleContract, (connectionId, subjectRef, roleRef) => {
    assertAuditedFeatureAvailable('rbac.management')
    return removeSubjectRole(connectionId, subjectRef, roleRef)
  })

  // User information
  handleContract(rbacUserListContract, getAllUsers)
  handleContract(rbacUserGetContract, getUserInfo)

  // External authentication
  handleContract(rbacExtAuthConfigContract, getExternalAuthConfig)

  handleContract(rbacJoinDomainContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('rbac.external-auth')
    return joinDomain(connectionId, params)
  })

  handleContract(rbacLeaveDomainContract, (connectionId) => {
    assertAuditedFeatureAvailable('rbac.external-auth')
    return leaveDomain(connectionId)
  })

  // Session permissions
  handleContract(rbacSessionPermissionsContract, getCurrentSessionPermissions)
}
