import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Only presentation history is removed; server tasks and recovery journals stay intact. */
export const useTaskHistoryStore = create<{
  deletedRecords: string[]
  deleteRecord: (key: string) => void
  restoreRecord: (key: string) => void
}>()(persist((set, get) => ({
  deletedRecords: [],
  deleteRecord: (key) => set((state) => ({ deletedRecords: [...new Set([...state.deletedRecords, key])] })),
  restoreRecord: (key) => {
    if (get().deletedRecords.includes(key)) set((state) => ({ deletedRecords: state.deletedRecords.filter((record) => record !== key) }))
  },
}), { name: 'xenadmin-deleted-task-records' }))
