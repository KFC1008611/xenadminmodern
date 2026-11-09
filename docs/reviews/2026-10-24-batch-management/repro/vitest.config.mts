import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    include: ['docs/reviews/2026-10-24-batch-management/repro/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['tests/components/setup.ts'],
    fileParallelism: false,
    allowOnly: false,
  },
})
