import type { VmCreationHostOption } from '../../../types/xapi'

interface StepPlacementProps {
  targetHostRef: string
  hosts: VmCreationHostOption[]
  onChange: (hostRef: string) => void
}

export default function StepPlacement({ targetHostRef, hosts, onChange }: StepPlacementProps) {
  return (
    <div>
      <label htmlFor="target-host" className="block text-sm font-medium text-secondary-foreground mb-1.5">目标主机</label>
      <select
        id="target-host"
        value={targetHostRef}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
      >
        <option value="">自动选择</option>
        {hosts.filter((host) => host.enabled).map((host) => (
          <option key={host.ref} value={host.ref}>
            {host.name} · {host.cpuCount} vCPU
          </option>
        ))}
      </select>
      <p className="text-xs text-subtle mt-2">自动选择会让资源池在兼容主机中完成放置。</p>
    </div>
  )
}
