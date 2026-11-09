import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import Step1Type from '../../src/renderer/src/components/sr/CreateSrWizard/Step1Type'
import { useSrWizardStore } from '../../src/renderer/src/store/srWizard.store'

describe('SR type safety gates', () => {
  beforeEach(() => {
    useSrWizardStore.setState({ srType: '' })
  })

  it('blocks EXT and HBA while preserving NFS and iSCSI', () => {
    render(<Step1Type />)

    expect(screen.getByRole('button', { name: /Local EXT/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /HBA/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'NFS', exact: true })).toBeEnabled()
    expect(screen.getByRole('button', { name: /iSCSI/ })).toBeEnabled()
    expect(screen.getAllByText(/暂不可用/)).toHaveLength(2)
  })
})
