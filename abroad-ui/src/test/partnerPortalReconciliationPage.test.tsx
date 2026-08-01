import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import PartnerPortalReconciliation from '../pages/PartnerPortal/PartnerPortalReconciliation'
import { clearPartnerPortalSession, setPartnerPortalSession } from '../services/partnerPortal/partnerPortalSessionStore'

const mocked = vi.hoisted(() => ({
  continuePartnerPixReconciliation: vi.fn(),
  listPartnerPixReconciliations: vi.fn(),
  startPartnerPixReconciliation: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => mocked)

const runningRun = {
  batchSize: 5,
  completedAt: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  failureCount: 0,
  id: '11111111-1111-4111-8111-111111111111',
  ineligibleCount: 1,
  items: [{
    failureCode: null,
    status: 'UPDATED',
    transactionId: '22222222-2222-4222-8222-222222222222',
    updatedAt: '2026-08-01T12:01:00.000Z',
  }],
  processedCount: 5,
  status: 'RUNNING',
  unchangedCount: 1,
  updatedAt: '2026-08-01T12:01:00.000Z',
  updatedCount: 3,
} as const

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
})

describe('PartnerPortalReconciliation', () => {
  it('processes only the next bounded batch of an existing run', async () => {
    setPartnerPortalSession({
      accessToken: 'admin-token',
      email: 'admin@decaf.so',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mfaEnabled: true,
      mfaVerified: true,
      partnerName: 'Decaf',
      role: 'ADMIN',
      userId: 'admin-1',
    })
    mocked.listPartnerPixReconciliations.mockResolvedValue([runningRun])
    mocked.continuePartnerPixReconciliation.mockResolvedValue({
      ...runningRun,
      completedAt: '2026-08-01T12:02:00.000Z',
      processedCount: 8,
      status: 'COMPLETED',
      updatedCount: 6,
    })
    render(<MemoryRouter><PartnerPortalReconciliation /></MemoryRouter>)
    const user = userEvent.setup()

    expect(await screen.findByText('Ready for next batch')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Process next 5' }))

    await waitFor(() => expect(mocked.continuePartnerPixReconciliation).toHaveBeenCalledWith(runningRun.id))
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText(/Transaction status and funds are never changed\./u)).toBeInTheDocument()
  })

  it('does not call reconciliation APIs for a member', async () => {
    setPartnerPortalSession({
      accessToken: 'member-token',
      email: 'member@decaf.so',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mfaEnabled: false,
      mfaVerified: false,
      partnerName: 'Decaf',
      role: 'MEMBER',
      userId: 'member-1',
    })
    render(<MemoryRouter><PartnerPortalReconciliation /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Administrator verification required' })).toBeInTheDocument()
    expect(mocked.listPartnerPixReconciliations).not.toHaveBeenCalled()
  })
})
