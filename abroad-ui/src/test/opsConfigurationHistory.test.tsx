import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { OpsConfigurationRelease } from '../services/admin/configurationReleaseTypes'

import OpsConfigurationHistory from '../pages/Ops/OpsConfigurationHistory'
import { setOpsSession } from '../services/admin/opsAuthStore'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const mocked = vi.hoisted(() => ({
  approveOpsConfigurationRelease: vi.fn(),
  createOpsConfigurationRollback: vi.fn(),
  getOpsConfigurationRelease: vi.fn(),
  listOpsConfigurationReleases: vi.fn(),
  rejectOpsConfigurationRelease: vi.fn(),
  submitOpsConfigurationRelease: vi.fn(),
  updateOpsConfigurationRelease: vi.fn(),
}))

vi.mock('../services/admin/configurationReleaseAdminApi', () => mocked)

const pendingRelease: OpsConfigurationRelease = {
  appliedAt: null,
  appliedBy: null,
  appliedVersion: null,
  approvalPolicy: 'DIFFERENT_ADMIN_REQUIRED',
  approvedAt: null,
  approvedBy: null,
  baseVersion: 4,
  createdAt: '2026-08-02T18:00:00.000Z',
  diff: [{ after: 'false', before: 'true', field: 'value.enabled' }],
  effectiveAt: '2026-08-03T12:00:00.000Z',
  id: 'release-1',
  impact: ['Changes source-asset eligibility and network verification for future payments.'],
  payload: {
    kind: 'CRYPTO_ASSET',
    value: {
      blockchain: 'STELLAR',
      cryptoCurrency: 'USDC',
      decimals: 7,
      enabled: false,
      mintAddress: 'GA-ISSUER',
    },
  },
  reason: 'Pause this route during provider maintenance.',
  reference: 'INC-901',
  rejectionReason: null,
  requestedBy: { displayName: 'Configuration Owner', id: 'ops-owner' },
  rollbackOfId: null,
  status: 'PENDING_APPROVAL',
  targetKey: 'USDC:STELLAR',
  targetType: 'CRYPTO_ASSET',
  title: 'Pause USDC on Stellar',
  updatedAt: '2026-08-02T18:05:00.000Z',
  version: 2,
}

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('OpsConfigurationHistory', () => {
  it('shows reviewed impact and lets only a different approver execute the versioned approval', async () => {
    setOpsSession({
      authenticatedAt: '2026-08-02T18:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Independent Reviewer',
      email: 'reviewer@abroad.finance',
      kind: 'ops_user',
      permissions: ['configuration:approve', 'configuration:read'],
      role: 'ADMINISTRATOR',
      sessionVersion: 1,
      stepUpExpiresAt: '2026-08-02T18:10:00.000Z',
      userId: 'ops-reviewer',
    })
    mocked.listOpsConfigurationReleases.mockResolvedValue({
      items: [pendingRelease], page: 1, pageSize: 20, total: 1,
    })
    mocked.approveOpsConfigurationRelease.mockResolvedValue({
      ...pendingRelease,
      appliedAt: '2026-08-03T12:00:00.000Z',
      appliedVersion: 5,
      approvedAt: '2026-08-02T18:06:00.000Z',
      approvedBy: { displayName: 'Independent Reviewer', id: 'ops-reviewer' },
      status: 'APPLIED',
      version: 3,
    })

    render(
      <MemoryRouter initialEntries={['/ops/configuration/history?status=PENDING_APPROVAL&release=release-1']}>
        <ImmediateOpsMutationProvider>
          <OpsConfigurationHistory />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', {
      level: 2,
      name: 'Pause USDC on Stellar',
    })).toBeInTheDocument()
    expect(screen.getByText('Changes source-asset eligibility and network verification for future payments.')).toBeInTheDocument()
    expect(screen.getByText('value.enabled')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mocked.approveOpsConfigurationRelease).toHaveBeenCalledWith(
      'release-1',
      expect.objectContaining({
        expectedVersion: 2,
        reason: 'Focused automated test operation',
      }),
    )
    expect(await screen.findByText(/Release approved/)).toBeInTheDocument()
    expect(mocked.listOpsConfigurationReleases).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PENDING_APPROVAL',
    }))
  })

  it('lets the sole enabled administrator approve their own submitted release', async () => {
    const soleAdminRelease: OpsConfigurationRelease = {
      ...pendingRelease,
      approvalPolicy: 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED',
    }
    setOpsSession({
      authenticatedAt: '2026-08-02T18:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Configuration Owner',
      email: 'owner@abroad.finance',
      kind: 'ops_user',
      permissions: ['configuration:approve', 'configuration:read'],
      role: 'ADMINISTRATOR',
      sessionVersion: 1,
      stepUpExpiresAt: '2026-08-02T18:10:00.000Z',
      userId: 'ops-owner',
    })
    mocked.listOpsConfigurationReleases.mockResolvedValue({
      items: [soleAdminRelease], page: 1, pageSize: 20, total: 1,
    })
    mocked.approveOpsConfigurationRelease.mockResolvedValue({
      ...soleAdminRelease,
      appliedAt: '2026-08-03T12:00:00.000Z',
      appliedVersion: 5,
      approvedAt: '2026-08-02T18:06:00.000Z',
      approvedBy: soleAdminRelease.requestedBy,
      status: 'APPLIED',
      version: 3,
    })

    render(
      <MemoryRouter initialEntries={['/ops/configuration/history?status=PENDING_APPROVAL&release=release-1']}>
        <ImmediateOpsMutationProvider>
          <OpsConfigurationHistory />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/You are the only enabled administrator/)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Approve as sole administrator' }))

    expect(mocked.approveOpsConfigurationRelease).toHaveBeenCalledWith(
      'release-1',
      expect.objectContaining({ expectedVersion: 2 }),
    )
    expect(await screen.findByText(/Release approved/)).toBeInTheDocument()
  })

  it('keeps self-approval unavailable when another enabled administrator exists', async () => {
    setOpsSession({
      authenticatedAt: '2026-08-02T18:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Configuration Owner',
      email: 'owner@abroad.finance',
      kind: 'ops_user',
      permissions: ['configuration:approve', 'configuration:read'],
      role: 'ADMINISTRATOR',
      sessionVersion: 1,
      stepUpExpiresAt: '2026-08-02T18:10:00.000Z',
      userId: 'ops-owner',
    })
    mocked.listOpsConfigurationReleases.mockResolvedValue({
      items: [pendingRelease], page: 1, pageSize: 20, total: 1,
    })

    render(
      <MemoryRouter initialEntries={['/ops/configuration/history?status=PENDING_APPROVAL&release=release-1']}>
        <ImmediateOpsMutationProvider>
          <OpsConfigurationHistory />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Another enabled administrator is available/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve as sole administrator' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })
})
