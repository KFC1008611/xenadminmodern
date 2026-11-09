import { create } from 'zustand'
import { isTransferTerminal } from '../lib/transferTracking'
import type { VmCopyOperation } from '../../../shared/types/xapi'

export const useCopyStore = create<{
  operations: VmCopyOperation[]
  accept: (operation: VmCopyOperation) => void
}>((set) => ({
  operations: [],
  accept: (operation) => set((s) => ({ operations: [
    s.operations.find((old) => old.id === operation.id && isTransferTerminal(old.status)) ?? operation,
    ...s.operations.filter((o) => o.id !== operation.id),
  ] })),
}))
