import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { OperationTasks } from '../../src/renderer/src/components/feedback/OperationTasks'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'

describe('operation feedback controls', () => {
  beforeEach(() => useFeedbackStore.setState({ toasts: [], progress: [], confirmDialog: null }))

  it('allows dismissing a failed operation after reading its error', () => {
    useFeedbackStore.getState().startProgress('failed-vm', '启动 VM A')
    useFeedbackStore.getState().failProgress('failed-vm', 'HOST_NOT_ENOUGH_FREE_MEMORY')
    render(<OperationTasks />)
    expect(screen.getByText('HOST_NOT_ENOUGH_FREE_MEMORY')).toBeInTheDocument()
    fireEvent.click(document.querySelector('summary')!)
    fireEvent.click(screen.getByRole('button', { name: '关闭失败操作' }))
    expect(useFeedbackStore.getState().progress).toEqual([])
    expect(screen.queryByText('启动 VM A')).not.toBeInTheDocument()
  })

  it('shows a result read error separately from definite failure and can dismiss it', () => {
    useFeedbackStore.getState().startProgress('unknown-vm', '重启 VM A')
    useFeedbackStore.getState().unknownProgress('unknown-vm', '请核对任务，勿重复提交')
    render(<OperationTasks />)
    expect(screen.getByRole('alert')).toHaveTextContent('状态读取失败')
    expect(screen.queryByText('失败')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭读取故障提示' }))
    expect(useFeedbackStore.getState().progress).toEqual([])
  })

  it('retains running operation feedback until the operation ends', () => {
    useFeedbackStore.getState().startProgress('running-vm', '启动 VM B')
    render(<OperationTasks />)
    expect(screen.getByText('启动 VM B')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('执行中')
    expect(screen.queryByRole('button', { name: /关闭.*操作/ })).not.toBeInTheDocument()
  })

  it('shows an explicit completed result and the full target name', () => {
    useFeedbackStore.getState().startProgress('completed-vm', '启动业务应用虚拟机（资源池 A）')
    useFeedbackStore.getState().completeProgress('completed-vm')
    render(<OperationTasks />)
    expect(screen.getByRole('status')).not.toBeVisible()
    fireEvent.click(document.querySelector('summary')!)
    expect(screen.getByRole('status')).toHaveTextContent('启动业务应用虚拟机（资源池 A）')
    expect(screen.getByRole('status')).toHaveTextContent('已完成')
    fireEvent.click(screen.getByRole('button', { name: '关闭已完成操作' }))
    expect(useFeedbackStore.getState().progress).toEqual([])
  })

  it('prints numeric progress only when the operation supplied a real value', () => {
    useFeedbackStore.getState().startProgress('measured', '复制磁盘', 37)
    useFeedbackStore.getState().startProgress('unmeasured', '扫描存储')
    render(<OperationTasks />)
    expect(screen.getByText('37%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '复制磁盘进度' })).toHaveAttribute('aria-valuenow', '37')
    expect(screen.queryByRole('progressbar', { name: '扫描存储进度' })).not.toBeInTheDocument()
    expect(screen.queryByText('-1%')).not.toBeInTheDocument()
  })
})
