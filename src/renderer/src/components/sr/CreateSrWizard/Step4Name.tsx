/**
 * Step 4 — Name and Description.
 * Simple form for naming the new SR.
 */
import { useSrWizardStore } from '../../../store/srWizard.store'

export default function Step4Name() {
  const { nameLabel, nameDescription, setField } = useSrWizardStore()

  return (
    <div className="space-y-4">

      <div className="space-y-3">
        <div>
          <label htmlFor="sr-name" className="block text-sm font-medium text-secondary-foreground mb-1.5">
            名称 <span className="text-danger">*</span>
          </label>
          <input id="sr-name"
            type="text"
            value={nameLabel}
            onChange={(e) => setField('nameLabel', e.target.value)}
            placeholder="例如：生产资源池 NFS 存储"
            className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
          />
          {nameLabel.trim() === '' && (
            <p className="text-xs text-danger mt-1">请输入存储仓库名称。</p>
          )}
        </div>

        <div>
          <label htmlFor="sr-description" className="block text-sm font-medium text-secondary-foreground mb-1.5">
            描述（可选）
          </label>
          <textarea id="sr-description"
            value={nameDescription}
            onChange={(e) => setField('nameDescription', e.target.value)}
            placeholder="例如：业务虚拟机磁盘，存储机房 A"
            rows={3}
            className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors resize-none"
          />
        </div>
      </div>
    </div>
  )
}
