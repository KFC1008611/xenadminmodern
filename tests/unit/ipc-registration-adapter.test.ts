import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineInvokeContract, definePushContract } from '../../src/shared/ipc-contract'

type SourceFile = {
  path: string
  source: string
}

function collectTypeScriptSources(directory: string): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptSources(absolutePath)
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return []
    return [{
      path: relative(process.cwd(), absolutePath).split(sep).join('/'),
      source: readFileSync(absolutePath, 'utf8'),
    }]
  })
}

function matchingCalls(files: readonly SourceFile[], pattern: RegExp): Array<{
  path: string
  count: number
}> {
  return files.flatMap(({ path, source }) => {
    const count = source.match(pattern)?.length ?? 0
    return count === 0 ? [] : [{ path, count }]
  }).sort((left, right) => left.path.localeCompare(right.path))
}

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

const noArgs = {
  parse(value: unknown): readonly [] {
    if (!Array.isArray(value) || value.length !== 0) throw new Error('expected no arguments')
    return []
  },
}

const statusResult = {
  parse(value: unknown): { ready: boolean } {
    if (!value || typeof value !== 'object' || typeof (value as { ready?: unknown }).ready !== 'boolean') {
      throw new Error('invalid status')
    }
    return { ready: (value as { ready: boolean }).ready }
  },
}

function statusContract(channel: string) {
  return defineInvokeContract({
    channel,
    argsSchema: noArgs,
    resultSchema: statusResult,
    errorShape: 'ipc-error-response-v1',
    callerPolicy: 'app-window-main-frame',
    redaction: ['none'],
  })
}

describe('IPC registration adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    registeredHandlers.clear()
    mockHandle.mockClear()
  })

  it('blocks legacy registration and raw IPC transport bypasses across production sources', async () => {
    const utils = await import('../../src/main/ipc/handlers/utils')
    const sources = collectTypeScriptSources(resolve(process.cwd(), 'src'))
    const mainSources = sources.filter(({ path }) => path.startsWith('src/main/'))
    const preloadSources = sources.filter(({ path }) => path.startsWith('src/preload/'))
    const ipcMainSources = sources.filter(
      ({ source }) => /\bipcMain\s*(?:\.|[,}]|as\b)/.test(source),
    )

    expect(utils).not.toHaveProperty('handle')
    expect(utils.getIpcRegistrationInventory()).toEqual({ contracts: [] })
    expect(ipcMainSources.map(({ path }) => path)).toEqual(['src/main/ipc/handlers/utils.ts'])
    expect(ipcMainSources[0]?.source.match(/\bipcMain\b/g)).toHaveLength(2)
    expect(matchingCalls(
      sources,
      /\bipcMain\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\])\s*\(/g,
    )).toEqual([{
      path: 'src/main/ipc/handlers/utils.ts',
      count: 1,
    }])
    expect(matchingCalls(sources, /\bipcMain\s*\.\s*handle\s*\(/g)).toEqual([{
      path: 'src/main/ipc/handlers/utils.ts',
      count: 1,
    }])
    expect(matchingCalls(
      preloadSources,
      /\bipcRenderer\s*(?:\.\s*(?:invoke|on|send)|\[\s*['"](?:invoke|on|send)['"]\s*\])\s*\(/g,
    )).toEqual([])
    expect(preloadSources
      .filter(({ source }) => /\bipcRenderer\b/.test(source))
      .map(({ path }) => path)).toEqual(['src/preload/index.ts'])
    expect(matchingCalls(mainSources, /\.\s*send\s*\(/g)).toEqual([
      { path: 'src/main/console/console.service.ts', count: 1 },
      { path: 'src/main/ipc/ipc-contract-sender.ts', count: 1 },
    ])

    const legacyEntryPoints = sources.flatMap(({ path, source }) => (
      /\bLegacyIpcContract\b|\blegacyContracts\b|readonly\s+legacy\s*:|export\s+function\s+handle\s*\(/.test(source)
        ? [path]
        : []
    ))
    expect(legacyEntryPoints).toEqual([])
  })

  it('registers a shared descriptor by its declared channel', async () => {
    const { handleContract } = await import('../../src/main/ipc/handlers/utils')
    const contract = statusContract('contract:status')

    handleContract(contract, () => ({ ready: true }))

    expect(mockHandle).toHaveBeenCalledWith('contract:status', expect.any(Function))
  })

  it('inventories a push descriptor without registering an invoke handler', async () => {
    const { getIpcRegistrationInventory, registerPushContract } = await import(
      '../../src/main/ipc/handlers/utils'
    )
    const contract = definePushContract({
      channel: 'contract:notice',
      argsSchema: noArgs,
      callerPolicy: 'main-process',
      redaction: ['none'],
    })

    registerPushContract(contract)

    expect(getIpcRegistrationInventory().contracts).toContainEqual(contract)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('rejects duplicate shared contract registration before replacing the handler', async () => {
    const { handleContract } = await import('../../src/main/ipc/handlers/utils')
    const contract = statusContract('contract:duplicate')

    handleContract(contract, () => ({ ready: true }))

    expect(() => handleContract(contract, () => ({ ready: false })))
      .toThrow('Duplicate IPC channel: contract:duplicate')
    expect(mockHandle).toHaveBeenCalledTimes(1)
  })
})
