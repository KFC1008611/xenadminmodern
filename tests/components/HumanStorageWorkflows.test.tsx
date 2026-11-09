import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StoragePage from '../../src/renderer/src/pages/StoragePage'
import { ToastContext } from '../../src/renderer/src/components/toast/ToastProvider'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useStorageAdvancedStore } from '../../src/renderer/src/store/storage-advanced.store'
import { useSrWizardStore } from '../../src/renderer/src/store/srWizard.store'

const initialStorage = useStorageAdvancedStore.getState()
const listVdis = vi.fn()
const listSrs = vi.fn()
const updateIdentity = vi.fn()
const rename = vi.fn()
const create = vi.fn()
const scan = vi.fn()
const probeNfs = vi.fn()
const setDefault = vi.fn()
const isoList = vi.fn()
const pbdList = vi.fn()
const disk = (name = 'Data disk') => ({ ref: 'OpaqueRef:disk', uuid: 'disk-id', name_label: name, virtual_size: 1024, physical_utilisation: 512, type: 'user', read_only: false, SR: 'OpaqueRef:sr', VBDs: ['OpaqueRef:vbd'] })
const repository = (connectionId = 'a') => ({ connectionId, ref: 'OpaqueRef:sr', uuid: `sr-${connectionId}`, name_description: 'Current description', name_label: `Storage ${connectionId.toUpperCase()}`, type: 'nfs', shared: true, physical_size: 4096, physical_utilisation: 1024, VDIs: ['OpaqueRef:disk'], PBDs: [], poolName: `Pool ${connectionId.toUpperCase()}` })

function HistoryControls() {
  const navigate = useNavigate()
  const location = useLocation()
  return <><p data-testid="current-location">{location.pathname}{location.search}</p><button onClick={() => navigate(-1)}>测试历史返回</button></>
}
function Destination() { const location = useLocation(); return <p data-testid="destination">{location.pathname}{location.search}</p> }
function show(path = '/pool/a/storage') {
  return render(<ToastContext.Provider value={{ addToast: vi.fn() }}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <HistoryControls />
    <Routes>
      <Route path="/storage" element={<StoragePage />} />
      <Route path="/pool/:connectionId/storage" element={<StoragePage />} />
      <Route path="/pool/:connectionId/vms/:ref" element={<Destination />} />
      <Route path="/pool/:connectionId/hosts/:ref" element={<Destination />} />
    </Routes>
  </MemoryRouter></ToastContext.Provider>)
}
async function openDisk() {
  fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 Storage A' }))
  return await screen.findByRole('article', { name: '虚拟磁盘 Data disk' })
}
function next() { fireEvent.click(screen.getByRole('button', { name: '下一步' })) }
function startNfs() {
  fireEvent.click(screen.getByRole('button', { name: '新建存储' }))
  fireEvent.click(screen.getByRole('button', { name: 'NFS', exact: true }))
  next()
  fireEvent.change(screen.getByLabelText(/NFS 服务器地址/), { target: { value: 'nfs.test' } })
}

