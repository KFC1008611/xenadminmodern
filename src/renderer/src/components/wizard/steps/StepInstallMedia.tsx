import type { VmCreationIsoOption, VmInstallMode } from '../../../types/xapi'

interface StepInstallMediaProps {
  mode: VmInstallMode
  installUrl?: string
  onChangeInstallUrl?: (url: string) => void
  isoRef: string
  supportedModes: VmInstallMode[]
  options: VmCreationIsoOption[]
  targetHostRef: string
  onChange: (mode: VmInstallMode, isoRef: string) => void
}

export default function StepInstallMedia({
  mode,
  installUrl = '',
  onChangeInstallUrl,
  isoRef,
  supportedModes,
  options,
  targetHostRef,
  onChange,
}: StepInstallMediaProps) {
  const compatibleIsos = options.filter((iso) => !targetHostRef || iso.hostRefs.includes(targetHostRef))

  return (
    <div className="space-y-4">
      {supportedModes.includes('iso') && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="install-mode"
            checked={mode === 'iso'}
            onChange={() => onChange('iso', '')}
          />
          ISO 镜像安装
        </label>
      )}
      {supportedModes.includes('pxe') && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="install-mode"
            checked={mode === 'pxe'}
            onChange={() => onChange('pxe', '')}
          />
          PXE 网络启动
        </label>
      )}
      {supportedModes.includes('url') && <label className="flex items-center gap-2 text-sm text-foreground"><input type="radio" name="install-mode" checked={mode === 'url'} onChange={() => onChange('url', '')} />从 URL 安装</label>}
      {supportedModes.includes('none') && <label className="flex items-center gap-2 text-sm text-foreground"><input type="radio" name="install-mode" checked={mode === 'none'} onChange={() => onChange('none', '')} />不使用安装介质</label>}
      {mode === 'url' && <div><label htmlFor="install-url" className="block text-xs text-muted-foreground mb-1">安装源 URL</label><input id="install-url" type="url" value={installUrl} onChange={(event) => onChangeInstallUrl?.(event.target.value)} placeholder="http://server/path" className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground" /></div>}
      {mode === 'iso' && (
        <div>
          <label htmlFor="install-iso" className="block text-xs text-muted-foreground mb-1">ISO 镜像</label>
          <select
            id="install-iso"
            value={isoRef}
            onChange={(event) => onChange('iso', event.target.value)}
            className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground"
          >
            <option value="">请选择 ISO 镜像</option>
            {compatibleIsos.map((iso) => <option key={iso.ref} value={iso.ref}>{iso.name}</option>)}
          </select>
          {compatibleIsos.length === 0 && <p className="text-xs text-warning mt-2">当前放置范围没有可用 ISO。</p>}
        </div>
      )}
    </div>
  )
}
