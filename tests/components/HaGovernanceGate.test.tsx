import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HaConfigDialog } from '../../src/renderer/src/components/ha/HaConfigDialog'
import { useHaStore } from '../../src/renderer/src/store/ha.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

describe('HA governance safety gate', () => {
  beforeEach(() => {
    useHaStore.setState({
      haConfig: {
        enabled: false,
        allowOvercommit: false,
        heartbeatSRs: [],
        plannedRepeats: 0,
        hosts: [],
      },
      enableHa: vi.fn(),
      disableHa: vi.fn(),
    } as any)
    useMultiDataStore.setState({
      srs: [{ ref: 'OpaqueRef:sr', name_label: 'Shared SR', type: 'nfs', physical_size: 1 }],
    } as any)
  })

  it('shows the operation restriction and disables HA submission', () => {
    render(<HaConfigDialog open onOpenChange={vi.fn()} connectionId="conn-1" />)

    expect(screen.getByText(/暂不可用/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '启用 HA' })).toBeDisabled()
  })
})
