import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as {
  scripts?: Record<string, string>
}

describe('lint command contract', () => {
  it('covers every managed source and runtime-script root without scanning scratch files', () => {
    expect(packageJson.scripts?.lint).toBe(
      'eslint src tests scripts electron.vite.config.ts vitest.config.mts vite.renderer.config.ts postcss.config.js tailwind.config.js --ext .js,.cjs,.mjs,.ts,.tsx --max-warnings 0',
    )
  })
})