beforeEach(() => {
  vi.resetAllMocks()
  listVdis.mockResolvedValue([disk()])
  listSrs.mockResolvedValue([repository()])
  updateIdentity.mockResolvedValue({ nameLabel: 'Renamed storage', nameDescription: 'New purpose' })
  rename.mockResolvedValue(undefined)
  scan.mockResolvedValue(undefined)
  probeNfs.mockResolvedValue([])
  isoList.mockResolvedValue([])
  pbdList.mockResolvedValue([])
  setDefault.mockResolvedValue(undefined)
  window.xapi = { storage: { listVdis, listSrs, setVdiNameLabel: rename }, sr: { create, scan, probeNfs, setDefault, updateIdentity }, pbd: { list: pbdList }, iso: { list: isoList } } as any
  useConnectionManagerStore.setState({ connections: ['a', 'b'].map((id) => ({ id, state: 'connected', poolName: `Pool ${id.toUpperCase()}`, name: `Endpoint ${id}` })) as any })
  useMultiDataStore.setState({ srs: [repository(), repository('b')] as any, domainStates: {},
    hosts: ['a', 'b'].map((id) => ({ connectionId: id, ref: `OpaqueRef:host-${id}`, name_label: `Host ${id.toUpperCase()}` })) as any,
    pools: [{ connectionId: 'a', ref: 'OpaqueRef:pool', default_SR: 'OpaqueRef:other' }] as any,
    vms: [{ connectionId: 'a', ref: 'OpaqueRef:vm', name_label: 'Application VM', VBDs: ['OpaqueRef:vbd'] }, { connectionId: 'b', ref: 'OpaqueRef:vm', name_label: 'Other pool VM', VBDs: ['OpaqueRef:vbd'] }] as any,
    refreshSrs: vi.fn().mockResolvedValue(undefined), refreshHosts: vi.fn().mockResolvedValue(undefined), refreshConnection: vi.fn().mockResolvedValue(undefined),
  })
  useStorageAdvancedStore.setState({ ...initialStorage, pbdStates: {}, isoStates: {}, thinStats: {} })
  useSrWizardStore.getState().reset()
})

