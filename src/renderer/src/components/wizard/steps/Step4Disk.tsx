import { GIB, gibToBytes } from '../../../../../shared/vm-creation'
import type {
  VmCreationSrOption,
  VmInstallMode,
  VmRecord,
  VmTemplateKind,
  WizardDisk,
} from '../../../types/xapi'


interface Step4DiskProps {
  templateKind: VmTemplateKind
  installMode: VmInstallMode
  template: VmRecord | null
  options: VmCreationSrOption[]
  targetHostRef: string
  disks: WizardDisk[]
  diskEdited?: boolean
  targetSrRef: string
  onChangeDisks: (disks: WizardDisk[], userEdited?: boolean) => void
  onChangeTargetSrRef: (srRef: string) => void
}

export default function Step4Disk({
  templateKind,
  installMode,
  options,
  targetHostRef,
  disks,
  targetSrRef,
  onChangeDisks,
  onChangeTargetSrRef,
}: Step4DiskProps) {
  const compatible = options.filter((sr) => !targetHostRef || sr.hostRefs.includes(targetHostRef))

  if (templateKind === 'custom') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-secondary-foreground">完整复制模板的 {disks.length} 块磁盘</p>
        {disks.map((disk, index) => <p key={disk.device ?? index} className="text-sm text-secondary-foreground">设备 {disk.device ?? index} · {Number((disk.sizeBytes / GIB).toFixed(6))} GiB{disk.mode === 'RO' ? ' · 只读' : ''}</p>)}
        <div>
          <label htmlFor="copy-target-sr" className="block text-xs text-muted-foreground mb-1">目标存储</label>
          <select
            id="copy-target-sr"
            value={targetSrRef}
            onChange={(event) => onChangeTargetSrRef(event.target.value)}
            className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
          >
            <option value="">请选择目标存储</option>
            {compatible.map((sr) => <option key={sr.ref} value={sr.ref}>{sr.name}</option>)}
          </select>
        </div>
      </div>
    )
  }

  const updateDisk = (index: number, patch: Partial<WizardDisk>) => {
    const next = [...disks]
    next[index] = { ...next[index], ...patch }
    onChangeDisks(next)
  }
  const nextDevice = () => {
    const used = new Set(disks.map((disk, index) => disk.device ?? String(index)))
    let device = 0
    while (used.has(String(device))) device++
    return String(device)
  }

  return (
    <div className="space-y-4">
      {disks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {installMode === 'iso' ? '请至少添加一块安装磁盘。' : '当前未配置硬盘。'}
        </p>
      )}
      {disks.map((disk, index) => (
        <div key={`${disk.device ?? index}-${index}`} className="p-4 bg-muted rounded-lg space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-foreground">磁盘 {index + 1} · 设备 {disk.device ?? index}{disk.mode === 'RO' ? ' · 只读' : ''}</span>
            <button type="button" onClick={() => onChangeDisks(disks.filter((_, item) => item !== index))} className="text-xs text-danger">删除</button>
          </div>
          <label className="block text-xs text-muted-foreground" htmlFor={`wizard-disk-${index}`}>大小 (GiB)</label>
          <input
            id={`wizard-disk-${index}`}
            aria-label={`磁盘 ${index + 1} 大小`}
            type="number"
            min={1}
            step="any"
            disabled={disk.mode === 'RO'}
            value={Number((disk.sizeBytes / GIB).toFixed(6))}
            onChange={(event) => updateDisk(index, { sizeBytes: gibToBytes(Number(event.target.value)) })}
            className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
          />
          <select
            aria-label={`磁盘 ${index + 1} 存储`}
            value={disk.srRef}
            onChange={(event) => updateDisk(index, { srRef: event.target.value })}
            className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
          >
            <option value="">请选择存储</option>
            {compatible.map((sr) => <option key={sr.ref} value={sr.ref}>{sr.name}</option>)}
          </select>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChangeDisks([...disks, {
          templateVdiRef: '', srRef: compatible.find((sr) => sr.isDefault)?.ref ?? '', sizeBytes: 10 * GIB,
          device: nextDevice(), bootable: disks.length === 0,
        }])}
        className="px-3 py-2 text-sm bg-secondary text-foreground rounded-lg"
      >
        新增磁盘
      </button>
    </div>
  )
}
