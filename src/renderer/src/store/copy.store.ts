import { create } from 'zustand'
import { isTransferTerminal } from '../lib/transferTracking'
import type { VmCopyOperation } from '../../../shared/types/xapi'

export const useCopyStore = create<{
  readError: string
  operations: VmCopyOperation[]
  pendingCancels: string[]
  cancel: (id: string) => Promise<void>
  accept: (operation: VmCopyOperation) => void
}>((set, get) => ({
  readError: '',
  operations: [],
  pendingCancels: [],
  cancel: async (id) => {
    const state = get()
    const operation = state.operations.find((item) => item.id === id)
    if (state.pendingCancels.includes(id) || !operation?.cancellable || isTransferTerminal(operation.status) || operation.status === 'cancelling') return
    set({ pendingCancels: [...state.pendingCancels, id] })
    try { get().accept(await window.xapi.vm.cancelCopy(id)) }
    finally { set({ pendingCancels: get().pendingCancels.filter((pending) => pending !== id) }) }
  },
  accept: (operation) => set((s) => ({ operations: [
    s.operations.find((old) => old.id === operation.id && isTransferTerminal(old.status)) ?? operation,
    ...s.operations.filter((o) => o.id !== operation.id),
  ] })),
}))
