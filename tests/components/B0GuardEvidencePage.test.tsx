import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { B0GuardEvidencePage } from '../../src/renderer/src/components/evidence/B0GuardEvidencePage'
import { AUDITED_FEATURE_IDS, getAuditedFeatureBlockReason } from '../../src/shared/audited-features'

describe('B0 packaged guard evidence page', () => {
  it('renders every audited feature with its exact guarded reason and source identity', () => {
    const { container } = render(<B0GuardEvidencePage />)
    const evidence = [...container.querySelectorAll<HTMLElement>('[data-b0-feature-id]')]

    expect(screen.getByRole('heading', { name: 'B0 门禁观察' })).toBeInTheDocument()
    expect(evidence).toHaveLength(AUDITED_FEATURE_IDS.length)
    expect(evidence.map((entry) => entry.dataset.b0FeatureId)).toEqual(AUDITED_FEATURE_IDS)
    for (const entry of evidence) {
      const id = entry.dataset.b0FeatureId as (typeof AUDITED_FEATURE_IDS)[number]
      expect(entry.dataset.b0GuardReason).toBe(getAuditedFeatureBlockReason(id))
      expect(entry.dataset.b0SourceCommit).toMatch(/^[0-9a-f]{40}$/)
    }
    expect(container.querySelectorAll('button, input, select, textarea, a[href]')).toHaveLength(0)
  })
})
