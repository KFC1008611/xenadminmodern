import { describe, expect, it } from 'vitest'

import config from '../../electron.vite.config'

describe('Electron Vite main-process configuration', () => {
  it('leaves ws optional native accelerators external', () => {
    const external = config.main?.build?.rollupOptions?.external as string[]

    expect(external).toEqual(expect.arrayContaining(['bufferutil', 'utf-8-validate']))
  })
})
