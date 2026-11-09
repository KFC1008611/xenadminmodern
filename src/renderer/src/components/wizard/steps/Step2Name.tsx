/**
 * Step 2 — VM name and description.
 * Validates name on blur and before proceeding to next step.
 */
import { useState, useEffect } from 'react'

const MAX_NAME_LENGTH = 255
const MAX_DESCRIPTION_LENGTH = 1024

interface Step2NameProps {
  vmName: string
  vmDescription: string
  defaultName: string
  onChange: (field: 'vmName' | 'vmDescription', value: string) => void
}

export default function Step2Name({ vmName, vmDescription, defaultName, onChange }: Step2NameProps) {
  const [nameError, setNameError] = useState<string | null>(null)

  // Pre-fill with template name when component mounts if field is empty
  useEffect(() => {
    if (!vmName && defaultName) {
      onChange('vmName', defaultName)
    }
  }, [])

  const validateName = (value: string) => {
    if (!value.trim()) {
      setNameError('虚拟机名称不能为空')
    } else if (value.length > MAX_NAME_LENGTH) {
      setNameError(`名称不能超过 ${MAX_NAME_LENGTH} 个字符`)
    } else {
      setNameError(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="vmName" className="block text-sm font-medium text-secondary-foreground">
            虚拟机名称 <span className="text-danger">*</span>
          </label>
          <span className="text-xs text-subtle">
            {vmName.length} / {MAX_NAME_LENGTH}
          </span>
        </div>
        <input
          id="vmName"
          type="text"
          value={vmName}
          onChange={(e) => {
            onChange('vmName', e.target.value)
            if (nameError) validateName(e.target.value)
          }}
          onBlur={(e) => validateName(e.target.value)}
          placeholder={defaultName || '输入新虚拟机的名称'}
          maxLength={MAX_NAME_LENGTH}
          className={`w-full px-3 py-2 bg-muted border rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-2 focus:border-transparent ${
            nameError ? 'border-danger/30 focus:ring-danger' : 'border-input focus:ring-primary'
          }`}
          aria-describedby={nameError ? 'vmName-error' : undefined}
          aria-invalid={!!nameError}
        />
        {nameError && (
          <p id="vmName-error" className="text-xs text-danger mt-1">
            {nameError}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="vmDescription" className="block text-sm font-medium text-secondary-foreground">
            描述 <span className="text-subtle">（可选）</span>
          </label>
          <span className="text-xs text-subtle">
            {vmDescription.length} / {MAX_DESCRIPTION_LENGTH}
          </span>
        </div>
        <textarea
          id="vmDescription"
          value={vmDescription}
          onChange={(e) => onChange('vmDescription', e.target.value)}
          placeholder="简要描述此虚拟机的用途"
          maxLength={MAX_DESCRIPTION_LENGTH}
          rows={3}
          className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
        />
      </div>
    </div>
  )
}
