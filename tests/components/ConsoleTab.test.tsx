import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleTab } from '../../src/renderer/src/pages/vm-detail/ConsoleTab'
import type { VmDetailRecord } from '../../src/renderer/src/types/xapi'

class MockRfb {
  static instances: MockRfb[] = []
  listeners = new Map<string, Array<() => void>>()
  scaleViewport = false
  resizeSession = false
  viewOnly = false

  constructor() {
    MockRfb.instances.push(this)
  }

  addEventListener(event: string, handler: () => void) {
    const handlers = this.listeners.get(event) ?? []
    handlers.push(handler)
    this.listeners.set(event, handlers)
  }

  emit(event: string) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler()
    }
  }

  disconnect() {}
  sendCtrlAltDel() {}
}

vi.mock('@novnc/novnc/lib/rfb', () => ({
  default: MockRfb,
}))

const baseVm: VmDetailRecord = {
  ref: 'OpaqueRef:vm1',
  uuid: 'vm1',
  name_label: 'vm1',
  name_description: '',
  power_state: 'Running',
  resident_on: 'OpaqueRef:host1',
  VCPUs_max: 1,
  VCPUs_at_startup: 1,
  memory_static_max: 1024,
  memory_dynamic_max: 1024,
  is_a_template: false,
  is_a_snapshot: false,
  is_control_domain: false,
  VBDs: [],
  VIFs: [],
  metrics: 'OpaqueRef:NULL',
  guest_metrics: 'OpaqueRef:NULL',
  consoles: [],
  memory_static_min: 0,
  memory_dynamic_min: 0,
  os_version: {},
  networks: {},
}

function installXapiMock(getRecord: ReturnType<typeof vi.fn>) {
  const getUrl = vi.fn().mockResolvedValue({ wsUrl: 'ws://127.0.0.1:5900', sessionId: 'console-1' })
  ;(window as any).xapi = {
    iso: {
      listAll: vi.fn().mockResolvedValue([]),
    },
    vm: {
      getCdDrive: vi.fn().mockResolvedValue(null),
      getRecord,
    },
    console: {
      getUrl,
      close: vi.fn().mockResolvedValue(undefined),
    },
  }
  return { getUrl }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ConsoleTab VNC reconnect behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockRfb.instances = []
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('does not auto-reconnect when a disconnect confirms the VM is halted', async () => {
    const haltedVm = { ...baseVm, power_state: 'Halted' as const }
    const getRecord = vi.fn().mockResolvedValue(haltedVm)
    const { getUrl } = installXapiMock(getRecord)
    const onVmRecordChanged = vi.fn()

    render(
      <ConsoleTab
        vm={baseVm}
        connectionId="conn-1"
        onVmRecordChanged={onVmRecordChanged}
      />
    )

    await act(async () => {
      await flushPromises()
    })
    expect(MockRfb.instances).toHaveLength(1)

    act(() => {
      MockRfb.instances[0].emit('disconnect')
    })

    await act(async () => {
      await flushPromises()
    })
    expect(getRecord).toHaveBeenCalledTimes(1)
    expect(onVmRecordChanged).toHaveBeenCalledWith(haltedVm)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    expect(getUrl).toHaveBeenCalledTimes(1)
  })

  it('reconnects after a disconnect when the VM remains running', async () => {
    const runningVm = { ...baseVm, power_state: 'Running' as const }
    const getRecord = vi.fn().mockResolvedValue(runningVm)
    const { getUrl } = installXapiMock(getRecord)

    render(<ConsoleTab vm={baseVm} connectionId="conn-1" />)

    await act(async () => {
      await flushPromises()
    })
    expect(MockRfb.instances).toHaveLength(1)

    act(() => {
      MockRfb.instances[0].emit('disconnect')
    })

    await act(async () => {
      await flushPromises()
    })
    expect(getRecord).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    await act(async () => {
      await flushPromises()
    })
    expect(getUrl).toHaveBeenCalledTimes(2)
  })

  it('leaves checking state when the VM stops before the delayed reconnect', async () => {
    const runningVm = { ...baseVm, power_state: 'Running' as const }
    const haltedVm = { ...baseVm, power_state: 'Halted' as const }
    const getRecord = vi.fn()
      .mockResolvedValueOnce(runningVm)
      .mockResolvedValueOnce(haltedVm)
    const { getUrl } = installXapiMock(getRecord)

    const { container } = render(<ConsoleTab vm={baseVm} connectionId="conn-1" />)

    await act(async () => {
      await flushPromises()
    })
    expect(MockRfb.instances).toHaveLength(1)

    act(() => {
      MockRfb.instances[0].emit('disconnect')
    })

    await act(async () => {
      await flushPromises()
    })
    expect(getRecord).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
      await flushPromises()
    })

    expect(getRecord).toHaveBeenCalledTimes(2)
    expect(getUrl).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('连接已断开')
    expect(container.textContent).toContain('VM 已停止运行，控制台已断开。')
  })

  it('does not reset the automatic reconnect limit on brief connect/disconnect loops', async () => {
    const runningVm = { ...baseVm, power_state: 'Running' as const }
    const getRecord = vi.fn().mockResolvedValue(runningVm)
    const { getUrl } = installXapiMock(getRecord)

    const { container } = render(<ConsoleTab vm={baseVm} connectionId="conn-1" />)

    await act(async () => {
      await flushPromises()
    })
    expect(getUrl).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 5; i += 1) {
      const currentRfb = MockRfb.instances[MockRfb.instances.length - 1]
      act(() => {
        currentRfb.emit('connect')
        currentRfb.emit('disconnect')
      })

      await act(async () => {
        await flushPromises()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
        await flushPromises()
      })

      expect(getUrl).toHaveBeenCalledTimes(i + 2)
    }

    const finalRfb = MockRfb.instances[MockRfb.instances.length - 1]
    act(() => {
      finalRfb.emit('connect')
      finalRfb.emit('disconnect')
    })

    await act(async () => {
      await flushPromises()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
      await flushPromises()
    })

    expect(getUrl).toHaveBeenCalledTimes(6)
    expect(container.textContent).toContain('VM 仍在运行，但控制台未能自动恢复，请手动重新连接。')
  })
  it('shows ISO read errors and recovers through an explicit media retry', async () => {
    installXapiMock(vi.fn())
    vi.mocked(window.xapi.iso.listAll).mockRejectedValueOnce(new Error('ISO unavailable')).mockResolvedValueOnce([])
    render(<ConsoleTab vm={{ ...baseVm, power_state: 'Halted' }} connectionId="conn-1" />)
    await act(flushPromises)
    expect(screen.getByRole('alert')).toHaveTextContent('ISO unavailable')
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.queryByText('没有可用 ISO')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取 ISO' }))
    await act(flushPromises)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('没有可用 ISO')).toBeInTheDocument()
  })

})
