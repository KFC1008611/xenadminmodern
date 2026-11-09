import '../../../tests/visual/frontend-theme'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { VdiCreateDialog } from '../../../src/renderer/src/components/vdi/VdiCreateDialog'
import { VdiMoveDialog } from '../../../src/renderer/src/components/vdi/VdiMoveDialog'
import { ToastContext } from '../../../src/renderer/src/components/toast/ToastProvider'
import { useConnectionManagerStore } from '../../../src/renderer/src/store/connectionManager.store'
import { useThemeStore } from '../../../src/renderer/src/store/theme.store'
const query = new URLSearchParams(location.search)
const scenario = query.get('scenario') || 'create'
useThemeStore.getState().setTheme(query.get('theme') === 'dark' ? 'dark' : 'light')
const GIB = 1024 ** 3
const sr = (ref, type = 'nfs', content_type = 'user') => ({ref, uuid: ref, name_label: ref, type, content_type, physical_size: 100 * GIB, physical_utilisation: 20 * GIB})
let reads = 0
window.xapi.storage.listSrs = async () => {
  if (scenario === 'move-read' && ++reads === 1) throw new Error('存储清单读取超时')
  return [sr('source'), sr('安装镜像库', 'iso'), sr('ISO 内容库', 'nfs', 'iso'), sr('target')]
}
window.xapi.storage.createForVm = async () => {
  if (scenario === 'partial') throw Object.assign(new Error('磁盘已创建，连接失败。已保留 VDI OpaqueRef:created。'), {code: 'VDI_CREATED_ATTACH_INCOMPLETE', details: {outcome:'partial'}})
  if (scenario === 'create-reconnect') {
    useConnectionManagerStore.setState(state => ({connections: state.connections.map(connection => connection.id === 'prod' ? {...connection, epoch: (connection.epoch || 0) + 1} : connection)}))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return {vdiRef:'created', vbdRef:'vbd', plugged:false}
}
window.xapi.storage.moveVdi = async () => { throw Object.assign(new Error('服务器任务读取超时：OpaqueRef:move-task'), {code:'TASK_OUTCOME_UNKNOWN'}) }
const refresh = async () => { if (scenario === 'create-refresh') throw new Error('磁盘列表读取超时') }
const close = () => createRoot // Caller close is deliberately inert for screenshot review.
const props = {open: true, connectionId: 'prod', onClose: close}
createRoot(document.getElementById('disk-root')!).render(<ToastContext.Provider value={{addToast: () => {}}}>
  {scenario.startsWith('move') ? <VdiMoveDialog {...props} vdi={{ref:'disk', uuid:'disk-uuid', name_label:'数据盘', SR:'source', virtual_size:GIB} as any} onMoved={refresh} /> : <VdiCreateDialog {...props} vmRef="vm-0" onCreated={refresh} />}
</ToastContext.Provider>)
