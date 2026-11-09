/**
 * AlertRuleList component tests.
 * Tests rendering of rules, search, toggle, delete confirmation, empty state.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlertRuleList } from '../../src/renderer/src/components/alerts/AlertRuleList'
import type { AlertRule } from '../../src/renderer/src/types/xapi'

// Mock the store
const mockLoadRules = vi.fn()
const mockDeleteRule = vi.fn()
const mockUpdateRule = vi.fn()
const mockOpenCreateDialog = vi.fn()
const mockCloseCreateDialog = vi.fn()
const mockOpenEditDialog = vi.fn()
const mockCloseEditDialog = vi.fn()
const mockConfirmDelete = vi.fn()
const mockCancelDelete = vi.fn()

let mockRules: AlertRule[] = []
let mockLoading = false
let mockError: string | null = null
let mockCreateDialogOpen = false
let mockEditDialogOpen = false
let mockEditingRule: AlertRule | null = null
let mockDeleteConfirmId: string | null = null

vi.mock('../../src/renderer/src/store/alertRule.store', () => ({
  useAlertRuleStore: () => ({
    rules: mockRules,
    loading: mockLoading,
    error: mockError,
    loadRules: mockLoadRules,
    deleteRule: mockDeleteRule,
    updateRule: mockUpdateRule,
    createDialogOpen: mockCreateDialogOpen,
    editDialogOpen: mockEditDialogOpen,
    editingRule: mockEditingRule,
    openCreateDialog: mockOpenCreateDialog,
    closeCreateDialog: mockCloseCreateDialog,
    openEditDialog: mockOpenEditDialog,
    closeEditDialog: mockCloseEditDialog,
    confirmDelete: mockConfirmDelete,
    cancelDelete: mockCancelDelete,
    deleteConfirmId: mockDeleteConfirmId,
  }),
}))

// Mock AlertRuleDialog
vi.mock('../../src/renderer/src/components/alerts/AlertRuleDialog', () => ({
  AlertRuleDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="alert-rule-dialog">
        <button onClick={onClose}>Close Dialog</button>
      </div>
    ) : null,
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

describe('AlertRuleList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRules = []
    mockLoading = false
    mockError = null
    mockCreateDialogOpen = false
    mockEditDialogOpen = false
    mockEditingRule = null
    mockDeleteConfirmId = null
  })

  it('calls loadRules on mount', () => {
    render(<AlertRuleList />)
    expect(mockLoadRules).toHaveBeenCalled()
  })

  it('renders empty state when no rules', () => {
    render(<AlertRuleList />)
    expect(screen.getByText('暂无告警规则，点击创建')).toBeTruthy()
  })

  it('renders rules list', () => {
    mockRules = [
      makeRule({ id: 'r1', name: 'CPU High' }),
      makeRule({ id: 'r2', name: 'Memory High', metricType: 'memory' }),
    ]
    render(<AlertRuleList />)
    expect(screen.getByText('CPU High')).toBeTruthy()
    expect(screen.getByText('Memory High')).toBeTruthy()
  })

  it('renders severity badges', () => {
    mockRules = [
      makeRule({ severity: 'warning' }),
      makeRule({ id: 'r2', severity: 'error', name: 'Disk Error' }),
    ]
    render(<AlertRuleList />)
    expect(screen.getAllByText('警告').length).toBeGreaterThan(0)
    expect(screen.getAllByText('严重').length).toBeGreaterThan(0)
  })

  it('filters rules by search query', () => {
    mockRules = [
      makeRule({ id: 'r1', name: 'CPU High' }),
      makeRule({ id: 'r2', name: 'Memory High', metricType: 'memory' }),
    ]
    render(<AlertRuleList />)
    const search = screen.getByPlaceholderText('搜索规则...')
    fireEvent.change(search, { target: { value: 'CPU' } })
    expect(screen.getByText('CPU High')).toBeTruthy()
    expect(screen.queryByText('Memory High')).toBeNull()
  })

  it('opens create dialog on button click', () => {
    render(<AlertRuleList />)
    fireEvent.click(screen.getByText('创建规则'))
    expect(mockOpenCreateDialog).toHaveBeenCalled()
  })

  it('calls updateRule on toggle click', () => {
    mockRules = [makeRule({ enabled: true })]
    render(<AlertRuleList />)
    const toggle = screen.getByTitle('已启用')
    fireEvent.click(toggle)
    expect(mockUpdateRule).toHaveBeenCalledWith('rule-1', { enabled: false })
  })

  it('shows delete confirmation on delete click', () => {
    mockRules = [makeRule()]
    render(<AlertRuleList />)
    fireEvent.click(screen.getByTitle('删除'))
    expect(mockConfirmDelete).toHaveBeenCalledWith('rule-1')
  })

  it('renders delete confirmation UI', () => {
    mockRules = [makeRule()]
    mockDeleteConfirmId = 'rule-1'
    render(<AlertRuleList />)
    expect(screen.getByText('确定删除此规则？')).toBeTruthy()
    expect(screen.getByText('确认删除')).toBeTruthy()
    expect(screen.getByText('取消')).toBeTruthy()
  })

  it('calls deleteRule on confirm', () => {
    mockRules = [makeRule()]
    mockDeleteConfirmId = 'rule-1'
    render(<AlertRuleList />)
    fireEvent.click(screen.getByText('确认删除'))
    expect(mockDeleteRule).toHaveBeenCalledWith('rule-1')
  })

  it('calls cancelDelete on cancel', () => {
    mockRules = [makeRule()]
    mockDeleteConfirmId = 'rule-1'
    render(<AlertRuleList />)
    fireEvent.click(screen.getByText('取消'))
    expect(mockCancelDelete).toHaveBeenCalled()
  })

  it('renders error message', () => {
    mockError = 'Failed to load rules'
    render(<AlertRuleList />)
    expect(screen.getByText('Failed to load rules')).toBeTruthy()
  })

  it('renders loading state', () => {
    mockLoading = true
    render(<AlertRuleList />)
    expect(screen.getByText('加载规则中...')).toBeTruthy()
  })

  it('renders metric type labels', () => {
    mockRules = [makeRule({ metricType: 'cpu' })]
    render(<AlertRuleList />)
    expect(screen.getByText('CPU 利用率')).toBeTruthy()
  })

  it('renders threshold with units', () => {
    mockRules = [makeRule({ threshold: 80, metricType: 'cpu' })]
    render(<AlertRuleList />)
    expect(screen.getByText('> 80%')).toBeTruthy()
  })

  it('opens edit dialog on edit click', () => {
    const rule = makeRule()
    mockRules = [rule]
    render(<AlertRuleList />)
    fireEvent.click(screen.getByTitle('编辑'))
    expect(mockOpenEditDialog).toHaveBeenCalledWith(rule)
  })

  it('shows no results message when search has no matches', () => {
    mockRules = [makeRule({ name: 'CPU High' })]
    render(<AlertRuleList />)
    const search = screen.getByPlaceholderText('搜索规则...')
    fireEvent.change(search, { target: { value: 'nonexistent' } })
    expect(screen.getByText('没有匹配的规则')).toBeTruthy()
  })
})
