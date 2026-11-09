/**
 * Step 2 — Connection Parameters.
 * Renders different form fields depending on the selected SR type.
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useSrWizardStore } from '../../../store/srWizard.store'

export default function Step2Params() {
  const {
    srType,
    nfsServer,
    nfsPath,
    iscsiTarget,
    iscsiPort,
    iscsiIqn,
    iscsiLun,
    chapUser,
    chapPassword,
    setField,
  } = useSrWizardStore()

  const [showChap, setShowChap] = useState(false)

  if (srType === 'ext' || srType === 'hba') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No additional connection parameters are required for{' '}
          <span className="text-foreground font-medium">{srType === 'ext' ? 'Local EXT' : 'HBA'}</span>{' '}
          storage repositories.
        </p>
        <div className="bg-muted border border-input rounded-lg p-4">
          <p className="text-sm text-subtle">
            The storage will be created using the locally available{' '}
            {srType === 'ext' ? 'disk partition' : 'HBA adapter'}.
            Proceed to the next step.
          </p>
        </div>
      </div>
    )
  }

  if ((srType === 'nfs' || srType === 'iso')) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          填写 NFS 服务器地址。已知共享目录时可直接填写，否则在下一步扫描并选择。
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="sr-nfsServer" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              NFS 服务器地址 <span className="text-danger">*</span>
            </label>
            <input id="sr-nfsServer"
              type="text"
              value={nfsServer}
              onChange={(e) => setField('nfsServer', e.target.value)}
              placeholder="e.g. 192.168.1.100 or nfs.example.com"
              className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="sr-nfsPath" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              共享目录（可在下一步发现）
            </label>
            <input id="sr-nfsPath"
              type="text"
              value={nfsPath}
              onChange={(e) => setField('nfsPath', e.target.value)}
              placeholder="e.g. /export/sr-data"
              className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>
        </div>
      </div>
    )
  }

  if (srType === 'iscsi') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          输入 iSCSI 地址；在下一步发现并选择 IQN 和 LUN，或填写已核实的 IQN 与 SCSI 标识。
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="sr-iscsiTarget" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              iSCSI 目标地址 <span className="text-danger">*</span>
            </label>
            <input id="sr-iscsiTarget"
              type="text"
              value={iscsiTarget}
              onChange={(e) => setField('iscsiTarget', e.target.value)}
              placeholder="e.g. 192.168.1.200 or iscsi.example.com"
              className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="sr-iscsiIqn" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              目标 IQN（可在下一步发现）
            </label>
            <input id="sr-iscsiIqn"
              type="text"
              value={iscsiIqn}
              onChange={(e) => setField('iscsiIqn', e.target.value)}
              placeholder="e.g. iqn.2024-01.com.example:target"
              className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="sr-iscsi-port" className="mb-1.5 block text-sm font-medium text-secondary-foreground">iSCSI 端口</label>
            <input id="sr-iscsi-port" type="number" min={1} max={65535} value={iscsiPort}
              onChange={(event) => setField('iscsiPort', event.target.value)}
              className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground" />
            {(!Number.isInteger(Number(iscsiPort)) || Number(iscsiPort) < 1 || Number(iscsiPort) > 65535) && <p className="mt-1 text-xs text-danger">端口必须是 1–65535 的整数。</p>}
          </div>

          <div>
            <label htmlFor="sr-iscsiLun" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              SCSI 标识（可在下一步发现，不是 LUN 序号）
            </label>
            <input id="sr-iscsiLun"
              type="text"
              value={iscsiLun}
              onChange={(e) => setField('iscsiLun', e.target.value)}
              placeholder="例如 360a9800050334c66435a49636f564d4c"
              className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>

          {/* CHAP authentication (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowChap(!showChap)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-secondary-foreground transition-colors"
            >
              {showChap ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              CHAP 认证（可选）
            </button>

            {showChap && (
              <div className="mt-3 space-y-3 pl-2 border-l-2 border-input">
                <div>
                  <label htmlFor="sr-chapUser" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    CHAP 用户名
                  </label>
                  <input id="sr-chapUser"
                    type="text"
                    value={chapUser}
                    onChange={(e) => setField('chapUser', e.target.value)}
                    placeholder="存储服务器配置的用户名"
                    className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="sr-chapPassword" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    CHAP 密码
                  </label>
                  <input id="sr-chapPassword"
                    type="password"
                    value={chapPassword}
                    onChange={(e) => setField('chapPassword', e.target.value)}
                    placeholder="存储服务器配置的密码"
                    className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}
