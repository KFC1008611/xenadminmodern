/**
 * Component test setup — provides global mocks for renderer components.
 */
import '@testing-library/jest-dom/vitest'

// Mock window.xapi (IPC bridge)
const mockXapi = {
  metrics: {
    getRange: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ current: 0, max: 0, avg: 0, min: 0 }),
    getVmHistory: vi.fn().mockResolvedValue([]),
    startCollection: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    getCollectionError: vi.fn().mockResolvedValue(null),
  },
  alertRules: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((input) => Promise.resolve({ id: 'rule-1', ...input })),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  },
  alertHistory: {
    list: vi.fn().mockResolvedValue([]),
    acknowledge: vi.fn().mockResolvedValue(undefined),
  },
  onAlertTriggered: vi.fn().mockReturnValue(() => {}),
  onVmChanged: vi.fn().mockReturnValue(() => {}),
}

// @ts-expect-error — partial mock of window.xapi
if (typeof globalThis.window !== 'undefined') {
  globalThis.window.xapi = mockXapi
}

// Mock ResizeObserver for Recharts
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as any

// Suppress console.error in tests unless debugging
// vi.spyOn(console, 'error').mockImplementation(() => {})