describe('human storage tasks', () => {
  it('creates NFS storage from the unified page after choosing a pool and recovering from discovery failure', async () => {
    probeNfs.mockRejectedValueOnce(new Error('export access denied')).mockResolvedValueOnce([{ server: 'nfs.test', path: '/vm-data' }])
    create.mockImplementation(async () => {
      useMultiDataStore.setState((state) => ({ srs: [...state.srs, { ...repository('b'), ref: 'OpaqueRef:new', name_label: 'Project disks' } as any] }))
      return 'OpaqueRef:new'
    })
    show('/storage')
    expect(screen.getByRole('button', { name: '新建存储' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: '新建存储的目标资源池' }), { target: { value: 'b' } })
    startNfs()
    next()
    fireEvent.click(screen.getByRole('button', { name: '扫描存储目标' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('export access denied')
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '扫描存储目标' }))
    fireEvent.click(await screen.findByRole('button', { name: '/vm-data nfs.test' }))
    next()
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'Project disks' } })
    next()
    expect(screen.getByText('目标资源池：Pool B')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '接入主机' })).toHaveValue('OpaqueRef:host-b')
    fireEvent.click(screen.getByRole('button', { name: '创建存储仓库' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(create).toHaveBeenCalledWith('b', 'OpaqueRef:host-b', expect.objectContaining({ type: 'nfs', nfsServer: 'nfs.test', nfsPath: '/vm-data', nameLabel: 'Project disks' }))
    expect(probeNfs).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByRole('button', { name: '查看存储仓库 Project disks' })).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.getByTestId('current-location')).toHaveTextContent('/pool/b/storage?sr=OpaqueRef%3Anew')
  })

  it('distinguishes an empty scan from not scanned and lets the user enter a known export path', async () => {
    show()
    startNfs()
    next()
    fireEvent.click(screen.getByRole('button', { name: '扫描存储目标' }))
    expect(await screen.findByText(/扫描完成，未发现可用目标/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    fireEvent.change(screen.getByLabelText('共享目录（可在下一步发现）'), { target: { value: '/known-export' } })
    next()
    expect(screen.getByText('当前共享目录：/known-export')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()
  })

  it('explains an invalid iSCSI port before allowing the next step', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: '新建存储' }))
    fireEvent.click(screen.getByRole('button', { name: 'iSCSI', exact: true }))
    next()
    fireEvent.change(screen.getByLabelText(/iSCSI 目标地址/), { target: { value: 'iscsi.test' } })
    fireEvent.change(screen.getByLabelText('iSCSI 端口'), { target: { value: '70000' } })
    expect(screen.getByText('端口必须是 1–65535 的整数。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('iSCSI 端口'), { target: { value: '3261' } })
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()
  })

  it('opens a deep linked repository and follows its disk to the correct pool VM storage page', async () => {
    show('/pool/a/storage?sr=OpaqueRef%3Asr')
    const card = await screen.findByRole('article', { name: '虚拟磁盘 Data disk' })
    expect(within(card).queryByText('Other pool VM')).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('link', { name: 'Application VM' }))
    expect(screen.getByTestId('destination')).toHaveTextContent('/pool/a/vms/OpaqueRef%3Avm?tab=storage')
  })

  it('saves a disk name and updates the visible card only after reading the server result', async () => {
    show()
    await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '重命名虚拟磁盘 Data disk' }))
    fireEvent.change(screen.getByRole('textbox', { name: '虚拟磁盘名称' }), { target: { value: 'Database data' } })
    listVdis.mockResolvedValue([disk('Database data')])
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    expect(await screen.findByRole('article', { name: '虚拟磁盘 Database data' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(rename).toHaveBeenCalledWith('a', 'OpaqueRef:disk', 'Database data')
    expect(screen.getByRole('status')).toHaveTextContent('虚拟磁盘名称已保存为“Database data”')
  })

  it('returns a successful rename after a lost response without user reconciliation', async () => {
    rename.mockRejectedValueOnce(new Error('response lost'))
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '重命名虚拟磁盘 Data disk' }))
    fireEvent.change(screen.getByRole('textbox', { name: '虚拟磁盘名称' }), { target: { value: 'Saved remotely' } })
    listVdis.mockResolvedValue([disk('Saved remotely')])
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(rename).toHaveBeenCalledOnce()
    expect(screen.getByRole('article', { name: '虚拟磁盘 Saved remotely' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('虚拟磁盘名称已保存')
  })

  it('automatically recovers a successful rename after a transient read failure', async () => {
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '重命名虚拟磁盘 Data disk' }))
    fireEvent.change(screen.getByRole('textbox', { name: '虚拟磁盘名称' }), { target: { value: 'New label' } })
    listVdis.mockRejectedValueOnce(new Error('readback unavailable')).mockResolvedValue([disk('New label')])
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 2000 })
    expect(rename).toHaveBeenCalledOnce()
    expect(screen.getByRole('article', { name: '虚拟磁盘 New label' })).toBeInTheDocument()
  })

  it('prevents a rename draft from submitting after its management connection disconnects', async () => {
    show()
    await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '重命名虚拟磁盘 Data disk' }))
    fireEvent.change(screen.getByRole('textbox', { name: '虚拟磁盘名称' }), { target: { value: 'Never submitted' } })
    act(() => useConnectionManagerStore.setState({ connections: [{ id: 'a', state: 'disconnected' }] as any }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('管理连接未连接')
    expect(rename).not.toHaveBeenCalled()
  })

  it('opens the named host from an SR connection instead of requiring the user to decode a PBD reference', async () => {
    pbdList.mockResolvedValue([{ connectionId: 'a', ref: 'OpaqueRef:pbd', uuid: 'pbd-id', host: 'OpaqueRef:host-a', SR: 'OpaqueRef:sr', currently_attached: true }])
    show()
    await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '主机接入' }))
    fireEvent.click(await screen.findByRole('link', { name: 'Host A' }))
    expect(screen.getByTestId('destination')).toHaveTextContent('/pool/a/hosts/OpaqueRef%3Ahost-a')
  })

  it('scans newly added ISO media from inside the ISO library and displays the refreshed result', async () => {
    useMultiDataStore.setState({ srs: [{ ...repository(), type: 'iso' }] as any })
    isoList.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...disk('installer.iso'), VBDs: [] }])
    show()
    fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 Storage A' }))
    fireEvent.click(await screen.findByRole('button', { name: '扫描 ISO 仓库' }))
    expect(await screen.findByText('installer.iso')).toBeInTheDocument()
    expect(scan).toHaveBeenCalledWith('a', 'OpaqueRef:sr')
    expect(screen.getByRole('status')).toHaveTextContent('仓库扫描已完成')
  })

  it('keeps scan completion visible when refreshing ISO metadata fails', async () => {
    useMultiDataStore.setState({ srs: [{ ...repository(), type: 'iso' }] as any })
    isoList.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('cannot read ISO metadata'))
    show()
    fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 Storage A' }))
    fireEvent.click(await screen.findByRole('button', { name: '扫描 ISO 仓库' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot read ISO metadata')
    expect(screen.getByRole('status')).toHaveTextContent('仓库扫描已完成')
    expect(screen.queryByText(/^扫描失败/)).not.toBeInTheDocument()
  })

  it('reports the selected SR after setting the pool default', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已将“Storage A”设为该资源池的默认存储仓库')
    expect(setDefault).toHaveBeenCalledWith('a', 'OpaqueRef:pool', 'OpaqueRef:sr')
  })
})


