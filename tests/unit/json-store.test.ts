import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureJsonStoreDirectory, readJsonStore, writeJsonStore } from '../../src/main/persistence/json-store'

const directories: string[] = []
afterEach(() => {
  configureJsonStoreDirectory(null)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'xenadmin-state-test-'))
  directories.push(directory)
  configureJsonStoreDirectory(directory)
  return directory
}
describe('persistent application state', () => {
  it('survives service reconfiguration with private atomic files', () => {
    const directory = setup()
    writeJsonStore('example', { records: [{ id: 'op-1', status: 'unknown' }] })
    configureJsonStoreDirectory(null)
    configureJsonStoreDirectory(directory)
    expect(readJsonStore('example', {})).toEqual({ records: [{ id: 'op-1', status: 'unknown' }] })
    expect(statSync(join(directory, 'example.json')).mode & 0o777).toBe(0o600)
  })
  it('preserves corrupt evidence and reports it instead of returning empty history', () => {
    const directory = setup()
    const file = join(directory, 'example.json')
    writeFileSync(file, '{broken')
    expect(() => readJsonStore('example', [])).toThrow('原文件已保留')
    expect(readFileSync(file, 'utf8')).toBe('{broken')
  })
  it('rejects path traversal and future versions', () => {
    const directory = setup()
    expect(() => writeJsonStore('../secret', {})).toThrow('Invalid persistent store name')
    writeFileSync(join(directory, 'example.json'), JSON.stringify({ version: 2, data: [] }))
    expect(() => readJsonStore('example', [])).toThrow('无法读取本地记录')
  })
})
