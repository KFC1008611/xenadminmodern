/**
 * Alert Rule store — manages alert rule CRUD and dialog state.
 * v7: New store for alert rule management
 */
import { create } from 'zustand'
import type { AlertRule, AlertRuleInput } from '../types/xapi'

export interface AlertRuleState {
  // Data
  rules: AlertRule[]
  loading: boolean
  error: string | null

  // Dialog state
  editingRule: AlertRule | null
  createDialogOpen: boolean
  editDialogOpen: boolean
  deleteConfirmId: string | null

  // Actions
  loadRules: () => Promise<void>
  createRule: (input: AlertRuleInput) => Promise<void>
  updateRule: (id: string, updates: Partial<AlertRule>) => Promise<void>
  deleteRule: (id: string) => Promise<void>
  evaluateNow: () => Promise<void>

  // Dialog actions
  openCreateDialog: () => void
  closeCreateDialog: () => void
  openEditDialog: (rule: AlertRule) => void
  closeEditDialog: () => void
  confirmDelete: (id: string) => void
  cancelDelete: () => void
}

export const useAlertRuleStore = create<AlertRuleState>((set, get) => ({
  rules: [],
  loading: false,
  error: null,
  editingRule: null,
  createDialogOpen: false,
  editDialogOpen: false,
  deleteConfirmId: null,

  loadRules: async () => {
    set({ loading: true, error: null })
    try {
      const rules = await window.xapi.alertRules.list()
      set({ rules, loading: false })
    } catch (e: any) {
      console.error('Failed to load alert rules:', e?.message || e)
      set({ loading: false, error: e?.message || 'Failed to load alert rules' })
    }
  },

  createRule: async (input: AlertRuleInput) => {
    set({ error: null })
    try {
      await window.xapi.alertRules.create(input)
      // Refresh rule list after creation
      await get().loadRules()
      set({ createDialogOpen: false })
    } catch (e: any) {
      console.error('Failed to create alert rule:', e?.message || e)
      set({ error: e?.message || 'Failed to create alert rule' })
      throw e // Re-throw so dialog can handle the error
    }
  },

  updateRule: async (id: string, updates: Partial<AlertRule>) => {
    set({ error: null })
    try {
      await window.xapi.alertRules.update(id, updates)
      // Refresh rule list after update
      await get().loadRules()
      set({ editDialogOpen: false, editingRule: null })
    } catch (e: any) {
      console.error('Failed to update alert rule:', e?.message || e)
      set({ error: e?.message || 'Failed to update alert rule' })
      throw e
    }
  },

  deleteRule: async (id: string) => {
    set({ error: null })
    try {
      await window.xapi.alertRules.delete(id)
      // Refresh rule list after deletion
      await get().loadRules()
      set({ deleteConfirmId: null })
    } catch (e: any) {
      console.error('Failed to delete alert rule:', e?.message || e)
      set({ error: e?.message || 'Failed to delete alert rule' })
    }
  },

  evaluateNow: async () => {
    set({ error: null })
    try {
      const triggered = await window.xapi.alertRules.evaluate()
      // Return triggered alerts for the caller to handle (e.g., toast notification)
      return void triggered
    } catch (e: any) {
      console.error('Failed to evaluate alert rules:', e?.message || e)
      set({ error: e?.message || '告警计算未完成' })
    }
  },

  // Dialog actions
  openCreateDialog: () => set({ createDialogOpen: true }),
  closeCreateDialog: () => set({ createDialogOpen: false }),
  openEditDialog: (rule: AlertRule) => set({ editDialogOpen: true, editingRule: rule }),
  closeEditDialog: () => set({ editDialogOpen: false, editingRule: null }),
  confirmDelete: (id: string) => set({ deleteConfirmId: id }),
  cancelDelete: () => set({ deleteConfirmId: null }),
}))