describe('storage identity and reading recovery tasks', () => {
  it('edits SR name and description from its detail and shows the verified identity throughout the page', async () => {
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '编辑仓库信息' }))
    fireEvent.change(screen.getByRole('textbox', { name: '存储仓库名称' }), { target: { value: 'Renamed storage' } })
    fireEvent.change(screen.getByRole('textbox', { name: '存储仓库描述' }), { target: { value: 'New purpose' } })
    fireEvent.click(screen.getByRole('button', { name: '保存仓库信息' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateIdentity).toHaveBeenCalledWith('a', 'OpaqueRef:sr', { nameLabel: 'Renamed storage', nameDescription: 'New purpose', expectedNameLabel: 'Storage A', expectedNameDescription: 'Current description' })
    expect(screen.getByRole('button', { name: '查看存储仓库 Renamed storage' })).toBeInTheDocument()
    expect(screen.getByText('New purpose')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('存储仓库名称和描述已保存')
  })

  it('finishes an applied SR identity after a lost response without asking the user to reread', async () => {
    updateIdentity.mockRejectedValueOnce(new Error('response lost'))
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '编辑仓库信息' }))
    fireEvent.change(screen.getByRole('textbox', { name: '存储仓库名称' }), { target: { value: 'Saved storage' } })
    listSrs.mockResolvedValue([{ ...repository(), name_label: 'Saved storage' }])
    fireEvent.click(screen.getByRole('button', { name: '保存仓库信息' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateIdentity).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '查看存储仓库 Saved storage' })).toBeInTheDocument()
  })

  it('allows an initial VM relation read failure to recover with a scoped reload', async () => {
    useMultiDataStore.setState({ vms: [], domainStates: { a: { vms: { error: 'VM access denied', loading: false, lastSuccessAt: null } } } })
    const refresh = useMultiDataStore.getState().refreshConnection as ReturnType<typeof vi.fn>
    show(); await openDisk()
    expect(screen.getByRole('alert')).toHaveTextContent('VM access denied')
    refresh.mockImplementationOnce(async () => { useMultiDataStore.setState({ vms: [{ connectionId: 'a', ref: 'OpaqueRef:vm', name_label: 'Recovered VM', VBDs: ['OpaqueRef:vbd'] }] as any, domainStates: {} }) })
    fireEvent.click(screen.getByRole('button', { name: '重新读取关联虚拟机' }))
    expect(await screen.findByRole('link', { name: 'Recovered VM' })).toHaveAttribute('href', '/pool/a/vms/OpaqueRef%3Avm?tab=storage')
    expect(refresh).toHaveBeenLastCalledWith('a')
  })

  it('does not start a competing VDI read during editing and preserves the confirmed name after delayed save', async () => {
    let completeRead!: (value: ReturnType<typeof disk>[]) => void
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '重命名虚拟磁盘 Data disk' }))
    fireEvent.change(screen.getByRole('textbox', { name: '虚拟磁盘名称' }), { target: { value: 'Confirmed name' } })
    listVdis.mockImplementationOnce(() => new Promise((resolve) => { completeRead = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(listVdis).toHaveBeenCalledTimes(2))
    act(() => useMultiDataStore.setState({ srs: [{ ...repository(), VDIs: ['OpaqueRef:disk', 'OpaqueRef:other'] }] as any }))
    expect(listVdis).toHaveBeenCalledTimes(2)
    listVdis.mockResolvedValue([disk('Confirmed name')])
    await act(async () => { completeRead([disk('Confirmed name')]) })
    expect(await screen.findByRole('article', { name: '虚拟磁盘 Confirmed name' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: '虚拟磁盘 Data disk' })).not.toBeInTheDocument()
  })
})


