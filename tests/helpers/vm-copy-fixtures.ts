import type { VmCopyOperation, VmCopyPlan } from '../../src/shared/types/xapi'
export const copyOperation: VmCopyOperation = {
  id: 'copy-1', sourceConnectionId: 'pool-1', targetConnectionId: 'pool-1', sourcePoolName: 'Pool 1', targetPoolName: 'Pool 1',
  sourcePoolUuid: 'pool-uuid-1', targetPoolUuid: 'pool-uuid-1',
  sourceVmRef: 'OpaqueRef:vm', name: 'copy', isTemplate: false, mode: 'clone', status: 'preparing', progress: 0,
  message: '正在提交复制任务', warnings: [], cancellable: false, createdAt: 1,
}
export const copyPlan: VmCopyPlan = {
  sourceConnectionId: 'pool-1', targetConnectionId: 'pool-1', vmRef: 'OpaqueRef:vm', sourceUuid: 'source-uuid', isTemplate: false,
  powerState: 'Halted', allowedModes: ['clone', 'copy'], blockers: [], warnings: [], disks: [], vifs: [],
  hosts: [{ ref: 'OpaqueRef:host', name: 'Host' }],
  srs: [{ ref: 'OpaqueRef:sr', name: 'Storage', freeBytes: 1024, hostRefs: ['OpaqueRef:host'] }],
  networks: [{ ref: 'OpaqueRef:net', name: 'Network', hostRefs: ['OpaqueRef:host'], transferHostRefs: ['OpaqueRef:host'] }],
}
