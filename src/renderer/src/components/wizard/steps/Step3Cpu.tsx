import { useState } from 'react'
import type { VmRecord } from '../../../types/xapi'

const GIB = 1073741824

interface Step3CpuProps {
  template: VmRecord | null
  vcpus: number
  memoryGib: number
  maxVcpus: number
  minMemoryGib: number
  maxMemoryGib: number
  onChangeVcpus: (value: number) => void
  onChangeMemoryGib: (value: number) => void
}

export default function Step3Cpu({
  template,
  vcpus,
  memoryGib,
  maxVcpus,
  minMemoryGib,
  maxMemoryGib,
  onChangeVcpus,
  onChangeMemoryGib,
}: Step3CpuProps) {
  const [computeError, setComputeError] = useState('')

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="vcpus" className="block text-sm font-medium text-secondary-foreground mb-1.5">vCPUs</label>
        <div className="flex items-center gap-3">
          <input
            id="vcpus"
            type="number"
            min={1}
            max={maxVcpus}
            value={vcpus}
            onChange={(event) => {
              const value = Number(event.target.value)
              onChangeVcpus(value)
              setComputeError(value > maxVcpus ? `vCPU 不能超过 ${maxVcpus}` : value < 1 ? 'vCPU 必须大于零' : '')
            }}
            className="w-32 px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
          />
          <span className="text-xs text-subtle">可用上限: {maxVcpus}</span>
        </div>
      </div>
      <div>
        <label htmlFor="memoryGib" className="block text-sm font-medium text-secondary-foreground mb-1.5">Memory (GiB)</label>
        <div className="flex items-center gap-3">
          <input
            id="memoryGib"
            type="number"
            min={minMemoryGib}
            max={maxMemoryGib}
            step={0.25}
            value={Number(memoryGib.toFixed(6))}
            onChange={(event) => {
              const value = Number(event.target.value)
              onChangeMemoryGib(value)
              setComputeError(
                value > maxMemoryGib
                  ? `内存不能超过 ${maxMemoryGib} GiB`
                  : value < minMemoryGib
                    ? `内存不能低于 ${minMemoryGib} GiB`
                    : '',
              )
            }}
            className="w-32 px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
          />
          <span className="text-xs text-subtle">范围: {minMemoryGib.toFixed(2)} – {maxMemoryGib.toFixed(2)} GiB</span>
        </div>
      </div>
      {computeError && <p className="text-xs text-danger">{computeError}</p>}
      {template && (
        <div className="text-xs text-subtle bg-muted rounded-lg p-3">
          模板默认值: {template.VCPUs_at_startup} vCPU, {(template.memory_dynamic_max / GIB).toFixed(2)} GiB 内存
        </div>
      )}
    </div>
  )
}
