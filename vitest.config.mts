/**
 * Vitest configuration — runs unit tests in a Node.js environment
 * and component tests in a jsdom environment.
 * Renderer utility tests are included via path aliases.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const { VITEST_COVERAGE_CONFIG } = require('./scripts/coverage-policy.cjs')

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    allowOnly: false,
    env: {
      LOG_LEVEL: 'silent',
    },
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.tsx'],
    fileParallelism: false,
    coverage: VITEST_COVERAGE_CONFIG,
    // Use jsdom for component tests
    environmentMatchGlobs: [
      ['tests/components/**', 'jsdom'],
    ],
    setupFiles: ['tests/components/setup.ts'],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'],
    alias: {
      '@renderer': resolve('./src/renderer/src'),
      '@': resolve('./src/renderer/src'),
    },
  },
})