describe('SR edit connection lifetime', () => {
  const reconnect = () => {
    useConnectionManagerStore.setState({ connections: [{ id: 'a', state: 'connected', poolName: 'Reconnected pool', epoch: 2 }] as any })
    useMultiDataStore.setState({ srs: [{ ...repository(), name_label: 'Current lifetime SR', name_description: 'Current description' }] as any })
  }
  it('ignores a save reply from an editor unmounted by reconnect', async () => {
    let finish!: (value: unknown) => void
    updateIdentity.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '编辑仓库信息' }))
    fireEvent.change(screen.getByRole('textbox', { name: '存储仓库名称' }), { target: { value: 'Obsolete save' } })
    fireEvent.click(screen.getByRole('button', { name: '保存仓库信息' }))
    await act(async () => { reconnect() })
    await act(async () => { finish({ nameLabel: 'Obsolete save', nameDescription: '' }) })
    expect(screen.getByRole('button', { name: '查看存储仓库 Current lifetime SR' })).toBeInTheDocument()
    expect(useMultiDataStore.getState().srs[0].name_label).toBe('Current lifetime SR')
  })
  it('ignores a reconcile read from an editor unmounted by reconnect', async () => {
    let finish!: (value: unknown) => void
    updateIdentity.mockRejectedValueOnce(new Error('response lost'))
    show(); await openDisk()
    fireEvent.click(screen.getByRole('button', { name: '编辑仓库信息' }))
    fireEvent.change(screen.getByRole('textbox', { name: '存储仓库名称' }), { target: { value: 'Obsolete read' } })
    listSrs.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '保存仓库信息' }))
    await waitFor(() => expect(listSrs).toHaveBeenCalledOnce())
    await act(async () => { reconnect() })
    await act(async () => { finish([{ ...repository(), name_label: 'Obsolete read' }]) })
    expect(screen.getByRole('button', { name: '查看存储仓库 Current lifetime SR' })).toBeInTheDocument()
    expect(useMultiDataStore.getState().srs[0].name_label).toBe('Current lifetime SR')
  })
})


it('keeps SR selection and closure in the URL so history restores the correct details', async () => {
  useMultiDataStore.setState({ srs: [repository(), { ...repository(), ref: 'OpaqueRef:second', name_label: 'Second storage' }] as any })
  show('/pool/a/storage?sr=OpaqueRef%3Asr')
  await screen.findByRole('article', { name: '虚拟磁盘 Data disk' })
  fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 Second storage' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '查看存储仓库 Second storage' })).toHaveAttribute('aria-expanded', 'true'))
  expect(screen.getByTestId('current-location')).toHaveTextContent('/pool/a/storage?sr=OpaqueRef%3Asecond')
  fireEvent.click(screen.getByRole('button', { name: '关闭存储仓库详情' }))
  expect(screen.queryByRole('button', { name: '关闭存储仓库详情' })).not.toBeInTheDocument()
  expect(screen.getByTestId('current-location').textContent).toBe('/pool/a/storage')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '测试历史返回' })) })
  expect(screen.getByRole('button', { name: '查看存储仓库 Second storage' })).toHaveAttribute('aria-expanded', 'true')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '测试历史返回' })) })
  expect(screen.getByRole('button', { name: '查看存储仓库 Storage A' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('current-location')).toHaveTextContent('/pool/a/storage?sr=OpaqueRef%3Asr')
})
