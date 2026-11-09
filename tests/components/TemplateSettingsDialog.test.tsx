import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TemplateSettingsDialog } from '../../src/renderer/src/components/template/TemplateSettingsDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { toIpcErrorResponse } from '../../src/main/ipc/ipc-error'
import { resultReadFailed } from '../../src/main/xapi/services/mutation-result'
import { ReadScopeChangedError } from '../../src/shared/read-operation-result'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => toast }))
vi.mock('../../src/renderer/src/store/feedback.store', () => ({ feedback: { warning: toast.warning } }))
const GIB = 1024 ** 3
const template = { ref: 'template', connectionId: 'pool', name_label: 'Original', name_description: '',
  VCPUs_max: 8, VCPUs_at_startup: 8, memory_static_min: GIB, memory_dynamic_min: GIB,
  memory_dynamic_max: 4 * GIB, memory_static_max: 4 * GIB, VBDs: [], VIFs: [] }
const updateSettings = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({ connections: [{ id: 'pool', state: 'connected', poolUuid: 'pool-uuid', epoch: 1 } as any] })
  Object.assign(window, { xapi: { template: { updateSettings }, storage: { listSrs: vi.fn().mockResolvedValue([]) } } })
  updateSettings.mockResolvedValue(undefined)
})

it('freezes the submitted fields and prevents closing while settings are saving', async () => {
  let resolve!: () => void
  updateSettings.mockReturnValue(new Promise<void>((done) => { resolve = done }))
  const onClose = vi.fn()
  render(<TemplateSettingsDialog open template={template} onClose={onClose} onSuccess={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '名称', exact: true }), { target: { value: 'Changed' } })
  fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
  expect(screen.getByRole('textbox', { name: '名称', exact: true })).toBeDisabled()
  expect(screen.getByLabelText('vCPU 最大值')).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { resolve() })
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(updateSettings).toHaveBeenCalledOnce()
})

it.each([new Error('网络中断'), new ReadScopeChangedError()])('keeps a result read failure visible and prevents resubmitting the stale form: %s', async (cause) => {
  updateSettings.mockRejectedValue(toIpcErrorResponse(resultReadFailed('模板设置', cause)))
  const onClose = vi.fn()
  render(<TemplateSettingsDialog open template={template} onClose={onClose} onSuccess={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '名称', exact: true }), { target: { value: 'Changed' } })
  fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent(`状态读取失败：${cause.message}`)
  expect(screen.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: '名称', exact: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消', exact: true })).toBeEnabled()
  expect(onClose).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
  expect(updateSettings).toHaveBeenCalledOnce()
})

it('does not turn a confirmed save into a failed save when the parent refresh fails', async () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn().mockRejectedValue(new Error('list read failed'))
  render(<TemplateSettingsDialog open template={template} onClose={onClose} onSuccess={onSuccess} />)
  fireEvent.change(screen.getByRole('textbox', { name: '名称', exact: true }), { target: { value: 'Changed' } })
  fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(toast.success).toHaveBeenCalledWith('模板设置已保存')
  expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('list read failed'))
  expect(toast.error).not.toHaveBeenCalled()
})

it('does not close or refresh a different template after the old save completes', async () => {
  let resolve!: () => void
  updateSettings.mockReturnValue(new Promise<void>((done) => { resolve = done }))
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const view = render(<TemplateSettingsDialog open template={template} onClose={onClose} onSuccess={onSuccess} />)
  fireEvent.change(screen.getByRole('textbox', { name: '名称', exact: true }), { target: { value: 'Changed' } })
  fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
  view.rerender(<TemplateSettingsDialog open template={{ ...template, ref: 'other-template', name_label: 'Other template' }} onClose={onClose} onSuccess={onSuccess} />)
  expect(screen.getByRole('textbox', { name: '名称', exact: true })).toHaveValue('Other template')
  await act(async () => { resolve() })
  expect(onClose).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})
