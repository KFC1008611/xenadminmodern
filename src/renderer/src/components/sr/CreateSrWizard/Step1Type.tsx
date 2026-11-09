/**
 * Step 1 — SR Type Selection.
 * Displays 4 cards in a 2x2 grid: Local EXT, NFS, iSCSI, HBA.
 */
import { HardDrive, FolderTree, CircleDot, Cpu } from 'lucide-react'
import { useSrWizardStore } from '../../../store/srWizard.store'
import { cn } from '../../../lib/utils'
import { getAuditedFeatureBlockReason } from '../../../../../shared/audited-features'

const SR_TYPES = [
  {
    id: 'iso' as const,
    icon: FolderTree,
    title: 'NFS ISO 库',
    description: '接入存放 ISO 安装介质的 NFS 共享目录。',
    blockedReason: null,
  },
  {
    id: 'ext' as const,
    icon: HardDrive,
    title: 'Local EXT',
    description: '使用主机本地磁盘和 EXT 文件系统，仅供该主机访问。',
    blockedReason: getAuditedFeatureBlockReason('sr.ext-create'),
  },
  {
    id: 'nfs' as const,
    icon: FolderTree,
    title: 'NFS',
    description: '接入 NFS 服务器提供的共享目录，用于存放虚拟磁盘。',
    blockedReason: null,
  },
  {
    id: 'iscsi' as const,
    icon: CircleDot,
    title: 'iSCSI',
    description: '接入 iSCSI 目标上的 LUN，用于资源池的块存储。',
    blockedReason: null,
  },
  {
    id: 'hba' as const,
    icon: Cpu,
    title: 'HBA',
    description: '通过主机的存储适配器接入光纤通道等硬件存储。',
    blockedReason: getAuditedFeatureBlockReason('sr.hba-create'),
  },
]

export default function Step1Type() {
  const { srType, setSrType } = useSrWizardStore()

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        选择存储仓库类型。请先准备好存储服务器地址及共享目录或 LUN 的访问权限。
      </p>

      <div className="grid grid-cols-2 gap-3">
        {SR_TYPES.map(({ id, icon: Icon, title, description, blockedReason }) => {
          const isSelected = srType === id
          return (
            <button
              key={id}
              aria-label={title}
              type="button"
              onClick={() => setSrType(id)}
              disabled={Boolean(blockedReason)}
              title={blockedReason ?? undefined}
              className={cn(
                'flex flex-col items-start gap-3 p-4 rounded-xl border text-left transition-all',
                blockedReason
                  ? 'cursor-not-allowed border-warning/30 bg-muted opacity-70'
                  : isSelected
                  ? 'border-primary/30 bg-accent'
                  : 'border-input bg-muted hover:border-input hover:bg-muted'
              )}
            >
              <Icon
                className={cn(
                  'w-8 h-8',
                  isSelected ? 'text-accent-foreground' : 'text-subtle'
                )}
              />
              <div>
                <div
                  className={cn(
                    'font-medium',
                    isSelected ? 'text-accent-foreground' : 'text-foreground'
                  )}
                >
                  {title}
                </div>
                <div className="text-xs text-subtle mt-0.5 leading-relaxed">
                  {description}
                </div>
                {blockedReason && (
                  <div className="text-xs text-warning mt-2 leading-relaxed">
                    {blockedReason}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
