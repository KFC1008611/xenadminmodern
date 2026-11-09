import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VmImportDialog } from '../../src/renderer/src/components/vm/VmImportDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useImportWizardStore } from '../../src/renderer/src/store/importWizard.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

function readyState() {
  useImportWizardStore.getState().reset()
  useImportWizardStore.setState({
    currentStep: 4,
    filePath: '/tmp/import.xva',
    preview: {
      vmName: 'Imported VM', originalSize: 1024, diskCount: 1, exportTime: '', vifs: [{ device: '0', sourceNetworkName: 'Source' }],
      isTemplate: false, vcpus: 2, memory: 1024, isHvm: true, description: '',
    },
    targetSrRef: 'OpaqueRef:sr', homeServerRef: '',
    vifMappings: { '0': 'OpaqueRef:network' },
    importing: false, progress: 0, importError: null, operationId: null,
    operationStatus: null, operationMessage: '', vmRef: undefined, warnings: [],
  })
}

describe('VmImportDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    readyState()
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', name: 'Pool', poolName: 'Pool' }] as any })
    useMultiDataStore.setState({
      hosts: [{ ref: 'OpaqueRef:host', name_label: 'Host A', connectionId: 'conn-1' }],
      srs: [{ ref: 'OpaqueRef:sr', name_label: 'SR', type: 'ext', shared: true, connectionId: 'conn-1' }],
      networks: [{ ref: 'OpaqueRef:network', name_label: 'Guest', connectionId: 'conn-1' }],
      refreshVms: vi.fn().mockResolvedValue(undefined), refreshTasks: vi.fn().mockResolvedValue(undefined),
    } as any)
    window.xapi = {
      vm: {
        creationResources: vi.fn().mockResolvedValue({ hosts: [{ ref: 'OpaqueRef:host', name: 'Host A', enabled: true }], srs: [{ ref: 'OpaqueRef:sr', name: 'SR', freeBytes: 1e12, hostRefs: ['OpaqueRef:host'] }], networks: [{ ref: 'OpaqueRef:network', name: 'Guest', hostRefs: ['OpaqueRef:host'] }] }),
        import: vi.fn().mockResolvedValue('operation-1'),
        importProgress: vi.fn(),
        cancelImport: vi.fn(),
        importGetPreview: vi.fn(),
      },
      dialog: { showOpenDialog: vi.fn() },
      tasks: { list: vi.fn() },
    } as any
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    act(() => useImportWizardStore.getState().reset())
  })

  it('advertises and selects XVA files only', async () => {
    useImportWizardStore.getState().reset()
    vi.mocked(window.xapi.dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)

    fireEvent.click(screen.getByText('点击选择 XVA 文件'))
    await act(async () => { await Promise.resolve() })
    expect(window.xapi.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ name: 'XVA 虚拟机归档', extensions: ['xva'] }],
    }))
    expect(screen.getByText('仅支持未压缩的 .xva 格式')).toBeInTheDocument()
  })

  it('preserves template identity and lets the user choose a home server', async () => {
    useImportWizardStore.setState({
      currentStep: 2,
      preview: { ...useImportWizardStore.getState().preview!, vmName: 'Archived Template', isTemplate: true },
    })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)

    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('归档中的模板名称：Archived Template')).toBeInTheDocument()
    expect(screen.queryByText('导入为模板')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Home Server'), { target: { value: 'OpaqueRef:host' } })
    expect(useImportWizardStore.getState().homeServerRef).toBe('OpaqueRef:host')
  })

  it('uses operation progress and succeeds only after configuration completes', async () => {
    vi.mocked(window.xapi.vm.importProgress)
      .mockResolvedValueOnce({ operationId: 'operation-1', taskRef: 'OpaqueRef:task', status: 'configuring', progress: 97, message: '正在应用导入配置', vmRef: 'OpaqueRef:vm', lastUpdatedAt: 1 })
      .mockResolvedValueOnce({ operationId: 'operation-1', taskRef: 'OpaqueRef:task', status: 'completed', progress: 100, message: '导入完成', vmRef: 'OpaqueRef:vm', lastUpdatedAt: 2 })
    const onImported = vi.fn()
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" onImported={onImported} />)

    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByText('开始导入'))
    await act(async () => { await Promise.resolve() })
    expect(window.xapi.vm.import).toHaveBeenCalledWith('conn-1', {
      filePath: '/tmp/import.xva', srRef: 'OpaqueRef:sr', homeServerRef: null,
      vifMappings: { '0': 'OpaqueRef:network' },
    })
    expect(screen.getByText('正在应用导入配置')).toBeInTheDocument()
    expect(window.xapi.tasks.list).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText('导入成功')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledOnce()
    expect(useMultiDataStore.getState().refreshVms).toHaveBeenCalled()
  })

  it('shows local scan bytes and elapsed time, keeps cancellation available, then switches to upload progress', async () => {
    const operation = { operationId: 'operation-1', taskRef: 'OpaqueRef:task', status: 'validating' as const, progress: 0, message: '正在校验 XVA，完成后开始上传', validation: { bytesChecked: 1024 ** 3, bytesTotal: 4 * 1024 ** 3, elapsedMs: 65000 }, lastUpdatedAt: 1 }
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue(operation)
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByText('开始导入'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('progressbar', { name: 'XVA 校验进度' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('已检查 1 GB / 4 GB · 已用 1 分 5 秒')).toBeInTheDocument()
    fireEvent.click(screen.getByText('取消导入'))
    expect(window.xapi.vm.cancelImport).toHaveBeenCalledWith('conn-1', 'operation-1')
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue({ ...operation, status: 'uploading', progress: 7, message: '正在上传 XVA' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('progressbar', { name: '导入进度' })).toHaveAttribute('aria-valuenow', '7')
    expect(screen.queryByText(/已检查/)).not.toBeInTheDocument()
  })

  it('shows upload volume and average speed, then displays only server progress during server processing', async () => {
    const operation = { operationId: 'operation-1', taskRef: 'OpaqueRef:task', status: 'uploading' as const, progress: 50, message: '正在上传 XVA', transfer: { bytesTransferred: 512 * 1024 ** 2, bytesTotal: 1024 ** 3, elapsedMs: 4000 }, lastUpdatedAt: 1 }
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue(operation)
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByText('开始导入'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('progressbar', { name: '导入进度' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('已上传 512 MB / 1 GB · 已用 4 秒')).toBeInTheDocument()
    expect(screen.getByText('平均速度 128 MB/s')).toBeInTheDocument()
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue({ ...operation, status: 'waiting_for_task', progress: 37, message: '等待服务器完成导入' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('progressbar', { name: '导入进度' })).toHaveAttribute('aria-valuenow', '37')
    expect(screen.getByText('等待服务器完成导入（服务器进度）')).toBeInTheDocument()
    expect(screen.queryByText(/平均速度/)).not.toBeInTheDocument()
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue({ ...operation, status: 'configuring', progress: 97, message: '正在核对配置' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('progressbar', { name: '导入进度' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText('97%')).not.toBeInTheDocument()
  })

  it('shows a recoverable VM reference when post-configuration fails', async () => {
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue({
      operationId: 'operation-1', taskRef: 'OpaqueRef:task', status: 'failed', progress: 97,
      message: 'VIF.move 不可用', vmRef: 'OpaqueRef:imported-vm', errorCode: 'MESSAGE_METHOD_UNKNOWN', lastUpdatedAt: 1,
    })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)

    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByText('开始导入'))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getAllByText('VIF.move 不可用')).toHaveLength(1)
    expect(screen.getByText(/OpaqueRef:imported-vm/)).toBeInTheDocument()
  })
  it('preserves confirmed completion when refreshing the resource list fails', async () => {
    useMultiDataStore.setState({ refreshVms: vi.fn().mockRejectedValue(new Error('refresh failed')) })
    vi.mocked(window.xapi.vm.importProgress).mockResolvedValue({ operationId: 'operation-1', taskRef: 'OpaqueRef:task', status: 'completed', progress: 100, message: '导入完成', lastUpdatedAt: 1 })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByText('开始导入'))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(useImportWizardStore.getState().operationStatus).toBe('completed')
    expect(screen.getByText('导入成功')).toBeInTheDocument()
    expect(screen.queryByText(/结果待核对/)).not.toBeInTheDocument()
  })

  it('does not start a second import while the first acceptance response is pending', async () => {
    let finish!: (value: string) => void
    vi.mocked(window.xapi.vm.import).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = useImportWizardStore.getState().startImport('conn-1')
    await expect(useImportWizardStore.getState().startImport('conn-1')).resolves.toBeNull()
    expect(window.xapi.vm.import).toHaveBeenCalledOnce()
    finish('operation-1')
    await first
  })

  it('shows native file dialog failures in the import form', async () => {
    useImportWizardStore.getState().reset()
    vi.mocked(window.xapi.dialog.showOpenDialog).mockRejectedValueOnce(new Error('dialog failed'))
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    fireEvent.click(screen.getByText('点击选择 XVA 文件'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('选择文件失败：dialog failed')).toBeInTheDocument()
  })

})

describe('XVA import recovery and draft scope', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    readyState()
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', poolUuid: 'pool-1', epoch: 1 }] as any })
    window.xapi.vm.creationResources = vi.fn().mockResolvedValue({ hosts: [{ ref: 'OpaqueRef:host', name: 'Host' }], srs: [{ ref: 'OpaqueRef:sr', name: 'SR', freeBytes: 1e12, hostRefs: ['OpaqueRef:host'] }], networks: [{ ref: 'OpaqueRef:network', name: 'Guest', hostRefs: ['OpaqueRef:host'] }] })
  })
  afterEach(() => { cleanup(); vi.useRealTimers(); act(() => useImportWizardStore.getState().reset()) })
  it('lets an accepted import run after the dialog closes', async () => {
    useImportWizardStore.setState({ operationId: 'op', operationConnectionId: 'conn-1', importing: true, operationStatus: 'uploading' })
    window.xapi.vm.importProgress = vi.fn().mockResolvedValue({ operationId: 'op', taskRef: 'OpaqueRef:task', status: 'uploading', progress: 40, message: '上传中', lastUpdatedAt: 1 })
    const close = vi.fn()
    render(<VmImportDialog open onClose={close} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }))
    expect(close).toHaveBeenCalledOnce()
    expect(useImportWizardStore.getState().operationId).toBe('op')
  })
  it('continues observing an unknown result and converges to completed', async () => {
    useImportWizardStore.setState({ operationId: 'op', operationConnectionId: 'conn-1', operationStatus: 'unknown' })
    window.xapi.vm.importProgress = vi.fn()
      .mockResolvedValueOnce({ operationId: 'op', taskRef: 'OpaqueRef:task', status: 'unknown', progress: 70, message: '暂时不可读', lastUpdatedAt: 1 })
      .mockResolvedValue({ operationId: 'op', taskRef: null, status: 'completed', progress: 100, message: '导入完成', lastUpdatedAt: 2 })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getAllByText(/暂时不可读/)).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.getByText('导入成功')).toBeInTheDocument()
  })
  it('refreshes the connection returned by the completed import after reconnect instead of the obsolete dialog connection', async () => {
    useImportWizardStore.setState({ operationId: 'op', operationConnectionId: 'conn-1', operationPoolUuid: 'pool-1', operationStatus: 'unknown' })
    useConnectionManagerStore.setState({ connections: [{ id: 'reconnected', poolUuid: 'pool-1', epoch: 2, state: 'connected' }] as any })
    const refreshVms = vi.fn().mockResolvedValue(undefined)
    const refreshTasks = vi.fn().mockResolvedValue(undefined)
    useMultiDataStore.setState({ refreshVms, refreshTasks })
    window.xapi.vm.importProgress = vi.fn().mockResolvedValue({ operationId: 'op', connectionId: 'reconnected', poolUuid: 'pool-1', taskRef: null, status: 'completed', progress: 100, message: '导入完成', lastUpdatedAt: 2 })
    const onImported = vi.fn()
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" onImported={onImported} />)
    await act(async () => { await Promise.resolve() })
    expect(refreshVms).toHaveBeenCalledOnce()
    expect(refreshVms).toHaveBeenCalledWith({ afterMutation: true, connectionId: 'reconnected' })
    expect(refreshTasks).toHaveBeenCalledOnce()
    expect(refreshTasks).toHaveBeenCalledWith({ afterMutation: true, connectionId: 'reconnected' })
    expect(onImported).toHaveBeenCalledOnce()
    expect(onImported).toHaveBeenCalledWith('reconnected')
    expect(useImportWizardStore.getState()).toMatchObject({ operationStatus: 'completed', operationConnectionId: 'reconnected' })
  })
  it('clears placement references on a new connection epoch', async () => {
    useImportWizardStore.setState({ draftScope: JSON.stringify({ connectionId: 'conn-1', poolUuid: 'pool-1', epoch: 0 }) })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    expect(useImportWizardStore.getState()).toMatchObject({ targetSrRef: '', homeServerRef: '', vifMappings: {}, currentStep: 2 })
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
  })
  it('disables submission if a successfully refreshed resource list no longer contains the selection', async () => {
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('开始导入')).toBeEnabled()
    vi.mocked(window.xapi.vm.creationResources).mockResolvedValue({ hosts: [], srs: [], networks: [], isos: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.getByText('开始导入')).toBeDisabled()
  })
  it('keeps an unknown operation in history while allowing a new draft', () => {
    const operation = { operationId: 'old', taskRef: 'OpaqueRef:task', status: 'unknown' as const, progress: 70, message: '结果待核对', lastUpdatedAt: 1 }
    useImportWizardStore.setState({ operationId: 'old', operationStatus: 'unknown', history: [{ connectionId: 'conn-1', name: 'VM', isTemplate: false, operation }] })
    useImportWizardStore.getState().newDraft()
    expect(useImportWizardStore.getState()).toMatchObject({ operationId: null, currentStep: 1, history: [expect.objectContaining({ operation })] })
    useImportWizardStore.getState().applyOperation({ ...operation, status: 'completed' })
    expect(useImportWizardStore.getState().operationId).toBeNull()
    expect(useImportWizardStore.getState().history[0].operation.status).toBe('completed')
  })
  it.each(['completed', 'failed', 'cancelled'] as const)('opens a fresh import after closing a %s operation while retaining its history', async (status) => {
    const operation = { operationId: 'old', taskRef: null, status, progress: 0, message: '旧结果', lastUpdatedAt: 1 }
    useImportWizardStore.setState({ operationId: operation.operationId, operationStatus: status, history: [{ connectionId: 'conn-1', name: 'VM', isTemplate: false, operation }] })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('点击选择 XVA 文件')).toBeInTheDocument()
    expect(useImportWizardStore.getState()).toMatchObject({ operationId: null, operationStatus: null, currentStep: 1, importing: false, history: [expect.objectContaining({ operation })] })
  })
  it('shows a confirmed missing local record without continuing progress reads or offering cancellation', async () => {
    useImportWizardStore.setState({ operationId: 'missing', operationConnectionId: 'conn-1', operationStatus: 'uploading' })
    window.xapi.vm.importProgress = vi.fn().mockResolvedValue(null)
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(window.xapi.vm.importProgress).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent('本地导入记录已不存在')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消导入' })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '新建导入' })); await Promise.resolve() })
    expect(useImportWizardStore.getState().operationId).toBeNull()
    expect(screen.getByText('点击选择 XVA 文件')).toBeInTheDocument()
  })
  it('explains preserved memory and suspended state on the confirmation page', async () => {
    useImportWizardStore.setState({ preview: { ...useImportWizardStore.getState().preview!, powerState: 'Suspended', suspendDiskSize: 4096 } })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(/包含内存镜像.*导入后保持挂起/)).toBeInTheDocument()
  })
  it('blocks an automatic placement with no host common to storage and all network mappings', async () => {
    vi.mocked(window.xapi.vm.creationResources).mockResolvedValue({
      hosts: [{ ref: 'OpaqueRef:host', name: 'Host A', enabled: true, memoryFree: 0, cpuCount: 1 }, { ref: 'OpaqueRef:host-b', name: 'Host B', enabled: true, memoryFree: 0, cpuCount: 1 }],
      srs: [{ ref: 'OpaqueRef:sr', name: 'SR', freeBytes: 1e12, shared: false, hostRefs: ['OpaqueRef:host'] }],
      networks: [{ ref: 'OpaqueRef:network', name: 'Guest', autoPlug: true, hostRefs: ['OpaqueRef:host-b'] }], isos: [],
    })
    render(<VmImportDialog open onClose={vi.fn()} connectionId="conn-1" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('开始导入')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('没有可用主机同时访问所选存储和全部网络')
  })
})
