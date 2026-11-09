import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * VmBootOrderDialog — Dialog for configuring VM boot order.
 * v9: New dialog for VM boot order configuration.
 */
import { useState, useEffect } from 'react'
import { X, HardDrive, Disc, Network } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { useVmAdvancedStore } from '../../store/vm-advanced.store'

interface VmBootOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  vmRef: string
  currentOrder: string
}

interface BootOption {
  key: string
  label: string
  description: string
  icon: React.ReactNode
}

const bootOptions: BootOption[] = [
  {
    key: 'c',
    label: '硬盘',
    description: '从虚拟硬盘启动',
    icon: <HardDrive className="h-4 w-4" />,
  },
  {
    key: 'd',
    label: '光驱',
    description: '从CD/DVD启动',
    icon: <Disc className="h-4 w-4" />,
  },
  {
    key: 'n',
    label: '网络',
    description: '从网络PXE启动',
    icon: <Network className="h-4 w-4" />,
  },
]

export function VmBootOrderDialog({ open, onOpenChange, connectionId, vmRef, currentOrder }: VmBootOrderDialogProps) {
  const toast = useToast()
  const { setVmBootOrder } = useVmAdvancedStore()

  const [selectedOrder, setSelectedOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && currentOrder) {
      setSelectedOrder(currentOrder.split(''))
    }
  }, [open, currentOrder])

  const handleSave = async () => {
    setLoading(true)
    try {
      const order = selectedOrder.join('')
      await setVmBootOrder(connectionId, vmRef, order)
      toast.success('启动顺序已更新')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const moveOption = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...selectedOrder]
    if (direction === 'up' && index > 0) {
      ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
    } else if (direction === 'down' && index < newOrder.length - 1) {
      ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    }
    setSelectedOrder(newOrder)
  }

  const addOption = (key: string) => {
    if (!selectedOrder.includes(key)) {
      setSelectedOrder([...selectedOrder, key])
    }
  }

  const removeOption = (key: string) => {
    setSelectedOrder(selectedOrder.filter((k) => k !== key))
  }

  if (!open) return null

  return (
    <DesktopDialog title="配置启动顺序" onClose={() => onOpenChange(false)} busy={loading} className="max-w-md">
      <div className="relative bg-card border rounded-lg shadow-lg w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">配置启动顺序</h2>
          <button
            onClick={() => onOpenChange(false)}
            disabled={loading}
            aria-label="关闭"
            className="p-1 hover:bg-secondary rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="text-xs text-muted-foreground">
            选择启动设备并调整优先级顺序
          </div>

          {/* 当前启动顺序 */}
          <div>
            <div className="text-sm font-semibold mb-2">启动顺序</div>
            <div className="space-y-2">
              {selectedOrder.map((key, index) => {
                const option = bootOptions.find((o) => o.key === key)
                if (!option) return null
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 p-3 bg-secondary rounded-md"
                  >
                    <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      {index + 1}
                    </span>
                    {option.icon}
                    <div className="flex-1">
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {option.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveOption(index, 'up')}
                        disabled={index === 0}
                        className="p-1 hover:bg-background rounded disabled:opacity-30"
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveOption(index, 'down')}
                        disabled={index === selectedOrder.length - 1}
                        className="p-1 hover:bg-background rounded disabled:opacity-30"
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeOption(key)}
                        className="p-1 hover:bg-background rounded"
                        title="移除"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 可用设备 */}
          <div>
            <div className="text-sm font-semibold mb-2">可用设备</div>
            <div className="grid grid-cols-3 gap-2">
              {bootOptions
                .filter((opt) => !selectedOrder.includes(opt.key))
                .map((option) => (
                  <button
                    key={option.key}
                    onClick={() => addOption(option.key)}
                    className="flex flex-col items-center gap-2 p-3 border rounded-md hover:bg-secondary transition-colors"
                  >
                    {option.icon}
                    <span className="text-xs font-medium">{option.label}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
            disabled={loading}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={loading || selectedOrder.length === 0}
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </DesktopDialog>
  )
}
