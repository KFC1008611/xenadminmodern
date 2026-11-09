/**
 * AlertRuleDialog component tests.
 * Tests create/edit modes, form validation, submission, ESC to close.
 */
import React from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlertRuleDialog } from '../../src/renderer/src/components/alerts/AlertRuleDialog'
import type { AlertRule } from '../../src/renderer/src/types/xapi'

const mockCreateRule = vi.fn()
const mockUpdateRule = vi.fn()

vi.mock('../../src/renderer/src/store/alertRule.store', () => ({
  useAlertRuleStore: () => ({
    createRule: mockCreateRule,
    updateRule: mockUpdateRule,
  }),
}))

const makeRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: 'rule-1',
  name: 'CPU Overload',
  metricType: 'cpu',
  operator: '>',
  threshold: 80,
  duration: 5,
  severity: 'warning',
  enabled: true,
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
  ...overrides,
})

describe('AlertRuleDialog', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateRule.mockResolvedValue(undefined)
    mockUpdateRule.mockResolvedValue(undefined)
  })

  it('renders nothing when not open', () => {
    const { container } = render(
      <AlertRuleDialog open={false} onClose={mockOnClose} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders create dialog title', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    expect(screen.getByText('创建告警规则')).toBeTruthy()
  })

  it('renders edit dialog title', () => {
    render(
      <AlertRuleDialog open={true} onClose={mockOnClose} editingRule={makeRule()} />,
    )
    expect(screen.getByText('编辑告警规则')).toBeTruthy()
  })

  it('renders all form fields', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    expect(screen.getByPlaceholderText('例如: CPU 过载告警')).toBeTruthy()
    expect(screen.getByText('监控指标')).toBeTruthy()
    expect(screen.getByText('运算符')).toBeTruthy()
    expect(screen.getByText(/阈值/)).toBeTruthy()
    expect(screen.getByText(/持续时间/)).toBeTruthy()
    expect(screen.getByText('告警级别')).toBeTruthy()
    expect(screen.getByText('启用规则')).toBeTruthy()
  })

  it('pre-fills form in edit mode', () => {
    const rule = makeRule({ name: 'Test Rule', threshold: 90, duration: 10 })
    render(<AlertRuleDialog open={true} onClose={mockOnClose} editingRule={rule} />)
    const nameInput = screen.getByDisplayValue('Test Rule')
    expect(nameInput).toBeTruthy()
    expect(screen.getByDisplayValue('90')).toBeTruthy()
    expect(screen.getByDisplayValue('10')).toBeTruthy()
  })

  it('shows validation error for empty name', async () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('创建规则'))
    await waitFor(() => {
      expect(screen.getByText('规则名称不能为空')).toBeTruthy()
    })
  })

  it('calls onClose when cancel is clicked', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('取消'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('calls onClose when X button is clicked', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    // X button has no text, find by role
    const buttons = screen.getAllByRole('button')
    const closeBtn = buttons[0] // First button is the X
    fireEvent.click(closeBtn)
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('submits create form with correct data', async () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    const nameInput = screen.getByPlaceholderText('例如: CPU 过载告警')
    fireEvent.change(nameInput, { target: { value: 'New Rule' } })
    fireEvent.click(screen.getByText('创建规则'))
    await waitFor(() => {
      expect(mockCreateRule).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Rule', metricType: 'cpu' }),
      )
    })
  })

  it('submits edit form with correct data', async () => {
    const rule = makeRule({ name: 'Old Name' })
    render(<AlertRuleDialog open={true} onClose={mockOnClose} editingRule={rule} />)
    const nameInput = screen.getByDisplayValue('Old Name')
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } })
    fireEvent.click(screen.getByText('保存修改'))
    await waitFor(() => {
      expect(mockUpdateRule).toHaveBeenCalledWith(
        'rule-1',
        expect.objectContaining({ name: 'Updated Name' }),
      )
    })
  })

  it('renders severity toggle buttons', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    expect(screen.getByText('警告')).toBeTruthy()
    expect(screen.getByText('严重')).toBeTruthy()
  })

  it('toggles severity', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('严重'))
    // The error severity button should now be active
    const errorBtn = screen.getByText('严重').closest('button')
    expect(errorBtn?.className).toContain('bg-danger-soft')
  })

  it('renders target scope fields', () => {
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    expect(screen.getByText('目标范围 (可选)')).toBeTruthy()
    expect(screen.getByText('全局 (所有主机/VM)')).toBeTruthy()
  })

  it('shows error on API failure', async () => {
    mockCreateRule.mockRejectedValue(new Error('Network error'))
    render(<AlertRuleDialog open={true} onClose={mockOnClose} />)
    const nameInput = screen.getByPlaceholderText('例如: CPU 过载告警')
    fireEvent.change(nameInput, { target: { value: 'Test' } })
    fireEvent.click(screen.getByText('创建规则'))
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy()
    })
  })

  it.each([
    ['cpu', 83], ['cpu', 82.5], ['networkRx', 10000000],
  ] as const)('accepts the supported %s threshold %s without a native step error', (metricType, threshold) => {
    render(<AlertRuleDialog open onClose={mockOnClose} editingRule={makeRule({ metricType, threshold })} />)
    const input = screen.getByDisplayValue(String(threshold)) as HTMLInputElement
    expect(input.validity.stepMismatch).toBe(false)
  })

  it('freezes the form and prevents cancellation or repeated submission while saving', async () => {
    let resolve!: () => void
    mockCreateRule.mockReturnValue(new Promise<void>((done) => { resolve = done }))
    render(<AlertRuleDialog open onClose={mockOnClose} />)
    const input = screen.getByPlaceholderText('例如: CPU 过载告警')
    fireEvent.change(input, { target: { value: 'New Rule' } })
    fireEvent.click(screen.getByRole('button', { name: '创建规则' }))
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    fireEvent.submit(input.closest('form')!)
    expect(mockCreateRule).toHaveBeenCalledOnce()
    expect(mockOnClose).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    await waitFor(() => expect(mockOnClose).toHaveBeenCalledOnce())
  })
})
