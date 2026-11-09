/**
 * AlertHistoryList component tests.
 * Tests rendering of history entries, filters, acknowledge, empty state.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlertHistoryList } from '../../src/renderer/src/components/alerts/AlertHistoryList'
import type { AlertHistoryRecord } from '../../src/renderer/src/types/xapi'

const mockLoadHistory = vi.fn()
const mockAcknowledgeAlert = vi.fn()
const mockStartAlertListener = vi.fn()
const mockStopAlertListener = vi.fn()

let mockHistory: AlertHistoryRecord[] = []
let mockHistoryLoading = false
let mockActiveAlertCount = 0

vi.mock('../../src/renderer/src/store/alert.store', () => ({
  useAlertStore: () => ({
    history: mockHistory,
    historyLoading: mockHistoryLoading,
    loadHistory: mockLoadHistory,
    acknowledgeAlert: mockAcknowledgeAlert,
    activeAlertCount: mockActiveAlertCount,
    startAlertListener: mockStartAlertListener,
    stopAlertListener: mockStopAlertListener,
  }),
}))

const makeHistoryRecord = (overrides: Partial<AlertHistoryRecord> = {}): AlertHistoryRecord => ({
  id: 'alert-1',
  ruleId: 'rule-1',
  ruleName: 'CPU Overload',
  connectionId: 'conn-1',
  entityRef: 'OpaqueRef:host-1',
  entityName: 'Host-01',
  metricType: 'cpu',
  metricValue: 95,
  threshold: 80,
  severity: 'warning',
  triggeredAt: Date.now() - 60000,
  status: 'active',
  ...overrides,
})

describe('AlertHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHistory = []
    mockHistoryLoading = false
    mockActiveAlertCount = 0
  })

  it('calls loadHistory and startAlertListener on mount', () => {
    render(<AlertHistoryList />)
    expect(mockLoadHistory).toHaveBeenCalled()
    expect(mockStartAlertListener).toHaveBeenCalled()
  })

  it('calls stopAlertListener on unmount', () => {
    const { unmount } = render(<AlertHistoryList />)
    unmount()
    expect(mockStopAlertListener).toHaveBeenCalled()
  })

  it('renders empty state when no history', () => {
    render(<AlertHistoryList />)
    expect(screen.getByText('暂无告警历史')).toBeTruthy()
  })

  it('renders loading state', () => {
    mockHistoryLoading = true
    render(<AlertHistoryList />)
    expect(screen.getByText('加载告警历史...')).toBeTruthy()
  })

  it('renders history records', () => {
    mockHistory = [
      makeHistoryRecord({ id: 'a1', ruleName: 'CPU High', entityName: 'Host-01' }),
      makeHistoryRecord({ id: 'a2', ruleName: 'Mem High', entityName: 'Host-02', metricType: 'memory' }),
    ]
    render(<AlertHistoryList />)
    expect(screen.getByText('CPU High')).toBeTruthy()
    expect(screen.getByText('Mem High')).toBeTruthy()
  })

  it('renders severity badges', () => {
    mockHistory = [
      makeHistoryRecord({ severity: 'warning' }),
      makeHistoryRecord({ id: 'a2', severity: 'error' }),
    ]
    render(<AlertHistoryList />)
    expect(screen.getAllByText('警告').length).toBeGreaterThan(0)
    expect(screen.getAllByText('严重').length).toBeGreaterThan(0)
  })

  it('renders active alert count', () => {
    mockActiveAlertCount = 3
    mockHistory = [makeHistoryRecord()]
    render(<AlertHistoryList />)
    expect(screen.getByText('3 活跃')).toBeTruthy()
  })

  it('shows acknowledge button for active alerts', () => {
    mockHistory = [makeHistoryRecord({ status: 'active' })]
    render(<AlertHistoryList />)
    expect(screen.getByText('确认')).toBeTruthy()
  })

  it('calls acknowledgeAlert on click', () => {
    mockHistory = [makeHistoryRecord({ id: 'alert-1', status: 'active' })]
    render(<AlertHistoryList />)
    fireEvent.click(screen.getByText('确认'))
    expect(mockAcknowledgeAlert).toHaveBeenCalledWith('alert-1')
  })

  it('filters by status', () => {
    mockHistory = [
      makeHistoryRecord({ id: 'a1', status: 'active' }),
      makeHistoryRecord({ id: 'a2', status: 'acknowledged', ruleName: 'Ack Rule' }),
    ]
    render(<AlertHistoryList />)
    // '已确认' appears in both filter buttons and status labels, use getAllByText
    const ackButtons = screen.getAllByText('已确认')
    fireEvent.click(ackButtons[0])
    expect(screen.queryByText('CPU Overload')).toBeNull()
    expect(screen.getByText('Ack Rule')).toBeTruthy()
  })

  it('filters by severity', () => {
    mockHistory = [
      makeHistoryRecord({ id: 'a1', severity: 'warning', ruleName: 'Warn Rule' }),
      makeHistoryRecord({ id: 'a2', severity: 'error', ruleName: 'Error Rule' }),
    ]
    render(<AlertHistoryList />)
    // '严重' appears in both filter buttons and severity badges
    const errorButtons = screen.getAllByText('严重')
    // The filter button is the one that's a direct child of the filter bar
    fireEvent.click(errorButtons.find((el) => el.tagName === 'BUTTON') || errorButtons[0])
    expect(screen.queryByText('Warn Rule')).toBeNull()
    expect(screen.getByText('Error Rule')).toBeTruthy()
  })

  it('filters by search query', () => {
    mockHistory = [
      makeHistoryRecord({ id: 'a1', ruleName: 'CPU High', entityName: 'Host-01' }),
      makeHistoryRecord({ id: 'a2', ruleName: 'Mem High', entityName: 'Host-02', metricType: 'memory' }),
    ]
    render(<AlertHistoryList />)
    const search = screen.getByPlaceholderText('搜索规则名、主机名...')
    fireEvent.change(search, { target: { value: 'CPU' } })
    expect(screen.getByText('CPU High')).toBeTruthy()
    expect(screen.queryByText('Mem High')).toBeNull()
  })

  it('shows no results message when filter has no matches', () => {
    mockHistory = [makeHistoryRecord()]
    render(<AlertHistoryList />)
    const search = screen.getByPlaceholderText('搜索规则名、主机名...')
    fireEvent.change(search, { target: { value: 'nonexistent' } })
    expect(screen.getByText('没有匹配的告警记录')).toBeTruthy()
  })

  it('renders entity name and metric value', () => {
    mockHistory = [makeHistoryRecord({ entityName: 'Host-01', metricValue: 95, threshold: 80 })]
    render(<AlertHistoryList />)
    expect(screen.getByText(/Host-01/)).toBeTruthy()
  })

  it('renders status filter buttons', () => {
    render(<AlertHistoryList />)
    expect(screen.getByText('全部')).toBeTruthy()
    expect(screen.getByText('活跃')).toBeTruthy()
    expect(screen.getByText('已确认')).toBeTruthy()
    expect(screen.getByText('已解决')).toBeTruthy()
  })
})
