import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HostPatchesTab } from '../../src/renderer/src/components/patch/HostPatchesTab'

vi.mock('@radix-ui/react-tabs', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  List: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const { patch, mocks } = vi.hoisted(() => ({
  patch: {
    ref: 'OpaqueRef:patch',
    uuid: 'patch-uuid',
    name_label: 'Security update',
    name_description: 'Security fixes',
    size: 1024,
    version: 1,
    update_url: '',
    applied: false,
    after_apply_guides: [],
    upload_date: new Date('2026-07-16T00:00:00Z'),
    connectionId: 'conn-1',
    poolName: 'Pool 1',
  },
  mocks: {
    loadPatches: vi.fn().mockResolvedValue(undefined),
    loadHostPatchStatus: vi.fn().mockResolvedValue(undefined),
    getMissingPatches: vi.fn().mockResolvedValue([]),
    applyPatchToHost: vi.fn(),
  },
}))

vi.mock('../../src/renderer/src/store/patch.store', () => ({
  usePatchStore: () => ({
    patches: [patch],
    patchesLoading: false,
    hostPatchStatus: [],
    ...mocks,
  }),
}))

describe('patch safety gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMissingPatches.mockResolvedValue([patch])
  })

  it('keeps patch status readable while disabling host apply', async () => {
    render(
      <HostPatchesTab
        connectionId="conn-1"
        hostRef="OpaqueRef:host"
        hostName="host-1"
      />,
    )
    expect(await screen.findByText(patch.name_label)).toBeInTheDocument()
    const applyButton = screen.getByRole('button', { name: '应用到此主机' })
    expect(applyButton).toBeDisabled()
    expect(applyButton).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    expect(mocks.applyPatchToHost).not.toHaveBeenCalled()
  })
})
