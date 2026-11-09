import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop content policy', () => {
  const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
  const content = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]
  const policy = new Map(content.split(';').map((value) => {
    const [directive, ...sources] = value.trim().split(/\s+/)
    return [directive, sources]
  }))

  it('allows noVNC data URI frames and cursors without allowing remote scripts', () => {
    // noVNC imageRect decodes compressed frames via Image.src = data:<mime>;base64,...
    expect(policy.get('img-src')).toEqual(["'self'", 'data:'])
    expect(policy.get('script-src')).toEqual(["'self'"])
  })

  it('permits the loopback console proxy without allowing arbitrary websocket hosts', () => {
    expect(policy.get('connect-src')).toEqual(["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*'])
    expect(policy.get('default-src')).toEqual(["'self'"])
  })
})
