import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export const IPC_OWNER_VALIDATION_ERROR_CODE = 'IPC_UNTRUSTED_SENDER' as const

export class IpcOwnerValidationError extends Error {
  readonly code = IPC_OWNER_VALIDATION_ERROR_CODE

  constructor() {
    super('IPC invocation did not originate from the current application window')
    this.name = 'IpcOwnerValidationError'
  }
}

function trustedDocumentUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href
  } catch {
    return null
  }
}

export class IpcOwnerValidator {
  private owner: BrowserWindow | null = null
  private expectedUrl: string | null = null

  constructor(owner: BrowserWindow | null = null, trustedUrl?: string) {
    this.rebind(owner, trustedUrl)
  }

  rebind(owner: BrowserWindow | null, trustedUrl?: string): void {
    this.owner = null
    this.expectedUrl = null
    if (!owner) return

    const expectedUrl = trustedDocumentUrl(trustedUrl ?? owner.webContents.getURL())
    if (expectedUrl === null) {
      throw new TypeError('Trusted IPC document URL must be a valid URL')
    }

    this.owner = owner
    this.expectedUrl = expectedUrl
  }

  assertCurrent(event: IpcMainInvokeEvent | null | undefined): void {
    const owner = this.owner
    const expectedUrl = this.expectedUrl
    if (
      !owner
      || !event
      || expectedUrl === null
      || owner.isDestroyed()
      || owner.webContents.isDestroyed()
      || event.sender !== owner.webContents
      || event.senderFrame !== owner.webContents.mainFrame
      || trustedDocumentUrl(owner.webContents.getURL()) !== expectedUrl
      || trustedDocumentUrl(event.senderFrame.url) !== expectedUrl
    ) {
      throw new IpcOwnerValidationError()
    }
  }
}
