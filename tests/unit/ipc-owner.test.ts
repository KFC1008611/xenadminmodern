import { describe, expect, it } from 'vitest'
import { IpcOwnerValidator } from '../../src/main/ipc/ipc-owner'

function createOwner(url = 'file:///Applications/XenAdmin/index.html') {
  let currentUrl = url
  let ownerDestroyed = false
  let webContentsDestroyed = false
  const mainFrame = { url }
  const webContents = {
    mainFrame,
    getURL: () => currentUrl,
    isDestroyed: () => webContentsDestroyed,
  }
  return {
    owner: {
      webContents,
      isDestroyed: () => ownerDestroyed,
    },
    event: {
      sender: webContents,
      senderFrame: mainFrame,
    },
    navigate(nextUrl: string) {
      currentUrl = nextUrl
      mainFrame.url = nextUrl
    },
    setFrameUrl(nextUrl: string) {
      mainFrame.url = nextUrl
    },
    destroyOwner() {
      ownerDestroyed = true
    },
    destroyWebContents() {
      webContentsDestroyed = true
    },
  }
}

function expectUntrusted(action: () => void): void {
  expect(action).toThrow(expect.objectContaining({
    code: 'IPC_UNTRUSTED_SENDER',
  }))
}

describe('IpcOwnerValidator', () => {
  it('accepts only an event from the current owner and its main frame', () => {
    const current = createOwner()
    const validator = new IpcOwnerValidator(current.owner as never)

    expect(() => validator.assertCurrent(current.event as never)).not.toThrow()
    expectUntrusted(() => validator.assertCurrent(undefined))
    expectUntrusted(() => validator.assertCurrent({
      sender: createOwner().owner.webContents,
      senderFrame: current.owner.webContents.mainFrame,
    } as never))
  })

  it('rejects child frames, changed URLs, and destroyed owners', () => {
    const current = createOwner()
    const validator = new IpcOwnerValidator(current.owner as never)

    expectUntrusted(() => validator.assertCurrent({
      sender: current.owner.webContents,
      senderFrame: { url: current.owner.webContents.getURL() },
    } as never))

    current.setFrameUrl('https://external.example.test/')
    expectUntrusted(() => validator.assertCurrent(current.event as never))

    const navigated = createOwner()
    const navigatedValidator = new IpcOwnerValidator(navigated.owner as never)
    navigated.navigate('https://external.example.test/')
    expectUntrusted(() => navigatedValidator.assertCurrent(navigated.event as never))

    const destroyedOwner = createOwner()
    const destroyedOwnerValidator = new IpcOwnerValidator(destroyedOwner.owner as never)
    destroyedOwner.destroyOwner()
    expectUntrusted(() => destroyedOwnerValidator.assertCurrent(destroyedOwner.event as never))

    const destroyedContents = createOwner()
    const destroyedContentsValidator = new IpcOwnerValidator(destroyedContents.owner as never)
    destroyedContents.destroyWebContents()
    expectUntrusted(() => destroyedContentsValidator.assertCurrent(destroyedContents.event as never))
  })

  it('allows HashRouter navigation while rejecting document URL changes', () => {
    const current = createOwner('file:///Applications/XenAdmin/index.html?mode=normal#/dashboard')
    const validator = new IpcOwnerValidator(current.owner as never)

    current.navigate('file:///Applications/XenAdmin/index.html?mode=normal#/vms')
    expect(() => validator.assertCurrent(current.event as never)).not.toThrow()

    for (const changedUrl of [
      'http://app.example.test/index.html?mode=normal#/vms',
      'https://external.example.test/index.html?mode=normal#/vms',
      'https://app.example.test/other.html?mode=normal#/vms',
      'https://app.example.test/index.html?mode=observation#/vms',
    ]) {
      const changed = createOwner('https://app.example.test/index.html?mode=normal#/dashboard')
      const changedValidator = new IpcOwnerValidator(changed.owner as never)
      changed.navigate(changedUrl)
      expectUntrusted(() => changedValidator.assertCurrent(changed.event as never))
    }
  })

  it('binds an explicit trusted document before it loads', () => {
    const unloaded = createOwner('')
    const validator = new IpcOwnerValidator()

    validator.rebind(
      unloaded.owner as never,
      'file:///Applications/XenAdmin/index.html?mode=normal',
    )

    expectUntrusted(() => validator.assertCurrent(unloaded.event as never))

    unloaded.navigate('file:///Applications/XenAdmin/index.html?mode=normal#/dashboard')
    expect(() => validator.assertCurrent(unloaded.event as never)).not.toThrow()

    unloaded.navigate('file:///Applications/XenAdmin/index.html?mode=normal#/vms')
    expect(() => validator.assertCurrent(unloaded.event as never)).not.toThrow()
  })

  it('rejects empty and invalid explicit trusted document URLs', () => {
    const current = createOwner()
    const validator = new IpcOwnerValidator()

    expect(() => validator.rebind(current.owner as never, '')).toThrow(
      'Trusted IPC document URL must be a valid URL',
    )
    expect(() => validator.rebind(current.owner as never, 'not a URL')).toThrow(
      'Trusted IPC document URL must be a valid URL',
    )
    expectUntrusted(() => validator.assertCurrent(current.event as never))
  })

  it('accepts the new owner and rejects the old owner immediately after rebind', () => {
    const previous = createOwner()
    const current = createOwner('')
    const validator = new IpcOwnerValidator(previous.owner as never)

    validator.rebind(current.owner as never, 'file:///Applications/XenAdmin/next.html')

    expectUntrusted(() => validator.assertCurrent(previous.event as never))
    expectUntrusted(() => validator.assertCurrent(current.event as never))

    current.navigate('file:///Applications/XenAdmin/next.html#/dashboard')
    expect(() => validator.assertCurrent(current.event as never)).not.toThrow()
  })
})
